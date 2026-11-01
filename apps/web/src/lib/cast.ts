import { castMember, type Book, type CastId, type HorrorLevel, type LibraryFacts } from '@logbook/core';
import { SECRETS, type SecretId } from './secrets.ts';
import { BRIEF } from './lore.ts';

/**
 * What the Librarian and the Clerk say (D116). Free and on the device: each has a list of things
 * to ask, answered from the library's own numbers (never the entries' words), and some lead to a
 * book or a folder. With horror on, they know what walks the empty places. With an API key of your
 * own (lib/ai.ts), you can also talk to them in your own words; `persona` is who they are then.
 */

export interface Take {
  kind: 'book' | 'folder';
  id: string;
  label: string;
}
export interface Reply {
  text: string;
  take?: Take;
}
export interface Topic {
  id: string;
  ask: string;
  reply: Reply;
}
export interface CastContext {
  facts: LibraryFacts;
  horror: HorrorLevel;
  found: ReadonlySet<SecretId>;
}

const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const monthName = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const title = (b: Book) => `“${b.title.trim() || 'Untitled'}”`;

/** A book to go to, as a book in the Library or a folder in the storage room. */
const take = (b: Book | null, kind: 'book' | 'folder'): Take | undefined => (b ? { kind, id: b.id, label: kind === 'book' ? 'Take me there' : 'Show me the folder' } : undefined);

/** The first secret not yet found, for a hint. */
const nextSecret = (found: ReadonlySet<SecretId>) => SECRETS.find((s) => !found.has(s.id));

export function greeting(id: CastId, ctx: CastContext): string {
  const { facts, horror } = ctx;
  if (id === 'librarian') {
    if (horror === 'intense') return 'You came back. Good. Stay where the lamps are lit, near your books.';
    if (horror === 'unsettling') return 'Ah, a reader. Mind the empty galleries today; the lamps are low out there.';
    return facts.books ? `Welcome back. ${count(facts.books, 'book')} on the shelves now. What can I find for you?` : 'Welcome. The shelves are ready whenever you are. What would you like to know?';
  }
  if (horror === 'intense') return 'Keep your voice down. Something’s been at the far racks again.';
  if (horror === 'unsettling') return 'Storage. Don’t go wandering past the last folder. What do you need?';
  return facts.books ? `Storage. ${count(facts.books, 'folder')}, every one filed. What do you need?` : 'Storage. Nothing filed yet. What do you need?';
}

export function topics(id: CastId, ctx: CastContext): Topic[] {
  return id === 'librarian' ? librarian(ctx) : clerk(ctx);
}

