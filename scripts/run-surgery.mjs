#!/usr/bin/env node
// run-surgery — headless end-to-end SIMULATED SURGERY through the dev OR.
//
// Plays the acceptance narrative (THE-STORY.md) against the running docker
// stack, signing every command with the room key exactly as the Shell does.
// No component in the loop knows the hardware is simulated. Exit 0 = every
// beat held; non-zero = the story regressed.
//
//   node scripts/run-surgery.mjs          (from matrix-devqa)
//   make surgery
//
// Ports follow the compose defaults; override via env if remapped.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { loadRoomAuth, signEnvelope, encodeEnvelopeHeader } = await import(
  join(HERE, '..', '..', 'matrix-device-agents', 'sdk', 'src', 'room-auth.mjs')
);

const P = (name, dflt) => Number(process.env[name] || dflt);
const HOSTS = {
  registry: `http://localhost:${P('REGISTRY_PORT', 4430)}`,
  planner: `http://localhost:${P('PLANNER_API_PORT', 14500)}`,
  sim: `http://localhost:${P('NEXXIS_SIM_PORT', 4599)}`,
  barco: `http://localhost:${P('BARCO_PORT', 4550)}`,
  recorder: `http://localhost:${P('RECORDER_PORT', 4530)}`,
  lights: `http://localhost:${P('LIGHT_PORT', 4520)}`,
  pump: `http://localhost:${P('PUMP_PORT', 4560)}`,
  audio: `http://localhost:${P('AUDIO_PORT', 4590)}`,
  cart: `http://localhost:${P('CART_PORT', 4580)}`,
  // The native Electron shell's DEV operator console (MATRIX_DEV_CASE_CONTROL).
  // Optional: when the shell is running, the surgery also plays the
  // circulator and the case lifecycle progresses ON SCREEN.
  shell: `http://localhost:${P('MATRIX_DEV_CASE_CONTROL_PORT', 4787)}`,
};
const SITE = 'SITE-001';
const ROOM = 'OR-03';
const ACTOR = 'clin:DEV-RUNNER';

const roomAuth = loadRoomAuth(join(HERE, '..', 'certs', 'site-cert-package', 'operating-rooms', ROOM, 'room-auth.json'));
const readHeaders = () => ({ 'x-matrix-room-auth': encodeEnvelopeHeader(signEnvelope({ roomAuth, appId: 'shell' })) });
let commandSeq = 0;
const command = async (base, body) => {
  const payload = { schema: 'matrix.agentCommand/1', requestId: `surgery-${Date.now()}-${++commandSeq}`, ...body };
  const response = await fetch(`${base}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, auth: signEnvelope({ roomAuth, appId: 'shell', body: payload }) }),
  });
  return response.json();
};
const getJson = (url, headers = {}) => fetch(url, { headers }).then((r) => r.json());
const agentState = (base) => getJson(`${base}/state`, readHeaders());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (ok) passed += 1; else failed += 1;
  return ok;
};
const beat = (title) => console.log(`\n■ ${title}`);
const skip = (label, why) => console.log(`  ◌ ${label} — skipped (${why})`);

// Shell operator (optional visual layer): present only when the Electron
// shell runs with MATRIX_DEV_CASE_CONTROL=true. Headless CI skips cleanly.
const shellConsole = await fetch(`${HOSTS.shell}/case`).then((r) => r.json()).catch(() => null);
const shellOn = Boolean(shellConsole?.ok);
const operator = async (path, body) => fetch(`${HOSTS.shell}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());
const caseState = async () => (await fetch(`${HOSTS.shell}/case`).then((r) => r.json())).lifecycleState;
const advanceCase = async (target, reason) => {
  if (!shellOn) return skip(`case → ${target}`, 'shell not running');
  const result = await operator('/case/transition', { target, reason });
  check(`case → ${target} (circulator, authority-gated)`, result.ok === true && (await caseState()) === target, result.ok ? '' : (result.error ?? ''));
};

// ---------------------------------------------------------------- preflight
beat('06:45 — the cart is wheeled in and docked');
const cartBefore = await getJson(`${HOSTS.cart}/device/state`);
if (cartBefore.active !== ROOM) {
  const dock = await fetch(`${HOSTS.cart}/device/bind`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomId: ROOM }) }).then((r) => r.json());
  check(`cart docked to ${ROOM} (was ${cartBefore.active ?? 'UNBOUND'})`, dock.ok === true);
  await sleep(9000); // registration heartbeat carries it into the topology
} else {
  check(`cart already docked to ${ROOM}`, true);
}

