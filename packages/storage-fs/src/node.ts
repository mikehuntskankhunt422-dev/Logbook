import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { FileInfo, JournalFs } from './fs.ts';

/** `JournalFs` on Node's `fs`, for tests and scripts. Paths outside the folder are refused. */
export class NodeJournalFs implements JournalFs {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private abs(path: string): string {
    const abs = resolve(this.root, path);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) throw new Error(`Outside the journal folder: ${path}`);
    return abs;
  }

  async list(): Promise<FileInfo[]> {
    const out: FileInfo[] = [];
    const walk = async (dir: string) => {
      let items;
      try {
        items = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw err;
      }
      for (const item of items) {
        const abs = join(dir, item.name);
        if (item.isDirectory()) await walk(abs);
        else if (item.isFile()) {
          const s = await stat(abs).catch(() => null);
          if (s) out.push({ path: relative(this.root, abs).split(sep).join('/'), size: s.size, mtimeMs: s.mtimeMs });
        }
      }
    };
    await walk(this.root);
    return out;
  }

  async readTexts(paths: string[]): Promise<(string | null)[]> {
    return Promise.all(paths.map((p) => readFile(this.abs(p), 'utf8').catch(missing)));
  }

  async readBytes(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const buf = await readFile(this.abs(path)).catch(missing);
    return buf ? new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer) : null;
  }

  async writeFile(path: string, data: string | Uint8Array<ArrayBuffer>): Promise<void> {
    const abs = this.abs(path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);
  }

  async rename(from: string, to: string): Promise<void> {
    const dest = this.abs(to);
    await mkdir(dirname(dest), { recursive: true });
    await rename(this.abs(from), dest);
  }

  async remove(path: string): Promise<void> {
    await rm(this.abs(path), { force: true });
  }
}

function missing(err: NodeJS.ErrnoException): null {
  if (err.code === 'ENOENT') return null;
  throw err;
}
