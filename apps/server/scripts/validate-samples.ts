/**
 * Sends hosted sample books to Lulu's sandbox validators and records the outcome (M2 slice D):
 *
 *   npm run lulu:validate -- https://github.com/<owner>/<repo>/releases/download/<tag>
 *
 * The base URL must serve the files listed in its manifest.json (see scripts/pack-samples.ts).
 * Each interior goes to `/validate-interior/` with its package ID (so Lulu normalizes it too) and
 * each cover to `/validate-cover/`. The dated result table replaces the block between the
 * lulu-validation markers in docs/ASSUMPTIONS.md. Exits non-zero unless every file passes.
 * Needs LULU_SANDBOX_CLIENT_KEY and LULU_SANDBOX_CLIENT_SECRET.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.ts';
import { LuluClient, type CoverValidation, type InteriorValidation } from '../src/lulu/client.ts';
import type { SampleManifest } from './pack-samples.ts';

const base = process.argv[2]?.replace(/\/+$/, '');
if (!base?.startsWith('https://')) throw new Error('Usage: npm run lulu:validate -- <https base URL that serves manifest.json and the PDFs>');
const config = loadConfig();
if (!config.lulu || config.mode !== 'test') throw new Error('Set LULU_SANDBOX_CLIENT_KEY and LULU_SANDBOX_CLIENT_SECRET (sandbox only).');
const lulu = new LuluClient(config.lulu);

const res = await fetch(`${base}/manifest.json`);
if (!res.ok) throw new Error(`Could not read ${base}/manifest.json (HTTP ${res.status})`);
const manifest = (await res.json()) as SampleManifest;

interface Result {
  id: string;
  podPackageId: string;
  pages: number;
  interior: InteriorValidation;
  cover: CoverValidation;
  seconds: number;
}

const started = Date.now();
const results = await Promise.all(
  manifest.cases.map(async (c): Promise<Result> => {
    const t0 = Date.now();
    const [i, cv] = await Promise.all([lulu.validateInterior(`${base}/${c.interior}`, c.podPackageId), lulu.validateCover(`${base}/${c.cover}`, c.podPackageId, c.pages)]);
    console.error(`${c.id}: interior job ${i.id}, cover job ${cv.id}`);
    const [interior, cover] = await Promise.all([
      lulu.waitForValidation(i, (id) => lulu.getInteriorValidation(id), { timeoutMs: 20 * 60_000 }),
      lulu.waitForValidation(cv, (id) => lulu.getCoverValidation(id), { timeoutMs: 20 * 60_000 }),
    ]);
    console.error(`${c.id}: interior ${interior.status}, cover ${cover.status}`);
    return { id: c.id, podPackageId: c.podPackageId, pages: c.pages, interior, cover, seconds: Math.round((Date.now() - t0) / 1000) };
  }),
);

const interiorOk = (r: Result) => (r.interior.status === 'VALIDATED' || r.interior.status === 'NORMALIZED') && r.interior.page_count === r.pages;
const coverOk = (r: Result) => r.cover.status === 'NORMALIZED';
const passed = results.every((r) => interiorOk(r) && coverOk(r));
const errs = (e: string[] | null | undefined) => (e?.length ? `: ${e.join('; ').replaceAll('|', '\\|')}` : '');

const today = new Date().toISOString().slice(0, 10);
const table = [
  `<!-- lulu-validation:start (written by scripts/validate-samples.ts) -->`,
  `**${today}, Lulu sandbox: ${passed ? 'every sample file passed' : 'NOT all sample files passed'}.** Files rendered by Chromium ${manifest.chromium}${manifest.commit ? ` at commit \`${manifest.commit.slice(0, 7)}\`` : ''} and fetched by Lulu from \`${base}/\`. Took ${Math.round((Date.now() - started) / 1000)} s in total.`,
  '',
  '| Sample | Package ID | Pages | Interior (`/validate-interior/` with package ID) | Lulu page count | Cover (`/validate-cover/`) |',
  '|---|---|---|---|---|---|',
  ...results.map(
    (r) =>
      `| ${r.id} | \`${r.podPackageId}\` | ${r.pages} | ${r.interior.status}${errs(r.interior.errors)} (job ${r.interior.id}) | ${r.interior.page_count ?? '—'} | ${r.cover.status}${errs(r.cover.errors)} (job ${r.cover.id}) |`,
  ),
  `<!-- lulu-validation:end -->`,
].join('\n');
console.log(table);

const docPath = fileURLToPath(new URL('../../../docs/ASSUMPTIONS.md', import.meta.url));
const doc = await readFile(docPath, 'utf8');
const marked = /<!-- lulu-validation:start[\s\S]*?<!-- lulu-validation:end -->/;
if (marked.test(doc)) {
  await writeFile(docPath, doc.replace(marked, table));
  console.error('Updated docs/ASSUMPTIONS.md');
} else {
  console.error('No lulu-validation markers in docs/ASSUMPTIONS.md; paste the table above by hand.');
}
if (!passed) process.exitCode = 1;
