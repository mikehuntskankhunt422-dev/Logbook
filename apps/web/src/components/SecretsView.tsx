import { href } from '../app/router.ts';
import { ALL_FOUND_SHIELDS, allFound, foundCount, prizeText, SECRETS, setPerk, useSecrets } from '../lib/secrets.ts';
import { formatLongDate } from './common.tsx';

/**
 * The Secrets page (D115), reached from Settings: what's been found and what it gave, where to
 * look for the rest, the perks to switch on and off, and the streak shields in hand.
 */
export function SecretsView() {
  const state = useSecrets();
  const n = foundCount(state);
  const every = allFound(state);
  return (
    <>
      <h1>🥚 Secrets</h1>
      <p className="secrets-count">
        Logbook has {SECRETS.length} secrets hidden in it. Each one you find gives you a <strong>new perk</strong> or a <strong>reward</strong>. You’ve found{' '}
        <strong>
          {n} of {SECRETS.length}
        </strong>
        .
      </p>
      <div className="meter secrets-meter" role="progressbar" aria-label="Secrets found" aria-valuemin={0} aria-valuemax={SECRETS.length} aria-valuenow={n}>
        <span style={{ width: `${Math.round((n / SECRETS.length) * 100)}%` }} />
      </div>

      <section className="panel" aria-labelledby="shields-h" style={{ marginTop: 18 }}>
        <h2 id="shields-h">🛡️ Streak shields</h2>
        <p className="shield-count">{state.shields}</p>
        <p className="hint">
          Miss a day and a shield keeps your writing streak going: one shield for each day missed, used by itself the next time you open Logbook, for a streak of two days or more. Shielded days don’t add to the streak, they just keep it. Rewards
          give you shields.
        </p>
        {state.shielded.length > 0 && <p className="hint">Days shields have kept: {[...state.shielded].sort().reverse().map((d) => formatLongDate(d)).join(', ')}.</p>}
      </section>

      <ul className="secret-list" aria-label="Secrets">
        {SECRETS.map((s) => {
          const day = state.found[s.id];
          const prize = s.prize;
          return (
            <li key={s.id} className="secret" data-found={day ? true : undefined}>
              <span className="secret-emoji" aria-hidden="true">
                {day ? s.emoji : '❔'}
              </span>
              <div className="secret-body">
                <h2 className="secret-name">
                  {day ? s.name : 'A secret'}
                  {day && <span className="muted"> · found {formatLongDate(day)}</span>}
                </h2>
                <p>{day ? s.found : s.hint}</p>
                <p className="secret-prize">{day ? prizeText(prize) : prize.kind === 'perk' ? 'Find it for: a new perk.' : `Find it for: ${prize.shields === 1 ? 'a streak shield' : `${prize.shields} streak shields`}.`}</p>
                {day && prize.kind === 'perk' && (
                  <>
                    <p className="hint">{prize.text}</p>
                    <label className="row">
                      <input type="checkbox" checked={state[prize.perk]} onChange={(e) => setPerk(prize.perk, e.target.checked)} /> {prize.title}
                    </label>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p style={{ marginTop: 18 }}>
        {every
          ? `✦ You found every secret. The star by Logbook’s name is gold, and you got ${ALL_FOUND_SHIELDS} more shields.`
          : `Find all ${SECRETS.length} and the ✦ by Logbook’s name turns gold, with ${ALL_FOUND_SHIELDS} more shields.`}
      </p>
      <p className="hint">Secrets, their perks and your shields belong to this device, like the garden’s perks: they don’t change your journal.</p>
      <p>
        <a href={href({ name: 'settings' })}>← Back to Settings</a>
      </p>
    </>
  );
}
