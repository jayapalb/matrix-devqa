// Touchstone evidence gatherer — auto-discovered, runs after every case.
//
// Folds a full-OR snapshot (registry topology + events, per-agent telemetry,
// barco routes, planner readiness, vendor-sim truth, Electron shell audit tail
// + alarms + displays) into that test's evidence bundle. On failure it also
// grabs bounded container logs — so a red case carries everything needed to
// explain it, from every tier, without re-running.
//
// Enabled in qa.config.mjs: capture.gatherers = { 'or-state': 'always' }.

import { collectAllTiers, dockerLogs } from '../lib/or-evidence.mjs';

export default {
  name: 'or-state',
  when: 'always', // capture per-case even on green so we build a trend record
  async gather(ctx) {
    try {
      const bundle = await collectAllTiers(ctx.failed ? 'at-failure' : 'post-case');
      await ctx.write('or-state.json', JSON.stringify(bundle, null, 2));
    } catch (e) {
      await ctx.write('or-state-error.txt', `evidence collection failed: ${e.message}`);
    }
    // Container logs are heavier — only when the case failed.
    if (ctx.failed) {
      const logs = dockerLogs();
      for (const [svc, text] of Object.entries(logs)) await ctx.write(`logs/${svc}.log`, text);
    }
  },
};
