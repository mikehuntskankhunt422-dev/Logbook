/**
 * Sets up the order bucket and proves it works (D54):
 *
 *   npm run storage:setup -w @logbook/server
 *
 * 1. CORS: browsers on the website (http://localhost:5173 and every WEB_ORIGIN) may PUT uploads.
 * 2. Lifecycle: files under `orders/` are deleted after 7 days; hidden or replaced versions after a day.
 * 3. A check: a browser-style CORS preflight, an upload through a signed URL, a download, a delete.
 *
 * Reads the R2_* or S3_* variables. The key must be allowed to change bucket settings (on
 * Backblaze B2, a key for all buckets; bucket-restricted keys can't).
 */
import { loadConfig } from '../src/config.ts';
import { RETENTION_DAYS } from '../src/orders/service.ts';
import { S3Store } from '../src/storage/s3.ts';

const config = loadConfig();
if (config.storage?.kind !== 's3') throw new Error('Set the S3_* variables (or R2_*) first: see docs/M3.md §3 C.');
const store = new S3Store(config.storage);
const origins = [...new Set(['http://localhost:5173', ...config.webOrigins])];
const where = `${config.storage.provider} bucket "${config.storage.bucket}" at ${config.storage.endpoint}`;

console.log(`Setting up ${where}`);
await store.configureBucket({ origins, retentionDays: RETENTION_DAYS });
console.log(`✓ Browsers on ${origins.join(', ')} may upload; orders/ is deleted after ${RETENTION_DAYS} days`);

const key = `orders/_setup-check/${Date.now()}.json`;
const body = new TextEncoder().encode(JSON.stringify({ check: 'logbook storage setup' }));
const up = await store.signPut(key, { contentType: 'application/json', expiresInSeconds: 300 });

const preflight = await fetch(up.url, { method: 'OPTIONS', headers: { Origin: origins[0]!, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
const allowed = preflight.headers.get('access-control-allow-origin');
if (allowed !== origins[0] && allowed !== '*') throw new Error(`The bucket doesn't allow uploads from ${origins[0]} yet (CORS preflight HTTP ${preflight.status}). Rules can take a minute to apply; try again.`);
console.log('✓ A browser on the website is allowed to upload');

const put = await fetch(up.url, { method: 'PUT', headers: up.headers, body });
if (!put.ok) throw new Error(`Upload through a signed link failed (HTTP ${put.status}): ${(await put.text()).slice(0, 300)}`);
const got = await fetch(await store.signGet(key, 300));
if (!got.ok || (await got.text()) !== new TextDecoder().decode(body)) throw new Error(`Download through a signed link failed (HTTP ${got.status})`);
console.log('✓ Upload and download through signed links work (the same kind Lulu will use)');

await store.deletePrefix('orders/_setup-check/');
console.log('✓ Cleaned up. Storage is ready: restart the API and "Prepare my book" will use it.');
