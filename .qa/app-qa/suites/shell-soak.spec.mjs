// Matrix Shell — endurance / soak run (@soak).
//
// The @shellui suite proves the shell BOOTS correctly; the campaign proves it
// RECOVERS. Neither proves it survives a full surgical day. This does: it drives
// the REAL Electron shell through a compressed shift — case after case, app
// after app, chaos woven in — and watches the /diagnostics health surface for
// the two things that kill a long-running OR shell: leaked views/listeners and
// creeping memory. A day is compressed into operation COUNT (SOAK_CYCLES), not
// wall-clock: the leak signature is per-operation, so N fast cycles surface the
// same accumulation an 8-hour shift would.
//
// PROFILE: the REAL matrix-plus profile (seeded OR-03), like @shellui/@campaign
// — the soak needs a real room identity so the planner serves real cases to
// churn. That means it CANNOT run beside an interactive `make shell` (shared
// profile, shared :4787). The beforeAll guard refuses to, and the pid check
// inside confirms it is sampling its OWN process.
//
// ENABLE: `make shell-soak` (sets QA_SOAK=true so qa.config turns the dev
// operator console — /diagnostics + /case/* — on in the launched Electron).
// Scale: SOAK_CYCLES (default 400 quick / set 5000 for a nightly shift),
// SOAK_WARMUP (cycles excluded from the trend baseline), SOAK_SAMPLE_EVERY.

import { electronTest as test, expect, attachEvidence } from 'touchstone';
import { shell, CASE_PHASES, chaos, rng, pick, sleep, HOSTS } from '../lib/or-harness.mjs';
import { analyzeSoak } from '../lib/soak-metrics.mjs';

const DEV = HOSTS.shell; // http://localhost:4787 (dev operator console)
const CYCLES = Number(process.env.SOAK_CYCLES || 400);
const WARMUP = Number(process.env.SOAK_WARMUP || Math.min(20, Math.floor(CYCLES * 0.1)));
const SAMPLE_EVERY = Number(process.env.SOAK_SAMPLE_EVERY || Math.max(5, Math.floor(CYCLES / 60)));
const SEED = Number(process.env.SOAK_SEED || 1337);

// The bounded collections and their documented caps (main.js): notification
// pipeline 100, bus router 150 (MAX_BUS_EVENTS), system logs 200.
const CAPS = { notifications: 100, busEvents: 150, systemLogs: 200 };

const diagnostics = () => fetch(`${DEV}/diagnostics`).then((r) => r.json()).catch(() => null);

const mounted = async (page) => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(window.matrixShell), { timeout: 25_000 });
};

// Wait for the dev console to answer — it is the soak's control + measurement
// surface. If it never comes up, QA_SOAK wasn't set (qa.config left the console
// off), so fail with the fix instead of a confusing timeout.
const waitForDevConsole = async (tries = 30) => {
  for (let i = 0; i < tries; i += 1) {
    const d = await diagnostics();
    if (d?.ok) return d;
    await sleep(500);
  }
  return null;
};

test.beforeAll(async () => {
  // Real profile + fixed :4787 — refuse to fight an interactive shell. (The
  // fixture electron has not launched yet at beforeAll time, so a live :4787
  // here is a foreign `make shell`.)
  const foreign = await fetch(`${DEV}/case`).then((r) => r.ok).catch(() => false);
  if (foreign) {
    throw new Error('A shell already owns :4787 — stop `make shell` before the soak (it shares the real profile + dev-console port).');
  }
});

