import { getEnvironment } from './environments';

export interface MixOptions {
  environment: string;
  voiceVolume: number;
  ambientVolume: number;
  distance: number;
  ducking: boolean;
  spatial: boolean;
  /** Clean is neutral; mobile is a restrained full-mix microphone response. */
  capture?: 'clean' | 'mobile';
  perspective?: 'close' | 'natural' | 'distant';
  duckingProfile?: DuckingProfile;
  /** Prefer the fourth argument for non-serializable local resources. */
  impulseResponse?: MixImpulseResponse;
  events?: AmbientEvent[];
  ambienceSource?: 'scene' | 'custom';
}

export interface DuckingProfile { depthDb?: number; attackMs?: number; holdMs?: number; releaseMs?: number }
export interface MixImpulseResponse {
  buffer: AudioBuffer;
  label?: string;
  /** Supplied provenance only; importing a file does not prove it is measured. */
  source?: 'imported' | 'recorded' | 'synthetic';
  directSound: 'included' | 'removed';
  directArrivalMs?: number;
  directWindowMs?: number;
  /** Embedded preserves original timing; external shifts the declared arrival
   * to zero, then applies only predelayMs. No scene predelay is added. */
  predelayMode: 'embedded' | 'external';
  predelayMs?: number;
  /** Room send amount; the direct voice stays intact. Default .18. */
  wet?: number;
}
export interface AmbientEvent { id: string; buffer: AudioBuffer; at: number; volume?: number; pan?: number; relativeDb?: number }
export interface AmbientEventClip { id: string; buffer: AudioBuffer; volume?: number; pan?: number; relativeDb?: number; minGapSeconds?: number; maxGapSeconds?: number }
export interface EventTimelineOptions { seed?: string | number; minGapSeconds?: number; maxGapSeconds?: number }
export interface MixResources { impulseResponse?: MixImpulseResponse; events?: AmbientEvent[]; ambienceSource?: 'scene' | 'custom' }

export interface AudioMeasurement { peak: number; rms: number; duration: number }
/** Sample-domain diagnostics only. These are not LUFS or inter-sample true peak. */
export interface AudioAnalysis extends AudioMeasurement {
  samplePeakDbFS: number;
  activeRms: number;
  dcOffset: number;
  dcByChannel: number[];
  nonFiniteSamples: number;
  /** Samples at/near full scale (|x| >= .999): a saturation warning, not proof of clipping. */
  clippedSamples: number;
  clippingRatio: number;
  silenceRatio: number;
  silent: boolean;
}
export interface DuckingPoint { time: number; gain: number }
export interface AudioPlayer { stop(): void }
/** Linear IR diagnostics, not a room measurement or perceptual quality score. */
export interface ImpulseResponseAnalysis {
  energyPerChannel: number;
  speechBandRmsGain: number;
  peakSpeechBandGain: number;
  peakSpeechBandFrequency: number;
  dcGain: number;
}

const SAMPLE_RATE = 48_000;
const MAX_DURATION = 300;
const MAX_RENDER_DURATION = 305;
const MAX_DECODE_BYTES = 64 * 1024 * 1024;
const HEADROOM = 10 ** (-1 / 20);
const VOICE_ACTIVE_RMS = 0.12;
const LEAD_IN = 0.012;
const END_GUARD = 0.06;
const MAX_IR_DURATION = 4;
const MAX_EVENT_DURATION = 15;
const MAX_EVENTS = 24;
const MAX_EVENT_STEM_SECONDS = 60;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const finiteSample = (value: number) => Number.isFinite(value) ? value : 0;
const dbGain = (db: number) => 10 ** (db / 20);

type AcousticKind = 'dry' | 'small-hard' | 'furnished' | 'large' | 'open' | 'reflective-outdoor' | 'vehicle';
interface EarlyReflection { delayMs: number; gain: number; pan: number }
type EngineEnvironment = ReturnType<typeof getEnvironment> & {
  sound?: { version: number; mode: 'silent' | 'bed'; backgroundDb: number; crossfadeSeconds: number; stereoWidth: number; defaultVolume: number };
  acoustic: ReturnType<typeof getEnvironment>['acoustic'] & { kind?: AcousticKind; distanceWet?: number; earlyReflections?: EarlyReflection[] };
};
interface RoomSettings { kind: AcousticKind; wet: number; decay: number; predelay: number; lowpass: number; highpass: number; earlyReflections: EarlyReflection[] }
const analysisCache = new WeakMap<AudioBuffer, AudioAnalysis>();
const duckingCache = new WeakMap<AudioBuffer, Map<string, DuckingPoint[]>>();
const seedCache = new WeakMap<AudioBuffer, number>();
const loopCache = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();
const impulseCache = new Map<string, AudioBuffer>();
const importedImpulseCache = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();

function contextConstructor(): typeof AudioContext {
  const AudioContextType = globalThis.AudioContext || (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextType) throw new Error('Este navegador não oferece processamento de áudio. Abra o estúdio em um navegador atualizado.');
  return AudioContextType;
}

function validateBuffer(buffer: AudioBuffer, maximumDuration = MAX_DURATION): void {
  if (!buffer.length || !Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('O áudio está vazio ou não pôde ser lido.');
  if (buffer.duration > maximumDuration + 0.001) throw new Error(`O áudio deve ter no máximo ${maximumDuration} segundos para o processamento local.`);
  if (buffer.numberOfChannels > 8) throw new Error('Este arquivo tem canais demais. Exporte uma versão mono ou estéreo.');
}

/** Check duration using browser metadata before allocating a full PCM decode. */
async function inspectDuration(blob: Blob): Promise<number | null> {
  if (typeof Audio === 'undefined') return null;
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const media = new Audio();
    let complete = false;
    const finish = (duration: number | null, error?: Error) => {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
      URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(duration);
    };
    const timeout = window.setTimeout(() => finish(null), 8_000);
    media.preload = 'metadata';
    media.onloadedmetadata = () => finish(Number.isFinite(media.duration) ? media.duration : null);
    media.onerror = () => finish(null, new Error('O navegador não reconheceu o áudio. Exporte em WAV, MP3 ou M4A e tente novamente.'));
    media.src = url;
  });
}

/** Imports use 180; speech defaults to 300; rendered mixes may explicitly pass 305. */
export async function decodeAudio(blob: Blob, maxDuration = MAX_DURATION, maxBytes?: number): Promise<AudioBuffer> {
  const limit = clamp(maxDuration, 1, MAX_RENDER_DURATION);
  const byteLimit = maxBytes === undefined ? (limit <= 180 ? 30 * 1024 * 1024 : MAX_DECODE_BYTES) : clamp(maxBytes, 1, MAX_DECODE_BYTES);
  if (!blob.size) throw new Error('O arquivo de áudio está vazio.');
  if (blob.size > byteLimit) throw new Error(`O áudio deve ter até ${Math.round(byteLimit / 1024 / 1024)} MB.`);
  const metadataDuration = await inspectDuration(blob);
  if (metadataDuration && metadataDuration > limit + 0.001) throw new Error(`O áudio deve ter no máximo ${Math.round(limit / 60)} minutos (${Math.round(limit)} segundos).`);
  const AudioContextType = contextConstructor();
  const context = new AudioContextType({ sampleRate: SAMPLE_RATE });
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    validateBuffer(decoded, limit);
    if (decoded.duration > limit + 0.001) throw new Error(`O áudio deve ter no máximo ${Math.round(limit / 60)} minutos (${Math.round(limit)} segundos).`);
    return decoded;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('O áudio deve')) throw error;
    throw new Error('Não foi possível decodificar esse áudio. Use um arquivo WAV, MP3 ou M4A válido.');
  } finally {
    await context.close().catch(() => undefined);
  }
}

function seedFromString(text: string): number {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619);
  return seed >>> 0;
}

