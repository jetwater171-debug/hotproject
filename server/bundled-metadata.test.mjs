import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createAudioHandler, getAmbienceRecipe } from './audio-handler.mjs';
import { createVercelHandler } from '../api/audio.mjs';
import { createBundledAssets } from './bundled-assets.mjs';
import { digest, registerLibraryClip } from './ambience-library.mjs';

const rain = { id: 'rain', prompt: 'Rain fixture, no speech.', sound: { mode: 'bed', version: 2, durationSeconds: 24, promptInfluence: .7 } };
const catalog = [{ id: 'studio', prompt: '', sound: { mode: 'silent', version: 2, durationSeconds: 0, promptInfluence: 0 } }, rain];
const HOST = 'velora.example';
const TOKEN = 'fake_header_payload.signature';
const USER = '9f38f13a-a029-4bd6-b792-afd045be7730';

function wav() {
  const bytes = Buffer.alloc(16044);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40); bytes.writeInt16LE(1234, 44);
  return bytes;
}

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'velora-metadata-test-'));
  t.after(async () => {
    assert.equal(dirname(resolve(base)), resolve(tmpdir()));
    assert.ok(base.includes('velora-metadata-test-'));
    await rm(base, { recursive: true, force: true });
  });
  const publicDir = join(base, 'public'), bundleManifestPath = join(base, 'bundled-assets.json'), bytes = wav();
  await mkdir(join(publicDir, 'audio/ambiences'), { recursive: true });
  await writeFile(join(publicDir, 'audio/ambiences/rain.wav'), bytes);
  const entry = { environment: 'rain', id: 'rain_fixture', file: 'audio/ambiences/rain.wav', source: 'https://example.org/recording', license: 'cc0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', sha256: digest(bytes), label: 'Recorded fixture, not auditory approval', reviewed: false };
  await writeFile(bundleManifestPath, JSON.stringify({ version: 1, beds: [entry], irs: [] }));
  return { base, publicDir, bundleManifestPath, entry, bytes };
}

