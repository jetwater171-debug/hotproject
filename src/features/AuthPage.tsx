import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react';
import { ArrowLeft, ArrowRight, AudioLines, Check, Eye, EyeOff, ImagePlus, LoaderCircle, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound, X } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { authErrorMessage } from '../auth/errors';
import { getAuthConfiguration } from '../auth/service';
import './auth-page.css';

export interface AuthPageProps { onEnter: () => void; onBack: () => void; initialMode?: 'login' | 'signup'; onModeChange?: (mode: 'login' | 'signup') => void }

function AuthArtwork() {
  const reducedMotion = useReducedMotionConfig();
  return <div className="auth-artwork" aria-hidden="true">
    <div className="auth-art-haze" />
    <motion.svg className="auth-ribbon-art" viewBox="0 0 620 460" fill="none" animate={reducedMotion ? { rotate: 0, y: 0 } : { rotate: [-3, 2, -3], y: [0, -8, 0] }} transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}>
      <defs>
        <linearGradient id="auth-ribbon-glass" x1="137" y1="122" x2="468" y2="337" gradientUnits="userSpaceOnUse"><stop stopColor="#a4a2ac" stopOpacity=".08" /><stop offset=".42" stopColor="#5c5763" stopOpacity=".025" /><stop offset="1" stopColor="#ff4059" stopOpacity=".07" /></linearGradient>
        <linearGradient id="auth-ribbon-edge" x1="190" y1="96" x2="429" y2="336" gradientUnits="userSpaceOnUse"><stop stopColor="#ffffff" stopOpacity=".03" /><stop offset=".35" stopColor="#bcb8c7" stopOpacity=".25" /><stop offset=".66" stopColor="#ff4059" stopOpacity=".8" /><stop offset="1" stopColor="#ff4059" stopOpacity=".025" /></linearGradient>
        <linearGradient id="auth-ruby-line" x1="130" y1="265" x2="486" y2="192" gradientUnits="userSpaceOnUse"><stop stopColor="#ff4059" stopOpacity="0" /><stop offset=".52" stopColor="#ff4059" stopOpacity=".8" /><stop offset="1" stopColor="#ff7588" stopOpacity=".05" /></linearGradient>
        <radialGradient id="auth-halo-fill"><stop stopColor="#28252c" stopOpacity=".7" /><stop offset=".75" stopColor="#151317" stopOpacity=".15" /><stop offset="1" stopColor="#17141a" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="310" cy="222" rx="174" ry="158" fill="url(#auth-halo-fill)" />
      <ellipse cx="310" cy="222" rx="210" ry="158" transform="rotate(-27 310 222)" stroke="#ffffff" strokeOpacity=".055" strokeWidth=".7" />
      <ellipse cx="310" cy="222" rx="164" ry="119" transform="rotate(-27 310 222)" stroke="#ffffff" strokeOpacity=".025" strokeWidth=".7" />
      <path d="M126 244C132 160 263 86 379 107C488 126 538 197 479 258C433 306 336 331 271 302C215 277 216 204 277 174C329 148 392 160 406 199C424 251 348 320 253 339C162 357 120 318 126 244Z" fill="url(#auth-ribbon-glass)" stroke="url(#auth-ribbon-edge)" strokeWidth="1.15" />
      <path d="M141 255C143 177 266 109 371 125C462 139 503 194 465 239C425 285 342 310 288 288C247 270 244 221 291 196C333 174 375 181 384 209C396 247 333 303 252 319C174 335 134 314 141 255Z" stroke="#ffffff" strokeOpacity=".035" strokeWidth=".8" />
      <path d="M112 276C184 364 347 335 428 271C493 220 493 172 453 143" stroke="url(#auth-ruby-line)" strokeWidth="1.1" />
      <path d="M130 259C141 179 262 98 374 114" stroke="#ddd7e8" strokeOpacity=".12" strokeWidth=".6" />
    </motion.svg>
    <motion.div className="auth-art-symbol auth-art-image" animate={reducedMotion ? {} : { y: [0, -5, 0] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}><ImagePlus size={17} strokeWidth={1.3} /></motion.div>
    <motion.div className="auth-art-symbol auth-art-audio" animate={reducedMotion ? {} : { y: [0, 5, 0] }} transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}><AudioLines size={18} strokeWidth={1.3} /></motion.div>
    <span className="auth-art-orbit-point" />
  </div>;
}

