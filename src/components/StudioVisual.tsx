import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useMotionValue, useReducedMotionConfig, useSpring, useTransform } from 'motion/react';
import { AudioLines, ImagePlus, Layers, Sparkles } from 'lucide-react';
import './studio-visual.css';

export type SceneKind = 'image' | 'audio' | 'identity' | 'golden' | 'space' | 'cinema';

const localMotionReduced = () => typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion === 'true';

/** Freeze decorative motion while its surface cannot be seen. */
function useVisualActivity(reducedMotion = false) {
  const rootRef = useRef<HTMLDivElement>(null);
  const configuredReduction = useReducedMotionConfig();
  const [localReduction, setLocalReduction] = useState(localMotionReduced);
  const [active, setActive] = useState(false);
  const motionReduced = Boolean(reducedMotion || configuredReduction || localReduction);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let inViewport = false;
    const updateActivity = () => setActive(inViewport && !document.hidden);
    const measure = () => {
      const bounds = root.getBoundingClientRect();
      inViewport = bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
      updateActivity();
    };
    const updateLocalReduction = () => setLocalReduction(localMotionReduced());
    const onVisibilityChange = () => { if (!document.hidden) measure(); else updateActivity(); };
    measure();

    const visibilityObserver = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
      const entry = entries.find(item => item.target === root);
      if (!entry) return;
      inViewport = entry.isIntersecting && entry.intersectionRatio > 0;
      updateActivity();
    }, { threshold: 0 }) : null;
    visibilityObserver?.observe(root);
    const preferenceObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(updateLocalReduction) : null;
    preferenceObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduce-motion'] });
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (!visibilityObserver) { window.addEventListener('scroll', measure, { passive: true }); window.addEventListener('resize', measure, { passive: true }); }
    return () => {
      visibilityObserver?.disconnect();
      preferenceObserver?.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (!visibilityObserver) { window.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); }
    };
  }, []);

  return { rootRef, active, motionReduced, style: { '--visual-play': active && !motionReduced ? 'running' : 'paused' } as CSSProperties };
}

/** Original vector compositions. No stock media or external image assets. */
export function StudioScene({kind='image',className=''}:{kind?:SceneKind;className?:string}) {
  const id=useId().replace(/:/g,'');
  const activity = useVisualActivity();
  return <div ref={activity.rootRef} style={activity.style} className={`studio-scene scene-kind-${kind} ${activity.motionReduced ? 'visual-reduced' : ''} ${className}`} aria-hidden="true">
    <div className="scene-light"/><div className="scene-grid"/>
    {kind==='audio'? <div className="scene-wave">{Array.from({length:31},(_,i)=><i key={i} style={{height:`${12+Math.sin(i*.42)**2*65}px`,animationDelay:`${i*-.11}s`}}/>)}</div>
    :kind==='identity'? <div className="scene-identity"><span/><span/><span/><i/><b/><div><Layers size={23} strokeWidth={1.2}/></div></div>
    :kind==='space'? <svg viewBox="0 0 300 180"><defs><linearGradient id={id}><stop stopColor="#d2d5e0" stopOpacity=".6"/><stop offset="1" stopColor="#ff4059" stopOpacity=".07"/></linearGradient></defs>{Array.from({length:6},(_,i)=><rect key={i} x={82+i*14} y={25+i*8} width={106-i*7} height={130-i*15} rx="5" fill="none" stroke={`url(#${id})`} transform={`rotate(${i*3-9} 150 90)`}/>)}</svg>
    :kind==='cinema'? <div className="scene-cinema"><i/><i/><i/><i/><span/></div>
    :kind==='golden'? <div className="scene-golden"><span/><i/><i/><i/><i/></div>
    : <div className="scene-image"><span className="scene-frame frame-back"/><span className="scene-frame frame-front"><i/><b/><em/></span><span className="scene-image-dot"/></div>}
  </div>;
}

