import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'motion/react';
import { ArrowRight, AudioLines, Bell, BookOpen, Check, CircleHelp, Command, CreditCard, FolderOpen, Headphones, Home, ImagePlus, LogOut, Menu, Search, Settings, Sparkles, Users, X, Zap } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { authErrorMessage } from './auth/errors';
import { getUserDisplayName } from './auth/service';
import { getStorageOwner } from './auth/storage-owner';
import { isWorkspaceRoute, resolveAppRoute, type AppRoute, type WorkspaceRoute } from './auth/routes';
import './auth/auth-state.css';
import Dashboard, { inspirationScenes } from './features/Dashboard';
import { StudioScene } from './components/StudioVisual';
import type { Asset } from './features/SecondaryPages';
import type { AudioProject } from './features/AudioStudio';
import { deleteAudioFile } from './audio/audio-storage';
import { inspirations, photos, readLocal, writeLocal } from './data';

const AudioStudio = lazy(()=>import('./features/AudioStudio'));
const ImageStudio = lazy(()=>import('./features/ImageStudio'));
const LibraryPage = lazy(()=>import('./features/SecondaryPages').then(m=>({default:m.LibraryPage})));
const PlansPage = lazy(()=>import('./features/SecondaryPages').then(m=>({default:m.PlansPage})));
const ProfilesPage = lazy(()=>import('./features/SecondaryPages').then(m=>({default:m.ProfilesPage})));
const SettingsPage = lazy(()=>import('./features/SecondaryPages').then(m=>({default:m.SettingsPage})));
const AuthPage = lazy(()=>import('./features/AuthPage'));
const LandingPage = lazy(()=>import('./features/LandingPage'));

const navigation = [
  { id: 'home', label: 'Visão geral', description: 'Seu espaço criativo', icon: Home },
  { id: 'images', label: 'Estúdio de imagem', description: 'Transforme suas imagens', icon: ImagePlus },
  { id: 'audio', label: 'Estúdio de áudio', description: 'Dê voz às suas ideias', icon: AudioLines },
  { id: 'library', label: 'Biblioteca', description: 'Tudo que você criou', icon: FolderOpen },
  { id: 'profiles', label: 'Perfis', description: 'Sua identidade, sempre à mão', icon: Users },
];
export default function App() {
  return <AuthProvider><AppRoutes/></AuthProvider>;
}

function SessionLoading({signingOut=false}:{signingOut?:boolean}) {
  return <main className="auth-session-screen" role="status" aria-live="polite"><div className="auth-session-card"><span className="auth-session-brand" aria-hidden="true">v.</span><h1>{signingOut?'Saindo da sua conta…':'Preparando seu espaço…'}</h1><p>{signingOut?'Encerrando o acesso neste navegador.':'Restaurando sua sessão com segurança.'}</p><div className="auth-session-progress"><span/></div></div></main>;
}

function AppRoutes() {
  const auth = useAuth();
  const [page,setPage] = useState<AppRoute>(()=>resolveAppRoute(location));
  const [returnTo,setReturnTo] = useState<WorkspaceRoute>(()=>isWorkspaceRoute(resolveAppRoute(location))?resolveAppRoute(location) as WorkspaceRoute:'home');
  const [signingOut,setSigningOut] = useState(false);
  const navigate = (route:AppRoute, replace=false) => {
    const hash=route==='landing'?'#/':`#/${route}`;
    if(replace)history.replaceState(null,'',`${location.pathname}${location.search}${hash}`);else location.hash=hash;
    setPage(route);window.scrollTo({top:0,behavior:'instant'});
  };
  useEffect(()=>{const update=()=>setPage(resolveAppRoute(location));window.addEventListener('hashchange',update);window.addEventListener('popstate',update);return()=>{window.removeEventListener('hashchange',update);window.removeEventListener('popstate',update);};},[]);
  useEffect(()=>{
    if(auth.loading)return;
    if(isWorkspaceRoute(page)&&!auth.user){setReturnTo(page);navigate('login',true);}
    else if((page==='login'||page==='signup')&&auth.user)navigate(returnTo,true);
  },[page,auth.loading,auth.user?.id]);
  useEffect(()=>{if(page==='landing')document.title='Velora · Seu espaço criativo';else if(page==='login'||page==='signup')document.title=`${page==='signup'?'Criar conta':'Entrar'} · Velora`;},[page]);
  const openAuth=(mode:'login'|'signup')=>{setReturnTo('home');navigate(auth.user?'home':mode);};
  const exit = async () => {
    setSigningOut(true);
    try { await auth.signOut();navigate('landing',true); }
    finally { setSigningOut(false); }
  };
  const fallback=<SessionLoading signingOut={signingOut}/>;
  if(signingOut||(isWorkspaceRoute(page)&&auth.loading))return fallback;
  if(page==='landing')return <MotionConfig reducedMotion="user"><Suspense fallback={fallback}><LandingPage onLogin={()=>openAuth('login')} onSignup={()=>openAuth('signup')}/></Suspense></MotionConfig>;
  if(!auth.user||page==='login'||page==='signup')return <MotionConfig reducedMotion="user"><Suspense fallback={fallback}><AuthPage initialMode={page==='signup'?'signup':'login'} onBack={()=>navigate('landing')} onModeChange={mode=>navigate(mode)} onEnter={()=>navigate(returnTo,true)}/></Suspense></MotionConfig>;
  if(!isWorkspaceRoute(page))return fallback;
  return <Workspace key={auth.user.id} page={page} user={auth.user} onNavigate={navigate} onSignOut={exit}/>;
}

