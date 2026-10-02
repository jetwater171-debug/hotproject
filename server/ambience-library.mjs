import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, lstat, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWav } from './wav-audio.mjs';

export const DEFAULT_LIBRARY_DIR = fileURLToPath(new URL('./ambience-library/', import.meta.url));
export const MAX_LIBRARY_BYTES = 64 * 1024 * 1024;
const LICENSES = new Set(['owned', 'cc0', 'mit', 'elevenlabs']);
const MIME_TYPES = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4' };
const EMPTY = () => ({ version: 1, entries: {} });

export class LibraryError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const invalid = (code, message) => { throw new LibraryError(code, message); };
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function safeBasename(file) {
  return typeof file === 'string' && file.length <= 180 && !file.startsWith('.') && basename(file) === file && !/[\\/\0]/.test(file) && Object.hasOwn(MIME_TYPES, extname(file).toLowerCase());
}

export function detectAudioType(bytes, filename) {
  const extension = extname(filename).toLowerCase();
  const valid = extension === '.wav' ? bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'
    : extension === '.mp3' ? bytes.length >= 10 && (bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    : extension === '.ogg' ? bytes.length >= 27 && bytes.toString('ascii', 0, 4) === 'OggS'
    : extension === '.flac' ? bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'fLaC'
    : extension === '.m4a' ? bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp'
    : false;
  if (!valid) invalid('unsupported_audio', 'Escolha um arquivo WAV, MP3, OGG, FLAC ou M4A válido.');
  return MIME_TYPES[extension];
}

export async function readAudioFile(file) {
  const bytes = await boundedFile(file, MAX_LIBRARY_BYTES);
  return { bytes, type: detectAudioType(bytes, file) };
}

export async function boundedFile(file, maxBytes) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || !info.size) invalid('invalid_file', 'O arquivo deve ser regular e não vazio.');
  if (info.size > maxBytes) invalid('file_too_large', maxBytes === MAX_LIBRARY_BYTES ? 'O arquivo ultrapassa o limite de 64 MB.' : 'O arquivo ultrapassa o limite de tamanho.');
  const chunks = []; let size = 0;
  for await (const chunk of createReadStream(file)) {
    size += chunk.length;
    if (size > maxBytes) invalid('file_too_large', 'O arquivo ultrapassa o limite de tamanho.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function readManifest(root, strict = false) {
  try {
    const manifest = JSON.parse((await boundedFile(resolve(root, 'library.json'), 256 * 1024)).toString('utf8'));
    if (manifest?.version !== 1 || !manifest.entries || typeof manifest.entries !== 'object' || Array.isArray(manifest.entries)) throw new Error('manifest');
    if (manifest.resources !== undefined && (!manifest.resources || typeof manifest.resources !== 'object' || Array.isArray(manifest.resources) || ['ir', 'events'].some(kind => manifest.resources[kind] !== undefined && (!manifest.resources[kind] || typeof manifest.resources[kind] !== 'object' || Array.isArray(manifest.resources[kind]))))) throw new Error('resources');
    return manifest;
  } catch (error) {
    if (error.code === 'ENOENT') return EMPTY();
    if (strict) invalid('invalid_manifest', 'O manifesto da biblioteca não é válido. Corrija-o antes de registrar um arquivo.');
    return EMPTY();
  }
}

function validEntry(entry) {
  return entry && safeBasename(entry.file) && /^[a-f0-9]{64}$/.test(entry.sha256) && LICENSES.has(entry.license) && typeof entry.source === 'string' && entry.source.trim() && entry.source.length <= 1000 && typeof entry.reviewed === 'boolean' && Number.isInteger(entry.byteLength) && entry.byteLength > 0 && entry.byteLength <= MAX_LIBRARY_BYTES && Object.values(MIME_TYPES).includes(entry.mimeType);
}

const idValid = value => typeof value === 'string' && /^[a-z0-9_-]{1,80}$/.test(value);
const finiteRange = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function validIrMetadata(acoustic, durationSeconds) {
  return acoustic && ['included', 'removed'].includes(acoustic.directSound) && ['embedded', 'external'].includes(acoustic.predelayMode) && finiteRange(acoustic.predelayMs, 0, 300) && (acoustic.directArrivalMs === undefined || finiteRange(acoustic.directArrivalMs, 0, durationSeconds * 1000)) && (acoustic.directWindowMs === undefined || finiteRange(acoustic.directWindowMs, 0.1, 50)) && (acoustic.wet === undefined || finiteRange(acoustic.wet, 0, 1)) && typeof acoustic.notes === 'string' && acoustic.notes.trim() && acoustic.notes.length <= 1000;
}

export function validEventMetadata(sound) {
  return sound && typeof sound.label === 'string' && sound.label.trim() && sound.label.length <= 120 && finiteRange(sound.minGapSeconds, 1, 600) && finiteRange(sound.maxGapSeconds, sound.minGapSeconds, 600) && finiteRange(sound.relativeDb, -60, 0) && finiteRange(sound.pan, -1, 1);
}

function resourceMetadata(entry, environment, kind, id) {
  return { id: id || environment, environment, kind, reviewed: true, source: 'library', revision: entry.sha256, mimeType: entry.mimeType, durationSeconds: entry.durationSeconds, license: entry.license, ...(kind === 'ir' ? { acoustic: entry.acoustic } : { sound: entry.sound }) };
}

const put = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });

