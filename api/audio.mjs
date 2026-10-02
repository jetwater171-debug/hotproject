import { createAudioHandler } from '../server/audio-handler.mjs';

// Native Node functions have single-segment routes. vercel.json sends every
// /api/audio/* endpoint here and explicitly passes the remaining path.
export const createVercelHandler = options => {
  const audioHandler = createAudioHandler({ ...options, production: true, staticDir: null });
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/audio' && url.searchParams.has('__audio_route')) {
      const routes = url.searchParams.getAll('__audio_route');
      const route = routes[0];
      if (routes.length !== 1 || !route || route.length > 300 || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(route)) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: { code: 'invalid_route', message: 'Escolha um endereço de áudio válido.' } }));
        return;
      }
      url.searchParams.delete('__audio_route');
      // URLSearchParams decodes the rewrite parameter once, retaining separate
      // search/page/language parameters. The incoming body stream is untouched.
      req.url = `/api/audio/${route}${url.search}`;
    }
    return audioHandler(req, res);
  };
};
const handler = createVercelHandler();
export default handler;