function randomGenerator(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Integrating frequency keeps a varying oscillator bounded over long clips. */
function advancePhase(phase: number, frequency: number, sampleRate: number): number {
  return (phase + Math.PI * 2 * clamp(frequency, 0, sampleRate * 0.45) / sampleRate) % (Math.PI * 2);
}

function ambienceKind(environment: string): string {
  const definition = getEnvironment(environment);
  const configured: unknown = definition.synth;
  return typeof configured === 'string' ? configured : definition.id;
}

/** Local sound design demonstration only: no generated speech or provider call. */
export async function synthesizeAmbience(environment: string, duration = 14): Promise<AudioBuffer> {
  const seconds = clamp(duration, 0.25, MAX_DURATION);
  const length = Math.ceil(seconds * SAMPLE_RATE);
  const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: SAMPLE_RATE });
  const definition = getEnvironment(environment) as EngineEnvironment;
  const kind = ambienceKind(environment);
  if (definition.sound?.mode === 'silent' || definition.id === 'studio' || kind === 'silence' || kind === 'none' || kind === 'studio') return buffer;
  const random = randomGenerator(seedFromString(definition.id));
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let lowNoise = 0;
  let middleNoise = 0;
  let otherNoise = 0;
  const isRain = /rain|chuva|storm/.test(kind);
  const isBathroom = definition.id === 'bathroom' || /bathroom|banheiro/.test(kind);
  const isStreet = /street|city|rua|traffic/.test(kind);
  const isCafe = /cafe|café|coffee|party/.test(kind);
  const isCar = /car|drive|carro|engine/.test(kind);
  let enginePhase = 0;
  let trafficPhase = 0;
  for (let i = 0; i < length; i++) {
    const time = i / SAMPLE_RATE;
    const white = random() * 2 - 1;
    const whiteOther = random() * 2 - 1;
    lowNoise += 0.025 * (white - lowNoise);
    middleNoise += (isRain ? 0.38 : 0.13) * (white - middleNoise);
    otherNoise += (isRain ? 0.38 : 0.06) * (whiteOther - otherNoise);
    let sound = lowNoise * 0.06;
    let side = otherNoise * 0.015;
    if (isRain) {
      const density = 0.86 + Math.sin(time * 0.34) * 0.12;
      sound = middleNoise * 0.24 * density + lowNoise * 0.05;
      side = otherNoise * 0.07;
      const dropTime = time % 0.173;
      sound += Math.sin(dropTime * 2100 * Math.PI * 2) * Math.exp(-dropTime * 110) * 0.009;
      if (kind === 'storm') {
        const thunderTime = time % 8.7;
        const thunder = Math.sin(thunderTime * Math.PI * 2 * 39) * Math.exp(-thunderTime * 0.95) * Math.min(1, thunderTime * 3);
        sound += lowNoise * 0.28 + thunder * 0.047;
      }
    } else if (isBathroom) {
      const dropTime = time % 1.37;
      const tap = Math.sin(dropTime * 1320 * Math.PI * 2) * Math.exp(-dropTime * 58) * 0.025;
      const reflectedTime = (time + 1.37 - 0.053) % 1.37;
      sound = lowNoise * 0.16 + tap + Math.sin(reflectedTime * 1260 * Math.PI * 2) * Math.exp(-reflectedTime * 47) * 0.009;
      side = otherNoise * 0.02;
    } else if (isStreet) {
      const passing = (Math.sin(time * 0.9 - 1.1) + 1) / 2;
      sound = lowNoise * (0.12 + passing * 0.34) + middleNoise * 0.04;
      trafficPhase = advancePhase(trafficPhase, 68 + passing * 11, SAMPLE_RATE);
      sound += Math.sin(trafficPhase) * 0.014 * passing;
      side = otherNoise * 0.045 + lowNoise * Math.sin(time * 0.4) * 0.07;
    } else if (isCafe) {
      const syllables = (Math.sin(time * 11) ** 2) * (0.4 + Math.sin(time * 2.4) ** 2 * 0.4);
      sound = middleNoise * 0.07 + lowNoise * 0.1;
      sound += (Math.sin(time * 2 * Math.PI * 183) + Math.sin(time * 2 * Math.PI * 287) * 0.5) * syllables * (kind === 'party' ? 0.025 : 0.012);
      const clinkTime = time % 3.79;
      sound += (Math.sin(clinkTime * 2 * Math.PI * 2040) + Math.sin(clinkTime * 2 * Math.PI * 3100) * 0.4) * Math.exp(-clinkTime * 34) * 0.01;
      side = otherNoise * 0.045;
    } else if (isCar) {
      const engineSpeed = 1 + Math.sin(time * 0.25) * 0.055;
      const engineTone = definition.id === 'bus' ? 37 : 53;
      enginePhase = advancePhase(enginePhase, engineTone * engineSpeed, SAMPLE_RATE);
      sound = lowNoise * 0.23 + Math.sin(enginePhase) * 0.023 + Math.sin(enginePhase * 2) * 0.008;
      side = otherNoise * 0.024;
    } else if (kind === 'waves') {
      const swell = (0.5 + Math.sin(time * 0.72 - 1.2) * 0.5) ** 1.5;
      sound = middleNoise * (0.055 + swell * 0.32) + lowNoise * swell * 0.16;
      side = otherNoise * (0.035 + swell * 0.045);
    } else if (kind === 'river') {
      sound = middleNoise * 0.23 + lowNoise * 0.1;
      const bubble = time % 0.319;
      sound += Math.sin(2 * Math.PI * (640 * bubble + 1300 * bubble * bubble)) * Math.exp(-bubble * 52) * 0.012;
      side = otherNoise * 0.065;
    } else if (kind === 'forest') {
      sound = lowNoise * (0.13 + Math.sin(time * 0.41) ** 2 * 0.1) + middleNoise * 0.026;
      const bird = time % 4.93;
      const birdGate = bird < 0.32 ? Math.sin(bird / 0.32 * Math.PI) ** 2 : 0;
      sound += Math.sin(Math.PI * 2 * (1740 * bird + 1050 * bird * bird)) * birdGate * 0.016;
      side = otherNoise * 0.036;
    } else if (kind === 'night') {
      const chirp = Math.sin(time * Math.PI * 2 * 3.8) ** 8;
      sound = lowNoise * 0.045 + Math.sin(time * Math.PI * 2 * 3100) * chirp * 0.01;
      side = otherNoise * 0.013;
    } else if (kind === 'fire') {
      const crackle = Math.abs(white) > 0.998 ? white * 0.07 : 0;
      sound = lowNoise * 0.19 + middleNoise * 0.035 + crackle;
      side = otherNoise * 0.024;
    } else if (kind === 'wind') {
      const gust = 0.2 + Math.sin(time * 0.38) ** 2 * 0.8;
      sound = lowNoise * (0.18 + gust * 0.4) + middleNoise * gust * 0.023;
      side = otherNoise * 0.06 * gust;
    } else if (kind === 'rail') {
      const joint = time % (definition.id === 'train' ? 0.59 : 0.43);
      sound = lowNoise * 0.28 + Math.sin(time * Math.PI * 2 * 89) * 0.009;
      sound += Math.sin(joint * Math.PI * 2 * 230) * Math.exp(-joint * 23) * 0.032;
      side = otherNoise * 0.026;
    } else if (kind === 'flight') {
      sound = lowNoise * 0.37 + middleNoise * 0.035 + Math.sin(time * Math.PI * 2 * 78) * 0.025 + Math.sin(time * Math.PI * 2 * 117) * 0.012;
      side = otherNoise * 0.04;
    } else if (kind === 'quiet') {
      sound = lowNoise * 0.025;
      side = otherNoise * 0.006;
    } else if (kind === 'hum') {
      const tone = definition.id === 'elevator' ? 72 : definition.id === 'garage' ? 49 : 60;
      sound = lowNoise * 0.105 + Math.sin(time * Math.PI * 2 * tone) * 0.005;
      side = otherNoise * 0.013;
    } else {
      sound = middleNoise * 0.09 + lowNoise * 0.12;
      side = otherNoise * 0.035;
    }
    const fade = Math.min(1, time / 0.04, (seconds - time) / 0.08);
    left[i] = (sound + side) * fade;
    right[i] = (sound - side) * fade;
  }
  return buffer;
}

