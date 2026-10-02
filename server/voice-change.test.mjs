import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from './index.mjs';
import { inspectWav } from './wav-audio.mjs';

const KEY = 'sk_test_FAKE_VOICE_CHANGE';
const VOICE = 'testVoice123';
const mp3Bytes = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00mock voice, never real provider audio');
function wav(seconds = 1, channels = 1, sampleRate = 8000) {
  const bytes = Buffer.alloc(44 + seconds * channels * sampleRate * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(channels * sampleRate * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let offset = 44; offset < bytes.length; offset += 2) bytes.writeInt16LE(Math.round(Math.sin(offset / 40) * 5000), offset);
  return bytes;
}
const form = (bytes = wav()) => { const result = new FormData(); result.append('audio', new Blob([bytes], { type: 'audio/wav' }), 'private-original-name.wav'); result.append('voiceId', VOICE); return result; };
async function api(t, options = {}) {
  const server = createServer({ env: { ELEVENLABS_API_KEY: KEY }, environments: [], cacheDir: null, libraryDir: null, bundleManifestPath: null, staticDir: null, fetchImpl: () => { throw new Error('Unexpected paid call'); }, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { post: body => fetch(base + '/api/audio/voice-change', { method: 'POST', body }), base };
}
async function error(response, status, code) {
  assert.equal(response.status, status); const raw = await response.text(); assert.ok(!raw.includes(KEY) && !raw.includes('private-original-name'));
  assert.equal(JSON.parse(raw).error.code, code);
}

test('guide conversion uses actual multipart STS v2 and keeps recorded performance untouched', async t => {
  const calls = [], original = wav(2, 2, 48000);
  const server = await api(t, { fetchImpl: async (url, input) => { calls.push({ url, input }); return new Response(mp3Bytes, { headers: { 'Content-Type': 'audio/mpeg' } }); } });
  const request = form(original); request.append('quality', 'high'); request.append('removeBackgroundNoise', 'true');
  const response = await server.post(request);
  assert.equal(response.status, 200); assert.equal(response.headers.get('x-voice-model'), 'eleven_multilingual_sts_v2'); assert.equal(response.headers.get('x-guide-duration'), '2');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp3Bytes);
  assert.equal(calls.length, 1); const { url, input } = calls[0];
  assert.equal(url, `https://api.elevenlabs.io/v1/speech-to-speech/${VOICE}?output_format=mp3_44100_192`);
  assert.equal(input.method, 'POST'); assert.equal(input.headers['xi-api-key'], KEY); assert.equal(input.headers['Content-Type'], undefined); assert.equal(input.redirect, 'error');
  assert.ok(input.body instanceof FormData); assert.equal(input.body.get('model_id'), 'eleven_multilingual_sts_v2'); assert.equal(input.body.get('file_format'), 'other'); assert.equal(input.body.get('remove_background_noise'), 'true');
  assert.deepEqual([...input.body.keys()], ['audio', 'model_id', 'file_format', 'remove_background_noise']);
  assert.equal(input.body.get('audio').name, 'guide.wav'); assert.deepEqual(Buffer.from(await input.body.get('audio').arrayBuffer()), original);
  const second = await server.post(form()); assert.equal(second.status, 200); await second.arrayBuffer();
  assert.ok(calls[1].url.endsWith('output_format=mp3_44100_128')); assert.equal(calls[1].input.body.get('remove_background_noise'), 'false');
});

test('guide validates file bytes, real duration and fields before provider requests', async t => {
  const server = await api(t);
  await error(await server.post(form(Buffer.from('this is not wav'))), 400, 'invalid_guide_audio');
  await error(await server.post(form(wav(181))), 400, 'invalid_guide_audio');
  await error(await server.post(form(wav().subarray(0, 200))), 400, 'invalid_guide_audio');
  const missing = new FormData(); missing.append('voiceId', VOICE); await error(await server.post(missing), 400, 'guide_required');
  for (const [name, value, code] of [['voiceId', '../bad', 'invalid_input'], ['quality', 'raw', 'invalid_quality'], ['removeBackgroundNoise', 'yes', 'invalid_noise_option'], ['model_id', 'eleven_v3', 'invalid_input']]) {
    const request = form(); request.append(name, value); await error(await server.post(request), 400, code);
  }
  const invalidVoice = form(); invalidVoice.set('voiceId', '../bad'); await error(await server.post(invalidVoice), 400, 'invalid_voice');
  await error(await server.post(new Blob(['{}'], { type: 'application/json' })), 415, 'multipart_required');
  const wrongBits = wav(); wrongBits.writeUInt16LE(24, 34); await error(await server.post(form(wrongBits)), 400, 'invalid_guide_audio');
});

test('guide over 30 MiB is rejected, missing key is honest and wrong methods are rejected', async t => {
  const server = await api(t, { env: {} });
  await error(await server.post(form()), 503, 'provider_not_configured');
  await error(await server.post(form(Buffer.alloc(31 * 1024 * 1024))), 413, 'guide_too_large');
  await error(await fetch(server.base + '/api/audio/voice-change'), 405, 'method_not_allowed');
  const status = await (await fetch(server.base + '/api/audio/status')).json();
  assert.equal(status.voiceChange.configured, false); assert.equal(status.voiceChange.model, 'eleven_multilingual_sts_v2'); assert.equal(status.voiceChange.paid, true);
});

test('voice conversion sanitizes provider errors and times out without retries', async t => {
  let calls = 0;
  const rejected = await api(t, { fetchImpl: async () => { calls++; return new Response(JSON.stringify({ detail: { status: 'quota_exceeded', message: KEY } }), { status: 403 }); } });
  await error(await rejected.post(form()), 402, 'provider_quota_exceeded'); assert.equal(calls, 1);
  const timeout = await api(t, { timeoutMs: 10, fetchImpl: async (_url, input) => { calls++; return new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(new Error(KEY)), { once: true })); } });
  await error(await timeout.post(form()), 504, 'provider_timeout'); assert.equal(calls, 2);
});

test('WAV parser verifies frame alignment, RIFF bounds and rejects nonfinite float samples', () => {
  assert.equal(inspectWav(wav(1, 2, 48000), { pcm16Only: true }).durationSeconds, 1);
  const misaligned = wav(); misaligned.writeUInt16LE(4, 32); assert.throws(() => inspectWav(misaligned));
  const wrongRate = wav(); wrongRate.writeUInt32LE(9999, 28); assert.throws(() => inspectWav(wrongRate));
  const float = Buffer.alloc(48); float.write('RIFF'); float.writeUInt32LE(40, 4); float.write('WAVEfmt ', 8); float.writeUInt32LE(16, 16); float.writeUInt16LE(3, 20); float.writeUInt16LE(1, 22); float.writeUInt32LE(8000, 24); float.writeUInt32LE(32000, 28); float.writeUInt16LE(4, 32); float.writeUInt16LE(32, 34); float.write('data', 36); float.writeUInt32LE(4, 40); float.writeFloatLE(NaN, 44);
  assert.throws(() => inspectWav(float)); float.writeFloatLE(0.5, 44); assert.equal(inspectWav(float).encoding, 3); assert.throws(() => inspectWav(float, { pcm16Only: true }));
});
