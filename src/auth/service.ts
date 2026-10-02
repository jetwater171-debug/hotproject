import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { readAuthConfiguration } from './config';
import { AccessError, authErrorMessage, validateCredentials } from './errors';

const configuration = readAuthConfiguration((import.meta as unknown as { env: Record<string, unknown> }).env || {});
let client: SupabaseClient | null = null;

export function getAuthConfiguration() { return { configured: configuration.configured, error: configuration.error }; }

export function getSupabaseClient(): SupabaseClient | null {
  if (!configuration.configured) return null;
  if (!client) client = createClient(configuration.url, configuration.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'velora-auth-session', flowType: 'implicit' },
  });
  return client;
}

function requireClient(): SupabaseClient {
  const supabase = getSupabaseClient();
  if (!supabase) throw new AccessError(configuration.error || 'O acesso está temporariamente indisponível.', 'AUTH_NOT_CONFIGURED');
  return supabase;
}

export async function getAuthSession(): Promise<Session | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new AccessError(authErrorMessage(error), 'SESSION_ERROR');
  return data.session;
}

/** SDK refreshes expired sessions. The API must independently verify this JWT. */
export async function getAccessToken(): Promise<string | null> {
  const session = await getAuthSession();
  if (!session || session.user.is_anonymous || !session.user.email) return null;
  return session.access_token || null;
}

export async function verifyAuthSession(session: Session): Promise<Session> {
  const { data, error } = await requireClient().auth.getUser(session.access_token);
  if (error || !data.user || data.user.id !== session.user.id) throw new AccessError(authErrorMessage(error || { code: 'session_not_found' }), 'SESSION_INVALID');
  if (data.user.is_anonymous || !data.user.email) throw new AccessError('Entre com sua conta para acessar o estúdio.', 'ACCOUNT_REQUIRED');
  return { ...session, user: data.user };
}

export async function signIn(email: string, password: string): Promise<Session> {
  validateCredentials(email, password);
  const { data, error } = await requireClient().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw new AccessError(authErrorMessage(error), 'LOGIN_FAILED');
  if (!data.session) throw new AccessError('Não foi possível abrir sua sessão. Tente entrar novamente.', 'SESSION_MISSING');
  return data.session;
}

export async function signUp(name: string, email: string, password: string): Promise<Session> {
  validateCredentials(email, password, name);
  const { data, error } = await requireClient().auth.signUp({ email: email.trim().toLowerCase(), password, options: { data: { display_name: name.trim(), full_name: name.trim() } } });
  if (error) throw new AccessError(authErrorMessage(error), 'SIGNUP_FAILED');
  // Autoconfirm is configured on the project. Never fabricate a session when
  // that server configuration is missing or a duplicate user is obfuscated.
  if (!data.session) throw new AccessError('Não foi possível abrir sua conta. A configuração de acesso precisa ser revisada antes de continuar.', 'CONFIRMATION_CONFIGURATION');
  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await requireClient().auth.signOut({ scope: 'local' });
  if (error) throw new AccessError(authErrorMessage(error), 'LOGOUT_FAILED');
}

export async function updateDisplayName(name: string): Promise<User> {
  if (name.trim().length < 2 || name.trim().length > 60) throw new AccessError('Informe seu nome com 2 a 60 caracteres.', 'INVALID_NAME');
  const { data, error } = await requireClient().auth.updateUser({ data: { display_name: name.trim(), full_name: name.trim() } });
  if (error || !data.user) throw new AccessError(authErrorMessage(error), 'PROFILE_UPDATE_FAILED');
  return data.user;
}

export function getUserDisplayName(user: User): string {
  const name: unknown = user.user_metadata?.display_name || user.user_metadata?.full_name || user.user_metadata?.name;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : user.email?.split('@')[0] || 'Minha conta';
}
