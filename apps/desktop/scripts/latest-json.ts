// Writes `latest.json`, the file the app's updater reads from the newest GitHub release (M5 slice F,
// D88), from the installers and their `.sig` files in one folder. The release workflow runs it.
//
//   node --experimental-transform-types apps/desktop/scripts/latest-json.ts <folder> <tag> <owner/repo>
//
// Each platform points at the file the updater installs: the NSIS setup on Windows, the zipped
// app on macOS (one universal build for both chips), and on Linux the same kind of package the
// person installed (AppImage, deb or rpm). Every one of them must be there, signed.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [folder, tag, repo] = process.argv.slice(2);
if (!folder || !tag || !repo) {
  console.error('usage: latest-json.ts <folder> <tag> <owner/repo>');
  process.exit(2);
}

const files = await readdir(folder);
const kinds: [platforms: string[], pattern: RegExp][] = [
  [['windows-x86_64'], /_x64-setup\.exe$/],
  [['darwin-aarch64', 'darwin-x86_64'], /\.app\.tar\.gz$/],
  // The plain linux key is the fallback for a copy that doesn't know how it was installed.
  [['linux-x86_64-appimage', 'linux-x86_64'], /\.AppImage$/],
  [['linux-x86_64-deb'], /\.deb$/],
  [['linux-x86_64-rpm'], /\.rpm$/],
];

const platforms: Record<string, { signature: string; url: string }> = {};
const problems: string[] = [];
for (const [keys, pattern] of kinds) {
  const matches = files.filter((f) => pattern.test(f));
  if (matches.length !== 1) {
    problems.push(`expected one file matching ${pattern}, found ${matches.length ? matches.join(', ') : 'none'}`);
    continue;
  }
  const file = matches[0];
  if (!files.includes(`${file}.sig`)) {
    problems.push(`${file} has no ${file}.sig: was TAURI_SIGNING_PRIVATE_KEY set for the build?`);
    continue;
  }
  const signature = (await readFile(join(folder, `${file}.sig`), 'utf8')).trim();
  const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
  for (const key of keys) platforms[key] = { signature, url };
}
if (problems.length) {
  for (const p of problems) console.error(`latest.json: ${p}`);
  process.exit(1);
}

const version = tag.replace(/^v/, '');
const latest = {
  version,
  notes: `Logbook ${version}: https://github.com/${repo}/releases/tag/${tag}`,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  platforms,
};
await writeFile(join(folder, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);
console.log(`latest.json: ${version} for ${Object.keys(platforms).join(', ')}`);
