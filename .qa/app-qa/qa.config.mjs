// Touchstone config for the Matrix Plus simulated OR.
//
// The target is the RUNNING docker stack (`make up`) — a multi-service OR, not
// a single web app — so `useRunningServer: true` (touchstone health-checks the
// registry and drives the live services; it never spawns the stack). Suites
// are `api`-kind (no browser): they drive the agents/registry/planner/shell
// over signed HTTP, exactly as run-surgery/run-chaos do.
//
// This is a DEV RIG we deliberately mutate (route, infuse, inject faults), so
// readOnly is false — but the safety opt-in still applies.

const REGISTRY = process.env.QA_BASE_URL || `http://localhost:${process.env.REGISTRY_PORT || 4430}`;

// The Matrix Shell's env (native Electron app): parse its .env so the REAL
// window launches with the same stack wiring the dev shell uses. The dev
// operator console is deliberately dropped (port clash with `make shell`) —
// electron tests drive the UI itself, not the console.
import { readFileSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const SHELL_DIR = resolvePath(HERE, '..', '..', '..', 'matrix-shell');
const shellEnv = (() => {
  const out = {};
  try {
    for (const line of readFileSync(resolvePath(SHELL_DIR, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*(MATRIX_[A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] !== 'MATRIX_DEV_CASE_CONTROL') out[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  } catch { /* shell .env absent — electron tests will fail visibly */ }
  // The @soak run is the ONE electron mode that needs the dev operator console:
  // it drives case lifecycle over /case/* and samples the /diagnostics health
  // surface. Enabled only on `make shell-soak` (QA_SOAK=true) — every other
  // electron mode keeps it off (port clash with an interactive `make shell`).
  if (process.env.QA_SOAK === 'true') {
    out.MATRIX_DEV_CASE_CONTROL = 'true';
    out.MATRIX_DEV_CASE_CONTROL_PORT = String(process.env.MATRIX_DEV_CASE_CONTROL_PORT || 4787);
  }
  return out;
})();

export default {
  touchstoneVersion: 1,

  // The stack is already up (make up). Just confirm the registry is serving.
  // `electron` (EXPERIMENTAL touchstone mode): launch the REAL Matrix Shell
  // window from matrix-shell — no vite (loads the built dist renderer).
  app: {
    useRunningServer: true, healthPath: '/health', readyTimeoutMs: 20_000,
    electron: {
      main: '../matrix-shell/electron/main.js',
      cwd: '../matrix-shell',
      env: shellEnv,
      // Isolation (touchstone 0.8.1): the fuzz run gets a THROWAWAY tmpdir
      // profile (touchstone mints it + passes QA_USERDATA_DIR + --user-data-dir;
      // main.js honors QA_USERDATA_DIR). @shellui/@campaign keep the REAL
      // matrix-plus profile (they assert the SEEDED OR-03 room-auth) — explicit
      // `false` says "I mean the real profile" and silences the shared-profile
      // warning. Set QA_EPHEMERAL_USERDATA=true only on the fuzz run.
      ephemeralUserData: process.env.QA_EPHEMERAL_USERDATA === 'true',
    },
  },
  baseURL: REGISTRY,

  // Fold the shell's OWN test estate (electron main units + renderer panels)
  // into the ship verdict as the `external` signal (touchstone 0.8.0) — so a
  // 🟢 SHIP reflects the whole shell, not just what touchstone drives directly.
  // Runs at teardown of the VERDICT runs (`npm run qa` / `qa:campaign`); the
  // targeted dev runs (qa:shell/qa:fuzz/qa:planner) set QA_SKIP_EXTERNAL=true to
  // stay fast. (Conformance certifier + system runners are declarable here too;
  // the scope line discloses them until they are.)
  externalSuites: process.env.QA_SKIP_EXTERNAL === 'true' ? [] : [
    { name: 'shell-units', command: 'npm', args: ['run', 'check'], cwd: '../matrix-shell', timeoutMs: 300_000 },
  ],

  // Custom categories layered onto the default taxonomy: the OR campaign is a
  // resilience discipline (chaos woven into real procedures), reported apart
  // from plain functional flows.
  categories: {
    campaign: { tag: '@campaign', label: 'OR Campaign', kind: 'api', weight: 3, desc: 'Multi-case procedures with woven chaos + recovery' },
    shellui: { tag: '@shellui', label: 'Shell (Electron)', kind: 'browser', weight: 3, desc: 'The REAL Matrix Shell window — renderer truth' },
    a11y: { tag: '@a11y', label: 'Accessibility', kind: 'browser', weight: 2, desc: 'Screen-reader / labels / roles' },
    fuzz: { tag: '@fuzz', label: 'Shell IPC Fuzz', kind: 'browser', weight: 3, desc: 'Every IPC handler hammered with hostile input — main process must never crash' },
    soak: { tag: '@soak', label: 'Shell Soak', kind: 'browser', weight: 3, desc: 'Compressed surgical shift — no leaked views/listeners, no memory creep' },
  },

  // api-kind only for now; a device is required by config validation but no
  // browser project is built unless a browser-kind suite is added later.
  devices: process.env.QA_DEVICES?.split(',').map((d) => d.trim()) ?? ['Desktop Chrome'],
  staticRoutes: [],

  // No Mongo / no local app process to tail.
  // Auto-run the OR-state gatherer per case (always): folds a full-tier
  // snapshot into each case's evidence bundle; container logs on failure.
  // 'always' window screenshots for @shellui evidence (harmless for api-kind).
  capture: { appLogs: 'off', dbCollections: [], screenshot: 'always', gatherers: { 'or-state': 'always' } },

  // Dev rig — mutation is the point (routing, infusion, fault injection).
  readOnly: false,

  safety: {
    requireOptIn: true,
    testDbPattern: /(_|-)(test|qa|ci)$/i,
    testBucketPattern: /(^|[._-])(test|qa|ci|dev)([._-]|$)/i,
    prod: { dbNames: [], bucketNames: [], uriHostDenylist: [] },
  },
};
