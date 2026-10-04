import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAudioHandler } from './audio-handler.mjs';
import { createVercelHandler } from '../api/audio.mjs';
import { digest } from './ambience-library.mjs';

const HOST = 'velora.example';
const USER = '9f38f13a-a029-4bd6-b792-afd045be7730';
const KEY = 'FAKE_ELEVEN_SERVER_SECRET';
const SERVICE = 'FAKE_SUPABASE_SERVICE_SECRET';
const TOKEN = 'test_header_payload.signature_not_real';
const environment = { id: 'rain', prompt: 'Catalog rain, no user script.', sound: { mode: 'bed', version: 2, durationSeconds: 24, promptInfluence: 0.7 } };
const env = { VERCEL: '1', APP_ORIGINS: `https://${HOST}`, SUPABASE_URL: 'https://test-project.supabase.co', SUPABASE_ANON_KEY: 'FAKE_PUBLIC_ANON', SUPABASE_SERVICE_ROLE_KEY: SERVICE, ELEVENLABS_API_KEY: KEY };
const mp3 = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00mock generation');
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const audioResponse = () => new Response(mp3, { headers: { 'Content-Type': 'audio/mpeg' } });
function mockProvider(records, { reservation = {}, auth = { id: USER }, authStatus = 200, rpcStatus = 200, output = audioResponse } = {}) {
  return async (url, input) => {
    records.push({ url, input });
    if (url.endsWith('/auth/v1/user')) { assert.equal(input.headers.apikey, env.SUPABASE_ANON_KEY); assert.equal(input.headers.Authorization, `Bearer ${TOKEN}`); return jsonResponse(auth, authStatus); }
    if (url.endsWith('/rpc/reserve_audio_usage')) { const body = JSON.parse(input.body); assert.equal(input.headers.apikey, SERVICE); assert.equal(input.headers.Authorization, `Bearer ${SERVICE}`); return jsonResponse({ allowed: true, requestId: body.p_request_id, ...reservation }, rpcStatus); }
    if (url.endsWith('/rpc/finish_audio_usage')) return jsonResponse(true);
    if (url.includes('/v2/voices?')) return jsonResponse({ voices: [{ voice_id: 'voice123', name: 'Voz fixture' }] });
    if (url.startsWith('https://api.elevenlabs.io/')) return output();
    throw new Error('Unexpected network request');
  };
}
async function local(t, options = {}, factory = createAudioHandler) {
  const handler = factory({ env, production: true, environments: [{ id: 'studio', prompt: '', sound: { mode: 'silent', version: 2, durationSeconds: 0, promptInfluence: 0 } }, environment], cacheDir: null, libraryDir: null, bundleManifestPath: null, staticDir: null, fetchImpl: () => { throw new Error('Unexpected network request'); }, ...options });
  const server = httpServer((req, res) => { void handler(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Host: HOST, Authorization: `Bearer ${TOKEN}` };
  const invoke = async (path, method, body, extra = {}) => {
    let bytes, contentType;
    if (body instanceof FormData) { const encoded = new Request('https://test.invalid', { method: 'POST', body }); contentType = encoded.headers.get('content-type'); bytes = Buffer.from(await encoded.arrayBuffer()); }
    else if (body !== undefined) { bytes = Buffer.from(JSON.stringify(body)); contentType = 'application/json'; }
    return new Promise((resolveResponse, rejectResponse) => {
      const request = httpRequest(base + path, { method, headers: { ...headers, ...(bytes ? { 'Content-Type': contentType, 'Content-Length': bytes.length } : {}), ...extra } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', rejectResponse);
        response.on('end', () => resolveResponse(new Response(response.statusCode === 204 ? null : Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
      });
      request.on('error', rejectResponse); request.end(bytes);
    });
  };
  return { get: (path, extra = {}) => invoke(path, 'GET', undefined, extra), post: (path, body, extra = {}) => invoke(path, 'POST', body, extra), guide: body => invoke('/api/audio/voice-change', 'POST', body), options: (path, extra = {}) => invoke(path, 'OPTIONS', undefined, extra) };
}
async function error(response, status, code) {
  assert.equal(response.status, status); const raw = await response.text(); assert.ok(![KEY, SERVICE, TOKEN].some(secret => raw.includes(secret))); assert.equal(JSON.parse(raw).error.code, code);
}
const speech = { text: 'Texto privado usado apenas em memória.', voiceId: 'voice123', quality: 'standard' };

test('production status is public, truthful and exposes runtime limits without credentials', async t => {
  const api = await local(t);
  const response = await api.get('/api/audio/status', { Authorization: '' }); assert.equal(response.status, 200);
  const raw = await response.text(); assert.ok(![KEY, SERVICE, TOKEN].some(secret => raw.includes(secret)));
  const status = JSON.parse(raw); assert.equal(status.authRequired, true); assert.equal(status.authConfigured, true); assert.equal(status.usageConfigured, true); assert.equal(status.cachePersistence, 'ephemeral');
  assert.equal(status.voiceChange.maxBytes, 4194304); assert.equal(status.voiceChange.maxDurationSeconds, 120); assert.equal(status.voiceChange.inputSampleRate, 16000); assert.equal(status.voiceChange.inputChannels, 1);
  assert.equal(status.voiceChange.losslessMaxDurationSeconds, 80); assert.equal(status.speech.losslessMaxChars, 1200); assert.equal(status.speech.losslessMaxBytes, 4194304);
  assert.deepEqual(status.limits, { dailyGenerations: 10, dailyProcessingUnits: 15000 });
});

test('every audio operation except status requires an authentic session before provider access', async t => {
  const api = await local(t);
  for (const path of ['/api/audio/voices', '/api/audio/environments', '/api/audio/ambience/studio', '/api/audio/ir/bathroom', '/api/audio/events/rain/door']) await error(await api.get(path, { Authorization: '' }), 401, 'auth_required');
  for (const [path, body] of [['speech', speech], ['ambience', { environment: 'rain' }], ['voice-change', {}]]) await error(await api.post('/api/audio/' + path, body, { Authorization: '' }), 401, 'auth_required');
  const records = [], expired = await local(t, { fetchImpl: mockProvider(records, { auth: { error: SERVICE }, authStatus: 401 }) });
  await error(await expired.post('/api/audio/speech', speech), 401, 'auth_invalid'); assert.equal(records.length, 1); assert.ok(records[0].url.endsWith('/auth/v1/user'));
});

test('unconfigured auth or usage fails closed even with a real-looking Eleven key', async t => {
  const absent = await local(t, { env: { ...env, SUPABASE_URL: undefined } }); await error(await absent.post('/api/audio/speech', speech), 503, 'auth_not_configured');
  const records = [], noUsage = await local(t, { env: { ...env, SUPABASE_SERVICE_ROLE_KEY: undefined }, fetchImpl: mockProvider(records) });
  await error(await noUsage.post('/api/audio/speech', speech), 503, 'usage_unavailable'); assert.equal(records.length, 1);
  const unavailable = await local(t, { fetchImpl: mockProvider([], { rpcStatus: 500 }) }); await error(await unavailable.post('/api/audio/speech', speech), 503, 'usage_unavailable');
});

test('quota refusal prevents all paid calls and maps meaningful limits', async t => {
  for (const code of ['daily_limit', 'daily_budget_limit', 'global_daily_limit', 'global_budget_limit', 'concurrency_limit']) {
    const records = [], api = await local(t, { fetchImpl: mockProvider(records, { reservation: { allowed: false, code } }) });
    await error(await api.post('/api/audio/speech', speech), 429, code); assert.equal(records.length, 2); assert.ok(records.every(record => !record.url.includes('api.elevenlabs.io')));
  }
});

test('paid generation reserves only verified user ID and metadata, then finishes its lease', async t => {
  const records = [], api = await local(t, { fetchImpl: mockProvider(records) });
  const response = await api.post('/api/audio/speech', speech); assert.equal(response.status, 200); assert.equal(response.headers.get('content-length'), null); assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp3);
  assert.deepEqual(records.map(record => new URL(record.url).pathname), ['/auth/v1/user', '/rest/v1/rpc/reserve_audio_usage', '/v1/text-to-speech/voice123', '/rest/v1/rpc/finish_audio_usage']);
  const reservation = JSON.parse(records[1].input.body), completion = JSON.parse(records[3].input.body);
  assert.equal(reservation.p_user_id, USER); assert.equal(reservation.p_units, speech.text.length); assert.equal(reservation.p_daily_limit, 10); assert.equal(reservation.p_global_daily_limit, 50); assert.equal(reservation.p_concurrency, 2);
  assert.ok(!records[1].input.body.includes(speech.text)); assert.deepEqual(completion, { p_user_id: USER, p_request_id: reservation.p_request_id, p_outcome: 'succeeded' });
  await error(await api.post('/api/audio/speech', { ...speech, userId: 'attacker' }), 400, 'invalid_input');
});

test('authenticated lossless speech passes the same durable quota before returning a WAV', async t => {
  const pcm = Buffer.alloc(4800); pcm.writeInt16LE(1234, 0); pcm.writeInt16LE(-1234, 2);
  const records = [], api = await local(t, { fetchImpl: mockProvider(records, { output: () => new Response(pcm, { headers: { 'Content-Type': 'application/octet-stream' } }) }) }, createVercelHandler);
  const response = await api.post('/api/audio?__audio_route=speech', { ...speech, quality: 'lossless' }, { Origin: `https://${HOST}` });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'audio/wav');
  assert.equal(response.headers.get('x-speech-format'), 'pcm_24000'); assert.equal(response.headers.get('content-length'), null);
  assert.ok(response.headers.get('access-control-expose-headers').includes('X-Speech-Format'));
  const bytes = Buffer.from(await response.arrayBuffer()); assert.deepEqual(bytes.subarray(44), pcm);
  assert.equal(JSON.parse(records[1].input.body).p_units, speech.text.length);
  assert.equal(records[2].url, 'https://api.elevenlabs.io/v1/text-to-speech/voice123?output_format=pcm_24000');
  assert.equal(JSON.parse(records[3].input.body).p_outcome, 'succeeded');
  const rejectedRecords = [], rejected = await local(t, { fetchImpl: mockProvider(rejectedRecords, { reservation: { allowed: false, code: 'daily_limit' } }) });
  await error(await rejected.post('/api/audio/speech', { ...speech, quality: 'lossless' }), 429, 'daily_limit');
  assert.ok(rejectedRecords.every(record => !record.url.includes('api.elevenlabs.io')));
});

test('lossless preflight avoids paid calls and oversized output closes its durable lease without retry', async t => {
  const records = [], preflight = await local(t, { fetchImpl: mockProvider(records) });
  await error(await preflight.post('/api/audio/speech', { ...speech, text: 'x'.repeat(1201), quality: 'lossless' }), 400, 'lossless_text_too_long');
  const longGuide = guide(wav(81)); longGuide.append('quality', 'lossless');
  await error(await preflight.guide(longGuide), 400, 'lossless_guide_too_long');
  assert.ok(records.every(record => record.url.endsWith('/auth/v1/user')));
  let cancelled = 0, pulls = 0;
  const oversizeRecords = [], oversize = await local(t, { fetchImpl: mockProvider(oversizeRecords, { output: () => new Response(new ReadableStream({ pull(controller) { pulls++; controller.enqueue(Buffer.alloc(1024 * 1024)); }, cancel() { cancelled++; } }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'audio/pcm' } }) }) });
  await error(await oversize.post('/api/audio/speech', { ...speech, quality: 'lossless' }), 502, 'lossless_audio_too_long');
  assert.equal(cancelled, 1); assert.equal(pulls, 4);
  assert.equal(oversizeRecords.filter(record => record.url.includes('api.elevenlabs.io')).length, 1);
  assert.equal(JSON.parse(oversizeRecords.at(-1).input.body).p_outcome, 'failed');
});

test('lossless Voice Changer supports an 80-second guide while MP3 retains its 120-second production limit', async t => {
  const pcm = Buffer.alloc(80 * 48000); pcm.writeInt16LE(1234, 0);
  const records = [], api = await local(t, { fetchImpl: mockProvider(records, { output: () => new Response(pcm, { headers: { 'Content-Type': 'audio/pcm' } }) }) });
  const request = guide(wav(80)); request.append('quality', 'lossless');
  const response = await api.guide(request); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'audio/wav');
  assert.equal(response.headers.get('x-voice-model'), 'eleven_multilingual_sts_v2'); assert.equal(response.headers.get('x-guide-duration'), '80');
  const bytes = Buffer.from(await response.arrayBuffer()); assert.ok(bytes.length <= 4194304); assert.deepEqual(bytes.subarray(44), pcm);
  assert.equal(records.filter(record => record.url.includes('api.elevenlabs.io')).length, 1);
  assert.ok(records[2].url.endsWith('output_format=pcm_24000'));
});

test('free voice listing and prepared/silent ambience require auth and consume no paid quota', async t => {
  const records = [], api = await local(t, { fetchImpl: mockProvider(records) });
  assert.equal((await api.get('/api/audio/voices')).status, 200); assert.equal((await api.get('/api/audio/ambience/studio')).status, 200); assert.equal((await api.get('/api/audio/environments')).status, 200);
  assert.ok(!records.some(record => record.url.includes('/rpc/')));
  const generated = await api.post('/api/audio/ambience', { environment: 'rain' }); assert.equal(generated.status, 200); await generated.arrayBuffer();
  const calls = records.filter(record => record.url.includes('/rpc/reserve_')).length;
  const cached = await api.post('/api/audio/ambience', { environment: 'rain' }); assert.equal(cached.status, 200); await cached.arrayBuffer(); assert.equal(records.filter(record => record.url.includes('/rpc/reserve_')).length, calls);
});

test('allowed production origins and deployment hostname are exact, no forwarded-host trust', async t => {
  const api = await local(t);
  await error(await api.get('/api/audio/status', { Host: 'evil.example', 'X-Forwarded-Host': HOST }), 403, 'foreign_host');
  await error(await api.get('/api/audio/status', { Origin: 'https://evil.example' }), 403, 'foreign_origin');
  await error(await api.get('/api/audio/status', { Origin: `https://${HOST}.evil.example` }), 403, 'foreign_origin');
  const allowed = await api.get('/api/audio/status', { Origin: `https://${HOST}` }); assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('access-control-allow-origin'), `https://${HOST}`);
  const preflight = await api.options('/api/audio/speech', { Origin: `https://${HOST}`, Authorization: '' }); assert.equal(preflight.status, 204); assert.ok(preflight.headers.get('access-control-allow-headers').includes('Authorization'));
  const deployment = await local(t, { env: { ...env, APP_ORIGINS: undefined, VERCEL_URL: HOST } }); assert.equal((await deployment.get('/api/audio/status')).status, 200);
});

