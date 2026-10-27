import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MEDIA_LIMITS, mediaKind, musicSource, normaliseMusicUrl, withAutoplay, type Entry, type MusicSource } from '@logbook/core';
import { useJournal, useMediaUrl } from '../app/journal-context.tsx';
import { useToast } from '../app/toasts.tsx';
import { importFile } from '../lib/media-import.ts';
import { trackWork } from '../lib/pending-saves.ts';
import { formatExpiry } from '../lib/expiry.ts';
import { promptFor } from '../lib/prompts.ts';
import { useMediaMeta } from './blocks.tsx';

/** Expiry and background music on an entry (D91). */

const PRESETS: [label: string, days: number][] = [
  ['In a day', 1],
  ['In a week', 7],
  ['In a month', 30],
  ['In a year', 365],
];

/** `datetime-local` value (local time, to the minute) for an ISO time, and back. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ExpiryPanel({ entry, onChange }: { entry: Entry; onChange: (expiresAt: string | null) => void }) {
  const [custom, setCustom] = useState(false);
  const set = (days: number) => onChange(new Date(Date.now() + days * 86_400_000).toISOString());
  return (
    <div className="panel expiry-panel" role="group" aria-label="Expiry">
      <p>
        {entry.expiresAt ? (
          <>
            This entry moves to the trash on <strong>{formatExpiry(entry.expiresAt)}</strong>. From there you can still restore it for 30 days (Settings → Trash).
          </>
        ) : (
          'This entry stays until you delete it. Make it expire, and it moves to the trash by itself when the time comes.'
        )}
      </p>
      <div className="row">
        {PRESETS.map(([label, days]) => (
          <button key={label} type="button" className="btn btn-small" onClick={() => (setCustom(false), set(days))}>
            {label}
          </button>
        ))}
        <button type="button" className="btn btn-small" aria-pressed={custom} onClick={() => setCustom((c) => !c)}>
          On a date…
        </button>
        {entry.expiresAt && (
          <button type="button" className="btn btn-small" onClick={() => (setCustom(false), onChange(null))}>
            Never expire
          </button>
        )}
      </div>
      {custom && (
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="expires-at">Expires at</label>
          <input
            id="expires-at"
            type="datetime-local"
            className="date-input"
            min={toLocalInput(new Date(Date.now() + 60_000).toISOString())}
            value={entry.expiresAt ? toLocalInput(entry.expiresAt) : ''}
            onChange={(e) => {
              const at = new Date(e.target.value);
              if (e.target.value && !Number.isNaN(at.getTime())) onChange(at.toISOString());
            }}
          />
        </div>
      )}
    </div>
  );
}

type MusicPatch = Partial<Pick<Entry, 'musicId' | 'musicUrl'>>;

/** Turns a sound or video's play() into something the buttons can use. */
function usePlayback<T extends HTMLMediaElement>(src: string | undefined) {
  const media = useRef<T>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const tried = useRef<string | null>(null);
  // Start once when the entry opens; a browser that wants a tap first leaves the play button.
  useEffect(() => {
    setFailed(false);
    if (!src || !media.current || tried.current === src) return;
    tried.current = src;
    media.current.volume = 0.6;
    void media.current.play().catch(() => setPlaying(false));
  }, [src]);
  const toggle = () => (media.current?.paused ? void media.current.play().catch(() => {}) : media.current?.pause());
  const handlers = { onPlay: () => setPlaying(true), onPause: () => setPlaying(false), onError: () => setFailed(true) };
  return { ref: media, handlers, playing, failed, toggle };
}

function useAudio(src: string | undefined) {
  const { ref, handlers, ...rest } = usePlayback<HTMLAudioElement>(src);
  const element = src ? <audio ref={ref} src={src} loop preload="auto" {...handlers} /> : null;
  return { element, ...rest };
}

/**
 * The entry's background music: a file in the journal (D91), or a link (D93): a video or live
 * stream in its site's own player, or a sound file or radio stream on the web. The file can be a
 * video, shown as it plays, or a photo or GIF, shown (D106). It plays while the entry is open; the
 * journal locking or the page changing unmounts it, which stops it.
 */
