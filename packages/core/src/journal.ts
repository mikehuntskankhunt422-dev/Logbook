import { z } from 'zod';
import { createVault, openVault, rewrapVault, type Cipher, type KdfParams, type Vault } from './crypto.ts';
import { addDays, today } from './dates.ts';
import { newId } from './ids.ts';
import {
  DEFAULT_SETTINGS,
  entrySchema,
  mediaMetaSchema,
  referencedMediaIds,
  settingsSchema,
  type Block,
  type Cover,
  type Entry,
  type MediaMeta,
  type Settings,
  GRADIENT_IDS,
} from './model.ts';
import { bookOptionsSchema, type BookOptions } from './print/options.ts';
import { emptyDoc } from './richtext.ts';
import { isSealed, type RecordStore } from './storage.ts';

/** A print order placed from this device: enough to find it again, e.g. on the page Stripe returns to. */
export const bookOrderRefSchema = z.object({
  id: z.string().regex(/^ord_[\w-]{1,40}$/),
  token: z.string().min(16).max(200),
  createdAt: z.string(),
});
export type BookOrderRef = z.infer<typeof bookOrderRefSchema>;
/** Only the most recent orders are kept; older ones can be looked up from their emails (M4). */
export const MAX_BOOK_ORDERS = 20;

/**
 * The passcode was turned off, on, or changed somewhere else (another computer sharing the journal
 * folder, or another window) since this window read it. Sealing with the old key would make the
 * entry unreadable, so the write is refused until Logbook is restarted.
 */
export class VaultChangedError extends Error {
  constructor() {
    super('The passcode was changed on another computer or in another window. Restart Logbook to keep writing.');
    this.name = 'VaultChangedError';
  }
}

export class LockedError extends Error {
  constructor() {
    super('The journal is locked.');
    this.name = 'LockedError';
  }
}

export const TRASH_RETENTION_DAYS = 30;

export type JournalEvent = 'entries' | 'media' | 'settings' | 'lock';

export interface LoadIssue {
  id: string;
  problem: string;
}

/**
 * The one place that reads and writes journal data. UI code talks to this, never to a RecordStore.
 * Handles schema validation, revisions, soft delete, media garbage collection and passcode encryption.
 */
export class Journal {
  private cipher: Cipher | null = null;
  private vault: Vault | undefined;
  private settings: Settings = DEFAULT_SETTINGS;
  private listeners = new Set<(e: JournalEvent) => void>();
  /** Records that failed validation on the last load; surfaced in Settings rather than silently dropped. */
  issues: LoadIssue[] = [];

  private constructor(readonly store: RecordStore) {}

  static async open(store: RecordStore): Promise<Journal> {
    const j = new Journal(store);
    j.vault = await store.getKey('vault');
    const raw = await store.getKey('settings');
    const parsed = settingsSchema.safeParse(raw ?? {});
    j.settings = parsed.success ? parsed.data : DEFAULT_SETTINGS;
    return j;
  }

  // ── events ────────────────────────────────────────────────────────────────────────────────────