function wav(seconds = 1, sampleRate = 16000, channels = 1) {
  const bytes = Buffer.alloc(44 + seconds * sampleRate * channels * 2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * channels * 2, 28); bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40); bytes.writeInt16LE(10000, 44); return bytes;
}
const guide = bytes => { const form = new FormData(); form.append('audio', new Blob([bytes], { type: 'audio/wav' }), 'guide.wav'); form.append('voiceId', 'voice123'); return form; };
test('production guide constraints fit Vercel request limit and charge only validated input', async t => {
  const records = [], api = await local(t, { fetchImpl: mockProvider(records) });
  await error(await api.guide(guide(wav(1, 48000, 2))), 400, 'invalid_guide_audio');
  await error(await api.guide(guide(wav(121))), 400, 'invalid_guide_audio');
  await error(await api.guide(guide(Buffer.alloc(4200000))), 413, 'guide_too_large');
  assert.ok(!records.some(record => record.url.includes('/rpc/')));
  const response = await api.guide(guide(wav(120))); assert.equal(response.status, 200); assert.equal(response.headers.get('x-voice-model'), 'eleven_multilingual_sts_v2'); await response.arrayBuffer();
  const reservation = JSON.parse(records.find(record => record.url.includes('/rpc/reserve_')).input.body); assert.equal(reservation.p_operation, 'voice_change'); assert.equal(reservation.p_units, 2000);
});

