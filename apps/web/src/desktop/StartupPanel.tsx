import { useEffect, useState } from 'react';
import { autostartStatus, setAutostart } from './bridge.ts';

/** Settings on the desktop app: opening Logbook when the person signs in to this computer (D110). */
export function StartupPanel() {
  // null until the computer has said.
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let alive = true;
    autostartStatus().then(
      (now) => alive && setOn(now),
      (err: unknown) => alive && (setOn(false), setProblem(String(err))),
    );
    return () => {
      alive = false;
    };
  }, []);
  const change = async (want: boolean) => {
    setBusy(true);
    setProblem('');
    try {
      setOn(await setAutostart(want));
    } catch (err) {
      setProblem(String(err));
    }
    setBusy(false);
  };
  return (
    <section className="panel" aria-labelledby="startup-h">
      <h2 id="startup-h">Starting Logbook</h2>
      <label className="row">
        <input type="checkbox" checked={on === true} disabled={on === null || busy} onChange={(e) => void change(e.target.checked)} /> 🖥️ Open Logbook when you sign in to this computer
      </label>
      <p className="hint">Logbook opens by itself each time you sign in, ready to write in. This is this computer’s choice, not your journal’s.</p>
      {problem && (
        <p className="error" role="alert">
          Couldn’t change that: {problem}
        </p>
      )}
    </section>
  );
}
