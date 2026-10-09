import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archesOf, latestJson, signedFiles } from './latest-json.ts';

const BASE = 'https://github.com/o/r/releases/download/v0.1.0';
const RELEASE = ['Logbook_0.1.0_amd64.AppImage', 'Logbook_0.1.0_amd64.deb', 'Logbook-0.1.0-1.x86_64.rpm', 'Logbook_0.1.0_x64-setup.exe', 'Logbook_0.1.0_x64_en-US.msi', 'Logbook_0.1.0_universal.app.tar.gz'];
const sig = (name: string) => `c2lnbmF0dXJlIG9m-${name}`;

describe('latest.json for the updater', () => {
  it('gives every installer its own key and the usual one per OS the plain key too', () => {
    const json = latestJson({ version: '0.1.0', baseUrl: `${BASE}/`, files: RELEASE.map((name) => ({ name, signature: `${sig(name)}\n` })), notes: 'First desktop release', pubDate: new Date('2026-10-09T08:00:00.123Z') });
    expect(json).toMatchObject({ version: '0.1.0', notes: 'First desktop release', pub_date: '2026-10-09T08:00:00Z' });
    const url = (name: string) => ({ signature: sig(name), url: `${BASE}/${name}` });
    expect(json.platforms).toEqual({
      'darwin-aarch64': url('Logbook_0.1.0_universal.app.tar.gz'),
      'darwin-aarch64-app': url('Logbook_0.1.0_universal.app.tar.gz'),
      'darwin-x86_64': url('Logbook_0.1.0_universal.app.tar.gz'),
      'darwin-x86_64-app': url('Logbook_0.1.0_universal.app.tar.gz'),
      'linux-x86_64': url('Logbook_0.1.0_amd64.AppImage'),
      'linux-x86_64-appimage': url('Logbook_0.1.0_amd64.AppImage'),
      'linux-x86_64-deb': url('Logbook_0.1.0_amd64.deb'),
      'linux-x86_64-rpm': url('Logbook-0.1.0-1.x86_64.rpm'),
      'windows-x86_64': url('Logbook_0.1.0_x64-setup.exe'),
      'windows-x86_64-msi': url('Logbook_0.1.0_x64_en-US.msi'),
      'windows-x86_64-nsis': url('Logbook_0.1.0_x64-setup.exe'),
    });
  });

  it('reads architectures from Tauri’s file names', () => {
    expect(archesOf('Logbook_1.2.3_aarch64.dmg')).toEqual(['aarch64']);
    expect(archesOf('Logbook-1.2.3-1.aarch64.rpm')).toEqual(['aarch64']);
    expect(archesOf('Logbook_1.2.3_x64-setup.exe')).toEqual(['x86_64']);
    expect(() => archesOf('Logbook.app.tar.gz')).toThrow(/processor/);
  });

  it('refuses anything the updater would choke on', () => {
    const one = (name: string, signature = 'abc') => ({ version: '0.1.0', baseUrl: BASE, files: [{ name, signature }] });
    expect(() => latestJson({ ...one('Logbook_0.1.0_amd64.AppImage'), version: 'latest' })).toThrow(/SemVer/);
    expect(() => latestJson(one('Logbook_0.1.0_amd64.AppImage', '  \n'))).toThrow(/empty/);
    expect(() => latestJson(one('Logbook_0.0.9_amd64.AppImage'))).toThrow(/version 0\.1\.0/);
    expect(() => latestJson(one('Logbook_0.1.0_universal.dmg'))).toThrow(/isn't an installer/);
    expect(() => latestJson({ version: '0.1.0', baseUrl: BASE, files: [] })).toThrow(/TAURI_SIGNING_PRIVATE_KEY/);
  });

  it('pairs .sig files with their installers in a folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'latest-json-'));
    try {
      for (const name of ['Logbook_0.1.0_amd64.AppImage', 'Logbook_0.1.0_universal.dmg']) writeFileSync(join(dir, name), 'x');
      writeFileSync(join(dir, 'Logbook_0.1.0_amd64.AppImage.sig'), 'sig-a');
      expect(signedFiles(dir)).toEqual([{ name: 'Logbook_0.1.0_amd64.AppImage', signature: 'sig-a' }]);
      writeFileSync(join(dir, 'Logbook_0.1.0_amd64.deb.sig'), 'orphan');
      expect(() => signedFiles(dir)).toThrow(/no Logbook_0\.1\.0_amd64\.deb beside it/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