export function MusicBar({ entry, onChange }: { entry: Entry; onChange: (patch: MusicPatch) => void }) {
  const { journal, settings } = useJournal();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);

  const choose = (file: File | undefined) =>
    trackWork(
      (async () => {
        if (!file) return;
        const large = mediaKind(file.type) === 'audio' ? MEDIA_LIMITS.audioWarnBytes * 4 : MEDIA_LIMITS.videoWarnBytes;
        if (file.size > large) toast('That file is very large for an entry’s background; it will make backups slower.');
        const { meta: added, kind } = await importFile(journal, file, { compress: settings.compressLargeMedia });
        if (kind === 'file') {
          toast(`${file.name} isn't a sound, video or picture Logbook can show.`);
          await journal.deleteMedia(added.id).catch(() => {});
          return;
        }
        onChange({ musicId: added.id, musicUrl: null });
        setLinking(false);
      })(),
    );
  const remove = () => onChange({ musicId: null, musicUrl: null });

  const changers = (
    <>
      <input ref={input} type="file" accept="audio/*,video/*,image/*" hidden onChange={(e) => void choose(e.target.files?.[0])} />
      <button type="button" className="btn btn-small" onClick={() => input.current?.click()}>
        🎵 {entry.musicId || entry.musicUrl ? 'File…' : 'Choose a file…'}
      </button>
      <button type="button" className="btn btn-small" aria-expanded={linking} onClick={() => setLinking((l) => !l)}>
        🔗 {entry.musicId || entry.musicUrl ? 'Link…' : 'Paste a link…'}
      </button>
    </>
  );

  return (
    <div className="music-bar" role="group" aria-label="Background music">
      {entry.musicUrl ? (
        <MusicLink key={entry.musicUrl} href={entry.musicUrl} actions={changers} onRemove={remove} />
      ) : entry.musicId ? (
        <MusicFile key={entry.musicId} id={entry.musicId} actions={changers} onRemove={remove} />
      ) : (
        <div className="music-row">
          <span className="hint">Music, a video, a GIF or a photo for while this entry is open.</span>
          {changers}
        </div>
      )}
      {linking && (
        <MusicLinkForm
          onDone={(href) => {
            onChange({ musicUrl: href, musicId: null });
            setLinking(false);
          }}
          onCancel={() => setLinking(false)}
        />
      )}
    </div>
  );
}

/** A sound plays with Logbook's own button; a video plays in view, with its own controls; a photo or GIF is shown. */
function MusicFile({ id, actions, onRemove }: { id: string; actions: ReactNode; onRemove: () => void }) {
  const url = useMediaUrl(id);
  const meta = useMediaMeta(id);
  const poster = useMediaUrl(meta?.posterId);
  // Known once its details are read; anything that isn't a video or picture is played as a sound,
  // as every background file was before D106.
  const kind = meta ? mediaKind(meta.mime) : undefined;
  const shown = kind === 'video' || kind === 'image' ? kind : kind && 'audio';
  const sound = useAudio(shown === 'audio' ? (url ?? undefined) : undefined);
  const video = usePlayback<HTMLVideoElement>(shown === 'video' ? (url ?? undefined) : undefined);
  const name = meta?.name ?? 'Music';
  const playing = sound.playing || video.playing;
  return (
    <>
      <div className="music-row">
        {shown !== 'video' && shown !== 'image' && (
          <button type="button" className="btn btn-small music-toggle" aria-label={playing ? 'Pause the music' : 'Play the music'} disabled={!url || !shown} onClick={sound.toggle}>
            {playing ? '⏸' : '▶️'}
          </button>
        )}
        <span className={`music-name${playing ? ' music-playing' : ''}`}>
          {shown === 'video' ? '🎬' : shown === 'image' ? '🖼' : '🎵'} {name}
        </span>
        {sound.element}
        {actions}
        <button type="button" className="btn btn-small" onClick={onRemove}>
          Remove
        </button>
      </div>
      {url && shown === 'video' && (
        <video ref={video.ref} className="music-media" src={url} poster={poster ?? undefined} width={meta?.width} height={meta?.height} loop preload="auto" controls playsInline aria-label={name} {...video.handlers} />
      )}
      {video.failed && (
        <p className="notice notice-warn music-problem" role="status">
          This video doesn’t play here: this app can’t play its format. An MP4 video is the safest choice.
        </p>
      )}
      {url && shown === 'image' && <img className="music-media" src={url} alt={name} width={meta?.width} height={meta?.height} />}
    </>
  );
}