/** Speech-band RMS detector: at most 5 dB of ducking, 30 ms attack, 100 ms hold, 400 ms release. */
function resolveDucking(profile: DuckingProfile = {}): Required<DuckingProfile> {
  return {
    depthDb: clamp(profile.depthDb ?? 5, 0, 6),
    attackMs: clamp(profile.attackMs ?? 30, 15, 120),
    holdMs: clamp(profile.holdMs ?? 100, 40, 250),
    releaseMs: clamp(profile.releaseMs ?? 400, 200, 1_000),
  };
}

function sceneDucking(environment: EngineEnvironment, override?: DuckingProfile): Required<DuckingProfile> {
  const water = /shower|rain|river|beach/.test(environment.id) || /rain|waves|river/.test(String(environment.synth));
  if (water) return resolveDucking({ depthDb: 3, attackMs: 45, holdMs: 140, releaseMs: 650, ...override });
  const gentle = environment.category === 'transport' || /rain|wind|waves|river/.test(String(environment.synth));
  return resolveDucking({ depthDb: gentle ? 3.5 : 5, releaseMs: gentle ? 500 : 400, ...override });
}

export function buildDuckingEnvelope(channels: readonly Float32Array[], sampleRate: number, profile?: DuckingProfile): DuckingPoint[] {
  const dynamics = resolveDucking(profile);
  if (!channels.length || !channels[0].length || !Number.isFinite(sampleRate) || sampleRate <= 0) return [{ time: 0, gain: 1 }];
  const length = Math.min(...channels.map(channel => channel.length));
  const hop = Math.max(1, Math.round(sampleRate * 0.02));
  const count = Math.ceil(length / hop);
  const powers = new Float64Array(count);
  const highpassAlpha = Math.exp(-Math.PI * 2 * Math.min(80, sampleRate * 0.1) / sampleRate);
  const lowpassAlpha = 1 - Math.exp(-Math.PI * 2 * Math.min(5_000, sampleRate * 0.42) / sampleRate);
  // Accumulate small windows without allocating a second full-length PCM stem.
  for (const channel of channels) {
    let previous = 0;
    let highpassed = 0;
    let lowpassed = 0;
    for (let i = 0; i < length; i++) {
      const sample = finiteSample(channel[i]);
      highpassed = highpassAlpha * (highpassed + sample - previous);
      previous = sample;
      lowpassed += lowpassAlpha * (highpassed - lowpassed);
      powers[Math.floor(i / hop)] += lowpassed * lowpassed;
    }
  }
  const levels: { time: number; rms: number }[] = [];
  for (let window = 0; window < count; window++) {
    const start = window * hop;
    const end = Math.min(length, start + hop * 2);
    const power = powers[window] + (powers[window + 1] || 0);
    const rms = Math.sqrt(power / Math.max(1, (end - start) * channels.length));
    levels.push({ time: start / sampleRate, rms });
  }
  // A single click occupies at most two overlapping detector windows. A short
  // median removes it without allocating another full PCM stem. The percentile
  // reference also prevents a lone plosive from hiding quieter later phrases.
  const detected = levels.map((level, index) => {
    const neighbors = [-2, -1, 0, 1, 2].map(offset => levels[index + offset]?.rms || 0).sort((a, b) => a - b);
    return { time: level.time, rms: neighbors[2] };
  });
  // Reference the untrimmed detector windows: otherwise a removed impulse's
  // tiny filter decay could become the new "speech" reference all by itself.
  const activeLevels = levels.map(level => level.rms).filter(rms => rms > 0.00001).sort((a, b) => a - b);
  if (!activeLevels.length) return [{ time: 0, gain: 1 }, { time: length / sampleRate, gain: 1 }];
  const reference = activeLevels[Math.floor((activeLevels.length - 1) * 0.85)];
  const threshold = Math.max(0.00001, reference * 0.1);
  let gain = 1;
  let holdUntil = 0;
  let heldActivity = 0;
  const points: DuckingPoint[] = [{ time: 0, gain: 1 }];
  for (const level of detected) {
    let activity = clamp((level.rms - threshold) / (threshold * 4), 0, 1);
    if (activity > 0.15) { heldActivity = activity; holdUntil = level.time + dynamics.holdMs / 1000; }
    else if (level.time < holdUntil) activity = Math.max(activity, heldActivity);
    const target = dbGain(-dynamics.depthDb * activity);
    const coefficient = Math.exp(-(hop / sampleRate) / (target < gain ? dynamics.attackMs / 1000 : dynamics.releaseMs / 1000));
    gain = target + coefficient * (gain - target);
    points.push({ time: level.time + hop / sampleRate, gain });
  }
  const end = length / sampleRate;
  const recoveryEnd = end + dynamics.holdMs / 1000 + dynamics.releaseMs / 1000 * 4;
  for (let time = end + 0.02; time < recoveryEnd; time += 0.02) {
    if (time >= holdUntil) gain = 1 + Math.exp(-0.02 / (dynamics.releaseMs / 1000)) * (gain - 1);
    points.push({ time, gain });
  }
  points.push({ time: recoveryEnd, gain: 1 });
  return points;
}

function makeLoopBuffer(context: Pick<OfflineAudioContext, 'createBuffer'>, original: AudioBuffer, crossfadeSeconds = 0.8, stereoWidth = 0.65): AudioBuffer {
  const sourceLength = original.length;
  const overlap = Math.min(Math.floor(sourceLength / 4), Math.round(original.sampleRate * clamp(crossfadeSeconds, 0, 2)));
  const length = Math.max(1, sourceLength - overlap);
  const key = `${overlap}:${clamp(stereoWidth, 0, 1)}`;
  let versions = loopCache.get(original);
  const cached = versions?.get(key);
  if (cached) return cached;
  const channels = Math.min(2, original.numberOfChannels);
  const loop = context.createBuffer(channels, length, original.sampleRate);
  const analysis = cachedAnalysis(original);
  // Correlated beds need less crossfade compensation than unrelated noise.
  let dot = 0;
  let headPower = 0;
  let tailPower = 0;
  for (let channel = 0; channel < channels; channel++) {
    const source = original.getChannelData(channel);
    const dc = clamp(analysis.dcByChannel[channel], -4, 4);
    for (let i = 0; i < overlap; i++) {
      const head = clamp(finiteSample(source[i]), -4, 4) - dc;
      const tail = clamp(finiteSample(source[sourceLength - overlap + i]), -4, 4) - dc;
      dot += head * tail; headPower += head * head; tailPower += tail * tail;
    }
  }
  const correlation = clamp(dot / Math.sqrt(Math.max(1e-20, headPower * tailPower)), 0, 1);
  for (let channel = 0; channel < channels; channel++) {
    const source = original.getChannelData(channel);
    const target = loop.getChannelData(channel);
    const dc = clamp(analysis.dcByChannel[channel], -4, 4);
    target.set(source.subarray(overlap, overlap + length));
    for (let i = 0; i < length; i++) target[i] = clamp(finiteSample(target[i]), -4, 4) - dc;
    for (let index = 0; index < overlap; index++) {
      const blend = (1 - Math.cos(index / Math.max(1, overlap - 1) * Math.PI)) / 2;
      const a = 1 - blend;
      const normalization = Math.sqrt(a * a + blend * blend + 2 * correlation * a * blend);
      target[length - overlap + index] = ((clamp(finiteSample(source[sourceLength - overlap + index]), -4, 4) - dc) * a + (clamp(finiteSample(source[index]), -4, 4) - dc) * blend) / Math.max(0.7, normalization);
    }
  }
  if (channels === 2) {
    const left = loop.getChannelData(0);
    const right = loop.getChannelData(1);
    const width = clamp(stereoWidth, 0, 1);
    for (let i = 0; i < length; i++) {
      const mid = (left[i] + right[i]) * 0.5;
      const side = (left[i] - right[i]) * 0.5 * width;
      left[i] = mid + side; right[i] = mid - side;
    }
  }
  if (!versions) { versions = new Map(); loopCache.set(original, versions); }
  // Each immutable stem retains at most two processed loops.
  if (versions.size >= 2) versions.delete(versions.keys().next().value!);
  versions.set(key, loop);
  return loop;
}

