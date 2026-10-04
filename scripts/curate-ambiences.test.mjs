import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { BED_SOURCES, IR_SOURCES, parseSourcePage, auditBundle, pruneSuperseded } from './curate-ambiences.mjs';
import { createBundledAssets } from '../server/bundled-assets.mjs';
import { inspectWav } from '../server/wav-audio.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const page = (license, extra = '') => `<title>Recording by person</title><a title="Go to the full license text" href="${license}">license</a>${extra}<div data-static-file-url="https://cdn.freesound.org/previews/100/100000_1-hq.mp3"></div>`;
test('Freesound license comes from the actual file license, not a CC0 mention in its description', () => {
  const cc0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
  assert.equal(parseSourcePage(page(cc0), 'https://freesound.org/people/person/sounds/100000/').sourceFormat, 'public-hq-preview');
  assert.throws(() => parseSourcePage(page('https://creativecommons.org/licenses/by-nc/4.0/', `<a href="${cc0}">a source asset</a>`), 'https://freesound.org/people/person/sounds/100000/'), /próprio arquivo/);
  assert.throws(() => parseSourcePage(page('https://creativecommons.org/licenses/by/4.0/'), 'https://freesound.org/people/person/sounds/100000/'), /próprio arquivo/);
});
test('published lossless URLs require CC0 on the primary publisher page', () => {
  const metadata = '"encodingFormat":"audio/flac","contentUrl":"https://bigsoundbank.com/UPLOAD/flac/3042.flac"';
  assert.equal(parseSourcePage(`CC0 (public domain): Free and royalty-free ${metadata}`, 'https://bigsoundbank.com/recent-metro-interior-s3042.html').sourceFormat, 'published-lossless');
  assert.throws(() => parseSourcePage(metadata, 'https://bigsoundbank.com/recent-metro-interior-s3042.html'), /não confirma/);
  assert.throws(() => parseSourcePage(`CC0 (public domain): Free and royalty-free ${metadata.replace('bigsoundbank.com/UPLOAD', 'other.test/UPLOAD')}`, 'https://bigsoundbank.com/recent-metro-interior-s3042.html'), /não encontrado/);
});
test('missing-scene plan uses twenty distinct sources and never puts water in quiet bathroom', () => {
  assert.equal(BED_SOURCES.length, 20);
  assert.equal(new Set(BED_SOURCES.map(item => item.environment)).size, 20);
  assert.equal(new Set(BED_SOURCES.map(item => item.source)).size, 20);
  assert.ok(BED_SOURCES.every(item => !['studio', 'bathroom', 'bedroom', 'livingroom', 'library', 'shower'].includes(item.environment)));
  assert.ok(IR_SOURCES.every(item => item.path.startsWith('Rooms/') && !item.path.includes('Synthesized')));
});
test('audit detects modified bytes and pruning removes only superseded intact-scene MP3s', async () => {
  const root = await mkdtemp(join(tmpdir(), 'velora-asset-audit-'));
  const publicDir = join(root, 'public'), manifestPath = join(root, 'manifest.json');
  const dir = join(publicDir, 'audio/ambiences'); await mkdir(dir, { recursive: true });
  const bytes = Buffer.from('fLaC-test-fixture');
  await writeFile(join(dir, 'rain.flac'), bytes); await writeFile(join(dir, 'rain.mp3'), 'old'); await writeFile(join(dir, 'custom.mp3'), 'keep');
  await writeFile(manifestPath, JSON.stringify({ version: 1, beds: [{ environment: 'rain', file: 'audio/ambiences/rain.flac', sha256: digest(bytes), durationSeconds: 45 }], irs: [] }));
  try {
    assert.equal((await auditBundle({ publicDir, manifestPath })).rows.length, 1);
    assert.deepEqual(await pruneSuperseded({ publicDir, manifestPath }), ['audio/ambiences/rain.mp3']);
    assert.equal(await readFile(join(dir, 'custom.mp3'), 'utf8'), 'keep');
    await writeFile(join(dir, 'rain.flac'), 'modified');
    await assert.rejects(auditBundle({ publicDir, manifestPath }), /Hash inválido/);
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('velora-asset-audit-'));
    await rm(root, { recursive: true, force: true });
  }
});

