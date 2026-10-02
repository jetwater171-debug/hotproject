import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, loadEnvironment } from './index.mjs';

// This key is deliberately fake. All provider calls use an injected mock.
const KEY = 'sk_test_NEVER_USE_A_REAL_KEY';
const VOICE = 'testVoice0123456789';
const env = { ELEVENLABS_API_KEY: KEY, ELEVENLABS_DEFAULT_VOICE_ID: VOICE };
const environments = [
  { id: 'studio', prompt: '' },
  { id: 'rain', prompt: 'Steady rain outside a window. No voice or music.' },
  { id: 'bathroom', prompt: 'Room tone inside a tiled bathroom. No voice or music.' },
];
const audio = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00mock-mp3-bytes');
const mp3 = () => new Response(audio, { headers: { 'content-type': 'audio/mpeg' } });
const providerJson = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const validSpeech = { text: 'Olá. Este roteiro deve permanecer exatamente como foi escrito.', voiceId: VOICE, mood: 'natural', speed: 1 };
const forbiddenFetch = () => { throw new Error('A test attempted an unexpected provider call.'); };

async function localServer(t, options = {}) {
  const server = createServer({ env, environments, cacheDir: null, libraryDir: null, bundleManifestPath: null, staticDir: null, fetchImpl: forbiddenFetch, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    get: (path, headers = {}) => fetch(base + path, { headers }),
    post: (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }),
  };
}

async function errorCode(response, expectedStatus, expectedCode) {
  assert.equal(response.status, expectedStatus);
  const raw = await response.text();
  assert.ok(!raw.includes(KEY), 'Credential must never be returned');
  const data = JSON.parse(raw);
  assert.equal(data.error.code, expectedCode);
  assert.equal(typeof data.error.message, 'string');
  return raw;
}

async function rawGet(url, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    request.on('error', reject); request.end();
  });
}

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'velora-audio-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('status exposes configuration and supported models without credentials', async t => {
  const api = await localServer(t);
  const response = await api.get('/api/audio/status');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { configured: true, model: 'eleven_v3', soundModel: 'eleven_text_to_sound_v2', voiceChange: { model: 'eleven_multilingual_sts_v2', configured: true, maxDurationSeconds: 180, maxBytes: 31457280, inputFormats: ['wav'], paid: true }, defaultVoiceId: VOICE });
  const absent = await localServer(t, { env: {} });
  assert.deepEqual(await (await absent.get('/api/audio/status')).json(), { configured: false, model: 'eleven_v3', soundModel: 'eleven_text_to_sound_v2', voiceChange: { model: 'eleven_multilingual_sts_v2', configured: false, maxDurationSeconds: 180, maxBytes: 31457280, inputFormats: ['wav'], paid: true } });
  const invalidDefault = await localServer(t, { env: { ...env, ELEVENLABS_DEFAULT_VOICE_ID: KEY } });
  assert.ok(!(await (await invalidDefault.get('/api/audio/status')).text()).includes(KEY));
});

