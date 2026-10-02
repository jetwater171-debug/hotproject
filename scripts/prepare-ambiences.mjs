import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAmbienceLibrary, DEFAULT_LIBRARY_DIR, LibraryError, readAudioFile, readEnvironmentCatalog } from '../server/ambience-library.mjs';
import { getAmbienceRecipe } from '../server/audio-handler.mjs';
import { createBundledAssets, DEFAULT_BUNDLE_MANIFEST, DEFAULT_PUBLIC_DIR } from '../server/bundled-assets.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HELP = 'Uso: npm run audio:prepare -- [--environment rain] [--url http://127.0.0.1:8787] [--generate]\nSem --generate: apenas inspeciona os arquivos locais e imprime o plano, sem API ou cobrança.\n--generate: solicita sequencialmente os ambientes ausentes à API local; usa créditos ElevenLabs, não repete solicitações automaticamente e não aprova os resultados.';

function parseArguments(argv) {
  const input = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!['--environment', '--url', '--generate', '--help'].includes(name) || Object.hasOwn(input, name)) throw new LibraryError('invalid_arguments', 'Argumentos inválidos. Use --help para ver os exemplos.');
    if (name === '--generate' || name === '--help') input[name] = true;
    else { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new LibraryError('invalid_arguments', 'Um argumento obrigatório está sem valor.'); input[name] = argv[++i]; }
  }
  return input;
}

function localApiUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new LibraryError('invalid_url', 'Informe uma URL HTTP local válida.'); }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.port) throw new LibraryError('invalid_url', 'A preparação só pode acessar a API HTTP local, com porta explícita.');
  return url.origin;
}

async function requireResponse(response) {
  if (response.ok) return;
  let message;
  try { const body = await response.json(); message = body?.error?.message; } catch { /* No raw upstream output is printed. */ }
  throw new LibraryError('preparation_failed', typeof message === 'string' && message.length < 600 ? message : 'A API local não conseguiu preparar o ambiente. Nenhuma repetição automática foi feita.');
}

/** Dry run by default. --generate is the only branch that can request paid generation. */
export async function runPrepareAmbiences(argv = [], { catalog, libraryDir = DEFAULT_LIBRARY_DIR, cacheDir = resolve(ROOT, '.cache/audio'), bundleManifestPath = DEFAULT_BUNDLE_MANIFEST, publicDir = DEFAULT_PUBLIC_DIR, baseUrl, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const input = parseArguments(argv);
  if (input['--help']) { log(HELP); return []; }
  let environments = catalog || await readEnvironmentCatalog();
  if (input['--environment']) {
    environments = environments.filter(item => item.id === input['--environment']);
    if (!environments.length) throw new LibraryError('invalid_environment', 'Escolha um ambiente disponível no catálogo.');
  }
  const library = libraryDir ? createAmbienceLibrary({ rootDir: libraryDir }) : null;
  const bundles = createBundledAssets({ manifestPath: bundleManifestPath, publicDir });
  const plan = [];
  for (const environment of environments) {
    const recipe = getAmbienceRecipe(environment);
    let status = recipe.mode === 'silent' ? 'silent' : 'missing';
    if (status !== 'silent') {
      if (await library?.readApproved(environment.id)) status = 'approved';
      else if (await bundles.readBed(environment.id)) status = 'recorded';
      else if (cacheDir) { try { await readAudioFile(resolve(cacheDir, `${recipe.revision}.mp3`)); status = 'generated'; } catch { /* Missing or invalid candidates stay missing. */ } }
    }
    const item = { id: environment.id, status, mode: recipe.mode, durationSeconds: recipe.durationSeconds, promptInfluence: recipe.promptInfluence, revision: recipe.revision };
    plan.push(item);
    log(`${item.id}: ${status}${status === 'silent' ? ' — apenas acústica, sem geração' : ` — ${item.durationSeconds}s, influência ${item.promptInfluence}`}`);
    if (status === 'generated') log(`Candidato local, ainda não revisado: ${resolve(cacheDir, `${recipe.revision}.mp3`)}`);
  }
  const missing = plan.filter(item => item.status === 'missing');
  if (!input['--generate']) { log(`${missing.length} ambiente(s) ausente(s). Nenhuma geração foi solicitada. Use --generate apenas quando quiser usar os créditos da conta.`); return plan; }
  if (!missing.length) { log('Todos os ambientes já têm áudio ou usam apenas acústica. Nenhuma geração foi solicitada.'); return plan; }
  const api = localApiUrl(input['--url'] || baseUrl || `http://127.0.0.1:${process.env.PORT || '8787'}`);
  log(`${missing.length} candidato(s) será(ão) solicitado(s) sequencialmente à ElevenLabs pela API local, sem aprovação automática.`);
  let status;
  try { status = await fetchImpl(`${api}/api/audio/status`, { signal: AbortSignal.timeout(10_000), redirect: 'error' }); }
  catch { throw new LibraryError('api_offline', 'A API local não respondeu. Inicie npm run dev:api antes de preparar a biblioteca.'); }
  await requireResponse(status);
  const configuration = await status.json();
  if (configuration.configured !== true) throw new LibraryError('provider_not_configured', 'Configure ELEVENLABS_API_KEY no servidor. Nenhuma geração foi solicitada.');
  for (const item of missing) {
    let response;
    try { response = await fetchImpl(`${api}/api/audio/ambience`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ environment: item.id }), signal: AbortSignal.timeout(130_000), redirect: 'error' }); }
    catch { throw new LibraryError('generation_interrupted', 'A preparação foi interrompida. Confira a API e execute novamente para retomar pelo cache. Nenhuma repetição automática foi feita.'); }
    await requireResponse(response);
    // Consume the complete response before the next request. The server writes its cache before responding.
    await response.arrayBuffer();
    item.status = response.headers.get('x-ambience-source') === 'library' ? 'approved' : response.headers.get('x-ambience-source') === 'recording' ? 'recorded' : 'generated';
    log(`${item.id}: ${item.status === 'approved' ? 'biblioteca aprovada já disponível' : item.status === 'recorded' ? 'gravação incluída disponível, ainda não revisada' : 'candidato preparado, ainda não revisado'}.`);
    if (cacheDir && item.status === 'generated') {
      try { const path = resolve(cacheDir, `${item.revision}.mp3`); await readAudioFile(path); log(`Ouça o candidato: ${path}`); }
      catch { log('O cache em disco não está disponível. Ouça e baixe o candidato pela interface antes de registrar a revisão.'); }
    }
  }
  log('A preparação não aprova os candidatos. Após ouvir, registre com audio:library -- --environment ID --cached --approve.');
  return plan;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) runPrepareAmbiences(process.argv.slice(2)).catch(error => { console.error(error instanceof LibraryError ? error.message : 'Não foi possível preparar os ambientes locais.'); process.exitCode = 1; });