export function DimensionsVisual({reducedMotion=false}:{reducedMotion?:boolean}) {
  const id=useId().replace(/:/g,'');
  const activity = useVisualActivity(reducedMotion);
  const mx=useMotionValue(0),my=useMotionValue(0);
  const x=useSpring(mx,{stiffness:100,damping:25}),y=useSpring(my,{stiffness:100,damping:25});
  const rotateY=useTransform(x,[-.5,.5],[-8,8]),rotateX=useTransform(y,[-.5,.5],[6,-6]);
  useEffect(() => {
    if (!activity.active || activity.motionReduced) { mx.jump(0); my.jump(0); x.jump(0); y.jump(0); }
  }, [activity.active, activity.motionReduced, mx, my, x, y]);
  return <div ref={activity.rootRef} style={activity.style} className={`dimensions-visual ${activity.motionReduced ? 'visual-reduced' : ''}`} aria-hidden="true" onPointerMove={e=>{
    if(activity.motionReduced||!activity.active||e.pointerType!=='mouse')return;
    const r=e.currentTarget.getBoundingClientRect();mx.set((e.clientX-r.left)/r.width-.5);my.set((e.clientY-r.top)/r.height-.5);
  }} onPointerLeave={()=>{mx.set(0);my.set(0)}}>
    <div className="dimensions-aura"/><div className="dimensions-floor"/>
    <motion.div className="dimensions-object" style={activity.motionReduced||!activity.active?undefined:{rotateX,rotateY}}>
      <svg className="dimension-halo" viewBox="0 0 480 360">
        <defs>
          <linearGradient id={`${id}-metal`} x1=".13" y1=".1" x2=".84" y2=".94" gradientUnits="objectBoundingBox"><stop stopColor="#ffd9df"/><stop offset=".15" stopColor="#ff6d83"/><stop offset=".38" stopColor="#a51e38"/><stop offset=".57" stopColor="#300b16"/><stop offset=".76" stopColor="#d82d48"/><stop offset="1" stopColor="#ffadb9"/></linearGradient>
          <linearGradient id={`${id}-edge`}><stop stopColor="#ff9dae" stopOpacity=".65"/><stop offset=".5" stopColor="#ffffff" stopOpacity=".08"/><stop offset="1" stopColor="#ff4059" stopOpacity=".8"/></linearGradient>
          <radialGradient id={`${id}-inner`}><stop stopColor="#242128" stopOpacity=".2"/><stop offset="1" stopColor="#0c0d11" stopOpacity=".85"/></radialGradient>
        </defs>
        <g className="halo-orbit">
          <ellipse cx="240" cy="178" rx="141" ry="101" transform="rotate(-36 240 178)" fill={`url(#${id}-inner)`} stroke={`url(#${id}-metal)`} strokeWidth="36"/>
          <ellipse cx="240" cy="178" rx="160" ry="118" transform="rotate(-36 240 178)" fill="none" stroke={`url(#${id}-edge)`} strokeWidth=".8"/>
          <ellipse cx="240" cy="178" rx="122" ry="83" transform="rotate(-36 240 178)" fill="none" stroke="#ffa5b8" strokeOpacity=".25" strokeWidth=".7"/>
          {Array.from({length:7},(_,i)=><ellipse key={i} cx="240" cy="178" rx={127+i*4.5} ry={88+i*4.2} transform="rotate(-36 240 178)" fill="none" stroke={i<3?'#ff4059':'#ffffff'} strokeOpacity={i<3?.09:.035} strokeWidth=".7"/>)}
        </g>
        <path d="M64 240 Q236 333 418 141" fill="none" stroke={`url(#${id}-edge)`} strokeWidth=".7" strokeDasharray="3 6" opacity=".35"/>
        <circle className="halo-satellite" cx="360" cy="277" r="3" fill="#ff7e92"/>
      </svg>
      <div className="dimension-symbol"><Sparkles size={27} strokeWidth={1.2}/></div>
      <div className="dimension-chip chip-image"><span><ImagePlus size={15}/></span><div><small>Um novo olhar</small><strong>Imagem</strong></div><i/></div>
      <div className="dimension-chip chip-audio"><span><AudioLines size={16}/></span><div><small>Mais presença</small><strong>Voz + ambiente</strong></div><div className="chip-wave">{Array.from({length:13},(_,i)=><i key={i} style={{height:7+Math.sin(i*.8)**2*17,animationDelay:`${i*-.13}s`}}/>)}</div></div>
    </motion.div>
  </div>;
}
