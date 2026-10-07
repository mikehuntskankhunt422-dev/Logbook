/**
 * One mode switch (D18): APP_MODE=test|live. Live mode also needs ALLOW_LIVE=true, and test and
 * live credentials live in separate variables, so a test deployment can never reach live services.
 */
export interface Config {
  mode: 'test' | 'live';
  host: string;
  port: number;
  lulu?: { apiUrl: string; tokenUrl: string; clientKey: string; clientSecret: string };
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
    chromiumPath: env['LOGBOOK_CHROMIUM_PATH'] || undefined,
  };
}
