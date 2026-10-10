import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SearchIndex, type Entry, type Journal, type Settings } from '@logbook/core';
import { requestPersistentStorage } from '@logbook/storage-idb';
import { isDesktop } from '../lib/platform.ts';

interface JournalCtx {
  journal: Journal;
  entries: Entry[];
  locked: boolean;
  settings: Settings;
  search: SearchIndex;
  loaded: boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<JournalCtx | null>(null);

export function JournalProvider({ journal, children }: { journal: Journal; children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [locked, setLocked] = useState(journal.isLocked);
  const [settings, setSettings] = useState(journal.getSettings());
  const [loaded, setLoaded] = useState(false);
  const search = useRef(new SearchIndex()).current;
  const askedPersist = useRef(false);

  const reload = useCallback(async () => {
    setLocked(journal.isLocked);
    if (journal.isLocked) {
      setEntries([]);
      search.rebuild([]);
      setLoaded(true);
      return;
    }
    const list = await journal.listEntries();
    search.rebuild(list);
    setEntries(list);
    setLoaded(true);
  }, [journal, search]);

  useEffect(() => {
    void reload();
    return journal.subscribe((event) => {
      if (event === 'settings') setSettings(journal.getSettings());
      if (event === 'entries' || event === 'lock') {
        void reload();
        if (event === 'entries' && !askedPersist.current && !isDesktop) {
          // Browsers grant persistence more readily once the site holds real user data.
          askedPersist.current = true;
          void requestPersistentStorage();
        }
      }
    });
  }, [journal, reload]);

  const value = useMemo(() => ({ journal, entries, locked, settings, search, loaded, reload }), [journal, entries, locked, settings, search, loaded, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useJournal(): JournalCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useJournal outside JournalProvider');
  return v;
}

/**
 * Object URL for a media item, decrypted on demand and revoked when no component uses it.
 * Shared across components so the same photo isn't decrypted twice.
 */
const urlCache = new Map<string, { url: Promise<string | null>; refs: number }>();

export function useMediaUrl(mediaId: string | undefined | null): string | null {
  const { journal, locked } = useJournal();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!mediaId || locked) {
      setUrl(null);
      return;
    }
    let slot = urlCache.get(mediaId);
    if (!slot) {
      slot = {
        url: journal.getMediaBlob(mediaId).then((b) => (b ? URL.createObjectURL(b) : null)),
        refs: 0,
      };
      urlCache.set(mediaId, slot);
    }
    slot.refs++;
    let alive = true;
    void slot.url.then((u) => alive && setUrl(u));
    return () => {
      alive = false;
      const s = urlCache.get(mediaId);
      if (s && --s.refs <= 0) {
        urlCache.delete(mediaId);
        void s.url.then((u) => u && URL.revokeObjectURL(u));
      }
    };
  }, [journal, mediaId, locked]);
  return url;
}

export function clearMediaUrlCache(): void {
  for (const [, s] of urlCache) void s.url.then((u) => u && URL.revokeObjectURL(u));
  urlCache.clear();
}