function librarian({ facts, horror, found }: CastContext): Topic[] {
  const none = 'Nothing yet. Write an entry and I’ll shelve it here as your first book.';
  const out: Topic[] = [
    {
      id: 'who',
      ask: 'Who are you?',
      reply: {
        text: 'I keep the Library. Every entry you write comes to me as a book, as thick as it is long, and I shelve it by its day: a gallery for each year, a shelf for each month. Past your newest book the galleries go on, empty, for good, waiting for what you haven’t written yet.',
      },
    },
    {
      id: 'how-much',
      ask: 'How much have I written?',
      reply: {
        text: facts.books
          ? `${count(facts.books, 'book')} and ${count(facts.words, 'word')}, across ${count(facts.years.length, 'gallery', 'galleries')} (${facts.years.join(', ')}). That’s about ${count(Math.round(facts.words / facts.books), 'word')} a book.`
          : none,
      },
    },
    {
      id: 'longest',
      ask: 'What’s my longest book?',
      reply: facts.longest ? { text: `${title(facts.longest)}, from ${longDate(facts.longest.date)}: ${count(facts.longest.words, 'word')}. It stands in Gallery ${facts.longest.date.slice(0, 4)}.`, take: take(facts.longest, 'book') } : { text: none },
    },
    {
      id: 'year-ago',
      ask: 'What was I writing a year ago?',
      reply: facts.yearAgo
        ? { text: `A year ago, near enough, you wrote ${title(facts.yearAgo)}, on ${longDate(facts.yearAgo.date)}.`, take: take(facts.yearAgo, 'book') }
        : { text: facts.books ? 'Nothing from around this time last year. The shelf for it is there, though, if you go looking.' : none },
    },
    {
      id: 'first',
      ask: 'Where does it all begin?',
      reply: facts.first ? { text: `With ${title(facts.first)}, on ${longDate(facts.first.date)}: the first book in the first gallery.`, take: take(facts.first, 'book') } : { text: none },
    },
    {
      id: 'busiest',
      ask: 'When did I write the most?',
      reply: { text: facts.busiest ? `${monthName(facts.busiest.month)}: ${count(facts.busiest.books, 'book')} on that shelf, more than any other month.` : none },
    },
  ];
  const secret = nextSecret(found);
  out.push({
    id: 'secrets',
    ask: 'Any secrets around here?',
    reply: { text: secret ? `One I can tell you about: ${secret.hint.charAt(0).toLowerCase()}${secret.hint.slice(1)}` : 'You’ve found every one. I’ve nothing left to tell you, and I’m a little proud of you.' },
  });
  if (horror !== 'off')
    out.push({
      id: 'unwritten',
      ask: 'What’s in the empty galleries?',
      reply: {
        text:
          horror === 'intense'
            ? 'The Unwritten. Tall, a long coat, a blank page where his face should be. He walks the years nobody has written, and he only moves when you aren’t looking. Never turn your back on him. If he reaches you, you’ll wake at my door.'
            : 'The Unwritten walks out there, in the years nobody has written. He only moves when you aren’t looking at him, and he can’t come where your books are. Walk up to him and he goes.',
      },
    });
  if (horror !== 'off')
    out.push(
      {
        id: 'who-was-he',
        ask: 'Who was he?',
        reply: {
          text: 'Mr Quire. Silas Quire, my first reader, long before you. He meant to write, every night, and never did; he’d walk out to see what his books would look like on the shelves, one gallery further each time. One night he didn’t come back. The Library kept what it could of him, which was a blank page.',
        },
      },
      {
        id: 'stop-him',
        ask: 'How do I stop him?',
        reply: {
          text: 'Look at him: he can’t move while he’s watched. Walk straight at him, watching, and he folds away. Come back to your books, because ink is a wall to him. And write something today: fresh ink slows him. If all else fails, the switch in ⚙️ sends him away for good.',
        },
      },
    );
  return out;
}

function clerk({ facts, horror, found }: CastContext): Topic[] {
  const none = 'Nothing filed yet. Write something and I’ll find it a folder.';
  const out: Topic[] = [
    {
      id: 'what',
      ask: 'What is this place?',
      reply: {
        text: 'Storage. Every entry you write, I file in a manila folder: its title typed on the label, a coloured tab for its mood, a green card before each month. Racks down both walls, further back than I’ve ever walked.',
      },
    },
    {
      id: 'oldest',
      ask: 'Find my oldest folder.',
      reply: facts.first ? { text: `${title(facts.first)}, ${longDate(facts.first.date)}. Aisle one, first rack. Where else.`, take: take(facts.first, 'folder') } : { text: none },
    },
    {
      id: 'newest',
      ask: 'Find my newest folder.',
      reply: facts.newest ? { text: `${title(facts.newest)}, ${longDate(facts.newest.date)}. Still warm.`, take: take(facts.newest, 'folder') } : { text: none },
    },
    {
      id: 'how-many',
      ask: 'How many folders are there?',
      reply: { text: facts.books ? `${count(facts.books, 'folder')} in ${count(facts.aisles, 'aisle')}. After that, empty racks. Lots of them.` : none },
    },
    {
      id: 'how-far',
      ask: 'How far does it go?',
      reply: {
        text: found.has('lastfolder')
          ? 'You went all the way down there, didn’t you. Nobody goes down there.'
          : 'Further than my legs. They say there’s something thirty aisles past the last folder. I don’t go.',
      },
    },
  ];
  if (horror !== 'off')
    out.push({
      id: 'who-else',
      ask: 'Who else works here?',
      reply: {
        text:
          horror === 'intense'
            ? 'Nobody works the far aisles. If you see someone down there, tall, coat, no face, that isn’t staff. Keep it in front of you and walk away backwards.'
            : 'Nobody works the far aisles. If you see someone down there, it isn’t staff. Don’t worry, it never comes where the folders are.',
      },
    });
  if (horror !== 'off')
    out.push({
      id: 'knew-him',
      ask: 'Did you know him?',
      reply: {
        text: 'The tall gentleman? Came down for empty folders, a dozen at a time, and filed them himself. Said he’d fill them. I’ve still got the last one he took, in my drawer. Never a word in it. Don’t you end up like that.',
      },
    });
  return out;
}

