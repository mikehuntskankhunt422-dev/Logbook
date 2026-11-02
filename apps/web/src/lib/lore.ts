/**
 * The Unwritten's story (D118), told in the Encyclopedia, by the Librarian and the Clerk, and to
 * an AI that speaks for them: who he was, what he wants, how to stop him, and how to get by him.
 * Every "how" here is a rule the Library really follows (packages/core/src/library-haunt.ts).
 * D119: his notebook's pages, to find; his one book; and the cleverer ways he comes for you.
 */

export const NAME = 'Silas Quire';

/** His story, a paragraph at a time. */
export const STORY: readonly { title: string; text: string }[] = [
  {
    title: 'Who he was',
    text: 'Long before your first entry, the Library had one reader: Silas Quire. He meant to write. He bought the good paper, sharpened every pencil, and every night told the Librarian that tomorrow he would start. He never did. Instead he walked out into the galleries of the years to come, to see what his books would look like on their shelves, and every night he went one gallery further.',
  },
  {
    title: 'How he was lost',
    text: 'One night he walked so far that he couldn’t find his way back. The Library is made of what’s written, and there was nothing of him written for it to hold on to, so it kept the only thing he had left: a blank page. That is his face now, ruled and margined and empty. The Librarian still calls him Mr Quire. The Clerk calls him the tall gentleman, and keeps the last folder he ever took, empty, in a drawer.',
  },
  {
    title: 'His notebook',
    text: 'The only thing he ever wrote was a notebook he kept as he walked, and it came apart as he went. Its pages are still out there, one here, one there, lying on the empty shelves, and the Clerk keeps another in a drawer. Somewhere out there, too, is the one book he ever finished, if you can call it that.',
  },
  {
    title: 'What he wants',
    text: 'To be read. Being looked at is the nearest he comes to it, so while you watch him he holds perfectly still. Turn away and he comes after you, because a reader who isn’t looking is a reader whose place he might take. He can’t bear to be studied close up: walk at him while you watch and he folds away like a page turned. And he can’t cross ink: where your writing is, he cannot follow.',
  },
];

/** Every way there is to stop him. */
export const STOPS: readonly { title: string; text: string }[] = [
  { title: 'Look at him', text: 'While he’s in your view he can’t move. But stare too long and the lamps go out, and in the dark he can.' },
  { title: 'Walk straight at him', text: 'Keep watching as you go: a few steps away, he folds away and is gone for a while.' },
  { title: 'Go back to your writing', text: 'He can’t come where your books or folders are. He stops at the edge, and soon gives up.' },
  { title: 'Write today', text: 'Fresh ink is hard on him: on a day you’ve written an entry, he’s slower. The longer you go without writing, the bolder he gets: sooner, faster, and the lamps go out quicker.' },
  { title: 'Open a book', text: 'While you read (or talk to someone, or open a menu), everything stands still, him too.' },
  { title: 'Lay him to rest', text: 'Find all seven of his notebook’s pages. Then he stays away for as long as you keep writing (an entry today or yesterday).' },
  { title: 'Turn horror off', text: '⚙️ → Horror → Off ends him at once, wherever you are.' },
];

/** How to get by him. */
export const STRATEGIES: readonly string[] = [
  'Walk away backwards (S, or the stick pulled back): he stays in front of you, and so stays still. When the lamps go out, keep going: in the dark he’s coming.',
  'Look behind you out there: he only gains while you aren’t looking. But he learns. Look back often and he hangs back longer, then comes faster when you stop.',
  'He comes round the side, keeping just out of view. A glance to the side won’t catch him; turning round will.',
  'Listen, and stop now and then. His footsteps keep time with yours, so you hear them best standing still. They come from where he is, louder as he nears; below the view, “Footsteps. Close behind you.” is your warning.',
  'Hurry (Shift). You run at 4.4 m/s; he never walks faster than 2, even after a week without writing.',
  'Send him away too often by walking at him and he comes next time from the other side, between you and your books. Then the way home is through him: walk at him, watching.',
  'Read the signs. A gallery whose sign says “for who’s to come” is one where he walks.',
  'On Intense, turning round on him close behind you is a shock: he’s there, face to face, for a moment. Then he’s gone.',
  'From among your own books you may see him standing past the last lamp. He can’t come any closer. Look away and he’s gone.',
  'On Intense, if he catches you, you only wake at the door. Nothing of yours is lost, and he has to start again.',
];

