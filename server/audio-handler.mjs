import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createAmbienceLibrary, DEFAULT_LIBRARY_DIR, detectAudioType, readAudioFile } from './ambience-library.mjs';
import { createBundledAssets, DEFAULT_BUNDLE_MANIFEST, DEFAULT_PUBLIC_DIR } from './bundled-assets.mjs';
import { inspectWav } from './wav-audio.mjs';
import { AccessError, createProductionAccess } from './production-access.mjs';

export const MODEL = 'eleven_v3';
export const SOUND_MODEL = 'eleven_text_to_sound_v2';
export const VOICE_CHANGE_MODEL = 'eleven_multilingual_sts_v2';
export const MAX_GUIDE_BYTES = 30 * 1024 * 1024;
export const MAX_GUIDE_SECONDS = 180;
const API_BASE = 'https://api.elevenlabs.io';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_BODY_BYTES = 32 * 1024;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const STABILITY = { natural: 0.5, soft: 1, expressive: 0 };
const VOICE_LABELS = new Set(['accent', 'age', 'description', 'gender', 'language', 'use_case', 'tone', 'style']);

class AudioError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const reject = (status, code, message) => { throw new AudioError(status, code, message); };

function json(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function binary(res, bytes, type = 'audio/mpeg', metadata, extraHeaders = {}, stream = false) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(200, { 'Content-Type': type, ...(stream ? {} : { 'Content-Length': bytes.length }), 'Cache-Control': 'no-store', ...(metadata ? { 'X-Ambience-Source': metadata.source, 'X-Ambience-Reviewed': String(metadata.reviewed), 'X-Ambience-Revision': metadata.revision, ...(metadata.provenance ? { 'X-Ambience-Provenance': encodeURIComponent(JSON.stringify(metadata.provenance)) } : {}), ...(metadata.metadata ? { 'X-Audio-Resource-Metadata': encodeURIComponent(JSON.stringify(metadata.metadata)) } : {}) } : {}), ...extraHeaders });
  if (!stream) { res.end(bytes); return; }
  // Node streaming is enabled on Vercel. Avoid a buffered response exceeding 4.5 MB.
  res.flushHeaders?.();
  for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
    if (res.destroyed || res.writableEnded) return;
    if (!res.write(bytes.subarray(offset, offset + 64 * 1024))) await new Promise(resolveDrain => {
      const done = () => { res.off('drain', done); res.off('close', done); res.off('error', done); resolveDrain(); };
      res.once('drain', done); res.once('close', done); res.once('error', done);
    });
  }
  if (!res.destroyed && !res.writableEnded) res.end();
}