if (shellOn) {
  beat('The circulator opens the case on the shell');
  await operator('/case/clear', {});
  await operator('/case/refresh-worklist', {});
  const board = await fetch(`${HOSTS.shell}/case`).then((r) => r.json());
  const surgical = board.worklist.find((c) => /rotator|cuff/i.test(c.procedureName ?? '')) ?? board.worklist[0];
  const selected = surgical ? await operator('/case/select', { caseId: surgical.caseId }) : { ok: false, error: 'empty worklist' };
  check(`case selected on the shell (${surgical?.caseId ?? 'none'})`, selected.ok === true, surgical?.procedureName ?? '');
  await advanceCase('room-prep', 'team begins room setup');
} else {
  beat('The circulator opens the case on the shell');
  skip('select + room-prep', 'shell not running — headless mode');
}

beat('Preflight — the room is standing');
const topology = (await getJson(`${HOSTS.registry}/api/sites/${SITE}/rooms/${ROOM}/topology`)).topology;
const online = topology.devices.filter((d) => d.presence.state === 'online');
check('registry topology has the full fleet online (incl. docked cart)', online.length >= 8, `${online.length} online`);
check('presence is broker-truth (lwt)', online.every((d) => d.presence.via === 'lwt'));
const simHealth = await getJson(`${HOSTS.sim}/health`);
check('vendor NMS (sim) reachable with an events subscriber', simHealth.ok && simHealth.subscribers >= 1);
const barcoHealth = await getJson(`${HOSTS.barco}/health`, readHeaders());
check('barco agent healthy — real upstream, no mock state on the wire', barcoHealth.state === 'ok'
  && (barcoHealth.upstreams ?? []).every((u) => u.state === 'ok'));

// ---------------------------------------------------------------- the night before
beat('The night before — plan is published, live readiness sees the room');
const readiness = await getJson(`${HOSTS.planner}/api/rooms/${ROOM}/readiness`);
check('planner readiness merges LIVE registry truth', Boolean(readiness.report?.live), `deviceCount ${readiness.report?.live?.deviceCount ?? 'n/a'}`);
const snapshot = await getJson(`${HOSTS.planner}/api/rooms/${ROOM}/snapshot`);
check('room has a published, signed snapshot', snapshot.published === true, snapshot.version);

// ---------------------------------------------------------------- case start
beat('07:30 — case start: the shell drives the room');
let ack = await command(HOSTS.lights, { capability: 'lighting', action: 'setScene', params: { scene: 'setup' }, approval: { confirmed: true, by: ACTOR } });
check('lights scene → setup (actuate, approved)', ack.state === 'accepted');
ack = await command(HOSTS.barco, { capability: 'routing', action: 'applyRoute', target: { displayId: 'disp.or3.main', slotId: 'slot-1' }, params: { sourceId: 'src.or3.endoscope' } });
check('endoscope routed to main display', ack.state === 'accepted');
ack = await command(HOSTS.barco, { capability: 'audio', action: 'applyAudioRoute', target: { speakerId: 'aud.or3.speakers' }, params: { sourceId: 'aud.src.or3.music', volume: 40 } });
check('music channel routed to room speakers', ack.state === 'accepted');
ack = await command(HOSTS.audio, { capability: 'music', action: 'play', params: { playlistId: 'pl.rao-standard' } });
check("surgeon playlist playing", ack.state === 'accepted');
ack = await command(HOSTS.audio, { capability: 'alerts', action: 'chime', params: { chimeId: 'case-start' } });
check('case-start chime', ack.state === 'accepted');
ack = await command(HOSTS.recorder, { capability: 'recording', action: 'start', params: { sourceId: 'src.or3.endoscope', caseId: 'C-4412' } });
check('recording started (spine-safe caseId only)', ack.state === 'accepted');
await sleep(600);
const barcoRoutes1 = (await agentState(HOSTS.barco)).capabilities.routing.routes;
check('agent reports the planned route as display truth', barcoRoutes1.some((r) => r.displayId === 'disp.or3.main' && r.sourceId === 'src.or3.endoscope'));

// ---------------------------------------------------------------- timeout → procedure
beat('Surgical timeout, then the procedure begins (case lifecycle on screen)');
ack = await command(HOSTS.audio, { capability: 'alerts', action: 'chime', params: { chimeId: 'timeout-start' } });
check('timeout chime', ack.state === 'accepted');
await advanceCase('pre-op-timeout', 'surgical safety timeout');
await advanceCase('in-procedure', 'timeout complete — incision');

