import { useEffect, useSyncExternalStore } from 'react';
import { FONTS, cleanFamily, fontMime, readFontInfo, type Journal, type MediaMeta } from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';

/**
 * Fonts of your own (D107): added in Settings → Appearance, kept in the journal (so they travel
 * with its folder and its backups, locked with its passcode), and put into the page while the
 * journal is open, from their bytes rather than a web address, so the window's security policy has
 * nothing to let in.
 */

export interface CustomFont {
  family: string;
  /** Each file of the family (Regular, Bold, Italic…), lightest first. */
  faces: MediaMeta[];
}

/** Every font of your own, by family (the same family in any capitals), A to Z. */
export async function listFonts(journal: Journal): Promise<CustomFont[]> {
  const families = new Map<string, CustomFont>();
  for (const m of await journal.listFontMeta()) {
    if (!m.font) continue;
    const key = m.font.family.toLowerCase();
    const found = families.get(key) ?? { family: m.font.family, faces: [] };
    found.faces.push(m);
    families.set(key, found);
  }
  for (const f of families.values()) f.faces.sort((a, b) => a.font!.weight - b.font!.weight || a.font!.style.localeCompare(b.font!.style));
  return [...families.values()].sort((a, b) => a.family.localeCompare(b.family));
}

/**
 * Adds a font file and gives its family. The browser checks the whole file before anything is kept
 * (a file that isn't a font, or a damaged one, can't be used, so it's refused with a note). A file
 * of a face already there (same family, weight and style) takes its place.
 */
export async function addFont(journal: Journal, file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    await new FontFace('Logbook font check', bytes).load();
  } catch {
    throw new Error(`${file.name} isn’t a font Logbook can use. TrueType (.ttf), OpenType (.otf), WOFF and WOFF2 files work.`);
  }
  const info = await readFontInfo(bytes, file.name);
  // Logbook's own font names stay Logbook's.
  if (FONTS.some((f) => f.family.toLowerCase() === info.family.toLowerCase())) info.family = cleanFamily(`My ${info.family}`);
  const replaced = (await listFonts(journal))
    .find((f) => f.family.toLowerCase() === info.family.toLowerCase())
    ?.faces.filter((m) => m.font!.weight === info.weight && m.font!.style === info.style);
  const mime = fontMime(bytes) || file.type || 'application/octet-stream';
  await journal.addMedia(new Blob([bytes], { type: mime }), { name: file.name, mime, font: info });
  for (const m of replaced ?? []) await journal.deleteMedia(m.id);
  return info.family;
}

/** Removes every file of a family. Words set in it go back to the journal font. */
export async function removeFont(journal: Journal, font: CustomFont): Promise<void> {
  for (const m of font.faces) await journal.deleteMedia(m.id);
  if (journal.getSettings().writingFont.toLowerCase() === font.family.toLowerCase()) await journal.updateSettings({ writingFont: '' });
}

// The fonts in the page, shared by every menu that lists them.
let fonts: CustomFont[] = [];
const listeners = new Set<() => void>();
const inPage = new Map<string, FontFace>();

function publish(next: CustomFont[]) {
  fonts = next;
  for (const l of listeners) l();
}

/** The fonts of your own, for menus; empty while the journal is locked. */
export function useCustomFonts(): CustomFont[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => fonts,
    () => fonts,
  );
}

/** Keeps the page's fonts in step with the journal's, once for the whole app; none while it's locked. */
export function useFontLoader(): void {
  const { journal, locked } = useJournal();
  useEffect(() => {
    if (locked) return;
    let alive = true;
    // One pass at a time, so a face is never put in twice.
    let queue = Promise.resolve();
    const sync = async () => {
      const next = await listFonts(journal);
      if (!alive) return;
      const wanted = new Map(next.flatMap((f) => f.faces).map((m) => [m.id, m]));
      for (const [id, face] of inPage) {
        if (!wanted.has(id)) {
          document.fonts.delete(face);
          inPage.delete(id);
        }
      }
      for (const [id, m] of wanted) {
        if (inPage.has(id)) continue;
        const blob = await journal.getMediaBlob(id);
        if (!alive || !blob) continue;
        const face = new FontFace(m.font!.family, await blob.arrayBuffer(), { weight: String(m.font!.weight), style: m.font!.style, display: 'swap' });
        try {
          await face.load();
        } catch {
          // Damaged since it was added: the text falls back to the journal font.
          continue;
        }
        if (!alive) return;
        document.fonts.add(face);
        inPage.set(id, face);
      }
      publish(next);
    };
    const resync = () => (queue = queue.then(sync).catch(() => {}));
    resync();
    const off = journal.subscribe((e) => (e === 'media' || e === 'external') && resync());
    return () => {
      alive = false;
      off();
      for (const face of inPage.values()) document.fonts.delete(face);
      inPage.clear();
      publish([]);
    };
  }, [journal, locked]);
}