test('all 37 scenarios have a distinct recorded bed or intentional silence, with bounded real assets', async () => {
  const catalog = JSON.parse(await readFile(new URL('../shared/environments.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('../shared/bundled-assets.json', import.meta.url), 'utf8'));
  assert.equal(catalog.length, 37);
  const quiet = catalog.filter(item => item.sound.mode === 'silent');
  assert.deepEqual(quiet.map(item => item.id).sort(), ['bathroom', 'bedroom', 'library', 'livingroom', 'studio']);
  const beds = catalog.filter(item => item.sound.mode === 'bed');
  assert.equal(manifest.beds.length, 32);
  assert.deepEqual(manifest.beds.map(item => item.environment).sort(), beds.map(item => item.id).sort());
  for (const field of ['environment', 'file', 'source', 'sha256']) assert.equal(new Set(manifest.beds.map(item => item[field])).size, 32, `Bed ${field} must be unique`);
  assert.equal(new Set(manifest.beds.map(item => item.original.sha256)).size, 32, 'Original recording inputs must be distinct');
  const loader = createBundledAssets();
  for (const entry of manifest.beds) {
    assert.equal(entry.license, 'cc0');
    assert.equal(entry.reviewed, false);
    assert.ok(entry.author?.trim());
    assert.ok(entry.original?.url && entry.original.sha256);
    assert.equal(typeof entry.technical.sourceCompressed, 'boolean');
    const asset = await loader.readBed(entry.environment);
    assert.ok(asset, `Loader should serve ${entry.environment}`);
    assert.equal(asset.type, 'audio/flac');
    assert.equal(asset.source, 'recording');
    assert.equal(asset.reviewed, false);
    const stream = asset.bytes.readBigUInt64BE(18);
    const sampleRate = Number(stream >> 44n), channels = Number((stream >> 41n) & 7n) + 1, bitDepth = Number((stream >> 36n) & 31n) + 1;
    const duration = Number(stream & 0xfffffffffn) / sampleRate;
    assert.equal(sampleRate, 48000);
    assert.equal(bitDepth, 16);
    assert.ok(channels === 1 || channels === 2);
    assert.equal(duration, 45);
    assert.ok(Math.abs(entry.durationSeconds - duration) < 1 / sampleRate);
    assert.ok(Number.isFinite(entry.technical.peakDb) && entry.technical.peakDb <= -2.97, `${entry.environment}: peak headroom`);
    assert.ok(Number.isFinite(entry.technical.rmsDb));
  }
  assert.equal(await loader.readBed('bathroom'), null);
  assert.ok(await loader.readBed('shower'));
  const audit = await auditBundle();
  assert.ok(audit.totalBytes < 220 * 1024 * 1024, 'Audio should leave Vercel function bundle headroom');
});

test('physical room candidates are readable, with an explicit shower acoustic alias only', async () => {
  const manifest = JSON.parse(await readFile(new URL('../shared/bundled-assets.json', import.meta.url), 'utf8'));
  assert.equal(manifest.irs.length, 8);
  assert.equal(new Set(manifest.irs.map(item => item.file)).size, 7);
  const loader = createBundledAssets();
  for (const entry of manifest.irs) {
    const resource = await loader.readIr(entry.environment);
    assert.ok(resource, `IR loader should serve ${entry.environment}`);
    assert.equal(resource.type, 'audio/wav');
    assert.equal(resource.reviewed, false);
    assert.equal(resource.metadata.source, 'recording');
    assert.ok(resource.metadata.acoustic.notes.trim());
    assert.ok(inspectWav(resource.bytes, { maxDurationSeconds: 4 }).durationSeconds <= 4);
  }
  const bath = manifest.irs.find(item => item.environment === 'bathroom');
  const shower = manifest.irs.find(item => item.environment === 'shower');
  assert.equal(shower.aliasOf, 'bathroom');
  assert.equal(shower.sha256, bath.sha256);
  assert.equal(bath.acoustic.wet, 0.14);
  assert.equal(shower.acoustic.wet, 0.12);
  assert.equal(await loader.readIr('studio'), null);
  assert.equal(await loader.readIr('library'), null);
});
