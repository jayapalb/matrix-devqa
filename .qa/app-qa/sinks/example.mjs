/**
 * example verdict sink — publishes the finished ship verdict. Prove it:  node --test .qa/app-qa/sinks/
 *
 * publish(verdict, ctx) does a side effect. BEST-EFFORT: throwing is caught + journaled and NEVER breaks the
 * run or changes the verdict — publishing is downstream of the honest result. `verdict` is the confidence.json
 * object ({ shipVerdict, testConfidence, signals, totals, reasons, … }); ctx = { runDir, runId }.
 */
export default {
  name: 'example',
  enabled: false,                   // ⚪ OFF until ready — flip to true once implemented + wired (doctor shows ⚪→🟢)

  async publish(verdict, { runDir, runId }) {
    // EXAMPLE — post to a Slack-style webhook. Replace with YOUR sink (a dashboard POST, write JUnit-of-the-
    // verdict to runDir, push a TestRail run…). Put the URL in .env.test as EXAMPLE_WEBHOOK_URL (never hard-code secrets).
    const url = process.env['EXAMPLE_WEBHOOK_URL'];
    if (!url) return { skipped: 'EXAMPLE_WEBHOOK_URL unset in .env.test' }; // honest ⚪ skip — never a "📤 delivered" that delivered nothing
    const emoji = verdict.shipVerdict.includes('SHIP') ? ':large_green_circle:' : ':red_circle:';
    const text = `${emoji} *${verdict.shipVerdict}* — test confidence ${verdict.testConfidence}% (${verdict.totals.passed}✅/${verdict.totals.failed}❌) · run ${runId}`;
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  },
};
