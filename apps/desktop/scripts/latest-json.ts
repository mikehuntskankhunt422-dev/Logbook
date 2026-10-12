// Writes `latest.json`, the file the app's updater reads from the newest GitHub release (M5 slice F,
// D88), from the installers and their `.sig` files in one folder. The release workflow runs it.
//
//   node --experimental-transform-types apps/desktop/scripts/latest-json.ts <folder> <tag> <owner/repo> [tauri config]
//   node --experimental-transform-types apps/desktop/scripts/latest-json.ts --verify <folder> [tauri config] [version]
//
// `--verify` only checks the signatures of whatever is in the folder (one platform's build), and
// with a version, that each signature is bound to it.
//
// Each platform points at the file the updater installs: the NSIS setup on Windows, the zipped
// app on macOS (one universal build for both chips), and on Linux the same kind of package the
// person installed (AppImage, deb or rpm). Every one of them must be there, signed, and its
// signature must check out against the public key the app carries (src-tauri/tauri.conf.json, or
// the config given): a release signed with another key would be refused by every copy out there.
// Each signature must also be bound to the release's version (`--app-version`), so a feed can't
// pair a file with another version number to make installed copies downgrade.

import { createHash, createPublicKey, verify } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const verifyOnly = process.argv[2] === '--verify';
const args = process.argv.slice(verifyOnly ? 3 : 2);
const [folder, tag, repo] = verifyOnly ? [args[0], '', ''] : args;
const configPath = args[verifyOnly ? 1 : 3] || fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url));
const expectedVersion = verifyOnly ? args[2] : tag?.replace(/^v/, '');
if (!folder || (!verifyOnly && (!tag || !repo))) {
  console.error('usage: latest-json.ts <folder> <tag> <owner/repo> [tauri config]  |  latest-json.ts --verify <folder> [tauri config] [version]');
  process.exit(2);
}

/** Line `n` of a minisign key or signature file, which Tauri stores base64-encoded. */
const line = (b64: string, n: number) => Buffer.from(b64, 'base64').toString('utf8').split('\n')[n] ?? '';

// A minisign public key: "Ed", 8 bytes of key ID, 32 bytes of Ed25519 key.
const pub = Buffer.from(line(JSON.parse(await readFile(configPath, 'utf8')).plugins.updater.pubkey, 1), 'base64');
const keyId = pub.subarray(2, 10);
const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub.subarray(10, 42)]), format: 'der', type: 'spki' });

/** Why `file` doesn't verify against the app's key, or null when it does. */
async function signatureProblem(file: string, sigFile: string): Promise<string | null> {
  const encoded = (await readFile(sigFile, 'utf8')).trim();
  // "ED" (the file's BLAKE2b-512 hash signed) or "Ed" (the file itself), the key ID, 64 bytes of signature.
  const sig = Buffer.from(line(encoded, 1), 'base64');
  if (!sig.subarray(2, 10).equals(keyId)) return `signed with key ${sig.subarray(2, 10).reverse().toString('hex').toUpperCase()}, but the app expects ${Buffer.from(keyId).reverse().toString('hex').toUpperCase()}`;
  const data = await readFile(file);
  const message = sig.subarray(0, 2).toString() === 'ED' ? createHash('blake2b512').update(data).digest() : data;
  if (!verify(null, message, publicKey, sig.subarray(10, 74))) return 'the signature doesn\'t match the file';
  // The trusted comment is signed too, together with the signature.
  const trusted = line(encoded, 2).replace(/^trusted comment: /, '');
  if (!verify(null, Buffer.concat([sig.subarray(10, 74), Buffer.from(trusted)]), publicKey, Buffer.from(line(encoded, 3), 'base64'))) return "the signature's comment doesn't match";
  // "timestamp:…<tab>file:…<tab>version:0.2.0": the version the file was signed for.
  const signedVersion = /(?:^|\t)version:([^\t]+)/.exec(trusted)?.[1];
  if (expectedVersion && signedVersion !== expectedVersion) return signedVersion ? `signed for version ${signedVersion}, not ${expectedVersion}` : `not bound to a version (sign with --app-version ${expectedVersion})`;
  return null;
}

const files = await readdir(folder);

if (verifyOnly) {
  const signed = files.filter((f) => f.endsWith('.sig'));
  let bad = signed.length === 0;
  if (bad) console.error('No .sig files: was TAURI_SIGNING_PRIVATE_KEY set for the build?');
  for (const sigFile of signed) {
    const file = sigFile.slice(0, -'.sig'.length);
    const problem = await signatureProblem(join(folder, file), join(folder, sigFile));
    console.log(`${problem ? '✗' : '✓'} ${file}${problem ? `: ${problem}` : ': signed with the key the app expects'}`);
    bad ||= !!problem;
  }
  process.exit(bad ? 1 : 0);
}
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
  const problem = await signatureProblem(join(folder, file), join(folder, `${file}.sig`));
  if (problem) {
    problems.push(`${file}: ${problem}. Is TAURI_SIGNING_PRIVATE_KEY the private half of the public key in tauri.conf.json?`);
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
