import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { DndContext, PointerSensor, TouchSensor, closestCenter, pointerWithin, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ConflictError,
  GRADIENTS,
  GRADIENT_IDS,
  MOODS,
  STREAK_MILESTONES,
  computeStreak,
  emptyDoc,
  formatBytes,
  mediaKind,
  newId,
  normalizeTag,
  parseEmbedUrl,
  sizeAdvice,
  today,
  type Block,
  type Entry,
} from '@logbook/core';
import { useJournal } from '../app/journal-context.tsx';
import { navigate } from '../app/router.ts';
import { useToast } from '../app/toasts.tsx';
import { canCompressVideo, compressVideo, importFile } from '../lib/media-import.ts';
import { onFlush } from '../lib/pending-saves.ts';
import { celebrate, useReducedMotion } from '../lib/motion.ts';
import { AudioBlock, BLOCK_LABELS, EmbedBlock, FileBlock, GalleryBlock, LinkBlock, PhotoBlock, RichTextBlock, VideoBlock } from './blocks.tsx';
import { Dialog, formatLongDate, useCoverStyle } from './common.tsx';

const SAVE_DELAY_MS = 700;

/** Whatever block is under the pointer wins; blocks vary from 40px of text to 600px of video. */
const pointerFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCenter(args);
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function EntryEditor({ entryId, newDate }: { entryId?: string; newDate?: string }) {
  const { journal, entries } = useJournal();
  const toast = useToast();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const savedRev = useRef<number | null>(null); // null = never saved (new draft)
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<Entry | null>(null);
  latest.current = entry;
  /** The save in progress, so closing the app can wait for it. */
  const saving = useRef<Promise<void>>(Promise.resolve());

  // Load an existing entry, or start a new in-memory draft that is saved on first change.
  useEffect(() => {
    let alive = true;
    // A new draft's first save changes the URL to #/entry/<id>; keep editing in place (no reload, no lost focus).
    if (entryId && latest.current?.id === entryId) return;
    if (entryId) {
      void journal.getEntry(entryId).then((e) => {
        if (!alive) return;
        if (!e) {
          toast('That entry no longer exists.');
          navigate({ name: 'home' }, { replace: true });
          return;
        }
        savedRev.current = e.rev;
        setEntry(e);
      });
    } else {
      savedRev.current = null;
      setEntry(journal.newEntry({ date: newDate ?? today() }));
    }
    return () => {
      alive = false;
    };
  }, [journal, entryId, newDate, toast]);

  const save = useCallback(() => {
    const current = latest.current;
    if (!current || !dirty.current) return saving.current;
    dirty.current = false;
    saving.current = saveNow(current);
    return saving.current;
    // saveNow is redefined each render with the same dependencies as save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journal, entries, toast]);

  async function saveNow(current: Entry) {
    setSaveState('saving');
    const isFirstSave = savedRev.current === null;
    const datesBefore = entries.map((e) => e.date);
    try {
      const saved = await journal.saveEntry(current, savedRev.current === null ? {} : { expectedRev: savedRev.current });
      savedRev.current = saved.rev;
      // Keep whatever the user typed since this save started; only adopt the new revision.
      setEntry((e) => (e ? { ...e, rev: saved.rev, updatedAt: saved.updatedAt, tags: saved.tags } : e));
      setSaveState('saved');
      if (isFirstSave) {
        navigate({ name: 'entry', id: saved.id }, { replace: true });
        celebrateFirstSave(datesBefore, saved.date);
      }
    } catch (err) {
      if (err instanceof ConflictError) {
        toast('This entry changed in another window, so I loaded the latest version.');
        savedRev.current = err.current.rev;
        setEntry(err.current);
        setSaveState('idle');
      } else {
        dirty.current = true;
        setSaveState('error');
        toast(`Couldn't save: ${(err as Error).message}`);
      }
    }
  }

  function celebrateFirstSave(datesBefore: string[], date: string) {
    if (date !== today()) return;
    const before = computeStreak(datesBefore, today());
    const after = computeStreak([...datesBefore, date], today());
    if (after.current > before.current && STREAK_MILESTONES.includes(after.current)) {
      celebrate('streak');
      toast(`🔥 ${after.current}-day streak! Keep it going.`);
    } else if (!before.wroteToday) {
      celebrate('entry');
    }
  }

  const update = useCallback(
    (fn: (e: Entry) => Entry) => {
      setEntry((e) => (e ? fn(e) : e));
      dirty.current = true;
      setSaveState('idle');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    },
    [save],
  );

  // Flush pending edits when leaving the page or hiding the tab.
  useEffect(() => {
    const flush = () => {
      if (dirty.current) {
        clearTimeout(timer.current);
        void save();
      }
    };
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    // The desktop app closing (D86): save now and let it wait for the write.
    const unregister = onFlush(async () => {
      clearTimeout(timer.current);
      await save();
      return !dirty.current; // still dirty: the save failed
    });
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      unregister();
      flush();
    };
  }, [save]);

  if (!entry) return <p className="muted">Loading…</p>;
  return <EditorBody entry={entry} update={update} saveState={saveState} isNew={savedRev.current === null} />;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────

function EditorBody({ entry, update, saveState, isNew }: { entry: Entry; update: (fn: (e: Entry) => Entry) => void; saveState: SaveState; isNew: boolean }) {
  const { journal, settings } = useJournal();
  const toast = useToast();
  const reduced = useReducedMotion();
  const { style, ink } = useCoverStyle(entry);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [focusBlock, setFocusBlock] = useState<string | null>(null);
  const [linkDialog, setLinkDialog] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [bigVideo, setBigVideo] = useState<{ file: File; resolve: (choice: 'compress' | 'keep' | 'skip') => void } | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  // Pointer and touch dragging via dnd-kit. Keyboard reordering is handled by `onHandleKey` below:
  // dnd-kit's keyboard sensor relies on geometric collision, which fails when a tall video moves past
  // short text (every strategy still reports the block as over itself).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }));
  const [grabbed, setGrabbed] = useState<{ id: string; original: Block[] } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const refocus = useRef<string | null>(null);

  const setBlocks = (fn: (b: Block[]) => Block[]) => update((e) => ({ ...e, blocks: fn(e.blocks) }));
  const setBlock = (b: Block) => setBlocks((bs) => bs.map((x) => (x.id === b.id ? b : x)));
  const move = (id: string, delta: number) => {
    const i = entry.blocks.findIndex((b) => b.id === id);
    const j = Math.max(0, Math.min(entry.blocks.length - 1, i + delta));
    if (i === j) return false;
    refocus.current = id;
    setBlocks((bs) => arrayMove(bs, i, j));
    setAnnouncement(`${BLOCK_LABELS[entry.blocks[i]!.type]} block moved to position ${j + 1} of ${entry.blocks.length}.`);
    return true;
  };

  // React re-inserts moved DOM nodes, which drops focus; put it back on the moved block's handle.
  useEffect(() => {
    if (!refocus.current) return;
    document.querySelector<HTMLElement>(`[data-handle="${refocus.current}"]`)?.focus();
    refocus.current = null;
  });

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, block: Block) => {
    const label = BLOCK_LABELS[block.type];
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (grabbed?.id === block.id) {
        setGrabbed(null);
        setAnnouncement(`${label} block dropped at position ${entry.blocks.findIndex((b) => b.id === block.id) + 1}.`);
      } else {
        setGrabbed({ id: block.id, original: entry.blocks });
        setAnnouncement(`Picked up ${label} block. Use the up and down arrow keys to move it, space to drop, escape to cancel.`);
      }
    } else if (grabbed?.id === block.id && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(block.id, e.key === 'ArrowUp' ? -1 : 1);
    } else if (grabbed?.id === block.id && (e.key === 'Escape' || e.key === 'Tab')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        const original = grabbed.original;
        refocus.current = block.id;
        setBlocks(() => original);
        setAnnouncement(`Move cancelled. ${label} block returned to where it was.`);
      }
      setGrabbed(null);
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      setBlocks((bs) => arrayMove(bs, bs.findIndex((b) => b.id === active.id), bs.findIndex((b) => b.id === over.id)));
    }
  };

  const askAboutBigVideo = (file: File) => new Promise<'compress' | 'keep' | 'skip'>((resolve) => setBigVideo({ file, resolve }));

  /** Imports files and appends blocks: several photos at once become a gallery. */
  const addFiles = async (files: File[], target?: { galleryId: string }) => {
    if (!files.length) return;
    const images: string[] = [];
    const others: Block[] = [];
    try {
      for (const [i, original] of files.entries()) {
        let file = original;
        setBusy(`Adding ${files.length > 1 ? `${i + 1} of ${files.length}` : file.name}…`);
        const advice = sizeAdvice(file.size, file.type);
        if (mediaKind(file.type) === 'video' && advice.level !== 'ok') {
          const choice = await askAboutBigVideo(file);
          if (choice === 'skip') continue;
          if (choice === 'compress') {
            setBusy(`Compressing ${file.name}… 0%`);
            try {
              const smaller = await compressVideo(file, (p) => setBusy(`Compressing ${file.name}… ${Math.round(p * 100)}%`));
              if (smaller) {
                toast(`Compressed ${file.name} from ${formatBytes(file.size)} to ${formatBytes(smaller.size)}.`);
                file = smaller;
              } else toast(`Couldn't make ${file.name} smaller, so I kept the original.`);
            } catch {
              toast(`Compression failed for ${file.name}; keeping the original.`);
            }
          }
        } else if (advice.level === 'huge') {
          toast(advice.message, undefined, 9000);
        }
        const { meta, kind, undecodable } = await importFile(journal, file, { compress: settings.compressLargeMedia });
        if (undecodable) toast(`${file.name} can't be shown in this browser, so it was added as a file.`);
        if (kind === 'image') images.push(meta.id);
        else if (kind === 'video') others.push({ id: newId(), type: 'video', mediaId: meta.id, caption: '' });
        else if (kind === 'audio') others.push({ id: newId(), type: 'audio', mediaId: meta.id, caption: '' });
        else others.push({ id: newId(), type: 'file', mediaId: meta.id, caption: '' });
      }
    } catch (err) {
      toast(`Couldn't add that file: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
    setBlocks((bs) => {
      if (target) {
        return bs.map((b) => (b.type === 'gallery' && b.id === target.galleryId ? { ...b, items: [...b.items, ...images.map((mediaId) => ({ mediaId, caption: '' }))] } : b));
      }
      const imageBlocks: Block[] =
        images.length > 1
          ? [{ id: newId(), type: 'gallery', layout: 'grid', items: images.map((mediaId) => ({ mediaId, caption: '' })), caption: '' }]
          : images.map((mediaId) => ({ id: newId(), type: 'photo', mediaId, caption: '' }));
      return [...bs, ...imageBlocks, ...others];
    });
  };

  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    setDragOver(false);
    void addFiles([...e.dataTransfer.files]);
  };

  const addText = () => {
    const id = newId();
    setFocusBlock(id);
    setBlocks((bs) => [...bs, { id, type: 'text', doc: emptyDoc() }]);
  };

  const removeBlock = (id: string) => {
    const before = entry.blocks;
    setBlocks((bs) => bs.filter((b) => b.id !== id));
    toast('Block removed.', { label: 'Undo', run: () => setBlocks(() => before) });
  };

  const trash = async () => {
    if (isNew) {
      navigate({ name: 'home' });
      return;
    }
    await journal.trashEntry(entry.id);
    navigate({ name: 'home' });
    toast('Moved to trash.', { label: 'Undo', run: () => void journal.restoreEntry(entry.id) }, 8000);
  };

  const setCoverPhoto = async (file: File | undefined) => {
    if (!file) return;
    const { meta, kind } = await importFile(journal, file, { compress: true });
    if (kind === 'image') update((e) => ({ ...e, cover: { kind: 'photo', mediaId: meta.id } }));
    setCoverOpen(false);
  };

  return (
    <article
      className={dragOver ? 'dropzone-active' : undefined}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <header className="entry-hero" style={style} data-ink={ink}>
        <div className="hero-tools">
          <button type="button" className="btn btn-small" aria-expanded={coverOpen} onClick={() => setCoverOpen((o) => !o)}>
            🎨 Cover
          </button>
          <button type="button" className="btn btn-small" onClick={() => void trash()}>
            🗑 {isNew ? 'Discard' : 'Delete'}
          </button>
        </div>
        <label className="sr-only" htmlFor="entry-title">
          Title
        </label>
        <input
          id="entry-title"
          className="title-input"
          placeholder="Give today a title"
          value={entry.title}
          maxLength={300}
          onChange={(e) => update((x) => ({ ...x, title: e.target.value }))}
        />
        <div style={{ fontWeight: 650 }}>{formatLongDate(entry.date)}</div>
      </header>

      {coverOpen && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="cover-picker" role="group" aria-label="Cover gradient">
            {GRADIENT_IDS.map((g) => (
              <button
                key={g}
                type="button"
                className="cover-swatch"
                style={{ backgroundImage: GRADIENTS[g].css }}
                aria-label={GRADIENTS[g].label}
                aria-pressed={entry.cover.kind === 'gradient' && entry.cover.gradient === g}
                onClick={() => update((e) => ({ ...e, cover: { kind: 'gradient', gradient: g } }))}
              />
            ))}
            <button type="button" className="btn btn-small" onClick={() => coverInput.current?.click()}>
              📷 Use a photo
            </button>
            <input ref={coverInput} type="file" accept="image/*" hidden onChange={(e) => void setCoverPhoto(e.target.files?.[0])} />
          </div>
        </div>
      )}

      <div className="meta-row">
        <label className="sr-only" htmlFor="entry-date">
          Date
        </label>
        <input id="entry-date" className="date-input" type="date" value={entry.date} required onChange={(e) => e.target.value && update((x) => ({ ...x, date: e.target.value }))} />
        <div className="mood-picker" role="group" aria-label="Mood">
          {MOODS.map((m) => (
            <button key={m} type="button" aria-pressed={entry.mood === m} aria-label={`Mood ${m}`} onClick={() => update((x) => ({ ...x, mood: x.mood === m ? null : m }))}>
              {m}
            </button>
          ))}
        </div>
        <TagInput tags={entry.tags} onChange={(tags) => update((x) => ({ ...x, tags }))} />
      </div>

      <div className="save-state" aria-live="polite">
        {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved on this device' : saveState === 'error' ? 'Not saved yet. Retrying when you edit again.' : ''}
        {busy && <span> · {busy}</span>}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerFirst}
        onDragEnd={onDragEnd}
        accessibility={{
          screenReaderInstructions: { draggable: 'To move this block, press space or enter, use the arrow keys to move it, then press space or enter again to drop it. Press escape to cancel.' },
        }}
      >
        <SortableContext items={entry.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <div className="blocks">
            {entry.blocks.map((b, i) => (
              <SortableBlock key={b.id} block={b} index={i} count={entry.blocks.length} reduced={reduced} grabbed={grabbed?.id === b.id} onHandleKey={onHandleKey} onMove={move} onRemove={removeBlock}>
                {renderBlock(b, setBlock, (files) => void addFiles(files, { galleryId: b.id }), focusBlock === b.id)}
              </SortableBlock>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {announcement}
      </div>

      <div className="add-bar" role="group" aria-label="Add to this entry">
        <button type="button" className="btn btn-small" onClick={addText}>
          ✍️ Text
        </button>
        <button type="button" className="btn btn-small" onClick={() => photoInput.current?.click()}>
          📷 Photos
        </button>
        <button type="button" className="btn btn-small" onClick={() => mediaInput.current?.click()}>
          🎬 Video, audio or file
        </button>
        <button type="button" className="btn btn-small" onClick={() => setLinkDialog(true)}>
          🔗 Link or YouTube/Vimeo
        </button>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          data-testid="photo-input"
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <input
          ref={mediaInput}
          type="file"
          multiple
          hidden
          data-testid="media-input"
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
      <p className="hint" style={{ marginLeft: 38 }}>
        Tip: drop photos, videos or files anywhere on this page.
      </p>

      <LinkDialog
        open={linkDialog}
        onClose={() => setLinkDialog(false)}
        onAdd={(url) => {
          const embed = parseEmbedUrl(url);
          setBlocks((bs) => [
            ...bs,
            embed ? { id: newId(), type: 'embed', ...embed, title: '', caption: '' } : { id: newId(), type: 'link', url, title: '', caption: '' },
          ]);
          setLinkDialog(false);
        }}
      />

      <Dialog
        open={bigVideo !== null}
        onClose={() => {
          bigVideo?.resolve('skip');
          setBigVideo(null);
        }}
        title="That's a big video"
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                bigVideo?.resolve('skip');
                setBigVideo(null);
              }}
            >
              Don't add it
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                bigVideo?.resolve('keep');
                setBigVideo(null);
              }}
            >
              Keep original
            </button>
            {canCompressVideo() && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  bigVideo?.resolve('compress');
                  setBigVideo(null);
                }}
              >
                Compress (recommended)
              </button>
            )}
          </>
        }
      >
        {bigVideo && (
          <>
            <p>
              <strong>{bigVideo.file.name}</strong> is {formatBytes(bigVideo.file.size)}. Large videos use a lot of this device's storage and make backups slow.
            </p>
            {canCompressVideo() ? (
              <p className="hint">Compression happens on this device and keeps the video at up to 1080p. It can take a few minutes.</p>
            ) : (
              <p className="hint">This browser can't compress video. The desktop app or a recent Chrome or Edge can.</p>
            )}
          </>
        )}
      </Dialog>
    </article>
  );
}

function renderBlock(b: Block, onChange: (b: Block) => void, addToGallery: (files: File[]) => void, autoFocus: boolean): ReactNode {
  switch (b.type) {
    case 'text':
      return <RichTextBlock block={b} onChange={onChange} autoFocus={autoFocus} />;
    case 'photo':
      return <PhotoBlock block={b} onChange={onChange} />;
    case 'gallery':
      return <GalleryBlock block={b} onChange={onChange} onAddPhotos={addToGallery} />;
    case 'video':
      return <VideoBlock block={b} onChange={onChange} />;
    case 'audio':
      return <AudioBlock block={b} onChange={onChange} />;
    case 'file':
      return <FileBlock block={b} onChange={onChange} />;
    case 'link':
      return <LinkBlock block={b} onChange={onChange} />;
    case 'embed':
      return <EmbedBlock block={b} onChange={onChange} />;
  }
}

function SortableBlock({
  block,
  index,
  count,
  reduced,
  grabbed,
  onHandleKey,
  onMove,
  onRemove,
  children,
}: {
  block: Block;
  index: number;
  count: number;
  reduced: boolean;
  grabbed: boolean;
  onHandleKey: (e: KeyboardEvent<HTMLButtonElement>, block: Block) => void;
  onMove: (id: string, delta: number) => boolean;
  onRemove: (id: string) => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    transition: reduced ? null : { duration: 320, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
  });
  const [menu, setMenu] = useState(false);
  const label = `${BLOCK_LABELS[block.type]} block ${index + 1} of ${count}`;
  return (
    <section
      ref={setNodeRef}
      className="block"
      data-dragging={isDragging || grabbed}
      aria-label={label}
      style={{ transform: CSS.Transform.toString(transform && { ...transform, scaleX: 1, scaleY: 1 }), transition }}
    >
      <div className="block-gutter">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="icon-btn drag-handle"
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${label}`}
          aria-pressed={grabbed}
          data-handle={block.id}
          onKeyDown={(e) => onHandleKey(e, block)}
        >
          ⠿
        </button>
        <button type="button" className="icon-btn" aria-label={`More actions for ${label}`} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          ⋯
        </button>
      </div>
      <div className="block-body">{children}</div>
      {menu && (
        <div
          className="block-menu"
          role="menu"
          onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setMenu(false)}
        >
          <button role="menuitem" type="button" autoFocus disabled={index === 0} onClick={() => (onMove(block.id, -1), setMenu(false))}>
            ↑ Move up
          </button>
          <button role="menuitem" type="button" disabled={index === count - 1} onClick={() => (onMove(block.id, 1), setMenu(false))}>
            ↓ Move down
          </button>
          <button role="menuitem" type="button" onClick={() => (onRemove(block.id), setMenu(false))}>
            ✕ Remove
          </button>
        </div>
      )}
    </section>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const t = normalizeTag(draft);
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };
  return (
    <div className="tag-input">
      {tags.map((t) => (
        <button key={t} type="button" className="tag" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
          #{t} ✕
        </button>
      ))}
      <label className="sr-only" htmlFor="tag-draft">
        Add a tag
      </label>
      <input
        id="tag-draft"
        value={draft}
        placeholder={tags.length ? 'Add tag' : 'Add tags, e.g. travel'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={commit}
      />
    </div>
  );
}

function LinkDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (url: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const submit = () => {
    const v = value.trim();
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    try {
      new URL(url);
    } catch {
      setError('That doesn’t look like a web address.');
      return;
    }
    setValue('');
    setError('');
    onAdd(url);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a link"
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            Add
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="field">
          <label htmlFor="link-url">Web address</label>
          <input id="link-url" type="url" inputMode="url" placeholder="https://youtu.be/… or any link" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby="link-hint" />
          <span id="link-hint" className="hint">
            YouTube and Vimeo links become playable videos. Anything else is saved as a link.
          </span>
          {error && (
            <span className="error" role="alert">
              {error}
            </span>
          )}
        </div>
      </form>
    </Dialog>
  );
}
