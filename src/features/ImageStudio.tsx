import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Check, ChevronDown, Crop, Expand, ImagePlus, Layers, LoaderCircle, MoveUpRight, Plus, RotateCcw, SlidersHorizontal, Sparkles, Upload, WandSparkles, X } from 'lucide-react';
import { photos, readLocal } from '../data';
import './image-studio.css';

type ImageAsset = { type:'image'; title:string; subtitle:string; image?:string };
interface Props { reference?:{image:string;prompt:string;title?:string}; onNotify:(message:string)=>void; onSave:(asset:ImageAsset)=>void }
const presets = [
  {label:'Luz de estúdio', prompt:'Iluminação de estúdio suave, fundo minimalista e acabamento editorial. Preserve a identidade e a textura natural.'},
  {label:'Golden hour', prompt:'Luz dourada de fim de tarde, sombras delicadas e tons quentes. Preserve a identidade e a composição.'},
  {label:'Novo cenário', prompt:'Substitua o fundo por um cenário urbano elegante, com luz natural. Preserve o elemento principal.'},
  {label:'Cinematográfico', prompt:'Atmosfera cinematográfica, contraste suave e tons vermelhos discretos. Preserve a composição original.'},
];
const filters = [{id:'natural',name:'Natural',value:'none'}, {id:'warm',name:'Dourado',value:'sepia(0.25) saturate(1.15) brightness(1.07)'}, {id:'cinema',name:'Cinema',value:'contrast(1.16) saturate(0.75)'}, {id:'bw',name:'P&B',value:'grayscale(1) contrast(1.08)'}];

