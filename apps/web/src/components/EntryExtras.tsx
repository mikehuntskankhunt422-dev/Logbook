import { useEffect, useRef, useState } from 'react';
import { MEDIA_LIMITS, type Entry } from '@logbook/core';
import { useJournal, useMediaUrl } from '../app/journal-context.tsx';
import { useToast } from '../app/toasts.tsx';
import { importFile } from '../lib/media-import.ts';
import { trackWork } from '../lib/pending-saves.ts';
import { formatExpiry } from '../lib/expiry.ts';
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

/**
 * The entry's background music: plays (looping) while the entry is open, with its own controls. The
 * journal locking or the page changing unmounts it, which stops it.
 */
export function MusicBar({ entry, onChange }: { entry: Entry; onChange: (musicId: string | null) => void }) {
  const { journal } = useJournal();
  const toast = useToast();
  const url = useMediaUrl(entry.musicId ?? undefined);
  const meta = useMediaMeta(entry.musicId ?? undefined);
  const audio = useRef<HTMLAudioElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [playing, setPlaying] = useState(false);
  const tried = useRef<string | null>(null);

  // Start once when the entry opens; a browser that wants a tap first leaves the play button.
  useEffect(() => {
    if (!url || !audio.current || tried.current === url) return;
    tried.current = url;
    audio.current.volume = 0.6;
    void audio.current.play().catch(() => setPlaying(false));
  }, [url]);

  const choose = (file: File | undefined) =>
    trackWork(
      (async () => {
        if (!file) return;
        if (file.size > MEDIA_LIMITS.audioWarnBytes * 4) toast('That file is very large for background music; it will make backups slower.');
        const { meta: added, kind } = await importFile(journal, file, { compress: false });
        if (kind !== 'audio') {
          toast(`${file.name} isn't a sound file Logbook can play.`);
          await journal.deleteMedia(added.id).catch(() => {});
          return;
        }
        onChange(added.id);
      })(),
    );

  return (
    <div className="music-bar" role="group" aria-label="Background music">
      <input ref={input} type="file" accept="audio/*" hidden onChange={(e) => void choose(e.target.files?.[0])} />
      {entry.musicId ? (
        <>
          <button
            type="button"
            className="btn btn-small music-toggle"
            aria-label={playing ? 'Pause the music' : 'Play the music'}
            disabled={!url}
            onClick={() => (audio.current?.paused ? void audio.current.play().catch(() => {}) : audio.current?.pause())}
          >
            {playing ? '⏸' : '▶️'}
          </button>
          <span className={`music-name${playing ? ' music-playing' : ''}`}>🎵 {meta?.name ?? 'Music'}</span>
          {url && <audio ref={audio} src={url} loop preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />}
          <button type="button" className="btn btn-small" onClick={() => input.current?.click()}>
            Change
          </button>
          <button type="button" className="btn btn-small" onClick={() => onChange(null)}>
            Remove
          </button>
        </>
      ) : (
        <>
          <span className="hint">Music that plays while this entry is open.</span>
          <button type="button" className="btn btn-small" onClick={() => input.current?.click()}>
            🎵 Choose a sound file…
          </button>
        </>
      )}
    </div>
  );
}
