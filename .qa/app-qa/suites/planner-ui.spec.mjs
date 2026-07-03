// Planner UI — regression suite authored by qa-author from a qa-bughunter run.
//
// Codifies two findings against the running planner web app (docker :15500):
//  • @a11y — the layout controls found WITHOUT accessible names (fails until
//    the app adds aria-labels; the guard that proves the fix).
//  • @ux — rapid "Add source" persists ALL clicks (the confirmed-good
//    optimistic-concurrency behavior; guards against a future regression that
//    drops rapid edits).
//
// Browser-kind; navigates the planner directly (baseURL is the registry).
// Needs `make up`. See .qa/findings/2026-07-03-planner-layout-select-a11y.md.

import { test, expect } from 'touchstone';

const PLANNER_UI = process.env.PLANNER_WEB_URL || 'http://localhost:15500';
const PLANNER_API = `http://localhost:${Number(process.env.PLANNER_API_PORT || 14500)}`;

test.beforeEach(async ({ page }) => {
  const up = await fetch(PLANNER_UI).then((r) => r.ok).catch(() => false);
  test.skip(!up, 'planner-web not running — start `make up`');
  await page.goto(PLANNER_UI, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
});

test('@a11y layout controls have accessible names', async ({ page }) => {
  await page.getByRole('button', { name: '09 Layouts' }).first().click();
  await page.waitForTimeout(800);
  // Every interactive control on the Layouts surface must have an accessible
  // name (label / aria-label / aria-labelledby / title / a wrapping <label>).
  const unlabeled = await page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    return q('select, input:not([type=hidden]), textarea')
      .filter((el) => {
        const labelledById = el.id && document.querySelector(`label[for="${el.id}"]`);
        return !labelledById && !el.closest('label')
          && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')
          && !el.getAttribute('title') && !el.getAttribute('placeholder');
      })
      .map((el) => ({ tag: el.tagName.toLowerCase(), value: el.value }));
  });
  expect(unlabeled, `Layouts controls without accessible names: ${JSON.stringify(unlabeled)}`).toEqual([]);
});

test('@ux rapid Add-Source persists every click (optimistic concurrency)', async ({ page }) => {
  await page.getByRole('button', { name: '08 Sources' }).first().click();
  await page.waitForTimeout(800);
  const count = async () => (await fetch(`${PLANNER_API}/api/rooms/OR-03`).then((r) => r.json())).sources.length;

  const add = page.getByRole('button', { name: /add source/i }).first();
  test.skip((await add.count()) === 0, 'add-source control not present');
  const before = await count();
  await add.click(); await add.click(); await add.click(); // rapid triple-tap
  await page.waitForTimeout(3000); // saves + 412 reconciles settle

  // No rapid edit is lost: the 412-on-collision path reconciles, never drops.
  expect(await count(), 'all 3 rapid adds must persist').toBe(before + 3);
});
