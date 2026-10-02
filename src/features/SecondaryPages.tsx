import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronDown,
  CreditCard, Download, FolderOpen, Grid2X2, Heart, Image, List,
  LoaderCircle, LockKeyhole, MoreHorizontal, Plus, Search, ShieldCheck, SlidersHorizontal,
  Sparkles, Trash2, UserRound, Users, Volume2, X,
} from 'lucide-react';
import { audioBufferToWav, decodeAudio, type MixOptions } from '../audio/audio-engine';
import { getAudioFile } from '../audio/audio-storage';
import { getEnvironment } from '../audio/environments';
import EnvironmentEmoji from '../components/EnvironmentEmoji';
import { readLocal, writeLocal as persistLocal } from '../data';
import { useAuth } from '../auth/AuthProvider';
import { getUserDisplayName, updateDisplayName } from '../auth/service';
import { getStorageOwner } from '../auth/storage-owner';
import './secondary-pages.css';

export interface Asset {
  id: string;
  type: 'image' | 'audio';
  title: string;
  subtitle: string;
  image?: string;
  environment?: string;
  text?: string;
  createdAt: string;
  favorite?: boolean;
  audioFileId?: string;
  voiceFileId?: string;
  ambienceFileId?: string;
  guideFileId?: string;
  guideName?: string;
  impulseFileId?: string;
  impulseName?: string;
  impulseSource?: string;
  impulseReviewed?: boolean;
  impulseSettings?: { directSound: 'included' | 'removed'; directArrivalMs: number; directWindowMs: number; predelayMode: 'embedded' | 'external'; predelayMs: number; wet: number };
  ambienceName?: string;
  voiceId?: string;
  voiceName?: string;
  audioSource?: string;
  ambientSource?: string;
  ambientReviewed?: boolean;
  ambientRevision?: string;
  ambientProvenance?: { label: string; source: string; license: string; licenseUrl?: string };
  duration?: number;
  mimeType?: string;
  mix?: MixOptions;
}

export interface SecondaryPageProps {
  onNotify: (message: string) => void;
  assets: Asset[];
  onDeleteAsset: (id: string) => void;
  onNavigate: (page: string) => void;
  onOpenAsset?: (asset: Asset) => void;
}

function downloadFile(content: Blob, filename: string) {
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function assetDownloadLabel(asset: Asset): string {
  return asset.type === 'image' ? 'Baixar imagem' : asset.audioFileId ? 'Baixar áudio' : 'Exportar roteiro';
}

function audioDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function LibraryAudioPreview({ asset }: { asset: Asset }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(asset.audioFileId));
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const playerRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setError('');
    setLoading(Boolean(asset.audioFileId));
    if (asset.audioFileId) getAudioFile(asset.audioFileId).then(blob => {
      if (cancelled) return;
      if (!blob?.size) throw new Error('O arquivo de áudio não foi encontrado neste navegador. Abra o estúdio para importar ou gerar o áudio novamente.');
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o áudio salvo.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [asset.audioFileId, retry]);
  useEffect(() => {
    const player = playerRef.current;
    return () => { if (player) { player.pause(); player.removeAttribute('src'); player.load(); } };
  }, [url]);
  const environment = getEnvironment(asset.environment || 'studio');
  return <div className="lib-dialog-audio">
    <div className="lib-dialog-environment"><EnvironmentEmoji environment={environment.id} size={48} /><div><span>{asset.audioFileId ? 'Áudio final' : 'Roteiro de áudio'}</span><h3>{environment.name}</h3></div></div>
    {(asset.voiceName || asset.duration) && <div className="lib-audio-metadata">{asset.voiceName && <span><Volume2 size={13} />{asset.voiceName}</span>}{audioDuration(asset.duration) && <span>{audioDuration(asset.duration)}</span>}</div>}
    {asset.audioFileId && <div className="lib-audio-player-area">{loading ? <div className="lib-audio-loading" role="status"><span />Carregando seu áudio...</div> : error ? <div className="lib-audio-error" role="alert"><p>{error}</p><button className="btn btn-ghost" onClick={() => setRetry(value => value + 1)}>Tentar carregar novamente</button></div> : url ? <audio ref={playerRef} controls src={url} preload="metadata" aria-label={`Ouvir ${asset.title}`} onError={() => setError('O navegador não conseguiu reproduzir este arquivo. Baixe o áudio ou abra o estúdio para recuperá-lo.')} /> : null}</div>}
    {asset.text && <p className="lib-audio-script">{asset.text}</p>}
    {!asset.audioFileId && !asset.text && <p className="lib-audio-script">{asset.subtitle}</p>}
    <div className="sec-note">{asset.audioFileId ? 'Arquivo salvo neste navegador. Baixe o áudio para guardar uma cópia.' : 'Este projeto contém um roteiro. Abra o estúdio para criar ou importar a voz.'}</div>
  </div>;
}

function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href]') || []);
    (dialogRef.current?.querySelector<HTMLElement>('input') || focusable()[0])?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', listener);
    return () => { document.removeEventListener('keydown', listener); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  return (
    <motion.div className="modal-backdrop sec-dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.section ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} className={`modal sec-dialog ${wide ? 'sec-dialog-wide' : ''}`} initial={{ opacity: 0, y: 24, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: .98 }} onClick={event => event.stopPropagation()}>
        <div className="sec-dialog-header"><h2>{title}</h2><button className="sec-icon-button" aria-label="Fechar" onClick={onClose}><X size={20} /></button></div>
        {children}
      </motion.section>
    </motion.div>
  );
}

