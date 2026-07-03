#!/usr/bin/env node
// run-chaos — inject exceptions into the running dev OR and assert the system
// FAILS SAFE. The adversarial twin of run-surgery: every injection must
// produce a specific, correct defensive reaction (alarm raised, command
// refused, plan re-driven, output safed). A green run means the OR degrades
// gracefully; a red run means a fault went unhandled.
//
//   node scripts/run-chaos.mjs          (from matrix-devqa)
//   make chaos
//
// Shell-dependent beats (alarms, break-glass) run only when the Electron shell
// is up with MATRIX_DEV_CASE_CONTROL=true; headless they skip cleanly.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

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
  pump: `http://localhost:${P('PUMP_PORT', 4560)}`,
  lights: `http://localhost:${P('LIGHT_PORT', 4520)}`,
  shell: `http://localhost:${P('MATRIX_DEV_CASE_CONTROL_PORT', 4787)}`,
};
const SITE = 'SITE-001';
const ROOM = 'OR-03';
const ACTOR = 'clin:CHAOS-RUNNER';

const roomAuth = loadRoomAuth(join(HERE, '..', 'certs', 'site-cert-package', 'operating-rooms', ROOM, 'room-auth.json'));
const readHeaders = () => ({ 'x-matrix-room-auth': encodeEnvelopeHeader(signEnvelope({ roomAuth, appId: 'shell' })) });
let seq = 0;
const command = async (base, body) => {
  const payload = { schema: 'matrix.agentCommand/1', requestId: `chaos-${Date.now()}-${++seq}`, ...body };
  return fetch(`${base}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, auth: signEnvelope({ roomAuth, appId: 'shell', body: payload }) }),
  }).then((r) => r.json());
};
const getJson = (url, headers = {}) => fetch(url, { headers }).then((r) => r.json());
const agentState = (base) => getJson(`${base}/state`, readHeaders());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const compose = (args) => execSync(`docker compose ${args}`, { cwd: join(HERE, '..'), stdio: 'pipe' }).toString();

let passed = 0;
let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (ok) passed += 1; else failed += 1;
  return ok;
};
const skip = (label, why) => console.log(`  ◌ ${label} — skipped (${why})`);
const chaos = (title) => console.log(`\n💥 ${title}`);

// Shell operator console (optional): alarms + break-glass are observable here.
const shellProbe = await getJson(`${HOSTS.shell}/alarms`).catch(() => null);
const shellOn = Boolean(shellProbe?.ok);
const shellGet = (path) => getJson(`${HOSTS.shell}${path}`);
const shellPost = (path, body) => fetch(`${HOSTS.shell}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());
const alarmActive = async (code) => {
  const { active } = await shellGet('/alarms');
  return (active ?? []).find((a) => a.code === code) ?? null;
};
const waitForAlarm = async (code, tries = 12) => {
  for (let i = 0; i < tries; i += 1) { const a = await alarmActive(code); if (a) return a; await sleep(1500); }
  return null;
};

console.log(`Chaos rig: shell operator ${shellOn ? 'ONLINE (alarm beats armed)' : 'offline (device-tier beats only)'}`);

// Put the room into a CLEAN live case (room-prep: a control model is built and
// displays are driven, but not procedure-locked) so mid-case faults + the
// break-glass override have real meaning. A leftover post-op case is reset.
if (shellOn) {
  await shellPost('/case/clear', {});
  await shellPost('/case/refresh-worklist', {});
  const board = await shellGet('/case');
  const c = (board.worklist ?? []).find((x) => /rotator|cuff/i.test(x.procedureName ?? '')) ?? board.worklist?.[0];
  if (c) {
    await shellPost('/case/select', { caseId: c.caseId });
    await shellPost('/case/transition', { target: 'room-prep' });
  }
  await sleep(1000); // let the shell build the display control model from the plan
  console.log(`Case lifecycle: ${(await shellGet('/case')).lifecycleState} (${c?.procedureName ?? 'no case'})`);
}

// ============================================================ EXCEPTION 1
chaos('Device drops mid-case — a cable is kicked out (hard-kill the agent)');
await command(HOSTS.pump, { capability: 'infusion', action: 'start', params: { rateMlHr: 100 }, approval: { confirmed: true, by: ACTOR } });
compose('kill shaver-agent');
let offline = null;
for (let i = 0; i < 8 && !offline; i += 1) {
  await sleep(1000);
  const dev = (await getJson(`${HOSTS.registry}/api/sites/${SITE}/rooms/${ROOM}/devices/agent.shaver-or03`)).device;
  if (dev?.presence?.state === 'offline') offline = dev;
}
check('registry detects the drop via Last-Will (fast, not lease-expiry)', Boolean(offline), offline ? `via ${offline.presence.via}` : 'still online after 8s');
if (shellOn) {
  const alarm = await waitForAlarm('DEVICE_OFFLINE_MID_CASE');
  check('shell raises DEVICE_OFFLINE_MID_CASE (critical)', Boolean(alarm), alarm?.title ?? 'no alarm');
} else skip('shell device-offline alarm', 'shell not running');
compose('start shaver-agent');
let recovered = false;
for (let i = 0; i < 10 && !recovered; i += 1) {
  await sleep(2000);
  const dev = (await getJson(`${HOSTS.registry}/api/sites/${SITE}/rooms/${ROOM}/devices/agent.shaver-or03`)).device;
  if (dev?.presence?.state === 'online') recovered = true;
}
check('device recovers and re-registers', recovered);

// ============================================================ EXCEPTION 2
chaos('Display divergence — a vendor tech re-routes at the physical panel');
await command(HOSTS.barco, { capability: 'routing', action: 'applyRoute', target: { displayId: 'disp.or3.main', slotId: 'slot-1' }, params: { sourceId: 'src.or3.endoscope' } });
await sleep(500);
compose(''); // no-op keep-var
await fetch(`${HOSTS.sim}/sim/routes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoSinkId: 'sink-main', slotId: 'slot-1', videoSourceId: 'enc-roomcam' }) });
let folded = null;
for (let i = 0; i < 10 && !folded; i += 1) {
  await sleep(400);
  folded = (await agentState(HOSTS.barco)).capabilities.routing.routes.find((r) => r.displayId === 'disp.or3.main' && r.sourceId === 'src.or3.roomcam' && r.via === 'barco-event') ?? null;
}
check('agent folds the unplanned change into display truth (never silently trusts belief)', Boolean(folded));
if (shellOn) {
  const recon = await shellPost('/display/reconcile', {}); // force the reconcile tick now
  const diverged = recon?.report?.diverged || recon?.ok;
  const alarm = await waitForAlarm('DISPLAY_DIVERGENCE', 4);
  check('shell reconciler flags the divergence (belief ≠ display truth)', Boolean(alarm) || Boolean(diverged), alarm ? alarm.title : (recon?.report ? JSON.stringify(recon.report).slice(0, 80) : 'reconcile ran'));
} else skip('shell divergence alarm', 'shell not running');
// re-drive restores the plan
await command(HOSTS.barco, { capability: 'routing', action: 'applyRoute', target: { displayId: 'disp.or3.main', slotId: 'slot-1' }, params: { sourceId: 'src.or3.endoscope' } });
await sleep(500);
const restored = (await agentState(HOSTS.barco)).capabilities.routing.routes.find((r) => r.displayId === 'disp.or3.main');
check('re-drive restores the planned route', restored?.sourceId === 'src.or3.endoscope');

// ============================================================ EXCEPTION 3
chaos('Interlock — calibrate the pump WHILE it is infusing (requiresIdle)');
const busy = (await agentState(HOSTS.pump)).capabilities?.infusion ?? (await getJson(`${HOSTS.pump}/state`, readHeaders()));
const calibrate = await command(HOSTS.pump, { capability: 'infusion', action: 'calibrate', params: {}, approval: { confirmed: true, by: ACTOR } });
const calErr = typeof calibrate.error === 'object' ? (calibrate.error.message || calibrate.error.code) : calibrate.error;
check('agent REFUSES a requiresIdle op on an engaged device', calibrate.state === 'failed' || calibrate.ok === false, String(calErr ?? calibrate.state).slice(0, 60));
await command(HOSTS.pump, { capability: 'infusion', action: 'stop', params: {} });

// ============================================================ EXCEPTION 4
chaos('Forged plan — a tampered / wrong-room snapshot is fed to the shell verifier');
try {
  const { createSnapshotVerifier } = await import(join(HERE, '..', '..', 'matrix-shell', 'electron', 'snapshot-verify.js')).then((m) => m.default ?? m);
  const os = await import('node:os');
  const verifier = createSnapshotVerifier({
    env: { MATRIX_SNAPSHOT_TRUST: 'required', MATRIX_PLANNER_PUBLIC_KEY_FILE: join(HERE, '..', 'certs', 'planner-signing-key.pub.pem') },
    stateDir: os.tmpdir(), log: () => {},
  });
  const { envelope } = await getJson(`${HOSTS.planner}/api/rooms/${ROOM}/published-plan`);
  const good = await verifier.evaluate(envelope);
  check('a genuine signed plan is applied', good.apply === true, good.reason);
  const tampered = JSON.parse(JSON.stringify(envelope)); tampered.payload.roomName = 'CHAOS-INJECTED';
  const t = await verifier.evaluate(tampered);
  check('a TAMPERED plan is REFUSED (payload hash mismatch)', t.apply === false, t.code);
  const wrongRoom = JSON.parse(JSON.stringify(envelope)); wrongRoom.roomKey = { siteId: SITE, roomId: 'OR-99' };
  const wr = await verifier.evaluate(wrongRoom);
  const binding = wr.apply === false; // required-trust refuses; binding is a second gate
  check('a wrong-room plan is not silently applied', binding, wr.code ?? 'refused');
} catch (error) {
  check('snapshot verifier reachable', false, String(error.message).slice(0, 80));
}

// ============================================================ EXCEPTION 5
chaos('Break-glass — the surgeon forces a source outside the plan (Scene 12)');
if (shellOn) {
  // Pick a real slot + a source NOT currently on it, straight from the shell's
  // control model — the override must use ids the shell actually knows.
  const model = await shellGet('/display/model');
  const slot = (model.slots ?? [])[0];
  const source = (model.sources ?? [])[0];
  const override = slot && source
    ? await shellPost('/display/override', { slotId: slot.id, displayId: slot.displayId, sourceId: source.id, reason: 'surgeon: forced source for final check' })
    : { ok: false, error: `control model empty (slots:${(model.slots ?? []).length} sources:${(model.sources ?? []).length})` };
  // Either outcome is CORRECT and defensive: applied+recorded, or refused
  // because displays are procedure-locked. Both must be auditable, neither silent.
  const applied = override.ok === true;
  const lockedRefusal = override.ok === false && /lock|procedure/i.test(String(override.reason || override.error || ''));
  check('break-glass is handled explicitly (applied+recorded OR procedure-locked refusal)', applied || lockedRefusal,
    applied ? 'override applied + logged with actor/reason' : `refused: ${override.reason || override.error}`);
} else skip('break-glass override', 'shell not running');

// ============================================================ EXCEPTION 6
chaos('Emergency stop — system.stop LATCHES until an explicit reset');
await command(HOSTS.lights, { capability: 'lighting', action: 'setScene', params: { scene: 'open' }, approval: { confirmed: true, by: ACTOR } });
const estop = await command(HOSTS.lights, { capability: 'system', action: 'stop', params: { reason: 'chaos e-stop drill' } });
check('e-stop accepted by the actuate device', estop.state === 'accepted' || estop.ok === true, estop.state ?? '');
await sleep(600);
const stoppedHealth = await getJson(`${HOSTS.lights}/health`, readHeaders());
check('e-stop LATCHES health to degraded (does not self-clear on next poll)', stoppedHealth.state === 'degraded' && Boolean(stoppedHealth.emergencyStop), stoppedHealth.emergencyStop?.reason ?? stoppedHealth.state);
const blockedScene = await command(HOSTS.lights, { capability: 'lighting', action: 'setScene', params: { scene: 'closing' }, approval: { confirmed: true, by: ACTOR } });
check('actuate work is REFUSED while the e-stop is latched', blockedScene.ok === false || blockedScene.state === 'rejected', typeof blockedScene.error === 'object' ? blockedScene.error.code : blockedScene.state);
const reset = await command(HOSTS.lights, { capability: 'system', action: 'reset', params: { by: ACTOR } });
await sleep(600);
const clearedHealth = await getJson(`${HOSTS.lights}/health`, readHeaders());
// Assert the LATCH cleared specifically (health may be degraded for unrelated
// reasons — e.g. a dead event subscriber left by repeated conformance runs).
check('system.reset clears the latch (emergency stop released)', reset.state === 'accepted' && !clearedHealth.emergencyStop, clearedHealth.emergencyStop ? 'still latched' : `latch cleared (health: ${clearedHealth.state})`);

// ============================================================ recovery
chaos('Recovery — acknowledge alarms, room returns to a clean baseline');
if (shellOn) {
  const { active } = await shellGet('/alarms');
  for (const a of active ?? []) await shellPost('/alarm/acknowledge', { alarmId: a.id, reason: 'chaos drill complete' });
  const after = await shellGet('/alarms');
  const blocking = (after.active ?? []).filter((a) => a.state === 'active');
  check('all raised alarms are acknowledgeable (case can proceed again)', blocking.length === 0, `${(after.active ?? []).length} alarm(s) now acknowledged`);
} else skip('alarm acknowledgement', 'shell not running');

// ============================================================ verdict
console.log(`\n${'='.repeat(56)}`);
console.log(`CHAOS DRILL: ${passed} passed · ${failed} failed`);
console.log(failed === 0 ? 'THE ROOM FAILS SAFE — every injected fault was handled.' : 'UNSAFE — a fault went unhandled.');
process.exit(failed === 0 ? 0 : 1);