test('missing key produces clear errors and studio returns silence without a provider call', async t => {
  let calls = 0;
  const api = await localServer(t, { env: {}, fetchImpl: () => { calls++; return mp3(); } });
  await errorCode(await api.get('/api/audio/voices'), 503, 'provider_not_configured');
  await errorCode(await api.post('/api/audio/speech', validSpeech), 503, 'provider_not_configured');
  await errorCode(await api.post('/api/audio/ambience', { environment: 'rain' }), 503, 'provider_not_configured');
  const response = await api.post('/api/audio/ambience', { environment: 'studio' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/wav');
  assert.equal(response.headers.get('x-ambience-source'), 'silent');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(40), 15 * 8000 * 2);
  assert.ok(bytes.subarray(44).every(byte => byte === 0));
  assert.equal(calls, 0);
});

test('input bounds and strict JSON validation are checked before provider calls', async t => {
  const api = await localServer(t);
  for (const [changes, code] of [
    [{ text: '' }, 'invalid_text'], [{ text: 'x'.repeat(5001) }, 'invalid_text'],
    [{ voiceId: '../invalid' }, 'invalid_voice'], [{ voiceId: null }, 'invalid_voice'],
    [{ mood: ['natural'] }, 'invalid_mood'], [{ mood: null }, 'invalid_mood'], [{ mood: 'unknown' }, 'invalid_mood'],
    [{ speed: 0.69 }, 'speed_not_supported'], [{ speed: 1.21 }, 'speed_not_supported'], [{ speed: '1' }, 'invalid_speed'], [{ speed: null }, 'invalid_speed'],
    [{ quality: 'lossless' }, 'invalid_quality'], [{ use_speaker_boost: true }, 'invalid_input'],
  ]) await errorCode(await api.post('/api/audio/speech', { ...validSpeech, ...changes }), 400, code);
  await errorCode(await api.post('/api/audio/ambience', { environment: 'unlisted' }), 400, 'invalid_environment');
  await errorCode(await api.post('/api/audio/ambience', { environment: 'rain', prompt: 'user prompt' }), 400, 'invalid_input');
  await errorCode(await fetch(api.base + '/api/audio/speech', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }), 415, 'json_required');
  await errorCode(await fetch(api.base + '/api/audio/speech', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' }), 400, 'invalid_json');
  await errorCode(await api.post('/api/audio/speech', []), 400, 'invalid_json');
  await errorCode(await api.post('/api/audio/speech', { ...validSpeech, text: 'x'.repeat(40_000) }), 413, 'body_too_large');
  await errorCode(await api.get('/api/audio/voices?language=not-a-language'), 400, 'invalid_input');
  await errorCode(await api.post('/api/audio/status', {}), 405, 'method_not_allowed');
});

test('local host and Origin guard reject foreign callers and allow Vite and preview origins', async t => {
  const api = await localServer(t);
  await errorCode(await api.get('/api/audio/status', { Origin: 'https://evil.example' }), 403, 'foreign_origin');
  await errorCode(await api.get('/api/audio/status', { Origin: 'http://localhost:9999' }), 403, 'foreign_origin');
  await errorCode(await rawGet(api.base + '/api/audio/status', { Host: 'evil.example:8787' }), 403, 'foreign_host');
  await errorCode(await api.get('/api/audio/status', { 'Sec-Fetch-Site': 'cross-site' }), 403, 'foreign_origin');
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:4173', 'http://127.0.0.1:8787']) assert.equal((await api.get('/api/audio/status', { Origin: origin })).status, 200);
});

test('v3 speech uses verified payload settings, preserves raw script and selects MP3 quality', async t => {
  const calls = [];
  const api = await localServer(t, { fetchImpl: async (url, options) => { calls.push({ url, options }); return mp3(); } });
  for (const [mood, stability] of [['natural', 0.5], ['soft', 1], ['expressive', 0]]) {
    const text = '  Olá! [laughs]\nMeu roteiro não deve receber tags extras.  ';
    const response = await api.post('/api/audio/speech', { text, mood, quality: 'high' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio);
    const call = calls.at(-1);
    assert.equal(call.url, `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_192`);
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers['xi-api-key'], KEY);
    assert.equal(call.options.redirect, 'error');
    assert.deepEqual(JSON.parse(call.options.body), { text, model_id: 'eleven_v3', language_code: 'pt', voice_settings: { stability } });
  }
  await api.post('/api/audio/speech', validSpeech);
  assert.ok(calls.at(-1).url.endsWith('output_format=mp3_44100_128'));
  assert.equal(calls.length, 4);
});

test('voice pagination maps camelcase token and strips private metadata', async t => {
  let calledUrl;
  const api = await localServer(t, { fetchImpl: async url => {
    calledUrl = new URL(url);
    return providerJson({ voices: [
      { voice_id: VOICE, name: `Name ${KEY}`, description: `Description ${KEY}`, preview_url: 'https://cdn.elevenlabs.io/preview.mp3', labels: { language: 'pt', gender: 'female', private_key: KEY, description: KEY }, private_metadata: KEY },
      { voice_id: 'unsafe/path', name: 'ignored' },
      { voice_id: KEY, name: 'credential-shaped id' },
    ], has_more: true, next_page_token: 'next page + token' });
  } });
  const response = await api.get('/api/audio/voices?nextPageToken=page%2Btoken&search=Ana&language=pt');
  assert.equal(response.status, 200);
  const raw = await response.text();
  assert.ok(!raw.includes(KEY));
  assert.deepEqual(JSON.parse(raw), { voices: [{ id: VOICE, name: 'Name [redacted]', description: 'Description [redacted]', previewUrl: 'https://cdn.elevenlabs.io/preview.mp3', labels: { language: 'pt', gender: 'female', description: '[redacted]' } }], hasMore: true, nextPageToken: 'next page + token' });
  assert.equal(calledUrl.pathname, '/v2/voices');
  assert.equal(calledUrl.searchParams.get('page_size'), '100');
  assert.equal(calledUrl.searchParams.get('include_total_count'), 'false');
  assert.equal(calledUrl.searchParams.get('next_page_token'), 'page+token');
  assert.equal(calledUrl.searchParams.get('search'), 'Ana');
  assert.equal(calledUrl.searchParams.get('language'), 'pt');
});

test('provider errors are structured, never expose prompts or keys, and never retry', async t => {
  for (const [status, detailStatus, resultStatus, code] of [
    [401, 'invalid_api_key', 502, 'provider_auth_failed'],
    [403, 'quota_exceeded', 402, 'provider_quota_exceeded'],
    [429, 'too_many_requests', 429, 'provider_rate_limited'],
    [422, 'validation_error', 400, 'provider_rejected'],
    [500, 'unknown', 502, 'provider_unavailable'],
  ]) {
    let calls = 0;
    const api = await localServer(t, { fetchImpl: async () => { calls++; return providerJson({ detail: { status: detailStatus, message: `SECRET ${KEY} ${validSpeech.text}` } }, status); } });
    const raw = await errorCode(await api.post('/api/audio/speech', validSpeech), resultStatus, code);
    assert.ok(!raw.includes(validSpeech.text));
    assert.ok(!raw.includes('SECRET'));
    assert.equal(calls, 1);
  }
});

test('invalid provider response and network exceptions do not reflect upstream data', async t => {
  const invalid = await localServer(t, { fetchImpl: async () => providerJson({ content: KEY }) });
  await errorCode(await invalid.post('/api/audio/speech', validSpeech), 502, 'invalid_provider_response');
  await errorCode(await invalid.get('/api/audio/voices'), 502, 'invalid_provider_response');
  const network = await localServer(t, { fetchImpl: async () => { throw new Error(`${KEY} ${validSpeech.text}`); } });
  await errorCode(await network.post('/api/audio/speech', validSpeech), 502, 'provider_unavailable');
});

test('timeout aborts the provider request with no automatic retry', async t => {
  let calls = 0;
  const api = await localServer(t, { timeoutMs: 20, fetchImpl: async (_url, options) => {
    calls++;
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error(KEY)), { once: true }));
  } });
  await errorCode(await api.post('/api/audio/speech', validSpeech), 504, 'provider_timeout');
  assert.equal(calls, 1);
});

