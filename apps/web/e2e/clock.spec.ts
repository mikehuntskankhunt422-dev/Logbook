import { expect, test } from '@playwright/test';

// The clock (D92): alarms, a timer and a stopwatch, ringing on any page.

test('an alarm rings at its time, snoozes, and a once-only one turns itself off', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 13, 7, 58, 30) });
  await page.goto('/#/clock');
  await page.getByRole('button', { name: /Add an alarm/ }).click();
  const editor = page.getByRole('form', { name: 'New alarm' });
  await editor.getByLabel('Time').fill('08:00');
  await editor.getByLabel('Label').fill('Wake up');
  await editor.getByRole('button', { name: 'Save' }).click();
  const alarm = page.getByRole('switch', { name: /Wake up/ });
  await expect(alarm).toBeChecked();
  await expect(page.getByText('Next alarm in 2 minutes')).toBeVisible();

  // It rings on another page too.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Journal' }).click();
  await page.clock.fastForward('01:35');
  const ringer = page.getByRole('dialog', { name: 'Wake up' });
  await expect(ringer).toBeVisible();
  await ringer.getByRole('button', { name: /Snooze/ }).click();
  await expect(ringer).toBeHidden();
  await page.clock.fastForward('10:05');
  await expect(ringer).toBeVisible();
  await ringer.getByRole('button', { name: 'Stop' }).click();
  await expect(ringer).toBeHidden();

  // Rung once, it's off; and nothing rings again after a reload.
  await page.goto('/#/clock');
  await expect(alarm).not.toBeChecked();
  await page.reload();
  await page.clock.fastForward('00:05');
  await expect(ringer).toBeHidden();
});

test('the timer counts down, pauses and rings; the stopwatch keeps laps', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 13, 9, 0, 0) });
  await page.goto('/#/clock');
  await page.getByRole('tab', { name: /Timer/ }).click();
  await page.getByRole('button', { name: '1 min' }).click();
  await page.getByRole('button', { name: /Start/ }).click();
  const left = page.getByRole('timer');
  await expect(left).toHaveText('1:00');
  await page.clock.fastForward('00:20');
  await expect(left).toHaveText('0:40');
  await page.getByRole('button', { name: /Pause/ }).click();
  await page.clock.fastForward('00:30');
  await expect(left).toHaveText('0:40');
  await page.getByRole('button', { name: /Resume/ }).click();
  await page.clock.fastForward('00:41');
  const ringer = page.getByRole('dialog', { name: 'Time’s up' });
  await expect(ringer).toBeVisible();
  await ringer.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: /Start/ })).toBeVisible();

  await page.getByRole('tab', { name: /Stopwatch/ }).click();
  await page.getByRole('button', { name: /Start/ }).click();
  await page.clock.fastForward('00:05');
  await page.getByRole('button', { name: /Lap/ }).click();
  await page.clock.fastForward('00:03');
  await page.getByRole('button', { name: /Lap/ }).click();
  await page.getByRole('button', { name: /Stop/ }).click();
  const laps = page.getByRole('list', { name: 'Laps' }).getByRole('listitem');
  await expect(laps).toHaveCount(2);
  await expect(laps.first()).toContainText('Lap 2');
  await expect(laps.first()).toContainText('0:03.');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByRole('timer')).toHaveText('0:00.00');
});
