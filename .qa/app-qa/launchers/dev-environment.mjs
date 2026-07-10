/**
 * dev-environment launcher — brings up the FULL Matrix+ development stack in Docker and waits until
 * it is healthy. Two ways to use it:
 *
 *   1. As a Touchstone launcher — set app.launcher: 'dev-environment' in qa.config.mjs.
 *   2. Standalone CLI (no QA):   cd .qa/app-qa/launchers
 *                                node dev-environment.mjs up        # build + start + wait healthy
 *                                node dev-environment.mjs down       # stop + remove (incl. volumes)
 *                                node dev-environment.mjs restart | ps | logs [svc] | urls
 *
 * Prove it conforms:  node --test .qa/app-qa/launchers/
 *
 * What it boots (see ./dev-environment/docker-compose.yml):
 *   mosquitto · matrix-device-registry · matrix-planner (api + ehr-adapter + web) ·
 *   matrix-audit-service · matrix-app-store · device agents (barco, streaming, system-with-displays)
 *   + registrar sidecars · matrix-shell (Electron, viewable over noVNC at http://localhost:6080/vnc.html)
 *
 * The safety guard, DB lifecycle, and mocks all run BEFORE this — a launcher only changes HOW the stack
 * comes up. start() must prepare the environment, wait until HEALTHY, and return how to reach it + tear it
 * down. It THROWS (after tearing the stack back down) if the stack never becomes healthy.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE_FILE = join(HERE, 'dev-environment', 'docker-compose.yml');
const COMPOSE = ['compose', '-f', COMPOSE_FILE];

const SHELL_URL = 'http://localhost:6080/vnc.html?autoconnect=1&resize=scale';

// Host-mapped endpoints we poll as an extra readiness gate (beyond compose --wait healthchecks).
// [label, url] — treated ready on ANY HTTP response (port is serving), which is enough for dev boot.
const ENDPOINTS = [
  ['device-registry', 'http://localhost:4430/health'],
  ['planner-api', 'http://localhost:4500/health'],
  ['ehr-adapter', 'http://localhost:4600/health'],
  ['planner-web', 'http://localhost:5500/'],
  ['audit', 'http://localhost:4460/'],
  ['app-store', 'http://localhost:4410/'],
  ['barco-agent', 'http://localhost:4550/health'],
  ['streaming-agent', 'http://localhost:4585/health'],
  ['system-agent', 'http://localhost:5050/health'],
  ['shell (noVNC)', 'http://localhost:6080/'],
];

function printUrls() {
  console.log([
    '',
    '  Matrix+ dev environment is up:',
    '  ─────────────────────────────────────────────',
    '   OR shell (noVNC) : ' + SHELL_URL,
    '   Planner UI       : http://localhost:5500/',
    '   Device registry  : http://localhost:4430/',
    '   EHR worklist     : http://localhost:4600/v1/worklist',
    '   App store        : http://localhost:4410/',
    '   Audit service    : http://localhost:4460/',
    '   Agents           : barco :4550 · streaming :4585 · system :5050',
    '   MQTT broker      : mqtt://localhost:1883',
    '  ─────────────────────────────────────────────',
    '',
  ].join('\n'));
}

const devEnvironment = {
  name: 'dev-environment',
  enabled: true,
  evidenceAccess: 'runtime', // Docker/VM: collectors may inspect containers, not app source
  gatherers: {},

  async start({ baseURL, config } = {}) {
    const timeoutMs = config?.app?.readyTimeoutMs || 900000; // building ~8 images can be slow on a cold cache

    const down = () => {
      try { execFileSync('docker', [...COMPOSE, 'down', '-v'], { stdio: 'inherit' }); }
      catch { /* best-effort teardown */ }
    };

    // Fail fast with a clear message if Docker isn't available.
    try { execFileSync('docker', ['version'], { stdio: 'ignore' }); }
    catch { throw new Error('dev-environment: Docker is not available — start Docker Desktop / the daemon and retry'); }

    // Build + start detached; --wait blocks on the compose healthchecks.
    console.log('[dev-environment] docker compose up -d --build --wait (first run builds images; this can take several minutes)…');
    try {
      execFileSync('docker', [...COMPOSE, 'up', '-d', '--build', '--wait'], { stdio: 'inherit', timeout: timeoutMs });
    } catch (err) {
      down();
      throw new Error(`dev-environment: stack did not come up healthy (${err.message}) — compose stack torn back down`);
    }

    // Belt-and-suspenders: confirm each host-mapped endpoint is actually serving.
    const deadline = Date.now() + 120000;
    for (const [label, url] of ENDPOINTS) {
      for (;;) {
        try { await fetch(url); break; } // any response => port is up
        catch {
          if (Date.now() > deadline) {
            down();
            throw new Error(`dev-environment: ${label} never answered at ${url} — compose stack torn back down`);
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }

    printUrls();

    return {
      baseURL: baseURL || SHELL_URL,
      stop: async () => down(),
    };
  },
};

export default devEnvironment;

// ── Standalone CLI ────────────────────────────────────────────────────────────────
// Runs ONLY when executed directly (`node dev-environment.mjs <cmd>`), never when Touchstone
// imports this module. Reuses start()/stop() so the standalone boot is identical to the QA boot.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const docker = (args) => execFileSync('docker', args, { stdio: 'inherit' });
  const cmd = process.argv[2] || 'up';
  try {
    switch (cmd) {
      case 'up': {
        const { baseURL } = await devEnvironment.start();
        console.log(`[dev-environment] ready — open ${baseURL}`);
        break; // containers run detached; the stack stays up until `down`
      }
      case 'down':
        docker([...COMPOSE, 'down', '-v']);
        break;
      case 'restart':
        docker([...COMPOSE, 'down', '-v']);
        await devEnvironment.start();
        break;
      case 'ps':
        docker([...COMPOSE, 'ps']);
        break;
      case 'logs':
        docker([...COMPOSE, 'logs', '-f', ...(process.argv[3] ? [process.argv[3]] : [])]);
        break;
      case 'urls':
        printUrls();
        break;
      default:
        console.error(`unknown command: ${cmd}\nusage: node dev-environment.mjs [up|down|restart|ps|logs [svc]|urls]`);
        process.exit(2);
    }
  } catch (err) {
    console.error(`[dev-environment] ${cmd} failed: ${err.message}`);
    process.exit(1);
  }
}
