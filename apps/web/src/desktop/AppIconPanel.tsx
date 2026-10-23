import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Dialog } from '../components/common.tsx';
import { canMove, CENTRED, cropRect, maxZoom, MIN_CROP, panBy, placeText, zoomTo, type IconCrop } from '../lib/icon-crop.ts';
import { appIconStatus, resetAppIcon, setAppIcon, type AppIconStatus } from './bridge.ts';
import { drawCrop, drawSmall, loadPicture, PictureError, renderIcons, type IconShape, type Picture } from './icon-images.ts';

/** Where the icon shows, on each system (app_icon.rs). */
const WHERE: Record<AppIconStatus['os'], string> = {
  windows: 'It shows on Logbook’s window, on the taskbar and on Logbook’s Start menu and desktop shortcuts.',
  macos: 'It shows in the Dock and on Logbook in Applications, where anyone who uses this Mac can see it.',
  linux: 'It shows on Logbook’s window, in the dock and in the app menu.',
};

/** What changed, when it reached everywhere and when only the window or Dock. */
const DONE: Record<AppIconStatus['os'], [string, string]> = {
  windows: [
    'Logbook’s icon is now your picture. If the taskbar still shows the old one, it changes when you next sign in to Windows.',
    'Logbook’s window shows your picture, but some of its shortcuts couldn’t be changed, so they keep the usual icon.',
  ],
  macos: [
    'Logbook’s icon is now your picture. The Dock and Finder can take a moment to catch up.',
    'The Dock shows your picture while Logbook is open. macOS didn’t let Logbook change its icon in Applications, so it keeps the usual icon there.',
  ],
  linux: [
    'Logbook’s icon is now your picture. The dock and app menu catch up within a few seconds; the dock may show the old one for this window until you restart Logbook.',
    'Logbook’s window shows your picture. This copy of Logbook isn’t in your app menu, so there’s no menu icon to change.',
  ],
};

const SHAPES: readonly [IconShape, string][] = [
  ['rounded', 'Rounded'],
  ['square', 'Square'],
  ['circle', 'Round'],
];

