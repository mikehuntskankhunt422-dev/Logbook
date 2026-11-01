import { useEffect, useId, useRef, useState } from 'react';
import { castMember, type CastId } from '@logbook/core';
import { href } from '../app/router.ts';
import { ask, useAiPrefs, type Said } from '../lib/ai.ts';
import { factsFor, greeting, persona, topics, type CastContext, type Take } from '../lib/cast.ts';

/**
 * Talking to the Librarian or the Clerk (D116): what they say, a list of things to ask (answered
 * on the device, for free), and, with an API key of your own, a box to say anything to them. An
 * answer that leads somewhere has a button that takes you there.
 */

const PORTRAIT: Record<CastId, string> = { librarian: '🧑‍🏫', clerk: '🗂️' };

type Line = { who: 'them' | 'you'; text: string; take?: Take } | { who: 'note'; text: string };

export function TalkDialog({ id, ctx, where, onTake, onClose }: { id: CastId; ctx: CastContext; where: string; onTake: (take: Take) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const ai = useAiPrefs();
  const name = castMember(id).name;
  const [lines, setLines] = useState<Line[]>(() => [{ who: 'them', text: greeting(id, ctx) }]);
  const [said, setSaid] = useState<Said[]>([]);
  const [draft, setDraft] = useState('');
  const [waiting, setWaiting] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [lines]);

  const asked = (text: string, reply: { text: string; take?: Take }) => {
    setLines((l) => [...l, { who: 'you', text }, { who: 'them', ...reply }]);
    // The AI hears it too, so a conversation can carry on from there.
    setSaid((s) => [...s, { role: 'user', text }, { role: 'assistant', text: reply.text }]);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || waiting) return;
    setDraft('');
    setLines((l) => [...l, { who: 'you', text }]);
    const next: Said[] = [...said, { role: 'user', text }];
    setSaid(next);
    setWaiting(true);
    const answer = await ask(ai, persona(id, ctx, factsFor(ctx.facts, ai.share), where), next);
    if (!alive.current) return;
    setWaiting(false);
    if (answer.ok) {
      setLines((l) => [...l, { who: 'them', text: answer.text }]);
      setSaid((s) => [...s, { role: 'assistant', text: answer.text }]);
    } else {
      setLines((l) => [...l, { who: 'note', text: answer.why }]);
      // What went unanswered isn't kept: the next message starts from the last answer.
      setSaid((s) => s.slice(0, -1));
    }
  };

  return (
    <dialog ref={dialog} className="talk" aria-labelledby={titleId} onClose={onClose}>
      <div className="talk-head">
        <span className="talk-portrait" aria-hidden="true">
          {PORTRAIT[id]}
        </span>
        <h2 id={titleId}>{name}</h2>
        <button type="button" className="btn btn-small" onClick={() => dialog.current?.close()}>
          Goodbye
        </button>
      </div>
      {/* Focusable, so it can be scrolled from the keyboard when it's long. */}
      <div className="talk-lines" role="log" aria-live="polite" aria-label={`What you and ${name} said`} tabIndex={0}>
        {lines.map((l, i) =>
          l.who === 'note' ? (
            <p key={i} className="talk-note">
              {l.text}
            </p>
          ) : (
            <div key={i} className={`talk-line talk-${l.who}`}>
              <p>
                <span className="sr-only">{l.who === 'you' ? 'You: ' : `${name}: `}</span>
                {l.text}
              </p>
              {l.who === 'them' && l.take && (
                <button type="button" className="btn btn-small btn-primary" onClick={() => onTake(l.take!)}>
                  {l.take.label}
                </button>
              )}
            </div>
          ),
        )}
        {waiting && (
          <p className="talk-line talk-them talk-waiting">
            <span className="sr-only">{name} is answering…</span>
            <span aria-hidden="true">…</span>
          </p>
        )}
        <div ref={end} />
      </div>
      <div className="talk-topics" role="group" aria-label="Ask">
        {topics(id, ctx).map((t) => (
          <button key={t.id} type="button" className="btn btn-small" disabled={waiting} onClick={() => asked(t.ask, t.reply)}>
            {t.ask}
          </button>
        ))}
      </div>
      {ai.key ? (
        <form
          className="talk-say"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor={`${titleId}-say`}>
            Say something to {name}
          </label>
          <input id={`${titleId}-say`} className="text-input" value={draft} maxLength={500} placeholder={`Say something to ${name}…`} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
          <button type="submit" className="btn btn-small btn-primary" disabled={waiting || !draft.trim()}>
            Say it
          </button>
        </form>
      ) : (
        <p className="hint talk-free">
          Answers from the list are free and stay on this device. To talk in your own words, add an Anthropic API key in <a href={href({ name: 'settings' })}>Settings → AI characters</a>.
        </p>
      )}
    </dialog>
  );
}