function effectiveDistance(options: Pick<MixOptions, 'distance' | 'perspective'>): number {
  const distance = clamp(options.distance, 0, 100) / 100;
  return options.perspective === 'close' ? distance * 0.45 : options.perspective === 'distant' ? 0.25 + distance * 0.75 : distance;
}

function roomSettings(environment: EngineEnvironment, options: Pick<MixOptions, 'distance' | 'spatial' | 'perspective'>): RoomSettings {
  const acoustic = options.spatial ? environment.acoustic : (getEnvironment('studio') as EngineEnvironment).acoustic;
  const kind = acoustic.kind || (environment.category === 'nature' || environment.id === 'street' ? 'open' : 'furnished');
  const distance = effectiveDistance(options);
  const earlyReflections = (acoustic.earlyReflections || []).filter(reflection => Number.isFinite(reflection.delayMs) && Number.isFinite(reflection.gain));
  // Open air has no diffuse room tail. A future open profile may add sparse,
  // explicitly configured reflections, never a room tail driven by distance.
  const wet = !options.spatial || kind === 'dry' || (kind === 'open' && !earlyReflections.length) ? 0 : clamp(acoustic.reverb + distance * (acoustic.distanceWet || 0), 0, 0.65);
  const lastReflection = earlyReflections.reduce((maximum, reflection) => Math.max(maximum, clamp(reflection.delayMs, 0, 250) / 1000), 0);
  return {
    kind, wet, earlyReflections,
    decay: Math.max(clamp(acoustic.decay, 0.08, 4), lastReflection + 0.03),
    predelay: kind === 'dry' || kind === 'open' || kind === 'reflective-outdoor' ? 0 : clamp(acoustic.predelay, 0, 0.2) + distance * 0.008,
    lowpass: clamp(acoustic.lowpass * (1 - distance * 0.25), 4_500, 22_000),
    // These filters belong only to the room send, never to the direct voice.
    highpass: clamp(Math.max(acoustic.highpass, kind === 'small-hard' ? 110 : 70), 15, 350),
  };
}

function directVoiceSettings(options: Pick<MixOptions, 'distance' | 'perspective'>): { gain: number; highShelfDb: number } {
  const distance = effectiveDistance(options);
  return { gain: 1 - distance * 0.18, highShelfDb: options.perspective === 'distant' ? -1.25 * distance : 0 };
}

function makeImpulse(context: Pick<OfflineAudioContext, 'createBuffer'>, environment: EngineEnvironment, room: RoomSettings): AudioBuffer {
  const seconds = room.decay;
  const length = Math.ceil(seconds * SAMPLE_RATE);
  const key = JSON.stringify(['speech-room-v3', environment.id, environment.sound?.version || 1, room.kind, room.decay, room.earlyReflections]);
  const cached = impulseCache.get(key);
  if (cached) { impulseCache.delete(key); impulseCache.set(key, cached); return cached; }
  const impulse = context.createBuffer(2, length, SAMPLE_RATE);
  const lateEnergy = room.kind === 'small-hard' ? 0.028 : room.kind === 'large' ? 0.05 : room.kind === 'vehicle' ? 0.012 : room.kind === 'open' || room.kind === 'reflective-outdoor' || room.kind === 'dry' ? 0 : 0.018;
  const lateStart = Math.max(0.008, Math.min(0.04, room.earlyReflections.reduce((maximum, reflection) => Math.max(maximum, reflection.delayMs / 1000), 0) * 0.45));
  const sharedSeed = seedFromString(`${environment.id}:diffuse:v2`);
  for (let channel = 0; channel < 2; channel++) {
    const sharedRandom = randomGenerator(sharedSeed);
    const random = randomGenerator(sharedSeed + channel * 7043 + 1);
    const data = impulse.getChannelData(channel);
    const lowAlpha = 1 - Math.exp(-2 * Math.PI * 650 / SAMPLE_RATE);
    const middleAlpha = 1 - Math.exp(-2 * Math.PI * 4_000 / SAMPLE_RATE);
    const highDecay = room.kind === 'small-hard' ? 0.78 : room.kind === 'vehicle' ? 0.38 : 0.5;
    let low = 0;
    let middle = 0;
    let energy = 0;
    if (lateEnergy > 0) for (let i = 0; i < length; i++) {
      const time = i / SAMPLE_RATE;
      const white = (sharedRandom() * 2 - 1) * 0.6 + (random() * 2 - 1) * 0.4;
      low += lowAlpha * (white - low);
      middle += middleAlpha * (white - middle);
      if (time < lateStart) continue;
      const diffuseTime = time - lateStart;
      const density = 1 - Math.exp(-diffuseTime / 0.025);
      const tailFade = Math.min(1, (seconds - time) / 0.025);
      data[i] = density * tailFade * (low * 0.18 * Math.exp(-6.9 * diffuseTime / seconds) + (middle - low) * 0.57 * Math.exp(-6.9 * diffuseTime / (seconds * 0.9)) + (white - middle) * 0.25 * Math.exp(-6.9 * diffuseTime / (seconds * highDecay)));
      energy += data[i] * data[i];
    }
    // Only the diffuse component is energy-controlled. Configured reflection
    // gains retain their meaning instead of being normalized to one generic IR.
    const factor = energy > 0 ? Math.sqrt(lateEnergy / energy) : 1;
    for (let i = 0; i < length; i++) data[i] *= factor;
  }
  // The fallback is deliberately synthetic. Bound resonant frequency response
  // before adding the declared early taps, rather than changing their gains.
  if (lateEnergy > 0) {
    const response = analyzeImpulseResponse(impulse);
    const factor = Math.min(1, 1 / Math.max(1e-12, response.peakSpeechBandGain));
    if (factor < 1) for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < data.length; i++) data[i] *= factor;
    }
  }
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (const reflection of room.earlyReflections) {
      const position = Math.round(clamp(reflection.delayMs, 0, 250) / 1000 * SAMPLE_RATE);
      const pan = clamp(reflection.pan, -0.8, 0.8);
      const angle = (pan + 1) * Math.PI / 4;
      if (position < length) data[position] += clamp(reflection.gain, 0, 0.6) * (channel === 0 ? Math.cos(angle) : Math.sin(angle));
    }
  }
  // Bound retained PCM while allowing recently used rooms to reuse their IR.
  if (impulseCache.size >= 16) impulseCache.delete(impulseCache.keys().next().value!);
  impulseCache.set(key, impulse);
  return impulse;
}

function voiceCalibration(analysis: AudioAnalysis): number {
  return analysis.activeRms > 0.00001 ? clamp(VOICE_ACTIVE_RMS / analysis.activeRms, dbGain(-12), dbGain(12)) : 1;
}

function ambienceCalibration(voice: AudioAnalysis, ambience: AudioAnalysis, environment: EngineEnvironment, ambientVolume: number, source: 'scene' | 'custom' = 'scene'): number {
  if ((source !== 'custom' && (environment.sound?.mode === 'silent' || environment.id === 'studio')) || ambience.silent || ambientVolume <= 0) return 0;
  const reference = voice.activeRms > 0.00001 ? voice.activeRms * voiceCalibration(voice) : VOICE_ACTIVE_RMS;
  const backgroundDb = clamp(source === 'custom' ? -30 : environment.sound?.backgroundDb ?? -30, -60, -16);
  const defaultVolume = clamp(source === 'custom' ? 35 : environment.sound?.defaultVolume ?? 35, 1, 100);
  const desiredRms = reference * dbGain(backgroundDb) * clamp(ambientVolume, 0, 100) / defaultVolume;
  return clamp(desiredRms / Math.max(0.000001, ambience.activeRms || ambience.rms), 0, 16);
}

