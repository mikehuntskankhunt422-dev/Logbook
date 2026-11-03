import { href } from '../app/router.ts';
import { aiReady, provider, useAiPrefs } from '../lib/ai.ts';
import { useLibraryPrefs } from '../lib/library-prefs.ts';
import { HIS_BOOK, NAME, PAGES, STOPS, STORY, STRATEGIES } from '../lib/lore.ts';
import { setRest, useQuire } from '../lib/quire.ts';
import { CLERK_FOLDERS, CLERK_NAME, useClerkQuest } from '../lib/clerk-quest.ts';

/**
 * The Library's Encyclopedia (D116): who's who in the walking Library and what each of them does,
 * what horror brings and how to stay safe from it, so nothing there has to be a surprise unless
 * you want it to be. It tells everything, The Unwritten included: who he was, how to stop him and
 * how to get by him (D118); and the pages of his notebook you've found (D119).
 */

const HORROR = { off: 'Off', unsettling: 'Unsettling', intense: 'Intense' } as const;

export function Encyclopedia() {
  const prefs = useLibraryPrefs();
  const ai = useAiPrefs();
  const quire = useQuire();
  const quest = useClerkQuest();
  return (
    <div className="ency">
      <p className="hint">
        Everything about the people of the walking Library and what can happen there, for anyone who’d rather know first. On this device horror is <strong>{HORROR[prefs.horror]}</strong>, the PS1 look is <strong>{prefs.ps1 ? 'on' : 'off'}</strong>, and
        the characters {aiReady(ai) ? `can talk in your own words (through ${provider(ai.provider).name})` : 'answer from their list of questions'}. Change any of it with <strong>⚙️</strong> in the Library.
      </p>

      <h2>Who’s who</h2>
      <article className="ency-entry" aria-labelledby="ency-librarian">
        <span className="ency-portrait" aria-hidden="true">
          🧑‍🏫
        </span>
        <div>
          <h3 id="ency-librarian">The Librarian</h3>
          <p className="ency-where">In the first gallery, a little to the right of the way through as you come in, looking at the door.</p>
          <p>
            Keeps the Library: every entry you write comes to her as a book, and she shelves it by its day. Ask her how much you’ve written, about your longest book, what you were writing a year ago, where it all began or when you wrote the most;
            when an answer is a book, <strong>Take me there</strong> walks you to it. She knows a hint for the next of Logbook’s secrets.
          </p>
          <p>With horror on, she’ll tell you what walks the empty galleries, who he was, how to stop him and what’s left of him out there, and she warns you to keep near your books.</p>
        </div>
      </article>
      <article className="ency-entry" aria-labelledby="ency-clerk">
        <span className="ency-portrait" aria-hidden="true">
          🗂️
        </span>
        <div>
          <h3 id="ency-clerk">The Clerk</h3>
          <p className="ency-where">In the storage room, on the left a few steps in.</p>
          <p>
            Files every entry in a manila folder and grumbles about how far back the racks go. He finds your oldest and newest folders (<strong>Show me the folder</strong> walks you there), counts them, and knows a rumour about what’s thirty
            aisles past the last one.
          </p>
          <p>With horror on, he’ll tell you that nobody works the far aisles, what he remembers of the tall gentleman who used to come down for empty folders, and, if you ask, what’s in his drawer.</p>
          <p>
            Ask him if he needs a hand: three of his own folders went missing long ago, misfiled on the empty racks out past the last of yours (with horror on, all but the first are where The Unwritten walks). Bring them back and he gives you
            two streak shields and his lantern, by which the storage room’s lamps never go out on you.
          </p>
        </div>
      </article>
      <article className="ency-entry ency-unwritten" aria-labelledby="ency-unwritten">
        <span className="ency-portrait" aria-hidden="true">
          📄
        </span>
        <div>
          <h3 id="ency-unwritten">The Unwritten</h3>
          <p className="ency-where">Only with horror on. In the galleries past the first empty one after your newest book, and in the storage room from two aisles past your last folder.</p>
          <p>
            Once a man called <strong>{NAME}</strong>. Too tall and too thin now, in a long black coat, with a blank page where his face should be: ruled lines and a margin, and nothing written on it. He walks the years nobody has written yet.
            What he does:
          </p>
          <ul>
            <li>A few seconds after you walk into the empty places, he’s there, further in, where the light doesn’t reach: often in a doorway, half behind the jamb, as if he’d been looking round it.</li>
            <li>He only moves while you aren’t looking at him. Look at him and he stands still. But stare at him long enough and the lamps go out; in the dark, he comes.</li>
            <li>Turn your back and he comes on, round the side, keeping out of the edge of your view, without a sound but his footsteps. They keep time with yours.</li>
            <li>He learns. Look back at him often and he hangs back longer, then comes faster. Send him away too often and he comes from behind, between you and your books.</li>
            <li>Close, he whispers. Nothing you say to him; things about you, from your shelves.</li>
            <li>The longer it’s been since you wrote, the bolder he is: sooner, faster, and the lamps go out quicker.</li>
            <li>The lamps falter as he comes close, slowly. Now and then a sign out there reads “for who’s to come”. From among your books you may see him, standing past the last lamp.</li>
            <li>Walk up to him while you’re looking at him and he’s gone.</li>
            <li>He never comes where your writing is: go back to a gallery with your books (or an aisle with your folders) and he stops at the edge, then leaves.</li>
            <li>
              If he reaches you: on <strong>Unsettling</strong>, something cold passes through you and he’s gone. On <strong>Intense</strong>, his face fills the screen with a scream, and you wake at the door you came in by.
            </li>
          </ul>
        </div>
      </article>

      <h2>His story</h2>
      {STORY.map((part) => (
        <div key={part.title} className="ency-story">
          <h3>{part.title}</h3>
          <p>{part.text}</p>
        </div>
      ))}

      <h2>The Clerk’s folders</h2>
      <p>
        {quest.done
          ? `All three back with him. His name, it turns out, is ${CLERK_NAME}. You carry his lantern.`
          : `Found so far: ${quest.found.length} of ${CLERK_FOLDERS.length}, red-tabbed, on the empty racks past the last of your folders.${quest.found.length === CLERK_FOLDERS.length ? ' Take them back to him.' : ''}`}
      </p>
      {quest.found.length > 0 && (
        <ol className="ency-pages">
          {CLERK_FOLDERS.map((f) => (
            <li key={f.id}>
              {quest.found.includes(f.id) ? (
                <>
                  <strong>{f.title}</strong>
                  <blockquote className="quire-page clerk-page">{f.text}</blockquote>
                </>
              ) : (
                <span className="hint">Not found yet.</span>
              )}
            </li>
          ))}
        </ol>
      )}

      <h2>His notebook</h2>
      <p>
        {quire.found.length === PAGES.length
          ? quire.rest
            ? 'All seven pages found. He’s resting: he stays away for as long as you keep writing (an entry today or yesterday). Go two days without, and he’s back.'
            : 'All seven pages found, but you woke him. He walks again.'
          : `Seven loose pages, six on the empty shelves out where he walks and one in the Clerk’s drawer, only with horror on. Found so far: ${quire.found.length} of ${PAGES.length}. Find them all and he can be laid to rest. Out there too, ${HIS_BOOK.gallery} galleries past where he starts, stands ${HIS_BOOK.title}.`}
      </p>
      {quire.found.length > 0 && (
        <ol className="ency-pages">
          {PAGES.map((p) => (
            <li key={p.id}>{quire.found.includes(p.id) ? <blockquote className="quire-page">{p.text}</blockquote> : <span className="hint">Not found yet.</span>}</li>
          ))}
        </ol>
      )}
      {quire.found.length === PAGES.length && (
        <p className="row">
          <button type="button" className="btn btn-small" onClick={() => setRest(!quire.rest)}>
            {quire.rest ? 'Wake him' : 'Lay him to rest again'}
          </button>
        </p>
      )}

      <h2>How to stop him</h2>
      <dl className="ency-settings">
        {STOPS.map((s) => (
          <div key={s.title}>
            <dt>{s.title}</dt>
            <dd>{s.text}</dd>
          </div>
        ))}
      </dl>

      <h2>Strategies</h2>
      <ul>
        {STRATEGIES.map((s) => (
          <li key={s}>{s}</li>
        ))}
        <li>Screen readers hear every warning below the view too.</li>
      </ul>

      <h2>The settings</h2>
      <dl className="ency-settings">
        <dt>Horror: Off</dt>
        <dd>As it always was: no Unwritten, the lamps steady. How Logbook starts.</dd>
        <dt>Horror: Unsettling</dt>
        <dd>The empty places go dark and something walks them. No jump scares: if he reaches you, he only passes through.</dd>
        <dt>Horror: Intense</dt>
        <dd>The same, faster, and if he reaches you, a jump scare: a sudden picture and a loud sound.</dd>
        <dt>Horror sounds</dt>
        <dd>A low hum where he walks, his footsteps, a breath when he goes, the scream. Off for silence; the words below the view still say what’s happening.</dd>
        <dt>Winter</dt>
        <dd>While the Christmas or New Year theme is on (Settings → Holidays), snow falls in the galleries (not with reduced motion) and a small tree stands in the first.</dd>
        <dt>PS1 look</dt>
        <dd>Drawn small and blown up into big pixels, with wobbling corners and fewer colours, like a 1990s console game. Fine on its own, too.</dd>
      </dl>

      <h2>Talking in your own words</h2>
      <p>
        The Librarian and the Clerk answer from their list of questions for free, on this device. If you have an API key from Anthropic (Claude), OpenAI (ChatGPT), Google (Gemini), xAI (Grok) or OpenRouter, add it in{' '}
        <a href={href({ name: 'settings' })}>Settings → AI characters</a> and you can also type anything to them; the AI you chose answers in character. What you type, and what you let them know about your library (its numbers, and titles
        only if you say so), goes to that provider with your key, and costs a little on your account. Your entries’ words never leave the device.
      </p>
    </div>
  );
}
