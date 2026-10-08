/**
 * Renders the sample books to samples/out/<sample>--<product>/ (interior.pdf, cover.pdf, report.json).
 *
 *   npm run samples                                   # every sample in every sample product
 *   npm run samples -- 40-page                        # one sample, every product
 *   npm run samples -- 200-page 6x9-pb-matte          # one sample, one product
 *
 * Covers use Lulu's size: asked live when LULU_SANDBOX_CLIENT_KEY/SECRET are set, otherwise the
 * sizes recorded from the sandbox, otherwise the guide's formula (marked approximate).
 * Set LOGBOOK_CHROMIUM_PATH to use a Chromium other than Playwright's own build.
 */
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.ts';
import { LuluClient } from '../src/lulu/client.ts';
import { closeBrowser } from '../src/render/browser.ts';
import { buildSampleBook, SAMPLE_PRODUCTS, type SampleProductId } from '../src/samples/build.ts';
import { recordedCoverDimensions } from '../src/samples/cover-dims.ts';
import { SAMPLE_KINDS, type SampleKind } from '../src/samples/generate.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const [kindArg, productArg] = process.argv.slice(2);
const kinds = (kindArg ? [kindArg] : Object.keys(SAMPLE_KINDS)) as SampleKind[];
const products = (productArg ? [productArg] : Object.keys(SAMPLE_PRODUCTS)) as SampleProductId[];
for (const k of kinds) if (!(k in SAMPLE_KINDS)) throw new Error(`Unknown sample "${k}". Use one of: ${Object.keys(SAMPLE_KINDS).join(', ')}`);
for (const p of products) if (!(p in SAMPLE_PRODUCTS)) throw new Error(`Unknown product "${p}". Use one of: ${Object.keys(SAMPLE_PRODUCTS).join(', ')}`);

const config = loadConfig();
const lulu = config.lulu && new LuluClient(config.lulu);
const coverDims = async (pod: string, pages: number) => (lulu ? lulu.coverDimensions(pod, pages) : recordedCoverDimensions(pod, pages));

try {
  for (const kind of kinds)
    for (const product of products) {
      const out = join(root, 'samples', 'out', `${kind}--${product}`);
      const b = await buildSampleBook(kind, product, out, { coverDims });
      const fonts = [...new Set(b.interiorReport.fonts.map((f) => f.subtype))].join(', ');
      console.log(
        `${kind} ${product} (${b.podPackageId}): ${b.interior.plan.pages} pages (${b.interior.plan.laidOut} laid out + ${b.interior.plan.notesPages} Notes), ` +
          `gutter ${b.interior.plan.gutterIn}″, ${b.interior.plan.passes} passes, ${(b.interior.ms / 1000).toFixed(1)} s · ` +
          `fonts ${fonts} · soft masks ${b.interiorReport.softMasks + b.coverReport.softMasks} · ` +
          `cover ${b.coverReport.mediaBoxes[0]} pt${b.coverApproximate ? ' (offline estimate)' : lulu ? ' (Lulu)' : ' (recorded Lulu size)'} · ${b.warnings.length} low-res warnings → ${relative(root, out)}`,
      );
    }
} finally {
  await closeBrowser();
}