function mixTiming(voiceDuration: number, room: RoomSettings, voiceVolume: number): { duration: number; voiceStart: number; tail: number } {
  const tail = room.wet > 0.005 && voiceVolume > 0 ? room.decay + room.predelay : 0;
  const duration = LEAD_IN + voiceDuration + tail + END_GUARD;
  if (duration > MAX_RENDER_DURATION + 0.001) throw new Error('Este áudio e sua cauda acústica ultrapassam o limite de 305 segundos. Use uma fala um pouco menor.');
  return { duration, voiceStart: LEAD_IN, tail };
}

function voiceSeed(voice: AudioBuffer): number {
  let seed = seedCache.get(voice);
  if (seed === undefined) {
    seed = seedFromString(`${voice.length}:${voice.sampleRate}:${voice.numberOfChannels}`);
    for (let channel = 0; channel < voice.numberOfChannels; channel++) {
      const data = voice.getChannelData(channel);
      for (let i = 0; i < 48; i++) seed = Math.imul(seed ^ Math.round(finiteSample(data[Math.min(data.length - 1, Math.floor(i * data.length / 48))]) * 1_000_000), 16777619) >>> 0;
    }
    seedCache.set(voice, seed);
  }
  return seed;
}

function stableLoopOffset(voice: AudioBuffer, environment: string, loopDuration: number): number {
  const hash = (voiceSeed(voice) ^ seedFromString(environment)) >>> 0;
  return (hash / 4294967296) * Math.max(0, loopDuration - 1 / SAMPLE_RATE);
}

interface BackgroundPlan { loop: boolean; offset: number; stop: number }
function backgroundPlan(voice: AudioBuffer, ambience: AudioBuffer, environment: string, renderDuration: number): BackgroundPlan {
  // Reserve the longest supported acoustic tail, rather than the current wet
  // setting: changing a slider must not choose a different point in a recording.
  if (ambience.duration + 0.001 >= voice.duration) {
    const available = Math.max(0, ambience.duration - voice.duration - MAX_IR_DURATION - 0.3);
    const offset = available ? stableLoopOffset(voice, environment, available) : 0;
    return { loop: false, offset, stop: Math.min(renderDuration, ambience.duration - offset) };
  }
  return { loop: true, offset: 0, stop: renderDuration };
}

/** A zero-padded FFT of a short IR. This is a sampled linear frequency response,
 * not a true-peak meter or a physical measurement of the selected room. */
export function analyzeImpulseResponse(buffer: AudioBuffer): ImpulseResponseAnalysis {
  validateBuffer(buffer, MAX_IR_DURATION);
  if (buffer.numberOfChannels > 2) throw new Error('A resposta de sala deve ser mono ou estéreo.');
  const size = 2 ** Math.ceil(Math.log2(Math.max(16, buffer.length * 2)));
  if (size > 2 ** 21) throw new Error('A resposta de sala tem amostras demais. Exporte a IR em 48 kHz.');
  const lowerBin = Math.max(1, Math.ceil(80 / buffer.sampleRate * size));
  const upperBin = Math.min(size / 2 - 1, Math.floor(Math.min(9_000, buffer.sampleRate * 0.475) / buffer.sampleRate * size));
  let energy = 0;
  let bandPower = 0;
  let bandBins = 0;
  let peakSpeechBandGain = 0;
  let peakSpeechBandFrequency = 0;
  let dcGain = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const real = new Float64Array(size);
    const imaginary = new Float64Array(size);
    const input = buffer.getChannelData(channel);
    let dc = 0;
    for (let i = 0; i < input.length; i++) {
      const sample = clamp(finiteSample(input[i]), -4, 4);
      real[i] = sample; energy += sample * sample; dc += sample;
    }
    dcGain = Math.max(dcGain, Math.abs(dc));
    for (let i = 1, reversed = 0; i < size; i++) {
      let bit = size >> 1;
      for (; reversed & bit; bit >>= 1) reversed ^= bit;
      reversed ^= bit;
      if (i < reversed) { const temporary = real[i]; real[i] = real[reversed]; real[reversed] = temporary; }
    }
    for (let width = 2; width <= size; width *= 2) {
      const angle = -2 * Math.PI / width;
      const stepReal = Math.cos(angle);
      const stepImaginary = Math.sin(angle);
      for (let start = 0; start < size; start += width) {
        let twiddleReal = 1;
        let twiddleImaginary = 0;
        for (let offset = 0; offset < width / 2; offset++) {
          const left = start + offset;
          const right = left + width / 2;
          const transformedReal = real[right] * twiddleReal - imaginary[right] * twiddleImaginary;
          const transformedImaginary = real[right] * twiddleImaginary + imaginary[right] * twiddleReal;
          real[right] = real[left] - transformedReal; imaginary[right] = imaginary[left] - transformedImaginary;
          real[left] += transformedReal; imaginary[left] += transformedImaginary;
          const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
          twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
          twiddleReal = nextReal;
        }
      }
    }
    for (let bin = lowerBin; bin <= upperBin; bin++) {
      const power = real[bin] ** 2 + imaginary[bin] ** 2;
      bandPower += power; bandBins++;
      if (power > peakSpeechBandGain ** 2) {
        peakSpeechBandGain = Math.sqrt(power);
        peakSpeechBandFrequency = bin * buffer.sampleRate / size;
      }
    }
  }
  return { energyPerChannel: energy / buffer.numberOfChannels, speechBandRmsGain: Math.sqrt(bandPower / Math.max(1, bandBins)), peakSpeechBandGain, peakSpeechBandFrequency, dcGain };
}

function prepareImportedImpulse(context: Pick<OfflineAudioContext, 'createBuffer'>, resource: MixImpulseResponse): AudioBuffer {
  validateBuffer(resource.buffer, MAX_IR_DURATION);
  if (resource.buffer.numberOfChannels > 2) throw new Error('A resposta de sala deve ser mono ou estéreo.');
  const original = resource.buffer;
  const arrival = clamp(resource.directArrivalMs ?? 0, 0, Math.max(0, original.duration * 1000 - 1));
  const directWindow = clamp(resource.directWindowMs ?? 5, 0.25, 30);
  const anchor = resource.predelayMode === 'external' ? arrival / 1000 : 0;
  const length = Math.max(1, Math.ceil((original.duration - anchor) * SAMPLE_RATE));
  const key = JSON.stringify([arrival, directWindow, resource.directSound, resource.predelayMode, length]);
  let versions = importedImpulseCache.get(original);
  const cached = versions?.get(key);
  if (cached) return cached;
  const impulse = context.createBuffer(original.numberOfChannels, length, SAMPLE_RATE);
  const removeStart = Math.ceil(arrival / 1000 * original.sampleRate);
  const removeEnd = Math.ceil((arrival + directWindow) / 1000 * original.sampleRate);
  let energy = 0;
  for (let channel = 0; channel < original.numberOfChannels; channel++) {
    const input = original.getChannelData(channel);
    const output = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const time = i / SAMPLE_RATE + anchor;
      const position = Math.min(input.length - 1, time * original.sampleRate);
      const lower = Math.floor(position);
      const fraction = position - lower;
      // Small IRs may arrive at a different sample rate. Resample only this
      // bounded resource; preserve its relative timing and original envelope.
      const upper = Math.min(lower + 1, input.length - 1);
      const before = resource.directSound === 'included' && lower >= removeStart && lower < removeEnd ? 0 : clamp(finiteSample(input[lower]), -4, 4);
      const after = resource.directSound === 'included' && upper >= removeStart && upper < removeEnd ? 0 : clamp(finiteSample(input[upper]), -4, 4);
      let sample = before * (1 - fraction) + after * fraction;
      if (resource.directSound === 'included' && time >= arrival / 1000 && time < (arrival + directWindow) / 1000) sample = 0;
      // A short terminal fade avoids a hard boundary in imported truncated IRs.
      sample *= Math.min(1, Math.max(0, length - 1 - i) / (SAMPLE_RATE * 0.01));
      output[i] = sample;
      energy += sample * sample;
    }
  }
  const perChannelEnergy = energy / original.numberOfChannels;
  if (perChannelEnergy < 1e-12) throw new Error('A resposta de sala ficou sem reflexos audíveis. Confira a janela de som direto ou importe outra IR.');
  // Constant energy alone can amplify a ringing/tonal IR. Keep its declared
  // shape and timing, but limit broadband energy and speech-band response.
  // Leave a small margin for peaks between FFT bins. Never fill in a quiet tail.
  const response = analyzeImpulseResponse(impulse);
  const energyGain = Math.sqrt(0.16 / perChannelEnergy);
  const spectralGain = 1.5 / Math.max(1e-12, response.peakSpeechBandGain);
  const gain = clamp(Math.min(energyGain, spectralGain), 0.000001, 32);
  for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    const output = impulse.getChannelData(channel);
    for (let i = 0; i < output.length; i++) output[i] *= gain;
  }
  if (!versions) { versions = new Map(); importedImpulseCache.set(original, versions); }
  if (versions.size >= 2) versions.delete(versions.keys().next().value!);
  versions.set(key, impulse);
  return impulse;
}

