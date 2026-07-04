// soak-metrics — pure analysis for the shell endurance/soak run.
//
// No I/O, no touchstone: given the /diagnostics samples collected while driving
// the shell through a simulated shift, decide whether the shell LEAKED. Kept
// pure so it can be unit-tested against synthetic leak / no-leak series
// (soak-metrics.test.mjs) — the detector has to be trusted to not lie in both
// directions: it must catch a slow real creep AND pass noisy-but-flat memory.
//
// Two independent leak signals, because they fail differently:
//
//   1. Discrete counters (webContents, windows, attached views, overrides, and
//      the bounded collections). These are CRISP — a view leak makes the count
//      climb monotonically; a healthy shell returns every counter to its
//      post-warmup baseline (or holds it under its documented cap). No
//      statistics needed: an off-by-one that never gets cleaned up shows here.
//
//   2. RSS / heap trend. Memory is NOISY (GC runs when it wants), so an
//      absolute high-water mark lies. We fit an ordinary-least-squares line and
//      ask two things together: does it climb STEADILY (R² above a floor, so
//      pure GC sawtooth doesn't trip it) AND does the climb projected over the
//      run we actually ran exceed a fraction of the baseline. Both must hold to
//      call it a leak.

// Ordinary-least-squares fit of y over x. Returns { slope, intercept, r2, n }.
// r2 (coefficient of determination) is the trend/noise discriminator: a steady
// climb → r2 near 1; GC sawtooth around a flat mean → r2 near 0.
export function linreg(points) {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pts.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? pts[0].y : 0, r2: 0, n };
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  if (sxx === 0) return { slope: 0, intercept: my, r2: 0, n }; // all x equal
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  // r2 = explained / total. syy === 0 → a perfectly flat line: no trend, r2 0.
  const r2 = syy === 0 ? 0 : (slope * sxy) / syy;
  return { slope, intercept, r2: Math.max(0, Math.min(1, r2)), n };
}

// Memory-trend verdict over post-warmup samples.
//   samples: [{ cycle, rss }]  (rss in bytes)
//   baselineRss: rss right after warmup (the reference point)
// A leak requires ALL of: positive slope, a real trend (r2 >= minR2), and a
// projected growth over the sampled span that exceeds maxGrowthFraction of
// baseline. Any one missing → not a leak (noise, or growth too small to matter
// over the run we actually drove).
export function analyzeMemory(samples, { baselineRss, maxGrowthFraction = 0.5, minR2 = 0.6, minSamples = 8 } = {}) {
  const pts = samples.map((s) => ({ x: s.cycle, y: s.rss }));
  const fit = linreg(pts);
  const spanCycles = pts.length >= 2 ? pts[pts.length - 1].x - pts[0].x : 0;
  const projectedGrowth = fit.slope * spanCycles; // bytes gained across the run
  const base = baselineRss || (pts[0]?.y ?? 0) || 1;
  const growthFraction = projectedGrowth / base;
  // Memory is noisy and the working set settles over the first samples (the
  // "warmup knee"). Below minSamples a single ramp dominates the fit and the
  // trend is not trustworthy in EITHER direction — so report it but don't gate.
  // A short smoke run still checks counters + liveness; only the nightly run
  // (dozens of samples) enforces the memory trend.
  const gated = pts.length >= minSamples;
  const leaked = gated && fit.slope > 0 && fit.r2 >= minR2 && growthFraction > maxGrowthFraction;
  return {
    ok: !leaked,
    leaked,
    gated,
    slopeBytesPerCycle: Math.round(fit.slope),
    r2: Number(fit.r2.toFixed(3)),
    projectedGrowthBytes: Math.round(projectedGrowth),
    growthFraction: Number(growthFraction.toFixed(3)),
    baselineRss,
    threshold: { maxGrowthFraction, minR2, minSamples },
    reason: !gated
      ? `RSS trend not gated — ${pts.length} sample(s) < ${minSamples} (smoke run; raise SOAK_CYCLES for a trend verdict)`
      : leaked
      ? `RSS climbs steadily (r²=${fit.r2.toFixed(2)}) by ${(growthFraction * 100).toFixed(0)}% of baseline over the run`
      : (fit.slope <= 0 ? 'RSS flat or falling'
        : fit.r2 < minR2 ? `RSS varies but no steady trend (r²=${fit.r2.toFixed(2)} < ${minR2})`
        : `RSS trend within budget (${(growthFraction * 100).toFixed(0)}% ≤ ${(maxGrowthFraction * 100).toFixed(0)}%)`),
  };
}

