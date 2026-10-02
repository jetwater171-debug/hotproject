import { createAudioHandler } from '../server/audio-handler.mjs';

// A single Node function serves every /api/audio/* path. No listener or .env loader.
export const createVercelHandler = options => createAudioHandler({ ...options, production: true, staticDir: null });
const handler = createVercelHandler();
export default handler;
