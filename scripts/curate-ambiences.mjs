import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat, readdir, lstat, unlink } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MANIFEST = resolve(ROOT, 'shared/bundled-assets.json');
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const COMMIT = '07cbb6f8779a4a448d02355c355f0cef8916b78d';
const REPO = 'https://github.com/itsmusician/IR-Library';
const sha = value => createHash('sha256').update(value).digest('hex');
const clean = value => value.replace(/<[^>]*>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const fsound = (user, id) => `https://freesound.org/people/${user}/sounds/${id}/`;
// Each bed below has its own field recording. Crowds can include intelligible speech:
// neither a source title nor a CC0 license proves the absence of third-party content.
export const BED_SOURCES = [
  { environment: 'office', source: fsound('Walter_Odington', 32380), label: 'Escritório · digitação em Londres', author: 'Walter_Odington', start: 8 },
  { environment: 'elevator', source: fsound('CHallSmith', 870761), label: 'Elevador · ar e mecanismo constantes', author: 'Craig Hall Smith', start: 2 },
  { environment: 'garage', source: fsound('kyles', 452291), label: 'Garagem · ventilação próxima', author: 'kyles', start: 8 },
  { environment: 'beach', source: fsound('felix.blume', 384110), label: 'Praia · ondas em Antiguinhos, Brasil', author: 'Félix Blume', start: 20 },
  { environment: 'fireplace', source: fsound('courter', 447818), label: 'Lareira · lenha queimando e estalos', author: 'Christopher C. Courter', start: 20 },
  { environment: 'night', source: fsound('kvgarlic', 810306), label: 'Noite · grilos de madrugada', author: 'kvgarlic', start: 20 },
  { environment: 'restaurant', source: 'https://bigsoundbank.com/restaurant-3-s3377.html', label: 'Restaurante · brunch com movimento', author: 'Joseph Sardin e Axeline T.', start: 8 },
  { environment: 'bar', source: fsound('conleec', 212102), label: 'Bar · conversas no Lean-To', author: 'conleec', start: 15 },
  { environment: 'party', source: fsound('JohnsonBrandEditing', 243373), label: 'Festa · pessoas conversando antes do show', author: 'JohnsonBrandEditing', start: 0 },
  { environment: 'supermarket', source: fsound('ivolipa', 328732), label: 'Mercado · movimento na loja', author: 'ivolipa', start: 6 },
  { environment: 'gym', source: fsound('DAVESTALKER', 248247), label: 'Academia · cardio e pesos em uso', author: 'DAVESTALKER', start: 0 },
  { environment: 'car', source: fsound('bmacphail', 795866), label: 'Carro · cabine na estrada, piso molhado', author: 'bmacphail', start: 35 },
  { environment: 'subway', source: 'https://bigsoundbank.com/recent-metro-interior-s3042.html', label: 'Metrô · interior de vagão em Paris', author: 'Joseph Sardin', start: 12 },
  { environment: 'train', source: fsound('waweee', 517992), label: 'Trem · interior na viagem de Jacarta', author: 'waweee', start: 20 },
  { environment: 'airplane', source: fsound('jasonm911', 853737), label: 'Avião · cabine durante o voo', author: 'jasonm911', start: 12 },
  { environment: 'rain-window', source: fsound('nicoproson', 648529), label: 'Chuva · gotas no vidro da janela', author: 'nicoproson', start: 15 },
  { environment: 'rain-roof', source: fsound('frenkfurth', 650428), label: 'Chuva · cobertura plástica', author: 'frenkfurth', start: 20 },
  { environment: 'narrow-street', source: 'https://bigsoundbank.com/little-parisian-street-s1713.html', label: 'Rua estreita · Rue des Croissants, Paris', author: 'Joseph Sardin', start: 8 },
  { environment: 'courtyard', source: fsound('Garuda1982', 852253), label: 'Pátio · árvores, pessoas e cidade', author: 'Garuda1982', start: 10 },
  { environment: 'park', source: fsound('felix.blume', 667060), label: 'Parque · pássaros e trânsito distante', author: 'Félix Blume', start: 20 },
];
export const IR_SOURCES = [
  { environment: 'office', path: 'Rooms/Residential/College House/College House Office.wav', label: 'Escritório residencial · College House', wet: 0.07 },
  { environment: 'elevator', path: 'Rooms/Public/Convention Centers/Orange County Convention Center/OCCC Freight Elevator.wav', label: 'Elevador de carga · OCCC', wet: 0.08 },
  { environment: 'cafe', path: 'Rooms/Commercial/Shops/Gold Coffee Shop/Gold Coffee Shop Lobby Corner.wav', label: 'Café · canto do salão Gold Coffee Shop', wet: 0.09 },
];

export function parseSourcePage(html, source) {
  const url = new URL(source);
  if (url.hostname === 'freesound.org') {
    if (!/title=["']Go to the full license text["'][^>]*href=["']https?:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\//.test(html)) throw new Error('A licença do próprio arquivo não confirma CC0.');
    const media = html.match(/data-static-file-url=["']([^"']+)["']/)?.[1];
    if (!media || new URL(media).hostname !== 'cdn.freesound.org') throw new Error('Preview público HQ não encontrado.');
    return { media, sourceFormat: 'public-hq-preview', title: clean(html.match(/<title>([\s\S]+?)<\/title>/i)?.[1] || ''), description: clean(html.match(/<meta name=["']twitter:description["'] content="([^"]*)/i)?.[1] || '') };
  }
  if (url.hostname === 'bigsoundbank.com') {
    if (!/CC0 \(public domain\): Free and royalty-free/.test(html)) throw new Error('A página não confirma CC0.');
    const media = html.match(/"encodingFormat":"audio\/flac","contentUrl":"([^"<>]+)"/)?.[1];
    if (!media || new URL(media).hostname !== 'bigsoundbank.com') throw new Error('Original FLAC público não encontrado.');
    const description = html.match(/"name":"[^"<>]+","description":"([^"<>]*)"/)?.[1] || '';
    return { media, sourceFormat: 'published-lossless', title: clean(html.match(/<title>([\s\S]+?)<\/title>/i)?.[1] || ''), description: clean(description) };
  }
  throw new Error('Fonte pública não suportada.');
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 120_000 });
  if (result.status !== 0) throw new Error(`${command}: ${result.error?.message || result.stderr.slice(-800)}`);
  return result;
}
function probe(file) { return JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=channels,sample_rate,codec_name,bits_per_raw_sample', '-of', 'json', file]).stdout); }
async function download(url, destination, fetchImpl = fetch) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(240_000), redirect: 'follow' });
  if (!response.ok) throw new Error(`Download HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > 64 * 1024 * 1024) throw new Error('Fonte maior que 64 MiB.');
  const parts = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 64 * 1024 * 1024) throw new Error('Fonte maior que 64 MiB.'); parts.push(chunk); }
  const bytes = Buffer.concat(parts, size); await writeFile(destination, bytes); return bytes;
}
async function atomicManifest(manifest, path = MANIFEST) {
  const temporary = `${path}.tmp`; await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n'); await rename(temporary, path);
}
function technicalLevels(file, start = 0, duration, applyHighpass = false) {
  const output = run('ffmpeg', ['-nostdin', '-hide_banner', '-ss', String(start), '-i', file, ...(duration ? ['-t', String(duration)] : []), '-af', `${applyHighpass ? 'highpass=f=20,' : ''}astats=metadata=0:reset=0`, '-f', 'null', '-']).stderr;
  const overall = output.slice(output.lastIndexOf('Overall'));
  const peakDb = Number(overall.match(/Peak level dB:\s*([-\d.]+)/)?.[1]);
  const rmsDb = Number(overall.match(/RMS level dB:\s*([-\d.]+)/)?.[1]);
  if (!Number.isFinite(peakDb) || !Number.isFinite(rmsDb) || rmsDb < -80) throw new Error('Áudio inválido ou essencialmente silencioso.');
  return { peakDb, rmsDb };
}
export async function auditBundle({ manifestPath = MANIFEST, publicDir = resolve(ROOT, 'public') } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const rows = [];
  for (const entry of [...manifest.beds, ...manifest.irs]) {
    const file = resolve(publicDir, entry.file), bytes = await readFile(file);
    if (sha(bytes) !== entry.sha256) throw new Error(`Hash inválido: ${entry.environment}`);
    rows.push({ environment: entry.environment, kind: entry.acoustic ? 'ir' : 'bed', bytes: bytes.length, durationSeconds: entry.durationSeconds, file: entry.file });
  }
  let totalBytes = 0;
  async function total(directory) { for (const child of await readdir(directory, { withFileTypes: true })) { const path = resolve(directory, child.name); if (child.isDirectory()) await total(path); else if (child.isFile()) totalBytes += (await stat(path)).size; } }
  await total(resolve(publicDir, 'audio'));
  return { rows, totalBytes };
}

export async function curate({ ids, fetchImpl = fetch, log = console.log } = {}) {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const rawDir = resolve(ROOT, '.cache/ambience-sources'); await mkdir(rawDir, { recursive: true });
  const existing = manifest.beds.map(entry => ({ environment: entry.environment, source: entry.source, label: entry.label, author: entry.environment === 'cafe' ? 'Marble Toast' : entry.author || new URL(entry.source).pathname.split('/')[2] || 'Autor na página de origem', legacy: entry }));
  const plans = [...existing.filter(entry => !BED_SOURCES.some(plan => plan.environment === entry.environment)), ...BED_SOURCES].filter(entry => !ids || ids.includes(entry.environment));
  for (const plan of plans) {
    log(`Preparando ${plan.environment}: ${plan.source}`);
    // Refresh the original page license instead of treating a search result as permission.
    let verified;
    if (new URL(plan.source).hostname === 'commons.wikimedia.org') {
      const response = await fetchImpl(plan.source, { signal: AbortSignal.timeout(30_000) });
      const html = await response.text(); if (!response.ok || !/creativecommons.org\/publicdomain\/zero\/1.0/.test(html)) throw new Error('CC0 de Wikimedia não confirmado.');
      verified = { media: plan.legacy.original.url, sourceFormat: 'published-ogg', title: plan.label, description: plan.legacy.original.description || 'Gravação de café publicada sob CC0.' };
    } else {
      const response = await fetchImpl(plan.source, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Fonte ${plan.environment}: HTTP ${response.status}. Execute de novo apenas quando a origem estiver disponível; não há retry automático.`);
      verified = parseSourcePage(await response.text(), plan.source);
    }
    const input = resolve(rawDir, `${plan.environment}-${sha(verified.media).slice(0, 12)}${extname(new URL(verified.media).pathname) || '.audio'}`);
    let originalBytes;
    try { originalBytes = await readFile(input); } catch {
      // Historical source downloads can be reused only when their original hash matches.
      if (plan.legacy?.original?.sha256) {
        try { const known = await readFile(resolve(ROOT, '.qa/audio-originals', `${plan.environment}${extname(new URL(verified.media).pathname)}`)); if (sha(known) === plan.legacy.original.sha256) originalBytes = known; } catch { /* Fresh source below. */ }
      }
      if (!originalBytes) originalBytes = await download(verified.media, input, fetchImpl);
      else await writeFile(input, originalBytes);
    }
    const originalInfo = probe(input), originalDuration = Number(originalInfo.format.duration);
    const originalChannels = Number(originalInfo.streams[0].channels);
    const start = plan.start ?? plan.legacy?.original?.segmentStartSeconds ?? 0;
    const duration = Math.min(45, originalDuration - start);
    if (!Number.isFinite(duration) || duration < 15) throw new Error(`Trecho curto demais: ${plan.environment}`);
    const file = `audio/ambiences/${plan.environment}.flac`, output = resolve(ROOT, 'public', file); await mkdir(dirname(output), { recursive: true });
    const temporary = `${output}.tmp.flac`;
    // Preserve the captured mono/stereo perspective. No fake widening, music, synthesis,
    // denoising or loudness compression is added. A constant gain makes quiet source
    // previews usable, with -3 dBFS peak headroom; natural dynamics remain untouched.
    const level = technicalLevels(input, start, duration, true); const gainDb = Math.min(-26 - level.rmsDb, -3 - level.peakDb);
    const filters = `highpass=f=20,volume=${gainDb.toFixed(3)}dB,afade=t=in:d=0.025,afade=t=out:st=${Math.max(0, duration - 0.025).toFixed(6)}:d=0.025`;
    run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', input, '-t', String(duration), '-map_metadata', '-1', '-af', filters, '-ar', '48000', '-ac', String(Math.min(2, originalChannels)), '-sample_fmt', 's16', '-c:a', 'flac', '-compression_level', '8', temporary]);
    const finalLevels = technicalLevels(temporary), bytes = await readFile(temporary), info = probe(temporary); await rename(temporary, output);
    const notes = `${verified.sourceFormat === 'published-lossless' ? 'Original FLAC publicado pelo autor' : verified.sourceFormat === 'published-ogg' ? 'Arquivo público OGG Vorbis; a origem tem compressão com perdas' : 'Preview público HQ do Freesound; a origem tem compressão com perdas'}. Trecho ${start.toFixed(2)}–${(start + duration).toFixed(2)} s; FLAC 48 kHz/16-bit ${originalChannels === 1 ? 'mono preservado' : 'estéreo'}, corte abaixo de 20 Hz e fades de 25 ms. Ganho fixo ${gainDb.toFixed(2)} dB, referência RMS -26 dBFS limitada por pico -3 dBFS. Sem síntese, redução de ruído ou compressão dinâmica. Sem escuta de aprovação; falas e sons incidentais podem existir.`;
    const entry = { environment: plan.environment, id: `${plan.environment}-field-v2`, file, source: plan.source, license: 'cc0', licenseUrl: CC0, author: plan.author, title: verified.title, sha256: sha(bytes), label: plan.label, reviewed: false, notes, durationSeconds: Number(info.format.duration), technical: { ...finalLevels, sampleRate: 48000, bitDepth: 16, channels: Math.min(2, originalChannels), gainDb, sourcePeakDb: level.peakDb, sourceRmsDb: level.rmsDb, sourceFormat: verified.sourceFormat, sourceCodec: originalInfo.streams[0].codec_name, sourceCompressed: !['flac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le'].includes(originalInfo.streams[0].codec_name) }, original: { url: verified.media, sha256: sha(originalBytes), durationSeconds: originalDuration, segmentStartSeconds: start, segmentDurationSeconds: duration, description: verified.description } };
    const index = manifest.beds.findIndex(item => item.environment === plan.environment); if (index < 0) manifest.beds.push(entry); else manifest.beds[index] = entry;
    await atomicManifest(manifest); log(`${plan.environment}: ${(bytes.length / 1024 / 1024).toFixed(2)} MiB, ${duration.toFixed(2)} s, pico ${finalLevels.peakDb.toFixed(1)} dBFS`);
    await new Promise(done => setTimeout(done, 1500));
  }
  return manifest;
}

