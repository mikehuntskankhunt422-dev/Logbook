import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { embedPlayerUrl, formatBytes, formatDuration, type Block, type MediaMeta } from '@logbook/core';
import { useJournal, useMediaUrl } from '../app/journal-context.tsx';
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

export function RichTextBlock({ block, onChange, autoFocus }: BlockProps<'text'> & { autoFocus?: boolean }) {
  const latest = useRef({ block, onChange });
  latest.current = { block, onChange };
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [focused, setFocused] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        link: {
          autolink: true,
          linkOnPaste: true,
          openOnClick: false,
          defaultProtocol: 'https',
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        },
      }),
      Placeholder.configure({ placeholder: 'Write about your day…' }),
    ],
    content: block.doc,
    autofocus: autoFocus ? 'end' : false,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { 'aria-label': 'Entry text', 'aria-multiline': 'true', role: 'textbox' } },
    onUpdate: ({ editor }) => latest.current.onChange({ ...latest.current.block, doc: editor.getJSON() }),
    onFocus: () => setFocused(true),
    onBlur: ({ event }) => {
      const next = (event as FocusEvent).relatedTarget as Node | null;
      if (!next || !wrapper.current?.contains(next)) setFocused(false);
    },
  });

  if (!editor) return null;
  const btn = (label: string, text: string, active: boolean, run: () => void) => (
    <button type="button" aria-label={label} title={label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {text}
    </button>
  );

  const applyLink = () => {
    const v = linkValue.trim();
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!v) chain.unsetLink().run();
    else {
      const url = SAFE_HREF.test(v) ? v : `https://${v}`;
      chain.setLink({ href: url }).run();
    }
    setLinkOpen(false);
  };

  return (
    <div className="rt" ref={wrapper} onFocus={() => setFocused(true)}>
      {(focused || linkOpen) && (
        <div className="rt-toolbar" role="toolbar" aria-label="Text formatting">
          {btn('Bold (Ctrl+B)', 'B', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
          {btn('Italic (Ctrl+I)', 'I', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
          {btn('Heading', 'H', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
          {btn('Subheading', 'h', editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run())}
          {btn('Bulleted list', '•', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run())}
          {btn('Numbered list', '1.', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run())}
          {btn('Quote', '❝', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run())}
          {btn('Link', '🔗', editor.isActive('link'), () => {
            setLinkValue((editor.getAttributes('link').href as string | undefined) ?? '');
            setLinkOpen((o) => !o);
          })}
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
