import { href } from '../app/router.ts';
import { useAiPrefs } from '../lib/ai.ts';
import { useLibraryPrefs } from '../lib/library-prefs.ts';

/**
 * The Library's Encyclopedia (D116): who's who in the walking Library and what each of them does,
 * what horror brings and how to stay safe from it, so nothing there has to be a surprise unless
 * you want it to be. It tells everything, The Unwritten included.
 */

const HORROR = { off: 'Off', unsettling: 'Unsettling', intense: 'Intense' } as const;

export function Encyclopedia() {
  const prefs = useLibraryPrefs();
  const ai = useAiPrefs();
  return (
    <div className="ency">
      <p className="hint">
        Everything about the people of the walking Library and what can happen there, for anyone who’d rather know first. On this device horror is <strong>{HORROR[prefs.horror]}</strong>, the PS1 look is <strong>{prefs.ps1 ? 'on' : 'off'}</strong>, and
        the characters {ai.key ? 'can talk in your own words (AI)' : 'answer from their list of questions'}. Change any of it with <strong>⚙️</strong> in the Library.
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
          <p>With horror on, she’ll tell you what walks the empty galleries, and she warns you to keep near your books.</p>
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
          <p>With horror on, he’ll tell you that nobody works the far aisles.</p>
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
            Too tall and too thin, in a long black coat, with a blank page where its face should be: ruled lines and a margin, and nothing written on it. It walks the years nobody has written yet. What it does:
          </p>
          <ul>
            <li>A few seconds after you walk into the empty places, it’s there, further in, where the light doesn’t reach.</li>
            <li>It only moves while you aren’t looking at it. Look at it and it stands still, however long you watch.</li>
            <li>Turn your back and it comes on, without a sound but its footsteps, louder as it nears, from where it is.</li>
            <li>The lamps falter as it comes close, slowly. Now and then a sign out there reads “for who’s to come”.</li>
            <li>Walk up to it while you’re looking at it and it’s gone.</li>
            <li>It never comes where your writing is: go back to a gallery with your books (or an aisle with your folders) and it stops at the edge, then leaves.</li>
            <li>
              If it reaches you: on <strong>Unsettling</strong>, something cold passes through you and it’s gone. On <strong>Intense</strong>, its face fills the screen with a scream, and you wake at the door you came in by.
            </li>
          </ul>
        </div>
      </article>

      <h2>Staying safe</h2>
      <ul>
        <li>Keep it in front of you. Walk away backwards (S, or the stick pulled back) and it can’t move.</li>
        <li>Your own books and folders keep it out: the galleries and aisles with them in are always safe.</li>
        <li>Reading a book, talking to someone or opening a menu stops everything until you’re back.</li>
        <li>The footsteps and “Footsteps. Close behind you.” below the view are your warning. Screen readers hear them too.</li>
        <li>
          Too much? <strong>⚙️ → Horror → Off</strong> ends it at once, wherever you are.
        </li>
      </ul>

      <h2>The settings</h2>
      <dl className="ency-settings">
        <dt>Horror: Off</dt>
        <dd>As it always was: no Unwritten, the lamps steady. How Logbook starts.</dd>
        <dt>Horror: Unsettling</dt>
        <dd>The empty places go dark and something walks them. No jump scares: if it reaches you, it only passes through.</dd>
        <dt>Horror: Intense</dt>
        <dd>The same, faster, and if it reaches you, a jump scare: a sudden picture and a loud sound.</dd>
        <dt>Horror sounds</dt>
        <dd>A low hum where it walks, its footsteps, a breath when it goes, the scream. Off for silence; the words below the view still say what’s happening.</dd>
        <dt>PS1 look</dt>
        <dd>Drawn small and blown up into big pixels, with wobbling corners and fewer colours, like a 1990s console game. Fine on its own, too.</dd>
      </dl>

      <h2>Talking in your own words</h2>
      <p>
        The Librarian and the Clerk answer from their list of questions for free, on this device. If you have an Anthropic API key, add it in{' '}
        <a href={href({ name: 'settings' })}>Settings → AI characters</a> and you can also type anything to them; Claude answers in character. What you type, and what you let them know about your library (its numbers, and titles only if
        you say so), goes to Anthropic with your key, and costs a little on your account. Your entries’ words never leave the device.
      </p>
    </div>
  );
}