function importedRoom(room: RoomSettings, resource: MixImpulseResponse, distance: number): RoomSettings {
  const anchor = resource.predelayMode === 'external' ? clamp(resource.directArrivalMs ?? 0, 0, Math.max(0, resource.buffer.duration * 1000 - 1)) / 1000 : 0;
  return {
    ...room,
    wet: clamp((resource.wet ?? 0.18) * (1 + distance * 0.2), 0, 0.65),
    decay: resource.buffer.duration - anchor,
    predelay: resource.predelayMode === 'external' ? clamp(resource.predelayMs ?? 0, 0, 250) / 1000 : 0,
    // The supplied IR already contains the space's spectral response.
    lowpass: 22_000 * (1 - distance * 0.12), highpass: 80,
  };
}

function validateEventResources(events: AmbientEvent[]): void {
  if (events.length > MAX_EVENTS) throw new Error(`Use no máximo ${MAX_EVENTS} eventos por áudio.`);
  let seconds = 0;
  const buffers = new Set<AudioBuffer>();
  for (const event of events) {
    validateBuffer(event.buffer, MAX_EVENT_DURATION);
    if (event.buffer.numberOfChannels > 2) throw new Error('Os eventos devem ser mono ou estéreo.');
    if (!Number.isFinite(event.at) || event.at < 0 || event.at > MAX_DURATION) throw new Error('A posição de um evento está fora do áudio.');
    if (!buffers.has(event.buffer)) { buffers.add(event.buffer); seconds += event.buffer.duration; }
  }
  if (seconds > MAX_EVENT_STEM_SECONDS + 0.001) throw new Error('Os arquivos distintos de eventos devem somar até 60 segundos. Use menos arquivos para reduzir o uso de memória.');
}

/** Schedule supplied clips; no audio is generated and sliders never change this
 * timeline. Preserve it with the project if clips or seed change later. */
export function createEventTimeline(voice: AudioBuffer, environment: string, clips: AmbientEventClip[], options: EventTimelineOptions = {}): AmbientEvent[] {
  validateBuffer(voice);
  if (!clips.length || voice.duration < 2) return [];
  validateEventResources(clips.map(clip => ({ ...clip, at: 0 })));
  const random = randomGenerator(voiceSeed(voice) ^ seedFromString(`${environment}:events:${options.seed ?? 'v1'}`));
  const definition = getEnvironment(environment);
  const baseMinimum = definition.category === 'transport' ? 14 : definition.category === 'city' ? 8 : 12;
  let previousClip = -1;
  let cursor = 1;
  const events: AmbientEvent[] = [];
  while (events.length < MAX_EVENTS) {
    const candidates = clips.map((clip, index) => ({ clip, index })).filter(({ clip }) => clip.buffer.duration <= voice.duration - 0.25);
    if (!candidates.length) break;
    let candidate = candidates[Math.floor(random() * candidates.length)];
    if (candidates.length > 1 && candidate.index === previousClip) candidate = candidates[(candidates.indexOf(candidate) + 1) % candidates.length];
    const { clip, index } = candidate;
    const minimum = clamp(options.minGapSeconds ?? clip.minGapSeconds ?? baseMinimum, 1, 90);
    const maximum = clamp(options.maxGapSeconds ?? clip.maxGapSeconds ?? minimum * 1.9, minimum, 120);
    const at = cursor + minimum + random() * (maximum - minimum);
    if (at + clip.buffer.duration > voice.duration - 0.1) break;
    events.push({ id: `${clip.id}:${events.length}`, buffer: clip.buffer, at, volume: clip.volume, relativeDb: clip.relativeDb, pan: clamp((clip.pan ?? 0) + (random() - 0.5) * 0.2, -0.7, 0.7) });
    cursor = at + clip.buffer.duration;
    previousClip = index;
  }
  return events;
}

function captureSettings(capture: MixOptions['capture']): { highpass: number; lowpass: number; presenceDb: number; width: number } {
  return capture === 'mobile' ? { highpass: 75, lowpass: 16_000, presenceDb: 0.8, width: 0.72 } : { highpass: 0, lowpass: 0, presenceDb: 0, width: 1 };
}

/** Mid/side width via a small node matrix, retaining the source PCM unchanged. */
function connectWidth(context: OfflineAudioContext, input: AudioNode, output: AudioNode, width: number): void {
  const amount = clamp(width, 0, 1);
  if (amount >= 0.999) { input.connect(output); return; }
  const stereo = context.createGain(); stereo.channelCount = 2; stereo.channelCountMode = 'explicit'; stereo.channelInterpretation = 'speakers';
  const split = context.createChannelSplitter(2);
  const merge = context.createChannelMerger(2);
  input.connect(stereo); stereo.connect(split);
  for (let from = 0; from < 2; from++) for (let to = 0; to < 2; to++) {
    const gain = context.createGain(); gain.gain.value = (1 + (from === to ? amount : -amount)) * 0.5;
    split.connect(gain, from); gain.connect(merge, 0, to);
  }
  merge.connect(output);
}

function cachedAnalysis(buffer: AudioBuffer): AudioAnalysis {
  return analysisCache.get(buffer) || analyzeAudio(buffer);
}

function sanitizedBuffer(context: Pick<OfflineAudioContext, 'createBuffer'>, buffer: AudioBuffer): AudioBuffer {
  const analysis = cachedAnalysis(buffer);
  if (!analysis.nonFiniteSamples && analysis.peak <= 4) return buffer;
  const safe = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    const target = safe.getChannelData(channel);
    for (let i = 0; i < source.length; i++) target[i] = clamp(finiteSample(source[i]), -4, 4);
  }
  return safe;
}

function voiceDucking(voice: AudioBuffer, environment: EngineEnvironment, profile?: DuckingProfile): DuckingPoint[] {
  const dynamics = sceneDucking(environment, profile);
  const key = JSON.stringify(dynamics);
  let versions = duckingCache.get(voice);
  const cached = versions?.get(key);
  if (cached) return cached;
  const points = buildDuckingEnvelope(Array.from({ length: voice.numberOfChannels }, (_, channel) => voice.getChannelData(channel)), voice.sampleRate, dynamics);
  if (!versions) { versions = new Map(); duckingCache.set(voice, versions); }
  if (versions.size >= 3) versions.delete(versions.keys().next().value!);
  versions.set(key, points);
  return points;
}

function scheduleDucking(gain: AudioParam, level: number, points: DuckingPoint[], start: number, end: number, voiceStart: number): void {
  let initial = 1;
  for (const point of points) {
    const time = point.time + voiceStart;
    if (time <= start) initial = point.gain;
    else break;
  }
  gain.setValueAtTime(level * initial, start);
  for (const point of points) {
    const time = point.time + voiceStart;
    if (time <= start) continue;
    if (time > end) break;
    gain.linearRampToValueAtTime(level * point.gain, time);
  }
}

