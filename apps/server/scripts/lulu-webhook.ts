/**
 * Subscribes the API to Lulu's print-job webhooks (PLAN §1.5 step 8, D69):
 *
 *   npm run lulu:webhook -w @logbook/server -- https://api.example.com          # subscribe (or re-activate)
 *   npm run lulu:webhook -w @logbook/server -- https://api.example.com --test   # and have Lulu send a test delivery
 *   npm run lulu:webhook -w @logbook/server                                     # list subscriptions
 *
 * The subscription points at `<base>/api/lulu/webhook`. Lulu switches a subscription off after 5
 * failed deliveries in a row; running this again switches it back on. A test delivery carries a dummy
 * job, which the API answers with "unknown job"; its log line says whether the signature was hex or
 * base64 (open question #2). Uses the current mode's Lulu keys (sandbox in test mode).
 */
import { loadConfig } from '../src/config.ts';
import { LuluClient } from '../src/lulu/client.ts';
import { LULU_TOPIC } from '../src/lulu/webhook.ts';

const base = process.argv[2]?.startsWith('http') ? process.argv[2].replace(/\/+$/, '') : undefined;
const config = loadConfig();
if (!config.lulu) throw new Error('Set the Lulu keys for this mode (LULU_SANDBOX_CLIENT_KEY/SECRET in test mode).');
if (base && !base.startsWith('https://')) throw new Error('Lulu delivers webhooks to https addresses only.');
const lulu = new LuluClient(config.lulu);

const hooks = await lulu.listWebhooks();
if (!base) {
  console.log(hooks.length ? hooks.map((h) => `${h.id} ${h.is_active ? 'active' : 'OFF'} ${h.topics.join(',')} ${h.url}`).join('\n') : 'No webhook subscriptions.');
} else {
  const url = `${base}/api/lulu/webhook`;
  let hook = hooks.find((h) => h.url === url);
  if (!hook) hook = await lulu.createWebhook(url, [LULU_TOPIC]);
  else if (!hook.is_active || !hook.topics.includes(LULU_TOPIC)) hook = await lulu.updateWebhook(hook.id, { is_active: true, topics: [LULU_TOPIC] });
  console.log(`${hook.id} ${hook.is_active ? 'active' : 'OFF'} → ${hook.url} (${config.mode === 'test' ? 'sandbox' : 'live'})`);
  if (process.argv.includes('--test')) {
    await lulu.testWebhook(hook.id);
    console.log('Lulu queued a test delivery; the API logs "Lulu webhook" with the signature encoding when it arrives.');
  }
}
