import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, open, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './index.mjs';
import { getAmbienceRecipe } from './audio-handler.mjs';
import { createAmbienceLibrary, digest, MAX_LIBRARY_BYTES, registerLibraryClip } from './ambience-library.mjs';

const KEY = 'sk_test_NOT_A_REAL_ELEVENLABS_KEY';
const mp3Bytes = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00mock ambient audio');
const mp3 = () => new Response(mp3Bytes, { headers: { 'content-type': 'audio/mpeg' } });
const silentIds = ['studio', 'bathroom', 'bedroom', 'livingroom', 'library'];
const catalog = [
  ...silentIds.map(id => ({ id, name: id, prompt: '', sound: { mode: 'silent', version: 2, durationSeconds: 0, promptInfluence: 0 } })),
  { id: 'rain', name: 'Chuva', prompt: 'Steady rain over leaves and pavement, no speech or music.', sound: { mode: 'bed', version: 2, durationSeconds: 24, promptInfluence: 0.72 } },
  { id: 'street', name: 'Rua', prompt: 'Distant street traffic and footsteps, no speech or music.', sound: { mode: 'bed', version: 2, durationSeconds: 30, promptInfluence: 0.68 } },
];

function wav() {
  const bytes = Buffer.alloc(44 + 960);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(960, 40);
  return bytes;
}

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'velora-library-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function server(t, options = {}) {
  const local = createServer({ env: {}, environments: catalog, staticDir: null, cacheDir: null, libraryDir: null, bundleManifestPath: null, fetchImpl: () => { throw new Error('Unexpected provider call'); }, ...options });
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  t.after(async () => { local.closeAllConnections(); await new Promise(resolve => local.close(resolve)); });
  const base = `http://127.0.0.1:${local.address().port}`;
  return { get: path => fetch(base + path), post: id => fetch(base + '/api/audio/ambience', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ environment: id }) }) };
}

test('all five acoustic-only environments return silent WAV and never call ElevenLabs', async t => {
  let calls = 0;
  const api = await server(t, { env: { ELEVENLABS_API_KEY: KEY }, fetchImpl: async () => { calls++; return mp3(); } });
  for (const id of silentIds) {
    for (const response of [await api.get('/api/audio/ambience/' + id), await api.post(id)]) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-ambience-source'), 'silent');
      assert.equal(response.headers.get('x-ambience-reviewed'), 'false');
      assert.match(response.headers.get('x-ambience-revision'), /^[a-f0-9]{64}$/);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.ok(bytes.subarray(44).every(value => value === 0));
    }
  }
  const readiness = await (await api.get('/api/audio/environments')).json();
  assert.deepEqual(readiness.environments.filter(item => item.status === 'silent').map(item => item.id), silentIds);
  assert.equal(calls, 0);
});

test('read-only missing ambience returns AMBIENCE_NOT_READY even when a key exists', async t => {
  let calls = 0;
  const api = await server(t, { env: { ELEVENLABS_API_KEY: KEY }, fetchImpl: async () => { calls++; return mp3(); } });
  for (const id of ['rain', 'unknown', '..%2Foutside']) {
    const response = await api.get('/api/audio/ambience/' + id);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'AMBIENCE_NOT_READY');
  }
  const row = (await (await api.get('/api/audio/environments')).json()).environments.find(item => item.id === 'rain');
  assert.deepEqual(row, { id: 'rain', mode: 'bed', status: 'missing', reviewed: false });
  assert.equal(calls, 0);
});

test('generated ambience uses per-environment settings and GET reads cache without a key or charge', async t => {
  const cacheDir = await temporary(t), calls = [];
  const api = await server(t, { cacheDir, env: { ELEVENLABS_API_KEY: KEY }, fetchImpl: async (url, input) => { calls.push({ url, body: JSON.parse(input.body) }); return mp3(); } });
  const generated = await api.post('rain');
  assert.equal(generated.status, 200);
  assert.equal(generated.headers.get('x-ambience-source'), 'generated');
  assert.equal(generated.headers.get('x-ambience-reviewed'), 'false');
  assert.deepEqual(calls[0].body, { text: catalog.find(item => item.id === 'rain').prompt, model_id: 'eleven_text_to_sound_v2', duration_seconds: 24, prompt_influence: 0.72, loop: true });
  const revision = generated.headers.get('x-ambience-revision');
  const noKey = await server(t, { cacheDir });
  const response = await noKey.get('/api/audio/ambience/rain');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-ambience-source'), 'cache');
  assert.equal(response.headers.get('x-ambience-reviewed'), 'false');
  assert.equal(response.headers.get('x-ambience-revision'), revision);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp3Bytes);
  assert.equal((await noKey.post('rain')).status, 200);
  const row = (await (await noKey.get('/api/audio/environments')).json()).environments.find(item => item.id === 'rain');
  assert.deepEqual(row, { id: 'rain', mode: 'bed', status: 'generated', reviewed: false, source: 'cache', revision });
  assert.equal(calls.length, 1);
});