test('single Vercel adapter preserves nested paths and streams a bundle larger than buffered limit', async t => {
  const base = await mkdtemp(join(tmpdir(), 'velora-vercel-test-')); t.after(() => rm(base, { recursive: true, force: true }));
  const publicDir = join(base, 'public'), manifest = join(base, 'bundled-assets.json'); await mkdir(join(publicDir, 'audio'), { recursive: true });
  const bytes = Buffer.alloc(5 * 1024 * 1024); mp3.copy(bytes); await writeFile(join(publicDir, 'audio/rain.mp3'), bytes);
  await writeFile(manifest, JSON.stringify({ version: 1, beds: [{ environment: 'rain', id: 'rain_fixture', file: 'audio/rain.mp3', source: 'https://example.org/fixture', license: 'cc0', sha256: digest(bytes), label: 'Recorded fixture', reviewed: false }] }));
  const records = [], api = await local(t, { publicDir, bundleManifestPath: manifest, fetchImpl: mockProvider(records) }, createVercelHandler);
  const response = await api.get('/api/audio?__audio_route=ambience%2Frain'); assert.equal(response.status, 200); assert.equal(response.headers.get('x-ambience-source'), 'recording'); assert.equal(response.headers.get('content-length'), null); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(records.length, 1); assert.ok(records[0].url.endsWith('/auth/v1/user'));
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')); assert.deepEqual(Object.keys(config.functions), ['api/*.mjs']); assert.equal(config.functions['api/*.mjs'].maxDuration, 150);
  assert.deepEqual(config.rewrites[0], { source: '/api/audio/:path*', destination: '/api/audio?__audio_route=:path*' });
});

test('Vercel rewrite reaches public status, authenticated voices, JSON and multipart without losing query encoding', async t => {
  const records = [], api = await local(t, { fetchImpl: mockProvider(records) }, createVercelHandler);
  const status = await api.get('/api/audio?__audio_route=status', { Authorization: '' });
  assert.equal(status.status, 200); assert.equal((await status.json()).authRequired, true);
  await error(await api.get('/api/audio?__audio_route=voices', { Authorization: '' }), 401, 'auth_required');
  const voices = await api.get('/api/audio?__audio_route=voices&search=Voz+%2B+pt&nextPageToken=token%2B%2F%3D&language=pt');
  assert.equal(voices.status, 200);
  const voiceRequest = new URL(records.find(record => record.url.includes('/v2/voices?')).url);
  assert.equal(voiceRequest.searchParams.get('search'), 'Voz + pt');
  assert.equal(voiceRequest.searchParams.get('next_page_token'), 'token+/=');
  const speechResponse = await api.post('/api/audio?__audio_route=speech', speech);
  assert.equal(speechResponse.status, 200); assert.deepEqual(Buffer.from(await speechResponse.arrayBuffer()), mp3);
  const guideResponse = await api.post('/api/audio?__audio_route=voice-change', guide(wav()));
  assert.equal(guideResponse.status, 200); assert.equal(guideResponse.headers.get('x-voice-model'), 'eleven_multilingual_sts_v2'); await guideResponse.arrayBuffer();
  assert.equal((await api.get('/api/audio/status?__audio_route=voices', { Authorization: '' })).status, 200);
  for (const path of ['../status', 'ambience//rain', 'ambience%2Frain', 'https://other.example']) {
    await error(await api.get('/api/audio?__audio_route=' + encodeURIComponent(path)), 400, 'invalid_route');
  }
  await error(await api.get('/api/audio?__audio_route=status&__audio_route=voices'), 400, 'invalid_route');
});

test('migration grants only service RPC writes and contains transaction lock and ownership guards', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202610010001_audio_access.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes('pg_advisory_xact_lock')); assert.ok(sql.includes("coalesce(auth.role(), '') <> 'service_role'")); assert.ok(sql.includes('auth.uid() <> p_user_id'));
  assert.ok(sql.includes('enable row level security')); assert.ok(sql.includes('to service_role')); assert.ok(sql.includes('from public, anon, authenticated'));
  assert.ok(!sql.includes('grant insert on public.audio_usage_requests to authenticated')); assert.ok(!sql.includes('grant execute on function public.reserve_audio_usage') || sql.includes('to service_role;'));
});