export default function ImageStudio({reference,onNotify,onSave}:Props) {
  const [profile] = useState(()=>readLocal<{name?:string;image?:string;bio?:string}>('velora:active-profile',{}));
  const [image,setImage]=useState(reference?.image || profile.image || photos.portrait);
  const [prompt,setPrompt]=useState(reference?.prompt || '');
  const [filename,setFilename]=useState(reference?.title || profile.name || 'Retrato editorial');
  const [dimensions,setDimensions]=useState({width:3,height:4});
  const [ratio,setRatio]=useState('Original');
  const [quality,setQuality]=useState('1K');
  const [filter,setFilter]=useState('natural');
  const [intensity,setIntensity]=useState(100);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState(0);
  const [result,setResult]=useState(false);
  const [comparison,setComparison]=useState(50);
  const [compare,setCompare]=useState(false);
  const [dragging,setDragging]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const [tab,setTab]=useState('edit');
  const [references,setReferences]=useState<string[]>([]);
  const input=useRef<HTMLInputElement>(null);
  const referenceInput=useRef<HTMLInputElement>(null);
  const interval=useRef<ReturnType<typeof setInterval>|undefined>(undefined);
  const finish=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>{if(reference){setImage(reference.image);setPrompt(reference.prompt);setFilename(reference.title||'Referência criativa');setResult(false);}},[reference]);
  useEffect(()=>{let active=true;const img=new Image();img.onload=()=>{if(active)setDimensions({width:img.naturalWidth,height:img.naturalHeight})};img.src=image;return()=>{active=false}},[image]);
  useEffect(()=>()=>{clearInterval(interval.current);clearTimeout(finish.current)},[]);
  useEffect(()=>{if(!expanded)return;const previous=document.activeElement as HTMLElement|null;const close=document.querySelector<HTMLElement>('.expanded-image .modal-close');close?.focus();const oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setExpanded(false);if(e.key==='Tab'){e.preventDefault();close?.focus();}};window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);document.body.style.overflow=oldOverflow;previous?.focus();}},[expanded]);
  const currentFilter=filters.find(f=>f.id===filter)?.value||'none';
  const upload=(file?:File, extra=false)=>{
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){onNotify('Envie uma imagem JPG, PNG ou WebP.');return;}
    if(file.size>8*1024*1024){onNotify('Escolha uma imagem de até 8 MB.');return;}
    const reader=new FileReader();reader.onload=()=>{const value=String(reader.result);if(extra){setReferences(prev=>[...prev,value].slice(0,4));}else{setImage(value);setFilename(file.name.replace(/\.[^.]+$/,''));setResult(false);setFilter('natural');}onNotify(extra?'Referência adicionada.':'Imagem pronta para editar.');};reader.onerror=()=>onNotify('Não foi possível ler a imagem. Tente outro arquivo.');reader.readAsDataURL(file);
  };
  const generate=()=>{
    if(!prompt.trim()){onNotify('Descreva o que você quer mudar na imagem.');return;}
    setBusy(true);setProgress(0);setResult(false);
    interval.current=setInterval(()=>setProgress(p=>Math.min(95,p+7+Math.random()*9)),260);
    finish.current=setTimeout(()=>{clearInterval(interval.current);setProgress(100);setBusy(false);setResult(true);if(filter==='natural')setFilter('warm');onNotify('Prévia pronta. O resultado usa ajustes locais; a IA será conectada depois.');},2100);
  };
  const imageBlob=async()=>{
    const canvas=document.createElement('canvas');const img=new Image();img.crossOrigin='anonymous';
    await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('load'));img.src=image;});
    const [rw,rh]=ratio==='Original'?[img.naturalWidth,img.naturalHeight]:ratio.split(':').map(Number);
    const cropRatio=rw/rh;let sourceWidth=img.naturalWidth,sourceHeight=img.naturalHeight;
    if(sourceWidth/sourceHeight>cropRatio)sourceWidth=sourceHeight*cropRatio;else sourceHeight=sourceWidth/cropRatio;
    const scale=Math.min(1,(quality==='2K'?2048:1024)/Math.max(sourceWidth,sourceHeight));
    const width=Math.round(sourceWidth*scale),height=Math.round(sourceHeight*scale);
    canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;
    const sourceX=(img.naturalWidth-sourceWidth)/2,sourceY=(img.naturalHeight-sourceHeight)/2;
    ctx.filter='none';ctx.drawImage(img,sourceX,sourceY,sourceWidth,sourceHeight,0,0,width,height);
    ctx.filter=currentFilter;ctx.globalAlpha=intensity/100;ctx.drawImage(img,sourceX,sourceY,sourceWidth,sourceHeight,0,0,width,height);
    return new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('export')),'image/jpeg',.93));
  };
  const download=async()=>{try{const blob=await imageBlob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`velora-${filename.toLowerCase().replace(/\s+/g,'-')}.jpg`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);onNotify('Imagem exportada com seus ajustes locais.');}catch{onNotify('Não foi possível exportar esta referência externa. Envie uma imagem do seu dispositivo.');}};
  const save=async()=>{try{const blob=await imageBlob();const reader=new FileReader();reader.onload=()=>onSave({type:'image',title:filename,subtitle:`Prévia local · ${ratio} · ${filters.find(f=>f.id===filter)?.name}`,image:String(reader.result)});reader.readAsDataURL(blob);}catch{onSave({type:'image',title:filename,subtitle:'Referência externa · ajustes não exportados',image});}};
  const aspect=ratio==='Original'?`${dimensions.width} / ${dimensions.height}`:ratio.replace(':',' / ');
  return <div className="image-studio">
    <div className="page-heading"><div><span className="eyebrow">TRANSFORME O QUE VOCÊ IMAGINA</span><h1>Estúdio de imagem<span className="red-dot">.</span></h1><p>Um novo cenário. Uma nova luz. A mesma essência.</p></div><span className="image-studio-tag"><Layers size={13}/> Image workspace</span></div>
    {profile.name && <div className="active-profile-note"><span><Layers size={14}/> Direção criativa: <strong>{profile.name}</strong></span>{profile.bio&&<p>{profile.bio}</p>}</div>}
    <div className="image-workspace">
      <section className="image-controls"><div className="image-tabs"><button className={tab==='edit'?'active':''} onClick={()=>setTab('edit')}><WandSparkles size={15}/> Editar imagem</button><button className={tab==='adjust'?'active':''} onClick={()=>setTab('adjust')}><SlidersHorizontal size={15}/> Ajustes</button></div>
      {tab==='edit'?<>
        <div className="image-control-section"><div className="control-label"><label>Seu ponto de partida</label><span>01</span></div><button className={`upload-zone ${dragging?'dragging':''}`} onClick={()=>input.current?.click()} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);upload(e.dataTransfer.files[0]);}}><span className="upload-icon"><Upload size={19}/></span><strong>Arraste sua imagem aqui</strong><span>ou clique para escolher um arquivo</span><small>JPG, PNG, WebP · até 8 MB</small></button><input type="file" ref={input} accept="image/jpeg,image/png,image/webp" hidden onChange={e=>{upload(e.target.files?.[0]);e.target.value='';}}/><div className="input-preview"><img src={image} alt="Imagem de referência"/><div><strong>{filename}</strong><span>Imagem principal</span></div><button aria-label="Trocar imagem" onClick={()=>input.current?.click()}><RotateCcw size={14}/></button></div>
        <div className="extra-references"><span>Referências extras <small>Opcional</small></span><div>{references.map((src,i)=><div key={i}><img src={src} alt={`Referência ${i+1}`}/><button aria-label={`Remover referência ${i+1}`} onClick={()=>setReferences(r=>r.filter((_,idx)=>idx!==i))}><X size={10}/></button></div>)}{references.length<4&&<><button className="add-reference" aria-label="Adicionar referência" onClick={()=>referenceInput.current?.click()}><Plus size={14}/></button><input ref={referenceInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e=>{upload(e.target.files?.[0],true);e.target.value="";}}/></>}</div></div></div>
        <div className="image-control-section"><div className="control-label"><label htmlFor="image-prompt">O que vamos mudar?</label><span>02</span></div><div className="prompt-field"><textarea id="image-prompt" placeholder="Imagine uma nova luz, outro cenário ou descreva cada detalhe que quer transformar..." maxLength={2000} value={prompt} onChange={e=>setPrompt(e.target.value)} rows={5}/><div><button aria-label="Melhorar descrição" onClick={()=>{if(!prompt.trim()){onNotify('Escreva uma ideia primeiro.');return;}setPrompt(p=>`${p.trim()}${p.trim().endsWith('.')?'':'.'} Preserve a composição, a identidade e a textura natural. Use iluminação coerente e acabamento fotográfico.`.slice(0,2000));}}><Sparkles size={13}/> Refinar ideia</button><span>{prompt.length}/2.000</span></div></div><div className="preset-label">PRECISA DE UM COMEÇO?</div><div className="prompt-presets">{presets.map(p=><button key={p.label} className={prompt===p.prompt?'selected':''} onClick={()=>setPrompt(p.prompt)}>{p.label}<MoveUpRight size={11}/></button>)}</div></div>
      </>:<div className="image-control-section adjust-controls"><div className="control-label"><label>Acabamento da imagem</label><SlidersHorizontal size={14}/></div><p className="image-adjust-note">Ajustes reais aplicados no navegador. Experimente e exporte sua versão.</p><div className="filter-grid">{filters.map(f=><button key={f.id} className={filter===f.id?'active':''} onClick={()=>setFilter(f.id)}><img src={image} alt="" style={{filter:f.value}}/><span>{f.name}</span></button>)}</div><label className="slider-label" htmlFor="image-intensity">Intensidade da prévia <span>{intensity}%</span></label><input id="image-intensity" type="range" min="0" max="100" value={intensity} onChange={e=>setIntensity(Number(e.target.value))}/><button className="btn btn-ghost" onClick={()=>{setFilter('natural');setIntensity(100)}}><RotateCcw size={14}/> Restaurar original</button><div className="adjust-tip"><Sparkles size={15}/><p>O formato selecionado recorta a imagem pelo centro. A exportação mantém o filtro escolhido.</p></div></div>}
      <div className="image-control-section output-settings"><div className="control-label"><label>Formato & qualidade</label><span>03</span></div><div className="ratio-picker">{['Original','1:1','4:5','9:16','16:9'].map(r=><button key={r} className={ratio===r?'active':''} onClick={()=>setRatio(r)}><span style={{width:r==='16:9'?17:r==='Original'?12:12,height:r==='9:16'?19:r==='16:9'?10:14}}/>{r}</button>)}</div><div className="quality-row"><span>Resolução de exportação</span><div>{['1K','2K'].map(q=><button key={q} className={q===quality?'active':''} onClick={()=>setQuality(q)}>{q}</button>)}</div></div></div>
      <div className="image-generate-footer"><button className="btn btn-primary generate-image-btn" disabled={busy || !prompt.trim()} onClick={generate}>{busy?<LoaderCircle className="spin" size={17}/>:<Sparkles size={17}/>} {busy?'Preparando sua prévia...':'Criar prévia'} {!busy&&<ArrowUpRight size={16}/>}</button><span><i/> Demonstração local · nenhum crédito utilizado</span></div>
      </section>
      <section className="image-preview-panel"><div className="preview-toolbar"><div className="preview-title"><span className={result?'preview-dot ready':'preview-dot'}/><strong>{busy?'Preparando':result?'Sua prévia':'Canvas'}</strong><span className="tag">LOCAL</span></div><div><button className={`icon-button ${compare?'selected':''}`} onClick={()=>setCompare(v=>!v)} aria-label="Comparar antes e depois"><ArrowLeftRight size={16}/></button><button className="icon-button" aria-label="Expandir imagem" onClick={()=>setExpanded(true)}><Expand size={16}/></button></div></div>
        <div className="image-canvas"><div className="canvas-grid"/><div className="canvas-photo" style={{aspectRatio:aspect}}><img src={image} alt="Prévia da imagem" style={{filter:compare?'none':currentFilter}}/>{!compare&&<img className="filtered-overlay" src={image} alt="" style={{filter:'none',opacity:1-intensity/100}}/>}{compare&&<><div className="compare-after" style={{clipPath:`inset(0 0 0 ${comparison}%)`}}><img src={image} alt="Imagem com ajuste" style={{filter:currentFilter}}/><img className="filtered-overlay" src={image} alt="" style={{filter:"none",opacity:1-intensity/100}}/></div><div className="compare-divider" style={{left:`${comparison}%`}}><span><ArrowLeftRight size={15}/></span></div><input aria-label="Posição da comparação" className="compare-range" type="range" min="0" max="100" value={comparison} onChange={e=>setComparison(Number(e.target.value))}/><span className="compare-label before">Original</span><span className="compare-label after">Prévia</span></>}{busy&&<div className="image-processing"><span><Sparkles size={26}/></span><h3>Lapidando a sua ideia</h3><p>Preparando uma demonstração do fluxo</p><div className="processing-track"><i style={{width:`${progress}%`}}/></div><small>{Math.round(progress)}%</small></div>}</div><span className="canvas-format"><Crop size={12}/> {ratio} <i/> {quality} <i/> Prévia local</span></div>
        <div className="preview-bottom"><div><span className="eyebrow">SEU OLHAR, SEU ACABAMENTO</span><div className="inline-filters">{filters.map(f=><button key={f.id} onClick={()=>{setFilter(f.id);setIntensity(100)}} className={f.id===filter?'active':''}>{f.name}</button>)}</div></div><div className="preview-actions"><button className="btn btn-ghost" onClick={save}><Plus size={15}/> Salvar</button><button className="btn btn-primary" onClick={download}><ArrowDownToLine size={15}/> Exportar</button></div></div><div className="preview-info"><Sparkles size={13}/><p>Esta prévia aplica cor e recorte localmente. As transformações descritas no prompt estarão disponíveis com a integração de IA.</p></div>
      </section>
    </div>
    {expanded&&<div className="modal-backdrop expanded-image" role="dialog" aria-modal="true" aria-label="Imagem expandida" onClick={()=>setExpanded(false)}><button className="icon-button modal-close" aria-label="Fechar imagem expandida" autoFocus onClick={()=>setExpanded(false)}><X size={22}/></button><div className="expanded-photo" onClick={e=>e.stopPropagation()}><img src={image} alt="Prévia expandida" style={{filter:currentFilter}}/><img src={image} className="expanded-original" alt="" style={{opacity:1-intensity/100}}/></div></div>}
  </div>;
}
