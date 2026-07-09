#!/usr/bin/env node
// register-shell-apps — drive the REAL matrix-shell registry-app-host module
// against the live stack, the same way run-surgery plays the shell: same code,
// same room key, no Electron. Proves THE-STORY's app-hosting-truth beat end to
// end:
//
//   shell module (Ed25519 enroll → identity-signed 'shell' registration,
//   apps only, NO endpoint)  →  device-registry derives shell apps
//   (displayIds EMPTY — composited, not window-placeable)  →  planner
//   live-inventory shows them under host shell.or-03, and does NOT list the
//   shell as a headless API device (it is the commander, not commandable).
//
// The app list is DISCOVERED, not typed here: it comes from the shell's own
// dev app registry (matrix-apps/*/matrix-app.json manifests).
//
//   node scripts/register-shell-apps.mjs      (from matrix-devqa, stack up)
//   make register-shell-apps
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// The shell's dev app registry only yields apps in dev mode — set the gates
// BEFORE requiring it (module reads env at call time, but be explicit).
process.env.ELECTRON_START_URL ||= 'http://localhost:5173';
process.env.MATRIX_DEV_LOCAL_APPS ||= 'true';

const require = createRequire(import.meta.url);
const SHELL_ROOT = path.resolve('../matrix-shell');
const { createRegistryAppHost } = require(path.join(SHELL_ROOT, 'electron/registry-app-host.js'));
const { loadLocalDevAppRegistry } = require(path.join(SHELL_ROOT, 'electron/dev-app-registry.js'));

// Ports: .env remaps, else compose defaults (same convention as smoke-planner).
const env = { ...process.env };
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(\S+)/);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2];
  }
} catch { /* no .env — defaults */ }
const REGISTRY = `http://localhost:${Number(env.REGISTRY_PORT || 4430)}`;
const PLANNER = `http://localhost:${Number(env.PLANNER_API_PORT || 4500)}`;
const ROOM = 'OR-03';
const SHELL_DEVICE_ID = 'shell.or-03';

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const getJson = async (url) => {
  const response = await fetch(url);
  return response.json();
};

// 1) The shell's OWN app list — discovered from its dev app registry.
const devApps = loadLocalDevAppRegistry({ shellRoot: SHELL_ROOT })
  .filter((a) => a.enabled !== false)
  .map((a) => ({ id: a.appId, name: a.appName }));
check(devApps.length >= 2, `shell dev app registry yields apps`, devApps.map((a) => a.id).join(', '));

// 2) Register with the REAL module — room key from the site cert package,
//    fresh device identity (enrolls with the registry CA on the fly).
const roomAuth = JSON.parse(readFileSync(`certs/site-cert-package/operating-rooms/${ROOM}/room-auth.json`, 'utf8'));
const host = createRegistryAppHost({
  registryUrl: REGISTRY,
  getRoomAuth: () => roomAuth,
  getApps: () => devApps,
  stateDir: mkdtempSync(path.join(tmpdir(), 'shell-app-host-')),
  log: (m) => console.log(`      ${m}`),
});
const out = await host.register();
check(out.ok === true, 'shell registered with the device-registry', out.ok ? out.deviceId : out.reason);

// 3) Registry truth: shell is a fleet member; its apps are installed inventory.
const inventory = await getJson(`${REGISTRY}/api/sites/${roomAuth.siteId}/rooms/${ROOM}/inventory`);
const inv = inventory.inventory ?? inventory;
const shellDevice = (inv.roomDevices ?? []).find((d) => d.deviceId === SHELL_DEVICE_ID);
check(!!shellDevice && shellDevice.kind === 'shell', 'registry lists the shell as a room device (kind shell)');
check(shellDevice?.agentUrl === '', 'shell device has NO command endpoint');
const installed = (inv.installedApps ?? {})[SHELL_DEVICE_ID] ?? [];
check(installed.length === devApps.length, `registry installedApps[${SHELL_DEVICE_ID}]`, `${installed.length}/${devApps.length}`);

// 4) Planner truth: shell apps appear in the fleet panel data under their
//    reporting host with EMPTY displayIds (No windows — composited)…
const live = await getJson(`${PLANNER}/api/rooms/${ROOM}/live-inventory`);
check(live.ok === true, 'planner live-inventory ok');
const shellApps = (live.apps ?? []).filter((p) => p.app.host === SHELL_DEVICE_ID);
check(shellApps.length >= 2, `planner sees shell-hosted apps`, shellApps.map((p) => p.app.id).join(', '));
check(shellApps.every((p) => (p.app.displayIds ?? []).length === 0), 'shell apps carry EMPTY displayIds (composited, not window-placeable)');

// …and windowed apps are still the PC's, untouched.
const pcApps = (live.apps ?? []).filter((p) => p.app.host === 'agent.windows-or03');
check(pcApps.length >= 2 && pcApps.every((p) => (p.app.displayIds ?? []).length > 0), 'PC-hosted apps unchanged (windowed)');

// 5) The shell is NOT a headless API row — it is the commander, not commandable.
const apiRow = (live.apis ?? []).find((a) => a.deviceId === SHELL_DEVICE_ID);
check(!apiRow, 'shell is NOT listed as a headless device API');
const streamerRow = (live.apis ?? []).find((a) => a.kind === 'streamer');
check(!!streamerRow, 'headless device APIs still present (streamer)', streamerRow?.deviceId);

console.log(failures === 0 ? '\nSHELL APP REGISTRATION: TRUTH HOLDS' : `\n${failures} assertion(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