/** Settings on the desktop app: the person's own picture as Logbook's icon (D101). */
export function AppIconPanel() {
  const [status, setStatus] = useState<AppIconStatus | null>(null);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void appIconStatus().then(setStatus, () => {});
  }, []);
  if (!status) return null;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem('');
    setNote('');
    setBusy(true);
    try {
      setPicture(await loadPicture(file));
    } catch (err) {
      setProblem(err instanceof PictureError ? err.message : 'Logbook couldn’t open that picture.');
    } finally {
      setBusy(false);
    }
  };

  const closeCrop = () => {
    picture?.release();
    setPicture(null);
  };

  const reset = async () => {
    setProblem('');
    setNote('');
    setBusy(true);
    try {
      await resetAppIcon();
      setStatus(await appIconStatus());
      setNote('Logbook has its usual icon again.');
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="app-icon-h">
      <h2 id="app-icon-h">App icon</h2>
      <div className="app-icon-now">
        <img src={status.picture ? `data:image/png;base64,${status.picture}` : `${import.meta.env.BASE_URL}logo.svg`} alt="" width={64} height={64} />
        <p>
          {status.picture ? 'Logbook’s icon is a picture of your own.' : 'You can use a picture of your own as Logbook’s icon.'} {WHERE[status.os]}
        </p>
      </div>
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
          {status.picture ? 'Choose another picture…' : 'Choose a picture…'}
        </button>
        {status.picture && (
          <button type="button" className="btn" disabled={busy} onClick={() => void reset()}>
            Use the usual icon
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        data-testid="app-icon-input"
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <p className="hint" role="status">
        {note}
      </p>
      <p className="hint">Your picture is kept on this computer, outside your journal: your passcode doesn’t lock it, and backups don’t include it.</p>
      {picture && (
        <CropDialog
          picture={picture}
          sizes={status.sizes}
          onCancel={closeCrop}
          onDone={(everywhere) => {
            closeCrop();
            setNote(DONE[status.os][everywhere ? 0 : 1]);
            void appIconStatus().then(setStatus, () => {});
          }}
        />
      )}
    </section>
  );
}

/** The frame's size on screen, in CSS pixels; the canvas has the screen's own pixels. */
const FRAME = 240;
const PREVIEWS = [16, 32, 64] as const;

/**
 * Where the square goes on the picture, by sliders (and dragging, as well), with the corners and
 * how it looks small. Every control is a native one, so it works by keyboard and screen reader.
 */
function CropDialog({ picture, sizes, onCancel, onDone }: { picture: Picture; sizes: number[]; onCancel: () => void; onDone: (everywhere: boolean) => void }) {
  const [crop, setCrop] = useState<IconCrop>(CENTRED);
  const [shape, setShape] = useState<IconShape>('rounded');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const frame = useRef<HTMLCanvasElement>(null);
  const small = useRef<(HTMLCanvasElement | null)[]>([]);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const cornersId = useId();
  const { width: w, height: h } = picture;
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const f = frame.current;
      if (!f) return;
      drawCrop(f, picture, crop, shape);
      for (const c of small.current) if (c) drawSmall(c, f);
    });
    return () => cancelAnimationFrame(id);
  }, [picture, crop, shape]);

  const most = maxZoom(w, h);
  const room = canMove(w, h, crop);
  const soft = cropRect(w, h, crop).size < MIN_CROP;

  const use = async () => {
    setBusy(true);
    setProblem('');
    try {
      const { everywhere } = await setAppIcon(await renderIcons(picture, crop, shape, sizes));
      onDone(everywhere);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    const [dx, dy] = [e.clientX - drag.current.x, e.clientY - drag.current.y];
    drag.current = { x: e.clientX, y: e.clientY };
    const shown = e.currentTarget.getBoundingClientRect().width || FRAME;
    setCrop((c) => panBy(w, h, c, dx, dy, shown));
  };

  return (
    <Dialog
      open
      title="Your picture as Logbook’s icon"
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void use()}>
            Use this picture
          </button>
        </>
      }
    >
      <div className="icon-crop">
        <canvas
          ref={frame}
          className="icon-crop-frame"
          width={FRAME * dpr}
          height={FRAME * dpr}
          aria-hidden="true"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        />
        <div className="icon-crop-controls">
          <label className="icon-crop-range">
            Zoom
            <input
              type="range"
              min={100}
              max={Math.max(100, Math.floor(most * 100))}
              value={Math.round(crop.zoom * 100)}
              aria-valuetext={`${Math.round(crop.zoom * 100)}%`}
              disabled={most <= 1}
              onChange={(e) => setCrop((c) => zoomTo(w, h, c, Number(e.target.value) / 100))}
            />
          </label>
          <label className="icon-crop-range">
            Left and right
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(crop.x * 100)}
              aria-valuetext={placeText(crop.x, ['left', 'right'], 'across')}
              disabled={!room.x}
              onChange={(e) => setCrop((c) => ({ ...c, x: Number(e.target.value) / 100 }))}
            />
          </label>
          <label className="icon-crop-range">
            Up and down
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(crop.y * 100)}
              aria-valuetext={placeText(crop.y, ['top', 'bottom'], 'down')}
              disabled={!room.y}
              onChange={(e) => setCrop((c) => ({ ...c, y: Number(e.target.value) / 100 }))}
            />
          </label>
          <p className="settings-label" id={cornersId}>
            Corners
          </p>
          <div className="segmented" role="group" aria-labelledby={cornersId}>
            {SHAPES.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={shape === value} onClick={() => setShape(value)}>
                {label}
              </button>
            ))}
          </div>
          <div className="icon-crop-small" aria-hidden="true">
            {PREVIEWS.map((px, i) => (
              <canvas
                key={px}
                ref={(c) => {
                  small.current[i] = c;
                }}
                width={px * dpr}
                height={px * dpr}
                style={{ width: px, height: px }}
              />
            ))}
          </div>
        </div>
      </div>
      <p className="hint">Drag the picture or use the sliders to choose what goes in the icon.</p>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <p className="hint" role="status">
        {busy ? 'Making your icon…' : soft ? 'This picture is small, so the icon may look a little soft.' : ''}
      </p>
    </Dialog>
  );
}
