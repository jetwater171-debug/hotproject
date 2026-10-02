import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const environments = JSON.parse(readFileSync(new URL('./environments.json', import.meta.url), 'utf8'));
const byId = new Map(environments.map(environment => [environment.id, environment]));
const ids = [
  'studio', 'bathroom', 'bedroom', 'livingroom', 'kitchen', 'office', 'library', 'elevator', 'garage',
  'rain', 'storm', 'forest', 'beach', 'river', 'fireplace', 'night', 'wind',
  'street', 'cafe', 'restaurant', 'bar', 'party', 'mall', 'supermarket', 'gym',
  'car', 'bus', 'subway', 'train', 'airplane',
];
const silentIds = ['studio', 'bathroom', 'bedroom', 'livingroom', 'library'];
const outdoorIds = ['rain', 'storm', 'forest', 'beach', 'river', 'night', 'wind', 'street'];
const categories = new Set(['indoor', 'nature', 'city', 'transport']);
const kinds = new Set(['dry', 'small-hard', 'furnished', 'large', 'open', 'reflective-outdoor', 'vehicle']);
const synths = new Set(['quiet', 'hum', 'rain', 'storm', 'forest', 'waves', 'river', 'fire', 'night', 'wind', 'traffic', 'cafe', 'party', 'engine', 'rail', 'flight']);

function range(value, minimum, maximum, label) {
  assert.equal(typeof value, 'number', `${label} must be numeric`);
  assert.ok(Number.isFinite(value) && value >= minimum && value <= maximum, `${label} must be within ${minimum}..${maximum}`);
}

test('stable environment identities are retained as distinct scene variants are added', () => {
  assert.deepEqual(environments.slice(0, ids.length).map(environment => environment.id), ids);
  assert.equal(byId.size, environments.length);
  assert.deepEqual(environments.filter(environment => environment.popular).map(environment => environment.id), ['studio', 'bathroom', 'rain', 'street', 'cafe', 'car']);
  for (const environment of environments) {
    assert.ok(environment.name.trim().length > 0, `${environment.id}: name`);
    assert.ok(categories.has(environment.category), `${environment.id}: category`);
    assert.equal(typeof environment.popular, 'boolean');
    assert.equal(typeof environment.prompt, 'string');
    assert.ok(synths.has(environment.synth), `${environment.id}: legacy synth`);
  }
});

test('sound v2 is complete and uses safe provider and mix parameter ranges', () => {
  const expectedKeys = ['version', 'mode', 'durationSeconds', 'promptInfluence', 'signature', 'backgroundDb', 'crossfadeSeconds', 'stereoWidth', 'defaultVolume'].sort();
  for (const { id, sound } of environments) {
    assert.deepEqual(Object.keys(sound).sort(), expectedKeys, `${id}: sound contract`);
    assert.equal(sound.version, 2, `${id}: revision`);
    assert.ok(['silent', 'bed'].includes(sound.mode), `${id}: mode`);
    range(sound.durationSeconds, 0.5, 30, `${id}: durationSeconds`);
    range(sound.promptInfluence, 0, 1, `${id}: promptInfluence`);
    range(sound.backgroundDb, -60, -20, `${id}: backgroundDb`);
    range(sound.crossfadeSeconds, 0, sound.durationSeconds / 4, `${id}: crossfadeSeconds`);
    range(sound.stereoWidth, 0, 1, `${id}: stereoWidth`);
    range(sound.defaultVolume, 0, 100, `${id}: defaultVolume`);
    assert.ok(Array.isArray(sound.signature) && sound.signature.length >= 2 && sound.signature.length <= 4, `${id}: signature sources`);
    assert.ok(sound.signature.every(source => typeof source === 'string' && source.trim().length > 8), `${id}: meaningful signature`);
    assert.equal(new Set(sound.signature).size, sound.signature.length, `${id}: duplicate signature source`);
  }
  assert.equal(new Set(environments.map(environment => environment.sound.signature.join('|'))).size, environments.length, 'Every scene needs a distinct audible or acoustic signature');
});

