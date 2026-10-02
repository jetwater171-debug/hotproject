import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from './index.mjs';
import { createAmbienceLibrary, digest, registerLibraryClip } from './ambience-library.mjs';
import { createBundledAssets } from './bundled-assets.mjs';
import { runPrepareAmbiences } from '../scripts/prepare-ambiences.mjs';
import { runAudioLibrary } from '../scripts/audio-library.mjs';

const catalog = [{ id: 'bathroom', prompt: '', sound: { mode: 'silent', version: 2, durationSeconds: 0, promptInfluence: 0 } }, { id: 'rain', prompt: 'Rain', sound: { mode: 'bed', version: 2, durationSeconds: 24, promptInfluence: 0.7 } }];
const acoustic = { directSound: 'included', directArrivalMs: 0, directWindowMs: 5, predelayMode: 'embedded', predelayMs: 0, wet: 0.15, notes: 'Impulse fixture; no physical room claim.' };
const sound = { label: 'Porta distante', minGapSeconds: 25, maxGapSeconds: 60, relativeDb: -24, pan: -0.2 };
const mp3 = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00recording fixture');
function wav(seconds = 1) {
  const bytes = Buffer.alloc(44 + seconds * 16000); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40); bytes.writeInt16LE(10000, 44); return bytes;
}
async function temporary(t) { const base = await mkdtemp(join(tmpdir(), 'velora-resource-test-')); t.after(() => rm(base, { recursive: true, force: true })); return base; }
async function api(t, options = {}) {
  const server = createServer({ env: {}, environments: catalog, libraryDir: null, cacheDir: null, bundleManifestPath: null, staticDir: null, fetchImpl: () => { throw new Error('Unexpected provider call'); }, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`; return path => fetch(base + path);
}

test('real IR and event registration has explicit review and documented direct sound/predelay', async t => {
  const base = await temporary(t), rootDir = join(base, 'library'), file = join(base, 'ir.wav'); await writeFile(file, wav());
  const args = { environment: 'bathroom', kind: 'ir', file, license: 'owned', source: 'PRIVATE_LOCAL_RECORDING_PATH', acoustic, rootDir, environments: catalog };
  await registerLibraryClip(args); const library = createAmbienceLibrary({ rootDir }); assert.equal(await library.readResource('bathroom', 'ir'), null);
  await registerLibraryClip({ ...args, approve: true }); const impulse = await library.readResource('bathroom', 'ir');
  assert.deepEqual(impulse.bytes, wav()); assert.deepEqual(impulse.metadata.acoustic, acoustic); assert.equal(impulse.metadata.durationSeconds, 1);
  await registerLibraryClip({ ...args, kind: 'event', eventId: 'door', sound, approve: true });
  const get = await api(t, { libraryDir: rootDir });
  const response = await get('/api/audio/ir/bathroom'); assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(decodeURIComponent(response.headers.get('x-audio-resource-metadata'))), impulse.metadata);
  assert.equal((await get('/api/audio/events/bathroom/door')).status, 200);
  const readiness = await (await get('/api/audio/environments')).text(); assert.ok(!readiness.includes('PRIVATE_LOCAL_RECORDING_PATH') && !readiness.includes(rootDir));
  const row = JSON.parse(readiness).environments.find(item => item.id === 'bathroom'); assert.equal(row.status, 'silent'); assert.equal(row.resources.ir.reviewed, true); assert.equal(row.resources.events[0].sound.label, 'Porta distante');
  assert.equal((await get('/api/audio/events/bathroom/missing')).status, 404);
});

test('resource bounds and metadata cannot be inferred, drafts cannot demote approved resources', async t => {
  const base = await temporary(t), rootDir = join(base, 'library'), file = join(base, 'ir.wav'); await writeFile(file, wav());
  const args = { environment: 'bathroom', kind: 'ir', file, license: 'owned', source: 'Own fixture', acoustic, rootDir, environments: catalog };
  await assert.rejects(registerLibraryClip({ ...args, acoustic: undefined }), error => error.code === 'invalid_ir_metadata');
  await assert.rejects(registerLibraryClip({ ...args, acoustic: { ...acoustic, predelayMode: 'unknown' } }), error => error.code === 'invalid_ir_metadata');
  await writeFile(file, wav(5)); await assert.rejects(registerLibraryClip(args), error => error.code === 'invalid_resource_wav');
  await writeFile(file, wav()); await registerLibraryClip({ ...args, approve: true }); const original = await readFile(join(rootDir, 'library.json'), 'utf8');
  await assert.rejects(registerLibraryClip(args), error => error.code === 'approved_environment_exists'); assert.equal(await readFile(join(rootDir, 'library.json'), 'utf8'), original);
  await assert.rejects(registerLibraryClip({ ...args, kind: 'event', eventId: 'door', sound: { ...sound, maxGapSeconds: 1 } }), error => error.code === 'invalid_event_metadata');
  await writeFile(file, wav(16)); await assert.rejects(registerLibraryClip({ ...args, kind: 'event', eventId: 'door', sound }), error => error.code === 'invalid_resource_wav');
});

async function bundles(t) {
  const base = await temporary(t), publicDir = join(base, 'public'), manifestPath = join(base, 'bundled-assets.json'); await mkdir(join(publicDir, 'audio'), { recursive: true });
  await writeFile(join(publicDir, 'audio/rain.mp3'), mp3); await writeFile(join(publicDir, 'audio/room.wav'), wav());
  const common = { source: 'https://example.org/author/recording', label: 'Gravação fixture', reviewed: false, licenseUrl: 'https://example.org/license' };
  const manifest = { version: 1, beds: [{ ...common, id: 'rain_real', environment: 'rain', file: 'audio/rain.mp3', sha256: digest(mp3), license: 'cc0' }], irs: [{ ...common, id: 'small_room', environment: 'bathroom', file: 'audio/room.wav', sha256: digest(wav()), license: 'mit', acoustic }] };
  await writeFile(manifestPath, JSON.stringify(manifest)); return { base, publicDir, manifestPath, manifest };
}

test('bundled recordings and MIT IR are available read-only without key, but stay unreviewed', async t => {
  const fixture = await bundles(t), get = await api(t, { publicDir: fixture.publicDir, bundleManifestPath: fixture.manifestPath });
  const response = await get('/api/audio/ambience/rain'); assert.equal(response.status, 200); assert.equal(response.headers.get('x-ambience-source'), 'recording'); assert.equal(response.headers.get('x-ambience-reviewed'), 'false'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp3);
  const provenance = JSON.parse(decodeURIComponent(response.headers.get('x-ambience-provenance'))); assert.equal(provenance.license, 'cc0'); assert.ok(!Object.hasOwn(provenance, 'file'));
  const impulse = await get('/api/audio/ir/bathroom'); assert.equal(impulse.status, 200); assert.equal(impulse.headers.get('x-ambience-source'), 'recording');
  const rows = (await (await get('/api/audio/environments')).json()).environments; assert.equal(rows.find(row => row.id === 'rain').status, 'recorded'); assert.equal(rows.find(row => row.id === 'bathroom').resources.ir.reviewed, false);
  let calls = 0; const plan = await runPrepareAmbiences(['--generate'], { catalog, libraryDir: null, cacheDir: null, publicDir: fixture.publicDir, bundleManifestPath: fixture.manifestPath, log: () => {}, fetchImpl: async () => { calls++; throw new Error('No network expected'); } });
  assert.deepEqual(plan.map(row => row.status), ['silent', 'recorded']); assert.equal(calls, 0);
});

test('approved owned recording and IR take priority over included candidates', async t => {
  const fixture = await bundles(t), libraryDir = join(fixture.base, 'library'), file = join(fixture.base, 'own.wav'); await writeFile(file, wav(2));
  const args = { file, license: 'owned', source: 'Own fixture', approve: true, rootDir: libraryDir, environments: catalog };
  await registerLibraryClip({ ...args, environment: 'rain' }); await registerLibraryClip({ ...args, environment: 'bathroom', kind: 'ir', acoustic });
  const get = await api(t, { libraryDir, publicDir: fixture.publicDir, bundleManifestPath: fixture.manifestPath });
  for (const path of ['/api/audio/ambience/rain', '/api/audio/ir/bathroom']) { const response = await get(path); assert.equal(response.headers.get('x-ambience-source'), 'library'); assert.equal(response.headers.get('x-ambience-reviewed'), 'true'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), wav(2)); }
});

test('bundles reject traversal, missing public provenance, stale hash and symlink files', async t => {
  const fixture = await bundles(t), reader = createBundledAssets({ manifestPath: fixture.manifestPath, publicDir: fixture.publicDir });
  for (const changes of [{ file: '../outside.mp3' }, { source: 'C:\\private\\recording.mp3' }, { sha256: 'a'.repeat(64) }, { license: 'mit' }, { reviewed: true }]) {
    await writeFile(fixture.manifestPath, JSON.stringify({ ...fixture.manifest, beds: [{ ...fixture.manifest.beds[0], ...changes }] })); assert.equal(await reader.readBed('rain'), null);
  }
  try { await symlink(join(fixture.publicDir, 'audio/rain.mp3'), join(fixture.publicDir, 'audio/linked.mp3'), 'file'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.diagnostic('Symlink creation unavailable; path and hash guards verified.'); return; } throw error; }
  await writeFile(fixture.manifestPath, JSON.stringify({ ...fixture.manifest, beds: [{ ...fixture.manifest.beds[0], file: 'audio/linked.mp3' }] })); assert.equal(await reader.readBed('rain'), null);
});

test('resource CLI stores supplied metadata without network and waits for approval', async t => {
  const base = await temporary(t), rootDir = join(base, 'library'), file = join(base, 'ir.wav'), metadata = join(base, 'ir.json'); await writeFile(file, wav()); await writeFile(metadata, JSON.stringify(acoustic));
  const args = ['--environment', 'bathroom', '--kind', 'ir', '--file', file, '--license', 'owned', '--source', 'Own fixture', '--metadata', metadata];
  assert.equal((await runAudioLibrary(args, { catalog, rootDir, log: () => {} })).reviewed, false);
  assert.equal(await createAmbienceLibrary({ rootDir }).readResource('bathroom', 'ir'), null);
  await runAudioLibrary([...args, '--approve'], { catalog, rootDir, log: () => {} }); assert.deepEqual((await createAmbienceLibrary({ rootDir }).readResource('bathroom', 'ir')).metadata.acoustic, acoustic);
});
