#!/usr/bin/env node
// smoke-planner — assert the OR-PLANNER stack (`make up-planner`) is genuinely
// up: every HTTP surface answers, all three room adaptors (BARCO / PC /
// streaming) are registered online, the planner reads live inventory through
// the registry, and OR-03 carries the DEMO RIG exactly as specced
// (2× MNA-420 quad decoders · PC 4K+HD · 4 clinical sources 2×4K+2×HD ·
// streamer device). Exit 0 = planner stack healthy; non-zero = it is not.
//
//   node scripts/smoke-planner.mjs        (from matrix-devqa)
//   make smoke-planner

import { readFileSync } from 'node:fs';

// Load .env if present (ports remap), else compose defaults.
const env = { ...process.env };
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(\S+)/);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2];
  }
} catch { /* no .env — defaults */ }
const P = (name, dflt) => Number(env[name] || dflt);

const HOSTS = {
  web: `http://localhost:${P('PLANNER_WEB_PORT', 5500)}`,
  api: `http://localhost:${P('PLANNER_API_PORT', 4500)}`,
  ehr: `http://localhost:${P('EHR_PORT', 4600)}`,
  registry: `http://localhost:${P('REGISTRY_PORT', 4430)}`,
  audit: `http://localhost:${P('AUDIT_PORT', 4460)}`,
  appstore: `http://localhost:${P('APPSTORE_PORT', 4410)}`,
  arthrex: `http://localhost:${P('ARTHREX_PORT', 4402)}`,
};

let passed = 0;
let failed = 0;
const check = (label, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
};
const getJson = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
const up = async (url) => {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(6000) }); return r.ok; } catch { return false; }
};

console.log('\n■ HTTP surfaces (the 7 planner-facing services)');
check('planner-web', await up(`${HOSTS.web}/`), HOSTS.web);
check('planner-api', await up(`${HOSTS.api}/health`));
check('ehr-adapter (dummy worklist)', await up(`${HOSTS.ehr}/v1/worklist`));
check('device-registry', await up(`${HOSTS.registry}/health`));
check('audit-service', await up(`${HOSTS.audit}/health`));
check('app-store', await up(`${HOSTS.appstore}/`));
check('arthrex-surgeon', await up(`${HOSTS.arthrex}/`));

console.log('\n■ Room adaptors registered + online (registry topology)');
try {
  const topo = await getJson(`${HOSTS.registry}/api/sites/SITE-001/rooms/OR-03/topology`);
  const devices = topo?.topology?.devices ?? [];
  const online = (pred) => devices.find((d) => pred(d) && d?.presence?.state === 'online');
  check('BARCO adaptor online', Boolean(online((d) => d.kind === 'barco')));
  check('PC adaptor online (agent.windows-or03)', Boolean(online((d) => d.deviceId === 'agent.windows-or03')));
  check('streaming adaptor online', Boolean(online((d) => d.kind === 'streamer')));
} catch (error) {
  check('registry topology reachable', false, String(error.message ?? error));
}

console.log('\n■ Planner reads live truth through the registry');
try {
  const li = await getJson(`${HOSTS.api}/api/rooms/OR-03/live-inventory`);
  check('live-inventory ok', li.ok === true);
} catch (error) {
  check('live-inventory reachable', false, String(error.message ?? error));
}
try {
  const wl = await getJson(`${HOSTS.api}/api/worklist`);
  check('worklist adapter ok', wl.adapterOk === true, `${wl.cases?.length ?? 0} cases`);
} catch (error) {
  check('worklist reachable', false, String(error.message ?? error));
}

console.log('\n■ OR-03 carries the demo rig (the saved spec)');
try {
  const room = await getJson(`${HOSTS.api}/api/rooms/OR-03`);
  const barco = room.displays.filter((d) => (d.driver ?? 'barco-decoder') === 'barco-decoder');
  const system = room.displays.filter((d) => d.driver === 'computer-agent');
  check('2× barco decoders, 4 slots each', barco.length === 2 && barco.every((d) => d.maxSlots === 4),
    barco.map((d) => `${d.id}:${d.maxSlots ?? '—'}`).join(' '));
  check('barco decoders modeled as MNA-420', barco.every((d) => /MNA-420/.test(d.model)));
  const pcLeft = system.find((d) => d.id === 'disp.pc-left');
  const pcRight = system.find((d) => d.id === 'disp.pc-right');
  check('PC adaptor displays: 4K + HD', pcLeft?.w === 3840 && pcRight?.w === 1920,
    `${pcLeft?.w ?? '?'}×${pcLeft?.h ?? '?'} + ${pcRight?.w ?? '?'}×${pcRight?.h ?? '?'}`);
  const fourK = room.sources.filter((s) => s.format === '4K').length;
  const hd = room.sources.filter((s) => s.format === 'HD').length;
  check('4 clinical sources: 2×4K + 2×HD', room.sources.length === 4 && fourK === 2 && hd === 2,
    room.sources.map((s) => `${s.id}(${s.format})`).join(' '));
  check('streamer device present', room.devices.some((d) => d.kind === 'streamer'));
} catch (error) {
  check('room rig readable', false, String(error.message ?? error));
}

console.log('\n====================================================');
console.log(`PLANNER STACK: ${passed} passed · ${failed} failed`);
console.log(failed === 0
  ? 'THE PLANNER STACK IS UP — make up-planner delivered the saved setup.'
  : 'PLANNER STACK UNHEALTHY — a saved-setup guarantee no longer holds.');
process.exit(failed === 0 ? 0 : 1);
