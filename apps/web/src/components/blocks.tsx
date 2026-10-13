import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Color, FontFamily, TextStyle } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import {
  FONTS,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
  embedPlayerUrl,
  fontStack,
  formatBytes,
  formatDuration,
  richTextToPlain,
  type Block,
  type MediaMeta,
} from '@logbook/core';
import { useJournal, useMediaUrl } from '../app/journal-context.tsx';
import { allFlags } from '../lib/flags.ts';
import { tiltFor } from '../lib/motion.ts';

type Of<T extends Block['type']> = Extract<Block, { type: T }>;
interface BlockProps<T extends Block['type']> {
  block: Of<T>;
  onChange: (b: Of<T>) => void;
}

export function useMediaMeta(id: string | undefined): MediaMeta | undefined {
  const { journal, locked } = useJournal();
  const [meta, setMeta] = useState<MediaMeta>();
  useEffect(() => {
    let alive = true;
    if (id && !locked) void journal.getMediaMeta(id).then((m) => alive && setMeta(m));
    return () => {
      alive = false;
    };
  }, [journal, id, locked]);
  return meta;
}

function Caption({ value, onChange, label, placeholder = 'Add a caption…' }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) {
  return <input className="caption-input" value={value} placeholder={placeholder} aria-label={label} maxLength={2000} onChange={(e) => onChange(e.target.value)} />;
}

// ── rich text ────────────────────────────────────────────────────────────────────────────────────

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

/** The editor's formatting (D91): everything the exports and printed books know how to show. */
const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    link: {
      autolink: true,
      linkOnPaste: true,
      openOnClick: false,
      defaultProtocol: 'https',
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  TextStyle,
  Color,
  FontFamily,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Subscript,
  Superscript,
  Placeholder.configure({ placeholder: 'Write about your day…' }),
];

type Palette = 'color' | 'highlight' | 'flag' | null;

/** Whether a mouse button, finger or pen is down anywhere on the page. */
let pressing = false;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => (pressing = true), true);
  for (const type of ['pointerup', 'pointercancel'] as const) document.addEventListener(type, () => (pressing = false), true);
}

/**
 * Runs `fn` once any press in progress has ended and its click has landed. Hiding the toolbar moves
 * what's below it up; done on the press, that would move a button out from under the pointer.
 */
function afterPress(fn: () => void) {
  if (!pressing) return fn();
  const done = () => {
    document.removeEventListener('pointerup', done, true);
    document.removeEventListener('pointercancel', done, true);
    setTimeout(fn, 0);
  };
  document.addEventListener('pointerup', done, true);
  document.addEventListener('pointercancel', done, true);
}

