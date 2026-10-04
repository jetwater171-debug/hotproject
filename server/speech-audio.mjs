// ElevenLabs pcm_24000 is raw signed 16-bit little-endian mono PCM.
// A RIFF header makes those exact samples decodable by browsers; no resampling,
// gain, denoising or lossy re-encoding is applied here.
export const LOSSLESS_MAX_CHARS = 1200;
export const LOSSLESS_MAX_BYTES = 4 * 1024 * 1024;
export const LOSSLESS_GUIDE_MAX_SECONDS = 80;

export function pcm24ToWav(pcm) {
  if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % 2 || pcm.length > 64 * 1024 * 1024) throw new Error('invalid_pcm');
  const signature = pcm.toString('ascii', 0, Math.min(4, pcm.length));
  if (['RIFF', 'OggS', 'fLaC'].includes(signature) || signature.startsWith('ID3')) throw new Error('invalid_pcm');
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  return wav;
}

export class AudioResponseLimitError extends Error {
  constructor() { super('audio_response_too_large'); this.name = 'AudioResponseLimitError'; }
}

/** Bounds the actual decoded HTTP body, including chunked responses without length. */
export async function readBoundedAudioResponse(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new AudioResponseLimitError();
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new AudioResponseLimitError();
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, length);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export const speechFormats = Object.freeze({
  lossless: Object.freeze({ format: 'pcm_24000', type: 'audio/wav', container: 'wav', sampleRate: 24000, bitDepth: 16 }),
  standard: Object.freeze({ format: 'mp3_44100_128', type: 'audio/mpeg', container: 'mp3', sampleRate: 44100 }),
  high: Object.freeze({ format: 'mp3_44100_192', type: 'audio/mpeg', container: 'mp3', sampleRate: 44100 }),
});
