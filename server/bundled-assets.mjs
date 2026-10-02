import { lstat, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedFile, digest, detectAudioType, MAX_LIBRARY_BYTES, validIrMetadata } from './ambience-library.mjs';
import { inspectWav } from './wav-audio.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_BUNDLE_MANIFEST = resolve(ROOT, 'shared/bundled-assets.json');
export const DEFAULT_PUBLIC_DIR = resolve(ROOT, 'public');
const publicUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 1000 ? url.href : null; } catch { return null; } };

/** Recordings are usable candidates; a source or license does not imply auditory approval. */
export function createBundledAssets({ manifestPath = DEFAULT_BUNDLE_MANIFEST, publicDir = DEFAULT_PUBLIC_DIR } = {}) {
  const read = async (environment, kind) => {
    if (!manifestPath || !publicDir) return null;
    try {
      const manifest = JSON.parse((await boundedFile(manifestPath, 512 * 1024)).toString('utf8'));
      if (manifest?.version !== 1 || !Array.isArray(manifest.beds)) return null;
      const entries = kind === 'ir' ? manifest.irs : manifest.beds;
      if (!Array.isArray(entries)) return null;
      for (const entry of entries.filter(item => item?.environment === environment)) {
        try {
          if (!(kind === 'ir' ? ['mit', 'cc0'].includes(entry.license) : entry.license === 'cc0') || entry.reviewed !== false || !/^[a-z0-9_-]{1,80}$/.test(entry.id) || !/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 200 || !publicUrl(entry.source) || entry.licenseUrl && !publicUrl(entry.licenseUrl) || entry.license === 'mit' && !publicUrl(entry.licenseUrl)) continue;
          if (typeof entry.file !== 'string' || entry.file.length > 300 || !/^audio\/[a-zA-Z0-9_./-]+$/.test(entry.file) || entry.file.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) continue;
          const base = resolve(publicDir), rootInfo = await lstat(base);
          if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) continue;
          const actualBase = await realpath(base), target = resolve(base, entry.file);
          if (!target.startsWith(base + sep)) continue;
          let current = base, valid = true;
          for (const part of entry.file.split('/')) {
            current = resolve(current, part); const info = await lstat(current);
            if (info.isSymbolicLink()) { valid = false; break; }
          }
          if (!valid || !(await realpath(target)).startsWith(actualBase + sep)) continue;
          const bytes = await boundedFile(target, MAX_LIBRARY_BYTES);
          if (digest(bytes) !== entry.sha256) continue;
          const type = detectAudioType(bytes, entry.file);
          const provenance = { id: entry.id, label: entry.label.trim(), source: publicUrl(entry.source), license: entry.license, ...(entry.licenseUrl ? { licenseUrl: publicUrl(entry.licenseUrl) } : {}) };
          let metadata;
          if (kind === 'ir') {
            if (type !== 'audio/wav') continue;
            const wav = inspectWav(bytes, { maxDurationSeconds: 4 });
            if (!validIrMetadata(entry.acoustic, wav.durationSeconds)) continue;
            metadata = { id: entry.id, environment, kind: 'ir', reviewed: false, source: 'recording', revision: entry.sha256, mimeType: type, durationSeconds: wav.durationSeconds, license: entry.license, acoustic: entry.acoustic, provenance };
          }
          return { bytes, type, source: 'recording', reviewed: false, revision: entry.sha256, provenance, ...(metadata ? { metadata } : {}) };
        } catch { /* Another intact candidate can replace a missing or invalid file. */ }
      }
    } catch { /* Missing manifests are unavailable, never generated automatically. */ }
    return null;
  };
  return { readBed: environment => read(environment, 'bed'), readIr: environment => read(environment, 'ir') };
}
