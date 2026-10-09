import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { launch } from '../e2e/driver.ts';
import { latestJson } from './latest-json.ts';

/**
 * The updater end to end on Linux (M5 §2.6): a throwaway key pair, a 0.1.0 and a 0.1.1 AppImage
 * built with it, `latest.json` served from this machine, and the real 0.1.0 app driven through
 * WebDriver to find, verify and install 0.1.1. Then the same with a tampered download, and (when
 * signatures carry their version) with an old signature replayed as a newer version: both must be
 * refused and leave the app as it was.
 *
 *   npm run updater:check -w @logbook/desktop      (needs a display or xvfb-run, tauri-driver, WebKitWebDriver)
 *
 * The key is made in a temporary folder and deleted at the end; nothing here touches the release key.
 */

const desktop = resolve(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'logbook-updater-'));
const releaseDir = join(work, 'release');
mkdirSync(releaseDir);
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const step = (s: string) => console.log(`\n▶ ${s}`);

const served: string[] = [];
const server = createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? '/').slice(1));
  served.push(name);
  try {
    const body = readFileSync(join(releaseDir, name));
    res.writeHead(200, { 'content-length': body.length, 'content-type': name.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

try {
  step('A throwaway key pair');
  const key = join(work, 'updater.key');
  execFileSync('npx', ['tauri', 'signer', 'generate', '--ci', '-p', '', '-w', key], { cwd: desktop, stdio: 'ignore' });
  const pubkey = readFileSync(`${key}.pub`, 'utf8').trim();

  const build = (version: string, requireSignedVersion: boolean) => {
    const config = {
      version,
      bundle: { createUpdaterArtifacts: true },
      plugins: { updater: { pubkey, endpoints: [`${base}/latest.json`], dangerousInsecureTransportProtocol: true, requireSignedVersion } },
    };
    execFileSync('npx', ['tauri', 'build', '--bundles', 'appimage', '--config', JSON.stringify(config)], {
      cwd: desktop,
      stdio: ['ignore', 'ignore', 'inherit'],
      // Signed like a release, but without link-time optimisation, which only costs minutes here.
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '', CARGO_PROFILE_RELEASE_LTO: 'false', CARGO_PROFILE_RELEASE_CODEGEN_UNITS: '16' },
    });
    return join(desktop, 'src-tauri/target/release/bundle/appimage', `Logbook_${version}_amd64.AppImage`);
  };

  step('Build 0.1.1, the update');
  const built = build('0.1.1', false);
  // Kept aside: the next build empties Tauri's bundle folder.
  const newApp = join(work, 'update-0.1.1.AppImage');
  copyFileSync(built, newApp);
  const signature = readFileSync(`${built}.sig`, 'utf8');
  const trusted = Buffer.from(signature, 'base64').toString('utf8').split('\n').find((l) => l.startsWith('trusted comment:')) ?? '';
  const signsVersion = /\bversion:0\.1\.1\b/.test(trusted);
  console.log(`  ${(statSync(newApp).size / 1e6).toFixed(1)} MB; the signature's ${trusted.replace(/\t/g, ' · ')}`);
  console.log(`  The CLI ${signsVersion ? 'signs the version, so the app is built with requireSignedVersion' : "doesn't sign the version, so requireSignedVersion stays off"}.`);
  const newName = 'Logbook_0.1.1_amd64.AppImage';
  copyFileSync(newApp, join(releaseDir, newName));
  const newSha = sha(newApp);

  step('Build 0.1.0, the installed app');
  const oldApp = join(work, 'Logbook.AppImage');
  copyFileSync(build('0.1.0', signsVersion), oldApp);
  const oldBytes = readFileSync(oldApp);
  const oldSha = sha(oldApp);

  const publish = (version: string) =>
    writeFileSync(join(releaseDir, 'latest.json'), JSON.stringify(latestJson({ version, baseUrl: base, files: [{ name: newName.replace('0.1.1', version), signature }] })));

  // Runs the installed app, asks it to update from Settings, and waits for the outcome.
  const tryUpdate = async (expect: 'installed' | RegExp) => {
    writeFileSync(oldApp, oldBytes);
    process.env.APPIMAGE_EXTRACT_AND_RUN = '1'; // no FUSE in containers
    const app = await launch(mkdtempSync(join(work, 'journal-')), oldApp);
    try {
      await app.go('#/settings');
      await app.text('You have Logbook 0.1.0.', 20_000);
      await app.click(await app.text('Check for updates'));
      await app.text('is ready to install', 20_000);
      await app.click(await app.text('Install and restart'));
      if (expect === 'installed') {
        for (let i = 0; sha(oldApp) !== newSha; i++) {
          if (i > 120) throw new Error('The AppImage was not replaced within 60 s.');
          await sleep(500);
        }
        console.log('  ✔ installed: the AppImage on disk is now 0.1.1, byte for byte');
      } else {
        await app.text("The update wasn't installed", 60_000);
        const shown = await app.exec<string>('return [...document.querySelectorAll(".error")].map((e) => e.textContent).join(" ")');
        if (!expect.test(shown)) throw new Error(`Unexpected message: ${shown}`);
        if (sha(oldApp) !== oldSha) throw new Error('The installed app changed although the update was refused.');
        console.log(`  ✔ refused: “${shown.trim()}”; the installed app is unchanged`);
      }
    } finally {
      await app.close();
    }
  };

  step('A correctly signed update is installed');
  publish('0.1.1');
  await tryUpdate('installed');
  if (!served.includes(newName)) throw new Error('The update was not downloaded from the test server.');

  step('A tampered download is refused');
  writeFileSync(join(releaseDir, newName), Buffer.concat([readFileSync(newApp), Buffer.from('tampered')]));
  await tryUpdate(/signature|verif/i);
  copyFileSync(newApp, join(releaseDir, newName));

  if (signsVersion) {
    step('An old signature announced as a newer version is refused (requireSignedVersion)');
    copyFileSync(newApp, join(releaseDir, newName.replace('0.1.1', '0.1.2')));
    publish('0.1.2');
    await tryUpdate(/version/i);
  }
  console.log('\nThe updater accepts a signed update and refuses the others.');
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}
