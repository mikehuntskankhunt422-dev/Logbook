import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

// `npm run dev` passes --local-storage: orders are stored in a local folder unless a bucket is configured (D51).
const devStorage = process.argv.includes('--local-storage') && !process.env['LOCAL_STORAGE'] && !process.env['R2_BUCKET'] && !process.env['S3_BUCKET'];
const config = loadConfig(devStorage ? { ...process.env, LOCAL_STORAGE: 'on' } : process.env);
const app = buildApp(config);
await app.listen({ host: config.host, port: config.port });
app.log.info({ mode: config.mode, lulu: Boolean(config.lulu) }, 'Logbook API ready');
