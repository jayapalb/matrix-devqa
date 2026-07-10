/**
 * example scanner adapter — folds example's findings into Touchstone's ship verdict as the `scan:example`
 * signal. Prove it before use:  node --test .qa/app-qa/scanners/
 *
 * This template INGESTS a SARIF report example produced in your pipeline (the common case). Point
 * EXAMPLE_SARIF in .env.test at that file. Most scanners emit SARIF (Sonar/Snyk/CodeQL/Checkmarx/Trivy/…):
 * example likely has a `--sarif` / "export SARIF" option — wire it in CI, then this reads the result.
 *
 * Not SARIF? Delete `format` and add a `parse(text)` (see the commented example). Want Touchstone to
 * RUN the scanner instead of ingesting a report? Delete `resultsFile`/`format` and add `run()`.
 */
export default {
  name: 'example',
  enabled: false,                   // ⚪ OFF until ready — flip to true once implemented + wired (doctor shows ⚪→🟡→🟢)
  category: 'sast',                 // 'sast' | 'secrets' | 'dependency' | 'license' | 'iac' | 'custom' — a label
  level: 'high',                    // this scanner's default gate level (qualityPolicy.scanners can override)

  // INGEST a SARIF report your pipeline produced. An ALL-CAPS value is an env key (resolved from .env.test),
  // so the committed adapter stays machine-agnostic. A path (e.g. './artifacts/example.sarif') also works.
  resultsFile: 'EXAMPLE_SARIF',
  format: 'sarif',

  // --- NON-SARIF alternative: delete `format` above and normalize your report yourself. Be HONEST on
  //     garbage: return null for an UNREADABLE report (→ the run records a visible SKIP) — never zeros
  //     from junk ("0 findings" must mean the report really said so), never phantom findings. ---
  // parse(text) {
  //   let report; try { report = JSON.parse(text); } catch { return null; }   // unreadable → skip, not "0 findings, pass"
  //   const findings = (report.issues || []).map((i) => ({
  //     ruleId: i.rule, path: i.file, line: i.line,
  //     severity: ({ BLOCKER: 'critical', CRITICAL: 'high', MAJOR: 'moderate', MINOR: 'low' })[i.severity] || 'high',
  //     message: i.message,
  //   }));
  //   return { findings };            // Touchstone derives counts; or supply { counts, findings }
  // },

  // --- RUN alternative: delete resultsFile/format and let Touchstone invoke example. Two traps this
  //     shape avoids: execSync goes through the SHELL, so an npm-installed CLI's .cmd shim resolves on
  //     Windows too (execFileSync('example') would ENOENT there → the adapter silently idles); and many
  //     scanners exit NON-ZERO when findings exist — that's a report, not a failure, so keep e.stdout.
  //     Touchstone bounds the call (`timeoutMs` on this adapter; default 10 min). ---
  // async run() {
  //   const { execSync } = await import('node:child_process');
  //   try { return { text: execSync('example scan --sarif', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }; }
  //   catch (e) { if (e.stdout) return { text: e.stdout }; throw e; }         // non-zero exit WITH output = findings
  // },
};
