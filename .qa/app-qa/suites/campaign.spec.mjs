// OR CAMPAIGN — simulate procedures day in and day out, with chaos woven into
// the case, and measure how the system copes: does it auto-recover, fall back
// to manual, or correctly refuse an unsafe action?
//
// One test == one surgical case, run serially (a single OR). A suite run == a
// "day" of cases; repeat the run (CI cron / loop) for day-in-day-out trends.
// Each case attaches a data record; the suite writes an aggregate report.
//
// Scale with QA_CAMPAIGN_CASES (default 8). Seeded, so a day is reproducible.

import { test, expect, attachEvidence } from 'touchstone';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOSTS, DEVOPS_ROOT, command, agentState, agentHealth, deviceRow, topology, sleep, waitFor,
  chaos, shell, shellProbe, establishCase, advanceCase, rng, pick, phaseConformance, CASE_PHASES, getJson,
} from '../lib/or-harness.mjs';
import { collectAllTiers } from '../lib/or-evidence.mjs';
import { buildCaseTimeline } from '../lib/case-timeline.mjs';

const NUM_CASES = Number(process.env.QA_CAMPAIGN_CASES || 8);
const SEED = Number(process.env.QA_CAMPAIGN_SEED || 42);

// The exception vocabulary woven into procedures. Each returns a measured
// outcome record: { detected, recoveryMode, mttrMs, note }.
const SCENARIOS = {
  // A clean case — the baseline the chaos cases are measured against.
  async clean() {
    return { detected: false, recoveryMode: 'clean', mttrMs: 0, note: 'no fault injected' };
  },

  // A device is kicked out mid-case. Expect: Last-Will offline, advisory alarm,
  // automatic re-registration on recovery.
  async deviceDrop() {
    const t0 = Date.now();
    await chaos.killAgent('shaver-agent');
    const offline = await waitFor(async () => (await deviceRow('agent.shaver-or03'))?.presence?.state === 'offline', { tries: 8, gapMs: 1000 });
    const alarm = (await shellProbe()) ? await shell.waitForAlarm('DEVICE_OFFLINE_MID_CASE', 6) : null;
    await chaos.startAgent('shaver-agent');
    const back = await waitFor(async () => (await deviceRow('agent.shaver-or03'))?.presence?.state === 'online', { tries: 12, gapMs: 2000 });
    return {
      detected: Boolean(offline),
      recoveryMode: back ? 'auto-recovered' : 'unhandled',
      mttrMs: Date.now() - t0,
      note: `offline=${Boolean(offline)} alarm=${Boolean(alarm)} recovered=${Boolean(back)}`,
    };
  },

  // A vendor tech re-routes at the physical panel. Expect: agent folds display
  // truth, shell reconciler flags divergence, re-drive restores the plan.
  async panelDivergence() {
    const t0 = Date.now();
    await command(HOSTS.barco, { capability: 'routing', action: 'applyRoute', target: { displayId: 'disp.or3.main', slotId: 'slot-1' }, params: { sourceId: 'src.or3.endoscope' } });
    await sleep(400);
    await chaos.panelDivergence();
    const folded = await waitFor(async () =>
      (await agentState(HOSTS.barco)).capabilities.routing.routes.find((r) => r.displayId === 'disp.or3.main' && r.sourceId === 'src.or3.roomcam' && r.via === 'barco-event'),
      { tries: 10, gapMs: 400 });
    let flagged = null;
    if (await shellProbe()) { await shell.post('/display/reconcile', {}); flagged = await shell.waitForAlarm('DISPLAY_DIVERGENCE', 4); }
    // Re-drive restores the plan (the reconciler may already have done this —
    // with a live shell the heal can be FASTER than our fold-poll window).
    await command(HOSTS.barco, { capability: 'routing', action: 'applyRoute', target: { displayId: 'disp.or3.main', slotId: 'slot-1' }, params: { sourceId: 'src.or3.endoscope' } });
    const restored = await waitFor(async () =>
      (await agentState(HOSTS.barco)).capabilities.routing.routes.find((r) => r.displayId === 'disp.or3.main' && r.sourceId === 'src.or3.endoscope'),
      { tries: 6, gapMs: 400 });
    // Detection proof: the transient fold OR the shell's durable divergence
    // alarm — when the reconciler re-drives before our poll, the alarm is the
    // (stronger) evidence that the platform saw the manual change.
    return {
      detected: Boolean(folded || flagged),
      recoveryMode: restored ? 'auto-recovered' : 'unhandled',
      mttrMs: Date.now() - t0,
      note: `folded=${Boolean(folded)} flagged=${Boolean(flagged)} restored=${Boolean(restored)}${!folded && flagged ? ' (healed faster than the fold-poll — alarm is the proof)' : ''}`,
    };
  },

  // An unsafe op on an engaged device (requiresIdle while infusing). Expect a
  // clean refusal — safe by rejection, no recovery needed.
  async interlock() {
    const t0 = Date.now();
    await command(HOSTS.pump, { capability: 'infusion', action: 'start', params: { rateMlHr: 100 }, approval: { confirmed: true, by: 'clin:QA' } });
    await sleep(300);
    const cal = await command(HOSTS.pump, { capability: 'infusion', action: 'calibrate', params: {}, approval: { confirmed: true, by: 'clin:QA' } });
    await command(HOSTS.pump, { capability: 'infusion', action: 'stop', params: {} });
    const refused = cal.state === 'failed' || cal.ok === false;
    return { detected: refused, recoveryMode: refused ? 'refused-safe' : 'unhandled', mttrMs: Date.now() - t0, note: `calibrate ${refused ? 'refused' : 'ALLOWED'}` };
  },

  // Break-glass: the surgeon forces a source outside the plan. Expect it applied
  // and logged with actor + reason (the audited manual path) — or a
  // procedure-locked refusal. Both are correct; neither is silent.
  async breakGlass() {
    const t0 = Date.now();
    if (!(await shellProbe())) return { detected: false, recoveryMode: 'skipped', mttrMs: 0, note: 'shell not running' };
    const model = await shell.controlModel();
    const slot = (model.slots ?? [])[0];
    const source = (model.sources ?? [])[0];
    if (!slot || !source) return { detected: false, recoveryMode: 'unhandled', mttrMs: Date.now() - t0, note: 'no control model slots/sources' };
    const override = await shell.post('/display/override', { slotId: slot.id, displayId: slot.displayId, sourceId: source.id, reason: 'surgeon: forced source for final check' });
    const applied = override.ok === true;
    const locked = override.ok === false && /lock|procedure/i.test(String(override.reason || override.error || ''));
    return { detected: applied || locked, recoveryMode: applied ? 'manual-override' : (locked ? 'refused-safe' : 'unhandled'), mttrMs: Date.now() - t0, note: applied ? `override ${slot.id}←${source.id} logged` : `refused: ${override.reason || override.error}` };
  },

  // A source cable is pulled. Expect the system to reflect reality (availability
  // flips), then restore.
  async sourceLoss() {
    const t0 = Date.now();
    await chaos.sourceUnavailable('enc-endo', 'unavailable');
    // The endoscope encoder backs several planner ids (commissioned aliases);
    // availability may land under any of them.
    const ENDO_IDS = ['src.scope', 'src.or3.endoscope', 'enc-endo'];
    const gone = await waitFor(async () => {
      const s = (await agentState(HOSTS.barco)).capabilities.routing.sourceAvailability ?? {};
      return ENDO_IDS.some((id) => s[id] === 'unavailable');
    }, { tries: 8, gapMs: 500 });
    await chaos.sourceUnavailable('enc-endo', 'available');
    return { detected: Boolean(gone), recoveryMode: gone ? 'auto-recovered' : 'unhandled', mttrMs: Date.now() - t0, note: `availability reflected=${Boolean(gone)}` };
  },
};

