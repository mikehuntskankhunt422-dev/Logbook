/**
 * Writing prompts (D94): a question on a new, empty entry, for days when the page is blank. The
 * same one all day (picked by the date), another on request. Whether they show is this device's
 * choice, kept in the browser's storage rather than the journal.
 */

export const PROMPTS: readonly string[] = [
  'What made you smile today?',
  'What are three things you’re grateful for right now?',
  'What was the best part of your day?',
  'What’s something you learned today?',
  'Who did you talk to today, and what stayed with you?',
  'What’s on your mind that you haven’t said out loud?',
  'What would make tomorrow a good day?',
  'Describe where you are right now: the sounds, the light, the smells.',
  'What’s something small you’re looking forward to?',
  'What drained your energy today, and what gave it back?',
  'What’s a worry you can put down on paper and leave here?',
  'What did you do today that your past self would be proud of?',
  'What’s a memory that came back to you recently?',
  'If today had a title, what would it be?',
  'What’s something you’d like to remember about this week?',
  'What surprised you today?',
  'What’s a decision you’re thinking about? Write out both sides.',
  'Who are you thankful for, and have you told them?',
  'What did you eat today that you enjoyed?',
  'What are you reading, watching or listening to, and what do you think of it?',
  'What’s a goal you’re working towards? What’s the next small step?',
  'How are you feeling, honestly, in one word? Then say why.',
  'What would you tell a friend who had the day you had?',
  'What’s something you’re proud of that nobody noticed?',
  'Where did you feel most like yourself today?',
  'What’s a place you’d love to go back to? Describe it.',
  'What’s a habit you’d like to start, or stop?',
  'What made you laugh recently?',
  'What’s one thing you’d change about today, and one you wouldn’t?',
  'Write a letter to yourself a year from now.',
  'What’s something kind someone did for you lately?',
  'What’s a question you’ve been carrying around?',
  'What did your body need today? Did it get it?',
  'What’s a song that fits your mood, and why?',
  'What are you letting go of this week?',
  'Describe a person you saw today whose story you wondered about.',
  'What’s something you’re curious about at the moment?',
  'What was hard today, and how did you get through it?',
  'What does a perfect ordinary day look like for you?',
  'What’s the weather like, outside and inside you?',
];

/** Today's prompt, or another (`turn` steps through the list). */
export function promptFor(date: string, turn = 0): string {
  let h = 0;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PROMPTS[(h + turn * 7) % PROMPTS.length]!;
}

const KEY = 'logbook.prompts';

export function promptsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setPromptsOn(on: boolean): void {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'off');
  } catch {
    // Private browsing: the choice lasts until the page closes.
  }
}
