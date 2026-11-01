import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

// The walking Library's people and horror (D116): the Librarian and the Clerk, answering from a
// list for free, or in your own words with an API key; The Unwritten, with horror on; the PS1
// look; and the Encyclopedia that tells it all.

const text = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 40}`).join(' ');

async function write(page: Page, date: string, title: string, words: number) {
  await page.goto(`/#/new?date=${date}`);
  await page.getByLabel('Title').fill(title);
  await page.getByRole('textbox', { name: 'Entry text' }).click();
  await page.keyboard.insertText(text(words));
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await expect(page).toHaveURL(/#\/entry\//);
}

const place = (page: Page) => page.locator('.walk-place strong');
const world = (page: Page) => page.getByRole('application', { name: /The Library in 3D/ });
const below = (page: Page) => page.locator('.walk-bottom');

async function open(page: Page, prefs?: object) {
  await page.evaluate((prefs) => {
    localStorage.setItem('logbook.walk.help', 'seen');
    if (prefs) localStorage.setItem('logbook.library', JSON.stringify(prefs));
  }, prefs);
  await page.goto('/#/library');
  await page.reload();
  await expect(place(page)).not.toBeEmpty({ timeout: 20_000 });
  await expect(world(page)).toBeFocused();
}

async function talkTo(page: Page, who: 'librarian' | 'clerk') {
  await page.locator('#walk-goto').selectOption(`cast:${who}`);
  const name = who === 'librarian' ? 'The Librarian' : 'The Clerk';
  await expect(below(page)).toContainText(name);
  await page.keyboard.press('Enter');
  const talk = page.getByRole('dialog', { name });
  await expect(talk).toBeVisible();
  return talk;
}

test('the Librarian answers from her list, and takes you to the book', async ({ page }) => {
  await write(page, '2025-11-03', 'A year back', 40);
  await write(page, '2026-03-02', 'The long one', 900);
  await write(page, '2026-06-01', 'Short', 10);
  await open(page);
  const talk = await talkTo(page, 'librarian');
  await expect(talk.getByRole('log')).toContainText('Welcome back. 3 books on the shelves now.');
  await talk.getByRole('button', { name: 'How much have I written?' }).click();
  // Titles count: 3 + 40, 3 + 900 and 1 + 10 words.
  await expect(talk.getByRole('log')).toContainText('3 books and 957 words, across 2 galleries (2025, 2026). That’s about 319 words a book.');
  await talk.getByRole('button', { name: 'Any secrets around here?' }).click();
  await expect(talk.getByRole('log')).toContainText('One I can tell you about: the star by Logbook’s name likes attention.');
  // No key: the way to one, and no box to type in.
  await expect(talk.getByRole('link', { name: 'Settings → AI characters' })).toBeVisible();
  await expect(talk.getByRole('textbox')).toHaveCount(0);
  await talk.getByRole('button', { name: 'What’s my longest book?' }).click();
  await expect(talk.getByRole('log')).toContainText('“The long one”, from March 2, 2026: 903 words. It stands in Gallery 2026.');
  await talk.getByRole('button', { name: 'Take me there' }).click();
  await expect(talk).toHaveCount(0);
  await expect(world(page)).toBeFocused();
  await expect(below(page)).toContainText('📖 The long one');
  await expect(place(page)).toHaveText('Gallery 2026');
});

test('the Clerk finds your newest folder', async ({ page }) => {
  await write(page, '2026-06-01', 'Filed away', 20);
  await open(page);
  const talk = await talkTo(page, 'clerk');
  await expect(talk.getByRole('log')).toContainText('Storage. 1 folder, every one filed.');
  await talk.getByRole('button', { name: 'How far does it go?' }).click();
  await expect(talk.getByRole('log')).toContainText('thirty aisles past the last folder');
  await talk.getByRole('button', { name: 'Find my newest folder.' }).click();
  await talk.getByRole('button', { name: 'Show me the folder' }).click();
  await expect(below(page)).toContainText('🗂️ Filed away');
  await expect(place(page)).toHaveText(/^Storage room · Aisle 1$/);
});

/** Answers the Messages API as Claude would, and keeps what was sent. */
async function fakeClaude(page: Page, reply: (body: Record<string, unknown>) => { status: number; json: object }) {
  const sent: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } });
    const body = req.postDataJSON() as Record<string, unknown>;
    sent.push({ headers: await req.allHeaders(), body });
    const { status, json } = reply(body);
    return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(json) });
  });
  return sent;
}
const message = (text: string) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 20 },
});

