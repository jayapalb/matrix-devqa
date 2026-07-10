/**
 * example coverage adapter — feeds example's coverage % into Touchstone's `coverage` signal.
 * Prove it before use:  node --test .qa/app-qa/coverage/
 *
 * This template INGESTS an lcov report example produced in your pipeline. Point EXAMPLE_LCOV in .env.test at it.
 * Built-in formats: 'lcov' | 'cobertura' | 'jacoco' | 'coverage-summary' (istanbul json-summary). For any
 * other shape, delete `format` and add a fail-safe `parse(text)` (garbage → null, never a phantom %).
 */
export default {
  name: 'example',
  enabled: false,                   // ⚪ OFF until ready — flip to true once implemented + wired (doctor shows ⚪→🟡→🟢)

  // An ALL-CAPS value is an env key (resolved from .env.test) so the committed adapter stays
  // machine-agnostic. A path (e.g. './coverage/lcov.info') also works.
  reportFile: 'EXAMPLE_LCOV',
  format: 'lcov',                   // 'lcov' | 'cobertura' | 'jacoco' | 'coverage-summary'

  // --- CUSTOM shape: delete `format` above and normalize yourself. Percentages 0–100; null = "not
  //     measured" (NEVER 0% for a missing metric). MUST be fail-safe or the conformance gate refuses it. ---
  // parse(text) {
  //   let r; try { r = JSON.parse(text); } catch { return null; }
  //   return { lines: r.line_pct, branches: r.branch_pct, functions: r.func_pct };
  // },

  // --- RUN alternative: delete reportFile/format and let Touchstone invoke example. execSync goes
  //     through the SHELL, so an npm-installed CLI's .cmd shim resolves on Windows too (execFileSync
  //     with a bare name would ENOENT there → the adapter silently idles). Touchstone bounds the call
  //     (`timeoutMs` on this adapter; default 10 min). ---
  // async run() {
  //   const { execSync } = await import('node:child_process');
  //   try { return { text: execSync('example --lcov', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }; }
  //   catch (e) { if (e.stdout) return { text: e.stdout }; throw e; }
  // },
};