function AuthInformation({ kind, onClose }: { kind: 'about' | 'terms'; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button, a[href]') || []);
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    document.addEventListener('keydown', keyHandler);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keyHandler); previous?.focus(); };
  }, [onClose]);
  return <motion.div className="auth-info-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
    <motion.section ref={ref} role="dialog" aria-modal="true" aria-label={kind === 'about' ? 'Conheça a Velora' : 'Privacidade no seu espaço'} className="auth-info-modal" initial={{ opacity: 0, y: 20, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }} onClick={event => event.stopPropagation()}>
      <button className="auth-info-close" onClick={onClose} aria-label="Fechar"><X size={19} /></button><div className="auth-info-icon">{kind === 'about' ? <Sparkles size={24} /> : <ShieldCheck size={24} />}</div>
      <span className="auth-eyebrow">{kind === 'about' ? 'UM NOVO ESPAÇO CRIATIVO' : 'TRANSPARÊNCIA DESDE O INÍCIO'}</span>
      <h2>{kind === 'about' ? 'Suas ideias, com mais presença.' : 'Seu acesso. Seus projetos.'}</h2>
      {kind === 'about' ? <><p>A Velora reúne imagem, voz e ambientes em um estúdio intuitivo. Um lugar para experimentar, organizar referências e encontrar seu próximo caminho criativo.</p><ul><li><ImagePlus size={17} />Estúdio visual com ajustes e referências.</li><li><AudioLines size={17} />Vozes e atmosferas no mesmo fluxo.</li><li><UserRound size={17} />Perfis e biblioteca no seu workspace.</li></ul><p className="auth-info-note">Entre na sua conta para acessar as ferramentas e os seus projetos.</p></> : <><p>Seu nome, e-mail e senha são enviados ao serviço de autenticação Supabase para criar ou acessar sua conta.</p><ul><li><Check size={16} />A senha não é salva pelo formulário.</li><li><Check size={16} />A sessão permite restaurar seu acesso neste navegador.</li><li><Check size={16} />Projetos e arquivos locais ficam separados por conta.</li></ul><p className="auth-info-note">Use um navegador confiável. Ao terminar em um computador compartilhado, saia da sua conta.</p></>}
      <button className="auth-submit" onClick={onClose}>Entendi<Check size={16} /></button>
    </motion.section>
  </motion.div>;
}