function MusicLinkForm({ onDone, onCancel }: { onDone: (href: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const id = useId();
  return (
    <form
      className="music-link-form"
      onSubmit={(e) => {
        e.preventDefault();
        const href = normaliseMusicUrl(value);
        if (!href) return setError('That isn’t a web address. Copy the link from the video or station, then paste it here.');
        onDone(href);
      }}
    >
      <label htmlFor={`${id}-url`}>Link to music</label>
      <div className="row">
        <input
          id={`${id}-url`}
          className="text-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          placeholder="YouTube, Vimeo, Rumble, a radio stream…"
          value={value}
          aria-describedby={`${id}-hint`}
          onChange={(e) => (setValue(e.target.value), setError(''))}
        />
        <button type="submit" className="btn btn-small btn-primary">
          Play
        </button>
        <button type="button" className="btn btn-small" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <span id={`${id}-hint`} className="hint">
        A video or live stream (YouTube, Vimeo, Rumble, Dailymotion, Twitch, Kick, Streamable), a sound file or an internet radio stream. Videos play in their site’s own player, with its ads.
      </span>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

/** A link's music: its site's player, or the stream itself, or a way to open it. */
function MusicLink({ href, actions, onRemove }: { href: string; actions: ReactNode; onRemove: () => void }) {
  const [source, setSource] = useState<MusicSource>(() => musicSource(href));
  const [problem, setProblem] = useState('');
  const online = typeof navigator === 'undefined' || navigator.onLine;
  const stream = useAudio(source.kind === 'stream' && online ? source.url : undefined);
  const frame = useRef<HTMLIFrameElement>(null);

  // A Rumble page's player is found through Rumble's oEmbed.
  useEffect(() => {
    if (source.kind !== 'rumble-page' || !online) return;
    let alive = true;
    fetch(`https://rumble.com/api/Media/oembed.json?url=${encodeURIComponent(source.url)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { html?: string }) => {
        const src = /src="(https:\/\/rumble\.com\/embed\/[a-z0-9]+\/)[^"]*"/i.exec(data.html ?? '')?.[1];
        if (!alive) return;
        if (src) setSource({ kind: 'player', site: 'Rumble', src, url: source.url });
        else setProblem('Rumble didn’t say how to play this page.');
      })
      .catch(() => alive && setProblem('Rumble didn’t say how to play this page here. In Rumble, use Share → Embed and paste that link instead.'));
    return () => {
      alive = false;
    };
  }, [source, online]);

  // YouTube says when it won't play a video here (embedding turned off, or it won't play inside
  // an app): listen for that and say so, with the link to open instead.
  const youtube = source.kind === 'player' && source.youtubeId !== undefined;
  useEffect(() => {
    if (!youtube) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      try {
        const data = typeof e.data === 'string' ? (JSON.parse(e.data) as { event?: string; info?: unknown }) : null;
        if (data?.event === 'onError') setProblem('YouTube won’t play this video inside Logbook (its owner may not allow it).');
      } catch {
        // Not one of the player's messages.
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [youtube]);
  const listen = () => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'logbook-music', channel: 'widget' }), '*');

  useEffect(() => {
    if (stream.failed) setProblem('This link doesn’t play inside Logbook (it isn’t a sound file or stream, or the site doesn’t allow it).');
  }, [stream.failed]);

  return (
    <>
      <div className="music-row">
        {source.kind === 'stream' && !problem && (
          <button type="button" className="btn btn-small music-toggle" aria-label={stream.playing ? 'Pause the music' : 'Play the music'} disabled={!online} onClick={stream.toggle}>
            {stream.playing ? '⏸' : '▶️'}
          </button>
        )}
        <span className={`music-name${stream.playing ? ' music-playing' : ''}`}>🎵 {source.site}</span>
        <a className="btn btn-small" href={href} target="_blank" rel="noopener noreferrer">
          Open ↗
        </a>
        {actions}
        <button type="button" className="btn btn-small" onClick={onRemove}>
          Remove
        </button>
        {stream.element}
      </div>
      {!online ? (
        <p className="hint">You’re offline. The music plays when you’re back online.</p>
      ) : problem ? (
        <p className="notice notice-warn music-problem" role="status">
          {problem} <a href={href} target="_blank" rel="noopener noreferrer">Open it in your browser ↗</a>
        </p>
      ) : (
        source.kind === 'player' && (
          <div className="music-player">
            <iframe
              ref={frame}
              src={withAutoplay(youtube ? `${source.src}&origin=${encodeURIComponent(location.origin)}` : source.src)}
              title={`${source.site} player`}
              allow="autoplay; encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={youtube ? listen : undefined}
            />
          </div>
        )
      )}
    </>
  );
}

/** A writing prompt on a new, empty entry (D94). */
export function PromptCard({ date, onUse }: { date: string; onUse: (prompt: string) => void }) {
  const [turn, setTurn] = useState(0);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const prompt = promptFor(date, turn);
  return (
    <div className="prompt-card" role="group" aria-label="Writing prompt">
      <p className="prompt-text" key={prompt} aria-live="polite">
        <span aria-hidden="true">💭</span> {prompt}
      </p>
      <div className="row">
        <button type="button" className="btn btn-small btn-primary" onClick={() => onUse(prompt)}>
          Write about this
        </button>
        <button type="button" className="btn btn-small" onClick={() => setTurn((t) => t + 1)}>
          🔀 Another
        </button>
        <button type="button" className="btn btn-small" aria-label="Hide the prompt" onClick={() => setHidden(true)}>
          ✕
        </button>
      </div>
    </div>
  );
}
