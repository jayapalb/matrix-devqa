// Adversarial unit tests for the soak leak-detector. The detector gates a
// "world-class OR shell runs all day" claim, so it must not lie in EITHER
// direction: catch a slow real creep, and pass noisy-but-flat memory (GC is
// bursty — an absolute high-water mark would false-positive constantly).
//
// Run: node --test lib/__tests__/soak-metrics.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linreg, analyzeMemory, analyzeCounters, analyzeSoak } from '../soak-metrics.mjs';

const MB = 1024 * 1024;

// Deterministic pseudo-noise (no Math.random — reproducible, and the sandbox
// forbids it). A cheap LCG folded to [-1, 1].
function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

// ---- linreg -----------------------------------------------------------------

test('linreg recovers a known slope and reports r2≈1 on a clean line', () => {
  const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 100 + 3 * i }));
  const fit = linreg(pts);
  assert.ok(Math.abs(fit.slope - 3) < 1e-9, `slope ${fit.slope}`);
  assert.ok(fit.r2 > 0.999, `r2 ${fit.r2}`);
});

test('linreg reports r2≈0 on pure noise around a flat mean', () => {
  const rnd = noise(7);
  const pts = Array.from({ length: 200 }, (_, i) => ({ x: i, y: 500 + rnd() * 50 }));
  const fit = linreg(pts);
  assert.ok(fit.r2 < 0.1, `noise should have low r2, got ${fit.r2}`);
});

test('linreg degrades safely on <2 points', () => {
  assert.deepEqual(linreg([]).slope, 0);
  assert.deepEqual(linreg([{ x: 1, y: 9 }]).slope, 0);
});

// ---- analyzeMemory ----------------------------------------------------------

test('flat RSS with heavy GC sawtooth is NOT a leak', () => {
  const rnd = noise(42);
  // Oscillates ±40MB around 300MB — classic GC. No trend.
  const samples = Array.from({ length: 100 }, (_, i) => ({
    cycle: i * 50,
    rss: 300 * MB + rnd() * 40 * MB,
  }));
  const v = analyzeMemory(samples, { baselineRss: 300 * MB });
  assert.equal(v.leaked, false, `sawtooth flagged: ${v.reason}`);
  assert.equal(v.ok, true);
});

test('a slow steady creep that doubles RSS over the run IS a leak', () => {
  // 300MB → 600MB across 5000 cycles, with mild GC noise on top.
  const rnd = noise(99);
  const samples = Array.from({ length: 100 }, (_, i) => {
    const cycle = i * 50;
    return { cycle, rss: 300 * MB + (cycle / 5000) * 300 * MB + rnd() * 10 * MB };
  });
  const v = analyzeMemory(samples, { baselineRss: 300 * MB });
  assert.equal(v.leaked, true, `steady doubling not flagged: ${JSON.stringify(v)}`);
  assert.ok(v.growthFraction > 0.5);
});

test('a tiny steady climb below the budget is NOT flagged', () => {
  // Grows only ~10% of baseline across the whole run — real but within budget.
  const rnd = noise(5);
  const samples = Array.from({ length: 100 }, (_, i) => {
    const cycle = i * 50;
    return { cycle, rss: 300 * MB + (cycle / 5000) * 30 * MB + rnd() * 5 * MB };
  });
  const v = analyzeMemory(samples, { baselineRss: 300 * MB, maxGrowthFraction: 0.5 });
  assert.equal(v.leaked, false, `small climb over-flagged: ${v.reason}`);
});

test('too few samples → memory trend is reported but NOT gated (smoke run)', () => {
  // A steep ramp over only 5 samples (the warmup knee) must not be called a leak.
  const samples = Array.from({ length: 5 }, (_, i) => ({ cycle: i * 5, rss: 196 * MB + i * 6 * MB }));
  const v = analyzeMemory(samples, { baselineRss: 196 * MB });
  assert.equal(v.gated, false, 'should be ungated with <8 samples');
  assert.equal(v.leaked, false);
  assert.equal(v.ok, true);
  assert.match(v.reason, /not gated/);
});

test('RSS that falls (GC settling below baseline) is never a leak', () => {
  const samples = Array.from({ length: 50 }, (_, i) => ({ cycle: i * 50, rss: 400 * MB - i * MB }));
  const v = analyzeMemory(samples, { baselineRss: 400 * MB });
  assert.equal(v.leaked, false);
});

// ---- analyzeCounters --------------------------------------------------------

const baselineCounters = { webContents: 5, attachedViews: 0, microApps: 4, overrides: 0 };
const counterCfg = {
  webContents: { mode: 'baseline' },
  attachedViews: { mode: 'baseline' },
  microApps: { mode: 'baseline' },
  overrides: { mode: 'baseline' },
  notifications: { mode: 'cap', cap: 100 },
  busEvents: { mode: 'cap', cap: 150 },
  systemLogs: { mode: 'cap', cap: 200 },
};

function counterSamples(fn) {
  return Array.from({ length: 100 }, (_, i) => ({ cycle: i * 50, state: fn(i) }));
}