export function AuthPage({ onEnter, onBack, initialMode = 'login', onModeChange }: AuthPageProps) {
  const reducedMotion = useReducedMotionConfig();
  const reveal = { hidden: { opacity: 0, y: reducedMotion ? 0 : 14 }, visible: { opacity: 1, y: 0, transition: { duration: reducedMotion ? .2 : .65 } } };
  const auth = useAuth();
  const [tab, setTab] = useState<'login' | 'signup'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [information, setInformation] = useState<'about' | 'terms' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const closeInfoRef = useRef(() => setInformation(null));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setTab(initialMode); setError(''); setPassword(''); setVisible(false); }, [initialMode]);
  const changeMode = (mode: 'login' | 'signup') => { if(submitting)return; setTab(mode); setError(''); setPassword(''); setVisible(false); onModeChange?.(mode); };
  const submit = async () => {
    if (submitting || auth.loading) return;
    setError(''); setSubmitting(true);
    try {
      if (tab === 'signup') await auth.signUp(name, email, password);
      else await auth.signIn(email, password);
      if (mounted.current) { setPassword(''); setVisible(false); }
      onEnter();
    } catch (failure) { if (mounted.current) setError(authErrorMessage(failure)); }
    finally { if (mounted.current) setSubmitting(false); }
  };
  const busy = submitting || auth.loading;
  const notice = error || auth.error || (!auth.configured ? getAuthConfiguration().error : null);
  return <div className="auth-page">
    <header className="auth-header"><motion.button className="auth-brand" aria-label="Página inicial da Velora" disabled={submitting} onClick={onBack} whileHover={{ opacity: .8 }} whileTap={{ scale: .98 }}><span className="auth-brand-mark">v<span>.</span></span><strong>velora<span>.</span></strong><small>STUDIO</small></motion.button><motion.button className="auth-explore-link" disabled={submitting} onClick={onBack} whileHover={{ x: -3 }} whileTap={{ scale: .98 }}><ArrowLeft size={15} />Voltar ao início</motion.button></header>
    <main className="auth-main">
      <motion.section className="auth-visual" initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: reducedMotion ? 0 : .1 } } }}>
        <motion.span className="auth-visual-tag" variants={reveal}>IMAGINE. EXPERIMENTE. CRIE.</motion.span>
        <motion.div className="auth-art-container" variants={reveal}><AuthArtwork /></motion.div>
        <motion.div className="auth-visual-copy" variants={reveal}><h1>Seu próximo universo<br /><span>começa com uma ideia.</span></h1><p>Transforme imagens. Dê voz às histórias.<br />Crie algo que só você poderia imaginar.</p><div className="auth-visual-features"><span><ImagePlus size={13} />Imagem</span><span><AudioLines size={14} />Áudio</span><span><Sparkles size={13} />Identidade</span></div></motion.div>
        <div className="auth-visual-footer"><span>ORIGINAL POR NATUREZA.</span><span>VELORA STUDIO</span></div>
      </motion.section>
      <motion.section className="auth-form-panel" initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: reducedMotion ? 0 : .08, delayChildren: reducedMotion ? 0 : .15 } } }}>
        <div className="auth-form-inner"><motion.div className="auth-form-topline" variants={reveal}><span className="auth-eyebrow"><i /> SEU ESPAÇO CRIATIVO</span><span className="auth-account-pill">SUA CONTA</span></motion.div><motion.h2 variants={reveal}>{tab === 'login' ? <>Bom ter você<br />por aqui<span>.</span></> : <>Uma nova ideia.<br />Um novo começo<span>.</span></>}</motion.h2><motion.p className="auth-form-description" variants={reveal}>{tab === 'login' ? 'Entre no ritmo da sua próxima criação.' : 'Crie sua conta e abra o seu espaço criativo.'}</motion.p>
          <motion.div className="auth-tabs" role="tablist" aria-label="Forma de acesso" variants={reveal}>{(['login', 'signup'] as const).map(mode => <button key={mode} id={`auth-${mode}-tab`} role="tab" aria-selected={tab === mode} aria-controls="auth-form" disabled={busy} className={tab === mode ? 'active' : ''} onClick={() => changeMode(mode)}>{tab === mode && <motion.i className="auth-tab-highlight" layoutId="auth-tab-highlight" transition={{ type: 'spring', stiffness: 380, damping: 34 }} />}<span>{mode === 'login' ? 'Entrar' : 'Criar conta'}</span></button>)}</motion.div>
          <motion.form id="auth-form" variants={reveal} role="tabpanel" aria-labelledby={tab === 'login' ? 'auth-login-tab' : 'auth-signup-tab'} onSubmit={event => { event.preventDefault(); void submit(); }}>
            <AnimatePresence initial={false}>{tab === 'signup' && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .24 }} className="auth-name-wrap"><label htmlFor="auth-name">Seu nome</label><div className="auth-input"><UserRound size={17} /><input id="auth-name" name="name" type="text" autoComplete="name" placeholder="Como podemos chamar você?" minLength={2} maxLength={60} value={name} disabled={busy} onChange={event => setName(event.target.value)} required={tab === 'signup'} /></div></motion.div>}</AnimatePresence>
            <label htmlFor="auth-email">E-mail</label><div className="auth-input"><Mail size={17} /><input id="auth-email" name="email" type="email" autoComplete="email" placeholder="voce@exemplo.com" maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} required /></div>
            <div className="auth-password-label"><label htmlFor="auth-password">Senha</label><span id="auth-password-help">Mínimo de 8 caracteres</span></div><div className="auth-input"><LockKeyhole size={16} /><input id="auth-password" name="password" type={visible ? 'text' : 'password'} placeholder={tab === 'login' ? 'Sua senha' : 'Crie uma senha segura'} value={password} minLength={8} maxLength={128} disabled={busy} aria-describedby="auth-password-help" onChange={event => setPassword(event.target.value)} required autoComplete={tab === 'login' ? 'current-password' : 'new-password'} /><button type="button" className="auth-visibility" disabled={busy} aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={visible} onClick={() => setVisible(current => !current)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            {tab === 'signup' && password && <div className={`auth-password-check ${password.length >= 8 ? 'valid' : ''}`}><Check size={12} />{password.length >= 8 ? 'Senha com o tamanho necessário.' : `Faltam ${8 - password.length} caracteres.`}</div>}
            {notice && <div className="auth-error" role="alert">{notice}{auth.error && !submitting && <button type="button" onClick={auth.retry}>Tentar restaurar o acesso</button>}</div>}
            <motion.button type="submit" className="auth-submit" disabled={busy || !auth.configured} aria-busy={busy} whileHover={busy ? undefined : { y: -2 }} whileTap={busy ? undefined : { scale: .985 }}>{busy ? <><LoaderCircle className="auth-spinner" size={17} />{submitting ? (tab === 'signup' ? 'Criando sua conta…' : 'Entrando…') : 'Restaurando acesso…'}</> : <>{tab === 'signup' ? 'Criar minha conta' : 'Entrar no estúdio'}<ArrowRight size={17} /></>}</motion.button>
          </motion.form>
          <motion.div className="auth-privacy-note" variants={reveal}><ShieldCheck size={15} /><p>Seu acesso é protegido. Seus projetos locais ficam separados por conta neste navegador.</p></motion.div>
        </div>
      </motion.section>
    </main>
    <footer className="auth-footer"><span>Um espaço para ideias que merecem existir.</span><div><button onClick={() => setInformation('about')}>Sobre a Velora</button><span>·</span><button onClick={() => setInformation('terms')}>Sobre seu acesso</button><span className="auth-footer-copyright">© 2026 Velora</span></div></footer>
    <AnimatePresence>{information && <AuthInformation kind={information} onClose={closeInfoRef.current} />}</AnimatePresence>
  </div>;
}

export default AuthPage;
