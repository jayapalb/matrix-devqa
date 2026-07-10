/**
 * example evidence gatherer — the app-tier seam for CUSTOM failure evidence. Runs ALONGSIDE Touchstone's
 * built-ins (screenshot · console · network · DB snapshot · system metrics) — you ADD, you don't replace.
 * Prove it before use:  node --test .qa/app-qa/evidence-gatherers/
 *
 * Ships INERT (`when: 'off'` — captures nothing). Flip `when` to 'on-failure' (or 'always'), then write
 * whatever diagnostic state helps triage: a log tail, a DB row dump, a shell command's output, a cloud-log
 * slice. `ctx` gives you: write(relPath, data) · connectDb() · baseURL · testInfo · failed.
 *
 * See the shipped library for real, copy-pasteable gatherers (log files, SQL, S3, SSH, CloudWatch, GraphQL):
 * `touchstone/examples/evidence-gatherers/`.
 */
export default {
  name: 'example',
  when: 'off',                          // ⚪ OFF — flip to 'on-failure' | 'always' to activate (doctor/reports show it dormant)
  // access: 'endpoint',                // 'endpoint' | 'runtime' | 'source' — evidence access level (default 'endpoint')

  async gather(ctx) {
    // Demo: write one small text file into THIS failure's evidence bundle. Replace with real diagnostics —
    // keep it diagnostic, not a data dump (tail/cap large sources). Throwing here never fails the run; the
    // error is recorded as `example.error.txt` in the bundle.
    const where = ctx.baseURL ? ` against ${ctx.baseURL}` : '';
    await ctx.write('example.txt', `example gatherer fired for "${ctx.testInfo?.title ?? 'a test'}"${where}.`);
  },
};
