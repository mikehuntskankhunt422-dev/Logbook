import { FAULTS, type Fault } from './fulfilment/faults.ts';
import { regionFromEndpoint, type S3Config } from './storage/s3.ts';

/**
 * One mode switch (D18): APP_MODE=test|live. Live mode also needs ALLOW_LIVE=true, and test and
 * live credentials live in separate variables, so a test deployment can never reach live services.
 */
export interface Config {
  mode: 'test' | 'live';
  host: string;
  port: number;
  lulu?: { apiUrl: string; tokenUrl: string; clientKey: string; clientSecret: string };
  /** Stripe for the current mode (M3); webhooks need the signing secret too. */
  stripe?: { secretKey: string; webhookSecret?: string; taxEnabled: boolean };
  /**
   * Where order files go (D16, D51, D54): an S3-compatible bucket when the R2_* or the S3_*
   * variables are set (Cloudflare R2, Backblaze B2, …); otherwise, with LOCAL_STORAGE=on in test
   * mode on a loopback host only, a local folder. Without either, ordering is off.
   */
  storage?: ({ kind: 's3' } & S3Config) | { kind: 'local'; dir: string };
  databasePath: string;
  /** Website origins allowed to call the order API from a browser (the website and API are hosted apart, D15). */
  webOrigins: string[];
  /**
   * This API's own public address (`PUBLIC_URL`, e.g. https://api.logbookjournal.app). Stripe sends
   * desktop customers to its "go back to Logbook" page there (D79).
   */
  publicOrigin?: string;
  /** Chromium to use instead of Playwright's bundled build (dev containers whose browser build differs). */
  chromiumPath?: string;
  /** After payment (M4): who Lulu and alerts reach, emails, and test-only fault injection. */
  fulfilment: {
    /** Your address: Lulu's `contact_email` and where alerts go. Required in live mode. */
    ownerEmail?: string;
    /** Lulu's `contact_email`: `ownerEmail`, or a placeholder in test mode. */
    contactEmail: string;
    resend?: { apiKey: string; from: string };
    faults: Fault[];
    /** Longest wait between two looks at a Lulu job. */
    trackEveryMs: number;
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const LULU = {
  test: { apiUrl: 'https://api.sandbox.lulu.com', keyVar: 'LULU_SANDBOX_CLIENT_KEY', secretVar: 'LULU_SANDBOX_CLIENT_SECRET' },
  live: { apiUrl: 'https://api.lulu.com', keyVar: 'LULU_CLIENT_KEY', secretVar: 'LULU_CLIENT_SECRET' },
} as const;

const STRIPE = {
  test: { keyVar: 'STRIPE_TEST_SECRET_KEY', hookVar: 'STRIPE_TEST_WEBHOOK_SECRET', prefixes: ['sk_test_', 'rk_test_'] },
  live: { keyVar: 'STRIPE_LIVE_SECRET_KEY', hookVar: 'STRIPE_LIVE_WEBHOOK_SECRET', prefixes: ['sk_live_', 'rk_live_'] },
} as const;

/** `PUBLIC_URL` as an origin; live mode needs https. */
function loadPublicOrigin(mode: 'test' | 'live', raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ConfigError(`PUBLIC_URL must be the API's address, like https://api.example.com, not "${raw}".`);
  }
  if (mode === 'live' && u.protocol !== 'https:') throw new ConfigError('PUBLIC_URL must use https in live mode.');
  return u.origin;
}

/** Stripe keys for `mode`, refusing the other mode's variables and any key that belongs to the other mode (D18). */
function loadStripe(mode: 'test' | 'live', env: Record<string, string | undefined>): Config['stripe'] {
  const other = STRIPE[mode === 'test' ? 'live' : 'test'];
  if (env[other.keyVar] || env[other.hookVar]) throw new ConfigError(`${other.keyVar}/${other.hookVar} are set but APP_MODE=${mode}. Remove them so test and live keys never mix.`);
  const s = STRIPE[mode];
  const secretKey = env[s.keyVar];
  const webhookSecret = env[s.hookVar] || undefined;
  if (!secretKey) {
    if (webhookSecret) throw new ConfigError(`${s.hookVar} is set without ${s.keyVar}.`);
    return undefined;
  }
  if (!s.prefixes.some((p) => secretKey.startsWith(p))) throw new ConfigError(`${s.keyVar} must be a ${mode} key (${s.prefixes.join(' or ')}…).`);
  if (webhookSecret && !webhookSecret.startsWith('whsec_')) throw new ConfigError(`${s.hookVar} must be a webhook signing secret (whsec_…).`);
  return { secretKey, webhookSecret, taxEnabled: env['STRIPE_TAX_ENABLED'] === 'true' };
}

const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;
const S3_VARS = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

function allOrNone(vars: readonly string[], env: Record<string, string | undefined>): boolean {
  const set = vars.filter((v) => env[v]);
  if (set.length && set.length < vars.length) throw new ConfigError(`Set all of ${vars.join(', ')}, or none (missing ${vars.filter((v) => !env[v]).join(', ')}).`);
  return set.length === vars.length;
}

function loadStorage(mode: 'test' | 'live', host: string, env: Record<string, string | undefined>): Config['storage'] {
  const r2 = allOrNone(R2_VARS, env);
  const s3 = allOrNone(S3_VARS, env);
  if (r2 && s3) throw new ConfigError('Set the R2_* variables or the S3_* variables, not both.');
  if (r2) {
    const accountId = env['R2_ACCOUNT_ID']!;
    return { kind: 's3', provider: 'r2', endpoint: env['R2_ENDPOINT'] || `https://${accountId}.r2.cloudflarestorage.com`, region: 'auto', bucket: env['R2_BUCKET']!, accessKeyId: env['R2_ACCESS_KEY_ID']!, secretAccessKey: env['R2_SECRET_ACCESS_KEY']! };
  }
  if (s3) {
    const endpoint = env['S3_ENDPOINT']!.replace(/\/+$/, '');
    const withScheme = endpoint.startsWith('https://') ? endpoint : `https://${endpoint}`;
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(withScheme)) throw new ConfigError('S3_ENDPOINT must be an https address such as https://s3.us-west-004.backblazeb2.com.');
    const b2 = regionFromEndpoint(withScheme);
    const region = env['S3_REGION'] || b2 || (withScheme.includes('.r2.cloudflarestorage.com') ? 'auto' : undefined);
    if (!region) throw new ConfigError('Set S3_REGION for this S3_ENDPOINT.');
    return { kind: 's3', provider: b2 ? 'b2' : withScheme.includes('.r2.cloudflarestorage.com') ? 'r2' : 's3', endpoint: withScheme, region, bucket: env['S3_BUCKET']!, accessKeyId: env['S3_ACCESS_KEY_ID']!, secretAccessKey: env['S3_SECRET_ACCESS_KEY']! };
  }
  if (env['LOCAL_STORAGE'] !== 'on') return undefined;
  // The local store routes content through this process, so it's for development on this machine only (D51).
  if (mode !== 'test' || !LOOPBACK.has(host)) throw new ConfigError('LOCAL_STORAGE=on works only with APP_MODE=test on a loopback HOST; use R2 anywhere else.');
  return { kind: 'local', dir: env['LOCAL_STORAGE_DIR'] || '.data/storage' };
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function loadFulfilment(mode: 'test' | 'live', lulu: boolean, env: Record<string, string | undefined>): Config['fulfilment'] {
  const ownerEmail = env['OWNER_EMAIL']?.trim() || undefined;
  if (ownerEmail && !EMAIL.test(ownerEmail)) throw new ConfigError('OWNER_EMAIL must be an email address.');
  if (mode === 'live' && lulu && !ownerEmail) throw new ConfigError('Set OWNER_EMAIL: Lulu needs a contact address for print jobs, and alerts go there.');
  const apiKey = env['RESEND_API_KEY']?.trim();
  const from = env['EMAIL_FROM']?.trim();
  if (Boolean(apiKey) !== Boolean(from)) throw new ConfigError('Set both RESEND_API_KEY and EMAIL_FROM (e.g. "Logbook <orders@your-domain>"), or neither.');
  const faults = (env['LOGBOOK_FAULTS'] ?? '').split(',').map((f) => f.trim()).filter(Boolean);
  if (faults.length && mode !== 'test') throw new ConfigError('LOGBOOK_FAULTS works only with APP_MODE=test.');
  const unknown = faults.filter((f) => !(FAULTS as readonly string[]).includes(f));
  if (unknown.length) throw new ConfigError(`Unknown LOGBOOK_FAULTS: ${unknown.join(', ')} (known: ${FAULTS.join(', ')}).`);
  const hours = Number(env['LULU_TRACK_HOURS'] ?? 6);
  if (!(hours > 0 && hours <= 24)) throw new ConfigError('LULU_TRACK_HOURS must be a number of hours from 0 to 24.');
  return {
    ownerEmail,
    // Lulu requires a contact address; in test mode nobody at the sandbox writes to it.
    contactEmail: ownerEmail ?? 'sandbox@example.com',
    resend: apiKey && from ? { apiKey, from } : undefined,
    faults: faults as Fault[],
    trackEveryMs: hours * 60 * 60 * 1000,
  };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const mode = env['APP_MODE'] ?? 'test';
  if (mode !== 'test' && mode !== 'live') throw new ConfigError(`APP_MODE must be "test" or "live", not "${mode}".`);
  if (mode === 'live' && env['ALLOW_LIVE'] !== 'true') throw new ConfigError('APP_MODE=live also needs ALLOW_LIVE=true.');

  const other = LULU[mode === 'test' ? 'live' : 'test'];
  if (env[other.keyVar] || env[other.secretVar]) {
    throw new ConfigError(`${other.keyVar}/${other.secretVar} are set but APP_MODE=${mode}. Remove them so test and live credentials never mix.`);
  }

  const l = LULU[mode];
  const clientKey = env[l.keyVar];
  const clientSecret = env[l.secretVar];
  if (Boolean(clientKey) !== Boolean(clientSecret)) throw new ConfigError(`Set both ${l.keyVar} and ${l.secretVar}, or neither.`);

  const port = Number(env['PORT'] ?? 4242);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new ConfigError(`PORT must be a port number, not "${env['PORT']}".`);

  const host = env['HOST'] ?? '127.0.0.1';
  const stripe = loadStripe(mode, env);
  const publicOrigin = loadPublicOrigin(mode, env['PUBLIC_URL']);
  // Logbook is a desktop app (D78): without its return page, no live customer could pay (D79).
  if (mode === 'live' && stripe && !publicOrigin) throw new ConfigError("Set PUBLIC_URL to this API's public https address: Stripe sends desktop customers back to its /api/checkout/done page.");
  return {
    mode,
    host,
    port,
    lulu:
      clientKey && clientSecret
        ? {
            apiUrl: l.apiUrl,
            // Production path from the OpenAPI spec; the sandbox path is assumed identical (ASSUMPTIONS #1, verified in slice D).
            tokenUrl: `${l.apiUrl}/auth/realms/glasstree/protocol/openid-connect/token`,
            clientKey,
            clientSecret,
          }
        : undefined,
    stripe,
    storage: loadStorage(mode, host, env),
    databasePath: env['DATABASE_PATH'] || '.data/logbook.sqlite',
    webOrigins: (env['WEB_ORIGIN'] ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
    publicOrigin,
    chromiumPath: env['LOGBOOK_CHROMIUM_PATH'] || undefined,
    fulfilment: loadFulfilment(mode, Boolean(clientKey && clientSecret), env),
  };
}