export function RichTextBlock({ block, onChange, autoFocus }: BlockProps<'text'> & { autoFocus?: boolean }) {
  const latest = useRef({ block, onChange });
  latest.current = { block, onChange };
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [palette, setPalette] = useState<Palette>(null);
  const [focused, setFocused] = useState(false);
  // Text this version can't read (written by a newer Logbook): shown, never saved over.
  const [unreadable, setUnreadable] = useState(false);
  const blocked = useRef(false);
  const wrapper = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: block.doc,
    enableContentCheck: true,
    onContentError: ({ editor }) => {
      blocked.current = true;
      editor.setEditable(false);
      setUnreadable(true);
    },
    autofocus: autoFocus ? 'end' : false,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { 'aria-label': 'Entry text', 'aria-multiline': 'true', role: 'textbox' } },
    onUpdate: ({ editor }) => {
      if (!blocked.current) latest.current.onChange({ ...latest.current.block, doc: editor.getJSON() });
    },
    onFocus: () => setFocused(true),
    onBlur: ({ event }) => {
      const next = (event as FocusEvent).relatedTarget as Node | null;
      if (next && wrapper.current?.contains(next)) return;
      afterPress(() => {
        if (!wrapper.current?.contains(document.activeElement)) setFocused(false);
      });
    },
  });

  if (unreadable) {
    return (
      <div className="rt rt-unreadable">
        <p className="notice notice-warn">This text uses formatting from a newer version of Logbook. Update Logbook to edit it; until then it's shown as plain text and left as it is.</p>
        <p className="rt-plain">{richTextToPlain(block.doc)}</p>
      </div>
    );
  }
  if (!editor) return null;

  const btn = (label: string, text: ReactNode, active: boolean, run: () => void, disabled = false) => (
    <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {text}
    </button>
  );
  const chain = () => editor.chain().focus();

  const applyLink = () => {
    const v = linkValue.trim();
    const c = chain().extendMarkRange('link');
    if (!v) c.unsetLink().run();
    else c.setLink({ href: SAFE_HREF.test(v) ? v : `https://${v}` }).run();
    setLinkOpen(false);
  };

  const style = editor.isActive('codeBlock') ? 'code' : (([1, 2, 3, 4, 5, 6].find((level) => editor.isActive('heading', { level })) ?? 0) as number);
  const setStyle = (value: string) => {
    if (value === 'code') chain().toggleCodeBlock().run();
    else if (value === '0') chain().setParagraph().run();
    else chain().setHeading({ level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
  };
  const font = (editor.getAttributes('textStyle').fontFamily as string | undefined) ?? '';
  const align = (['center', 'right', 'justify'] as const).find((a) => editor.isActive({ textAlign: a })) ?? 'left';
  const inTable = editor.isActive('table');

  return (
    <div className="rt" ref={wrapper} onFocus={() => setFocused(true)}>
      {(focused || linkOpen) && (
        <div className="rt-toolbar" role="toolbar" aria-label="Text formatting">
          <select aria-label="Text style" value={String(style)} onChange={(e) => setStyle(e.target.value)}>
            <option value="0">Text</option>
            {[1, 2, 3, 4, 5, 6].map((l) => (
              <option key={l} value={l}>
                Heading {l}
              </option>
            ))}
            <option value="code">Code block</option>
          </select>
          {btn('Bold (Ctrl+B)', <b>B</b>, editor.isActive('bold'), () => chain().toggleBold().run())}
          {btn('Italic (Ctrl+I)', <i>I</i>, editor.isActive('italic'), () => chain().toggleItalic().run())}
          {btn('Underline (Ctrl+U)', <u>U</u>, editor.isActive('underline'), () => chain().toggleUnderline().run())}
          {btn('Strikethrough', <s>S</s>, editor.isActive('strike'), () => chain().toggleStrike().run())}
          {btn('Text colour', <span className="rt-swatch-a" style={{ borderBottomColor: (editor.getAttributes('textStyle').color as string | undefined) ?? 'currentColor' }}>A</span>, palette === 'color', () => setPalette((p) => (p === 'color' ? null : 'color')))}
          {btn('Highlight', '🖍', editor.isActive('highlight') || palette === 'highlight', () => setPalette((p) => (p === 'highlight' ? null : 'highlight')))}
          {btn('Insert a flag', '🏳', palette === 'flag', () => setPalette((p) => (p === 'flag' ? null : 'flag')))}
          <select aria-label="Font" value={font} onChange={(e) => (e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run())}>
            <option value="">Default font</option>
            {FONTS.map((f) => (
              <option key={f.family} value={f.family} style={{ fontFamily: fontStack(f) }}>
                {f.label}
              </option>
            ))}
          </select>
          <select aria-label="Alignment" value={align} onChange={(e) => (e.target.value === 'left' ? chain().unsetTextAlign().run() : chain().setTextAlign(e.target.value).run())}>
            <option value="left">Align left</option>
            <option value="center">Centre</option>
            <option value="right">Align right</option>
            <option value="justify">Justify</option>
          </select>
          {btn('Bulleted list', '•', editor.isActive('bulletList'), () => chain().toggleBulletList().run())}
          {btn('Numbered list', '1.', editor.isActive('orderedList'), () => chain().toggleOrderedList().run())}
          {btn('Checklist', '☑', editor.isActive('taskList'), () => chain().toggleTaskList().run())}
          {btn('Quote', '❝', editor.isActive('blockquote'), () => chain().toggleBlockquote().run())}
          {btn('Code', '</>', editor.isActive('code'), () => chain().toggleCode().run())}
          {btn('Divider line', '―', false, () => chain().setHorizontalRule().run())}
          {btn('Table', '▦', inTable, () => (inTable ? undefined : chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()), inTable)}
          {btn('Superscript', <span>x²</span>, editor.isActive('superscript'), () => chain().toggleSuperscript().run())}
          {btn('Subscript', <span>x₂</span>, editor.isActive('subscript'), () => chain().toggleSubscript().run())}
          {btn('Link', '🔗', editor.isActive('link'), () => {
            setLinkValue((editor.getAttributes('link').href as string | undefined) ?? '');
            setLinkOpen((o) => !o);
          })}
          {btn('Clear formatting', '⌫', false, () => chain().unsetAllMarks().clearNodes().run())}
        </div>
      )}
      {focused && palette === 'flag' && <FlagPicker onPick={(emoji) => (chain().insertContent(emoji).run(), setPalette(null))} />}
      {focused && (palette === 'color' || palette === 'highlight') && (
        <div className="rt-palette" role="group" aria-label={palette === 'color' ? 'Text colours' : 'Highlighter colours'}>
          {(palette === 'color' ? TEXT_COLORS : HIGHLIGHT_COLORS).map((c) => (
            <button
              key={c.value}
              type="button"
              className="rt-swatch"
              style={{ background: c.value }}
              aria-label={`${palette === 'color' ? 'Text colour' : 'Highlight'} ${c.name}`}
              title={c.name}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (palette === 'color') chain().setColor(c.value).run();
                else chain().setHighlight({ color: c.value }).run();
                setPalette(null);
              }}
            />
          ))}
          <button
            type="button"
            className="btn btn-small"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (palette === 'color') chain().unsetColor().run();
              else chain().unsetHighlight().run();
              setPalette(null);
            }}
          >
            {palette === 'color' ? 'No colour' : 'No highlight'}
          </button>
        </div>
      )}
      {focused && inTable && (
        <div className="rt-toolbar rt-table-tools" role="toolbar" aria-label="Table">
          {btn('Add a row above', '↑ Row', false, () => chain().addRowBefore().run())}
          {btn('Add a row below', '↓ Row', false, () => chain().addRowAfter().run())}
          {btn('Add a column to the left', '← Column', false, () => chain().addColumnBefore().run())}
          {btn('Add a column to the right', '→ Column', false, () => chain().addColumnAfter().run())}
          {btn('Header row on or off', 'Header', false, () => chain().toggleHeaderRow().run())}
          {btn('Delete this row', '✕ Row', false, () => chain().deleteRow().run())}
          {btn('Delete this column', '✕ Column', false, () => chain().deleteColumn().run())}
          {btn('Delete the table', '✕ Table', false, () => chain().deleteTable().run())}
        </div>
      )}
      {linkOpen && (
        <form
          className="link-popover"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input className="text-input" autoFocus aria-label="Link address" placeholder="https://…" value={linkValue} onChange={(e) => setLinkValue(e.target.value)} />
          <button className="btn btn-small btn-primary" type="submit">
            {linkValue.trim() ? 'Set link' : 'Remove link'}
          </button>
          <button className="btn btn-small" type="button" onClick={() => setLinkOpen(false)}>
            Cancel
          </button>
        </form>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

/** A searchable grid of flags; picking one types it where the cursor is. */
function FlagPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const flags = allFlags().filter((f) => !q || f.name.toLowerCase().includes(q) || f.code.toLowerCase() === q);
  return (
    <div className="rt-flags" role="group" aria-label="Flags">
      <input className="text-input" autoFocus aria-label="Find a country" placeholder="Find a country…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="rt-flag-grid">
        {flags.map((f) => (
          <button key={f.code} type="button" className="rt-flag" aria-label={`Flag of ${f.name}`} title={f.name} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(f.emoji)}>
            {f.emoji}
          </button>
        ))}
        {!flags.length && <p className="hint">No country by that name.</p>}
      </div>
    </div>
  );
}