/** Public CC0 source downloads only; four independent transfers, no provider APIs. */
export async function prefetchSources({ ids, fetchImpl = fetch, log = console.log } = {}) {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const rawDir = resolve(ROOT, '.cache/ambience-sources'); await mkdir(rawDir, { recursive: true });
  const pending = BED_SOURCES.filter(plan => (!ids || ids.includes(plan.environment)) && !manifest.beds.some(entry => entry.environment === plan.environment && entry.source === plan.source && entry.file.endsWith('.flac')));
  for (let i = 0; i < pending.length; i += 4) {
    const batch = pending.slice(i, i + 4);
    const results = await Promise.allSettled(batch.map(async plan => {
      log(`Baixando fonte pública: ${plan.environment}`);
      const response = await fetchImpl(plan.source, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const verified = parseSourcePage(await response.text(), plan.source);
      const input = resolve(rawDir, `${plan.environment}-${sha(verified.media).slice(0, 12)}${extname(new URL(verified.media).pathname) || '.audio'}`);
      try { await stat(input); } catch { await download(verified.media, input, fetchImpl); }
      return plan.environment;
    }));
    results.forEach((result, index) => log(result.status === 'fulfilled' ? `Fonte disponível: ${result.value}` : `Fonte pendente ${batch[index].environment}: ${result.reason.message}`));
  }
}

export async function addImpulseResponses({ fetchImpl = fetch, log = console.log } = {}) {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  for (const plan of IR_SOURCES) {
    const path = plan.path.split('/').map(encodeURIComponent).join('/'), url = `https://raw.githubusercontent.com/itsmusician/IR-Library/${COMMIT}/${path}`;
    const raw = resolve(ROOT, '.cache/ambience-sources', `${plan.environment}-ir.wav`), bytes = await download(url, raw, fetchImpl); const info = probe(raw);
    const originalDuration = Number(info.format.duration), file = `audio/impulses/${plan.environment}.wav`, output = resolve(ROOT, 'public', file);
    run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-t', '4', '-map_metadata', '-1', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output]);
    const final = await readFile(output);
    const notes = 'IR de local identificado na biblioteca criativa de Conner. PCM16 estéreo 48 kHz; duração limitada a 4 s. Não é medição científica de uma sala do usuário. Janela direta inicial 0–5 ms, sem confirmação auditiva.';
    const entry = { environment: plan.environment, id: `${plan.environment}-room-v2`, file, source: `${REPO}/blob/${COMMIT}/${path}`, license: 'mit', licenseUrl: `${REPO}/blob/${COMMIT}/License.md`, author: 'Conner', sha256: sha(final), label: plan.label, reviewed: false, notes, durationSeconds: Number(probe(output).format.duration), acoustic: { directSound: 'included', directArrivalMs: 0, directWindowMs: 5, predelayMode: 'embedded', predelayMs: 0, wet: plan.wet, notes }, original: { url, sha256: sha(bytes), durationSeconds: originalDuration } };
    const index = manifest.irs.findIndex(item => item.environment === plan.environment); if (index < 0) manifest.irs.push(entry); else manifest.irs[index] = entry;
    log(`${plan.environment} IR: ${entry.durationSeconds.toFixed(3)} s`);
  }
  const bathroom = manifest.irs.find(entry => entry.environment === 'bathroom');
  if (bathroom) {
    bathroom.acoustic.wet = 0.14;
    const shower = { ...structuredClone(bathroom), environment: 'shower', id: 'shower-room-v2', label: 'Chuveiro · acústica de banheiro pequeno', acoustic: { ...bathroom.acoustic, wet: 0.12 }, aliasOf: 'bathroom', notes: 'Alias acústico explícito do IR Reflective Half Bathroom. Compartilha apenas a resposta de banheiro; o fundo de água tem gravação independente. Janela direta inicial 0–5 ms, não uma medição confirmada. Sem escuta de aprovação.' };
    shower.acoustic.notes = shower.notes;
    const index = manifest.irs.findIndex(item => item.environment === 'shower'); if (index < 0) manifest.irs.push(shower); else manifest.irs[index] = shower;
  }
  await atomicManifest(manifest); return manifest;
}

export async function refreshMeasurements() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  for (const entry of manifest.beds) {
    if (!entry.technical) continue;
    Object.assign(entry.technical, technicalLevels(resolve(ROOT, 'public', entry.file)));
    if (entry.original?.url) {
      const original = resolve(ROOT, '.cache/ambience-sources', `${entry.environment}-${sha(entry.original.url).slice(0, 12)}${extname(new URL(entry.original.url).pathname) || '.audio'}`);
      const codec = probe(original).streams[0].codec_name;
      entry.technical.sourceCodec = codec;
      entry.technical.sourceCompressed = !['flac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le'].includes(codec);
    }
    if (entry.environment === 'cafe') {
      entry.author = 'Marble Toast';
      entry.notes = entry.notes.replace('Original público OGG.', 'Arquivo público OGG Vorbis; a origem tem compressão com perdas.');
    }
  }
  await atomicManifest(manifest);
}