async function readVoiceGuide(req, defaultVoiceId, { maxBytes = MAX_GUIDE_BYTES, maxSeconds = MAX_GUIDE_SECONDS, production = false } = {}) {
  const contentType = req.headers['content-type'] || '';
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !/boundary=/i.test(contentType)) reject(415, 'multipart_required', 'Envie a interpretação guia como arquivo WAV em formulário multipart.');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') reject(415, 'unsupported_encoding', 'Arquivos comprimidos no transporte não são aceitos.');
  const maxBodyBytes = maxBytes + 64 * 1024;
  const sizeMessage = production ? 'O áudio guia ultrapassa 4 MiB. Use WAV mono de 16 kHz com até 2 minutos.' : 'O áudio guia ultrapassa o limite de 30 MiB.';
  if (Number(req.headers['content-length']) > maxBodyBytes) reject(413, 'guide_too_large', sizeMessage);
  const chunks = []; let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > maxBodyBytes) { req.resume(); reject(413, 'guide_too_large', sizeMessage); }
    chunks.push(chunk);
  }
  let form;
  try { form = await new Response(Buffer.concat(chunks, length), { headers: { 'Content-Type': contentType } }).formData(); }
  catch { reject(400, 'invalid_multipart', 'O formulário do áudio guia não é válido.'); }
  const allowed = ['audio', 'voiceId', 'quality', 'removeBackgroundNoise'];
  for (const name of new Set(form.keys())) if (!allowed.includes(name) || form.getAll(name).length !== 1) reject(400, 'invalid_input', 'O formulário contém campos repetidos ou não suportados.');
  const file = form.get('audio');
  if (!(file instanceof Blob) || !file.size) reject(400, 'guide_required', 'Escolha ou grave uma interpretação guia antes de gerar.');
  if (file.size > maxBytes) reject(413, 'guide_too_large', sizeMessage);
  const bytes = Buffer.from(await file.arrayBuffer());
  let guide;
  try { guide = inspectWav(bytes, { pcm16Only: true, maxDurationSeconds: maxSeconds }); }
  catch { reject(400, 'invalid_guide_audio', production ? 'Use um WAV PCM16 mono de 16 kHz, com até 2 minutos.' : 'Use um WAV PCM de 16 bits, mono ou estéreo, com até 3 minutos. Converta a gravação antes de enviar.'); }
  if (production && (guide.channels !== 1 || guide.sampleRate !== 16000)) reject(400, 'invalid_guide_audio', 'Converta o guia para WAV PCM16 mono de 16 kHz antes de enviar.');
  const voiceId = form.get('voiceId') ?? defaultVoiceId;
  if (!validVoiceId(voiceId)) reject(400, 'invalid_voice', 'Escolha uma voz válida antes de gerar.');
  const quality = form.get('quality') ?? 'standard';
  if (!['standard', 'high'].includes(quality)) reject(400, 'invalid_quality', 'Escolha a qualidade padrão ou alta.');
  const removeBackgroundNoise = form.get('removeBackgroundNoise') ?? 'false';
  if (!['true', 'false'].includes(removeBackgroundNoise)) reject(400, 'invalid_noise_option', 'Escolha uma opção válida para remover o ruído do guia.');
  const payload = new FormData();
  payload.append('audio', new Blob([bytes], { type: 'audio/wav' }), 'guide.wav');
  payload.append('model_id', VOICE_CHANGE_MODEL); payload.append('file_format', 'other');
  payload.append('remove_background_noise', removeBackgroundNoise);
  return { voiceId, format: quality === 'high' ? 'mp3_44100_192' : 'mp3_44100_128', payload, durationSeconds: guide.durationSeconds };
}

function requireLocalRequest(req, port) {
  const ports = new Set([5173, 4173, 8787, port, req.socket?.localPort].filter(Number.isInteger));
  const validUrl = raw => {
    try {
      const value = new URL(raw);
      return value.protocol === 'http:' && LOCAL_HOSTS.has(value.hostname) && !value.username && !value.password && ports.has(Number(value.port || 80)) && value.pathname === '/' && !value.search && !value.hash;
    } catch { return false; }
  };
  if (typeof req.headers.host !== 'string' || !validUrl(`http://${req.headers.host}`)) reject(403, 'foreign_host', 'Este servidor aceita apenas acesso local.');
  if (req.headers.origin && !validUrl(req.headers.origin)) reject(403, 'foreign_origin', 'A origem desta solicitação não é permitida.');
  if (req.headers['sec-fetch-site'] === 'cross-site') reject(403, 'foreign_origin', 'A origem desta solicitação não é permitida.');
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(req.headers['content-type'] || '')) reject(415, 'json_required', 'Envie os dados como JSON.');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') reject(415, 'unsupported_encoding', 'JSON comprimido não é aceito.');
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) reject(413, 'body_too_large', 'A solicitação é grande demais.');
  const chunks = [];
  let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) { req.resume(); reject(413, 'body_too_large', 'A solicitação é grande demais.'); }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object');
    return body;
  } catch { reject(400, 'invalid_json', 'O JSON da solicitação não é válido.'); }
}

function onlyFields(body, fields) {
  if (Object.keys(body).some(field => !fields.includes(field))) reject(400, 'invalid_input', 'A solicitação contém campos não suportados.');
}

function validVoiceId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value); }

