import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAudioLibrary } from './audio-library.mjs';
import { runPrepareAmbiences } from './prepare-ambiences.mjs';
import { createAmbienceLibrary } from '../server/ambience-library.mjs';
import { getAmbienceRecipe } from '../server/audio-handler.mjs';

const mp3 = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00test fixture, not a real ambience');
const catalog = [
  { id: 'studio', prompt: '', sound: { mode: 'silent', version: 2, durationSeconds: 0, promptInfluence: 0 } },
  { id: 'rain', prompt: 'Rain', sound: { mode: 'bed', version: 2, durationSeconds: 24, promptInfluence: 0.72 } },
  { id: 'street', prompt: 'Street', sound: { mode: 'bed', version: 2, durationSeconds: 30, promptInfluence: 0.68 } },
];
const statusResponse = configured => new Response(JSON.stringify({ configured }), { headers: { 'content-type': 'application/json' } });
const audioResponse = () => new Response(mp3, { headers: { 'content-type': 'audio/mpeg', 'x-ambience-source': 'generated', 'x-ambience-reviewed': 'false' } });
async function temporary(t) { const path = await mkdtemp(join(tmpdir(), 'velora-audio-cli-test-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }

test('prepare defaults to a local plan with zero network calls', async t => {
  const cacheDir = await temporary(t), messages = []; let calls = 0;
  const plan = await runPrepareAmbiences([], { catalog, cacheDir, bundleManifestPath: null, libraryDir: null, log: message => messages.push(message), fetchImpl: async () => { calls++; throw new Error('No request expected'); } });
  assert.deepEqual(plan.map(item => item.status), ['silent', 'missing', 'missing']);
  assert.ok(messages.some(message => message.includes('Nenhuma geração')));
  assert.equal(calls, 0);
});

test('prepare resumes cached candidates and never regenerates them', async t => {
  const cacheDir = await temporary(t);
  for (const environment of catalog.filter(item => item.sound.mode === 'bed')) await writeFile(join(cacheDir, getAmbienceRecipe(environment).revision + '.mp3'), mp3);
  let calls = 0;
  const plan = await runPrepareAmbiences(['--generate'], { catalog, cacheDir, bundleManifestPath: null, libraryDir: null, log: () => {}, fetchImpl: async () => { calls++; throw new Error('No request expected'); } });
  assert.deepEqual(plan.map(item => item.status), ['silent', 'generated', 'generated']);
  assert.equal(calls, 0);
});

test('prepare with no server key checks status and submits zero paid POSTs', async t => {
  let calls = 0;
  await assert.rejects(runPrepareAmbiences(['--generate'], { catalog, cacheDir: await temporary(t), bundleManifestPath: null, libraryDir: null, baseUrl: 'http://127.0.0.1:8787', log: () => {}, fetchImpl: async url => { calls++; assert.ok(url.endsWith('/api/audio/status')); return statusResponse(false); } }), error => error.code === 'provider_not_configured');
  assert.equal(calls, 1);
});

test('explicit generation is sequential, skips silence and never approves candidates', async t => {
  const calls = []; let active = 0, maximum = 0;
  const plan = await runPrepareAmbiences(['--generate'], { catalog, cacheDir: await temporary(t), bundleManifestPath: null, libraryDir: null, baseUrl: 'http://127.0.0.1:8787', log: () => {}, fetchImpl: async (url, input) => {
    calls.push({ url, input });
    if (url.endsWith('/status')) return statusResponse(true);
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return audioResponse();
  } });
  assert.equal(maximum, 1);
  assert.deepEqual(calls.filter(item => item.input.method === 'POST').map(item => JSON.parse(item.input.body)), [{ environment: 'rain' }, { environment: 'street' }]);
  assert.deepEqual(plan.map(item => item.status), ['silent', 'generated', 'generated']);
  assert.ok(calls.every(item => item.url.startsWith('http://127.0.0.1:8787/')));
});

test('failed generation stops without retries or submissions for later environments', async t => {
  let calls = 0;
  await assert.rejects(runPrepareAmbiences(['--generate'], { catalog, cacheDir: await temporary(t), bundleManifestPath: null, libraryDir: null, baseUrl: 'http://127.0.0.1:8787', log: () => {}, fetchImpl: async url => {
    calls++;
    return url.endsWith('/status') ? statusResponse(true) : new Response(JSON.stringify({ error: { code: 'provider_quota_exceeded', message: 'Saldo insuficiente.' } }), { status: 402, headers: { 'content-type': 'application/json' } });
  } }), error => error.code === 'preparation_failed');
  assert.equal(calls, 2);
});

test('prepare rejects remote API URLs before issuing any request', async t => {
  let calls = 0;
  await assert.rejects(runPrepareAmbiences(['--generate', '--url', 'https://external.example:8787'], { catalog, cacheDir: await temporary(t), bundleManifestPath: null, libraryDir: null, log: () => {}, fetchImpl: async () => { calls++; return statusResponse(true); } }), error => error.code === 'invalid_url');
  assert.equal(calls, 0);
});

test('library CLI imports local files and requires explicit approval', async t => {
  const base = await temporary(t), rootDir = join(base, 'library'), file = join(base, 'rain.mp3'); await writeFile(file, mp3);
  const args = ['--environment', 'rain', '--file', file, '--license', 'owned', '--source', 'Local test recording'];
  const settings = { catalog, rootDir, log: () => {} };
  assert.equal((await runAudioLibrary(args, settings)).reviewed, false);
  assert.equal(await createAmbienceLibrary({ rootDir }).readApproved('rain'), null);
  assert.equal((await runAudioLibrary([...args, '--approve'], settings)).reviewed, true);
  assert.deepEqual((await createAmbienceLibrary({ rootDir }).readApproved('rain')).bytes, mp3);
});

test('cached candidate registration keeps ElevenLabs provenance and approval explicit', async t => {
  const base = await temporary(t), cacheDir = base, rootDir = join(base, 'library');
  await writeFile(join(cacheDir, getAmbienceRecipe(catalog[1]).revision + '.mp3'), mp3);
  const settings = { catalog, rootDir, cacheDir, log: () => {} };
  assert.equal((await runAudioLibrary(['--environment', 'rain', '--cached'], settings)).status, 'draft');
  await runAudioLibrary(['--environment', 'rain', '--cached', '--approve'], settings);
  const manifest = JSON.parse(await readFile(join(rootDir, 'library.json'), 'utf8'));
  assert.equal(manifest.entries.rain.license, 'elevenlabs');
  assert.equal(manifest.entries.rain.reviewed, true);
  assert.ok(manifest.entries.rain.source.startsWith('ElevenLabs Sound Effects v2'));
  await assert.rejects(runAudioLibrary(['--environment', 'rain', '--cached', '--license', 'cc0'], settings), error => error.code === 'invalid_arguments');
});