function Workspace({page,user,onNavigate,onSignOut}:{page:WorkspaceRoute;user:User;onNavigate:(route:AppRoute)=>void;onSignOut:()=>Promise<void>}) {
  const [assets, setAssets] = useState<Asset[]>(() => {
    const saved = readLocal<unknown>('velora-assets', []);
    return Array.isArray(saved) ? saved.filter(a => a && typeof a.id === 'string' && typeof a.title === 'string') as Asset[] : [];
  });
  const assetsRef=useRef(assets);
  assetsRef.current=assets;
  const [toast, setToast] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reference, setReference] = useState<{image:string; prompt:string;title?:string} | undefined>();
  const [audioProject, setAudioProject] = useState<AudioProject | undefined>();
  const [localSettings,setLocalSettings] = useState(()=>readLocal<{name?:string;reducedMotion?:boolean}>('velora:settings',{name:getUserDisplayName(user)}));
  const [selectedInspiration, setSelectedInspiration] = useState<typeof inspirations[number] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = systemReducedMotion || localSettings.reducedMotion;
  const activeName = navigation.find(n => n.id === page)?.label || (page === 'plans' ? 'Planos & créditos' : 'Configurações');
  const profileName=getUserDisplayName(user);
  const notify = (message:string) => { if(getStorageOwner()!==user.id)return;clearTimeout(timer.current); setToast(message); timer.current = setTimeout(() => setToast(''), 4500); };
  const navigate = (id:string, preserveAudioProject=false) => { if(!isWorkspaceRoute(id)||getStorageOwner()!==user.id)return;if(page==='profiles' && id==='images') setReference(undefined); if(id==='audio' && !preserveAudioProject)setAudioProject(undefined);onNavigate(id);setMenuOpen(false); setSearchOpen(false); setProfileOpen(false); setNotificationsOpen(false); };
  const logout=()=>{setProfileOpen(false);void onSignOut().catch(error=>notify(authErrorMessage(error)));};
  const saveAsset = (asset: Omit<Asset, 'id'|'createdAt'>) => {
    if(getStorageOwner()!==user.id)return false;
    const next = [{ ...asset, id: crypto.randomUUID(), createdAt: new Date().toISOString() }, ...assetsRef.current];
    if (writeLocal('velora-assets', next)) { assetsRef.current=next;setAssets(next); notify('Salvo na sua biblioteca.'); return true; }
    notify('O armazenamento está cheio. Baixe o arquivo para guardar esta criação.'); return false;
  };
  useEffect(() => {
    const shortcut = (e:KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setHelpOpen(false); setSelectedInspiration(null); setSearchOpen(v => !v); }
      if (e.key === 'Escape') { setSearchOpen(false); setHelpOpen(false); setNotificationsOpen(false); setProfileOpen(false); setSelectedInspiration(null); setMenuOpen(false); }
    };
    window.addEventListener('keydown', shortcut);
    return () => { window.removeEventListener('keydown',shortcut); clearTimeout(timer.current); };
  }, []);
  useEffect(() => { document.title = `${activeName} · Velora`; }, [activeName]);
  useEffect(()=>{
    const settings=(e:Event)=>setLocalSettings((e as CustomEvent).detail);
    window.addEventListener('velora-settings',settings);
    document.documentElement.dataset.reduceMotion=localSettings.reducedMotion?'true':'false';
    return()=>window.removeEventListener('velora-settings',settings);
  },[localSettings]);
  const overlayOpen = searchOpen || helpOpen || selectedInspiration;
  useEffect(() => {
    if (!overlayOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = document.querySelector<HTMLElement>('.modal [autofocus], .modal input, .modal button'); first?.focus();
    const handler = (e:KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = Array.from(document.querySelectorAll<HTMLElement>('.modal button, .modal input, .modal a, .modal textarea')).filter(el=>!el.hasAttribute('disabled'));
      if (!items.length) return;
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus(); }
      if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
    };
    const oldOverflow = document.body.style.overflow; document.body.style.overflow='hidden';
    document.addEventListener('keydown',handler);
    return () => { document.body.style.overflow=oldOverflow; document.removeEventListener('keydown',handler); previous?.focus(); };
  }, [overlayOpen]);
  const commonProps = {assets, onNotify:notify, onNavigate:navigate, onOpenAsset:(asset:Asset)=>{
    if(asset.type==='image' && asset.image){setReference({image:asset.image,prompt:'',title:asset.title});navigate('images');}
    else {setAudioProject({...asset});navigate('audio',true);}
  }, onDeleteAsset:(id:string) => {
    if(getStorageOwner()!==user.id)return;
    const removed=assetsRef.current.find(a=>a.id===id),next=assetsRef.current.filter(a=>a.id!==id);
    if(writeLocal('velora-assets', next)) {assetsRef.current=next;setAssets(next);if(removed)void Promise.all([removed.audioFileId,removed.voiceFileId,removed.ambienceFileId,removed.guideFileId,removed.impulseFileId].filter((fileId):fileId is string=>Boolean(fileId)).map(fileId=>deleteAudioFile(fileId).catch(()=>{})));}
  }};

  return <MotionConfig reducedMotion={reducedMotion?'always':'user'}><div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={e=>{e.preventDefault();document.getElementById('main-content')?.focus();document.getElementById('main-content')?.scrollIntoView();}}>Ir para o conteúdo</a>
    <header className="topbar">
      <button className="brand" onClick={()=>navigate('home')} aria-label="Velora, início"><span className="brand-mark">v<span>.</span></span><span>velora<span className="brand-dot">.</span></span><span className="studio-word">STUDIO</span></button>
      <div className="topbar-center"><span className="breadcrumb">Workspace <span>/</span> <strong>{activeName}</strong></span></div>
      <div className="topbar-actions">
        <button className="search-trigger" onClick={()=>setSearchOpen(true)} aria-label="Buscar"><Search size={17}/><span>Buscar algo...</span><kbd>⌘ K</kbd></button>
        <button className="credit-pill" onClick={()=>navigate('plans')}><Zap size={14}/><span>Planos</span></button>
        <div className="popover-container"><button className="icon-button notification-trigger" aria-label="Informações da conta" aria-expanded={notificationsOpen} onClick={()=>{setNotificationsOpen(v=>!v);setProfileOpen(false)}}><Bell size={19}/></button>{notificationsOpen && <div className="top-popover"><h3>Seu espaço criativo <Sparkles size={17}/></h3><p>Seus projetos locais ficam associados à sua conta neste navegador. Exporte os arquivos que deseja guardar fora dele.</p><span className="tag">Conta conectada</span></div>}</div>
        <div className="popover-container"><button className="avatar" aria-label="Menu do perfil" aria-expanded={profileOpen} onClick={()=>{setProfileOpen(v=>!v);setNotificationsOpen(false)}}>{profileName[0].toUpperCase()}</button>{profileOpen && <div className="top-popover profile-popover"><strong>{profileName}</strong><span className="muted auth-account-menu-email">{user.email}</span><button onClick={()=>navigate('settings')}><Settings size={17}/> Configurações</button><button onClick={()=>navigate('plans')}><CreditCard size={17}/> Planos & créditos</button><button onClick={logout}><LogOut size={17}/> Sair da conta</button></div>}</div>
        <button className="icon-button mobile-menu" aria-label={menuOpen?'Fechar navegação':'Abrir navegação'} aria-expanded={menuOpen} onClick={()=>setMenuOpen(v=>!v)}>{menuOpen ? <X/> : <Menu/>}</button>
      </div>
    </header>
    {menuOpen && <button className="nav-overlay" aria-label="Fechar navegação" onClick={()=>setMenuOpen(false)}/>}
    <aside className={`sidebar ${menuOpen?'is-open':''}`} aria-label="Navegação principal">
      <div className="sidebar-top">{navigation.map((item,index)=><button key={item.id} aria-label={item.label} aria-current={page===item.id?'page':undefined} className={`nav-item ${page===item.id?'active':''}`} onClick={()=>navigate(item.id)}>
        {page===item.id && <motion.span layoutId="active-nav" className="nav-active-bg" transition={{type:'spring',stiffness:400,damping:34}}/>}
        <item.icon size={21} strokeWidth={1.7}/><span className="mobile-nav-label">{item.label}</span><span className="nav-tooltip"><b>{item.label}</b><small>{item.description}</small></span>
        {index===2 && <span className="sidebar-divider-after"/>}
      </button>)}</div>
      <div className="sidebar-bottom"><button className={`nav-item ${page==='plans'?'active':''}`} aria-label="Planos e créditos" aria-current={page==='plans'?'page':undefined} onClick={()=>navigate('plans')}><Zap size={20}/><span className="mobile-nav-label">Planos & créditos</span><span className="nav-tooltip"><b>Planos & créditos</b><small>Mais espaço para criar</small></span></button><button className={`nav-item ${page==='settings'?'active':''}`} aria-label="Configurações" aria-current={page==='settings'?'page':undefined} onClick={()=>navigate('settings')}><Settings size={20}/><span className="mobile-nav-label">Configurações</span><span className="nav-tooltip"><b>Configurações</b><small>Deixe o estúdio do seu jeito</small></span></button><button className="nav-item access-nav-item" aria-label="Sair da conta" onClick={logout}><LogOut size={20}/><span className="mobile-nav-label">Sair da conta</span><span className="nav-tooltip"><b>Sair da conta</b><small>Encerrar o acesso neste navegador</small></span></button><div className="sidebar-line"/><button className="nav-item" aria-label="Ajuda" onClick={()=>setHelpOpen(true)}><CircleHelp size={20}/><span className="mobile-nav-label">Ajuda</span><span className="nav-tooltip"><b>Precisa de uma mão?</b><small>Conheça seu estúdio</small></span></button></div>
    </aside>
    <main id="main-content" className="main-content" tabIndex={-1}>
      <Suspense fallback={<div className="page-loading"><span/><span/><span/></div>}><AnimatePresence mode="wait"><motion.div key={page} initial={reducedMotion?false:{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={reducedMotion?undefined:{opacity:0,y:-5}} transition={{duration:.2}}>
      {page==='home' && <Dashboard assets={assets} reducedMotion={Boolean(reducedMotion)} onNavigate={navigate} onOpenAsset={commonProps.onOpenAsset} onChooseInspiration={setSelectedInspiration} onHelp={()=>setHelpOpen(true)} onStartImage={prompt=>{const p=readLocal<{image?:string;name?:string}>('velora:active-profile',{});setReference({image:p.image||photos.portrait,prompt,title:p.name||'Minha criação'});navigate('images')}} onStartAudio={(text,environment)=>{setAudioProject({text:text.trim()?text:undefined,environment});navigate('audio',true)}}/>}
      {page==='images' && <ImageStudio reference={reference} onNotify={notify} onSave={saveAsset}/>}
      {page==='audio' && <AudioStudio onNotify={notify} onSave={saveAsset} initialProject={audioProject}/>}
      {page==='library' && <LibraryPage {...commonProps}/>}
      {page==='profiles' && <ProfilesPage {...commonProps}/>}
      {page==='plans' && <PlansPage {...commonProps}/>}
      {page==='settings' && <SettingsPage {...commonProps}/>}
      </motion.div></AnimatePresence></Suspense>
    </main>
    <AnimatePresence>{toast && <motion.div className="toast" role="status" initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} exit={{opacity:0,y:10}}><span><Check size={17}/></span>{toast}<button onClick={()=>setToast('')} aria-label="Fechar aviso"><X size={15}/></button></motion.div>}</AnimatePresence>
    <AnimatePresence>{searchOpen && <motion.div className="modal-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setSearchOpen(false)}><div className="modal search-modal" role="dialog" aria-modal="true" aria-label="Buscar no estúdio" onClick={e=>e.stopPropagation()}><div className="search-modal-input"><Search size={21}/><input autoFocus placeholder="O que você quer criar?" value={query} onChange={e=>setQuery(e.target.value)}/><button className="icon-button" aria-label="Fechar busca" onClick={()=>setSearchOpen(false)}><X size={18}/></button></div><span className="search-section-label">FERRAMENTAS & PÁGINAS</span>{[...navigation,{id:'plans',label:'Planos & créditos',description:'Conheça os planos',icon:CreditCard},{id:'settings',label:'Configurações',description:'Preferências do estúdio',icon:Settings}].filter(n=>`${n.label} ${n.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(n=><button className="search-result" key={n.id} onClick={()=>navigate(n.id)}><n.icon size={19}/><div><strong>{n.label}</strong><span>{n.description}</span></div><ArrowRight size={17}/></button>)}{query && assets.filter(a=>a.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,4).map(a=><button className="search-result" key={a.id} onClick={()=>navigate('library')}><FolderOpen size={19}/><div><strong>{a.title}</strong><span>Na sua biblioteca</span></div><ArrowRight size={17}/></button>)}{query && ![...navigation,{label:'Planos & créditos',description:'Conheça os planos'},{label:'Configurações',description:'Preferências do estúdio'}].some(n=>`${n.label} ${n.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) && !assets.some(a=>a.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <p className="search-empty">Nenhum resultado. Tente “imagem”, “áudio” ou “biblioteca”.</p>}<div className="search-footer"><span><Command size={12}/> K para abrir a busca</span><span>ESC para fechar</span></div></div></motion.div>}</AnimatePresence>
    {helpOpen && <div className="modal-backdrop" onClick={()=>setHelpOpen(false)}><div className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" onClick={()=>setHelpOpen(false)} aria-label="Fechar ajuda"><X size={20}/></button><span className="help-logo">v.</span><span className="eyebrow">BEM-VINDO AO SEU ESTÚDIO</span><h2 id="help-title">Da ideia ao próximo passo.</h2><p className="muted">Crie no seu ritmo. Sua conta reúne as ferramentas e mantém seus projetos separados neste navegador.</p><div className="help-steps"><div><ImagePlus/><span><strong>Experimente uma imagem</strong><small>Envie uma foto e explore seus ajustes.</small></span></div><div><Headphones/><span><strong>Encontre sua atmosfera</strong><small>Crie uma voz e monte o mix de áudio.</small></span></div><div><BookOpen/><span><strong>Guarde suas ideias</strong><small>Exporte suas criações e organize a biblioteca.</small></span></div></div><button className="btn btn-primary" onClick={()=>{setHelpOpen(false);navigate('images')}}>Vamos criar <ArrowRight size={17}/></button></div></div>}
    {selectedInspiration && <div className="modal-backdrop" onClick={()=>setSelectedInspiration(null)}><div className="modal inspiration-modal direction-modal" role="dialog" aria-modal="true" aria-labelledby="inspiration-title" onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" aria-label="Fechar referência" onClick={()=>setSelectedInspiration(null)}><X size={20}/></button><div className="direction-preview-art"><StudioScene kind={inspirationScenes[inspirations.indexOf(selectedInspiration)]}/></div><div><span className="eyebrow">{selectedInspiration.category}</span><h2 id="inspiration-title">{selectedInspiration.title}</h2><p className="muted">{selectedInspiration.prompt}</p><span className="sample-note">Direção de exemplo · personalize no estúdio</span><button className="btn btn-primary" onClick={()=>{setReference({image:selectedInspiration.image,prompt:selectedInspiration.prompt});setSelectedInspiration(null);navigate('images')}}>Usar como ponto de partida <ArrowRight size={17}/></button></div></div></div>}
  </div></MotionConfig>;
}