function speechPayload(body, defaultVoiceId) {
  onlyFields(body, ['text', 'voiceId', 'mood', 'speed', 'quality']);
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 5000) reject(400, 'invalid_text', 'Escreva um roteiro de 1 a 5.000 caracteres.');
  const voiceId = body.voiceId === undefined ? defaultVoiceId : body.voiceId;
  if (!validVoiceId(voiceId)) reject(400, 'invalid_voice', 'Escolha uma voz válida antes de gerar.');
  const mood = body.mood === undefined ? 'natural' : body.mood;
  if (typeof mood !== 'string' || !Object.hasOwn(STABILITY, mood)) reject(400, 'invalid_mood', 'Escolha uma interpretação válida.');
  const speed = body.speed === undefined ? 1 : body.speed;
  if (typeof speed !== 'number' || !Number.isFinite(speed)) reject(400, 'invalid_speed', 'Informe uma velocidade válida.');
  if (speed !== 1) reject(400, 'speed_not_supported', 'Eleven v3 usa tags como [slowly] e [rushed] para dirigir o ritmo. O controle numérico de velocidade não é suportado.');
  if (body.quality !== undefined && !['standard', 'high'].includes(body.quality)) reject(400, 'invalid_quality', 'Escolha a qualidade padrão ou alta.');
  return {
    voiceId,
    format: body.quality === 'high' ? 'mp3_44100_192' : 'mp3_44100_128',
    payload: { text: body.text, model_id: MODEL, language_code: 'pt', voice_settings: { stability: STABILITY[mood] } },
  };
}

function loadCatalog() {
  try {
    const catalog = JSON.parse(readFileSync(resolve(ROOT, 'shared/environments.json'), 'utf8'));
    return Array.isArray(catalog) ? catalog : [];
  } catch { return []; }
}

export function getAmbienceRecipe(environment) {
  const sound = environment.sound || {};
  const mode = sound.mode ?? (environment.id === 'studio' ? 'silent' : 'bed');
  const version = sound.version ?? 1;
  const durationSeconds = sound.durationSeconds ?? 15;
  const promptInfluence = sound.promptInfluence ?? 0.35;
  if (!['silent', 'bed'].includes(mode) || !Number.isInteger(version) || version < 1 || typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || typeof promptInfluence !== 'number' || !Number.isFinite(promptInfluence) || promptInfluence < 0 || promptInfluence > 1 || mode === 'bed' && (durationSeconds < 0.5 || durationSeconds > 30)) reject(503, 'environment_not_configured', 'As configurações deste ambiente não são válidas.');
  const revision = createHash('sha256').update(JSON.stringify([environment.id, SOUND_MODEL, version, mode, environment.prompt, durationSeconds, promptInfluence])).digest('hex');
  return { mode, version, durationSeconds, promptInfluence, revision };
}

function silentWav(seconds = 15) {
  const samples = seconds * 8000;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}

function safeText(value, key, fallback = '', max = 1000) {
  if (typeof value !== 'string') return fallback;
  return (key ? value.replaceAll(key, '[redacted]') : value).slice(0, max);
}

function voiceList(data, key) {
  if (!Array.isArray(data?.voices)) reject(502, 'invalid_provider_response', 'A lista de vozes não pôde ser carregada.');
  const voices = data.voices.filter(voice => validVoiceId(voice?.voice_id) && (!key || !voice.voice_id.includes(key))).map(voice => {
    const labels = {};
    if (voice.labels && typeof voice.labels === 'object' && !Array.isArray(voice.labels)) {
      for (const [label, value] of Object.entries(voice.labels)) if (VOICE_LABELS.has(label) && typeof value === 'string') labels[label] = safeText(value, key, '', 200);
    }
    let previewUrl;
    try { const url = new URL(voice.preview_url); if (url.protocol === 'https:' && !url.username && !url.password && !url.href.includes(key)) previewUrl = url.href; } catch { /* Optional public preview. */ }
    return { id: voice.voice_id, name: safeText(voice.name, key, 'Voz', 200), description: safeText(voice.description, key), ...(previewUrl ? { previewUrl } : {}), labels };
  });
  return { voices, hasMore: data.has_more === true, ...(typeof data.next_page_token === 'string' ? { nextPageToken: safeText(data.next_page_token, key, '', 2000) } : {}) };
}

