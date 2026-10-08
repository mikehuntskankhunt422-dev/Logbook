/**
 * Gathers the rendered sample books (samples/out/<sample>--<product>/) into one flat folder,
 * samples/release/, with a manifest that `npm run lulu:validate` reads. CI publishes the folder as a
 * GitHub pre-release so Lulu can download the files (the M2 §2 fallback until R2 exists).
 *
 *   npm run samples:pack -w @logbook/server
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SampleBuild } from '../src/samples/build.ts';

export interface SampleManifest {
  commit: string | null;
  chromium: string;
  cases: {
    id: string;
    kind: string;
    product: string;
    podPackageId: string;
    pages: number;
    interior: string;
    cover: string;
    /** True when the cover used the guide's formula instead of Lulu's size: Lulu will likely reject it. */
    coverApproximate: boolean;
    coverMediaBox: string;
  }[];
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const outDir = join(root, 'samples', 'out');
const releaseDir = join(root, 'samples', 'release');

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

const manifest: SampleManifest = { commit: process.env['GITHUB_SHA'] ?? null, chromium: '', cases: [] };
for (const dir of (await readdir(outDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const report = JSON.parse(await readFile(join(outDir, dir, 'report.json'), 'utf8')) as SampleBuild;
  const interior = `${dir}--interior.pdf`;
  const cover = `${dir}--cover.pdf`;
  await copyFile(join(outDir, dir, 'interior.pdf'), join(releaseDir, interior));
  await copyFile(join(outDir, dir, 'cover.pdf'), join(releaseDir, cover));
  manifest.chromium = report.interior.chromium;
  manifest.cases.push({
    id: dir,
    kind: report.kind,
    product: report.product,
    podPackageId: report.podPackageId,
    pages: report.interior.plan.pages,
    interior,
    cover,
    coverApproximate: report.coverApproximate,
    coverMediaBox: report.coverReport.mediaBoxes[0] ?? '',
  });
}
if (!manifest.cases.length) throw new Error(`No sample books in ${outDir}. Run npm run test:print or npm run samples first.`);
await writeFile(join(releaseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Packed ${manifest.cases.length} sample books into ${releaseDir}`);
for (const c of manifest.cases) console.log(`  ${c.id}: ${c.podPackageId}, ${c.pages} pages, cover ${c.coverMediaBox} pt${c.coverApproximate ? ' (ESTIMATE)' : ''}`);
