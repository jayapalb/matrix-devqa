/**
 * example launcher — a custom way to prepare the QA environment. Select it with app.launcher: 'example' in
 * qa.config.mjs (or leave a single launcher file to auto-use). Prove it:  node --test .qa/app-qa/launchers/
 *
 * The safety guard, DB lifecycle, and mocks ALL run before this — a launcher only changes HOW the app/stack
 * comes up, never the safety posture. For a normal web app this can boot the app. For Electron, this can bring
 * up the backing stack (docker-compose, tunnel, emulator) while electronTest still launches the app per test.
 * start(ctx) must prepare the environment, wait until it's HEALTHY, and return how to reach it + tear it down.
 * Add gatherers below when this rig needs its own evidence bundle, e.g. { 'mq-flow-state': 'always' }.
 * Set evidenceAccess to endpoint | runtime | source depending on what evidence collectors can inspect.
 * THROW with an actionable message if it doesn't come up (a boot that didn't start must never look ready).
 * ctx = { baseURL, healthPath, config }.
 */
export default {
  name: 'example',
  enabled: false,                   // ⚪ OFF until ready — flip to true + set app.launcher: 'example' to boot via this (doctor shows ⚪→🟢)
  evidenceAccess: 'endpoint',        // endpoint = URLs/protocols only; runtime = Docker/VM/DB; source = runtime + source checkout
  gatherers: {},                     // optional: enable evidence gatherers when this launcher is selected

  async start({ baseURL, healthPath, config }) {
    // EXAMPLE — docker compose. Replace with YOUR environment prep (a tunnel, k8s port-forward, emulator…).
    const { execFileSync } = await import('node:child_process');
    const timeoutMs = config.app?.readyTimeoutMs || 120000;
    const down = () => { try { execFileSync('docker', ['compose', 'down', '-v'], { stdio: 'inherit' }); } catch { /* best-effort teardown */ } };
    // bounded — an image that never becomes healthy must not wedge the run forever
    execFileSync('docker', ['compose', 'up', '-d', '--wait'], { stdio: 'inherit', timeout: timeoutMs });

    // Wait until healthy before returning (the run assumes a live app the moment start() resolves).
    // ON FAILURE: tear the stack back down BEFORE throwing — a leaked compose stack would stay up,
    // stack more containers on every retry, and silently serve the NEXT run.
    const url = baseURL + (healthPath || '/');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try { if ((await fetch(url)).status < 500) break; } catch { /* not up yet */ }
      if (Date.now() > deadline) { down(); throw new Error(`example: app never became healthy at ${url} — compose stack torn back down`); }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return {
      baseURL,                       // or a URL the launcher discovered (a tunnel/preview URL)
      stop: async () => down(),
    };
  },
};
