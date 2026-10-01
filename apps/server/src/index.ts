import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './transport/server.js';

const port = Number(process.env.PORT ?? 8787);
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
const staticDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');

const app = await createApp({
  port,
  allowedOrigins,
  staticDir: existsSync(staticDir) ? staticDir : undefined,
});
console.log(`[open-toilet] listening on :${port} (instance ${app.engine.serverInstanceId})`);