function resourceEntry(manifest, environment, kind, id) {
  if (kind === 'ir') return Object.hasOwn(manifest.resources?.ir || {}, environment) ? manifest.resources.ir[environment] : null;
  const entries = Object.hasOwn(manifest.resources?.events || {}, environment) ? manifest.resources.events[environment] : {};
  return Object.hasOwn(entries || {}, id) ? entries[id] : null;
}

async function approvedBytes(root, entry) {
  if (!validEntry(entry) || !entry.reviewed) return null;
  try {
    const bytes = await boundedFile(await insideFiles(root, entry.file), MAX_LIBRARY_BYTES);
    if (bytes.length !== entry.byteLength || digest(bytes) !== entry.sha256 || detectAudioType(bytes, entry.file) !== entry.mimeType) return null;
    return bytes;
  } catch { return null; }
}

async function approvedResource(root, manifest, environment, kind, id) {
  const entry = resourceEntry(manifest, environment, kind, id), bytes = await approvedBytes(root, entry);
  if (!bytes || entry.mimeType !== 'audio/wav') return null;
  try {
    const wav = inspectWav(bytes, { maxDurationSeconds: kind === 'ir' ? 4 : 15 });
    if (Math.abs(wav.durationSeconds - entry.durationSeconds) > 0.000001 || !(kind === 'ir' ? validIrMetadata(entry.acoustic, wav.durationSeconds) : validEventMetadata(entry.sound))) return null;
    return { bytes, type: 'audio/wav', source: 'library', reviewed: true, revision: entry.sha256, metadata: resourceMetadata(entry, environment, kind, id) };
  } catch { return null; }
}

async function insideFiles(root, filename) {
  if (!safeBasename(filename)) invalid('invalid_path', 'O caminho da biblioteca não é válido.');
  const files = resolve(root, 'files');
  const directory = await lstat(files);
  if (!directory.isDirectory() || directory.isSymbolicLink()) invalid('invalid_path', 'A pasta de arquivos da biblioteca não é válida.');
  const base = await realpath(files), target = resolve(files, filename), actual = await realpath(target);
  if (!actual.startsWith(base + sep)) invalid('invalid_path', 'O arquivo não pertence à biblioteca.');
  return target;
}

/** Only reviewed, intact local clips can become public audio responses. */
export function createAmbienceLibrary({ rootDir = DEFAULT_LIBRARY_DIR } = {}) {
  const root = resolve(rootDir);
  return {
    async readApproved(environment) {
      const manifest = await readManifest(root);
      const entry = Object.hasOwn(manifest.entries, environment) ? manifest.entries[environment] : null;
      const bytes = await approvedBytes(root, entry);
      return bytes ? { bytes, type: entry.mimeType, source: 'library', reviewed: true, revision: entry.sha256 } : null;
    },
    async readResource(environment, kind, id) {
      if (!idValid(environment) || !['ir', 'event'].includes(kind) || kind === 'event' && !idValid(id)) return null;
      return approvedResource(root, await readManifest(root), environment, kind, id);
    },
    async resourceStatus(environment) {
      const manifest = await readManifest(root), ir = await approvedResource(root, manifest, environment, 'ir');
      const entries = Object.hasOwn(manifest.resources?.events || {}, environment) ? manifest.resources.events[environment] : {};
      const events = [];
      for (const id of Object.keys(entries || {}).filter(idValid).slice(0, 20)) {
        const event = await approvedResource(root, manifest, environment, 'event', id);
        if (event) events.push(event.metadata);
      }
      return { ir: ir?.metadata || null, events };
    },
  };
}

