/**
 * The Unwritten's story (D118), told in the Encyclopedia, by the Librarian and the Clerk, and to
 * an AI that speaks for them: who he was, what he wants, how to stop him, and how to get by him.
 * Every "how" here is a rule the Library really follows (packages/core/src/library-haunt.ts).
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
    title: 'What he wants',
    text: 'To be read. Being looked at is the nearest he comes to it, so while you watch him he holds perfectly still. Turn away and he comes after you, because a reader who isn’t looking is a reader whose place he might take. He can’t bear to be studied close up: walk at him while you watch and he folds away like a page turned. And he can’t cross ink: where your writing is, he cannot follow.',
  },
];

/** Every way there is to stop him. */
export const STOPS: readonly { title: string; text: string }[] = [
  { title: 'Look at him', text: 'While he’s in your view he can’t move at all, however long you watch.' },
  { title: 'Walk straight at him', text: 'Keep watching as you go: a few steps away, he folds away and is gone for a while.' },
  { title: 'Go back to your writing', text: 'He can’t come where your books or folders are. He stops at the edge, and soon gives up.' },
  { title: 'Write today', text: 'Fresh ink is hard on him: on a day you’ve written an entry, he’s slower.' },
  { title: 'Open a book', text: 'While you read (or talk to someone, or open a menu), everything stands still, him too.' },
  { title: 'Turn horror off', text: '⚙️ → Horror → Off ends him at once, wherever you are.' },
];

/** How to get by him. */
export const STRATEGIES: readonly string[] = [
  'Walk away backwards (S, or the stick pulled back): he stays in front of you, and so stays still.',
  'Look behind you every few steps out there. He only gains while you aren’t looking.',
  'Listen. His footsteps come from where he is, louder as he nears; with headphones you can tell which side. Below the view, “Footsteps. Close behind you.” is your warning.',
  'Hurry (Shift). You run at 4.4 m/s; he never walks faster than 1.6.',
  'Read the signs. A gallery whose sign says “for who’s to come” is one where he walks.',
  'On Intense, if he catches you, you only wake at the door. Nothing of yours is lost, and he has to start again.',
];

/** The story in a few lines, for an AI speaking as the Librarian or the Clerk. */
export const BRIEF =
  'His name was Silas Quire, the Library’s first reader, who meant to write and never did; he walked further into the empty galleries every night to see what his books would look like, until one night he never came back, and the Library kept only a blank page of him. He wants to be read: being watched holds him still, being walked up to makes him fold away, he can’t cross ink (where the reader’s writing is), and on a day the reader has written, fresh ink slows him. The Librarian calls him Mr Quire; the Clerk calls him the tall gentleman and keeps his last, empty folder in a drawer.';