function attenuateToHeadroom(buffer: AudioBuffer): void {
  const peak = measureAudio(buffer).peak;
  if (peak <= HEADROOM) return;
  const scale = (HEADROOM - 0.000001) / peak;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  }
}

/** All changes to mix parameters process these same local stems, without API calls. */
export async function renderMix(voice: AudioBuffer, ambience: AudioBuffer | null, options: MixOptions, resources: MixResources = {}): Promise<AudioBuffer> {
  validateBuffer(voice);
  if (ambience) validateBuffer(ambience);
  if (!globalThis.OfflineAudioContext) throw new Error('Este navegador não oferece renderização local de áudio. Use uma versão atualizada.');
  const environment = getEnvironment(options.environment) as EngineEnvironment;
  const impulseResource = resources.impulseResponse ?? options.impulseResponse;
  const events = resources.events ?? options.events ?? [];
  const ambientSourceKind = resources.ambienceSource ?? options.ambienceSource ?? 'scene';
  validateEventResources(events);
  if (impulseResource) {
    validateBuffer(impulseResource.buffer, MAX_IR_DURATION);
    if (impulseResource.buffer.numberOfChannels > 2) throw new Error('A resposta de sala deve ser mono ou estéreo.');
  }
  let room = roomSettings(environment, options);
  const voiceAnalysis = cachedAnalysis(voice);
  const distance = effectiveDistance(options);
  if (impulseResource && options.spatial) room = importedRoom(room, impulseResource, distance);
  const voiceVolume = clamp(options.voiceVolume, 0, 100) / 100;
  const timing = mixTiming(voice.duration, room, voiceVolume);
  const eventsEnd = events.reduce((end, event) => Math.max(end, timing.voiceStart + event.at + event.buffer.duration + END_GUARD), 0);
  const duration = Math.max(timing.duration, eventsEnd);
  if (duration > MAX_RENDER_DURATION + 0.001) throw new Error('Um evento termina além do limite de 305 segundos. Antecipe esse evento ou use um arquivo menor.');
  const context = new OfflineAudioContext(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);

  const sum = context.createGain();
  // No master AGC/makeup gain: preserve speech dynamics and the volume sliders.
  // A final sample-peak attenuation protects headroom without pumping the bed.
  const output = context.createGain();
  const fadeIn = LEAD_IN * 0.75;
  const fadeOut = Math.min(0.04, END_GUARD);
  output.gain.setValueAtTime(0, 0);
  output.gain.linearRampToValueAtTime(1, fadeIn);
  output.gain.setValueAtTime(1, Math.max(fadeIn, duration - fadeOut));
  output.gain.linearRampToValueAtTime(0, duration);
  const capture = captureSettings(options.capture);
  if (capture.highpass) {
    const captureHighpass = context.createBiquadFilter(); captureHighpass.type = 'highpass'; captureHighpass.frequency.value = capture.highpass; captureHighpass.Q.value = 0.5;
    const capturePresence = context.createBiquadFilter(); capturePresence.type = 'peaking'; capturePresence.frequency.value = 2_300; capturePresence.Q.value = 0.65; capturePresence.gain.value = capture.presenceDb;
    const captureLowpass = context.createBiquadFilter(); captureLowpass.type = 'lowpass'; captureLowpass.frequency.value = capture.lowpass; captureLowpass.Q.value = 0.5;
    sum.connect(captureHighpass); captureHighpass.connect(capturePresence); capturePresence.connect(captureLowpass);
    connectWidth(context, captureLowpass, output, capture.width);
  } else sum.connect(output);
  output.connect(context.destination);

  const voiceSource = context.createBufferSource();
  voiceSource.buffer = sanitizedBuffer(context, voice);
  const voiceGain = context.createGain();
  const direct = directVoiceSettings(options);
  voiceGain.gain.value = voiceCalibration(voiceAnalysis) * voiceVolume * direct.gain;
  voiceSource.connect(voiceGain);
  // Parallel room send: reflections must not turn down or filter direct speech.
  // Close/natural retain the spectrum. Explicit distant adds a restrained shelf,
  // independently of the room preset and any imported impulse response.
  if (direct.highShelfDb) {
    const shelf = context.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 3_000; shelf.gain.value = direct.highShelfDb;
    voiceGain.connect(shelf); shelf.connect(sum);
  } else voiceGain.connect(sum);
  if (room.wet > 0.005) {
    const highpass = context.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = room.highpass; highpass.Q.value = Math.SQRT1_2;
    const lowpass = context.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = room.lowpass; lowpass.Q.value = Math.SQRT1_2;
    const delay = context.createDelay(0.5); delay.delayTime.value = room.predelay;
    const convolver = context.createConvolver(); convolver.normalize = false;
    convolver.buffer = impulseResource ? prepareImportedImpulse(context, impulseResource) : makeImpulse(context, environment, room);
    const wet = context.createGain(); wet.gain.value = Math.sin(room.wet * Math.PI / 2);
    voiceGain.connect(highpass); highpass.connect(lowpass); lowpass.connect(delay); delay.connect(convolver); convolver.connect(wet); wet.connect(sum);
  }
  voiceSource.start(timing.voiceStart);

  const duckingPoints = options.ducking && voiceVolume > 0 ? voiceDucking(voice, environment, options.duckingProfile) : [];
  const backgroundLevel = ambience ? ambienceCalibration(voiceAnalysis, cachedAnalysis(ambience), environment, options.ambientVolume, ambientSourceKind) : 0;
  if (ambience && backgroundLevel > 0) {
    const plan = backgroundPlan(voice, ambience, environment.id, duration);
    const ambientSource = context.createBufferSource();
    const width = ambientSourceKind === 'custom' ? 0.65 : environment.sound?.stereoWidth ?? 0.65;
    ambientSource.buffer = plan.loop ? makeLoopBuffer(context, ambience, environment.sound?.crossfadeSeconds ?? 0.8, width) : sanitizedBuffer(context, ambience);
    ambientSource.loop = plan.loop;
    const ambientFilter = context.createBiquadFilter(); ambientFilter.type = 'highpass'; ambientFilter.frequency.value = 28; ambientFilter.Q.value = Math.SQRT1_2;
    const ambientGain = context.createGain();
    ambientGain.gain.setValueAtTime(backgroundLevel, 0);
    if (duckingPoints.length) scheduleDucking(ambientGain.gain, backgroundLevel, duckingPoints, 0, duration, timing.voiceStart);
    const ambientFade = context.createGain();
    const bedFade = /shower|rain|river|beach/.test(environment.id) ? 0.16 : 0.08;
    ambientFade.gain.setValueAtTime(0, 0); ambientFade.gain.linearRampToValueAtTime(1, Math.min(bedFade, plan.stop / 3));
    ambientFade.gain.setValueAtTime(1, Math.max(plan.stop / 3, plan.stop - bedFade)); ambientFade.gain.linearRampToValueAtTime(0, plan.stop);
    ambientSource.connect(ambientFilter);
    if (plan.loop) ambientFilter.connect(ambientGain); else connectWidth(context, ambientFilter, ambientGain, width);
    ambientGain.connect(ambientFade); ambientFade.connect(sum);
    ambientSource.start(0, plan.loop ? stableLoopOffset(voice, environment.id, ambientSource.buffer.duration) : plan.offset); ambientSource.stop(plan.stop);
  }

  const eventReference = voiceAnalysis.activeRms > 0.00001 ? voiceAnalysis.activeRms * voiceCalibration(voiceAnalysis) : VOICE_ACTIVE_RMS;
  const eventDefaultVolume = environment.sound?.defaultVolume || 35;
  for (const event of events) {
    const analysis = cachedAnalysis(event.buffer);
    if (analysis.silent || options.ambientVolume <= 0 || (event.volume ?? 100) <= 0) continue;
    const start = timing.voiceStart + event.at;
    const end = start + event.buffer.duration;
    const referenceLevel = eventReference * dbGain(clamp(event.relativeDb ?? -22, -48, -12)) * clamp(event.volume ?? 100, 0, 100) / 100 * clamp(options.ambientVolume, 0, 100) / eventDefaultVolume;
    const gain = clamp(referenceLevel / Math.max(0.000001, analysis.activeRms || analysis.rms), 0, 16);
    const source = context.createBufferSource(); source.buffer = sanitizedBuffer(context, event.buffer);
    const highpass = context.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 28; highpass.Q.value = Math.SQRT1_2;
    const panner = context.createStereoPanner(); panner.pan.value = clamp(event.pan ?? 0, -0.8, 0.8);
    const level = context.createGain(); level.gain.setValueAtTime(gain, start);
    if (duckingPoints.length) scheduleDucking(level.gain, gain, duckingPoints, start, end, timing.voiceStart);
    const fade = context.createGain();
    fade.gain.setValueAtTime(0, start); fade.gain.linearRampToValueAtTime(1, start + Math.min(0.012, event.buffer.duration / 4));
    fade.gain.setValueAtTime(1, end - Math.min(0.06, event.buffer.duration / 4)); fade.gain.linearRampToValueAtTime(0, end);
    source.connect(highpass); highpass.connect(panner); panner.connect(level); level.connect(fade); fade.connect(sum);
    source.start(start); source.stop(end);
  }

  let rendered: AudioBuffer;
  try { rendered = await context.startRendering(); }
  catch { throw new Error('O navegador ficou sem recursos para processar este áudio. Tente um trecho menor e feche outras abas.'); }
  // Attenuate only: peak ceiling at -1 dBFS, preserving the meaning of the sliders.
  attenuateToHeadroom(rendered);
  return rendered;
}