  subscribe(fn: (e: JournalEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: JournalEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  // ── encryption ────────────────────────────────────────────────────────────────────────────────

  get isEncrypted(): boolean {
    return this.vault !== undefined;
  }
  get isLocked(): boolean {
    return this.isEncrypted && this.cipher === null;
  }

  async unlock(passcode: string): Promise<void> {
    if (!this.vault) return;
    // Another computer may have turned the passcode off or changed it while this one was locked.
    const stored = await this.store.getKey('vault');
    if (!stored) {
      this.vault = undefined;
      this.cipher = null;
      this.emit('lock');
      return;
    }
    this.cipher = await openVault(stored, passcode);
    this.vault = stored;
    this.emit('lock');
  }

  /** The cipher to seal with, after checking the stored vault is still the one it came from. */
  private async sealer(): Promise<Cipher> {
    const stored = await this.store.getKey('vault');
    if (!this.cipher || JSON.stringify(stored) !== JSON.stringify(this.vault)) throw new VaultChangedError();
    return this.cipher;
  }

  lock(): void {
    if (!this.isEncrypted) return;
    this.cipher = null;
    this.emit('lock');
  }

  private assertUnlocked(): void {
    if (this.isLocked) throw new LockedError();
  }

  /**
   * Encrypts everything in place. The vault is written first, so if the process dies midway the
   * journal is "encrypted with some records still plaintext", which reads correctly, rather than
   * "ciphertext with no key", which would lose data.
   */
  async enableEncryption(passcode: string, kdf?: Omit<KdfParams, 'salt'>): Promise<void> {
    this.assertUnlocked();
    if (this.vault) throw new Error('A passcode is already set.');
    const { vault, cipher } = await createVault(passcode, kdf);
    await this.store.setKey('vault', vault);
    this.vault = vault;
    this.cipher = cipher;
    await this.rewriteAll();
    this.emit('lock');
  }

  async disableEncryption(passcode: string): Promise<void> {
    if (!this.vault) return;
    const cipher = await openVault(this.vault, passcode); // throws WrongPasscodeError
    // On a shared folder, include what other computers wrote since this one last looked.
    await this.store.refresh?.();
    this.cipher = cipher;
    const entries = await this.readAllEntries(true);
    const media = await this.listMediaMeta();
    const draft = await this.getBookDraft();
    const orders = await this.listBookOrders();
    const blobs = new Map<string, Blob>();
    for (const m of media) {
      const b = await this.getMediaBlob(m.id);
      if (b) blobs.set(m.id, b);
    }
    this.cipher = null;
    const vault = this.vault;
    this.vault = undefined;
    try {
      for (const e of entries) await this.store.put('entries', e);
      for (const m of media) await this.store.put('media', m);
      for (const [id, b] of blobs) await this.store.putBlob(id, b);
      await this.store.setKey('bookDraft', draft);
      await this.store.setKey('bookOrders', orders.length ? orders : undefined);
      // Never drop the key while anything is still sealed with it (a file that arrived meanwhile,
      // or one this passcode can't open): it would stay unreadable for good.
      await this.store.refresh?.();
      const left = [...(await this.store.all('entries')), ...(await this.store.all('media'))].filter(isSealed).length;
      if (left) {
        throw new Error(
          `${left} ${left === 1 ? 'entry or photo is' : 'entries or photos are'} still encrypted (just synced from another computer, or locked with a different passcode). The passcode stays on; try again in a moment.`,
        );
      }
      await this.store.setKey('vault', undefined);
    } catch (err) {
      this.vault = vault;
      this.cipher = cipher;
      throw err;
    }
    this.emit('lock');
  }

  async changePasscode(oldPasscode: string, newPasscode: string): Promise<void> {
    if (!this.vault) throw new Error('No passcode is set.');
    const vault = await rewrapVault(this.vault, oldPasscode, newPasscode);
    await this.store.setKey('vault', vault);
    this.vault = vault;
  }

  /** Re-saves every record through the current cipher (used after enabling encryption). */
  private async rewriteAll(): Promise<void> {
    const draft = await this.getBookDraft();
    if (draft) await this.saveBookDraft(draft);
    const orders = await this.listBookOrders();
    if (orders.length) await this.writeBookOrders(orders);
    for (const e of await this.readAllEntries(true)) await this.writeEntry(e);
    for (const m of await this.listMediaMeta()) {
      const blob = await this.getMediaBlob(m.id);
      await this.writeMediaMeta(m);
      if (blob) await this.writeBlob(m.id, blob);
    }
  }

  // ── book draft ────────────────────────────────────────────────────────────────────────────────

  /**
   * The book builder's last settings (D40). Kept out of Settings, which are stored and backed up in
   * plain text: a draft holds a title, back-cover text and chosen entries, so it's sealed like an
   * entry when a passcode is on. Not included in backups.
   */
  async getBookDraft(): Promise<BookOptions | undefined> {
    this.assertUnlocked();
    const rec = await this.store.getKey('bookDraft');
    if (rec === undefined) return undefined;
    try {
      const raw = isSealed(rec) ? await this.cipher!.openJson<unknown>('book', rec) : rec;
      const parsed = bookOptionsSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  async saveBookDraft(draft: BookOptions): Promise<void> {
    this.assertUnlocked();
    const value = bookOptionsSchema.parse(draft);
    await this.store.setKey('bookDraft', this.cipher ? await (await this.sealer()).sealJson('book', 'draft', value) : value);
  }

  // ── print orders ──────────────────────────────────────────────────────────────────────────────

  /**
   * Orders placed from this device, newest first. Each token opens that order's proof (journal
   * content), so the list is sealed like an entry when a passcode is on, and isn't backed up.
   */
  async listBookOrders(): Promise<BookOrderRef[]> {
    this.assertUnlocked();
    const rec = await this.store.getKey('bookOrders');
    if (rec === undefined) return [];
    try {
      const raw = isSealed(rec) ? await this.cipher!.openJson<unknown>('book', rec) : rec;
      const parsed = z.array(bookOrderRefSchema).safeParse(raw);
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }

  async getBookOrder(id: string): Promise<BookOrderRef | undefined> {
    return (await this.listBookOrders()).find((o) => o.id === id);
  }

  async saveBookOrder(order: BookOrderRef): Promise<void> {
    const ref = bookOrderRefSchema.parse(order);
    const rest = (await this.listBookOrders()).filter((o) => o.id !== ref.id);
    await this.writeBookOrders([ref, ...rest].slice(0, MAX_BOOK_ORDERS));
  }

  private async writeBookOrders(orders: BookOrderRef[]): Promise<void> {
    await this.store.setKey('bookOrders', this.cipher ? await (await this.sealer()).sealJson('book', 'orders', orders) : orders);
  }

  // ── settings ──────────────────────────────────────────────────────────────────────────────────

  getSettings(): Settings {
    return this.settings;
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    this.settings = settingsSchema.parse({ ...this.settings, ...patch });
    await this.store.setKey('settings', this.settings);
    this.emit('settings');
    return this.settings;
  }

  async markBackedUp(at = new Date().toISOString()): Promise<void> {
    await this.updateSettings({ lastBackupAt: at, changesSinceBackup: 0, firstUnbackedChangeAt: null, backupSnoozedUntil: null });
  }

  /**
   * Gentle and time-based (autosave makes "number of changes" meaningless): never backed up → after
   * two days of unbacked changes; otherwise once the last backup is older than `backupReminderDays`
   * and something changed since.
   */
  needsBackupReminder(now = new Date()): boolean {
    const s = this.settings;
    if (s.changesSinceBackup === 0 || !s.firstUnbackedChangeAt) return false;
    if (s.backupSnoozedUntil && new Date(s.backupSnoozedUntil) > now) return false;
    const days = (iso: string) => (now.getTime() - new Date(iso).getTime()) / 86_400_000;
    if (!s.lastBackupAt) return days(s.firstUnbackedChangeAt) >= 2;
    return days(s.lastBackupAt) >= s.backupReminderDays;
  }

  private async countChange(): Promise<void> {
    this.settings = {
      ...this.settings,
      changesSinceBackup: this.settings.changesSinceBackup + 1,
      firstUnbackedChangeAt: this.settings.firstUnbackedChangeAt ?? new Date().toISOString(),
    };
    await this.store.setKey('settings', this.settings);
    this.emit('settings');
  }

  // ── entries ───────────────────────────────────────────────────────────────────────────────────

  private async readAllEntries(includeDeleted: boolean): Promise<Entry[]> {
    this.assertUnlocked();
    const out: Entry[] = [];
    const issues: LoadIssue[] = [];
    for (const rec of await this.store.all('entries')) {
      try {
        const raw = isSealed(rec) ? await this.cipher!.openJson<unknown>('entry', rec) : rec;
        const parsed = entrySchema.safeParse(raw);
        if (!parsed.success) {
          issues.push({ id: rec.id, problem: parsed.error.issues[0]?.message ?? 'invalid entry' });
          continue;
        }
        if (includeDeleted || !parsed.data.deletedAt) out.push(parsed.data);
      } catch {
        issues.push({ id: rec.id, problem: 'could not be decrypted' });
      }
    }
    this.issues = issues;
    return out.sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
  }

  /** Live entries, newest date first. */
  listEntries(): Promise<Entry[]> {
    return this.readAllEntries(false);
  }

  async listTrash(): Promise<Entry[]> {
    return (await this.readAllEntries(true)).filter((e) => e.deletedAt);
  }

  async getEntry(id: string): Promise<Entry | undefined> {
    this.assertUnlocked();
    const rec = await this.store.get('entries', id);
    if (!rec) return undefined;
    const raw = isSealed(rec) ? await this.cipher!.openJson<unknown>('entry', rec) : rec;
    return entrySchema.parse(raw);
  }

  newEntry(init: Partial<Pick<Entry, 'date' | 'title' | 'mood' | 'cover' | 'tags' | 'blocks'>> = {}): Entry {
    const now = new Date().toISOString();
    const cover: Cover = init.cover ?? {
      kind: 'gradient',
      gradient: GRADIENT_IDS[Math.floor(Math.random() * GRADIENT_IDS.length)]!,
    };
    const blocks: Block[] = init.blocks ?? [{ id: newId(), type: 'text', doc: emptyDoc() }];
    return entrySchema.parse({
      id: newId(),
      date: init.date ?? today(),
      title: init.title ?? '',
      mood: init.mood ?? null,
      cover,
      tags: init.tags ?? [],
      blocks,
      createdAt: now,
      updatedAt: now,
      rev: 0,
      deletedAt: null,
    });
  }

  private async writeEntry(entry: Entry): Promise<void> {
    const rec = this.cipher ? await (await this.sealer()).sealJson('entry', entry.id, entry) : entry;
    await this.store.put('entries', rec);
  }

  /**
   * Validates, bumps the revision and persists. If `expectedRev` is given and the stored revision
   * moved on (another tab, or a synced file on desktop), throws so the caller can merge instead of
   * silently overwriting.
   */
  async saveEntry(entry: Entry, opts: { expectedRev?: number } = {}): Promise<Entry> {
    this.assertUnlocked();
    if (opts.expectedRev !== undefined) {
      const current = await this.getEntry(entry.id);
      if (current && current.rev !== opts.expectedRev) {
        throw new ConflictError(entry.id, current);
      }
    }
    const tags = [...new Set(entry.tags.map((t) => normalizeTag(t)).filter(Boolean))];
    const saved = entrySchema.parse({ ...entry, tags, rev: entry.rev + 1, updatedAt: new Date().toISOString() });
    await this.writeEntry(saved);
    await this.countChange();
    this.emit('entries');
    return saved;
  }

  async trashEntry(id: string): Promise<void> {
    const e = await this.getEntry(id);
    if (!e || e.deletedAt) return;
    await this.saveEntry({ ...e, deletedAt: new Date().toISOString() });
  }

  async restoreEntry(id: string): Promise<void> {
    const e = await this.getEntry(id);
    if (!e?.deletedAt) return;
    await this.saveEntry({ ...e, deletedAt: null });
  }

  /** Permanent: removes the entry and any media no other entry uses. */
  async purgeEntry(id: string): Promise<void> {
    this.assertUnlocked();
    await this.store.delete('entries', id);
    await this.countChange();
    await this.collectGarbage();
    this.emit('entries');
  }

  async purgeExpiredTrash(now = new Date()): Promise<number> {
    const cutoff = addDays(now.toISOString().slice(0, 10), -TRASH_RETENTION_DAYS);
    let n = 0;
    for (const e of await this.listTrash()) {
      if (e.deletedAt && e.deletedAt.slice(0, 10) < cutoff) {
        await this.store.delete('entries', e.id);
        n++;
      }
    }
    if (n) {
      await this.collectGarbage();
      this.emit('entries');
    }
    return n;
  }

  // ── media ─────────────────────────────────────────────────────────────────────────────────────

  async addMedia(
    blob: Blob,
    info: { name: string; mime?: string; width?: number; height?: number; durationMs?: number; derivedFrom?: string },
  ): Promise<MediaMeta> {
    this.assertUnlocked();
    const meta = mediaMetaSchema.parse({
      id: newId(),
      name: info.name.slice(0, 255) || 'untitled',
      mime: info.mime || blob.type || 'application/octet-stream',
      bytes: blob.size,
      width: info.width,
      height: info.height,
      durationMs: info.durationMs,
      derivedFrom: info.derivedFrom,
      createdAt: new Date().toISOString(),
    });
    await this.writeBlob(meta.id, blob);
    await this.writeMediaMeta(meta);
    this.emit('media');
    return meta;
  }

  async updateMediaMeta(meta: MediaMeta): Promise<void> {
    this.assertUnlocked();
    await this.writeMediaMeta(mediaMetaSchema.parse(meta));
    this.emit('media');
  }

  private async writeMediaMeta(meta: MediaMeta): Promise<void> {
    const rec = this.cipher ? await (await this.sealer()).sealJson('media', meta.id, meta) : meta;
    await this.store.put('media', rec);
  }

  private async writeBlob(id: string, blob: Blob): Promise<void> {
    if (!this.cipher) return this.store.putBlob(id, blob);
    const sealed = await (await this.sealer()).sealBytes(id, new Uint8Array(await blob.arrayBuffer()));
    await this.store.putBlob(id, new Blob([sealed], { type: 'application/octet-stream' }));
  }

  async getMediaMeta(id: string): Promise<MediaMeta | undefined> {
    this.assertUnlocked();
    const rec = await this.store.get('media', id);
    if (!rec) return undefined;
    return mediaMetaSchema.parse(isSealed(rec) ? await this.cipher!.openJson('media', rec) : rec);
  }

  async listMediaMeta(): Promise<MediaMeta[]> {
    this.assertUnlocked();
    const out: MediaMeta[] = [];
    for (const rec of await this.store.all('media')) {
      const parsed = mediaMetaSchema.safeParse(isSealed(rec) ? await this.cipher!.openJson('media', rec) : rec);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }

  /** Decrypted blob with the original MIME type, or undefined if missing. */
  async getMediaBlob(id: string): Promise<Blob | undefined> {
    this.assertUnlocked();
    const blob = await this.store.getBlob(id);
    if (!blob) return undefined;
    const meta = await this.getMediaMeta(id);
    const type = meta?.mime ?? blob.type;
    if (!this.cipher) return blob.type === type ? blob : new Blob([blob], { type });
    const bytes = await this.cipher.openBytes(id, new Uint8Array(await blob.arrayBuffer()));
    return new Blob([bytes], { type });
  }

  async deleteMedia(id: string): Promise<void> {
    await this.store.delete('media', id);
    await this.store.deleteBlob(id);
    this.emit('media');
  }

  /**
   * Deletes media that no entry (including trashed ones) references, plus their derived files.
   * Not on a folder journal (D85): there the entries this computer can see are never known to be
   * all of them (a sync still arriving, a conflict copy, a file another computer just moved), and
   * deleting a photo some unseen entry uses would delete it on every computer.
   */
  async collectGarbage(): Promise<number> {
    if (this.store.kind === 'filesystem') return 0;
    const used = new Set<string>();
    for (const e of await this.readAllEntries(true)) for (const id of referencedMediaIds(e)) used.add(id);
    const all = await this.listMediaMeta();
    for (const m of all) if (used.has(m.id) && m.posterId) used.add(m.posterId);
    let removed = 0;
    for (const m of all) {
      const parentUsed = m.derivedFrom !== undefined && used.has(m.derivedFrom);
      if (!used.has(m.id) && !parentUsed) {
        await this.deleteMedia(m.id);
        removed++;
      }
    }
    return removed;
  }

  /** Wipes entries and media. Passcode and settings stay as they are. */
  async clearContent(): Promise<void> {
    this.assertUnlocked();
    await this.store.clearContent();
    await this.store.setKey('bookDraft', undefined);
    await this.store.setKey('bookOrders', undefined);
    await this.updateSettings({ changesSinceBackup: 0 });
    this.emit('entries');
    this.emit('media');
  }

  /** Writes an entry exactly as given (no revision bump). Used by backup import. */
  async importEntry(entry: Entry): Promise<void> {
    this.assertUnlocked();
    await this.writeEntry(entrySchema.parse(entry));
  }

  /** Writes media with its original id. Used by backup import. */
  async importMedia(meta: MediaMeta, blob: Blob): Promise<void> {
    this.assertUnlocked();
    const parsed = mediaMetaSchema.parse(meta);
    await this.writeBlob(parsed.id, blob);
    await this.writeMediaMeta(parsed);
  }

  /** Call after a batch of importEntry/importMedia so views refresh once. */
  notifyImported(): void {
    this.emit('entries');
    this.emit('media');
  }

  getVault(): Vault | undefined {
    return this.vault;
  }
}

export class ConflictError extends Error {
  constructor(
    readonly id: string,
    readonly current: Entry,
  ) {
    super('This entry was changed somewhere else.');
    this.name = 'ConflictError';
  }
}

export function normalizeTag(t: string): string {
  return t.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase().slice(0, 40);
}