// ---------------------------------------------------------------- mid-case
beat('Mid-case — infusion under approval + interlocks');
ack = await command(HOSTS.pump, { capability: 'infusion', action: 'start', params: { rateMlHr: 120 }, approval: { confirmed: true, by: ACTOR } });
check('infusion started (actuate, approved, interlocked)', ack.state === 'accepted');
// busy-state rides the next registration heartbeat (15s poll) — wait for it
let pumpRow = null;
for (let i = 0; i < 8 && !pumpRow?.busy; i += 1) {
  await sleep(3000);
  pumpRow = (await getJson(`${HOSTS.registry}/api/sites/${SITE}/rooms/${ROOM}/devices/agent.pump-or03`)).device;
}
check('pump busy-state visible to the platform (engaged)', Boolean(pumpRow?.busy), pumpRow?.busy?.reason ?? '');

beat('Scene 9 — vendor tech changes a route at the physical panel');
await fetch(`${HOSTS.sim}/sim/routes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoSinkId: 'sink-main', slotId: 'slot-1', videoSourceId: 'enc-roomcam' }) });
let folded = null;
for (let i = 0; i < 10 && !folded; i += 1) {
  await sleep(400);
  const routes = (await agentState(HOSTS.barco)).capabilities.routing.routes;
  folded = routes.find((r) => r.displayId === 'disp.or3.main' && r.sourceId === 'src.or3.roomcam' && r.via === 'barco-event') ?? null;
}
check('manual change folded into display truth (via barco-event, planner ids)', Boolean(folded));
ack = await command(HOSTS.barco, { capability: 'routing', action: 'applyRoute', target: { displayId: 'disp.or3.main', slotId: 'slot-1' }, params: { sourceId: 'src.or3.endoscope' } });
await sleep(600);
const restored = (await agentState(HOSTS.barco)).capabilities.routing.routes.find((r) => r.displayId === 'disp.or3.main');
check('re-drive restores the planned route (what the shell reconciler does)', restored?.sourceId === 'src.or3.endoscope');

beat('Critical alert — voice announce ducks the music, then restores');
const preVolume = (await agentState(HOSTS.audio)).capabilities.music.volume;
ack = await command(HOSTS.audio, { capability: 'alerts', action: 'announce', params: { message: 'Specimen count check required', priority: 'critical', durationMs: 1500 } });
check('critical announce accepted', ack.state === 'accepted');
await sleep(500);
const ducked = (await agentState(HOSTS.audio)).capabilities.music;
check('music DUCKED under the alert', ducked.volume <= 15 && Boolean(ducked.duckedBy));
await sleep(1600);
const restoredMusic = (await agentState(HOSTS.audio)).capabilities.music;
check('music restored after the alert', restoredMusic.volume === preVolume && !restoredMusic.duckedBy, `vol ${restoredMusic.volume}`);

beat('Consult — share the scope to OR-01, then unshare (runtime-only, never planner-authored)');
ack = await command(HOSTS.barco, { capability: 'interor', action: 'shareSourceToRoom', target: { sourceId: 'src.or3.endoscope' }, params: { roomId: 'OR-01' } });
check('scope shared to OR-01', ack.state === 'accepted');
ack = await command(HOSTS.barco, { capability: 'interor', action: 'unshareSourceFromRoom', target: { sourceId: 'src.or3.endoscope' }, params: { roomId: 'OR-01' } });
check('scope unshared', ack.state === 'accepted');

// ---------------------------------------------------------------- close
await advanceCase('closing', 'implants placed — closing');

beat('Close — the room stands down cleanly');
ack = await command(HOSTS.pump, { capability: 'infusion', action: 'stop', params: {} });
check('infusion stopped', ack.state === 'accepted');
ack = await command(HOSTS.recorder, { capability: 'recording', action: 'stop', params: {} });
check('recording stopped', ack.state === 'accepted');
ack = await command(HOSTS.barco, { capability: 'routing', action: 'releaseRoute', target: { displayId: 'disp.or3.main', slotId: 'slot-1' } });
check('main display route released', ack.state === 'accepted');
ack = await command(HOSTS.audio, { capability: 'music', action: 'stop', params: {} });
check('music stopped', ack.state === 'accepted');
ack = await command(HOSTS.audio, { capability: 'alerts', action: 'announce', params: { message: 'Case complete', priority: 'info', durationMs: 800 } });
check('case-complete announcement', ack.state === 'accepted');
const events = (await getJson(`${HOSTS.registry}/api/events?since=0`)).events ?? [];
check('registry lifecycle event feed populated', events.length > 0, `${events.length} events`);
await advanceCase('post-op', 'patient to PACU');

// ---------------------------------------------------------------- verdict
console.log(`\n${'='.repeat(52)}`);
console.log(`SIMULATED SURGERY: ${passed} passed · ${failed} failed`);
console.log(failed === 0 ? 'THE STORY HOLDS — full OR loop is demonstrable.' : 'REGRESSION — a story beat no longer holds.');
process.exit(failed === 0 ? 0 : 1);
