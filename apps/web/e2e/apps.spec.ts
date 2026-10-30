import { expect, test, type Page } from '@playwright/test';

// Your own apps (D111): pasted or opened from a file, run walled off from the journal, with what
// they save kept in it.

const COUNTER = `<!doctype html>
<html><head><title>Counter</title></head>
<body>
<button id="add">Add one</button> <output id="count"></output>
<p id="walls">checking…</p>
<script>
  const show = () => (document.getElementById('count').textContent = 'Count: ' + (localStorage.getItem('count') || '0'));
  document.getElementById('add').onclick = () => { localStorage.setItem('count', String(Number(localStorage.getItem('count') || 0) + 1)); show(); };
  show();
  const walls = [];
  try { walls.push('page: ' + parent.document.title); } catch { walls.push('page: walled off'); }
  try { walls.push('storage: ' + parent.localStorage.length); } catch { walls.push('storage: walled off'); }
  try { walls.push('cookies: ' + document.cookie); } catch { walls.push('cookies: walled off'); }
  document.getElementById('walls').textContent = walls.join(', ');
</script></body></html>`;

const frame = (page: Page) => page.frameLocator('iframe.app-frame');

async function paste(page: Page, code: string, name = '') {
  await page.goto('/#/apps');
  await page.getByLabel('Code').fill(code);
  if (name) await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Add app' }).click();
}

test('a pasted app runs walled off from Logbook, and what it saves is kept in the journal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Apps' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '🧩 Apps' })).toBeVisible();
  await expect(page.getByText('No apps yet.')).toBeVisible();
  await paste(page, COUNTER);
  await expect(page).toHaveURL(/#\/apps\/app[0-9a-z]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Counter' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('walled off');
  await expect(frame(page).locator('#walls')).toHaveText('page: walled off, storage: walled off, cookies: walled off');
  await frame(page).getByRole('button', { name: 'Add one' }).click();
  await frame(page).getByRole('button', { name: 'Add one' }).click();
  await expect(frame(page).locator('#count')).toHaveText('Count: 2');
  // Its frame has no origin of Logbook's.
  expect(await page.locator('iframe.app-frame').getAttribute('sandbox')).not.toContain('allow-same-origin');
  // Still there after a reload (once written), and after a restart straight after a change.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(frame(page).locator('#count')).toHaveText('Count: 2');
  await frame(page).getByRole('button', { name: 'Add one' }).click();
  await page.getByRole('button', { name: '↻ Restart' }).click();
  await expect(frame(page).locator('#count')).toHaveText('Count: 3');
  await page.waitForTimeout(500);
  await page.reload();
  await expect(frame(page).locator('#count')).toHaveText('Count: 3');
  // Listed with the others.
  await page.getByRole('link', { name: 'Your apps' }).click();
  await expect(page.getByRole('list', { name: 'Your apps' }).getByRole('link', { name: 'Counter' })).toBeVisible();
});

test('an app from a file, in plain JavaScript: renamed, its code edited, then deleted', async ({ page }) => {
  await page.goto('/#/apps');
  await page.getByTestId('app-file').setInputFiles({ name: 'hello_world.js', mimeType: 'text/javascript', buffer: Buffer.from("document.body.textContent = 'Hello from a file';") });
  await expect(page.getByRole('heading', { level: 1, name: 'hello world' })).toBeVisible();
  await expect(frame(page).locator('body')).toHaveText('Hello from a file');

  await page.getByRole('button', { name: 'Rename…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename this app' });
  await dialog.getByLabel('Name').fill('Greeter');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Greeter' })).toBeVisible();

  await page.getByRole('button', { name: '✏️ Edit code' }).click();
  const code = page.getByRole('form', { name: 'Greeter’s code' }).getByLabel('Code');
  await expect(code).toHaveValue("document.body.textContent = 'Hello from a file';");
  await code.fill("document.body.textContent = 'Hello again';");
  await page.getByRole('button', { name: 'Save and restart' }).click();
  await expect(frame(page).locator('body')).toHaveText('Hello again');

  await page.getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('dialog', { name: 'Delete Greeter?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/#\/apps$/);
  await expect(page.getByText('No apps yet.')).toBeVisible();
});

test('code that can’t run as it is gets a note, and nothing is added', async ({ page }) => {
  await page.goto('/#/apps');
  await page.getByRole('button', { name: 'Add app' }).click();
  await expect(page.getByRole('alert')).toHaveText('Paste the app’s code first.');
  await page.getByLabel('Code').fill("import React, { useState } from 'react';\nexport default function App() {\n  return <h1>Hi</h1>;\n}");
  await page.getByRole('button', { name: 'Add app' }).click();
  await expect(page.getByRole('alert')).toContainText('This looks like a React component');
  await page.getByTestId('app-file').setInputFiles({ name: 'app.zip', mimeType: 'application/zip', buffer: Buffer.from('PK\u0003\u0004') });
  await expect(page.getByRole('alert')).toContainText('app.zip is a zip file');
  await page.reload();
  await expect(page.getByText('No apps yet.')).toBeVisible();
});