test('with an API key: talk in your own words; numbers only unless titles are allowed, never the words', async ({ page }) => {
  await write(page, '2026-06-01', 'Secret garden diary', 30);
  await page.goto('/#/settings');
  const panel = page.getByRole('region', { name: '🤖 AI characters' });
  await panel.getByLabel('Anthropic API key').fill('sk-ant-test-1234');
  await panel.getByRole('button', { name: 'Save key' }).click();
  await expect(panel).toContainText('A key ending …1234 is saved on this device.');
  await expect(panel.getByLabel('Model')).toHaveValue('claude-opus-5-5');
  await expect(panel.getByRole('radio', { name: /Numbers only/ })).toBeChecked();
  const sent = await fakeClaude(page, () => ({ status: 200, json: message('Ah, a reader. Your one book waits in Gallery 2026.') }));
  await open(page);
  const talk = await talkTo(page, 'librarian');
  await talk.getByRole('button', { name: 'Who are you?' }).click();
  await talk.getByRole('textbox', { name: 'Say something to The Librarian' }).fill('Where is my book?');
  await talk.getByRole('button', { name: 'Say it' }).click();
  await expect(talk.getByRole('log')).toContainText('Ah, a reader. Your one book waits in Gallery 2026.');
  expect(sent).toHaveLength(1);
  const { headers, body } = sent[0]!;
  expect(headers.authorization).toBe('Bearer sk-ant-test-1234');
  expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
  expect(body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'low' } });
  // What was asked from the list comes along, then what was typed.
  const said = body.messages as { role: string; content: string }[];
  expect(said.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  expect(said.at(-1)!.content).toBe('Where is my book?');
  const system = String(body.system);
  expect(system).toContain('Books (entries): 1');
  expect(system).not.toContain('Secret garden diary');
  expect(JSON.stringify(body)).not.toContain('word17');
  await talk.getByRole('button', { name: 'Goodbye' }).click();
  // Titles too, when allowed; still never the words.
  await page.goto('/#/settings');
  await panel.getByRole('radio', { name: /Numbers and titles/ }).check();
  await open(page);
  const again = await talkTo(page, 'librarian');
  await again.getByRole('textbox').fill('Tell me about it');
  await again.getByRole('button', { name: 'Say it' }).click();
  await expect(again.getByRole('log')).toContainText('Ah, a reader.');
  expect(String(sent[1]!.body.system)).toContain('“Secret garden diary”');
  expect(JSON.stringify(sent[1]!.body)).not.toContain('word17');
});

test('a key that doesn’t work says so, in the conversation; removed, the list is all there is', async ({ page }) => {
  await write(page, '2026-06-01', 'Anything', 10);
  await page.evaluate(() => localStorage.setItem('logbook.ai', JSON.stringify({ key: 'sk-ant-bad' })));
  await fakeClaude(page, () => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }));
  await open(page);
  const talk = await talkTo(page, 'clerk');
  await talk.getByRole('textbox').fill('Hello?');
  await talk.getByRole('button', { name: 'Say it' }).click();
  await expect(talk.getByRole('log')).toContainText('That API key didn’t work. Check it in Settings → AI characters.');
  await talk.getByRole('button', { name: 'Goodbye' }).click();
  await page.goto('/#/settings');
  const panel = page.getByRole('region', { name: '🤖 AI characters' });
  await panel.getByRole('button', { name: 'Remove the key' }).click();
  await expect(panel.getByLabel('Anthropic API key')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('logbook.ai'))).toBeNull();
});

/** Into the empty galleries (past the first empty one after the books), and stopped there. */
async function intoTheDark(page: Page) {
  await page.locator('#walk-goto').selectOption('library');
  await world(page).focus();
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await expect(place(page)).toHaveText('Gallery 2028', { timeout: 30_000 });
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
}
/** Turns round (half a turn, with the arrow keys). */
async function turnAround(page: Page) {
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(1650);
  await page.keyboard.up('ArrowLeft');
}

test('horror off: nothing walks the empty galleries', async ({ page }) => {
  await write(page, '2026-06-01', 'Calm', 10);
  await open(page);
  await intoTheDark(page);
  await page.waitForTimeout(5000);
  await expect(below(page)).not.toContainText('Something is standing');
  await expect(page.locator('.walk')).not.toHaveAttribute('data-horror');
});

