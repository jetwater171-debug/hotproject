import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getAuthConfiguration, getAuthSession, getSupabaseClient, signIn, signOut, signUp, verifyAuthSession } from './service';
import { AccessError, authErrorMessage } from './errors';
import { setStorageOwner } from './storage-owner';

interface AuthState { session: Session | null; loading: boolean; error: string | null }
interface AuthContextValue extends AuthState {
  user: User | null;
  configured: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  retry(): void;
}
const AuthContext = createContext<AuthContextValue | null>(null);

function deadline<T>(task: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new AccessError('Não conseguimos restaurar sua sessão agora. Confira sua internet e tente novamente.', 'SESSION_TIMEOUT')), 15_000);
    task.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const config = getAuthConfiguration();
  const [state, setState] = useState<AuthState>({ session: null, loading: config.configured, error: null });
  const [retryVersion, setRetryVersion] = useState(0);
  const epoch = useRef(0), mounted = useRef(false), sessionRef = useRef<Session | null>(null);

  const commit = useCallback((session: Session | null, error: string | null = null) => {
    epoch.current++;
    setStorageOwner(session?.user.id || null);
    sessionRef.current = session;
    if (mounted.current) setState({ session, loading: false, error });
  }, []);

  useEffect(() => {
    mounted.current = true;
    let canceled = false;
    const supabase = getSupabaseClient();
    if (!supabase) { commit(null); return () => { mounted.current = false; }; }
    const verify = async (candidate: Session | null) => {
      const version = ++epoch.current;
      if (!candidate) { commit(null); return; }
      if (sessionRef.current?.user.id !== candidate.user.id) {
        setStorageOwner(null); sessionRef.current=null; setState({ session: null, loading: true, error: null });
      }
      try {
        const confirmed = await deadline(verifyAuthSession(candidate));
        if (!canceled && mounted.current && version === epoch.current) commit(confirmed);
      } catch (error) {
        if (!canceled && mounted.current && version === epoch.current) commit(null, authErrorMessage(error));
      }
    };
    // The callback stays synchronous. SDK calls run after its lock has released.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, candidate) => {
      if (canceled || event === 'INITIAL_SESSION') return;
      if (event === 'SIGNED_OUT' || !candidate) { commit(null); return; }
      if (sessionRef.current?.user.id === candidate.user.id && ['TOKEN_REFRESHED', 'USER_UPDATED', 'SIGNED_IN'].includes(event)) { commit(candidate); return; }
      const eventVersion = ++epoch.current;
      if (sessionRef.current?.user.id !== candidate.user.id) { setStorageOwner(null); sessionRef.current=null; setState({ session: null, loading: true, error: null }); }
      window.setTimeout(() => { if (!canceled && eventVersion === epoch.current) void verify(candidate); }, 0);
    });
    const version = ++epoch.current;
    void deadline(getAuthSession()).then(candidate => {
      if (!canceled && mounted.current && version === epoch.current) void verify(candidate);
    }).catch(error => { if (!canceled && mounted.current && version === epoch.current) commit(null, authErrorMessage(error)); });
    return () => { canceled = true; mounted.current = false; epoch.current++; subscription.unsubscribe(); };
  }, [commit, retryVersion]);

  const login = useCallback(async (email: string, password: string) => { const session = await signIn(email, password); if (mounted.current) commit(session); }, [commit]);
  const register = useCallback(async (name: string, email: string, password: string) => { const session = await signUp(name, email, password); if (mounted.current) commit(session); }, [commit]);
  const logout = useCallback(async () => {
    const previous = sessionRef.current;
    epoch.current++; setStorageOwner(null); setState({ session: null, loading: true, error: null });
    try { await deadline(signOut()); if (mounted.current) commit(null); }
    catch (error) { if (mounted.current) commit(previous); throw error; }
  }, [commit]);
  const value = useMemo<AuthContextValue>(() => ({ ...state, user: state.session?.user || null, configured: config.configured, signIn: login, signUp: register, signOut: logout, retry: () => { setState(previous => ({ ...previous, loading: true, error: null })); setRetryVersion(version => version + 1); } }), [state, config.configured, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('A autenticação precisa ser usada dentro de AuthProvider.');
  return context;
}
