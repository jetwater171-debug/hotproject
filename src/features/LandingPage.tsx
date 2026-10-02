import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, AudioLines, Check, ChevronDown, ImagePlus, Mic2, SlidersHorizontal } from 'lucide-react';
import EnvironmentEmoji from '../components/EnvironmentEmoji';
import SpotlightCard from '../components/reactbits/SpotlightCard';
import Magnet from '../components/reactbits/Magnet';
import AnimatedContent from '../components/reactbits/AnimatedContent';
import { environmentCategories, environments, getEnvironment } from '../audio/environments';
import './landing-page.css';

export interface LandingPageProps {
  onLogin: () => void;
  onSignup: () => void;
  reducedMotion?: boolean;
}

const shortcuts = ['rain', 'bathroom', 'street', 'forest'];
const features = [
  { icon: Mic2, title: 'Comece pela sua voz.', text: 'Escreva um roteiro ou grave a interpretação que você quer ouvir.' },
  { icon: SlidersHorizontal, title: 'Encontre a atmosfera.', text: 'Combine voz e ambiente. Ajuste a captura, a presença e o fundo.' },
  { icon: ImagePlus, title: 'Crie no mesmo espaço.', text: 'Edite suas fotos, organize referências e retome seus projetos.' },
];

export default function LandingPage({ onLogin, onSignup, reducedMotion = false }: LandingPageProps) {
  const systemReducedMotion = useReducedMotion();
  const reduce = Boolean(reducedMotion || systemReducedMotion);
  const [environmentId, setEnvironmentId] = useState('rain');
  const [blend, setBlend] = useState(getEnvironment('rain').sound.defaultVolume);
  const [visible, setVisible] = useState(true);
  const pageRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const uniqueId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const environment = getEnvironment(environmentId);
  const silent = environment.sound.mode === 'silent';
  const rainy = ['rain', 'storm'].includes(environment.synth) || environment.id === 'shower';
  const selectEnvironment = (id: string) => {
    const next = getEnvironment(id);
    setEnvironmentId(next.id);
    setBlend(next.sound.mode === 'silent' ? 0 : next.sound.defaultVolume);
  };

  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    update();
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  const enter = reduce ? false : { opacity: 0, y: 14 };
  const style = { '--lp-play': visible && !reduce ? 'running' : 'paused', '--lp-blend': `${blend}%`, '--lp-glow': silent ? .28 : .28 + blend * .006, '--lp-rain-level': .07 + blend * .004 } as CSSProperties;

  return <div ref={pageRef} className={`velora-landing ${reduce ? 'lp-reduced' : ''}`} style={style}>
    <button className="lp-skip" onClick={() => { mainRef.current?.focus(); mainRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); }}>Pular para o conteúdo</button>
    <div className="lp-background" aria-hidden="true">
      <svg viewBox="0 0 1440 700" preserveAspectRatio="xMidYMin slice"><defs><linearGradient id={`${uniqueId}-line`}><stop stopColor="#ff4059" stopOpacity="0" /><stop offset=".55" stopColor="#ff4059" stopOpacity=".23" /><stop offset="1" stopColor="#ff4059" stopOpacity="0" /></linearGradient></defs><path d="M-150 685C125 100 602-111 968 158C1290 396 1353 170 1590 37" fill="none" stroke={`url(#${uniqueId}-line)`} /><path d="M-100 750C210 180 634-26 977 226C1240 419 1394 316 1510 181" fill="none" stroke={`url(#${uniqueId}-line)`} strokeOpacity=".45" /></svg>
    </div>
    <header className="lp-header">
      <button className="lp-brand" aria-label="Velora, início" onClick={() => window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })}><span className="lp-brand-mark" aria-hidden="true">v<span>.</span></span><strong>velora<span>.</span></strong></button>
      <nav className="lp-header-actions" aria-label="Acessar Velora"><button className="lp-login" onClick={onLogin}>Entrar</button><button className="lp-button lp-button-small" onClick={onSignup}>Criar conta<ArrowRight size={14} /></button></nav>
    </header>
    <main ref={mainRef} tabIndex={-1} className="lp-main" id="landing-content">
      <section className="lp-hero" aria-labelledby="lp-title">
        <motion.div className="lp-hero-copy" initial={enter} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65, ease: [.16, 1, .3, 1] }}>
          <span className="lp-kicker"><i />Um estúdio para as suas ideias</span>
          <h1 id="lp-title">Dê voz à sua ideia.<br /><span>Escolha o lugar.</span></h1>
          <p>Escreva ou grave sua interpretação, combine com um ambiente e deixe o áudio com a sua cara.</p>
          <div className="lp-hero-actions"><Magnet padding={12} magnetStrength={12} disabled={reduce}><button className="lp-button" onClick={onSignup}>Criar minha conta<ArrowRight size={17} /></button></Magnet><button className="lp-hero-login" onClick={onLogin}>Já tenho conta<ArrowRight size={14} /></button></div>
          <div className="lp-hero-detail"><span><AudioLines size={14} />Voz e ambiente</span><i /><span><ImagePlus size={14} />Imagem e referências</span></div>
        </motion.div>
        <motion.div className="lp-preview-wrap" initial={enter} animate={{ opacity: 1, y: 0 }} transition={{ duration: .75, delay: reduce ? 0 : .1, ease: [.16, 1, .3, 1] }}>
          <SpotlightCard className="lp-studio" spotlightColor="rgba(255, 64, 89, 0.1)">
            <div className="lp-studio-header"><span><AudioLines size={15} />Estúdio de áudio</span><small>Prévia visual</small></div>
            <div className="lp-studio-script"><span>Seu roteiro</span><p>“Oi, tô saindo agora. Me espera só mais um pouquinho, tá?”</p><div className="lp-script-tags"><span>Voz natural</span><span>Português</span></div></div>
            <div className={`lp-scene lp-scene-${environment.category} ${rainy ? 'lp-rainy' : ''}`} aria-hidden="true">
              <svg className="lp-scene-lines" viewBox="0 0 360 150"><path d="M35 133L92 84H268L325 133M92 84V16M268 84V16M92 16H268M180 84V133" /><path d="M15 135H345M73 105H287M57 119H303" /></svg>
              {rainy && <div className="lp-rain-lines">{Array.from({ length: 13 }, (_, index) => <i key={index} style={{ left: `${12 + index * 6.4}%`, animationDelay: `${index * -.21}s` }} />)}</div>}
              <div className="lp-scene-glyph"><EnvironmentEmoji environment={environment.id} size={83} /></div><div className="lp-scene-glow" />
              <div className="lp-scene-label"><span>{environment.name}</span><small>{silent ? 'Reflexos do espaço' : environmentCategories.find(item => item.id === environment.category)?.label}</small></div>
            </div>
            <div className="lp-atmosphere-heading"><strong>Qual é a atmosfera?</strong><span>{environments.length} lugares</span></div>
            <div className="lp-shortcuts" role="group" aria-label="Explorar ambientes populares">{shortcuts.map(id => { const item = getEnvironment(id); return <button key={id} aria-pressed={id === environment.id} className={id === environment.id ? 'active' : ''} onClick={() => selectEnvironment(id)}><EnvironmentEmoji environment={id} size={27} /><span>{item.name}</span>{id === environment.id && <Check size={10} />}</button>; })}</div>
            <div className="lp-environment-select"><label htmlFor={`lp-environment-${uniqueId}`}>Explore todos os lugares</label><div><select id={`lp-environment-${uniqueId}`} value={environmentId} onChange={event => selectEnvironment(event.target.value)}>{environmentCategories.filter(item => item.id !== 'all').map(category => <optgroup key={category.id} label={category.label}>{environments.filter(item => item.category === category.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select><ChevronDown size={13} aria-hidden="true" /></div></div>
            <div className={`lp-blend ${silent ? 'is-silent' : ''}`}><label htmlFor={`lp-blend-${uniqueId}`}>Fundo<span>{silent ? 'Sem fundo' : `${blend}%`}</span></label><input id={`lp-blend-${uniqueId}`} type="range" min="0" max="100" value={blend} disabled={silent} onChange={event => setBlend(Number(event.target.value))} aria-label="Explorar intensidade do fundo na prévia visual" /></div>
            <p className="lp-preview-note" aria-live="polite">{environment.name} · prévia visual. Entre para criar e ouvir.</p>
          </SpotlightCard>
        </motion.div>
      </section>
      <AnimatedContent disabled={reduce} distance={12} duration={.5} threshold={.04} initialOpacity={.35}>
        <section className="lp-benefits" aria-label="Seu processo em um só lugar">{features.map(({ icon: Icon, title, text }) => <article key={title}><span className="lp-feature-icon"><Icon size={19} strokeWidth={1.6} /></span><div><h2>{title}</h2><p>{text}</p></div></article>)}</section>
      </AnimatedContent>
      <section className="lp-final" aria-label="Começar a criar"><div><h2>Sua próxima ideia começa aqui.</h2><p>Um espaço para experimentar e deixar tudo com a sua cara.</p></div><button className="lp-button" onClick={onSignup}>Criar conta<ArrowRight size={16} /></button></section>
    </main>
    <footer className="lp-footer"><span>velora<span>.</span></span><p>Um espaço para suas ideias.</p><button onClick={onLogin}>Entrar<ArrowRight size={12} /></button></footer>
  </div>;
}