test('Unsettling: it appears further in, stays still while watched, and passes through you when your back is turned', async ({ page }) => {
  test.slow();
  await write(page, '2026-06-01', 'Brave', 10);
  await open(page, { horror: 'unsettling', sounds: false });
  await expect(page.locator('.walk')).toHaveAttribute('data-horror', 'unsettling');
  await intoTheDark(page);
  await expect(below(page)).toContainText('Something is standing further in, where the light doesn’t reach.', { timeout: 10_000 });
  // Watched: it doesn't come.
  await page.waitForTimeout(6000);
  await expect(below(page)).not.toContainText('Footsteps');
  await turnAround(page);
  await expect(below(page)).toContainText('Footsteps. Close behind you.', { timeout: 20_000 });
  await expect(below(page)).toContainText('Something cold passes through you, and is gone.', { timeout: 15_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(place(page)).toHaveText('Gallery 2028');
});

test('Intense: walked up to, it’s gone; back turned, it catches you, and you wake at the door', async ({ page }) => {
  test.slow();
  await write(page, '2026-06-01', 'Braver', 10);
  await open(page, { horror: 'intense', sounds: false });
  await intoTheDark(page);
  await expect(below(page)).toContainText('Something is standing further in', { timeout: 10_000 });
  // Straight at it, looking at it: gone.
  await page.keyboard.down('KeyW');
  await expect(below(page)).toContainText('It’s gone.', { timeout: 15_000 });
  await page.keyboard.up('KeyW');
  // It comes again further in; this time, back turned.
  await expect(below(page)).toContainText('Something is standing further in', { timeout: 30_000 });
  await turnAround(page);
  const scare = page.getByRole('alert').filter({ hasText: 'The Unwritten caught you.' });
  await expect(scare).toBeAttached({ timeout: 20_000 });
  await expect(scare).toHaveCount(0, { timeout: 5000 });
  await expect(place(page)).toHaveText('Gallery 2026');
  await expect(below(page)).toContainText('You wake at the Library’s door.');
  await expect(world(page)).toBeFocused();
});

test('the settings: horror, its sounds and the PS1 look, kept on this device', async ({ page }) => {
  await write(page, '2026-06-01', 'Settings', 10);
  await open(page);
  await page.getByRole('button', { name: 'Library settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Library settings' });
  await expect(dialog.getByRole('radio', { name: /^Off/ })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /Horror sounds/ })).toBeDisabled();
  await dialog.getByRole('radio', { name: /^Intense/ }).check();
  await expect(dialog.getByRole('checkbox', { name: /Horror sounds/ })).toBeEnabled();
  await dialog.getByRole('checkbox', { name: /PS1 look/ }).check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  const walk = page.locator('.walk');
  await expect(walk).toHaveAttribute('data-ps1', 'true');
  await expect(walk).toHaveAttribute('data-horror', 'intense');
  // Drawn small, about 240 pixels high, and shown big.
  await expect.poll(() => page.locator('.walk-canvas').evaluate((c: HTMLCanvasElement) => c.height)).toBeLessThanOrEqual(241);
  expect(await page.locator('.walk-canvas').evaluate((c) => getComputedStyle(c).imageRendering)).toBe('pixelated');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('logbook.library')!))).toEqual({ horror: 'intense', ps1: true, sounds: true });
  await page.reload();
  await expect(walk).toHaveAttribute('data-ps1', 'true');
  // The way to the Encyclopedia.
  await page.getByRole('button', { name: 'Library settings' }).click();
  await dialog.getByRole('link', { name: '📖 the Encyclopedia' }).click();
  await expect(page).toHaveURL(/#\/library\/encyclopedia$/);
});

test('the Encyclopedia: who’s who and what happens, for anyone who’d rather know first', async ({ page }) => {
  await page.goto('/#/library');
  await page.getByRole('navigation', { name: 'Library views' }).getByRole('link', { name: '📖 Encyclopedia' }).click();
  await expect(page).toHaveTitle('Encyclopedia · Library · Logbook');
  for (const who of ['The Librarian', 'The Clerk', 'The Unwritten']) await expect(page.getByRole('heading', { level: 3, name: who })).toBeVisible();
  await expect(page.getByRole('article', { name: 'The Unwritten' })).toContainText('It only moves while you aren’t looking at it.');
  await expect(page.getByText('On this device horror is Off')).toBeVisible();
  await expect(page.getByRole('link', { name: '✍️ New entry' })).toBeVisible();
});

test('talking and the settings are accessible', async ({ page }) => {
  await write(page, '2026-06-01', 'Accessible', 10);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const scan = async (label: string) => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      label,
    ).toEqual([]);
  };
  const talk = await talkTo(page, 'librarian');
  await talk.getByRole('button', { name: 'Who are you?' }).click();
  await scan('talking');
  await page.keyboard.press('Escape');
  await expect(talk).toHaveCount(0);
  await page.getByRole('button', { name: 'Library settings' }).click();
  await scan('settings');
});