/** Attribution and technical inventory generated from the files actually shipped. */
export async function writeSourceDocumentation() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const audit = await auditBundle();
  const lines = [
    '# Gravações incluídas no Velora', '',
    'São candidatos sem aprovação auditiva. A conferência de formato, hash, nível e licença não substitui ouvir cada trecho com a voz escolhida. Falas, impactos e sons incidentais podem existir.', '',
    '## Preparação e limites', '',
    `O catálogo tem 37 cenários: ${manifest.beds.length} fundos de gravações distintas e cinco cenários silenciosos. Os fundos têm 45 segundos e são repetidos com transição quando o projeto é maior. O pacote de áudio ocupa ${(audit.totalBytes / 1024 / 1024).toFixed(2)} MiB; não inclui arquivos de cache de pesquisa.`, '',
    'Cada fundo usa FLAC 48 kHz/16-bit e mantém mono ou estéreo da fonte. Há filtro abaixo de 20 Hz, ganho fixo visando RMS -26 dBFS, limitado pelo pico -3 dBFS, e fades de 25 ms nas bordas. Não foi aplicada síntese, redução de ruído, compressor ou expansão artificial de estéreo. O ganho respeita a dinâmica da gravação; alguns trechos ficam abaixo da referência RMS para preservar picos.', '',
    'FLAC evita outra compressão com perdas nesta preparação. Ele não recupera detalhes que já foram perdidos no preview MP3 HQ do Freesound ou no OGG Vorbis do café. As três fontes BigSoundBank são arquivos FLAC publicados pelo autor. SHA-256 de entrada, SHA-256 do arquivo servido, recorte, codec, ganho, RMS e pico estão em shared/bundled-assets.json.', '',
    'Banheiro, quarto, sala, biblioteca e estúdio não recebem fundo automaticamente. Banheiro, quarto e sala possuem IRs de locais identificados; biblioteca usa o preset acústico do motor e estúdio é seco. A biblioteca de IRs é criativa, sem garantia de calibração científica. O chuveiro compartilha explicitamente somente o IR do banheiro, com envio menor; sua gravação de água é independente.', '',
    '## Ambientes — CC0', '',
  ];
  for (const entry of manifest.beds) {
    const t = entry.technical;
    lines.push(`- **${entry.label}** — ${entry.author}. [Fonte original](${entry.source}), [CC0](${entry.licenseUrl}). Trecho ${entry.original.segmentStartSeconds.toFixed(2)}–${(entry.original.segmentStartSeconds + entry.durationSeconds).toFixed(2)} s; ${t.channels === 1 ? 'mono' : 'estéreo'}; origem ${t.sourceCodec}${t.sourceCompressed ? ' com perdas' : ' sem perdas'}. Ganho ${t.gainDb.toFixed(2)} dB; RMS ${t.rmsDb.toFixed(2)} dBFS; pico ${t.peakDb.toFixed(2)} dBFS. Ainda não revisado por escuta.`);
  }
  lines.push('', '## Respostas de sala — MIT', '');
  for (const entry of manifest.irs) {
    lines.push(`- **${entry.label}** — Conner. [Arquivo da fonte](${entry.source}), [licença MIT](${entry.licenseUrl}). PCM16 estéreo 48 kHz, ${entry.durationSeconds.toFixed(3)} s; envio inicial ${(entry.acoustic.wet * 100).toFixed(0)}%.${entry.aliasOf ? ` Alias acústico de **${entry.aliasOf}**, mesmo arquivo de IR; não duplica o fundo.` : ''} Janela direta de 0–5 ms é um ajuste inicial, sem confirmação auditiva. Ainda não revisado por escuta.`);
  }
  lines.push('', 'O aviso integral de copyright e a licença MIT de Conner acompanham os arquivos em [impulses/LICENSE-IR-Library.txt](impulses/LICENSE-IR-Library.txt).', '', '## Diferenças de captação', '',
    '- Cozinha: geladeira e janela aberta, em vez de uma cozinha sempre com utensílios.',
    '- Garagem: ventilação próxima com vibração, em vez de ventilação necessariamente distante.',
    '- Academia: cardio, pesos, contatos metálicos e conversas; não há garantia de impactos raros.',
    '- Carro: cabine de Prius em estrada com piso molhado, sem alegar asfalto seco.',
    '- Festa: pessoas conversando antes de um show; não é uma gravação de música de festa.',
    '- Chuva no teto: cobertura plástica; não é telhado de todos os materiais.',
    '- Chuva simples: chuva leve em floresta. Chuva na janela e chuva no teto têm fontes independentes.',
    '', '## Reprodução do preparo', '',
    'node scripts/curate-ambiences.mjs — auditoria local, sem rede ou cobrança. --prefetch baixa fontes públicas CC0 em quatro transferências independentes; --download ID prepara apenas os cenários indicados e atualiza o manifesto sequencialmente; --irs acrescenta IRs MIT; --measure atualiza a medição real; --prune remove somente MP3s antigos substituídos por FLAC íntegro; --docs atualiza este inventário. Não há chamadas ElevenLabs neste script.', '',
    'npm run audio:prepare — apenas verifica disponibilidade. Só --generate pode pedir geração ElevenLabs para cenários ausentes. Com as 32 gravações incluídas, não há ambiente de fundo ausente para gerar.', '');
  await writeFile(resolve(ROOT, 'public/audio/SOURCES.md'), lines.join('\n'));
}