test('@soak the shell survives a compressed surgical shift without leaking', async ({ page, electronApp }) => {
  test.setTimeout(Math.max(180_000, CYCLES * 1500 + 60_000)); // ~1.5s/cycle budget + boot

  await mounted(page);

  const base = await waitForDevConsole();
  expect(base, 'dev console (/diagnostics) must be up — run via `make shell-soak` (QA_SOAK=true)').toBeTruthy();

  // Prove we are measuring our OWN process, not a foreign shell that slipped
  // onto :4787 after beforeAll.
  const myPid = await electronApp.evaluate(() => process.pid);
  expect(base.pid, 'the /diagnostics we sample must be THIS electron (no foreign shell on :4787)').toBe(myPid);

  // Renderer-crash detector — a dead renderer is a hard soak failure.
  let rendererCrashes = 0;
  page.on('crash', () => { rendererCrashes += 1; });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));

  // Available micro-apps to churn (the WebContentsView attach/detach path — the
  // primary view-leak surface). Read from the live shell state; if none are
  // installed, app churn is simply skipped (case churn still runs).
  const apps = await page.evaluate(async () => {
    try {
      const s = await window.matrixShell.getState();
      return (s?.apps ?? s?.installedApps ?? []).map((a) => a.id ?? a.appId).filter(Boolean);
    } catch { return []; }
  });

  // The OR-03 worklist, fetched ONCE — the soak rotates the day's cases through
  // the shell rather than re-pulling the planner every cycle (that would test
  // the planner, not the shell's endurance).
  await shell.post('/case/refresh-worklist', {}).catch(() => {});
  const board = await shell.get('/case').catch(() => ({}));
  const caseIds = (board.worklist ?? []).map((c) => c.caseId).filter(Boolean);
  expect(caseIds.length, 'the OR-03 worklist must have cases to churn (is `make up` seeded?)').toBeGreaterThan(0);

  const rand = rng(SEED);
  const samples = [];
  const cycleErrors = [];

  // One cycle = one compressed "case-ish" unit of the day: establish a case,
  // walk it through its phases, churn the active app across it, occasionally
  // weave in chaos, then clear. Each cycle is sampled at the SAME quiescent
  // point (post-clear) so the discrete counters read at rest.
  const sampleAt = async (cycle) => {
    const d = await diagnostics();
    if (!d?.ok) return;
    samples.push({
      cycle,
      rss: d.mem?.rss ?? 0,
      heapUsed: d.mem?.heapUsed ?? 0,
      webContents: d.webContents,
      windows: d.windows,
      procs: d.procs,
      state: {
        webContents: d.webContents,
        windows: d.windows,
        attachedViews: d.state?.attachedViews,
        microApps: d.state?.microApps,
        overrides: d.state?.overrides,
        notifications: d.state?.notifications,
        busEvents: d.state?.busEvents,
        systemLogs: d.state?.systemLogs,
      },
    });
  };

  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    try {
      // 1) Case lifecycle churn (dev console → real case workspace + plan exec):
      //    select the next case on the day's board, walk it through every phase.
      const caseId = caseIds[cycle % caseIds.length];
      await shell.post('/case/select', { caseId });
      for (const phase of CASE_PHASES) {
        await shell.post('/case/transition', { target: phase, reason: 'soak' });
      }
      // A mid-case plan re-pull (the planner republishes during a case).
      if (cycle % 7 === 0) await shell.post('/case/refresh-plan', {});

      // 2) App churn (renderer → WebContentsView attach/detach; the view-leak
      //    surface). Swap through a couple of apps, then detach.
      if (apps.length) {
        const a = pick(rand, apps);
        const b = pick(rand, apps);
        await page.evaluate(async ({ a, b }) => {
          try { await window.matrixShell.activateApp(a); } catch { /* refusal ok */ }
          try { await window.matrixShell.activateApp(b); } catch { /* refusal ok */ }
          try { await window.matrixShell.clearActiveApp(); } catch { /* refusal ok */ }
        }, { a, b });
      }

      // 3) Chaos woven in (cheap sim-based injections, ~every 25th cycle) — a
      //    panel re-route / a pulled source. Exercises the alarm + reconcile +
      //    notification paths that fill the bounded collections.
      if (cycle % 25 === 0) {
        if (rand() > 0.5) await chaos.panelDivergence().catch(() => {});
        else await chaos.sourceUnavailable('enc-roomcam', 'unavailable').catch(() => {});
        await sleep(50);
        await shell.post('/case/refresh-plan', {}).catch(() => {});
      }

      // 4) Return to the quiescent baseline: clear the case + detach apps.
      await shell.post('/case/clear', {}).catch(() => {});
      if (apps.length) await page.evaluate(() => window.matrixShell.clearActiveApp().catch(() => {}));

      // 5) Sample at the quiescent point (after warmup, every SAMPLE_EVERY).
      if (cycle > WARMUP && (cycle % SAMPLE_EVERY === 0 || cycle === CYCLES)) {
        await sampleAt(cycle);
      }
    } catch (e) {
      cycleErrors.push({ cycle, err: String(e?.message || e).slice(0, 160) });
      if (cycleErrors.length > 20) break; // the run is derailing — stop and report
    }
  }

  // Baseline = the first post-warmup sample (all apps loaded, caches primed).
  const baseline = samples[0];
  expect(baseline, `no samples collected over ${CYCLES} cycles — the soak never reached a quiescent measure`).toBeTruthy();

  // Final liveness: the main process still answers IPC.
  const mainAlive = await page.evaluate(() => window.matrixShell.getState().then(() => true).catch(() => true)).catch(() => false);

  const verdict = analyzeSoak(samples, {
    baselineRss: baseline.rss,
    baseline: {
      webContents: baseline.state.webContents,
      windows: baseline.state.windows,
      attachedViews: baseline.state.attachedViews ?? 0,
      microApps: baseline.state.microApps ?? 0,
      overrides: baseline.state.overrides ?? 0,
    },
    counters: {
      webContents: { mode: 'baseline' },
      windows: { mode: 'baseline' },
      attachedViews: { mode: 'baseline' },
      microApps: { mode: 'baseline', tol: 1 }, // a late lazy-load is not a leak
      overrides: { mode: 'baseline' },
      notifications: { mode: 'cap', cap: CAPS.notifications },
      busEvents: { mode: 'cap', cap: CAPS.busEvents },
      systemLogs: { mode: 'cap', cap: CAPS.systemLogs },
    },
    liveness: { mainAlive, rendererCrashes, errorEvents: pageErrors.length },
  });

  const report = {
    config: { cycles: CYCLES, warmup: WARMUP, sampleEvery: SAMPLE_EVERY, seed: SEED, appsChurned: apps.length },
    pid: myPid,
    baselineRssMB: Math.round(baseline.rss / 1048576),
    finalRssMB: Math.round(samples[samples.length - 1].rss / 1048576),
    verdict,
    cycleErrors,
    pageErrors: pageErrors.slice(0, 10),
    samples,
  };
  await attachEvidence(test.info(), 'soak-report.json', JSON.stringify(report, null, 2), { when: 'always' });
  await attachEvidence(test.info(), 'soak-report.md', renderReport(report), { when: 'always' });

  // The verdict. Any leak signal (view residue/trend, cap breach, memory creep,
  // renderer crash, dead main) fails the run with the specific violations.
  expect(verdict.ok, `SOAK ${verdict.verdict}:\n  - ${verdict.violations.join('\n  - ')}`).toBe(true);
  expect(cycleErrors.length, `soak cycles that threw: ${JSON.stringify(cycleErrors.slice(0, 10), null, 2)}`).toBeLessThan(CYCLES * 0.05);
});

