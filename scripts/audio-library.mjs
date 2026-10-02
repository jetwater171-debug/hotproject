import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedFile, DEFAULT_LIBRARY_DIR, LibraryError, readEnvironmentCatalog, registerLibraryClip } from '../server/ambience-library.mjs';
import { getAmbienceRecipe } from '../server/audio-handler.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const USAGE = 'Uso: npm run audio:library -- --environment rain --file "C:\\audio\\rain.wav" --license owned|cc0|mit|elevenlabs --source "Procedência" [--approve]\nCandidato em cache: npm run audio:library -- --environment rain --cached [--approve]\nResposta de sala: adicione --kind ir --metadata "C:\\audio\\ir.json" (WAV PCM/float mono/estéreo até 4s).\nEvento: adicione --kind event --event door --metadata "C:\\audio\\event.json" (WAV até 15s). Metadados e exemplos: docs/audio-design.md.\nFundos: prefira 24–30s; a interface aceita até 60s. WAV, MP3, OGG, FLAC e M4A; limite de 64 MB.\n--approve declara que você ouviu e revisou o arquivo. Sem esse argumento ele fica como rascunho e não é servido. Um rascunho não pode substituir um recurso já aprovado.';

function options(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!['--environment', '--file', '--license', '--source', '--kind', '--metadata', '--event', '--approve', '--cached', '--help'].includes(name) || Object.hasOwn(values, name)) throw new LibraryError('invalid_arguments', 'Argumentos inválidos. Use --help para ver os exemplos.');
    if (['--approve', '--cached', '--help'].includes(name)) values[name] = true;
    else { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new LibraryError('invalid_arguments', 'Um argumento obrigatório está sem valor.'); values[name] = argv[++i]; }
  }
  return values;
}

/** Registration is entirely local: no provider calls and no .env loading. */
export async function runAudioLibrary(argv, { catalog, rootDir = DEFAULT_LIBRARY_DIR, cacheDir = resolve(ROOT, '.cache/audio'), log = console.log } = {}) {
  const input = options(argv);
  if (input['--help'] || !argv.length) { log(USAGE); return null; }
  const environments = catalog || await readEnvironmentCatalog();
  const environment = input['--environment'];
  const kind = input['--kind'] || 'bed';
  if (!['bed', 'ir', 'event'].includes(kind) || kind === 'bed' && (input['--metadata'] || input['--event']) || kind === 'ir' && input['--event']) throw new LibraryError('invalid_arguments', 'Combine --metadata com --kind ir ou event; --event identifica somente eventos.');
  let metadata;
  if (kind !== 'bed') {
    try { metadata = JSON.parse((await boundedFile(resolve(input['--metadata']), 32 * 1024)).toString('utf8')); }
    catch { throw new LibraryError('invalid_resource_metadata', 'Informe um arquivo JSON válido em --metadata. Consulte docs/audio-design.md.'); }
  }
  let file = input['--file'], license = input['--license'], source = input['--source'];
  if (input['--cached']) {
    if (kind !== 'bed') throw new LibraryError('invalid_arguments', '--cached está disponível somente para fundos de ambiente.');
    if (file || license && license !== 'elevenlabs') throw new LibraryError('invalid_arguments', '--cached usa licença elevenlabs e não pode ser combinado com --file.');
    const selected = environments.find(item => item.id === environment);
    if (!selected) throw new LibraryError('invalid_environment', 'Escolha um ambiente disponível no catálogo.');
    const recipe = getAmbienceRecipe(selected);
    if (recipe.mode === 'silent') throw new LibraryError('silent_environment', 'Este cenário usa apenas acústica e não precisa de um som de fundo.');
    file = resolve(cacheDir, `${recipe.revision}.mp3`); license = 'elevenlabs';
    source ||= `ElevenLabs Sound Effects v2; ambiente ${environment}; receita ${recipe.revision}`;
  }
  const result = await registerLibraryClip({ environment, file, license, source, approve: input['--approve'] === true, rootDir, environments, kind, eventId: input['--event'], ...(kind === 'ir' ? { acoustic: metadata } : kind === 'event' ? { sound: metadata } : {}) });
  log(`${result.environment}: ${result.reviewed ? 'aprovado pelo usuário' : 'rascunho, aguardando revisão'} (${result.byteLength} bytes). SHA-256: ${result.sha256}`);
  return result;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) runAudioLibrary(process.argv.slice(2)).catch(error => { console.error(error instanceof LibraryError ? error.message : 'Não foi possível registrar o áudio local.'); process.exitCode = 1; });
