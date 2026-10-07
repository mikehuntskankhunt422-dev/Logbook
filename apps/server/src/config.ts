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
  /** Chromium to use instead of Playwright's bundled build (dev containers whose browser build differs). */
  chromiumPath?: string;
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

  return {
    mode,
    host: env['HOST'] ?? '127.0.0.1',
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
    stripe: loadStripe(mode, env),
    chromiumPath: env['LOGBOOK_CHROMIUM_PATH'] || undefined,
  };
}