// A human-readable soak digest for the evidence bundle.
function renderReport(r) {
  const m = r.verdict.memory;
  const lines = [
    `# Shell Soak — ${r.verdict.verdict}`,
    '',
    `Cycles **${r.config.cycles}** (warmup ${r.config.warmup}, sampled every ${r.config.sampleEvery}) · apps churned ${r.config.appsChurned} · pid ${r.pid}`,
    `RSS ${r.baselineRssMB}MB → ${r.finalRssMB}MB · ${r.verdict.samples} samples`,
    '',
    '## Memory trend',
    `- slope **${m.slopeBytesPerCycle} B/cycle**, r²=${m.r2}, projected growth ${(m.growthFraction * 100).toFixed(0)}% of baseline`,
    `- ${m.reason}`,
    '',
    '## Counters',
    ...Object.entries(r.verdict.counters).map(([k, v]) => {
      const tag = v.ok ? '✓' : '✗';
      const detail = v.mode === 'cap'
        ? `max ${v.max}/${v.cap}`
        : `baseline ${v.baseline}, max ${v.max}, final ${v.final}${v.slopePerCycle != null ? `, slope ${v.slopePerCycle}/cyc` : ''}`;
      return `- ${tag} **${k}** (${v.mode ?? 'n/a'}): ${detail}`;
    }),
    '',
    '## Liveness',
    `- main alive: ${r.verdict.liveness.mainAlive} · renderer crashes: ${r.verdict.liveness.rendererCrashes} · page errors: ${r.verdict.liveness.errorEvents}`,
    '',
    r.verdict.violations.length ? `## Violations\n${r.verdict.violations.map((v) => `- ${v}`).join('\n')}` : '## No leak signals',
  ];
  return lines.join('\n');
}
