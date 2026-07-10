/**
 * example signal adapter — folds a custom quality dimension into the verdict as `signal:example`.
 * Prove it before use:  node --test .qa/app-qa/signals/
 *
 * measure(ctx) runs at teardown with the app still LIVE (ctx = { root, baseURL, runDir }). Return ONE of:
 *   { status: 'pass'|'review'|'hold'|'skip', reasons?, facts? }   — you decide
 *   { value, threshold, higherIsBetter?, reasons? }               — the framework judges vs the threshold
 *   { failing: true|false, reasons? }                             — explicit
 *   { skip: true, reason? }                                       — nothing to measure this run
 *
 * ADVISORY by default (shown, not gating) until you opt in with qualityPolicy.signals or `onFail` below.
 */
export default {
  name: 'example',
  enabled: false,                   // ⚪ OFF until ready — flip to true once implemented (doctor shows ⚪→🟢)
  category: 'custom',               // a label for the report
  onFail: 'review',                 // how a breach maps if the team hasn't set qualityPolicy.signals (or omit)

  async measure({ root, baseURL, runDir }) {
    // EXAMPLE — a bundle-size budget. Replace with YOUR dimension (license scan, a11y score, SLA probe…).
    const { statSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    let kb;
    try { kb = Math.round(statSync(resolve(root, 'dist/bundle.js')).size / 1024); }
    catch { return { skip: true, reason: 'no dist/bundle.js to measure (build first?)' }; }
    return { value: kb, threshold: 250, higherIsBetter: false, reasons: [`bundle ${kb}KB`], facts: { kb } };
  },
};
