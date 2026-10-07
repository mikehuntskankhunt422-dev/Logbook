/**
 * Checks every package ID Logbook offers against the Lulu sandbox (M2 slice D):
 *
 *   npm run lulu:packages                 # print a Markdown report; JSON in samples/out/lulu-packages.json
 *   npm run lulu:packages -- --record     # also re-record the sample cover sizes used by CI
 *
 * A package is real when a cost calculation accepts it (`/cover-dimensions/` answers malformed IDs
 * with a 500, so it can't tell). Cover sizes are recorded at the edges of each binding's page range,
 * and hardcover sizes are checked against the case-wrap geometry (ASSUMPTIONS open question #7).
 * Needs LULU_SANDBOX_CLIENT_KEY and LULU_SANDBOX_CLIENT_SECRET.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allProducts, pageLimits, podPackageId, TRIMS, type Product } from '@logbook/core';
import { loadConfig } from '../src/config.ts';
import { LuluClient, LuluError } from '../src/lulu/client.ts';
import { RECORDED_COVER_DIMENSIONS_PATH, type RecordedCoverDimensions } from '../src/samples/cover-dims.ts';
import { SAMPLE_PRODUCTS } from '../src/samples/build.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const record = process.argv.includes('--record');
const config = loadConfig();
if (!config.lulu || config.mode !== 'test') throw new Error('Set LULU_SANDBOX_CLIENT_KEY and LULU_SANDBOX_CLIENT_SECRET (sandbox only).');
const lulu = new LuluClient(config.lulu);

/** A US address for cost checks: every package ships there with MAIL. */
const ADDRESS = { street1: '1 SE Main St', city: 'Portland', stateCode: 'OR', countryCode: 'US', postcode: '97201', phoneNumber: '+1 503 555 0100' };
const COST_PAGES = 100;
const MM = 25.4;

interface PackageCheck {
  podPackageId: string;
  product: Product;
  exists: boolean;
  error?: string;
  printCost100?: number;
  currency?: string;
  /** Inches, at [min pages, 800 pages]. */
  covers: { pages: number; width: number; height: number; edge: number; spine: number }[];
}

const checks: PackageCheck[] = [];
for (const product of allProducts()) {
  const id = podPackageId(product);
  const check: PackageCheck = { podPackageId: id, product, exists: false, covers: [] };
  try {
    const cost = await lulu.costCalculation({ lineItems: [{ podPackageId: id, pageCount: COST_PAGES, quantity: 1 }], shippingAddress: ADDRESS, shippingOption: 'MAIL' });
    check.exists = true;
    check.printCost100 = cost.line_item_costs[0]!.total_cost_excl_tax;
    check.currency = cost.currency;
    const t = TRIMS[product.trim];
    for (const pages of [pageLimits(product).min, pageLimits(product).max]) {
      const d = await lulu.coverDimensions(id, pages);
      const width = d.width / MM;
      const height = d.height / MM;
      const edge = (height - t.heightIn) / 2;
      check.covers.push({ pages, width: round(width), height: round(height), edge: round(edge), spine: round(width - 2 * t.widthIn - 2 * edge) });
    }
  } catch (err) {
    check.error = err instanceof LuluError ? err.message : String(err);
  }
  checks.push(check);
  console.error(`${id}: ${check.exists ? 'ok' : `FAILED ${check.error}`}`);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// The case-wrap check: every hardcover sheet should be the trim plus the same edge all round
// (0.75″ wrap + 0.125″ bleed per Lulu's help centre), with the spine as the only page-dependent part.
const hardcoverEdges = new Set(checks.filter((c) => c.product.binding === 'hardcover').flatMap((c) => c.covers.map((v) => v.edge)));
const paperbackEdges = new Set(checks.filter((c) => c.product.binding === 'paperback').flatMap((c) => c.covers.map((v) => v.edge)));

const lines = [
  `| Package ID | Exists | Print cost, ${COST_PAGES} pp (sandbox) | Cover at min pages (in) | Cover at 800 pp (in) |`,
  '|---|---|---|---|---|',
  ...checks.map((c) => {
    const cov = (i: number) => (c.covers[i] ? `${c.covers[i].width} × ${c.covers[i].height} (${c.covers[i].pages} pp, spine ${c.covers[i].spine})` : '—');
    return `| \`${c.podPackageId}\` | ${c.exists ? 'yes' : `**no**: ${c.error}`} | ${c.printCost100 !== undefined ? `${c.currency} ${c.printCost100.toFixed(2)}` : '—'} | ${cov(0)} | ${cov(1)} |`;
  }),
  '',
  `Outer edge beyond the trim: paperbacks ${[...paperbackEdges].join(', ')}″; hardcovers ${[...hardcoverEdges].join(', ')}″.`,
];
console.log(lines.join('\n'));

await mkdir(join(root, 'samples', 'out'), { recursive: true });
await writeFile(join(root, 'samples', 'out', 'lulu-packages.json'), JSON.stringify({ checked: new Date().toISOString(), checks }, null, 2));

if (record) {
  // Every even page count each sample can plausibly reach, in every sample product.
  const ranges: [number, number][] = [
    [24, 64],
    [160, 240],
  ];
  const sizes: Record<string, [number, number]> = {};
  for (const product of Object.values(SAMPLE_PRODUCTS)) {
    const id = podPackageId(product);
    for (const [lo, hi] of ranges)
      for (let pages = lo; pages <= hi; pages += 2) {
        if (pages < pageLimits(product).min) continue;
        const d = await lulu.coverDimensions(id, pages);
        sizes[`${id}@${pages}`] = [d.width, d.height];
      }
  }
  const file: RecordedCoverDimensions = {
    recorded: new Date().toISOString().slice(0, 10),
    source: 'Lulu sandbox POST /cover-dimensions/ with unit=mm (scripts/verify-lulu-packages.ts --record)',
    unit: 'mm',
    sizes,
  };
  await writeFile(RECORDED_COVER_DIMENSIONS_PATH, `${JSON.stringify(file, null, 1)}\n`);
  console.error(`Recorded ${Object.keys(sizes).length} cover sizes → ${fileURLToPath(RECORDED_COVER_DIMENSIONS_PATH)}`);
}

if (checks.some((c) => !c.exists)) process.exitCode = 1;
