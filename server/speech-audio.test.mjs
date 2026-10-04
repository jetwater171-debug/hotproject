import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AudioResponseLimitError, pcm24ToWav, readBoundedAudioResponse } from './speech-audio.mjs';
import { inspectWav } from './wav-audio.mjs';
import { createAudioHandler } from './audio-handler.mjs';

const KEY = 'FAKE_PCM_TEST_KEY';
const VOICE = 'voice_fixture';
const pcm = Buffer.alloc(4800);
pcm.writeInt16LE(-32768, 0); pcm.writeInt16LE(32767, 2); pcm.writeInt16LE(0, 4); pcm.writeInt16LE(-13, 6);

test('raw PCM is wrapped losslessly as browser-decodable mono 24kHz PCM16 WAV', () => {
  const original = Buffer.from(pcm), wav = pcm24ToWav(pcm);
  assert.deepEqual(pcm, original); assert.deepEqual(wav.subarray(44), original);
  const metadata = inspectWav(wav, { pcm16Only: true });
  assert.equal(metadata.channels, 1); assert.equal(metadata.sampleRate, 24000);
  assert.equal(metadata.bits, 16); assert.equal(metadata.durationSeconds, .1);
  assert.equal(wav.readUInt32LE(4), wav.length - 8); assert.equal(wav.readUInt32LE(40), original.length);
});

test('empty, truncated or already encoded provider responses are not disguised as raw PCM', () => {
  for (const bytes of [null, new Uint8Array(4), Buffer.alloc(0), Buffer.alloc(3), Buffer.from('RIFFencoded!'), Buffer.from('OggSencoded!'), Buffer.from('ID3encoded!!'), Buffer.from('fLaCencoded!')]) assert.throws(() => pcm24ToWav(bytes), /invalid_pcm/);
});

test('bounded upstream reader returns exact chunks and cancels oversized bodies before buffering everything', async () => {
  const original = Buffer.from('0123456789');
  const exact = new Response(new ReadableStream({ start(controller) { controller.enqueue(original.subarray(0, 3)); controller.enqueue(original.subarray(3)); controller.close(); } }));
  assert.deepEqual(await readBoundedAudioResponse(exact, 10), original); assert.equal(exact.body.locked, false);
  let cancelledHeader = 0;
  const oversizedHeader = new Response(new ReadableStream({ cancel() { cancelledHeader++; } }), { headers: { 'Content-Length': '11' } });
  await assert.rejects(readBoundedAudioResponse(oversizedHeader, 10), AudioResponseLimitError); assert.equal(cancelledHeader, 1);
  let pulls = 0, cancelledStream = 0;
  const chunked = new Response(new ReadableStream({ pull(controller) { pulls++; controller.enqueue(Buffer.alloc(8)); }, cancel() { cancelledStream++; } }, { highWaterMark: 0 }));
  await assert.rejects(readBoundedAudioResponse(chunked, 10), AudioResponseLimitError);
  assert.equal(pulls, 2); assert.equal(cancelledStream, 1); assert.equal(chunked.body.locked, false);
});

async function api(t, fetchImpl) {
  const handler = createAudioHandler({ env: { ELEVENLABS_API_KEY: KEY, ELEVENLABS_DEFAULT_VOICE_ID: VOICE }, production: false, environments: [], cacheDir: null, libraryDir: null, bundleManifestPath: null, staticDir: null, fetchImpl });
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return body => fetch(`http://127.0.0.1:${server.address().port}/api/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('default and explicit lossless keep the approved script exact and use only supported v3 directions', async t => {
  const calls = [], post = await api(t, async (url, input) => { calls.push({ url, input }); return new Response(pcm, { headers: { 'Content-Type': 'audio/pcm' } }); });
  const text = '  Olá, vc!\n[laughs] Quero 2 itens... 🙂  ';
  for (const [mood, stability, quality] of [['natural', .5, undefined], ['soft', 1, 'lossless'], ['expressive', 0, 'lossless']]) {
    const response = await post({ text, mood, ...(quality ? { quality } : {}) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'audio/wav');
    assert.equal(response.headers.get('x-voice-model'), 'eleven_v3'); assert.equal(response.headers.get('x-speech-format'), 'pcm_24000');
    assert.equal(response.headers.get('x-speech-container'), 'wav'); assert.equal(response.headers.get('x-speech-sample-rate'), '24000'); assert.equal(response.headers.get('x-speech-bit-depth'), '16');
    const wav = Buffer.from(await response.arrayBuffer()); assert.deepEqual(wav.subarray(44), pcm);
    const call = calls.at(-1); assert.equal(call.url, `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=pcm_24000`);
    assert.equal(call.input.redirect, 'error'); assert.ok(call.input.headers.Accept.includes('audio/pcm'));
    assert.deepEqual(JSON.parse(call.input.body), { text, model_id: 'eleven_v3', language_code: 'pt', apply_text_normalization: 'auto', voice_settings: { stability } });
  }
  assert.equal(calls.length, 3);
});

test('invalid PCM and unavailable lossless requests fail clearly without a paid retry or format fallback', async t => {
  for (const [output, expectedStatus] of [[() => new Response(Buffer.alloc(3), { headers: { 'Content-Type': 'audio/pcm' } }), 502], [() => new Response('ID3badresponse', { headers: { 'Content-Type': 'audio/mpeg' } }), 502], [() => new Response(JSON.stringify({ detail: { status: 'unsupported_format', message: KEY } }), { status: 422, headers: { 'Content-Type': 'application/json' } }), 400]]) {
    let calls = 0; const post = await api(t, async () => { calls++; return output(); });
    const response = await post({ text: 'Uma frase de teste.', quality: 'lossless' });
    assert.equal(response.status, expectedStatus); const raw = await response.text(); assert.ok(!raw.includes(KEY)); assert.equal(calls, 1);
  }
});

test('lossless preflight does not truncate text, while the MP3 text limit remains compatible', async t => {
  let calls = 0;
  const post = await api(t, async (url) => { calls++; return url.includes('pcm_24000') ? new Response(pcm, { headers: { 'Content-Type': 'audio/pcm' } }) : new Response('ID3\x04\x00\x00\x00\x00\x00\x00fixture', { headers: { 'Content-Type': 'audio/mpeg' } }); });
  const blocked = await post({ text: 'x'.repeat(1201) }); assert.equal(blocked.status, 400); assert.equal((await blocked.json()).error.code, 'lossless_text_too_long'); assert.equal(calls, 0);
  assert.equal((await post({ text: 'x'.repeat(1200), quality: 'lossless' })).status, 200);
  assert.equal((await post({ text: 'x'.repeat(3000), quality: 'standard' })).status, 200); assert.equal(calls, 2);
});