test('two simultaneous generations are allowed and the third is rejected', async t => {
  const pending = [];
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const api = await localServer(t, { fetchImpl: async () => {
    const request = new Promise(resolve => pending.push(resolve));
    if (pending.length === 2) signalStarted();
    return request;
  } });
  const first = api.post('/api/audio/speech', validSpeech);
  const second = api.post('/api/audio/speech', validSpeech);
  await started;
  await errorCode(await api.post('/api/audio/speech', validSpeech), 429, 'concurrency_limit');
  assert.equal(pending.length, 2);
  pending.forEach(resolve => resolve(mp3()));
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
});

test('ambience is singleflight per environment, cached, and uses only catalog prompts', async t => {
  let calls = 0, release, signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const records = [];
  const api = await localServer(t, { fetchImpl: async (url, options) => {
    calls++; records.push({ url, options }); signalStarted();
    return new Promise(resolve => { release = resolve; });
  } });
  const first = api.post('/api/audio/ambience', { environment: 'rain' });
  await started;
  const second = api.post('/api/audio/ambience', { environment: 'rain' });
  // Wait for local HTTP to deliver the second request while the mock is pending.
  await new Promise(resolve => setTimeout(resolve, 20));
  release(mp3());
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(Buffer.from(await a.arrayBuffer()), audio);
  assert.deepEqual(Buffer.from(await b.arrayBuffer()), audio);
  const cached = await api.post('/api/audio/ambience', { environment: 'rain' });
  assert.equal(cached.headers.get('x-ambience-source'), 'cache');
  assert.equal(calls, 1);
  assert.equal(records[0].url, 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128');
  assert.deepEqual(JSON.parse(records[0].options.body), { text: environments[1].prompt, duration_seconds: 15, prompt_influence: 0.35, model_id: 'eleven_text_to_sound_v2', loop: true });
});

test('disk cache survives a new handler without another provider call', async t => {
  const cacheDir = await temporary(t);
  let calls = 0;
  const first = await localServer(t, { cacheDir, fetchImpl: async () => { calls++; return mp3(); } });
  assert.equal((await first.post('/api/audio/ambience', { environment: 'bathroom' })).status, 200);
  assert.equal((await readdir(cacheDir)).filter(file => file.endsWith('.mp3')).length, 1);
  const second = await localServer(t, { cacheDir });
  const response = await second.post('/api/audio/ambience', { environment: 'bathroom' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-ambience-source'), 'cache');
  assert.equal(calls, 1);
});

test('oversized chunked JSON returns a 413 instead of destroying the response socket', async t => {
  const api = await localServer(t);
  const result = await new Promise((resolve, reject) => {
    const request = httpRequest(api.base + '/api/audio/speech', { method: 'POST', headers: { 'content-type': 'application/json' } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    request.on('error', reject);
    request.write('{"text":"' + 'x'.repeat(40_000)); request.end('"}');
  });
  assert.equal(result.status, 413);
  assert.equal(result.body.error.code, 'body_too_large');
});

test('environment precedence is process values, then .env.local, then .env', async t => {
  const rootDir = await temporary(t);
  await writeFile(join(rootDir, '.env.local'), 'ELEVENLABS_API_KEY=fake_local\nPORT=8788\nLOCAL_ONLY="local value"\n');
  await writeFile(join(rootDir, '.env'), 'ELEVENLABS_API_KEY=fake_fallback\nPORT=8789\nFALLBACK_ONLY=fallback\n');
  const target = { ELEVENLABS_API_KEY: 'fake_process' };
  await loadEnvironment({ rootDir, target });
  assert.deepEqual(target, { ELEVENLABS_API_KEY: 'fake_process', PORT: '8788', LOCAL_ONLY: 'local value', FALLBACK_ONLY: 'fallback' });
});

test('production static fallback serves only the configured dist directory and blocks dotfiles', async t => {
  const staticDir = await temporary(t);
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>Test app</title>');
  await writeFile(join(staticDir, '.env'), KEY);
  const api = await localServer(t, { staticDir });
  assert.equal((await api.get('/')).headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal((await api.get('/studio')).status, 200);
  await errorCode(await api.get('/.env'), 404, 'not_found');
  await errorCode(await api.get('/api/unknown'), 404, 'not_found');
});
