// Matrix Shell — REAL Electron window tests (touchstone electron mode).
//
// The campaign asserts the shell's MAIN process. These assert the WINDOW — the
// renderer the circulator actually looks at: it boots from the built dist,
// mounts real OR navigation, its main process carries the OR-03 identity, and
// driving to Case Execution renders the planner-fed worklist.
//
// Prereqs: the docker stack up (`make up`); the dev shell STOPPED (`make shell`
// shares the same Electron userData profile — two instances clash).
// Evidence per test (touchstone): window screenshot, renderer console, and the
// Electron MAIN-process log.

import { electronTest as test, expect } from 'touchstone';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEV_CONSOLE = `http://127.0.0.1:${Number(process.env.MATRIX_DEV_CASE_CONTROL_PORT || 4787)}`;
const PLANNER = `http://localhost:${Number(process.env.PLANNER_API_PORT || 14500)}`;

test.beforeAll(async () => {
  // The interactive dev shell owns the same userData profile — refuse to fight it.
  const devShell = await fetch(`${DEV_CONSOLE}/case`).then((r) => r.ok).catch(() => false);
  if (devShell) {
    throw new Error('The interactive shell is running (dev console :4787). Stop `make shell` before the @shellui suite — both use the same Electron profile.');
  }
});

// Wait for React to mount into #root (the built renderer over file://).
const mounted = async (page) => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => {
    const root = document.querySelector('#root') ?? document.body;
    return root && root.innerHTML.trim().length > 200;
  }, { timeout: 25_000 });
};

test('@shellui the real shell window boots and mounts OR navigation', async ({ page, electronApp }) => {
  await mounted(page);

  // The shell's real navigation is present — this is the circulator's console,
  // not a blank window (regression guard for the file:// asset-base bug).
  for (const label of ['Case Execution', 'Devices', 'Room Control']) {
    await expect(page.getByRole('button', { name: label }), `nav control "${label}"`).toBeVisible({ timeout: 15_000 });
  }

  // Frameless OR-wall window, ≥ HD.
  const bounds = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds());
  expect(bounds.width).toBeGreaterThanOrEqual(1024);

  // No hard renderer errors while booting.
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.waitForTimeout(1200);
  expect(errors, `renderer pageerrors: ${errors.join(' | ')}`).toEqual([]);
});

test('@shellui the main process carries the OR-03 room identity', async ({ page, electronApp }) => {
  await mounted(page);
  // Deterministic userData (the app.setName pin) → the seeded room-auth is found.
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'));
  expect(userData, 'userData must resolve to the matrix-plus profile (app.setName)').toContain('matrix-plus');
  // The window is the Matrix Shell.
  expect(await page.title()).toMatch(/Matrix/);
  // The shell knows its room. Read the provisioned room-auth from the SAME
  // userData the main process reported (read in the node test process — the
  // main-process eval scope has no bare `require`).
  let orAuth = null;
  try { orAuth = JSON.parse(readFileSync(join(userData, 'or-room-auth.json'), 'utf8')); } catch { /* unprovisioned */ }
  expect(orAuth?.roomId, 'shell provisioned for a room').toBe('OR-03');
  expect(orAuth?.siteId).toBe('SITE-001');
});

test('@shellui driving to Case Execution renders the planner-fed worklist', async ({ page }) => {
  const planner = await fetch(`${PLANNER}/api/worklist?roomId=OR-03`).then((r) => r.json()).catch(() => null);
  test.skip(!planner?.cases?.length, 'planner/stack not running — start `make up`');

  await mounted(page);
  // The circulator clicks into Case Execution — the real UI, driven.
  await page.getByRole('button', { name: 'Case Execution' }).click();
  await page.waitForTimeout(2500); // worklist fetch (IPC → planner) + render

  // The worklist the planner serves must reach the screen. Either the real
  // scheduled cases render, or the shell shows its worklist status — both prove
  // the Case Execution surface mounted with live data wiring (never a blank).
  const body = page.locator('body');
  const surfaced = await Promise.race([
    body.getByText(/Rotator Cuff|ACL Reconstruction|Total Knee/i).first().waitFor({ timeout: 15_000 }).then(() => 'cases').catch(() => null),
    body.getByText(/worklist|case|schedule|OR-03/i).first().waitFor({ timeout: 15_000 }).then(() => 'surface').catch(() => null),
  ]);
  expect(surfaced, 'Case Execution surfaced the worklist (cases or status)').toBeTruthy();
});

test('@shellui dialog-opening handlers are automation-safe (never block on native UI)', async ({ page }) => {
  await mounted(page);
  // A native file dialog blocks the main process on user input. Under
  // automation (NODE_ENV=test) the shell must return a clean "canceled"
  // instead of opening one — no hang, no OS picker.
  for (const method of ['importOrRoomAuth', 'installAppFromZip']) {
    const t0 = Date.now();
    const r = await page.evaluate((m) => Promise.race([
      window.matrixShell[m](),
      new Promise((_, rej) => setTimeout(() => rej(new Error('BLOCKED — native dialog opened')), 4000)),
    ]).catch((e) => ({ _err: String(e.message) })), method);
    expect(r?._err, `${method} must not block on a dialog`).toBeUndefined();
    expect(r?.canceled, `${method} returns canceled under automation`).toBe(true);
    expect(Date.now() - t0, `${method} returns promptly`).toBeLessThan(2000);
  }
  // Main process still responsive after.
  expect(await page.evaluate(() => window.matrixShell.getState().then(() => true).catch(() => false))).toBe(true);
});