// ── photos ───────────────────────────────────────────────────────────────────────────────────────

export function PhotoBlock({ block, onChange }: BlockProps<'photo'>) {
  const url = useMediaUrl(block.mediaId);
  const meta = useMediaMeta(block.mediaId);
  const ratio = meta?.width && meta.height ? `${meta.width} / ${meta.height}` : undefined;
  return (
    <figure className="polaroid" style={{ ['--tilt' as string]: tiltFor(block.id), ['--ratio' as string]: ratio }}>
      {url ? <img src={url} alt={block.caption || meta?.name || 'Photo'} /> : <div style={{ aspectRatio: ratio ?? '4 / 3', background: '#eee' }} />}
      <figcaption>
        <Caption value={block.caption} label="Photo caption" onChange={(caption) => onChange({ ...block, caption })} />
      </figcaption>
    </figure>
  );
}

function GalleryImage({ mediaId, alt }: { mediaId: string; alt: string }) {
  const url = useMediaUrl(mediaId);
  return url ? <img src={url} alt={alt} loading="lazy" /> : <div style={{ background: 'var(--bg-sunk)', width: '100%', height: '100%', aspectRatio: '1' }} />;
}

export function GalleryBlock({ block, onChange, onAddPhotos }: BlockProps<'gallery'> & { onAddPhotos: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const setItem = (i: number, caption: string) => onChange({ ...block, items: block.items.map((it, j) => (j === i ? { ...it, caption } : it)) });
  const remove = (i: number) => onChange({ ...block, items: block.items.filter((_, j) => j !== i) });
  return (
    <div className="gallery">
      <div className="gallery-tools">
        <div className="segmented" role="group" aria-label="Gallery layout">
          {(['grid', 'collage'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={block.layout === l} onClick={() => onChange({ ...block, layout: l })}>
              {l === 'grid' ? 'Grid' : 'Collage'}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-small" onClick={() => input.current?.click()}>
          + Add photos
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            onAddPhotos([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <span className="hint">{block.items.length} photos</span>
      </div>
      {block.layout === 'grid' ? (
        <div className="gallery-grid">
          {block.items.map((it, i) => (
            <figure key={it.mediaId}>
              <GalleryImage mediaId={it.mediaId} alt={it.caption || `Photo ${i + 1}`} />
              <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                <Caption value={it.caption} label={`Caption for photo ${i + 1}`} placeholder="Caption" onChange={(v) => setItem(i, v)} />
                <button type="button" className="icon-btn" aria-label={`Remove photo ${i + 1}`} onClick={() => remove(i)}>
                  ✕
                </button>
              </div>
            </figure>
          ))}
        </div>
      ) : (
        <div className="collage">
          {block.items.map((it, i) => (
            <GalleryImage key={it.mediaId} mediaId={it.mediaId} alt={it.caption || `Photo ${i + 1}`} />
          ))}
        </div>
      )}
      <Caption value={block.caption} label="Gallery caption" onChange={(caption) => onChange({ ...block, caption })} />
    </div>
  );
}

// ── video, audio, files ──────────────────────────────────────────────────────────────────────────

function Facts({ meta }: { meta: MediaMeta | undefined }) {
  if (!meta) return null;
  const parts = [meta.name, meta.durationMs ? formatDuration(meta.durationMs) : null, formatBytes(meta.bytes)].filter(Boolean);
  return <div className="media-facts">{parts.join(' · ')}</div>;
}

export function VideoBlock({ block, onChange }: BlockProps<'video'>) {
  const meta = useMediaMeta(block.mediaId);
  const url = useMediaUrl(block.mediaId);
  const poster = useMediaUrl(meta?.posterId);
  return (
    <div className="media-card">
      {url ? (
        <video controls preload="metadata" src={url} poster={poster ?? undefined} aria-label={block.caption || meta?.name || 'Video'} playsInline />
      ) : (
        <div className="embed-placeholder">Loading video…</div>
      )}
      <Caption value={block.caption} label="Video caption" onChange={(caption) => onChange({ ...block, caption })} />
      <Facts meta={meta} />
    </div>
  );
}

export function AudioBlock({ block, onChange }: BlockProps<'audio'>) {
  const meta = useMediaMeta(block.mediaId);
  const url = useMediaUrl(block.mediaId);
  return (
    <div className="media-card">
      {url && <audio controls preload="metadata" src={url} aria-label={block.caption || meta?.name || 'Audio'} />}
      <Caption value={block.caption} label="Audio caption" onChange={(caption) => onChange({ ...block, caption })} />
      <Facts meta={meta} />
    </div>
  );
}

const FILE_ICONS: [RegExp, string][] = [
  [/pdf/, '📕'],
  [/zip|compressed/, '🗜️'],
  [/sheet|excel|csv/, '📊'],
  [/word|document|text/, '📄'],
  [/image/, '🖼️'],
];

export function FileBlock({ block, onChange }: BlockProps<'file'>) {
  const meta = useMediaMeta(block.mediaId);
  const url = useMediaUrl(block.mediaId);
  const icon = FILE_ICONS.find(([re]) => re.test(meta?.mime ?? ''))?.[1] ?? '📎';
  return (
    <div className="media-card">
      <div className="file-tag">
        <span className="file-icon" aria-hidden="true">
          {icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="file-name">{meta?.name ?? 'File'}</div>
          <div className="media-facts">{meta ? formatBytes(meta.bytes) : ''}</div>
        </div>
        {url && meta && (
          <a className="btn btn-small" href={url} download={meta.name}>
            Download
          </a>
        )}
      </div>
      <Caption value={block.caption} label="File caption" onChange={(caption) => onChange({ ...block, caption })} />
    </div>
  );
}

// ── links and embeds ─────────────────────────────────────────────────────────────────────────────

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function LinkBlock({ block, onChange }: BlockProps<'link'>) {
  return (
    <div className="media-card link-fields">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="link-domain">🔗 {domainOf(block.url)}</span>
        <a className="btn btn-small" href={block.url} target="_blank" rel="noopener noreferrer nofollow">
          Open
        </a>
      </div>
      <input aria-label="Link title" placeholder="Title (optional)" value={block.title} maxLength={300} onChange={(e) => onChange({ ...block, title: e.target.value })} />
      <Caption value={block.caption} label="Link note" placeholder="Why this link matters…" onChange={(caption) => onChange({ ...block, caption })} />
    </div>
  );
}

export function EmbedBlock({ block, onChange }: BlockProps<'embed'>) {
  const [playing, setPlaying] = useState(false);
  const online = typeof navigator === 'undefined' || navigator.onLine;
  const provider = block.provider === 'youtube' ? 'YouTube' : 'Vimeo';
  return (
    <div className="media-card">
      {playing ? (
        <div className="embed-frame">
          <iframe
            src={`${embedPlayerUrl(block)}${block.provider === 'youtube' ? '?autoplay=1' : '&autoplay=1'}`}
            title={block.title || `${provider} video`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="embed-placeholder">
          <div>
            <div style={{ fontSize: '2.4rem' }} aria-hidden="true">
              ▶
            </div>
            <div style={{ fontWeight: 700 }}>{block.title || `${provider} video`}</div>
            {online ? (
              <button type="button" className="btn btn-small" style={{ marginTop: 10 }} onClick={() => setPlaying(true)}>
                Load from {provider}
              </button>
            ) : (
              <p>You're offline. The video will play when you reconnect.</p>
            )}
            <p className="hint" style={{ color: '#ddd', margin: '8px 0 0' }}>
              Nothing is loaded from {provider} until you press play.
            </p>
          </div>
        </div>
      )}
      <div className="link-fields" style={{ marginTop: 8 }}>
        <input aria-label="Video title" placeholder="Title (optional)" value={block.title} maxLength={300} onChange={(e) => onChange({ ...block, title: e.target.value })} />
      </div>
      <Caption value={block.caption} label="Video caption" onChange={(caption) => onChange({ ...block, caption })} />
    </div>
  );
}

export const BLOCK_LABELS: Record<Block['type'], string> = {
  text: 'Text',
  photo: 'Photo',
  gallery: 'Gallery',
  video: 'Video',
  audio: 'Audio',
  file: 'File',
  link: 'Link',
  embed: 'Video link',
};
