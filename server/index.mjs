import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAudioHandler } from './audio-handler.mjs';

export { createAudioHandler } from './audio-handler.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Existing environment wins; .env.local wins over .env. Never export any credentials. */
export async function loadEnvironment({ rootDir = ROOT, target = process.env } = {}) {
  for (const name of ['.env.local', '.env']) {
    let content;
    try { content = await readFile(resolve(rootDir, name), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw new Error('Não foi possível ler a configuração do servidor.'); }
    let parsed;
    try { parsed = parseEnv(content); } catch { throw new Error('A configuração do servidor não é válida.'); }
    for (const [key, value] of Object.entries(parsed)) if (target[key] === undefined) target[key] = value;
  }
}

export function createServer(options = {}) {
  const handler = createAudioHandler(options);
  const server = createHttpServer((req, res) => { void handler(req, res); });
  server.requestTimeout = 130_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5000;
  return server;
}

export async function startServer() {
  await loadEnvironment();
  const port = process.env.PORT === undefined ? 8787 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser uma porta válida.');
  const server = createServer({ port });
  await new Promise((resolveStart, rejectStart) => { server.once('error', rejectStart); server.listen(port, '127.0.0.1', resolveStart); });
  console.log(`Velora local: http://127.0.0.1:${port}`);
  return server;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  startServer().catch(() => { console.error('Não foi possível iniciar o servidor local. Confira a porta e a configuração.'); process.exitCode = 1; });
}
