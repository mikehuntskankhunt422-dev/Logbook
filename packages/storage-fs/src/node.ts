import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';
import { assertRelativePath, type FsBackend } from './backend.ts';

/** FsBackend on Node's file system: for tests and scripts. The desktop app uses its Rust twin. */
export class NodeFsBackend implements FsBackend {
  constructor(readonly root: string) {}

  private abs(path: string): string {
    assertRelativePath(path);
    return join(this.root, ...path.split('/'));
  }

  async read(path: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    try {
      const buf = await readFile(this.abs(path));
      return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    } catch (err) {
      if (isMissing(err)) return undefined;
      throw err;
    }
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const target = this.abs(path);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.logbook-tmp-${randomBytes(4).toString('hex')}`;
    try {
      await writeFile(tmp, data, { flush: true });
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const target = this.abs(to);
    await mkdir(dirname(target), { recursive: true });
    await rename(this.abs(from), target);
  }

  async remove(path: string): Promise<void> {
    await rm(this.abs(path), { force: true });
  }

  async list(dir: string): Promise<string[]> {
    try {
      const found = await readdir(this.abs(dir), { recursive: true, withFileTypes: true });
      return found.filter((d) => d.isFile()).map((d) => relative(this.root, join(d.parentPath, d.name)).split(sep).join('/'));
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
  }
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}