/** Local import only. --approve is the caller's statement that they listened and reviewed. */
export async function registerLibraryClip({ environment, file, license, source, approve = false, rootDir = DEFAULT_LIBRARY_DIR, environments, kind = 'bed', eventId, acoustic, sound }) {
  if (typeof environment !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(environment) || !Array.isArray(environments) || !environments.some(item => item.id === environment)) invalid('invalid_environment', 'Escolha um ambiente disponível no catálogo.');
  const selected = environments.find(item => item.id === environment);
  if (!['bed', 'ir', 'event'].includes(kind)) invalid('invalid_kind', 'Escolha bed, ir ou event.');
  if (kind === 'event' && !idValid(eventId)) invalid('invalid_event', 'Informe um identificador válido para o evento.');
  if (kind === 'bed' && (selected.sound?.mode === 'silent' || selected.id === 'studio')) invalid('silent_environment', 'Este cenário usa apenas acústica e não precisa de um som de fundo.');
  if (!LICENSES.has(license)) invalid('invalid_license', 'Informe a licença: owned, cc0, mit ou elevenlabs.');
  if (typeof source !== 'string' || !source.trim() || source.length > 1000) invalid('invalid_source', 'Informe a procedência do áudio, com até 1.000 caracteres.');
  if (typeof file !== 'string' || !file.trim() || !Object.hasOwn(MIME_TYPES, extname(file).toLowerCase())) invalid('unsupported_audio', 'Escolha um arquivo WAV, MP3, OGG, FLAC ou M4A.');
  let bytes;
  try { bytes = await boundedFile(resolve(file), MAX_LIBRARY_BYTES); }
  catch (error) { if (error instanceof LibraryError) throw error; invalid('unreadable_audio', 'Não foi possível ler o arquivo de áudio informado.'); }
  const mimeType = detectAudioType(bytes, file), sha256 = digest(bytes), root = resolve(rootDir);
  let durationSeconds;
  if (kind !== 'bed') {
    try { durationSeconds = inspectWav(bytes, { maxDurationSeconds: kind === 'ir' ? 4 : 15 }).durationSeconds; }
    catch { invalid('invalid_resource_wav', kind === 'ir' ? 'A resposta de sala deve ser WAV PCM ou float, mono/estéreo, com até 4 segundos.' : 'O evento deve ser WAV PCM ou float, mono/estéreo, com até 15 segundos.'); }
    if (kind === 'ir' && !validIrMetadata(acoustic, durationSeconds)) invalid('invalid_ir_metadata', 'Documente o som direto, o modo de predelay e as observações reais da resposta de sala.');
    if (kind === 'event' && !validEventMetadata(sound)) invalid('invalid_event_metadata', 'Informe rótulo, espaçamento, nível relativo e posição válidos para o evento.');
  }
  await mkdir(root, { recursive: true });
  const lockFile = resolve(root, '.library.lock');
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch { invalid('library_busy', 'A biblioteca está sendo atualizada. Aguarde antes de tentar novamente.'); }
  let temporary;
  try {
    const manifest = await readManifest(root, true);
    const current = kind === 'bed' ? (Object.hasOwn(manifest.entries, environment) ? manifest.entries[environment] : null) : resourceEntry(manifest, environment, kind, eventId);
    if (approve !== true && current?.reviewed === true) invalid('approved_environment_exists', 'Este recurso já tem um áudio aprovado. Ouça e revise o novo arquivo e use --approve para substituí-lo. Um rascunho não pode remover a aprovação atual.');
    const files = resolve(root, 'files'); await mkdir(files, { recursive: true });
    const folder = await lstat(files);
    if (!folder.isDirectory() || folder.isSymbolicLink()) invalid('invalid_path', 'A pasta de arquivos da biblioteca não é válida.');
    const filename = `${environment}-${kind}-${sha256}${extname(file).toLowerCase()}`, destination = resolve(files, filename);
    try { await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Never overwrite an existing path, symlink, or mismatching file.
      const existing = await boundedFile(await insideFiles(root, filename), MAX_LIBRARY_BYTES);
      if (digest(existing) !== sha256) invalid('file_conflict', 'Já existe um arquivo diferente com este identificador.');
    }
    const timestamp = new Date().toISOString();
    const entry = { file: filename, mimeType, sha256, byteLength: bytes.length, license, source: source.trim(), reviewed: approve === true, importedAt: timestamp, ...(approve === true ? { reviewedAt: timestamp } : {}), ...(kind === 'bed' ? {} : { durationSeconds, ...(kind === 'ir' ? { acoustic } : { sound }) }) };
    if (kind === 'bed') put(manifest.entries, environment, entry);
    else {
      manifest.resources ||= { ir: {}, events: {} }; manifest.resources.ir ||= {}; manifest.resources.events ||= {};
      if (kind === 'ir') put(manifest.resources.ir, environment, entry);
      else { if (!Object.hasOwn(manifest.resources.events, environment)) put(manifest.resources.events, environment, {}); put(manifest.resources.events[environment], eventId, entry); }
    }
    temporary = resolve(root, `.library-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, resolve(root, 'library.json')); temporary = undefined;
    return { environment, ...(kind !== 'bed' ? { kind, ...(eventId ? { eventId } : {}), durationSeconds } : {}), status: approve === true ? 'approved' : 'draft', reviewed: approve === true, sha256, byteLength: bytes.length };
  } catch (error) {
    if (error instanceof LibraryError) throw error;
    invalid('library_write_failed', 'Não foi possível atualizar a biblioteca local.');
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    await lock.close(); await unlink(lockFile).catch(() => {});
  }
}

export async function readEnvironmentCatalog(path = fileURLToPath(new URL('../shared/environments.json', import.meta.url))) {
  const data = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(data)) invalid('invalid_catalog', 'O catálogo de ambientes não é válido.');
  return data;
}