function PageIntro({ title, description, children }: { eyebrow: string; title: string; description: string; children?: ReactNode }) {
  return <div className="sec-page-intro"><div><h1 className="page-heading">{title}</h1><p className="muted">{description}</p></div>{children}</div>;
}

export function LibraryPage({ assets, onDeleteAsset, onNavigate, onNotify, onOpenAsset }: SecondaryPageProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'image' | 'audio' | 'favorites'>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [favorites, setFavorites] = useState<string[]>(() => readLocal('velora:favorites', assets.filter(asset => asset.favorite).map(asset => asset.id)));
  const [selected, setSelected] = useState<Asset | null>(null);
  const [toDelete, setToDelete] = useState<Asset | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const filtered = useMemo(() => assets.filter(asset => {
    const matchFilter = filter === 'all' || (filter === 'favorites' ? favorites.includes(asset.id) : asset.type === filter);
    return matchFilter && `${asset.title} ${asset.subtitle} ${asset.environment ? getEnvironment(asset.environment).name : ''} ${asset.voiceName || ''}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'));
  }).sort((a, b) => sort === 'newest' ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [assets, favorites, filter, search, sort]);

  const updateFavorites = (next: string[]) => { setFavorites(next); if (!persistLocal('velora:favorites', next)) onNotify('Favoritos atualizados nesta sessão. O navegador não permitiu salvar.'); };
  const toggleFavorite = (id: string) => updateFavorites(favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id]);
  const downloadAsset = async (asset: Asset) => {
    if (asset.type === 'audio') {
      if (asset.audioFileId) {
        setDownloading(asset.id);
        try {
          const blob = await getAudioFile(asset.audioFileId);
          if (!blob?.size) throw new Error('O arquivo de áudio não foi encontrado neste navegador. Abra o estúdio para recuperá-lo.');
          const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
          const signature = (offset: number) => String.fromCharCode(...header.subarray(offset, offset + 4));
          const wav = signature(0) === 'RIFF' && signature(8) === 'WAVE' ? blob : audioBufferToWav(await decodeAudio(blob));
          downloadFile(wav, `${asset.title.toLowerCase().replace(/\s+/g, '-')}.wav`);
          onNotify('Áudio WAV baixado.');
        } catch (reason) {
          onNotify(reason instanceof Error ? reason.message : 'Não foi possível baixar o áudio salvo.');
        } finally { setDownloading(null); }
        return;
      }
      downloadFile(new Blob([`${asset.title}\n\n${asset.text || asset.subtitle}\n\nAmbiente: ${getEnvironment(asset.environment || 'studio').name}\n\nRoteiro do projeto. Nenhum arquivo de áudio está associado a este roteiro.`], { type: 'text/plain;charset=utf-8' }), `${asset.title.toLowerCase().replace(/\s+/g, '-')}-roteiro.txt`);
      onNotify('Roteiro exportado.');
      return;
    }
    if (!asset.image) { onNotify('Este projeto ainda não tem uma imagem para baixar.'); return; }
    setDownloading(asset.id);
    try {
      const response = await fetch(asset.image);
      if (!response.ok) throw new Error('Falha ao baixar');
      const blob = await response.blob();
      const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      downloadFile(blob, `${asset.title.toLowerCase().replace(/\s+/g, '-')}.${extension}`);
      onNotify('Imagem baixada.');
    } catch {
      window.open(asset.image, '_blank', 'noopener,noreferrer');
      onNotify('Imagem aberta em outra aba para você salvar.');
    } finally { setDownloading(null); }
  };

  return <div className="sec-page library-page">
    <PageIntro eyebrow="SEU ACERVO CRIATIVO" title="Biblioteca" description="Todas as suas criações, organizadas em um só lugar.">
      <button className="btn btn-primary" onClick={() => onNavigate('images')}><Plus size={17} /> Nova criação</button>
    </PageIntro>
    <div className="lib-toolbar">
      <div className="sec-tabs" aria-label="Filtrar biblioteca">{([['all', 'Tudo', FolderOpen], ['image', 'Imagens', Image], ['audio', 'Áudios', Volume2], ['favorites', 'Favoritos', Heart]] as const).map(([value, label, Icon]) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}><Icon size={15} />{label}{value === 'all' && <span>{assets.length}</span>}</button>)}</div>
      <div className="lib-search"><Search size={17} /><input aria-label="Buscar na biblioteca" placeholder="Buscar criação..." value={search} onChange={event => setSearch(event.target.value)} /></div>
    </div>
    <div className="lib-results-bar"><span>{filtered.length} {filtered.length === 1 ? 'criação' : 'criações'}{filter === 'favorites' ? ' favorita(s)' : ''}</span><div><div className="lib-sort"><select value={sort} aria-label="Ordenar criações" onChange={event => setSort(event.target.value as 'newest' | 'oldest')}><option value="newest">Mais recentes</option><option value="oldest">Mais antigas</option></select><ChevronDown size={13} /></div><div className="lib-view-switch"><button aria-label="Visualização em grade" aria-pressed={view === 'grid'} className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}><Grid2X2 size={17} /></button><button aria-label="Visualização em lista" aria-pressed={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={18} /></button></div></div></div>
    {filtered.length ? <motion.div layout className={`lib-assets lib-assets-${view}`}><AnimatePresence mode="popLayout">{filtered.map((asset, index) => <motion.article layout key={asset.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .96 }} transition={{ delay: Math.min(index * .035, .2) }} className="lib-asset">
      <button className={`lib-asset-preview ${asset.type === 'audio' ? 'lib-audio-preview' : ''}`} onClick={() => setSelected(asset)} aria-label={`Abrir ${asset.title}`}>
        {asset.type === 'image' && asset.image ? <img src={asset.image} alt={asset.title} loading="lazy" /> : <div className="lib-wave-art">{Array.from({ length: 35 }, (_, i) => <span key={i} style={{ height: `${12 + Math.sin(i * 1.4) ** 2 * 58 + Math.cos(i * .6) ** 2 * 20}px` }} />)}</div>}
        <span className="lib-type-label">{asset.type === 'image' ? <Image size={12} /> : <Volume2 size={12} />}{asset.type === 'image' ? 'IMAGEM' : asset.audioFileId ? 'ÁUDIO' : 'ROTEIRO'}</span>
        {asset.type === 'audio' && <span className="lib-audio-environment"><EnvironmentEmoji environment={asset.environment || 'studio'} size={25} /><span>{getEnvironment(asset.environment || 'studio').name}</span>{audioDuration(asset.duration) && <small>{audioDuration(asset.duration)}</small>}</span>}
        <span className="lib-preview-open"><ArrowRight size={18} /></span>
      </button>
      <div className="lib-asset-info"><div><h3><button onClick={() => setSelected(asset)}>{asset.title}</button></h3><p>{asset.subtitle}</p></div><span className="lib-date">{new Date(asset.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span></div>
      <div className="lib-asset-actions"><button className={`sec-icon-button ${favorites.includes(asset.id) ? 'is-favorite' : ''}`} aria-label={favorites.includes(asset.id) ? 'Remover dos favoritos' : 'Favoritar'} onClick={() => toggleFavorite(asset.id)}><Heart size={16} fill={favorites.includes(asset.id) ? 'currentColor' : 'none'} /></button><button className="sec-icon-button" aria-label={assetDownloadLabel(asset)} disabled={downloading === asset.id} onClick={() => downloadAsset(asset)}><Download size={16} /></button><button className="sec-icon-button" aria-label={`Excluir ${asset.title}`} onClick={() => setToDelete(asset)}><Trash2 size={15} /></button></div>
    </motion.article>)}</AnimatePresence></motion.div> : <div className="sec-empty"><div className="sec-empty-icon">{filter === 'favorites' ? <Heart size={27} /> : <FolderOpen size={27} />}</div><h2>{search ? 'Nenhuma criação por aqui.' : filter === 'favorites' ? 'Guarde o que você ama.' : 'Seu próximo projeto começa aqui.'}</h2><p>{search ? 'Experimente buscar por outro nome ou mudar o filtro.' : filter === 'favorites' ? 'Toque no coração de uma criação para encontrá-la aqui.' : 'Crie sua primeira imagem ou prepare um áudio no estúdio.'}</p><button className="btn btn-primary" onClick={() => search ? setSearch('') : onNavigate('images')}>{search ? 'Limpar busca' : 'Abrir estúdio'}<ArrowRight size={16} /></button></div>}
    <div className="sec-local-footnote"><ShieldCheck size={14} /> Projetos salvos neste navegador. Exporte seus arquivos para guardar uma cópia.</div>
    <AnimatePresence>{selected && <Dialog title={selected.title} wide onClose={() => setSelected(null)}>
      {selected.type === 'image' && selected.image ? <img className="lib-dialog-image" src={selected.image} alt={selected.title} /> : <LibraryAudioPreview key={selected.id} asset={selected} />}
      <div className="sec-dialog-footer"><button className="btn btn-ghost" onClick={() => { if (onOpenAsset) onOpenAsset(selected); else onNavigate(selected.type === 'image' ? 'images' : 'audio'); setSelected(null); }}>Abrir estúdio<ArrowRight size={15} /></button><button className="btn btn-primary" disabled={downloading === selected.id} onClick={() => downloadAsset(selected)}><Download size={16} />{downloading === selected.id ? 'Baixando...' : assetDownloadLabel(selected)}</button></div>
    </Dialog>}</AnimatePresence>
    <AnimatePresence>{toDelete && <Dialog title="Excluir esta criação?" onClose={() => setToDelete(null)}><p className="sec-dialog-copy">“{toDelete.title}” será removida da biblioteca deste navegador. Arquivos já baixados continuam com você.</p><div className="sec-dialog-footer"><button className="btn btn-ghost" onClick={() => setToDelete(null)}>Cancelar</button><button className="btn btn-primary" onClick={() => { onDeleteAsset(toDelete.id); updateFavorites(favorites.filter(id => id !== toDelete.id)); setToDelete(null); }}>Excluir criação<Trash2 size={15} /></button></div></Dialog>}</AnimatePresence>
  </div>;
}

const PLANS = [
  { name: 'Starter', monthly: 79, annualMonthly: 63, description: 'Para começar a criar.', features: ['Estúdio de áudio', 'Edição local de imagens', 'Biblioteca de projetos'], icon: Sparkles },
  { name: 'Pro', monthly: 149, annualMonthly: 119, description: 'Para uma rotina de criação.', features: ['Voz e ambiente no mesmo mix', 'Referências e perfis criativos', 'Organização por favoritos'], icon: Volume2 },
  { name: 'Studio', monthly: 299, annualMonthly: 239, description: 'Para um volume maior de ideias.', features: ['Importação de voz e ambiente', 'Faixas separadas para remixar', 'Exportação dos seus projetos'], icon: Users },
];
const proposedPrice = (value:number) => value.toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });

export function PlansPage({ onNotify }: SecondaryPageProps) {
  const { user } = useAuth();
  const [annual, setAnnual] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [requested, setRequested] = useState(false);
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const faqs = [
    ['Já posso assinar?', 'Ainda não. Os valores são propostas e o pagamento não está conectado. Escolher uma opção aqui salva apenas uma preferência neste navegador.'],
    ['Os planos já incluem créditos?', 'Os limites de uso, os pacotes e as equivalências de créditos ainda estão em definição. Nenhum saldo é comprado ou ativado nesta página.'],
    ['O que já está disponível?', 'Estúdio de áudio, edição local de imagens, perfis de referência e biblioteca. A geração de voz depende da conexão do provedor; os ajustes de mix usam as faixas existentes.'],
    ['Posso mudar de ideia?', 'Sim. Nenhuma assinatura é criada ao guardar sua preferência. Você pode escolher outra proposta quando quiser.'],
  ];
  return <div className="sec-page plans-page plans-proposals">
    <div className="plans-heading"><h1 className="page-heading">Planos em preparação.</h1><p className="muted">Valores propostos em reais. Assinaturas e cobrança ainda não estão disponíveis.</p><div className="plans-billing" role="group" aria-label="Comparar propostas de cobrança"><button aria-pressed={!annual} className={!annual ? 'active' : ''} onClick={() => setAnnual(false)}>Mensal</button><button aria-pressed={annual} className={annual ? 'active' : ''} onClick={() => setAnnual(true)}>Anual</button></div><div className="plans-preview-label"><span />Propostas de preço · condições finais a definir</div></div>
    <div className="plans-grid">{PLANS.map((plan, index) => <motion.article key={plan.name} className={`plan-card ${index === 1 ? 'plan-featured' : ''}`} initial={{ opacity:0, y:18 }} animate={{ opacity:1, y:0 }} transition={{ delay:index * .08 }}>{index === 1 && <div className="plan-popular"><Sparkles size={12} />Em estudo</div>}<div className="plan-icon"><plan.icon size={22} /></div><h2>{plan.name}</h2><p className="plan-description">{plan.description}</p><div className="plan-price"><span>R$</span><strong>{proposedPrice(annual ? plan.annualMonthly : plan.monthly)}</strong><span>/mês</span></div><div className="plan-payment-note">{annual ? `Proposta de R$ ${proposedPrice(plan.annualMonthly * 12)} por ano` : 'Proposta de cobrança mensal'}</div><button className={`btn ${index === 1 ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setSelected(index); setRequested(false); }}>Ver proposta<ArrowRight size={16} /></button><div className="plan-limits-note"><Sparkles size={14} /><span>Limites de uso a definir</span></div><ul aria-label="Recursos existentes do estúdio">{plan.features.map(feature => <li key={feature}><Check size={15} />{feature}</li>)}</ul></motion.article>)}</div>
    <p className="plans-existing-note">Os recursos acima já existem no estúdio. A divisão entre planos ainda está em definição.</p>
    <div className="plans-trust"><span><LockKeyhole size={15} />Nenhuma assinatura ativa</span><span><CreditCard size={15} />Sem checkout nesta página</span><span><ShieldCheck size={15} />Condições finais a confirmar</span></div>
    <div className="plans-faq"><div><h2>Bom saber.</h2><p className="muted">Antes de escolher uma proposta.</p></div><div className="plans-faq-items">{faqs.map(([question, answer], index) => <div className="plans-faq-item" key={question}><button aria-expanded={faqOpen === index} aria-controls={`plan-faq-${index}`} onClick={() => setFaqOpen(faqOpen === index ? null : index)}>{question}<Plus size={17} className={faqOpen === index ? 'rotated' : ''} /></button><AnimatePresence>{faqOpen === index && <motion.div id={`plan-faq-${index}`} initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }} exit={{ height:0, opacity:0 }}><p>{answer}</p></motion.div>}</AnimatePresence></div>)}</div></div>
    <AnimatePresence>{selected !== null && <Dialog title={requested ? 'Preferência salva.' : `Proposta ${PLANS[selected].name}`} onClose={() => setSelected(null)}>{requested ? <div className="plan-requested"><div className="sec-success-icon"><Check size={25} /></div><h3>Você guardou esta proposta.</h3><p>A preferência por {PLANS[selected].name} foi salva neste navegador. Nenhuma assinatura, mensagem ou cobrança foi criada.</p><button className="btn btn-primary" onClick={() => setSelected(null)}>Voltar aos planos<ArrowRight size={16} /></button></div> : <><div className="plan-summary"><span>{PLANS[selected].name}<small>Proposta · limites a definir</small></span><strong>R$ {proposedPrice(annual ? PLANS[selected].annualMonthly : PLANS[selected].monthly)}<small>/ mês</small></strong></div><p className="sec-dialog-copy">{annual ? `Proposta anual de R$ ${proposedPrice(PLANS[selected].annualMonthly * 12)} no total.` : 'Proposta de cobrança mensal.'} Valores, cotas e condições serão confirmados antes de abrir assinaturas.</p><form onSubmit={event => { event.preventDefault(); if (!persistLocal('velora:plan-interest', { plan:PLANS[selected].name, billing:annual ? 'annual' : 'monthly', email:user?.email || '', date:new Date().toISOString() })) { onNotify('Não foi possível guardar a preferência neste navegador.'); return; } setRequested(true); onNotify('Preferência salva. Nenhuma assinatura ou cobrança criada.'); }}><label className="sec-form-label" htmlFor="plan-email">E-mail da sua conta</label><input className="field" id="plan-email" type="email" value={user?.email || ''} readOnly aria-describedby="plan-account-note" /><div className="sec-note" id="plan-account-note"><LockKeyhole size={15} />A preferência fica neste navegador. Não será enviada uma solicitação.</div><button className="btn btn-primary sec-full-width" type="submit">Guardar preferência<Check size={16} /></button></form></>}</Dialog>}</AnimatePresence>
  </div>;
}

