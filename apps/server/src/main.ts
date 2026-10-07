import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = buildApp(config);
await app.listen({ host: config.host, port: config.port });
app.log.info({ mode: config.mode, lulu: Boolean(config.lulu) }, 'Logbook API ready');