// Discrete-counter verdict.
//   samples: [{ cycle, state: { <name>: number } }]  (state as returned by /diagnostics)
//   counters: { <name>: { mode: 'cap'|'baseline', cap?, tol? } }
//   baseline: { <name>: number }  post-warmup reference for 'baseline'-mode counters
// 'cap' mode: the value must never exceed cap (bounded collection).
// 'baseline' mode — two orthogonal leak signals, so a slow climb is caught even
// before it "peaks" and a single mid-cycle sampling blip is NOT mistaken for one:
//   - residue: the FINAL sample (taken after the end-of-run settle) must be back
//     at/under baseline+tol. A leak doesn't spontaneously clean itself up, so a
//     counter still elevated at the end is the crispest signal.
//   - trend: an OLS fit over the run must not climb steadily (slope>0, r²≥floor,
//     net growth ≥1). Catches a leak sampled mid-climb; ignores a lone blip
//     (low r²) so sampling that races a cycle boundary doesn't false-fail.
export function analyzeCounters(samples, { counters, baseline = {}, trendMinR2 = 0.5 } = {}) {
  const results = {};
  const violations = [];
  const last = samples[samples.length - 1]?.state ?? {};
  for (const [name, cfg] of Object.entries(counters)) {
    const series = samples.map((s) => ({ cycle: s.cycle, v: s.state?.[name] }))
      .filter((p) => Number.isFinite(p.v));
    if (series.length === 0) { results[name] = { ok: true, note: 'not sampled' }; continue; }
    const values = series.map((p) => p.v);
    const max = Math.max(...values);
    const maxAt = series.find((p) => p.v === max)?.cycle;
    const finalV = last[name];
    const tol = cfg.tol ?? 0;
    if (cfg.mode === 'cap') {
      const limit = cfg.cap;
      const ok = max <= limit;
      results[name] = { mode: 'cap', ok, max, maxAt, cap: limit, final: finalV };
      if (!ok) violations.push(`${name}: peaked at ${max} (cap ${limit}) around cycle ${maxAt}`);
    } else {
      const base = baseline[name] ?? 0;
      const ceiling = base + tol;
      const fit = linreg(series.map((p) => ({ x: p.cycle, y: p.v })));
      const netGrowth = fit.slope * (series[series.length - 1].cycle - series[0].cycle);
      const residue = Number.isFinite(finalV) && finalV > ceiling;
      const trending = fit.slope > 0 && fit.r2 >= trendMinR2 && netGrowth >= 1;
      const ok = !residue && !trending;
      results[name] = { mode: 'baseline', ok, baseline: base, tol, max, maxAt, final: finalV, slopePerCycle: Number(fit.slope.toFixed(5)), r2: Number(fit.r2.toFixed(3)) };
      if (residue) violations.push(`${name}: did not return to baseline ${base}${tol ? `+${tol}` : ''} — final ${finalV} (residue)`);
      else if (trending) violations.push(`${name}: climbs steadily (r²=${fit.r2.toFixed(2)}, +${Math.round(netGrowth)} over run) above baseline ${base} (leak)`);
    }
  }
  return { ok: violations.length === 0, results, violations };
}

// Top-level soak verdict. Combines memory + counters + liveness into one object.
//   samples: post-warmup /diagnostics samples [{ cycle, rss, state }]
//   opts: { baselineRss, baseline, counters, memory?, liveness? }
// liveness: { mainAlive: bool, rendererCrashes: number, errorEvents: number }
export function analyzeSoak(samples, opts = {}) {
  const { baselineRss, baseline = {}, counters = {}, memory: memOpts = {}, liveness = {} } = opts;
  const memory = analyzeMemory(samples, { baselineRss, ...memOpts });
  const counterVerdict = analyzeCounters(samples, { counters, baseline });
  const live = {
    mainAlive: liveness.mainAlive !== false,
    rendererCrashes: liveness.rendererCrashes ?? 0,
    errorEvents: liveness.errorEvents ?? 0,
  };
  const livenessOk = live.mainAlive && live.rendererCrashes === 0;
  const violations = [
    ...(memory.leaked ? [`memory: ${memory.reason}`] : []),
    ...counterVerdict.violations,
    ...(!live.mainAlive ? ['liveness: main process not responding at end'] : []),
    ...(live.rendererCrashes > 0 ? [`liveness: ${live.rendererCrashes} renderer crash(es) during run`] : []),
  ];
  const ok = memory.ok && counterVerdict.ok && livenessOk;
  return {
    ok,
    verdict: ok ? 'NO-LEAK' : 'LEAK-SUSPECTED',
    samples: samples.length,
    memory,
    counters: counterVerdict.results,
    liveness: live,
    violations,
  };
}