test('acoustic metadata retains the legacy fields and supports explicit early reflections', () => {
  for (const { id, acoustic } of environments) {
    range(acoustic.reverb, 0, 1, `${id}: reverb`);
    range(acoustic.decay, 0.05, 3, `${id}: decay`);
    range(acoustic.predelay, 0, 0.1, `${id}: predelay`);
    range(acoustic.lowpass, 1000, 24000, `${id}: lowpass`);
    range(acoustic.highpass, 20, 500, `${id}: highpass`);
    assert.ok(acoustic.highpass < acoustic.lowpass, `${id}: filter ordering`);
    assert.ok(kinds.has(acoustic.kind), `${id}: physical room kind`);
    range(acoustic.distanceWet, 0, 0.3, `${id}: distanceWet`);
    assert.ok(Array.isArray(acoustic.earlyReflections), `${id}: reflections`);
    let previousDelay = -1;
    for (const reflection of acoustic.earlyReflections) {
      assert.deepEqual(Object.keys(reflection).sort(), ['delayMs', 'gain', 'pan']);
      range(reflection.delayMs, 0, 100, `${id}: reflection delay`);
      range(reflection.gain, 0, 1, `${id}: reflection gain`);
      range(reflection.pan, -1, 1, `${id}: reflection pan`);
      assert.ok(reflection.delayMs > previousDelay, `${id}: reflections in time order`);
      previousDelay = reflection.delayMs;
    }
  }
});

test('quiet interiors use actual silence instead of invented household noise', () => {
  assert.deepEqual(environments.filter(environment => environment.sound.mode === 'silent').map(environment => environment.id), silentIds);
  for (const id of silentIds) {
    const environment = byId.get(id);
    assert.equal(environment.prompt, '', `${id}: must not request generated noise`);
    assert.equal(environment.sound.defaultVolume, 0, `${id}: default silence`);
    assert.equal(environment.sound.backgroundDb, -60, `${id}: silent level marker`);
    assert.equal(environment.sound.crossfadeSeconds, 0, `${id}: no bed loop`);
    assert.equal(environment.sound.stereoWidth, 0, `${id}: no ambient stereo bed`);
  }
  assert.equal(byId.get('studio').acoustic.kind, 'dry');
  assert.equal(byId.get('studio').acoustic.reverb, 0);
  assert.deepEqual(byId.get('studio').acoustic.earlyReflections, []);
});

test('bathroom, bedroom and living room remain distinct without adding a bed', () => {
  const bathroom = byId.get('bathroom').acoustic;
  const bedroom = byId.get('bedroom').acoustic;
  const livingroom = byId.get('livingroom').acoustic;
  assert.equal(bathroom.kind, 'small-hard');
  assert.equal(bedroom.kind, 'furnished');
  assert.ok(bathroom.reverb <= 0.2 && bathroom.decay <= 0.9, 'Bathroom reflections must not become a long echo');
  assert.ok(bedroom.reverb <= 0.06 && bedroom.decay <= 0.35, 'Textiles should keep bedroom reflections short');
  assert.ok(bathroom.reverb > livingroom.reverb && livingroom.reverb > bedroom.reverb);
  assert.ok(bathroom.decay > livingroom.decay && livingroom.decay > bedroom.decay);
  assert.ok(bathroom.earlyReflections[0].gain > bedroom.earlyReflections[0].gain);
});

test('outdoor scenes do not acquire an indoor reverb or distance tail', () => {
  assert.ok(outdoorIds.every(id => byId.get(id).acoustic.kind === 'open'));
  for (const id of outdoorIds) {
    const { acoustic, prompt } = byId.get(id);
    assert.ok(acoustic.reverb <= 0.03, `${id}: open-air reverb`);
    assert.ok(acoustic.decay <= 0.25, `${id}: short residual response`);
    assert.equal(acoustic.distanceWet, 0, `${id}: no distance reverb`);
    assert.deepEqual(acoustic.earlyReflections, [], `${id}: no invented room walls`);
    assert.match(prompt, /^Outdoor field recording/);
  }
  assert.equal(byId.get('fireplace').category, 'nature', 'Preserve existing navigation category');
  assert.equal(byId.get('fireplace').acoustic.kind, 'furnished', 'Fireplace is recorded inside a living room');
});

test('generated beds specify a stable recording position and exclude readable speech or music', () => {
  const beds = environments.filter(environment => environment.sound.mode === 'bed');
  assert.equal(beds.length, environments.length - silentIds.length);
  assert.equal(new Set(beds.map(environment => environment.prompt)).size, beds.length);
  for (const { id, prompt, sound } of beds) {
    assert.match(prompt, /^(Interior|Outdoor) field recording/, `${id}: recording perspective`);
    assert.doesNotMatch(prompt, /photorealistic/i, `${id}: audio-specific language`);
    assert.match(prompt, /No music, no intelligible speech, no foreground voice\./, `${id}: content exclusions`);
    assert.match(prompt, /(?:no|without)[^.]*(?:abrupt|sudden loud) peaks|never become sharp pops/i, `${id}: unobtrusive dynamics`);
    assert.ok(prompt.length >= 240, `${id}: source and perspective details`);
    assert.ok(sound.crossfadeSeconds > 0, `${id}: bed loop transition`);
    assert.ok(sound.backgroundDb <= -26 && sound.backgroundDb >= -36, `${id}: voice remains in front`);
    assert.ok(sound.defaultVolume > 0 && sound.defaultVolume <= 25, `${id}: restrained default bed`);
    assert.ok(sound.stereoWidth <= 0.65, `${id}: moderate spatial width`);
    assert.ok(sound.promptInfluence >= 0.65 && sound.promptInfluence <= 0.75, `${id}: initial provider tuning`);
    assert.ok([24, 30].includes(sound.durationSeconds), `${id}: catalogue duration`);
  }
});