export interface LocalSettings {
  name: string;
  email: string;
  role: string;
  notifications: boolean;
  sound: boolean;
  reducedMotion: boolean;
  language: string;
}
const DEFAULT_SETTINGS: LocalSettings = { name: 'Seu nome', email: '', role: 'Creator independente', notifications: true, sound: false, reducedMotion: false, language: 'pt-BR' };

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) { return <button className={`sec-toggle ${checked ? 'checked' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={onChange}><span /></button>; }

export function SettingsPage({ assets, onNotify }: SecondaryPageProps) {
  const { user } = useAuth();
  const accountName = user ? getUserDisplayName(user) : '';
  const accountEmail = user?.email || '';
  const [settings, setSettings] = useState<LocalSettings>(() => ({ ...DEFAULT_SETTINGS, ...readLocal<Partial<LocalSettings>>('velora:settings', {}), name:accountName, email:accountEmail }));
  const [activeTab, setActiveTab] = useState<'profile' | 'preferences' | 'data'>('profile');
  const [clearOpen, setClearOpen] = useState(false);
  const [backup, setBackup] = useState<LocalSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current=true; return () => { mounted.current=false; }; }, []);
  useEffect(() => { setSettings(current => ({ ...current, name:accountName, email:accountEmail })); }, [user?.id, accountName, accountEmail]);
  const applySettings = (next:LocalSettings) => { const persisted=persistLocal('velora:settings', next); document.documentElement.dataset.reduceMotion=next.reducedMotion ? 'true' : 'false'; window.dispatchEvent(new CustomEvent('velora-settings', { detail:next })); return persisted; };
  const savePreferences = () => { const persisted=applySettings({ ...settings, name:accountName, email:accountEmail }); setSaved(persisted); onNotify(persisted ? 'Preferências salvas neste navegador.' : 'Preferências aplicadas nesta sessão. O navegador não permitiu salvar.'); };
  const saveProfile = async () => {
    if(savingProfile)return;
    const name=settings.name.trim(), owner=user?.id;
    if(!owner){setProfileError('Entre na sua conta para atualizar seu nome.');return;}
    if(name.length<2 || name.length>60){setProfileError('Use um nome entre 2 e 60 caracteres.');return;}
    setSavingProfile(true);setProfileError('');
    try {
      const updated=name===accountName ? user : await updateDisplayName(name);
      if(getStorageOwner()!==owner)return;
      if(!updated || updated.id!==owner)throw new Error('Não foi possível confirmar a atualização da sua conta. Entre novamente.');
      const next={ ...settings, name:getUserDisplayName(updated), email:updated.email || accountEmail };
      const persisted=applySettings(next);
      if(mounted.current){setSettings(next);setSaved(persisted);setProfileSaved(persisted);onNotify(persisted ? 'Perfil atualizado. Seu nome foi salvo na conta.' : 'Seu nome foi salvo na conta. O navegador não permitiu guardar as preferências locais.');}
    } catch(reason) { if(mounted.current)setProfileError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o perfil. Tente novamente.'); }
    finally { if(mounted.current)setSavingProfile(false); }
  };
  const update = <K extends keyof LocalSettings>(key:K, value:LocalSettings[K]) => { setSettings(current => ({ ...current, [key]:value })); setSaved(false); if(key==='name' || key==='role')setProfileSaved(false); setProfileError(''); };
  const restorePreferences = () => {
    const next={ ...DEFAULT_SETTINGS, name:accountName, email:accountEmail };
    setBackup(settings);setSettings(next);const persisted=applySettings(next);setSaved(persisted);setClearOpen(false);
    onNotify(persisted ? 'Preferências restauradas. Você pode desfazer nesta página.' : 'Preferências restauradas nesta sessão. O navegador não permitiu salvar.');
  };
  const undoRestore = () => {
    if(!backup)return;
    const next={ ...backup, name:accountName, email:accountEmail };
    setSettings(next);const persisted=applySettings(next);setBackup(null);setSaved(persisted);
    onNotify(persisted ? 'Preferências anteriores restauradas.' : 'Preferências restauradas nesta sessão. O navegador não permitiu salvar.');
  };
  const exportData = () => {
    downloadFile(new Blob([JSON.stringify({ exportedAt:new Date().toISOString(), account:{ name:accountName, email:accountEmail }, preferences:{ ...settings, name:accountName, email:accountEmail }, assets, profiles:readLocal('velora:profiles', []), favorites:readLocal('velora:favorites', []) }, null, 2)], { type:'application/json' }), 'velora-meus-projetos.json');
    onNotify('Seus dados locais foram exportados.');
  };
  return <div className="sec-page settings-page"><PageIntro eyebrow="DO SEU JEITO" title="Configurações" description="Sua conta, suas preferências e seus dados." /><div className="settings-layout"><aside className="settings-navigation" aria-label="Seções das configurações">{([['profile', 'Minha conta', UserRound], ['preferences', 'Preferências', SlidersHorizontal], ['data', 'Meus dados', ShieldCheck]] as const).map(([value, label, Icon]) => <button key={value} className={activeTab===value ? 'active' : ''} aria-current={activeTab===value ? 'page' : undefined} disabled={savingProfile} onClick={() => setActiveTab(value)}><Icon size={18} />{label}<ArrowRight size={14} /></button>)}<div className="settings-local-card"><LockKeyhole size={19} /><strong>Conta e espaço local</strong><p>Seu nome fica na conta. Projetos e preferências de interface ficam neste navegador.</p></div></aside><div className="settings-main"><AnimatePresence mode="wait"><motion.div key={activeTab} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-6 }} transition={{ duration:.18 }}>
    {activeTab==='profile' && <section className="settings-section"><div className="settings-section-heading"><h2>Minha conta</h2><p>Seu nome no Velora e o e-mail usado para entrar.</p></div><div className="settings-avatar-row"><div className="settings-avatar">{accountName.trim().charAt(0).toUpperCase() || 'V'}</div><div><strong>{accountName || 'Minha conta'}</strong><span>Conta Velora</span></div></div><form onSubmit={event => { event.preventDefault();void saveProfile(); }}><div className="sec-form-grid"><div><label className="sec-form-label" htmlFor="settings-name">Nome</label><input className="field" id="settings-name" value={settings.name} onChange={event => update('name', event.target.value)} placeholder="Como podemos chamar você?" autoComplete="nickname" minLength={2} maxLength={60} disabled={savingProfile} required /></div><div><label className="sec-form-label" htmlFor="settings-email">E-mail</label><input className="field" id="settings-email" type="email" value={accountEmail} readOnly autoComplete="email" aria-describedby="settings-email-help" /><p className="settings-field-help" id="settings-email-help">E-mail vinculado à sua conta Supabase. Não é alterado por este formulário.</p></div></div><label className="sec-form-label" htmlFor="settings-role">Seu perfil criativo</label><select className="field" id="settings-role" value={settings.role} disabled={savingProfile} onChange={event => update('role', event.target.value)}><option>Creator independente</option><option>Agência ou equipe</option><option>Estúdio de conteúdo</option><option>Estou começando</option></select><p className="settings-field-help">Uma preferência pessoal, salva neste navegador.</p>{profileError && <p className="settings-profile-error" role="alert">{profileError}</p>}<div className="settings-save-row"><span role="status">{savingProfile ? 'Atualizando sua conta…' : profileSaved ? <><Check size={14} />Alterações salvas</> : 'O nome é salvo na conta; o perfil criativo fica no navegador.'}</span><button className="btn btn-primary" type="submit" disabled={savingProfile}>{savingProfile ? 'Salvando…' : 'Salvar alterações'}{savingProfile ? <LoaderCircle size={15} className="settings-spinner" /> : <Check size={15} />}</button></div></form></section>}
    {activeTab==='preferences' && <section className="settings-section"><div className="settings-section-heading"><h2>Preferências</h2><p>Deixe a interface confortável para você.</p></div><div className="settings-preference"><div className="settings-pref-icon"><Sparkles size={19} /></div><div><h3>Menos movimento</h3><p>Reduza as animações do estúdio. A preferência do seu sistema também é respeitada.</p></div><Toggle checked={settings.reducedMotion} onChange={() => update('reducedMotion', !settings.reducedMotion)} label="Menos movimento" /></div><div className="settings-language"><div><h3>Idioma</h3><p>A experiência está disponível em português.</p></div><select className="field" value={settings.language} onChange={event => update('language', event.target.value)} aria-label="Idioma"><option value="pt-BR">Português (Brasil)</option></select></div><div className="settings-save-row"><span role="status">{saved ? 'Preferências salvas' : 'Seus ajustes ficam neste navegador.'}</span><button className="btn btn-primary" onClick={savePreferences}>Salvar preferências<Check size={15} /></button></div></section>}
    {activeTab==='data' && <section className="settings-section"><div className="settings-section-heading"><h2>Meus dados</h2><p>Você tem o controle dos seus projetos.</p></div><div className="settings-data-card"><div className="settings-pref-icon"><Download size={20} /></div><div><h3>Leve suas ideias com você</h3><p>Baixe um JSON com os projetos, perfis e preferências desta conta no navegador. Os arquivos de mídia devem ser baixados na biblioteca.</p><button className="btn btn-ghost" onClick={exportData}><ArrowDownToLine size={16} />Exportar meus dados</button></div></div><div className="settings-data-stat"><span><FolderOpen size={17} />Projetos neste navegador</span><strong>{assets.length}</strong></div><div className="settings-reset"><h3>Recomeçar as preferências</h3><p>Restaure o perfil criativo e os ajustes de interface. Sua conta, biblioteca e perfis criativos são preservados.</p>{backup ? <button className="btn btn-ghost" onClick={undoRestore}><ArrowLeft size={15} />Desfazer restauração</button> : <button className="btn btn-ghost" onClick={() => setClearOpen(true)}>Restaurar preferências<Trash2 size={15} /></button>}</div></section>}
  </motion.div></AnimatePresence></div></div><AnimatePresence>{clearOpen && <Dialog title="Restaurar suas preferências?" onClose={() => setClearOpen(false)}><p className="sec-dialog-copy">O perfil criativo e os ajustes de interface voltarão aos valores iniciais. O nome e o e-mail da sua conta serão preservados. Você poderá desfazer enquanto permanecer nesta página.</p><div className="sec-dialog-footer"><button className="btn btn-ghost" onClick={() => setClearOpen(false)}>Cancelar</button><button className="btn btn-primary" onClick={restorePreferences}>Restaurar</button></div></Dialog>}</AnimatePresence></div>;
}

interface CreatorProfile { id: string; name: string; bio: string; image: string; voice: string; consent: boolean; sample?: boolean; color: string }


function ProfileVisual({ profile }: { profile: CreatorProfile }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [profile.image]);
  if (!profile.sample && profile.image && !failed) {
    return <img src={profile.image} alt={`Referência visual de ${profile.name}`} onError={() => setFailed(true)} loading="lazy" />;
  }
  const initials = profile.name.trim().split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'V';
  return <div className="profile-monogram-art" aria-hidden="true"><span className="profile-art-orbit" /><span className="profile-art-orbit profile-art-orbit-secondary" /><span className="profile-monogram">{initials}</span><span className="profile-art-point" /></div>;
}

export function ProfilesPage({ onNotify, onNavigate }: SecondaryPageProps) {
  const [profiles, setProfiles] = useState<CreatorProfile[]>(() => readLocal('velora:profiles', []));
  const [editing, setEditing] = useState<CreatorProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<CreatorProfile | null>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [voice, setVoice] = useState('Suave e natural');
  const [consent, setConsent] = useState(false);
  const updateProfiles = (next: CreatorProfile[], message: string) => { setProfiles(next); onNotify(persistLocal('velora:profiles', next) ? message : 'Perfis atualizados nesta sessão. O navegador não permitiu salvar.'); };
  const openForm = (profile: CreatorProfile | null) => { setEditing(profile); setName(profile?.name || ''); setBio(profile?.bio || ''); setImageUrl(profile?.image || ''); setVoice(profile?.voice || 'Suave e natural'); setConsent(profile?.consent || false); setOpen(true); };
  const saveProfile = () => {
    const profile: CreatorProfile = { id: editing?.id || crypto.randomUUID(), name: name.trim(), bio: bio.trim(), image: imageUrl.trim(), voice, consent, sample: editing?.sample || false, color: editing?.color || '#bd4052' };
    updateProfiles(editing ? profiles.map(item => item.id === editing.id ? profile : item) : [...profiles, profile], editing ? 'Perfil atualizado neste navegador.' : 'Perfil criativo criado.');
    setOpen(false);
  };
  return <div className="sec-page profiles-page"><PageIntro eyebrow="IDENTIDADE EM CADA DETALHE" title="Perfis criativos" description="Suas referências, direção de voz e estilo, sempre à mão."><button className="btn btn-primary" onClick={() => openForm(null)}><Plus size={17} />Novo perfil</button></PageIntro><div className="profiles-summary"><span><strong>{profiles.length}</strong> {profiles.length === 1 ? 'perfil no seu espaço' : 'perfis no seu espaço'}</span><span>Uma identidade para cada projeto.</span></div><div className="profiles-grid">{profiles.map((profile, index) => <motion.article key={profile.id} className="profile-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .06 }}><div className={`profile-cover ${profile.sample || !profile.image ? 'profile-cover-abstract' : ''}`} style={{ '--profile-accent': profile.sample ? '#ff4059' : profile.color } as CSSProperties}><ProfileVisual profile={profile} /><div className="profile-cover-shade" /><span className="profile-status"><span />{profile.sample ? 'Exemplo' : 'Perfil criativo'}</span><button className="profile-cover-edit" aria-label={`Editar ${profile.name}`} onClick={() => openForm(profile)}><MoreHorizontal size={21} /></button><div className="profile-cover-name"><h2>{profile.name}</h2><span><Volume2 size={13} />{profile.voice}</span></div></div><div className="profile-card-body"><p>{profile.bio || 'Adicione uma descrição para definir a direção criativa deste perfil.'}</p><div className="profile-reference-info"><span><Image size={13} />{profile.image ? 'Referência visual' : 'Sem referência'}</span>{!profile.sample && <span><ShieldCheck size={13} />Uso autorizado</span>}</div><div className="profile-card-actions"><button className="btn btn-ghost" onClick={() => { if (!persistLocal('velora:active-profile', profile)) { onNotify('Não foi possível selecionar o perfil: o navegador não permitiu salvar.'); return; } onNavigate('images'); onNotify(`Perfil ${profile.name} selecionado para suas referências.`); }}>Criar com este perfil<ArrowRight size={15} /></button><button className="sec-icon-button" aria-label={`Excluir perfil ${profile.name}`} onClick={() => setToDelete(profile)}><Trash2 size={15} /></button></div></div></motion.article>)}<button className="profile-add-card" onClick={() => openForm(null)}><span><Plus size={28} /></span><strong>Novo perfil</strong><p>Um ponto de partida só seu.</p></button></div><div className="sec-local-footnote"><ShieldCheck size={14} />Suas referências ficam neste navegador, separadas por conta.</div><AnimatePresence>{open && <Dialog title={editing ? 'Ajuste seu universo criativo.' : 'Um novo universo criativo.'} onClose={() => setOpen(false)}><form onSubmit={event => { event.preventDefault(); saveProfile(); }}><label className="sec-form-label" htmlFor="creator-name">Nome do perfil</label><input className="field" id="creator-name" placeholder="Ex.: Meu estúdio" maxLength={40} required value={name} onChange={event => setName(event.target.value)} /><label className="sec-form-label" htmlFor="creator-bio">Direção criativa</label><textarea className="field profiles-textarea" id="creator-bio" rows={3} placeholder="Estilo, personalidade, iluminação favorita..." maxLength={240} value={bio} onChange={event => setBio(event.target.value)} /><label className="sec-form-label" htmlFor="creator-image">Link da referência visual <span>opcional</span></label><input className="field" id="creator-image" type="url" placeholder="https://..." value={imageUrl} onChange={event => setImageUrl(event.target.value)} /><label className="sec-form-label" htmlFor="creator-voice">Direção de voz</label><select className="field" id="creator-voice" value={voice} onChange={event => setVoice(event.target.value)}><option>Suave e natural</option><option>Expressiva e próxima</option><option>Calma e acolhedora</option><option>Energética e espontânea</option><option>A definir no estúdio</option></select><label className="profiles-consent"><input type="checkbox" checked={consent} required onChange={event => setConsent(event.target.checked)} /><span>Tenho autorização para usar as referências deste perfil. A direção de voz é uma preferência. Este perfil não clona vozes.</span></label><div className="sec-dialog-footer"><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancelar</button><button type="submit" className="btn btn-primary">{editing ? 'Salvar perfil' : 'Criar perfil'}<Check size={16} /></button></div></form></Dialog>}</AnimatePresence><AnimatePresence>{toDelete && <Dialog title="Excluir este perfil?" onClose={() => setToDelete(null)}><p className="sec-dialog-copy">O perfil “{toDelete.name}” será removido deste navegador. Os projetos da biblioteca serão preservados.</p><div className="sec-dialog-footer"><button className="btn btn-ghost" onClick={() => setToDelete(null)}>Cancelar</button><button className="btn btn-primary" onClick={() => { updateProfiles(profiles.filter(profile => profile.id !== toDelete.id), 'Perfil removido.'); setToDelete(null); }}>Excluir perfil<Trash2 size={15} /></button></div></Dialog>}</AnimatePresence></div>;
}
