import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';

// Numerical helpers run without a provider or browser. OfflineAudioContext is
// deliberately not mocked: the actual DSP render is verified in the browser.
class PCMBuffer {
  constructor({ numberOfChannels, length, sampleRate }) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel) { return this.channels[channel]; }
}

const environments = JSON.parse(fs.readFileSync(new URL('../../shared/environments.json', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('./audio-engine.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
const sandbox = {
  exports, Blob, AudioBuffer: PCMBuffer, Float32Array, ArrayBuffer, DataView,
  require: () => ({ getEnvironment: id => environments.find(environment => environment.id === id) || environments[0] }),
};
vm.runInNewContext(`${compiled}\nObject.assign(exports, { testLoop: makeLoopBuffer, testImpulse: makeImpulse, testRoom: roomSettings, testVoiceGain: voiceCalibration, testBedGain: ambienceCalibration, testTiming: mixTiming, testOffset: stableLoopOffset, testPhase: advancePhase, testSanitize: sanitizedBuffer, testBackgroundPlan: backgroundPlan, testImportedImpulse: prepareImportedImpulse, testImportedRoom: importedRoom, testDistance: effectiveDistance, testCapture: captureSettings, testEvents: validateEventResources, testSceneDucking: sceneDucking, testScheduleDucking: scheduleDucking, testDirectVoice: directVoiceSettings, testHeadroom: attenuateToHeadroom });`, sandbox);

const speech = new Float32Array(1500);
for (let i = 200; i < 600; i++) speech[i] = Math.sin(i * Math.PI * 2 * 0.07) * 0.8;
const envelope = exports.buildDuckingEnvelope([speech], 1000);
const at = time => envelope.find(point => point.time >= time).gain;
assert.ok(at(0.15) > 0.98, 'Silence should not duck the atmosphere.');
assert.ok(at(0.31) < 0.65 && at(0.31) > 10 ** (-6 / 20), 'Speech should lower the atmosphere by no more than 6 dB.');
assert.ok(at(1.2) > 0.85, 'The atmosphere should recover smoothly after speech.');
assert.ok(envelope.every(point => point.gain >= 10 ** (-6 / 20) && point.gain <= 1), 'Ducking is bounded.');
assert.ok(exports.buildDuckingEnvelope([new Float32Array(200)], 1000).every(point => point.gain === 1));

const stereo = new PCMBuffer({ numberOfChannels: 2, length: 4, sampleRate: 48000 });
stereo.getChannelData(0).set([-1, 0, 0.5, 1]);
stereo.getChannelData(1).set([0.25, 0, -0.5, -1]);
const wav = new DataView(await exports.audioBufferToWav(stereo).arrayBuffer());
assert.equal(wav.getUint32(4, true), 36 + 16);
assert.equal(wav.getUint16(22, true), 2, 'WAV must contain two channels.');
assert.equal(wav.getUint32(24, true), 48000);
assert.equal(wav.getUint32(28, true), 192000);
assert.equal(wav.getUint16(34, true), 16);
assert.equal(wav.getInt16(44, true), -32768);
assert.equal(wav.getInt16(46, true), 8192);
assert.equal(wav.getInt16(52, true), 16384);
assert.equal(wav.getInt16(54, true), -16384);
assert.equal(wav.getInt16(58, true), -32768);

const mono = new PCMBuffer({ numberOfChannels: 1, length: 4, sampleRate: 24000 });
mono.getChannelData(0).set([0.1, 0.2, 0.3, 0.4]);
const monoWav = new DataView(await exports.audioBufferToWav(mono).arrayBuffer());
assert.equal(monoWav.getUint32(24, true), 24000, 'The WAV header must use its actual sample rate.');
assert.equal(monoWav.getInt16(44, true), monoWav.getInt16(46, true), 'Mono input must duplicate both output channels.');

const original = new PCMBuffer({ numberOfChannels: 1, length: 1000, sampleRate: 1000 });
for (let i = 0; i < 1000; i++) original.getChannelData(0)[i] = -1 + i / 500;
const bufferFactory = { createBuffer: (numberOfChannels, length, sampleRate) => new PCMBuffer({ numberOfChannels, length, sampleRate }) };
const loop = exports.testLoop(bufferFactory, original, 0.8, 0.65);
assert.ok(Math.abs(loop.getChannelData(0)[0] - loop.getChannelData(0).at(-1)) < 0.004, 'The ambience loop seam should be continuous.');

const bathroom = environments.find(item => item.id === 'bathroom');
const impulse = exports.testImpulse(bufferFactory, bathroom, exports.testRoom(bathroom, { distance: 0, spatial: true }));
assert.equal(impulse.numberOfChannels, 2);
const leftImpulse = impulse.getChannelData(0);
const rightImpulse = impulse.getChannelData(1);
assert.ok(leftImpulse.reduce((sum, sample) => sum + sample * sample, 0) < 0.2, 'Room energy is bounded without replacing the configured reflection gains.');
assert.ok(leftImpulse.some((sample, index) => sample !== rightImpulse[index]), 'Spatial room reflections should differ between channels.');

const studio = await exports.synthesizeAmbience('studio', 0.5);
assert.equal(exports.measureAudio(studio).peak, 0, 'Studio atmosphere must be silent.');
const signatures = new Set();
for (const id of ['rain', 'street', 'cafe', 'car', 'forest', 'beach', 'river', 'fireplace', 'night', 'wind', 'train', 'airplane']) {
  if (!environments.some(environment => environment.id === id)) continue;
  const generated = await exports.synthesizeAmbience(id, 0.5);
  const measured = exports.measureAudio(generated);
  assert.equal(generated.numberOfChannels, 2);
  assert.equal(generated.sampleRate, 48000);
  assert.ok(measured.rms > 0 && measured.peak < 0.5, `${id} should have a nonzero, safe demo signal.`);
  signatures.add(measured.rms.toFixed(7));
}
assert.ok(signatures.size >= 10, 'Demo signals should be numerically distinct; this does not validate location realism.');
await assert.rejects(() => exports.decodeAudio(new Blob([])), /vazio/);
console.log('Basic audio checks passed: ducking, WAV, loop seam, bounded IR and deterministic demo signals. Browser DSP rendering is checked separately.');

const environment = id => environments.find(item => item.id === id);
const dbGain = db => 10 ** (db / 20);
const makeTone = ({ duration = 1, sampleRate = 1000, amplitude = 0.2, frequency = 120, channels = 1, dc = 0 } = {}) => {
  const buffer = new PCMBuffer({ numberOfChannels: channels, length: Math.round(duration * sampleRate), sampleRate });
  for (let channel = 0; channel < channels; channel++) for (let i = 0; i < buffer.length; i++) buffer.getChannelData(channel)[i] = dc + amplitude * Math.sin(i * Math.PI * 2 * frequency / sampleRate + channel * 0.6);
  return buffer;
};

test('technical analysis detects non-finite samples, clipping, DC and silent windows honestly', () => {
  const buffer = makeTone({ duration: 2, amplitude: 0.1, dc: 0.03 });
  const data = buffer.getChannelData(0);
  data[10] = NaN; data[11] = Infinity; data[12] = -Infinity;
  data[15] = 1; data[16] = -1;
  const analysis = exports.analyzeAudio(buffer);
  assert.equal(analysis.nonFiniteSamples, 3);
  assert.equal(analysis.clippedSamples, 2);
  assert.equal(analysis.clippingRatio, 2 / buffer.length);
  assert.equal(analysis.peak, 1);
  assert.equal(analysis.samplePeakDbFS, 0);
  assert.ok(analysis.dcOffset > 0.029 && analysis.dcOffset < 0.031);
  assert.ok(Number.isFinite(analysis.rms) && Number.isFinite(analysis.activeRms));
  assert.equal(analysis.silent, false);
  data.fill(0);
  const silence = exports.analyzeAudio(buffer);
  assert.equal(silence.silent, true);
  assert.equal(silence.silenceRatio, 1);
  assert.equal(silence.activeRms, 0);
  assert.equal(silence.samplePeakDbFS, -Infinity);
});

test('active RMS excludes pauses and voice calibration has bounded gain', () => {
  const speech = makeTone({ duration: 2, amplitude: 0.1 });
  speech.getChannelData(0).fill(0, 1000);
  const analysis = exports.analyzeAudio(speech);
  assert.ok(Math.abs(analysis.activeRms - 0.1 / Math.sqrt(2)) < 0.002);
  assert.ok(Math.abs(analysis.silenceRatio - 0.5) < 0.03);
  assert.equal(exports.testVoiceGain({ activeRms: 0 }), 1);
  assert.equal(exports.testVoiceGain({ activeRms: 0.00002 }), dbGain(12));
  assert.equal(exports.testVoiceGain({ activeRms: 10 }), dbGain(-12));
  assert.equal(exports.testVoiceGain({ activeRms: 0.12 }), 1);
});

test('background uses its profile reference level and continuous independent volume', () => {
  const rain = environment('rain');
  const voice = { activeRms: 0.12 };
  const bed = { activeRms: 0.2, rms: 0.2, silent: false };
  const gain = exports.testBedGain(voice, bed, rain, rain.sound.defaultVolume);
  assert.ok(Math.abs(gain * 0.2 / 0.12 - dbGain(rain.sound.backgroundDb)) < 1e-9);
  assert.equal(exports.testBedGain(voice, bed, rain, 0), 0);
  assert.ok(Math.abs(exports.testBedGain(voice, bed, rain, 25) * 2 - exports.testBedGain(voice, bed, rain, 50)) < 1e-10);
  assert.ok(exports.testBedGain({ activeRms: 0 }, bed, rain, 50) > 0);
  assert.ok(exports.testBedGain(voice, { activeRms: 0.000002, rms: 0.000002, silent: false }, rain, 100) <= 16);
});

test('ducking holds across a short speech gap instead of pumping', () => {
  const speech = new Float32Array(1500);
  for (let i = 200; i < 600; i++) if (i < 400 || i >= 460) speech[i] = Math.sin(i * Math.PI * 2 * 0.14) * 0.8;
  speech[800] = NaN;
  const envelope = exports.buildDuckingEnvelope([speech], 1000);
  const at = time => envelope.find(point => point.time >= time).gain;
  assert.ok(Math.abs(at(0.42) - at(0.46)) < 0.025);
  assert.ok(at(0.67) < 0.65);
  assert.ok(at(1.2) > 0.84 && at(1.2) < 1);
  assert.ok(envelope.every(point => Number.isFinite(point.gain) && point.gain >= dbGain(-6) && point.gain <= 1));
});

test('open air and dry studio never acquire an invented room tail from distance', () => {
  for (const item of environments.filter(item => item.acoustic.kind === 'open' || item.acoustic.kind === 'dry')) {
    assert.equal(exports.testRoom(item, { distance: 0, spatial: true }).wet, 0, item.id);
    assert.equal(exports.testRoom(item, { distance: 100, spatial: true }).wet, 0, item.id);
  }
  const bathroom = exports.testRoom(environment('bathroom'), { distance: 0, spatial: true });
  const bathroomFar = exports.testRoom(environment('bathroom'), { distance: 100, spatial: true });
  assert.ok(bathroom.wet > 0 && bathroomFar.wet > bathroom.wet);
  assert.equal(exports.testRoom(environment('bathroom'), { distance: 100, spatial: false }).wet, 0);
});

test('complete 300 second speech fits with its room tail and guard, without truncation', async () => {
  const room = exports.testRoom(environment('garage'), { distance: 100, spatial: true });
  const timing = exports.testTiming(300, room, 1);
  assert.ok(timing.duration > 300 && timing.duration <= 305);
  assert.ok(timing.duration - 0.04 > timing.voiceStart + 300 + timing.tail);
  assert.ok(timing.voiceStart > 0.009);
  assert.throws(() => exports.testTiming(305, room, 1), /305/);
  const rendered = new PCMBuffer({ numberOfChannels: 2, length: 3020, sampleRate: 10 });
  const wav = new DataView(await exports.audioBufferToWav(rendered).arrayBuffer());
  assert.equal(wav.getUint32(40, true), rendered.length * 4);
});

test('room IR preserves early-reflection gains and decays smoothly, with cached PCM', () => {
  const bathroom = environment('bathroom');
  const room = exports.testRoom(bathroom, { distance: 0, spatial: true });
  const impulse = exports.testImpulse(bufferFactory, bathroom, room);
  const first = bathroom.acoustic.earlyReflections[0];
  const position = Math.round(first.delayMs / 1000 * 48000);
  const expectedLeft = first.gain * Math.cos((first.pan + 1) * Math.PI / 4);
  assert.ok(Math.abs(impulse.getChannelData(0)[position] - expectedLeft) < 1e-6);
  assert.ok(impulse.getChannelData(0).slice(0, position).every(sample => sample === 0));
  const tailPower = impulse.getChannelData(0).slice(-4800).reduce((sum, sample) => sum + sample * sample, 0);
  assert.ok(tailPower < 0.00001);
  assert.equal(exports.testImpulse(bufferFactory, bathroom, room), impulse);
  const open = environment('beach');
  assert.equal(exports.measureAudio(exports.testImpulse(bufferFactory, open, exports.testRoom(open, { distance: 100, spatial: true }))).peak, 0);
});

test('loop width preserves mono and correlated fades do not add a gain swell', () => {
  const tone = makeTone({ frequency: 10, channels: 2 });
  const wide = exports.testLoop(bufferFactory, tone, 0.2, 1);
  const narrow = exports.testLoop(bufferFactory, tone, 0.2, 0.4);
  assert.ok(exports.measureAudio(wide).peak <= 0.201);
  for (let i = 0; i < wide.length; i++) assert.ok(Math.abs((wide.getChannelData(0)[i] + wide.getChannelData(1)[i]) - (narrow.getChannelData(0)[i] + narrow.getChannelData(1)[i])) < 5e-8);
  assert.equal(exports.testLoop(bufferFactory, tone, 0.2, 0.4), narrow);
});

test('loop offset is stable between remixes and equivalent restored voice stems', () => {
  const voice = makeTone();
  const offset = exports.testOffset(voice, 'rain', 24);
  assert.equal(exports.testOffset(voice, 'rain', 24), offset);
  assert.equal(exports.testOffset(makeTone(), 'rain', 24), offset);
  assert.ok(offset >= 0 && offset < 24);
  assert.notEqual(exports.testOffset(makeTone({ frequency: 127 }), 'rain', 24), offset);
});

test('variable oscillator phase has bounded pitch throughout a 300 second clip', () => {
  let phase = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  const sampleRate = 1000;
  for (let i = 0; i < 300 * sampleRate; i++) {
    const previous = phase;
    const frequency = 53 * (1 + Math.sin(i / sampleRate * 0.25) * 0.055);
    phase = exports.testPhase(phase, frequency, sampleRate);
    const instantaneous = ((phase - previous + Math.PI * 2) % (Math.PI * 2)) * sampleRate / (Math.PI * 2);
    minimum = Math.min(minimum, instantaneous); maximum = Math.max(maximum, instantaneous);
  }
  assert.ok(minimum >= 53 * 0.945 - 1e-8);
  assert.ok(maximum <= 53 * 1.055 + 1e-8);
});

test('silent profiles add no demo bed and audible demos are safe and deterministic', async () => {
  for (const item of environments.filter(item => item.sound.mode === 'silent')) {
    assert.equal(exports.measureAudio(await exports.synthesizeAmbience(item.id, 0.3)).peak, 0, item.id);
    assert.equal(exports.testBedGain({ activeRms: 0.12 }, { activeRms: 0.2, rms: 0.2, silent: false }, item, 100), 0);
  }
  for (const item of environments.filter(item => item.sound.mode === 'bed')) {
    const analysis = exports.analyzeAudio(await exports.synthesizeAmbience(item.id, 0.3));
    assert.ok(analysis.rms > 0 && analysis.peak < 0.5 && analysis.nonFiniteSamples === 0, item.id);
  }
  const first = await exports.synthesizeAmbience('car', 0.3);
  const second = await exports.synthesizeAmbience('car', 0.3);
  assert.ok(first.getChannelData(0).every((sample, index) => sample === second.getChannelData(0)[index]));
});

test('invalid PCM is sanitized without modifying the original stem', () => {
  const source = makeTone();
  source.getChannelData(0)[10] = NaN;
  source.getChannelData(0)[11] = Infinity;
  const safe = exports.testSanitize(bufferFactory, source);
  assert.equal(safe.getChannelData(0)[10], 0);
  assert.equal(safe.getChannelData(0)[11], 0);
  assert.ok(Number.isNaN(source.getChannelData(0)[10]));
  assert.equal(exports.analyzeAudio(safe).nonFiniteSamples, 0);
  const bed = makeTone();
  bed.getChannelData(0)[5] = NaN;
  bed.getChannelData(0)[6] = -Infinity;
  bed.getChannelData(0)[7] = 1e30;
  const loop = exports.testLoop(bufferFactory, bed, 0.2, 0.6);
  assert.equal(exports.analyzeAudio(loop).nonFiniteSamples, 0);
  assert.ok(exports.measureAudio(loop).peak <= 12, 'Malformed PCM cannot overflow the browser filters.');
});

test('continuous recordings cover speech without looping and keep their offset across remixes', () => {
  const voice = makeTone({ duration: 12 });
  const bed = makeTone({ duration: 50, channels: 2 });
  const first = exports.testBackgroundPlan(voice, bed, 'rain', 12.072);
  const withTail = exports.testBackgroundPlan(voice, bed, 'rain', 16.272);
  assert.equal(first.loop, false);
  assert.equal(withTail.loop, false);
  assert.equal(first.offset, withTail.offset);
  assert.ok(first.offset >= 0 && first.offset + 16.272 <= bed.duration);
  assert.equal(withTail.stop, 16.272);
  const exactlySpeech = exports.testBackgroundPlan(voice, makeTone({ duration: 12 }), 'rain', 13);
  assert.equal(exactlySpeech.loop, false, 'A natural recording covering the voice should not be shortened into a loop.');
  assert.equal(exactlySpeech.offset, 0);
  assert.equal(exactlySpeech.stop, 12);
  assert.equal(exports.testBackgroundPlan(voice, makeTone({ duration: 4 }), 'rain', 13).loop, true);
});

test('custom beds remain audible with silent acoustic profiles while scene beds remain silent', () => {
  const voice = { activeRms: 0.12 };
  const bed = { activeRms: 0.2, rms: 0.2, silent: false };
  for (const item of environments.filter(item => item.sound.mode === 'silent')) {
    assert.equal(exports.testBedGain(voice, bed, item, 35, 'scene'), 0);
    const custom = exports.testBedGain(voice, bed, item, 35, 'custom');
    assert.ok(Math.abs(custom * 0.2 / 0.12 - dbGain(-30)) < 1e-9);
  }
});

test('imported IR removes declared direct sound before resampling and preserves reflection timing', () => {
  const raw = new PCMBuffer({ numberOfChannels: 1, length: 100, sampleRate: 1000 });
  raw.getChannelData(0)[20] = 1;
  raw.getChannelData(0)[40] = 0.3;
  const metadata = { buffer: raw, directSound: 'included', directArrivalMs: 20, directWindowMs: 5, predelayMode: 'embedded', predelayMs: 80 };
  const processed = exports.testImportedImpulse(bufferFactory, metadata);
  assert.equal(processed.sampleRate, 48000);
  assert.equal(processed.duration, raw.duration);
  assert.ok(processed.getChannelData(0).slice(0, 38 * 48).every(value => value === 0), 'Resampling must not leak the removed direct pulse to adjacent samples.');
  const maximum = Math.max(...processed.getChannelData(0));
  assert.equal(processed.getChannelData(0)[40 * 48], maximum);
  const energy = processed.getChannelData(0).reduce((sum, value) => sum + value * value, 0);
  assert.ok(energy > 0 && energy <= 0.1600001, 'Energy is a ceiling, not mandatory makeup gain for a colored IR.');
  assert.ok(exports.analyzeImpulseResponse(processed).peakSpeechBandGain <= 1.500001);
  assert.equal(raw.getChannelData(0)[20], 1, 'The imported original is retained unchanged.');
  assert.equal(exports.testImportedImpulse(bufferFactory, metadata), processed, 'Identical metadata reuses the small IR PCM.');
});

test('parallel room processing preserves a neutral direct voice at natural and close perspectives', () => {
  for (const perspective of ['close', 'natural', undefined]) for (const distance of [0, 20, 50, 100]) {
    const direct = exports.testDirectVoice({ distance, perspective });
    assert.equal(direct.highShelfDb, 0, 'Room tone must not filter or muffle direct speech.');
    assert.ok(direct.gain >= 0.82 && direct.gain <= 1, 'Distance changes level by at most 1.73 dB.');
  }
  const distant = exports.testDirectVoice({ distance: 100, perspective: 'distant' });
  assert.ok(distant.highShelfDb >= -1.25 && distant.highShelfDb <= 0);
});

test('IR frequency analysis agrees with direct DFT and a single delayed tap', () => {
  const impulse = new PCMBuffer({ numberOfChannels: 1, length: 960, sampleRate: 48000 });
  impulse.getChannelData(0)[37] = 0.4;
  const flat = exports.analyzeImpulseResponse(impulse);
  assert.ok(Math.abs(flat.energyPerChannel - 0.16) < 1e-7);
  assert.ok(Math.abs(flat.peakSpeechBandGain - 0.4) < 1e-7);
  assert.ok(Math.abs(flat.speechBandRmsGain - 0.4) < 1e-7);
  assert.ok(Math.abs(flat.dcGain - 0.4) < 1e-7);
  impulse.getChannelData(0)[103] = 0.25;
  const response = exports.analyzeImpulseResponse(impulse);
  const frequency = response.peakSpeechBandFrequency;
  const re = 0.4 * Math.cos(2 * Math.PI * frequency * 37 / 48000) + 0.25 * Math.cos(2 * Math.PI * frequency * 103 / 48000);
  const im = -0.4 * Math.sin(2 * Math.PI * frequency * 37 / 48000) - 0.25 * Math.sin(2 * Math.PI * frequency * 103 / 48000);
  assert.ok(Math.abs(response.peakSpeechBandGain - Math.hypot(re, im)) < 1e-7, 'FFT and independent direct DFT must agree.');
});

test('a tonal imported IR cannot be boosted until its resonance dominates speech', () => {
  const ringing = makeTone({ duration: 0.3, sampleRate: 48000, frequency: 1000, amplitude: 0.1 });
  const input = ringing.getChannelData(0);
  for (let i = 0; i < input.length; i++) input[i] *= Math.exp(-i / 2400);
  const processed = exports.testImportedImpulse(bufferFactory, { buffer: ringing, directSound: 'removed', predelayMode: 'embedded', wet: 0.14 });
  const response = exports.analyzeImpulseResponse(processed);
  assert.ok(response.energyPerChannel < 0.01, 'A narrow resonance must not be forced to broadband target energy.');
  assert.ok(response.peakSpeechBandGain <= 1.500001);
  assert.ok(response.peakSpeechBandFrequency > 980 && response.peakSpeechBandFrequency < 1020);
  assert.ok(Math.sin(0.14 * Math.PI / 2) * response.peakSpeechBandGain < 0.328, 'Worst sampled resonance remains below the direct speech branch.');
  assert.equal(processed.duration, ringing.duration, 'Calibrating the IR never changes its original timing.');
});

test('water beds use subtle ducking and an isolated click does not change later phrase detection', () => {
  const shower = exports.testSceneDucking(environment('shower'));
  assert.equal(shower.depthDb, 3);
  assert.equal(shower.releaseMs, 650);
  assert.ok(shower.attackMs >= 30 && shower.holdMs >= 100);
  const speech = new Float32Array(48000 * 2);
  for (let i = 16000; i < 68000; i++) speech[i] = 0.008 * Math.sin(i * 2 * Math.PI * 700 / 48000);
  const clean = exports.buildDuckingEnvelope([speech], 48000, shower);
  const clicked = speech.slice(); clicked[2000] = 4;
  const withClick = exports.buildDuckingEnvelope([clicked], 48000, shower);
  const at = (points, time) => points.find(point => point.time >= time).gain;
  assert.ok(Math.abs(at(clean, 0.8) - at(withClick, 0.8)) < 0.005, 'A single loud click cannot hide quieter speech.');
  assert.ok(withClick.every(point => point.gain >= dbGain(-3) && point.gain <= 1));
  const clickOnly = new Float32Array(48000); clickOnly[12000] = 4;
  assert.ok(exports.buildDuckingEnvelope([clickOnly], 48000, shower).every(point => point.gain > 0.999));
  assert.ok(at(clean, 1.75) > at(clean, 1.45), 'The bed returns gradually instead of disappearing between words.');
});

test('all 37 scene profiles retain bounded room energy, coherent quiet modes and complete tails', () => {
  assert.equal(environments.length, 37);
  let maxWet = 0, maxResponse = 0, maxEnergy = 0;
  for (const scene of environments) {
    const room = exports.testRoom(scene, { distance: 20, spatial: true, perspective: 'natural' });
    const ir = exports.testImpulse(bufferFactory, scene, room);
    const analysis = exports.analyzeAudio(ir);
    const response = exports.analyzeImpulseResponse(ir);
    assert.equal(analysis.nonFiniteSamples, 0, scene.id);
    assert.equal(analysis.clippedSamples, 0, scene.id);
    assert.ok(response.energyPerChannel <= 0.18, `${scene.id}: bounded synthetic reflection energy`);
    assert.ok(response.peakSpeechBandGain <= 1.6, `${scene.id}: no strong synthetic speech-band resonance`);
    assert.ok(room.wet <= 0.32, `${scene.id}: restrained normal perspective`);
    const timing = exports.testTiming(300, room, 1);
    assert.ok(timing.duration > 300 && timing.duration < 305, `${scene.id}: complete voice and tail`);
    if (scene.sound.mode === 'silent') assert.equal(exports.testBedGain({ activeRms: 0.12 }, { activeRms: 0.1, rms: 0.1, silent: false }, scene, 100), 0, scene.id);
    if (scene.acoustic.kind === 'open' || scene.acoustic.kind === 'dry') assert.equal(room.wet, 0, scene.id);
    maxWet = Math.max(maxWet, room.wet); maxResponse = Math.max(maxResponse, response.peakSpeechBandGain); maxEnergy = Math.max(maxEnergy, response.energyPerChannel);
  }
  console.log(JSON.stringify({ sceneProfiles: 37, maxWetAtDistance20: maxWet, maxSyntheticIRSpeechGain: maxResponse, maxSyntheticIREnergy: maxEnergy, metric: 'linear response and sample-domain tests, not subjective realism' }));
});

test('bundled room IR files keep their timing and have bounded response after calibration', () => {
  const root = new URL('../../public/audio/impulses/', import.meta.url);
  const files = fs.readdirSync(root).filter(name => name.endsWith('.wav'));
  assert.ok(files.length >= 4, 'The existing room IR assets should remain available.');
  const metrics = [];
  for (const file of files) {
    const bytes = fs.readFileSync(new URL(file, root));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    let fmt, data;
    for (let position = 12; position + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(position + 4);
      const tag = bytes.toString('ascii', position, position + 4);
      if (tag === 'fmt ') fmt = position + 8;
      if (tag === 'data') data = { offset: position + 8, size };
      position += 8 + size + size % 2;
    }
    assert.ok(fmt && data, file);
    const channels = bytes.readUInt16LE(fmt + 2), sampleRate = bytes.readUInt32LE(fmt + 4), bits = bytes.readUInt16LE(fmt + 14);
    const codec = bytes.readUInt16LE(fmt) === 0xfffe ? bytes.readUInt16LE(fmt + 24) : bytes.readUInt16LE(fmt);
    assert.ok(codec === 1 || codec === 3, `${file}: PCM/float fixture required`);
    const source = new PCMBuffer({ numberOfChannels: channels, length: data.size / (bits / 8) / channels, sampleRate });
    for (let channel = 0; channel < channels; channel++) {
      const target = source.getChannelData(channel);
      for (let i = 0; i < target.length; i++) {
        const offset = data.offset + (i * channels + channel) * bits / 8;
        target[i] = codec === 3 ? bits === 64 ? bytes.readDoubleLE(offset) : bytes.readFloatLE(offset)
          : bits === 16 ? bytes.readInt16LE(offset) / 32768 : bits === 24 ? bytes.readIntLE(offset, 3) / 8388608 : bits === 32 ? bytes.readInt32LE(offset) / 2147483648 : (bytes.readUInt8(offset) - 128) / 128;
      }
    }
    const processed = exports.testImportedImpulse(bufferFactory, { buffer: source, directSound: 'included', directArrivalMs: 0, directWindowMs: 5, predelayMode: 'embedded' });
    const response = exports.analyzeImpulseResponse(processed);
    assert.ok(Math.abs(processed.duration - source.duration) < 1 / 48000 + 1e-9, file);
    assert.equal(exports.analyzeAudio(processed).nonFiniteSamples, 0, file);
    assert.ok(response.energyPerChannel > 0 && response.energyPerChannel <= 0.1600001, file);
    assert.ok(response.peakSpeechBandGain <= 1.500001, `${file}: spectral guard`);
    metrics.push({ file, duration: Number(processed.duration.toFixed(4)), energy: Number(response.energyPerChannel.toFixed(5)), speechBandRmsGain: Number(response.speechBandRmsGain.toFixed(4)), peakSpeechBandGain: Number(response.peakSpeechBandGain.toFixed(4)) });
  }
  console.log(JSON.stringify({ calibratedBundledIR: metrics, directWindowFixtureMs: 5, note: 'technical fixture metadata, not proof of direct-arrival measurement or listening approval' }));
});

test('sample headroom attenuates only and preserves every channel, dynamic ratio and final sample', () => {
  const loud = new PCMBuffer({ numberOfChannels: 2, length: 4, sampleRate: 48000 });
  loud.getChannelData(0).set([0.5, 2, -1, 0.1]); loud.getChannelData(1).set([0.25, -1, 0.75, -0.2]);
  exports.testHeadroom(loud);
  const measurement = exports.analyzeAudio(loud);
  assert.ok(measurement.peak <= dbGain(-1));
  assert.equal(measurement.nonFiniteSamples, 0);
  assert.equal(measurement.clippedSamples, 0);
  const scale = loud.getChannelData(0)[1] / 2;
  assert.ok(Math.abs(loud.getChannelData(1)[3] / -0.2 - scale) < 1e-7);
  assert.ok(Math.abs(loud.getChannelData(0)[0] / loud.getChannelData(0)[1] - 0.25) < 1e-7);
  const quiet = makeTone({ amplitude: 0.01 }); const previous = quiet.getChannelData(0).slice();
  exports.testHeadroom(quiet);
  assert.deepEqual(quiet.getChannelData(0), previous, 'Quiet speech is never turned up by the final protection stage.');
});

test('IR embedded and external predelay have one explicit timing convention', () => {
  const raw = new PCMBuffer({ numberOfChannels: 1, length: 100, sampleRate: 1000 });
  raw.getChannelData(0)[20] = 1; raw.getChannelData(0)[40] = 0.3;
  const room = exports.testRoom(environment('bathroom'), { distance: 25, spatial: true });
  const embedded = { buffer: raw, directSound: 'included', directArrivalMs: 20, directWindowMs: 5, predelayMode: 'embedded', predelayMs: 80, wet: 0.2 };
  const external = { ...embedded, predelayMode: 'external' };
  const embeddedRoom = exports.testImportedRoom(room, embedded, 0.25);
  const externalRoom = exports.testImportedRoom(room, external, 0.25);
  assert.equal(embeddedRoom.predelay, 0, 'Embedded room timing must not also get scene or external predelay.');
  assert.equal(externalRoom.predelay, 0.08);
  assert.ok(Math.abs(externalRoom.decay - 0.08) < 1e-12);
  assert.equal(embeddedRoom.lowpass, 22000 * (1 - 0.25 * 0.12), 'Do not stack the selected room damping on an imported IR.');
  const processed = exports.testImportedImpulse(bufferFactory, external);
  assert.ok(Math.abs(processed.duration - 0.08) < 1 / 48000);
  assert.equal(processed.getChannelData(0)[20 * 48], Math.max(...processed.getChannelData(0)), 'External mode anchors arrival at zero then preserves relative reflections.');
  const timing = exports.testTiming(300, { ...externalRoom, decay: 4, predelay: 0.25 }, 1);
  assert.ok(timing.duration > 304.25 && timing.duration < 305, 'The whole voice and IR tail fit without cutting the last words.');
});

test('IR validation rejects excessive, multichannel and empty-reflection resources', () => {
  const impulse = makeTone({ duration: 4.01 });
  assert.throws(() => exports.testImportedImpulse(bufferFactory, { buffer: impulse, directSound: 'removed', predelayMode: 'embedded' }), /4 segundos/);
  assert.throws(() => exports.testImportedImpulse(bufferFactory, { buffer: makeTone({ channels: 3 }), directSound: 'removed', predelayMode: 'embedded' }), /mono ou estéreo/);
  const directOnly = new PCMBuffer({ numberOfChannels: 1, length: 100, sampleRate: 1000 });
  directOnly.getChannelData(0)[0] = 1;
  assert.throws(() => exports.testImportedImpulse(bufferFactory, { buffer: directOnly, directSound: 'included', predelayMode: 'embedded' }), /sem reflexos/);
  const malformed = makeTone({ duration: 0.1 });
  malformed.getChannelData(0)[40] = NaN; malformed.getChannelData(0)[41] = Infinity;
  const safe = exports.testImportedImpulse(bufferFactory, { buffer: malformed, directSound: 'removed', predelayMode: 'embedded' });
  assert.equal(exports.analyzeAudio(safe).nonFiniteSamples, 0);
});

test('reflective outdoor profiles create isolated configured reflections without indoor diffuse energy', () => {
  const outdoor = { ...environment('street'), id: 'test-courtyard', acoustic: { ...environment('street').acoustic, kind: 'reflective-outdoor', reverb: 0.12, decay: 0.4, predelay: 0.03, distanceWet: 0.02, earlyReflections: [{ delayMs: 62, gain: 0.15, pan: -0.2 }, { delayMs: 115, gain: 0.06, pan: 0.3 }] } };
  const room = exports.testRoom(outdoor, { distance: 100, spatial: true });
  assert.ok(room.wet > 0 && room.wet < 0.2);
  assert.equal(room.predelay, 0);
  const impulse = exports.testImpulse(bufferFactory, outdoor, room);
  for (let channel = 0; channel < 2; channel++) {
    const nonzero = Array.from(impulse.getChannelData(channel)).flatMap((value, index) => value ? [index] : []);
    assert.deepEqual(nonzero, [Math.round(0.062 * 48000), Math.round(0.115 * 48000)]);
  }
});

test('event timelines are deterministic, non-overlapping and independent of mix sliders', () => {
  const voice = makeTone({ duration: 90 });
  const clips = [{ id: 'bell', buffer: makeTone({ duration: 1, frequency: 150 }), relativeDb: -25, pan: -0.25 }, { id: 'steps', buffer: makeTone({ duration: 2, frequency: 80 }), relativeDb: -28, pan: 0.15 }];
  const snapshot = list => list.map(({ id, at, pan, relativeDb }) => ({ id, at, pan, relativeDb }));
  const first = exports.createEventTimeline(voice, 'cafe', clips, { minGapSeconds: 3, maxGapSeconds: 8 });
  assert.ok(first.length >= 6);
  assert.deepEqual(snapshot(first), snapshot(exports.createEventTimeline(makeTone({ duration: 90 }), 'cafe', clips, { minGapSeconds: 3, maxGapSeconds: 8 })));
  assert.notDeepEqual(snapshot(first), snapshot(exports.createEventTimeline(voice, 'cafe', clips, { seed: 'different', minGapSeconds: 3, maxGapSeconds: 8 })));
  for (let index = 0; index < first.length; index++) {
    const event = first[index];
    assert.ok(event.at + event.buffer.duration <= voice.duration - 0.1);
    assert.ok(Math.abs(event.pan) <= 0.7);
    if (index) assert.ok(event.at >= first[index - 1].at + first[index - 1].buffer.duration + 3);
  }
  assert.equal(exports.createEventTimeline(voice, 'cafe', []).length, 0);
  const many = exports.createEventTimeline(makeTone({ duration: 300 }), 'cafe', clips, { minGapSeconds: 1, maxGapSeconds: 1 });
  assert.equal(many.length, 24);
});

test('event resource bounds allow repeated stems but prevent unbounded unique PCM', () => {
  const clip = makeTone({ duration: 15 });
  assert.doesNotThrow(() => exports.testEvents(Array.from({ length: 24 }, (_, index) => ({ id: `${index}`, buffer: clip, at: index * 2 }))));
  assert.throws(() => exports.testEvents(Array.from({ length: 25 }, (_, index) => ({ id: `${index}`, buffer: clip, at: index }))), /24 eventos/);
  assert.throws(() => exports.testEvents([{ id: 'oversized', buffer: makeTone({ duration: 15.1 }), at: 0 }]), /15 segundos/);
  assert.throws(() => exports.testEvents(Array.from({ length: 5 }, (_, index) => ({ id: `${index}`, buffer: makeTone({ duration: 15 }), at: index }))), /60 segundos/);
  assert.throws(() => exports.testEvents([{ id: 'invalid', buffer: clip, at: NaN }]), /posição/);
});

test('capture and perspective are restrained and retain default processing', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(exports.testCapture(undefined))), { highpass: 0, lowpass: 0, presenceDb: 0, width: 1 });
  const mobile = exports.testCapture('mobile');
  assert.equal(mobile.highpass, 75);
  assert.ok(mobile.lowpass >= 15000 && mobile.presenceDb <= 1 && mobile.width >= 0.7);
  assert.equal(exports.testDistance({ distance: 50 }), 0.5);
  assert.equal(exports.testDistance({ distance: 50, perspective: 'natural' }), 0.5);
  assert.equal(exports.testDistance({ distance: 50, perspective: 'close' }), 0.225);
  assert.equal(exports.testDistance({ distance: 50, perspective: 'distant' }), 0.625);
  assert.equal(exports.testDistance({ distance: 100, perspective: 'distant' }), 1);
});

test('scene ducking controls are bounded and quieter profiles do not disappear during speech', () => {
  const signal = new Float32Array(1600);
  for (let i = 200; i < 1100; i++) signal[i] = 0.8 * Math.sin(i * 2 * Math.PI * 0.14);
  const gentle = exports.testSceneDucking(environment('car'));
  assert.equal(gentle.depthDb, 3.5);
  const reduced = exports.buildDuckingEnvelope([signal], 1000, gentle);
  assert.ok(reduced.every(point => point.gain >= dbGain(-3.5) && point.gain <= 1));
  assert.ok(reduced.find(point => point.time >= 0.7).gain > 0.65);
  const bounded = exports.buildDuckingEnvelope([signal], 1000, { depthDb: 50, attackMs: 0, holdMs: 10000, releaseMs: 0 });
  assert.ok(bounded.every(point => Number.isFinite(point.gain) && point.gain >= dbGain(-6) && point.gain <= 1));
  const disabled = exports.buildDuckingEnvelope([signal], 1000, { depthDb: 0 });
  assert.ok(disabled.every(point => point.gain === 1));
  const automation = [];
  exports.testScheduleDucking({ setValueAtTime: (value, time) => automation.push({ value, time }), linearRampToValueAtTime: (value, time) => automation.push({ value, time }) }, 0.3, reduced, 0.5, 0.8, 0.012);
  assert.equal(automation[0].time, 0.5);
  assert.ok(automation[0].value < 0.3, 'An event starting mid-sentence inherits the current ducking level.');
  assert.ok(automation.every(point => point.time >= 0.5 && point.time <= 0.8));
});
