import { PT_PER_IN, estimateCoverDimensions, packageId, type CoverDimensions, type Product } from '@logbook/core';

export interface CoverDimensionsSource {
  readonly kind: 'lulu' | 'estimate';
  get(product: Product, pageCount: number): Promise<CoverDimensions>;
}

export class CoverDimensionsUnavailable extends Error {
  override name = 'CoverDimensionsUnavailable';
}

/**
 * Offline stand-in for `/cover-dimensions/` using the guide's paperback formula (it reproduces Lulu's
 * own example exactly). Hardcover has no verified formula, so it refuses. Covers sized this way are
 * marked `estimate` and must never be ordered.
 */
export class EstimatedCoverDimensions implements CoverDimensionsSource {
  readonly kind = 'estimate' as const;
  async get(product: Product, pageCount: number): Promise<CoverDimensions> {
    const d = estimateCoverDimensions(product, pageCount);
    if (!d) throw new CoverDimensionsUnavailable('Hardcover covers need Lulu API credentials (LULU_CLIENT_KEY and LULU_CLIENT_SECRET) to size the cover.');
    return d;
  }
}

export interface LuluConfig {
  /** `https://api.sandbox.lulu.com` or `https://api.lulu.com`. */
  baseUrl: string;
  clientKey: string;
  clientSecret: string;
  fetch?: typeof fetch;
}

/**
 * Minimal Lulu client: OAuth client credentials (ASSUMPTIONS.md, L1 `securitySchemes`) and
 * `POST /cover-dimensions/` (L1 ~8220). The token path is verified for production; for the sandbox
 * it's assumed to be the same (ASSUMPTIONS.md, unverified #1). M4 extends this into the full client.
 */
export class LuluClient {
  private readonly cfg: LuluConfig;
  private readonly fetch: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(cfg: LuluConfig) {
    this.cfg = { ...cfg, baseUrl: cfg.baseUrl.replace(/\/+$/, '') };
    this.fetch = cfg.fetch ?? globalThis.fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const res = await this.fetch(`${this.cfg.baseUrl}/auth/realms/glasstree/protocol/openid-connect/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.clientKey}:${this.cfg.clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Lulu token request failed: HTTP ${res.status}`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('Lulu token response had no access_token');
    // Refresh a minute early so a token never expires mid-request.
    this.token = { value: json.access_token, expiresAt: Date.now() + Math.max(0, (json.expires_in ?? 300) - 60) * 1000 };
    return this.token.value;
  }

  async coverDimensions(podPackageId: string, interiorPageCount: number): Promise<{ widthPt: number; heightPt: number }> {
    const res = await this.fetch(`${this.cfg.baseUrl}/cover-dimensions/`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pod_package_id: podPackageId, interior_page_count: interiorPageCount, unit: 'pt' }),
    });
    if (!res.ok) throw new Error(`Lulu /cover-dimensions/ failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as { width?: unknown; height?: unknown; unit?: unknown };
    const widthPt = Number(json.width);
    const heightPt = Number(json.height);
    if (json.unit !== 'pt' || !(widthPt > 0) || !(heightPt > 0)) throw new Error(`Unexpected /cover-dimensions/ response: ${JSON.stringify(json).slice(0, 300)}`);
    return { widthPt, heightPt };
  }
}

export class LuluCoverDimensions implements CoverDimensionsSource {
  readonly kind = 'lulu' as const;
  private readonly client: LuluClient;
  private readonly cache = new Map<string, CoverDimensions>();

  constructor(client: LuluClient) {
    this.client = client;
  }

  async get(product: Product, pageCount: number): Promise<CoverDimensions> {
    const id = packageId(product);
    const key = `${id}:${pageCount}`;
    let d = this.cache.get(key);
    if (!d) {
      const { widthPt, heightPt } = await this.client.coverDimensions(id, pageCount);
      d = { widthIn: widthPt / PT_PER_IN, heightIn: heightPt / PT_PER_IN, source: 'lulu' };
      this.cache.set(key, d);
    }
    return d;
  }
}