async function api(t, options = {}, factory = createAudioHandler) {
  const handler = factory({ env: {}, production: false, environments: catalog, libraryDir: null, cacheDir: null, bundleManifestPath: null, staticDir: null, fetchImpl: () => { throw new Error('Unexpected provider request'); }, ...options });
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  return (path, headers = {}) => new Promise((done, reject) => {
    const req = request(`http://127.0.0.1:${server.address().port}${path}`, { headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => done(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); req.end();
  });
}

test('bundled metadata uses a verified same-origin public path and preserves the binary route', async t => {
  const f = await fixture(t), get = await api(t, f);
  const loaded = await createBundledAssets({ manifestPath: f.bundleManifestPath, publicDir: f.publicDir }).readBed('rain');
  assert.equal(loaded.publicUrl, '/audio/ambiences/rain.wav');
  const response = await get('/api/audio/ambience/rain?metadata=1');
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('location'), null); assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.deepEqual(data, { publicUrl: '/audio/ambiences/rain.wav', mimeType: 'audio/wav', source: 'recording', reviewed: false, revision: f.entry.sha256, provenance: loaded.provenance });
  assert.ok(!JSON.stringify(data).includes(f.base));
  assert.equal(digest(await readFile(join(f.publicDir, data.publicUrl.slice(1)))), data.revision);
  for (const path of ['/api/audio/ambience/rain', '/api/audio/ambience/rain?metadata=0']) {
    const binary = await get(path); assert.equal(binary.status, 200); assert.equal(binary.headers.get('content-type'), 'audio/wav');
    assert.equal(binary.headers.get('x-ambience-source'), 'recording'); assert.deepEqual(Buffer.from(await binary.arrayBuffer()), f.bytes);
  }
});

test('metadata GET keeps production auth, origin checks and the Vercel rewrite without paid calls', async t => {
  const f = await fixture(t), calls = [];
  const env = { VERCEL: '1', APP_ORIGINS: `https://${HOST}`, SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: 'FAKE_PUBLIC_KEY' };
  const get = await api(t, { ...f, env, production: true, fetchImpl: async (url, input) => {
    calls.push(url); assert.equal(url, 'https://fixture.supabase.co/auth/v1/user');
    assert.equal(input.headers.Authorization, `Bearer ${TOKEN}`);
    return new Response(JSON.stringify({ id: USER }), { headers: { 'Content-Type': 'application/json' } });
  } }, createVercelHandler);
  const path = '/api/audio?__audio_route=ambience%2Frain&metadata=1';
  const unauthorized = await get(path, { Host: HOST }); assert.equal(unauthorized.status, 401); assert.equal(calls.length, 0);
  const foreign = await get(path, { Host: HOST, Authorization: `Bearer ${TOKEN}`, Origin: 'https://foreign.example' });
  assert.equal(foreign.status, 403); assert.equal(calls.length, 0);
  const authorized = await get(path, { Host: HOST, Authorization: `Bearer ${TOKEN}`, Origin: `https://${HOST}` });
  assert.equal(authorized.status, 200); assert.equal((await authorized.json()).publicUrl, '/audio/ambiences/rain.wav');
  assert.equal(calls.length, 1); // Only session verification; no usage RPC, provider or redirect.
});

test('metadata query retains approved-library priority and binary cache/silent fallback', async t => {
  const f = await fixture(t), libraryDir = join(f.base, 'library'), ownFile = join(f.base, 'approved.wav');
  const approved = wav(); approved.writeInt16LE(-1234, 44); await writeFile(ownFile, approved);
  await registerLibraryClip({ environment: 'rain', file: ownFile, license: 'owned', source: 'Private fixture source', approve: true, rootDir: libraryDir, environments: catalog });
  const getLibrary = await api(t, { ...f, libraryDir });
  const library = await getLibrary('/api/audio/ambience/rain?metadata=1');
  assert.equal(library.headers.get('content-type'), 'audio/wav'); assert.equal(library.headers.get('x-ambience-source'), 'library');
  assert.deepEqual(Buffer.from(await library.arrayBuffer()), approved);
  const cacheDir = join(f.base, 'cache'), mp3 = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00cached fixture');
  await mkdir(cacheDir); await writeFile(join(cacheDir, `${getAmbienceRecipe(rain).revision}.mp3`), mp3);
  const getCache = await api(t, { cacheDir });
  const cached = await getCache('/api/audio/ambience/rain?metadata=1');
  assert.equal(cached.headers.get('content-type'), 'audio/mpeg'); assert.equal(cached.headers.get('x-ambience-source'), 'cache');
  assert.deepEqual(Buffer.from(await cached.arrayBuffer()), mp3);
  const silent = await getCache('/api/audio/ambience/studio?metadata=1');
  assert.equal(silent.headers.get('content-type'), 'audio/wav'); assert.equal(silent.headers.get('x-ambience-source'), 'silent');
  assert.equal(Buffer.from(await silent.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
});

test('metadata is not published for tampered bytes or a traversal manifest path', async t => {
  const f = await fixture(t), get = await api(t, f);
  await writeFile(join(f.publicDir, f.entry.file), Buffer.from('modified bytes'));
  const tampered = await get('/api/audio/ambience/rain?metadata=1');
  assert.equal(tampered.status, 404); assert.equal((await tampered.json()).error.code, 'AMBIENCE_NOT_READY');
  await writeFile(join(f.publicDir, f.entry.file), f.bytes);
  await writeFile(f.bundleManifestPath, JSON.stringify({ version: 1, beds: [{ ...f.entry, file: 'audio/ambiences/../../private.wav' }] }));
  const traversal = await get('/api/audio/ambience/rain?metadata=1');
  assert.equal(traversal.status, 404); assert.equal((await traversal.json()).error.code, 'AMBIENCE_NOT_READY');
});
