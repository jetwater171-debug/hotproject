/** Bounded callers use this parser to validate the actual WAV format and duration. */
export function inspectWav(bytes, { pcm16Only = false, maxDurationSeconds = Infinity, maxChannels = 2 } = {}) {
  const fail = () => { throw new Error('invalid_wav'); };
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') fail();
  const end = bytes.readUInt32LE(4) + 8;
  if (end !== bytes.length) fail();
  let format, data, cursor = 12;
  while (cursor + 8 <= end) {
    const id = bytes.toString('ascii', cursor, cursor + 4), size = bytes.readUInt32LE(cursor + 4), start = cursor + 8;
    if (start + size > end) fail();
    if (id === 'fmt ') {
      if (format || size < 16) fail();
      const encoding = bytes.readUInt16LE(start), channels = bytes.readUInt16LE(start + 2), sampleRate = bytes.readUInt32LE(start + 4), byteRate = bytes.readUInt32LE(start + 8), blockAlign = bytes.readUInt16LE(start + 12), bits = bytes.readUInt16LE(start + 14);
      if (channels < 1 || channels > maxChannels || sampleRate < 8000 || sampleRate > 192000 || ![1, 3].includes(encoding) || encoding === 1 && ![16, 24, 32].includes(bits) || encoding === 3 && bits !== 32 || pcm16Only && (encoding !== 1 || bits !== 16)) fail();
      if (blockAlign !== channels * bits / 8 || byteRate !== sampleRate * blockAlign) fail();
      format = { encoding, channels, sampleRate, byteRate, blockAlign, bits };
    } else if (id === 'data') {
      if (data || size === 0) fail();
      data = { offset: start, length: size };
    }
    cursor = start + size + (size % 2);
  }
  if (cursor !== end || !format || !data || data.length % format.blockAlign) fail();
  const durationSeconds = data.length / format.byteRate;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > maxDurationSeconds) fail();
  if (format.encoding === 3) {
    for (let offset = data.offset; offset < data.offset + data.length; offset += 4) if (!Number.isFinite(bytes.readFloatLE(offset))) fail();
  }
  return { ...format, durationSeconds, dataOffset: data.offset, dataLength: data.length };
}