/** Remove only superseded MP3s for intact FLAC beds, inside the fixed asset directory. */
export async function pruneSuperseded({ manifestPath = MANIFEST, publicDir = resolve(ROOT, 'public') } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await auditBundle({ manifestPath, publicDir });
  const referenced = new Set([...manifest.beds, ...manifest.irs].map(entry => entry.file));
  const directory = resolve(publicDir, 'audio/ambiences'); const removed = [];
  for (const entry of manifest.beds) {
    if (!/^[a-z0-9-]{1,80}$/.test(entry.environment) || entry.file !== `audio/ambiences/${entry.environment}.flac`) continue;
    const relative = `audio/ambiences/${entry.environment}.mp3`;
    if (referenced.has(relative)) continue;
    const target = resolve(directory, `${entry.environment}.mp3`);
    if (dirname(target) !== directory) throw new Error('Destino de limpeza fora da biblioteca.');
    try { const info = await lstat(target); if (!info.isFile() || info.isSymbolicLink()) continue; await unlink(target); removed.push(relative); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return removed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--prefetch')) await prefetchSources({ ids: args.filter(arg => !arg.startsWith('--')).length ? args.filter(arg => !arg.startsWith('--')) : undefined });
  if (args.includes('--download')) await curate({ ids: args.filter(arg => !arg.startsWith('--')).length ? args.filter(arg => !arg.startsWith('--')) : undefined });
  if (args.includes('--irs')) await addImpulseResponses();
  if (args.includes('--measure')) await refreshMeasurements();
  if (args.includes('--prune')) console.log('Arquivos substituídos removidos:', await pruneSuperseded());
  if (args.includes('--docs')) await writeSourceDocumentation();
  const audit = await auditBundle(); console.log(JSON.stringify({ entries: audit.rows.length, totalMiB: Number((audit.totalBytes / 1024 / 1024).toFixed(2)), missingBeds: BED_SOURCES.filter(plan => !audit.rows.some(row => row.kind === 'bed' && row.environment === plan.environment)).map(plan => plan.environment) }));
}