async function providerError(response) {
  // Never expose an upstream message, prompt, header or API credential.
  let code;
  try { const body = await response.json(); code = body?.detail?.status; } catch { /* Generic status handling. */ }
  if (code === 'quota_exceeded' || code === 'insufficient_credits') reject(402, 'provider_quota_exceeded', 'O saldo da ElevenLabs é insuficiente para gerar este áudio.');
  if (response.status === 401 || response.status === 403) reject(502, 'provider_auth_failed', 'A ElevenLabs não autorizou a solicitação. Confira a chave e as permissões no servidor.');
  if (response.status === 429) reject(429, 'provider_rate_limited', 'A ElevenLabs está no limite de solicitações. Aguarde antes de tentar novamente.');
  if (response.status === 400 || response.status === 422) reject(400, 'provider_rejected', 'A ElevenLabs não aceitou estas configurações. Confira a voz, o roteiro e a qualidade selecionada.');
  reject(502, 'provider_unavailable', 'A ElevenLabs não conseguiu concluir a solicitação. Nenhuma repetição automática foi feita.');
}

const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

async function serveStatic(url, res, root) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { reject(400, 'invalid_path', 'O endereço não é válido.'); }
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) reject(404, 'not_found', 'Página não encontrada.');
  const base = resolve(root);
  let target = resolve(base, `.${pathname}`);
  if (target !== base && !target.startsWith(base + sep)) reject(404, 'not_found', 'Página não encontrada.');
  if (pathname === '/' || !extname(pathname)) target = resolve(base, 'index.html');
  let bytes;
  try { bytes = await readFile(target); } catch { reject(404, 'not_found', 'Página não encontrada. Execute o build para abrir a versão de produção.'); }
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(target)] || 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': extname(target) === '.html' ? 'no-store' : 'public, max-age=3600' });
  res.end(bytes);
}