test('all 25 ambient beds remain available in memory when disk cache is unavailable', async t => {
  const beds = Array.from({ length: 25 }, (_, index) => ({ id: `bed_${index}`, prompt: `Unique ambient bed ${index}, no speech or music.`, sound: { mode: 'bed', version: 2, durationSeconds: 24, promptInfluence: 0.7 } }));
  let calls = 0;
  const api = await server(t, { environments: beds, cacheDir: null, libraryDir: null, env: { ELEVENLABS_API_KEY: KEY }, fetchImpl: async () => { calls++; return mp3(); } });
  for (const bed of beds) {
    const response = await api.post(bed.id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-ambience-source'), 'generated');
    await response.arrayBuffer();
  }
  assert.equal(calls, 25);
  const readiness = (await (await api.get('/api/audio/environments')).json()).environments;
  assert.equal(readiness.length, 25);
  assert.ok(readiness.every(item => item.status === 'generated' && item.source === 'cache' && item.reviewed === false));
  for (const bed of beds) {
    const response = await api.get('/api/audio/ambience/' + bed.id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-ambience-source'), 'cache');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp3Bytes);
  }
  const firstAgain = await api.post(beds[0].id);
  assert.equal(firstAgain.status, 200);
  assert.equal(firstAgain.headers.get('x-ambience-source'), 'cache');
  await firstAgain.arrayBuffer();
  assert.equal(calls, 25, 'Readiness, GET and a repeat POST must never regenerate prepared beds');
});

test('local approval requires an explicit flag, stores provenance and atomically copies intact audio', async t => {
  const base = await temporary(t), rootDir = join(base, 'library'), file = join(base, 'recording.wav');
  await writeFile(file, wav());
  const args = { environment: 'rain', file, license: 'owned', source: 'Recording by test fixture, never a production asset', rootDir, environments: catalog };
  const draft = await registerLibraryClip(args);
  assert.equal(draft.reviewed, false);
  assert.equal(await createAmbienceLibrary({ rootDir }).readApproved('rain'), null);
  const approved = await registerLibraryClip({ ...args, approve: true });
  const clip = await createAmbienceLibrary({ rootDir }).readApproved('rain');
  assert.equal(approved.reviewed, true);
  assert.deepEqual(clip.bytes, wav());
  assert.equal(clip.revision, digest(wav()));
  const manifest = JSON.parse(await readFile(join(rootDir, 'library.json'), 'utf8'));
  assert.equal(manifest.entries.rain.license, 'owned');
  assert.equal(manifest.entries.rain.source, args.source);
  assert.equal(manifest.entries.rain.sha256, digest(wav()));
  assert.equal(manifest.entries.rain.byteLength, wav().length);
  assert.equal(manifest.entries.rain.reviewed, true);
  assert.ok(!/[\\/]/.test(manifest.entries.rain.file));
  assert.deepEqual((await readdir(rootDir)).sort(), ['files', 'library.json']);
});

test('approved library wins over provider cache and is served without a configured key', async t => {
  const base = await temporary(t), cacheDir = join(base, 'cache'), libraryDir = join(base, 'library'), file = join(base, 'approved.wav');
  const api = await server(t, { cacheDir, libraryDir, env: { ELEVENLABS_API_KEY: KEY }, fetchImpl: async () => mp3() });
  assert.equal((await api.post('rain')).status, 200);
  await writeFile(file, wav());
  await registerLibraryClip({ environment: 'rain', file, license: 'cc0', source: 'Test fixture source with PRIVATE_SOURCE_PATH', approve: true, rootDir: libraryDir, environments: catalog });
  const noKey = await server(t, { cacheDir, libraryDir });
  for (const response of [await noKey.get('/api/audio/ambience/rain'), await noKey.post('rain')]) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/wav');
    assert.equal(response.headers.get('x-ambience-source'), 'library');
    assert.equal(response.headers.get('x-ambience-reviewed'), 'true');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), wav());
  }
  const raw = await (await noKey.get('/api/audio/environments')).text();
  assert.ok(!raw.includes('PRIVATE_SOURCE_PATH') && !raw.includes('file') && !raw.includes(libraryDir) && !raw.includes(KEY));
  const row = JSON.parse(raw).environments.find(item => item.id === 'rain');
  assert.deepEqual(row, { id: 'rain', mode: 'bed', status: 'approved', reviewed: true, source: 'library', revision: digest(wav()) });
});

test('draft and tampered library files are never returned by read-only endpoints', async t => {
  const base = await temporary(t), libraryDir = join(base, 'library'), file = join(base, 'draft.wav');
  await writeFile(file, wav());
  const args = { environment: 'rain', file, license: 'owned', source: 'Test fixture', rootDir: libraryDir, environments: catalog };
  await registerLibraryClip(args);
  const api = await server(t, { libraryDir });
  assert.equal((await api.get('/api/audio/ambience/rain')).status, 404);
  assert.equal((await api.post('rain')).status, 503);
  await registerLibraryClip({ ...args, approve: true });
  assert.equal((await api.get('/api/audio/ambience/rain')).status, 200);
  const manifest = JSON.parse(await readFile(join(libraryDir, 'library.json'), 'utf8'));
  await writeFile(join(libraryDir, 'files', manifest.entries.rain.file), Buffer.from('not the approved bytes'));
  assert.equal((await api.get('/api/audio/ambience/rain')).status, 404);
});