test('healthy run: views flat at baseline, collections fill under cap → OK', () => {
  const rnd = noise(3);
  const samples = counterSamples((i) => ({
    webContents: 5,
    attachedViews: 0,            // sampled at quiescent point → always detached
    microApps: 4,
    overrides: 0,
    notifications: Math.min(100, 30 + Math.floor(Math.abs(rnd()) * 60)), // fills toward cap, never over
    busEvents: Math.min(150, 50 + Math.floor(Math.abs(rnd()) * 90)),
    systemLogs: 200,             // sits pinned at cap — that's the cap holding, not a leak
  }));
  const v = analyzeCounters(samples, { counters: counterCfg, baseline: baselineCounters });
  assert.equal(v.ok, true, `healthy flagged: ${v.violations.join('; ')}`);
});

test('webContents climbing monotonically (view leak) is caught', () => {
  const samples = counterSamples((i) => ({
    webContents: 5 + Math.floor(i / 10), // slowly leaks views
    attachedViews: 0, microApps: 4, overrides: 0,
    notifications: 10, busEvents: 10, systemLogs: 10,
  }));
  const v = analyzeCounters(samples, { counters: counterCfg, baseline: baselineCounters });
  assert.equal(v.ok, false);
  assert.match(v.violations.join(' '), /webContents/);
});

test('attachedViews not returning to 0 (detach leak / residue) is caught', () => {
  const samples = counterSamples((i) => ({
    webContents: 5, microApps: 4, overrides: 0,
    attachedViews: i < 99 ? 0 : 1, // final sample still attached → residue
    notifications: 10, busEvents: 10, systemLogs: 10,
  }));
  const v = analyzeCounters(samples, { counters: counterCfg, baseline: baselineCounters });
  assert.equal(v.ok, false);
  assert.match(v.violations.join(' '), /attachedViews.*residue/);
});

test('a lone mid-run sampling blip (attachedViews=1 once, returns to 0) is NOT a leak', () => {
  const samples = counterSamples((i) => ({
    webContents: 5, microApps: 4, overrides: 0,
    attachedViews: i === 50 ? 1 : 0, // one sample raced a cycle boundary; settles back
    notifications: 10, busEvents: 10, systemLogs: 10,
  }));
  const v = analyzeCounters(samples, { counters: counterCfg, baseline: baselineCounters });
  assert.equal(v.ok, true, `blip false-flagged: ${v.violations.join('; ')}`);
});

test('a bounded collection breaching its cap is caught', () => {
  const samples = counterSamples((i) => ({
    webContents: 5, attachedViews: 0, microApps: 4, overrides: 0,
    notifications: i === 50 ? 140 : 40, // cap is 100 — this over-fills
    busEvents: 10, systemLogs: 10,
  }));
  const v = analyzeCounters(samples, { counters: counterCfg, baseline: baselineCounters });
  assert.equal(v.ok, false);
  assert.match(v.violations.join(' '), /notifications.*peaked at 140/);
});

test('overrides accumulating (break-glass not cleared per case) is caught', () => {
  const samples = counterSamples((i) => ({
    webContents: 5, attachedViews: 0, microApps: 4,
    overrides: Math.floor(i / 20), // grows: clear isn't resetting overrides
    notifications: 10, busEvents: 10, systemLogs: 10,
  }));
  const v = analyzeCounters(samples, { counters: counterCfg, baseline: baselineCounters });
  assert.equal(v.ok, false);
  assert.match(v.violations.join(' '), /overrides/);
});

// ---- analyzeSoak (integration of the pieces) --------------------------------

test('analyzeSoak: clean run → NO-LEAK', () => {
  const rnd = noise(11);
  const samples = Array.from({ length: 100 }, (_, i) => ({
    cycle: i * 50,
    rss: 300 * MB + rnd() * 20 * MB,
    state: { webContents: 5, attachedViews: 0, microApps: 4, overrides: 0, notifications: 50, busEvents: 60, systemLogs: 200 },
  }));
  const v = analyzeSoak(samples, {
    baselineRss: 300 * MB,
    baseline: baselineCounters,
    counters: counterCfg,
    liveness: { mainAlive: true, rendererCrashes: 0 },
  });
  assert.equal(v.ok, true, `clean run flagged: ${v.violations.join('; ')}`);
  assert.equal(v.verdict, 'NO-LEAK');
});

test('analyzeSoak: a renderer crash alone fails the verdict', () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({
    cycle: i * 50, rss: 300 * MB,
    state: { webContents: 5, attachedViews: 0, microApps: 4, overrides: 0, notifications: 10, busEvents: 10, systemLogs: 10 },
  }));
  const v = analyzeSoak(samples, {
    baselineRss: 300 * MB, baseline: baselineCounters, counters: counterCfg,
    liveness: { mainAlive: true, rendererCrashes: 1 },
  });
  assert.equal(v.ok, false);
  assert.match(v.violations.join(' '), /renderer crash/);
});

test('analyzeSoak: memory leak + healthy counters still fails (any signal fails)', () => {
  const samples = Array.from({ length: 100 }, (_, i) => {
    const cycle = i * 50;
    return {
      cycle,
      rss: 300 * MB + (cycle / 5000) * 400 * MB, // steep steady climb
      state: { webContents: 5, attachedViews: 0, microApps: 4, overrides: 0, notifications: 50, busEvents: 60, systemLogs: 200 },
    };
  });
  const v = analyzeSoak(samples, {
    baselineRss: 300 * MB, baseline: baselineCounters, counters: counterCfg,
    liveness: { mainAlive: true, rendererCrashes: 0 },
  });
  assert.equal(v.ok, false);
  assert.match(v.violations.join(' '), /memory/);
});