/** Inject fetch/env/catalog in tests; importing this module never reads .env or calls a provider. */
export function createAudioHandler({ env = process.env, fetchImpl = globalThis.fetch, environments = loadCatalog(), production = env.VERCEL === '1', cacheDir = production ? resolve(tmpdir(), 'velora-ambience-cache') : resolve(ROOT, '.cache/audio'), libraryDir = production ? null : DEFAULT_LIBRARY_DIR, bundleManifestPath = DEFAULT_BUNDLE_MANIFEST, publicDir = DEFAULT_PUBLIC_DIR, timeoutMs = 120_000, maxConcurrency = 2, port = 8787, staticDir = production ? null : resolve(ROOT, 'dist') } = {}) {
  const apiKey = typeof env.ELEVENLABS_API_KEY === 'string' ? env.ELEVENLABS_API_KEY.trim() : '';
  const defaultVoiceId = validVoiceId(env.ELEVENLABS_DEFAULT_VOICE_ID) && (!apiKey || !env.ELEVENLABS_DEFAULT_VOICE_ID.includes(apiKey)) ? env.ELEVENLABS_DEFAULT_VOICE_ID : undefined;
  const catalog = new Map(environments.filter(item => typeof item?.id === 'string').map(item => [item.id, item]));
  const memory = new Map();
  const pending = new Map();
  const library = libraryDir ? createAmbienceLibrary({ rootDir: libraryDir }) : null;
  const bundles = createBundledAssets({ manifestPath: bundleManifestPath, publicDir });
  const access = createProductionAccess({ env, fetchImpl, production });
  const guideLimits = { production, maxBytes: production ? 4 * 1024 * 1024 : MAX_GUIDE_BYTES, maxSeconds: production ? 120 : MAX_GUIDE_SECONDS };
  const sendBinary = (res, bytes, type, metadata, headers) => binary(res, bytes, type, metadata, headers, production);
  let active = 0;

  const requireKey = () => { if (!apiKey) reject(503, 'provider_not_configured', 'Configure ELEVENLABS_API_KEY no servidor para usar a geração real.'); };
  const upstream = async (path, { method = 'GET', body, asJson = false, usage } = {}) => {
    requireKey();
    if (active >= Math.max(1, Math.min(maxConcurrency, 2))) reject(429, 'concurrency_limit', 'Já existem duas solicitações em andamento. Aguarde a conclusão.');
    active += 1;
    let lease, outcome = 'failed';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs); timeout.unref?.();
    try {
      if (usage) lease = await access.reserve(usage.userId, usage.operation, usage.units);
      const multipart = body instanceof FormData;
      const response = await fetchImpl(API_BASE + path, { method, headers: { 'xi-api-key': apiKey, Accept: asJson ? 'application/json' : 'audio/mpeg', ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}), signal: controller.signal, redirect: 'error' });
      if (!response.ok) await providerError(response);
      if (asJson) return await response.json();
      if (Number(response.headers.get('content-length')) > MAX_AUDIO_BYTES) reject(502, 'invalid_provider_response', 'O áudio recebido é grande demais.');
      const contentType = response.headers.get('content-type') || '';
      if (contentType && !/^(audio\/(mpeg|mp3)|application\/octet-stream)/i.test(contentType)) reject(502, 'invalid_provider_response', 'A ElevenLabs não devolveu um arquivo de áudio válido.');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) reject(502, 'invalid_provider_response', 'A ElevenLabs não devolveu um arquivo de áudio válido.');
      try { detectAudioType(bytes, 'response.mp3'); } catch { reject(502, 'invalid_provider_response', 'A ElevenLabs não devolveu um arquivo MP3 válido.'); }
      outcome = 'succeeded';
      return bytes;
    } catch (error) {
      if (error instanceof AudioError || error instanceof AccessError) throw error;
      if (controller.signal.aborted) { outcome = 'timeout'; reject(504, 'provider_timeout', 'A geração excedeu dois minutos. Nenhuma repetição automática foi feita.'); }
      reject(502, 'provider_unavailable', 'Não foi possível concluir a conexão com a ElevenLabs. Nenhuma repetição automática foi feita.');
    } finally { clearTimeout(timeout); if (lease) await access.finish(lease, outcome).catch(() => {}); active -= 1; }
  };

  const remember = (key, bytes) => {
    memory.delete(key); memory.set(key, bytes);
    let bytesInMemory = [...memory.values()].reduce((total, value) => total + value.length, 0);
    while (memory.size > 32 || bytesInMemory > MAX_AUDIO_BYTES) { const oldest = memory.keys().next().value; bytesInMemory -= memory.get(oldest).length; memory.delete(oldest); }
  };
  const readCached = async key => {
    if (memory.has(key)) { const bytes = memory.get(key); remember(key, bytes); return bytes; }
    if (cacheDir) {
      try { const { bytes } = await readAudioFile(resolve(cacheDir, `${key}.mp3`)); remember(key, bytes); return bytes; } catch { /* Invalid or missing cache is never exposed. */ }
    }
    return null;
  };
  const readyAsset = async (environment, recipe) => {
    if (recipe.mode === 'silent') return { bytes: silentWav(), type: 'audio/wav', source: 'silent', reviewed: false, revision: recipe.revision };
    const approved = await library?.readApproved(environment.id);
    if (approved) return approved;
    const recording = await bundles.readBed(environment.id);
    if (recording) return recording;
    const bytes = await readCached(recipe.revision);
    return bytes ? { bytes, type: 'audio/mpeg', source: 'cache', reviewed: false, revision: recipe.revision } : null;
  };
  const ambience = async (environment, recipe, userId) => {
    const existing = await readyAsset(environment, recipe);
    if (existing) return existing;
    const key = recipe.revision;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      if (typeof environment.prompt !== 'string' || !environment.prompt.trim() || environment.prompt.length > 2000) reject(503, 'environment_not_configured', 'O ambiente ainda não tem uma descrição configurada.');
      const bytes = await upstream('/v1/sound-generation?output_format=mp3_44100_128', { method: 'POST', body: { text: environment.prompt, duration_seconds: recipe.durationSeconds, prompt_influence: recipe.promptInfluence, model_id: SOUND_MODEL, loop: true }, usage: { userId, operation: 'ambience', units: Math.ceil(recipe.durationSeconds * 1000 / 60) } });
      remember(key, bytes);
      if (cacheDir) {
        const temporary = resolve(cacheDir, `${key}.${randomUUID()}.tmp`);
        try { await mkdir(cacheDir, { recursive: true }); await writeFile(temporary, bytes, { mode: 0o600 }); await rename(temporary, resolve(cacheDir, `${key}.mp3`)); }
        catch { await unlink(temporary).catch(() => {}); /* Generation remains usable if disk cache is unavailable. */ }
      }
      return { bytes, type: 'audio/mpeg', source: 'generated', reviewed: false, revision: key };
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };

  return async function audioHandler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      if (production) access.requireOrigin(req, res); else requireLocalRequest(req, port);
      const url = new URL(req.url, 'http://localhost');
      if (production && req.method === 'OPTIONS' && url.pathname.startsWith('/api/audio/')) { res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); return; }
      if (url.pathname === '/api/audio/status' && req.method === 'GET') {
        return json(res, 200, { configured: Boolean(apiKey), model: MODEL, soundModel: SOUND_MODEL, voiceChange: { model: VOICE_CHANGE_MODEL, configured: Boolean(apiKey), maxDurationSeconds: guideLimits.maxSeconds, maxBytes: guideLimits.maxBytes, inputFormats: ['wav'], ...(production ? { inputSampleRate: 16000, inputChannels: 1 } : {}), paid: true }, ...(access.required ? { authRequired: true, authConfigured: access.configured, usageConfigured: access.usageConfigured, cachePersistence: production ? 'ephemeral' : 'local', limits: { dailyGenerations: access.limits.daily, dailyProcessingUnits: access.limits.units } } : {}), ...(defaultVoiceId ? { defaultVoiceId } : {}) });
      }
      const user = url.pathname.startsWith('/api/audio/') ? await access.authenticate(req) : null;
      if (url.pathname === '/api/audio/environments' && req.method === 'GET') {
        const readiness = await Promise.all([...catalog.values()].map(async environment => {
          const recipe = getAmbienceRecipe(environment), asset = await readyAsset(environment, recipe);
          const resources = await library?.resourceStatus(environment.id) || { ir: null, events: [] };
          if (!resources.ir) resources.ir = (await bundles.readIr(environment.id))?.metadata || null;
          return { id: environment.id, mode: recipe.mode, status: recipe.mode === 'silent' ? 'silent' : asset?.source === 'library' ? 'approved' : asset?.source === 'recording' ? 'recorded' : asset ? 'generated' : 'missing', reviewed: asset?.reviewed ?? false, ...(asset ? { source: asset.source, revision: asset.revision, ...(asset.provenance ? { provenance: asset.provenance } : {}) } : {}), ...(resources.ir || resources.events.length ? { resources } : {}) };
        }));
        return json(res, 200, { environments: readiness });
      }
      if ((url.pathname.startsWith('/api/audio/ir/') || url.pathname.startsWith('/api/audio/events/')) && req.method === 'GET') {
        const kind = url.pathname.startsWith('/api/audio/ir/') ? 'ir' : 'event', prefix = kind === 'ir' ? '/api/audio/ir/' : '/api/audio/events/';
        let parts;
        try { parts = url.pathname.slice(prefix.length).split('/').map(decodeURIComponent); } catch { reject(400, 'invalid_resource', 'Escolha um recurso válido.'); }
        if (parts.length !== (kind === 'ir' ? 1 : 2) || parts.some(part => !/^[a-z0-9_-]{1,80}$/.test(part)) || !catalog.has(parts[0])) reject(404, 'AUDIO_RESOURCE_NOT_READY', 'Este recurso de cena ainda não está disponível.');
        const asset = await library?.readResource(parts[0], kind, parts[1]) || (kind === 'ir' ? await bundles.readIr(parts[0]) : null);
        if (!asset) reject(404, 'AUDIO_RESOURCE_NOT_READY', 'Este recurso ainda não tem um arquivo disponível na biblioteca local.');
        return sendBinary(res, asset.bytes, asset.type, asset);
      }
      if (url.pathname.startsWith('/api/audio/ambience/') && req.method === 'GET') {
        let id;
        try { id = decodeURIComponent(url.pathname.slice('/api/audio/ambience/'.length)); } catch { reject(400, 'invalid_environment', 'Escolha um ambiente válido.'); }
        const environment = typeof id === 'string' && /^[a-z0-9_-]{1,80}$/.test(id) ? catalog.get(id) : null;
        if (!environment) reject(404, 'AMBIENCE_NOT_READY', 'Este ambiente ainda não está disponível para ouvir.');
        const asset = await readyAsset(environment, getAmbienceRecipe(environment));
        if (!asset) reject(404, 'AMBIENCE_NOT_READY', 'Este ambiente ainda não tem um áudio preparado. Gere um candidato ou registre uma gravação revisada.');
        return sendBinary(res, asset.bytes, asset.type, asset);
      }
      if (url.pathname === '/api/audio/voices' && req.method === 'GET') {
        const query = new URLSearchParams({ page_size: '100', include_total_count: 'false' });
        for (const [local, remote, max] of [['search', 'search', 200], ['nextPageToken', 'next_page_token', 2000]]) {
          const value = url.searchParams.get(local);
          if (value !== null) { if (!value.trim() || value.length > max) reject(400, 'invalid_input', 'O filtro de vozes não é válido.'); query.set(remote, value); }
        }
        if (url.searchParams.has('language')) {
          const language = url.searchParams.get('language');
          if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language)) reject(400, 'invalid_input', 'O idioma do filtro não é válido.');
          query.set('language', language);
        }
        return json(res, 200, voiceList(await upstream(`/v2/voices?${query}`, { asJson: true }), apiKey));
      }
      if (url.pathname === '/api/audio/speech' && req.method === 'POST') {
        const { voiceId, format, payload } = speechPayload(await readJson(req), defaultVoiceId);
        return sendBinary(res, await upstream(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${format}`, { method: 'POST', body: payload, usage: { userId: user?.id, operation: 'speech', units: payload.text.length } }));
      }
      if (url.pathname === '/api/audio/voice-change' && req.method === 'POST') {
        const request = await readVoiceGuide(req, defaultVoiceId, guideLimits);
        const bytes = await upstream(`/v1/speech-to-speech/${encodeURIComponent(request.voiceId)}?output_format=${request.format}`, { method: 'POST', body: request.payload, usage: { userId: user?.id, operation: 'voice_change', units: Math.ceil(request.durationSeconds * 1000 / 60) } });
        return sendBinary(res, bytes, 'audio/mpeg', undefined, { 'X-Voice-Model': VOICE_CHANGE_MODEL, 'X-Guide-Duration': String(request.durationSeconds) });
      }
      if (url.pathname === '/api/audio/ambience' && req.method === 'POST') {
        const body = await readJson(req); onlyFields(body, ['environment']);
        if (typeof body.environment !== 'string' || body.environment.length > 80) reject(400, 'invalid_environment', 'Escolha um ambiente válido.');
        const environment = catalog.get(body.environment);
        if (!environment) reject(400, 'invalid_environment', 'Este ambiente não está disponível.');
        const asset = await ambience(environment, getAmbienceRecipe(environment), user?.id);
        return sendBinary(res, asset.bytes, asset.type, asset);
      }
      if (url.pathname.startsWith('/api/')) {
        const known = ['/api/audio/status', '/api/audio/voices', '/api/audio/speech', '/api/audio/voice-change', '/api/audio/ambience', '/api/audio/environments'].includes(url.pathname) || ['/api/audio/ambience/', '/api/audio/ir/', '/api/audio/events/'].some(prefix => url.pathname.startsWith(prefix));
        reject(known ? 405 : 404, known ? 'method_not_allowed' : 'not_found', known ? 'Método não permitido para este recurso.' : 'Recurso não encontrado.');
      }
      if (req.method === 'GET' && staticDir) return await serveStatic(url, res, staticDir);
      reject(404, 'not_found', 'Recurso não encontrado.');
    } catch (error) {
      const safe = error instanceof AudioError || error instanceof AccessError ? error : new AudioError(500, 'internal_error', 'Não foi possível concluir a solicitação.');
      json(res, safe.status, { error: { code: safe.code, message: safe.message } });
    }
  };
}
