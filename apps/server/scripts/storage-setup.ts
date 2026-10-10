/**
 * Sets up the order bucket and proves it works (D54):
 *
 *   npm run storage:setup -w @logbook/server
 *
 * 1. CORS: the desktop app's window (D79), the dev servers (http://localhost:5173, :5174 and :4173)
 *    and every WEB_ORIGIN may PUT uploads and GET the proof PDFs (the order page shows them with
 *    pdf.js). If the provider refuses the app's tauri:// origin, any origin is allowed instead: every
 *    link to the bucket is signed and expires, so CORS adds nothing there.
 * 2. Lifecycle: files under `orders/` are deleted after 7 days; hidden or replaced versions after a day.
 * 3. A check: a browser-style CORS preflight, an upload through a signed URL, a browser-style
 *    download, a delete.
 *
 * Reads the R2_* or S3_* variables. The key must be allowed to change bucket settings (on
 * Backblaze B2, a key for all buckets; bucket-restricted keys can't).
 */
import { loadConfig } from '../src/config.ts';
import { DESKTOP_APP_ORIGINS } from '../src/orders/routes.ts';
import { RETENTION_DAYS } from '../src/orders/service.ts';
import { S3Store } from '../src/storage/s3.ts';

const config = loadConfig();
if (config.storage?.kind !== 's3') throw new Error('Set the S3_* variables (or R2_*) first: see docs/M3.md §3 C.');
const store = new S3Store(config.storage);
// The dev servers (browser and desktop dev window), `vite preview` (where the e2e tests run), any
// website, and the desktop app itself.
let origins = [...new Set(['http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173', ...config.webOrigins, ...DESKTOP_APP_ORIGINS])];
const where = `${config.storage.provider} bucket "${config.storage.bucket}" at ${config.storage.endpoint}`;

console.log(`Setting up ${where}`);
try {
  await store.configureBucket({ origins, retentionDays: RETENTION_DAYS });
} catch (err) {
  console.log(`  The bucket refused that list of origins (${String(err).slice(0, 200)}); allowing any origin instead.`);
  origins = ['*'];
  await store.configureBucket({ origins, retentionDays: RETENTION_DAYS });
}
console.log(`✓ Browsers on ${origins.join(', ')} may upload and read proofs; orders/ is deleted after ${RETENTION_DAYS} days`);

const key = `orders/_setup-check/${Date.now()}.json`;
const body = new TextEncoder().encode(JSON.stringify({ check: 'logbook storage setup' }));
const up = await store.signPut(key, { contentType: 'application/json', expiresInSeconds: 300 });

// The desktop app's origin is the one customers use (D78); the first dev origin covers the rest.
for (const origin of [DESKTOP_APP_ORIGINS[0]!, 'http://localhost:5173']) {
  const preflight = await fetch(up.url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
  const allowed = preflight.headers.get('access-control-allow-origin');
  if (allowed !== origin && allowed !== '*') throw new Error(`The bucket doesn't allow uploads from ${origin} yet (CORS preflight HTTP ${preflight.status}). Rules can take a minute to apply; try again.`);
  console.log(`✓ ${origin} is allowed to upload`);
}

const put = await fetch(up.url, { method: 'PUT', headers: up.headers, body });
if (!put.ok) throw new Error(`Upload through a signed link failed (HTTP ${put.status}): ${(await put.text()).slice(0, 300)}`);
const got = await fetch(await store.signGet(key, 300), { headers: { Origin: origins[0]! } });
if (!got.ok || (await got.text()) !== new TextDecoder().decode(body)) throw new Error(`Download through a signed link failed (HTTP ${got.status})`);
const readable = got.headers.get('access-control-allow-origin');
if (readable !== origins[0] && readable !== '*') throw new Error(`The bucket doesn't let ${origins[0]} read proofs yet (no CORS header on GET). Rules can take a minute to apply; try again.`);
console.log('✓ Upload and download through signed links work (the same kind Lulu will use), and the website may read them');

await store.deletePrefix('orders/_setup-check/');
console.log('✓ Cleaned up. Storage is ready: restart the API and "Prepare my book" will use it.');