export type PageId = 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6' | 'p7';

/**
 * His notebook's pages (D119): in the galleries where he walks, so many galleries past the first
 * of them (`gallery`), on a shelf; and one in the Clerk's drawer.
 */
export const PAGES: readonly { id: PageId; gallery: number | null; text: string }[] = [
  { id: 'p1', gallery: 0, text: 'Monday. Bought the good paper today, the cream laid, two reams. Sharpened all eleven pencils. Tomorrow I start.' },
  { id: 'p2', gallery: 1, text: 'Walked out to the next gallery to see where my first book will stand. Third shelf, I think, at eye height. Tomorrow.' },
  { id: 'p3', gallery: 3, text: 'The Librarian asked what my book is about. I said I’d know when I’d written it. She smiled the way people do when they’ve heard it before.' },
  { id: 'p4', gallery: 5, text: 'Further tonight. The shelves out here are so clean. Everything I haven’t written is waiting on them, in order. It’s beautiful, really. I could look at it for ever.' },
  { id: 'p5', gallery: 8, text: 'I can’t find the way back to the lamps. I’ve been walking towards them for hours. Every sign says the same: for what’s to come. One of them said for who’s.' },
  { id: 'p6', gallery: 11, text: 'Someone is reading over my shoulder. When I turn round there’s nobody there. I think it’s me. I think it’s me, later. He hasn’t got a face. Neither have I, now.' },
  { id: 'p7', gallery: null, text: 'If you find this: write something. Anything. A line a day. Ink is the only thing out here that stays where it’s put. Don’t wait for tomorrow. Tomorrow is where I am. S.' },
];

/** His one book, on an empty shelf so many galleries past the first where he walks (D119). */
export const HIS_BOOK = { gallery: 2, title: 'Silas Quire, Volume One' };

/** His book's pages: a title, nothing at all, and at the end, a line. Laid out for the reader. */
export function hisBook(intense: boolean): string {
  const blank = '<p class="quire-blank">&nbsp;</p>';
  return [
    '<div class="lbx-entry"><h1 class="lbx-title">Silas Quire</h1><p class="lbx-meta">Volume One</p></div>',
    ...Array.from({ length: 7 }, () => blank),
    `<p class="quire-blank quire-last">${intense ? 'Tomorrow. I’ll start tomorrow.<br><br>Don’t turn round.' : 'Tomorrow. I’ll start tomorrow.'}</p>`,
  ].join('');
}

/** The story in a few lines, for an AI speaking as the Librarian or the Clerk. */
export const BRIEF_PAGES =
  ' His notebook came apart as he walked: seven loose pages, six on the empty shelves out where he walks and one in the Clerk’s drawer; find all seven and he can be laid to rest, staying away while the reader keeps writing. His one book, Silas Quire, Volume One, stands alone on an empty shelf out there, blank but for its last page.';
export const BRIEF =
  'His name was Silas Quire, the Library’s first reader, who meant to write and never did; he walked further into the empty galleries every night to see what his books would look like, until one night he never came back, and the Library kept only a blank page of him. He wants to be read: being watched holds him still, being walked up to makes him fold away, he can’t cross ink (where the reader’s writing is), and on a day the reader has written, fresh ink slows him. The Librarian calls him Mr Quire; the Clerk calls him the tall gentleman and keeps his last folder in a drawer, empty but for one loose sheet.' + BRIEF_PAGES;
