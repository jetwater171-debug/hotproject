import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, AudioLines, Check, ChevronRight, FolderOpen, ImagePlus, Layers, Mic2, Plus, Sparkles, Users } from 'lucide-react';
import SpotlightCard from '../components/reactbits/SpotlightCard';
import Magnet from '../components/reactbits/Magnet';
import AnimatedContent from '../components/reactbits/AnimatedContent';
import { DimensionsVisual, StudioScene, type SceneKind } from '../components/StudioVisual';
import { inspirations } from '../data';
import type { Asset } from './SecondaryPages';

type Inspiration=typeof inspirations[number];
interface Props {
  assets:Asset[];
  reducedMotion?:boolean;
  onNavigate:(page:string)=>void;
  onOpenAsset:(asset:Asset)=>void;
  onChooseInspiration:(item:Inspiration)=>void;
  onStartImage:(prompt:string)=>void;
  onStartAudio:(text:string,environment?:string)=>void;
  onHelp:()=>void;
}
export const inspirationScenes:SceneKind[]=['golden','space','image','cinema','identity'];

export default function Dashboard({assets,reducedMotion,onNavigate,onOpenAsset,onChooseInspiration,onStartImage,onStartAudio,onHelp}:Props) {
  const [mode,setMode]=useState<'image'|'audio'>('image');
  const [idea,setIdea]=useState('');
  const start=()=> mode==='image'?onStartImage(idea):onStartAudio(idea);
  return <div className="clean-dashboard">
    <div className="welcome-row"><div><span className="eyebrow"><i/> SEU ESTÚDIO CRIATIVO</span><h1>Um espaço. Infinitas ideias<span className="red-dot">.</span></h1></div><span className="demo-badge"><span/> Conta conectada</span></div>
    <section className="dimension-hero">
      <div className="dimension-hero-light"/><div className="dimension-hero-line"/>
      <div className="dimension-hero-copy"><span className="quiet-label"><Sparkles size={13}/> CRIATIVIDADE EM OUTRA DIMENSÃO</span>
        <h2>{['Uma ideia.','Novas dimensões.'].map((line,i)=><span className="hero-line-mask" key={line}><motion.span initial={reducedMotion?false:{y:'105%',opacity:0}} animate={{y:0,opacity:1}} transition={{duration:.75,delay:.08+i*.1,ease:[.16,1,.3,1]}} className={i===1?'hero-soft-text':''}>{line}</motion.span></span>)}</h2>
        <p>Transforme imagens. Dê voz às histórias.<br/>Crie atmosferas que fazem sentir.</p>
        <div className="dimension-hero-actions"><Magnet padding={18} magnetStrength={9} disabled={Boolean(reducedMotion)}><button className="btn btn-primary" onClick={()=>onNavigate('images')}>Criar imagem <ArrowRight size={16}/></button></Magnet><button className="hero-audio-link" onClick={()=>onNavigate('audio')}><AudioLines size={17}/> Criar áudio <ChevronRight size={13}/></button></div>
      </div>
      <div className="dimension-hero-art"><DimensionsVisual reducedMotion={reducedMotion}/></div>
      <span className="dimension-hero-signature">VELORA STUDIO <i/> IMAGINE ALÉM</span>
    </section>

    <section className="create-dock" aria-label="Comece pela sua ideia">
      <div className="create-dock-tabs" role="group" aria-label="Tipo de criação">{([['image','Imagem',ImagePlus],['audio','Áudio',AudioLines]] as const).map(([id,label,Icon])=><button key={id} aria-pressed={mode===id} className={mode===id?'active':''} onClick={()=>setMode(id)}>{mode===id&&<motion.span layoutId="composer-tab" transition={{type:'spring',stiffness:420,damping:34}}/>}<Icon size={15}/>{label}</button>)}</div>
      <form onSubmit={e=>{e.preventDefault();start()}}><input aria-label={mode==='image'?'Descreva sua ideia de imagem':'Escreva sua ideia de áudio'} placeholder={mode==='image'?'Uma luz, um cenário, uma nova ideia…':'Uma mensagem, uma história, seu próximo áudio…'} value={idea} onChange={e=>setIdea(e.target.value)} maxLength={1800}/><button className="dock-submit" type="submit" aria-label={mode==='image'?'Começar imagem com esta ideia':'Começar áudio com esta ideia'}><ArrowRight size={19}/></button></form>
    </section>

    <section className="workflows-section"><div className="section-heading"><h2>O que vamos criar?</h2><span>ESCOLHA SEU CAMINHO</span></div><div className="workflow-grid">
      <SpotlightCard className="workflow-card" spotlightColor="rgba(255, 64, 89, 0.09)"><button className="workflow-button" onClick={()=>onNavigate('images')}><div className="workflow-copy"><span className="workflow-icon"><ImagePlus size={20} strokeWidth={1.5}/></span><h3>Estúdio de imagem</h3><p>Nova luz. Outro cenário.<br/>Sua imagem, do seu jeito.</p><span className="workflow-cta">Abrir estúdio <ArrowRight size={15}/></span></div><div className="workflow-art"><StudioScene kind="image"/></div></button></SpotlightCard>
      <SpotlightCard className="workflow-card" spotlightColor="rgba(255, 64, 89, 0.09)"><button className="workflow-button" onClick={()=>onNavigate('audio')}><div className="workflow-copy"><span className="workflow-icon"><AudioLines size={21} strokeWidth={1.5}/></span><h3>Estúdio de áudio</h3><p>Uma voz. O ambiente certo.<br/>Presença em cada detalhe.</p><span className="workflow-cta">Abrir estúdio <ArrowRight size={15}/></span></div><div className="workflow-art"><StudioScene kind="audio"/></div></button></SpotlightCard>
      <SpotlightCard className="workflow-card identity-card" spotlightColor="rgba(255, 64, 89, 0.08)"><button className="workflow-button" onClick={()=>onNavigate('profiles')}><div className="workflow-copy"><span className="workflow-icon"><Users size={19} strokeWidth={1.5}/></span><h3>Sua identidade</h3><p>Referências e direção.<br/>Sempre à mão.</p><span className="workflow-cta">Seus perfis <ArrowRight size={15}/></span></div><div className="workflow-art"><StudioScene kind="identity"/></div></button></SpotlightCard>
    </div></section>

    <AnimatedContent disabled={reducedMotion} distance={16} duration={.65} threshold={.04} initialOpacity={.15}><section className="directions-section"><div className="section-heading"><div><h2>Uma ideia para começar</h2><p className="muted">Escolha uma direção. Dê seu toque.</p></div><span className="directions-count">05 DIREÇÕES</span></div><div className="directions-grid">{inspirations.map((item,i)=><button className="direction-card" key={item.title} onClick={()=>onChooseInspiration(item)}><div className="direction-art"><StudioScene kind={inspirationScenes[i]}/><span className="direction-number">0{i+1}</span></div><div className="direction-copy"><span>{item.category}</span><h3>{item.title}</h3><ArrowRight size={15}/></div></button>)}</div></section></AnimatedContent>

    <div className="dashboard-bottom-grid"><section className="recent-section"><div className="section-heading"><h2>Continue de onde parou</h2><button className="text-button" onClick={()=>onNavigate('library')}>Biblioteca <ArrowRight size={14}/></button></div><div className="clean-recent-list">{assets.slice(0,3).map(asset=><button key={asset.id} className="clean-recent-item" onClick={()=>onOpenAsset(asset)}><span className={`recent-glyph ${asset.type}`}>{asset.type==='image'?<ImagePlus size={17}/>:<AudioLines size={17}/>}</span><div><strong>{asset.title}</strong><small>{asset.type==='image'?'Imagem':'Áudio'} <i/> {asset.subtitle}</small></div><ArrowRight size={14}/></button>)}{assets.length===0&&<div className="clean-empty"><FolderOpen size={22}/><p>Seu próximo projeto começa no estúdio.</p><button className="text-button" onClick={()=>onNavigate('images')}>Começar <Plus size={14}/></button></div>}</div></section>
      <section className="atmospheres-section"><div className="section-heading"><h2>Qual é a atmosfera?</h2><span><Mic2 size={15}/></span></div><p>Um lugar muda toda a história.</p><div className="atmosphere-shortcuts">{[['rain','Chuva','01'],['bathroom','Banheiro','02'],['street','Rua','03']].map(([env,label,num])=><button key={env} onClick={()=>onStartAudio('',env)}><span>{num}</span>{label}<ArrowRight size={13}/></button>)}</div><span className="atmosphere-hint"><Check size={12}/> Voz e ambiente no mesmo estúdio</span></section></div>
    <footer className="dashboard-footer"><span><span className="footer-logo">v.</span> Um espaço para ir além.</span><button onClick={onHelp}>Conheça seu estúdio <ArrowRight size={13}/></button></footer>
  </div>;
}
