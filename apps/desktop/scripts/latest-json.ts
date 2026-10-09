import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

/**
 * Writes the updater's `latest.json` (M5 §2.6) from a release's files and their `.sig` signatures.
 *
 * The updater plugin looks for `{os}-{arch}-{installer}` first, then `{os}-{arch}` (ASSUMPTIONS,
 * Desktop), so every installer gets its own key and the usual one per OS also gets the plain key:
 * the AppImage on Linux, the NSIS installer on Windows, the app archive on macOS. A universal macOS
 * archive serves both Apple Silicon and Intel. The plugin validates the whole file, so every entry
 * is complete or the script fails.
 *
 *   node scripts/latest-json.ts --dir release --version 0.1.0 \
 *     --base-url https://github.com/<owner>/<repo>/releases/download/v0.1.0 [--notes "…"] [--out latest.json]
 */

export interface ReleaseFile {
  name: string;
  /** The content of `<name>.sig`. */
  signature: string;
}

export interface LatestJson {
  version: string;
  notes?: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
}

interface Kind {
  test: RegExp;
  os: 'linux' | 'windows' | 'darwin';
  installer: string;
  /** Also the plain `{os}-{arch}` entry. */
  primary: boolean;
}

const KINDS: Kind[] = [
  { test: /\.AppImage$/, os: 'linux', installer: 'appimage', primary: true },
  { test: /\.deb$/, os: 'linux', installer: 'deb', primary: false },
  { test: /\.rpm$/, os: 'linux', installer: 'rpm', primary: false },
  { test: /-setup\.exe$/, os: 'windows', installer: 'nsis', primary: true },
  { test: /\.msi$/, os: 'windows', installer: 'msi', primary: false },
  { test: /\.app\.tar\.gz$/, os: 'darwin', installer: 'app', primary: true },
];

/** The architectures a file is for, from the names Tauri gives its bundles. */
export function archesOf(name: string): string[] {
  if (/[_.-]universal[_.-]/.test(name)) return ['aarch64', 'x86_64'];
  if (/[_.-](amd64|x86_64|x64)[_.-]/.test(name)) return ['x86_64'];
  if (/[_.-](arm64|aarch64)[_.-]/.test(name)) return ['aarch64'];
  if (/[_.-](i686|x86)[_.-]/.test(name)) return ['i686'];
  throw new Error(`Can't tell which processor ${name} is for.`);
}

export function latestJson(opts: { version: string; baseUrl: string; files: ReleaseFile[]; notes?: string; pubDate?: Date }): LatestJson {
  if (!/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(opts.version)) throw new Error(`Not a SemVer version: ${opts.version}`);
  const platforms: LatestJson['platforms'] = {};
  const base = opts.baseUrl.replace(/\/+$/, '');
  for (const file of opts.files) {
    const kind = KINDS.find((k) => k.test.test(file.name));
    if (!kind) throw new Error(`${file.name} isn't an installer the updater knows.`);
    const signature = file.signature.trim();
    if (!signature) throw new Error(`${file.name}.sig is empty.`);
    if (!file.name.includes(opts.version.replace(/^v/, ''))) throw new Error(`${file.name} doesn't carry version ${opts.version}.`);
    const entry = { signature, url: `${base}/${encodeURIComponent(file.name)}` };
    for (const arch of archesOf(file.name)) {
      const keys = [`${kind.os}-${arch}-${kind.installer}`, ...(kind.primary ? [`${kind.os}-${arch}`] : [])];
      for (const key of keys) {
        if (platforms[key]) throw new Error(`Two files for ${key}: ${file.name} and ${platforms[key].url}`);
        platforms[key] = entry;
      }
    }
  }
  if (!Object.keys(platforms).length) throw new Error('No signed installers: was the release built with TAURI_SIGNING_PRIVATE_KEY?');
  return {
    version: opts.version.replace(/^v/, ''),
    ...(opts.notes ? { notes: opts.notes } : {}),
    pub_date: (opts.pubDate ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms: Object.fromEntries(Object.entries(platforms).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** Every `<file>.sig` in `dir` whose file is there too. */
export function signedFiles(dir: string): ReleaseFile[] {
  const names = new Set(readdirSync(dir));
  return [...names]
    .filter((n) => n.endsWith('.sig'))
    .map((sig) => {
      const name = sig.slice(0, -4);
      if (!names.has(name)) throw new Error(`${sig} has no ${name} beside it.`);
      return { name, signature: readFileSync(join(dir, sig), 'utf8') };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, version: { type: 'string' }, 'base-url': { type: 'string' }, notes: { type: 'string' }, out: { type: 'string' } } });
  if (!values.dir || !values.version || !values['base-url']) {
    console.error('Usage: node scripts/latest-json.ts --dir <release files> --version <x.y.z> --base-url <download URL> [--notes <text>] [--out <file>]');
    process.exit(2);
  }
  const json = JSON.stringify(latestJson({ version: values.version, baseUrl: values['base-url'], notes: values.notes, files: signedFiles(values.dir) }), null, 2);
  if (values.out) writeFileSync(values.out, `${json}\n`);
  else console.log(json);
}