test('a draft cannot replace an approved environment or remove its library priority', async t => {
  const base = await temporary(t), libraryDir = join(base, 'library'), cacheDir = join(base, 'cache'), approvedFile = join(base, 'approved.wav'), candidateFile = join(base, 'candidate.mp3');
  await writeFile(approvedFile, wav()); await writeFile(candidateFile, mp3Bytes);
  const args = { environment: 'rain', license: 'owned', source: 'Explicitly reviewed test fixture', rootDir: libraryDir, environments: catalog };
  await registerLibraryClip({ ...args, file: approvedFile, approve: true });
  const originalManifest = await readFile(join(libraryDir, 'library.json'), 'utf8');
  await mkdir(cacheDir); await writeFile(join(cacheDir, `${getAmbienceRecipe(catalog.find(item => item.id === 'rain')).revision}.mp3`), mp3Bytes);
  await assert.rejects(registerLibraryClip({ ...args, file: candidateFile }), error => error.code === 'approved_environment_exists');
  assert.equal(await readFile(join(libraryDir, 'library.json'), 'utf8'), originalManifest);
  assert.deepEqual((await readdir(libraryDir)).sort(), ['files', 'library.json']);
  const api = await server(t, { libraryDir, cacheDir });
  const response = await api.get('/api/audio/ambience/rain');
  assert.equal(response.headers.get('x-ambience-source'), 'library');
  assert.equal(response.headers.get('x-ambience-reviewed'), 'true');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), wav());
});

test('cache identity changes with version, prompt, duration or influence and stale audio is not reused', async t => {
  const environment = catalog.find(item => item.id === 'rain'), oldRecipe = getAmbienceRecipe(environment);
  const variants = [
    { ...environment, sound: { ...environment.sound, version: 3 } },
    { ...environment, prompt: environment.prompt + ' Updated.' },
    { ...environment, sound: { ...environment.sound, durationSeconds: 30 } },
    { ...environment, sound: { ...environment.sound, promptInfluence: 0.75 } },
  ];
  for (const variant of variants) assert.notEqual(getAmbienceRecipe(variant).revision, oldRecipe.revision);
  const cacheDir = await temporary(t);
  await writeFile(join(cacheDir, oldRecipe.revision + '.mp3'), mp3Bytes);
  const api = await server(t, { cacheDir, environments: [variants[0]] });
  assert.equal((await api.get('/api/audio/ambience/rain')).status, 404);
});

test('library rejects unsupported files, missing provenance, unknown licenses and files over64MB', async t => {
  const base = await temporary(t), file = join(base, 'recording.wav'), rootDir = join(base, 'library');
  await writeFile(file, wav());
  const args = { environment: 'rain', file, license: 'owned', source: 'Test fixture', rootDir, environments: catalog };
  for (const [changes, code] of [[{ license: 'free' }, 'invalid_license'], [{ source: '' }, 'invalid_source'], [{ environment: 'missing' }, 'invalid_environment'], [{ environment: 'bathroom' }, 'silent_environment'], [{ file: join(base, '.env') }, 'unsupported_audio']]) await assert.rejects(registerLibraryClip({ ...args, ...changes }), error => error.code === code);
  const oversized = join(base, 'oversized.wav'), handle = await open(oversized, 'w'); await handle.truncate(MAX_LIBRARY_BYTES + 1); await handle.close();
  await assert.rejects(registerLibraryClip({ ...args, file: oversized }), error => error.code === 'file_too_large');
  await writeFile(file, 'not an audio file');
  await assert.rejects(registerLibraryClip(args), error => error.code === 'unsupported_audio');
});

test('manifest traversal and symlinked clips cannot escape the files directory', async t => {
  const base = await temporary(t), rootDir = join(base, 'library'), outside = join(base, 'outside.wav');
  await mkdir(join(rootDir, 'files'), { recursive: true }); await writeFile(outside, wav());
  const entry = { file: '../outside.wav', sha256: digest(wav()), mimeType: 'audio/wav', byteLength: wav().length, source: 'Test fixture', license: 'owned', reviewed: true };
  await writeFile(join(rootDir, 'library.json'), JSON.stringify({ version: 1, entries: { rain: entry } }));
  assert.equal(await createAmbienceLibrary({ rootDir }).readApproved('rain'), null);
  try { await symlink(outside, join(rootDir, 'files', 'linked.wav'), 'file'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.diagnostic('Symlink creation unavailable; traversal guard was verified.'); return; } throw error; }
  entry.file = 'linked.wav';
  await writeFile(join(rootDir, 'library.json'), JSON.stringify({ version: 1, entries: { rain: entry } }));
  assert.equal(await createAmbienceLibrary({ rootDir }).readApproved('rain'), null);
});