/** Fresh technical diagnostics; no promise about location, speech identity or realism. */
export function analyzeAudio(buffer: AudioBuffer): AudioAnalysis {
  const total = Math.max(1, buffer.length * buffer.numberOfChannels);
  const windowSize = Math.max(1, Math.round(buffer.sampleRate * 0.04));
  const windowCount = Math.ceil(buffer.length / windowSize);
  const windowPower = new Float64Array(windowCount);
  const dcByChannel: number[] = [];
  let peak = 0;
  let power = 0;
  let nonFiniteSamples = 0;
  let clippedSamples = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const raw = data[i];
      if (!Number.isFinite(raw)) nonFiniteSamples++;
      const sample = finiteSample(raw);
      peak = Math.max(peak, Math.abs(sample));
      if (Math.abs(sample) >= 0.999) clippedSamples++;
      sum += sample;
      const squared = sample * sample;
      power += squared;
      windowPower[Math.floor(i / windowSize)] += squared;
    }
    dcByChannel.push(sum / Math.max(1, data.length));
  }
  const meanDcPower = dcByChannel.reduce((sum, dc) => sum + dc * dc, 0) / Math.max(1, buffer.numberOfChannels);
  const levels = Array.from(windowPower, (value, index) => Math.sqrt(Math.max(0, value / Math.max(1, Math.min(windowSize, buffer.length - index * windowSize) * buffer.numberOfChannels) - meanDcPower)));
  const ordered = [...levels].sort((a, b) => a - b);
  const reference = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.9))] || 0;
  const activityThreshold = Math.max(0.00001, reference * 0.12);
  let activePower = 0;
  let activeFrames = 0;
  let silentFrames = 0;
  levels.forEach((level, index) => {
    const frames = Math.min(windowSize, buffer.length - index * windowSize);
    if (level < 0.00001) silentFrames += frames;
    if (level >= activityThreshold) { activePower += level * level * frames; activeFrames += frames; }
  });
  const analysis: AudioAnalysis = {
    peak, rms: Math.sqrt(power / total), duration: buffer.duration,
    samplePeakDbFS: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    activeRms: activeFrames ? Math.sqrt(activePower / activeFrames) : 0,
    dcOffset: Math.max(0, ...dcByChannel.map(Math.abs)), dcByChannel,
    nonFiniteSamples, clippedSamples, clippingRatio: clippedSamples / total,
    silenceRatio: silentFrames / Math.max(1, buffer.length),
    silent: !activeFrames || peak < 0.00001,
  };
  analysisCache.set(buffer, analysis);
  return analysis;
}

export function measureAudio(buffer: AudioBuffer): AudioMeasurement {
  let peak = 0;
  let power = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      const sample = Number.isFinite(data[i]) ? data[i] : 0;
      peak = Math.max(peak, Math.abs(sample)); power += sample * sample;
    }
  }
  return { peak, rms: Math.sqrt(power / Math.max(1, buffer.length * buffer.numberOfChannels)), duration: buffer.duration };
}

/** Valid RIFF/WAVE PCM16, stereo, with the buffer's actual sample rate. */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  validateBuffer(buffer, MAX_RENDER_DURATION);
  const channels = 2;
  const blockAlign = channels * 2;
  const dataSize = buffer.length * blockAlign;
  const raw = new ArrayBuffer(44 + dataSize);
  const view = new DataView(raw);
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, dataSize, true);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0);
  for (let i = 0; i < buffer.length; i++) {
    const l = Number.isFinite(left[i]) ? clamp(left[i], -1, 1) : 0;
    const r = Number.isFinite(right[i]) ? clamp(right[i], -1, 1) : 0;
    view.setInt16(44 + i * blockAlign, l < 0 ? Math.round(l * 32768) : Math.round(l * 32767), true);
    view.setInt16(46 + i * blockAlign, r < 0 ? Math.round(r * 32768) : Math.round(r * 32767), true);
  }
  return new Blob([raw], { type: 'audio/wav' });
}

export async function createAudioPlayer(buffer: AudioBuffer, onTime?: (time: number) => void, onEnded?: () => void): Promise<AudioPlayer> {
  validateBuffer(buffer, MAX_RENDER_DURATION);
  const AudioContextType = contextConstructor();
  const context = new AudioContextType({ sampleRate: SAMPLE_RATE });
  try { await context.resume(); }
  catch { await context.close().catch(() => undefined); throw new Error('Não foi possível iniciar a reprodução. Clique em ouvir novamente.'); }
  const source = context.createBufferSource(); source.buffer = buffer;
  const gain = context.createGain();
  const start = context.currentTime;
  const fadeIn = Math.min(0.005, buffer.duration / 4);
  const fadeOut = Math.min(0.015, buffer.duration / 4);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(1, start + fadeIn);
  gain.gain.setValueAtTime(1, start + Math.max(fadeIn, buffer.duration - fadeOut));
  gain.gain.linearRampToValueAtTime(0, start + buffer.duration);
  source.connect(gain); gain.connect(context.destination);
  let animation = 0;
  let lastProgress = -1;
  let stopped = false;
  let finished = false;
  const close = () => {
    if (finished) return;
    finished = true; cancelAnimationFrame(animation); source.onended = null;
    source.disconnect(); gain.disconnect();
    void context.close().catch(() => undefined);
  };
  source.onended = () => {
    if (finished) return;
    const natural = !stopped;
    close();
    if (natural) { onTime?.(buffer.duration); onEnded?.(); }
  };
  const frame = () => {
    if (stopped || finished) return;
    const elapsed = Math.min(buffer.duration, Math.max(0, context.currentTime - start));
    if (elapsed - lastProgress >= 0.05) { onTime?.(elapsed); lastProgress = elapsed; }
    animation = requestAnimationFrame(frame);
  };
  try { source.start(start); animation = requestAnimationFrame(frame); }
  catch { close(); throw new Error('Não foi possível reproduzir este áudio.'); }
  return { stop: () => {
    if (finished || stopped) return;
    stopped = true; cancelAnimationFrame(animation);
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now); gain.gain.linearRampToValueAtTime(0, now + 0.018);
    try { source.stop(now + 0.02); } catch { close(); }
  } };
}