// Build the day's case list: cycle scenarios with seeded variety.
const SCENARIO_KEYS = ['clean', 'deviceDrop', 'panelDivergence', 'interlock', 'breakGlass', 'sourceLoss'];
const PROCEDURES = [/rotator|cuff/i, /knee/i, /acl/i];
const buildCampaign = () => {
  const rand = rng(SEED);
  return Array.from({ length: NUM_CASES }, (_, i) => ({
    n: i + 1,
    scenario: SCENARIO_KEYS[i % SCENARIO_KEYS.length],
    procedure: pick(rand, PROCEDURES),
    injectPhase: pick(rand, ['in-procedure', 'in-procedure', 'room-prep']),
  }));
};
const CAMPAIGN = buildCampaign();
const results = [];

test.describe.serial('@campaign OR procedure campaign', () => {
  let shellOn = false;
  test.beforeAll(async () => {
    shellOn = await shellProbe();
    // The full story NEEDS the shell (case lifecycle, conformance, alarms).
    // Headless is only legitimate when explicitly allowed (CI sets it).
    if (!shellOn && process.env.QA_ALLOW_HEADLESS !== '1') {
      throw new Error('Electron shell is not running (dev console :4787 unreachable). Start it with `make shell`, or set QA_ALLOW_HEADLESS=1 for a device-tier-only run.');
    }
  });

  for (const c of CAMPAIGN) {
    test(`@campaign case ${c.n}/${NUM_CASES} — ${c.scenario} @ ${c.injectPhase}`, async ({}, testInfo) => {
      const record = { n: c.n, scenario: c.scenario, injectPhase: c.injectPhase, startedAt: new Date().toISOString(), shellOn };

      // 1) Establish the case (shell operator) + drive the room to a live state.
      if (shellOn) {
        const profile = await establishCase(c.procedure);
        record.caseId = profile?.caseId ?? null;
        record.procedure = profile?.procedureName ?? null;
        record.planId = (await shell.get('/case')).activeCase?.planBinding?.planId ?? null;
      }
      await command(HOSTS.lights, { capability: 'lighting', action: 'setScene', params: { scene: 'setup' }, approval: { confirmed: true, by: 'clin:QA' } });
      await command(HOSTS.barco, { capability: 'routing', action: 'applyRoute', target: { displayId: 'disp.or3.main', slotId: 'slot-1' }, params: { sourceId: 'src.or3.endoscope' } });
      await command(HOSTS.recorder, { capability: 'recording', action: 'start', params: { sourceId: 'src.or3.endoscope', caseId: record.caseId ?? 'C-QA' } });

      // 2) Walk the surgical phases; at each one let the shell drive the plan,
      //    then score plan-vs-actual conformance. Inject the case's chaos at
      //    its assigned phase.
      record.phases = [];
      let outcome = null;
      if (shellOn) {
        const walk = ['pre-op-timeout', 'in-procedure', 'closing'];
        // room-prep was entered by establishCase — score it first.
        await sleep(1800); // let the shell drive room-prep layouts/routes
        record.phases.push({ phase: 'room-prep', at: new Date().toISOString(), conformance: await phaseConformance('room-prep') });
        if (c.injectPhase === 'room-prep') { outcome = await SCENARIOS[c.scenario](); }
        for (const phase of walk) {
          const t = Date.now();
          await advanceCase(phase);
          await sleep(1800); // shell re-drives displays for the phase
          record.phases.push({ phase, advanceMs: Date.now() - t, at: new Date().toISOString(), conformance: await phaseConformance(phase) });
          if (!outcome && c.injectPhase === phase) { outcome = await SCENARIOS[c.scenario](); }
        }
      }
      // Apps tier: the plan's composited app surfaces must actually reach the
      // display host (windows agent records v0 compose-intents as composites).
      if (shellOn) {
        const expectedApps = new Set();
        for (const ph of ['room-prep', 'in-procedure']) {
          const exp = await shell.get(`/display/expected?phase=${ph}`).catch(() => null);
          for (const a of exp?.assignments ?? []) for (const app of a.composeApps ?? []) expectedApps.add(app);
        }
        const displayHost = `http://localhost:${Number(process.env.DISPLAY_PORT || 4540)}`;
        const hostState = await agentState(displayHost).catch(() => null);
        const composited = new Set((hostState?.capabilities?.display?.composites ?? []).map((x) => x.app));
        record.apps = {
          expected: [...expectedApps],
          composited: [...composited],
          missing: [...expectedApps].filter((a) => !composited.has(a)),
        };
      }

      if (!outcome) outcome = await SCENARIOS[c.scenario]();

      // 3) MEASURE how the room coped.
      Object.assign(record, outcome);
      const scored = record.phases?.filter((p) => p.conformance?.pct !== null && p.conformance?.ok) ?? [];
      record.conformancePct = scored.length
        ? Math.round(scored.reduce((s2, p) => s2 + p.conformance.pct, 0) / scored.length)
        : null;
      // Full cross-tier snapshot at the moment of/after the fault — the
      // evidence that explains WHY this case landed the way it did.
      attachEvidence(testInfo, `case-${c.n}-tiers.json`, await collectAllTiers(`post-${c.scenario}`), { when: 'always' });
      record.caseMayProceed = shellOn ? Boolean((await shell.get('/alarms')).caseMayProceed?.ok ?? true) : null;
      record.activeAlarms = shellOn ? (await shell.alarms()).map((a) => a.code) : [];

      // 4) Operator clears advisory alarms (the "return to baseline" step).
      if (shellOn) for (const a of await shell.alarms()) await shell.post('/alarm/acknowledge', { alarmId: a.id, reason: 'campaign case complete' });

      // 5) Stand the case down.
      await command(HOSTS.recorder, { capability: 'recording', action: 'stop', params: {} });
      if (shellOn) { await advanceCase('post-op'); }

      // Review loop: the planner must have ingested this case's lifecycle
      // events (matrix.caseEvent/1) — the Schedule→…→Review arc, closed.
      if (shellOn && record.caseId) {
        const review = await getJson(`${HOSTS.planner}/api/review`).catch(() => null);
        const entry = review?.cases?.find((x) => x.caseId === record.caseId);
        record.reviewEvents = entry?.metrics?.events ?? 0;
      }

      record.finishedAt = new Date().toISOString();

      // One chronological story per case, merged from every tier.
      try {
        const timeline = await buildCaseTimeline(record);
        record.phaseDurations = timeline.durations;
        attachEvidence(testInfo, `case-${c.n}-timeline.md`, timeline.md, { when: 'always' });
      } catch (e) { record.timelineError = String(e.message); }

      results.push(record);
      attachEvidence(testInfo, `case-${c.n}-${c.scenario}.json`, record, { when: 'always' });

      if (shellOn && record.caseId) {
        expect(record.reviewEvents, `case ${c.n} review-loop events ingested by the planner`).toBeGreaterThan(0);
      }
      if (shellOn && record.apps && record.apps.expected.length) {
        expect(record.apps.missing, `case ${c.n} app surfaces composited on the display host (expected ${record.apps.expected.join(',')})`).toEqual([]);
      }

      // 6) Assert the defensive contract for this scenario.
      expect(record.recoveryMode, `case ${c.n} (${c.scenario}) outcome`).not.toBe('unhandled');
      if (c.scenario !== 'clean' && c.scenario !== 'breakGlass') {
        expect(record.detected, `case ${c.n} (${c.scenario}) fault was detected`).toBe(true);
      }
    });
  }

  // The day's aggregate — the "how did the OR cope" report.
  test.afterAll(async () => {
    const byMode = {};
    for (const r of results) byMode[r.recoveryMode] = (byMode[r.recoveryMode] ?? 0) + 1;
    const withFault = results.filter((r) => r.scenario !== 'clean');
    const unhandled = results.filter((r) => r.recoveryMode === 'unhandled');
    const summary = {
      campaign: { cases: results.length, seed: SEED, shellOn: results[0]?.shellOn ?? false, at: new Date().toISOString() },
      recoveryModes: byMode,
      faultsInjected: withFault.length,
      faultsHandled: withFault.length - unhandled.length,
      unhandled: unhandled.map((r) => `case ${r.n} ${r.scenario}: ${r.note}`),
      mttr: {
        maxMs: Math.max(0, ...results.map((r) => r.mttrMs || 0)),
        avgMs: results.length ? Math.round(results.reduce((s, r) => s + (r.mttrMs || 0), 0) / results.length) : 0,
      },
      conformance: (() => {
        const scored = results.filter((r) => typeof r.conformancePct === 'number');
        return {
          casesScored: scored.length,
          avgPct: scored.length ? Math.round(scored.reduce((s, r) => s + r.conformancePct, 0) / scored.length) : null,
          perCase: Object.fromEntries(scored.map((r) => [`case-${r.n}`, r.conformancePct])),
        };
      })(),
      cases: results,
    };
    const dir = join(DEVOPS_ROOT, '.qa', 'artifacts', 'campaign');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'latest.json'), JSON.stringify(summary, null, 2));
    const lines = [
      `# OR Campaign — ${summary.campaign.cases} cases (seed ${SEED}, shell ${summary.campaign.shellOn ? 'on' : 'off'})`,
      '',
      `Faults injected: ${summary.faultsInjected} · handled: ${summary.faultsHandled} · unhandled: ${unhandled.length}`,
      `Recovery modes: ${Object.entries(byMode).map(([k, v]) => `${k}=${v}`).join(' · ')}`,
      `MTTR avg ${summary.mttr.avgMs}ms · max ${summary.mttr.maxMs}ms`,
      `Avg conformance: ${summary.conformance.avgPct ?? '—'}% · apps tier: ${results.filter((r) => r.apps && !r.apps.missing?.length && r.apps.expected.length).length}/${results.filter((r) => r.apps?.expected.length).length} cases composited all expected surfaces`,
      '',
      '| # | scenario | plan | conform% | recovery | detected | mttr(ms) | note |',
      '|---|---|---|---|---|---|---|---|',
      ...results.map((r) => `| ${r.n} | ${r.scenario} | ${(r.planId ?? '—').toString().slice(0, 22)} | ${r.conformancePct ?? '—'} | ${r.recoveryMode} | ${r.detected} | ${r.mttrMs} | ${r.note} |`),
    ];
    writeFileSync(join(dir, 'latest.md'), lines.join('\n') + '\n');
    console.log(`\n[campaign] ${summary.faultsHandled}/${summary.faultsInjected} faults handled · modes: ${Object.entries(byMode).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    console.log(`[campaign] report → .qa/artifacts/campaign/latest.md`);
  });
});
