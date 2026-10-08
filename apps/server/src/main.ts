import { buildApp } from './app.ts';
import { EstimatedCoverDimensions, LuluClient, LuluCoverDimensions, type CoverDimensionsSource } from './lulu.ts';
import { Renderer } from './render/renderer.ts';

/**
 * Environment:
 *   PORT (8787), HOST (127.0.0.1)
 *   WEB_ORIGINS        comma-separated origins allowed to call the API (default: the Vite dev and preview servers)
 *   CHROMIUM_PATH      Chromium executable; defaults to the one `npx playwright-core install chromium` downloads
 *   LULU_API_BASE      https://api.sandbox.lulu.com (default) or https://api.lulu.com
 *   LULU_CLIENT_KEY, LULU_CLIENT_SECRET   without them, paperback covers use the guide's formula and hardcovers are refused
 *   MAX_RENDERS        concurrent renders (1)
 */
const env = process.env;
const lulu = env.LULU_CLIENT_KEY && env.LULU_CLIENT_SECRET
  ? new LuluCoverDimensions(new LuluClient({ baseUrl: env.LULU_API_BASE ?? 'https://api.sandbox.lulu.com', clientKey: env.LULU_CLIENT_KEY, clientSecret: env.LULU_CLIENT_SECRET }))
  : null;
const covers: CoverDimensionsSource = lulu ?? new EstimatedCoverDimensions();

const renderer = await Renderer.launch({ executablePath: env.CHROMIUM_PATH });
const app = buildApp({
  renderer,
  covers,
  webOrigins: (env.WEB_ORIGINS ?? 'http://localhost:5173,http://localhost:4173').split(',').map((s) => s.trim()).filter(Boolean),
  maxConcurrentRenders: Number(env.MAX_RENDERS ?? 1),
  logger: true,
});
if (!lulu) app.log.warn('No Lulu credentials: cover sizes are estimated (paperback only). Estimated covers must not be ordered.');

const shutdown = async () => {
  await app.close();
  await renderer.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: Number(env.PORT ?? 8787), host: env.HOST ?? '127.0.0.1' });