test('shelters and walled streets keep early reflections distinct from open air', () => {
  for (const id of ['rain-roof', 'narrow-street', 'courtyard']) {
    const { acoustic } = byId.get(id);
    assert.equal(acoustic.kind, 'reflective-outdoor');
    assert.ok(acoustic.earlyReflections.length > 0, `${id}: reflecting surfaces`);
    assert.ok(acoustic.decay <= .25 && acoustic.distanceWet <= .03, `${id}: no indoor diffuse tail`);
  }
  assert.equal(byId.get('park').acoustic.kind, 'open');
  assert.equal(byId.get('rain-window').acoustic.kind, 'furnished');
  assert.equal(byId.get('car-rain').acoustic.kind, 'vehicle');
  assert.notEqual(byId.get('shower').sound.mode, byId.get('bathroom').sound.mode, 'Water running is separate from quiet bathroom acoustics');
  assert.notEqual(byId.get('rain-window').acoustic.kind, byId.get('rain').acoustic.kind, 'Closed window captures rain from indoors');
  for (const environment of environments.filter(scene => scene.variantOf)) {
    assert.ok(byId.has(environment.variantOf), `${environment.id}: stable base scene`);
    assert.ok(environment.icon && environment.description, `${environment.id}: meaningful navigation`);
  }
});

test('similar social scenes have different source signatures rather than one reused crowd bed', () => {
  assert.match(byId.get('cafe').prompt, /cup-and-saucer.*espresso steam/i);
  assert.match(byId.get('restaurant').prompt, /cutlery touching plates.*serving-dish/i);
  assert.match(byId.get('bar').prompt, /ice moving in glasses.*liquid pours/i);
  assert.match(byId.get('party').prompt, /clothing movement.*distant laughter/i);
  assert.match(byId.get('mall').prompt, /escalator machinery.*shopping-bag/i);
  assert.match(byId.get('supermarket').prompt, /refrigeration.*trolley wheels.*scanner beeps/i);
  assert.match(byId.get('gym').prompt, /treadmill motors.*padded weight contacts/i);
  assert.match(byId.get('street').prompt, /tires passing.*faraway footsteps/i);
});

test('transport scenes distinguish passenger cabins, propulsion and rail behavior', () => {
  assert.match(byId.get('car').prompt, /front passenger seat.*tire friction.*dashboard airflow/i);
  assert.match(byId.get('bus').prompt, /mid-cabin.*diesel-engine.*chassis-panel/i);
  assert.match(byId.get('subway').prompt, /electric traction.*continuous smooth rail.*tunnel air/i);
  assert.match(byId.get('subway').prompt, /No regular rail-joint clacking/i);
  assert.match(byId.get('train').prompt, /conventional passenger train.*wheel contacts.*rail joints/i);
  assert.match(byId.get('train').prompt, /never becoming a rigid repeated beat/i);
  assert.match(byId.get('airplane').prompt, /stable cruise.*jet-engine drone.*overhead air ventilation/i);
  for (const id of ['car', 'bus', 'subway', 'train', 'airplane']) {
    assert.equal(byId.get(id).acoustic.kind, 'vehicle');
    assert.ok(byId.get(id).acoustic.reverb <= 0.08, `${id}: confined cabin without long reverb`);
  }
});

test('variable outdoor events and railway beds have enough material for natural loops', () => {
  for (const id of ['storm', 'forest', 'beach', 'street', 'subway', 'train']) {
    assert.equal(byId.get(id).sound.durationSeconds, 30, `${id}: long variable bed`);
    assert.ok(byId.get(id).sound.crossfadeSeconds >= 1.5, `${id}: smooth loop seam`);
  }
  assert.match(byId.get('storm').prompt, /very distant rolling thunder.*long irregular quiet gaps/i);
  assert.match(byId.get('beach').prompt, /Vary wave spacing.*without a fixed cycle/i);
  assert.match(byId.get('rain').prompt, /(?:no|without)[^.]*thunder/i);
  assert.match(byId.get('river').prompt, /water ripples.*smooth stones.*no waterfall, ocean surf/i);
});