/** Who they are, for talking with them through an AI (lib/ai.ts). */
export function persona(id: CastId, ctx: CastContext, facts: string, where: string): string {
  const c = castMember(id);
  const who =
    id === 'librarian'
      ? 'You are the Librarian of the Library in Logbook, a private journaling app. The Library is like the Library of Babel: a line of hexagonal galleries, one for each year the person has written in, each journal entry a book on the shelves, as thick as the entry is long, shelved by its day. Past their newest book the galleries go on, empty, for good. Behind the first gallery a corridor leads to a storage room where every entry is also filed in a manila folder, kept by the Clerk. You are kind, dry, a little old-fashioned, and fond of the person’s books.'
      : 'You are the Clerk of the storage room in Logbook, a private journaling app. Every journal entry is filed here in a manila folder with its title typed on the label and a coloured tab for its mood, on metal racks down both walls of a hall that goes back for good. The Librarian keeps the Library of books through the corridor. You are gruff, practical, overworked and secretly kind.';
  const horror =
    ctx.horror === 'off'
      ? ''
      : ` Horror is switched on (${ctx.horror === 'intense' ? 'Intense: it can catch the reader and they wake at the Library’s door' : 'Unsettling: it never catches anyone'}). Something called The Unwritten walks the empty galleries past the newest book and the aisles past the last folder: tall, a long coat, a blank page where his face should be. ${BRIEF} You are uneasy about him and may warn about him, tell his story and say how to stop him, but you never describe anything gory.`;
  const secret = nextSecret(ctx.found);
  return `${who}${horror}

Facts about the person's library (from the shelves only; you cannot read what the entries say):
${facts}

They are standing in ${where}, talking to you (${c.name}).${secret ? ` If they ask about secrets, you may hint: ${secret.hint}` : ' They have found every secret hidden in Logbook.'}

Stay in character. Reply in one to three short sentences of plain text, with no markdown, lists or stage directions. Use only the facts above: never invent entries, titles, dates or what anything says. If they want to be taken to a book or folder, tell them to pick a question below that leads there, or use the Go to menu. Never ask for personal details.`;
}

/** The library's facts for an AI, as much as the person chose to share: numbers only, or titles too. */
export function factsFor(facts: LibraryFacts, share: 'numbers' | 'titles'): string {
  const b = (x: Book | null, what: string) => (x ? `- ${what}: ${share === 'titles' ? `${title(x)}, ` : ''}${x.date}, ${count(x.words, 'word')}` : `- ${what}: none`);
  return [
    `- Books (entries): ${facts.books}; words: ${facts.words}; years with books: ${facts.years.join(', ') || 'none'}; storage aisles with folders: ${facts.aisles}`,
    b(facts.first, 'First book'),
    b(facts.newest, 'Newest book'),
    b(facts.longest, 'Longest book'),
    b(facts.yearAgo, 'A book from about a year ago'),
    `- Busiest month: ${facts.busiest ? `${facts.busiest.month}, ${count(facts.busiest.books, 'book')}` : 'none'}`,
    share === 'numbers' ? '- (Titles are private: the person chose not to share them.)' : '',
  ]
    .filter(Boolean)
    .join('\n');
}
