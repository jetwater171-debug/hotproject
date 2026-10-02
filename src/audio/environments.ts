import environmentData from '../../shared/environments.json';

export type EnvironmentId = string;
export type EnvironmentCategory = 'indoor' | 'nature' | 'city' | 'transport';
export type EnvironmentSynth = 'quiet' | 'hum' | 'rain' | 'storm' | 'forest' | 'waves' | 'river' | 'fire' | 'night' | 'wind' | 'traffic' | 'cafe' | 'party' | 'engine' | 'rail' | 'flight';
export type EnvironmentSoundMode = 'silent' | 'bed';
export type EnvironmentAcousticKind = 'dry' | 'small-hard' | 'furnished' | 'large' | 'open' | 'reflective-outdoor' | 'vehicle';

export interface ReflectionType {
  /** Delay from the beginning of the impulse response; predelay is applied separately. */
  delayMs: number;
  gain: number;
  pan: number;
}

export type EnvironmentReflection = ReflectionType;

export interface EnvironmentSound {
  version: 2;
  mode: EnvironmentSoundMode;
  durationSeconds: number;
  promptInfluence: number;
  signature: string[];
  /** Bed level relative to the voice; silent environments do not create a bed. */
  backgroundDb: number;
  crossfadeSeconds: number;
  stereoWidth: number;
  defaultVolume: number;
}

export interface EnvironmentAcoustic {
  reverb: number;
  decay: number;
  predelay: number;
  lowpass: number;
  highpass: number;
  kind: EnvironmentAcousticKind;
  distanceWet: number;
  earlyReflections: ReflectionType[];
}

export interface Environment {
  id: EnvironmentId;
  name: string;
  category: EnvironmentCategory;
  popular: boolean;
  prompt: string;
  acoustic: EnvironmentAcoustic;
  synth: EnvironmentSynth;
  sound: EnvironmentSound;
  variantOf?: string;
  icon?: string;
  description?: string;
}

export const environments = environmentData as Environment[];
const studioEnvironment = environments.find(environment => environment.id === 'studio') || environments[0];

export function getEnvironment(id: string): Environment {
  return environments.find(environment => environment.id === id) || studioEnvironment;
}

export const environmentCategories: { id: EnvironmentCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'indoor', label: 'Interiores' },
  { id: 'nature', label: 'Natureza' },
  { id: 'city', label: 'Cidade' },
  { id: 'transport', label: 'Transporte' },
];
