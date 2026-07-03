// OR harness — the reusable library for driving the simulated OR from tests.
//
// Factored from scripts/run-surgery.mjs + scripts/run-chaos.mjs so there is ONE
// source of truth for: signed agent commands, chaos injection (vendor panel,
// device kill, source loss), the shell dev-operator console (case lifecycle,
// alarms, break-glass, reconcile), and case setup/teardown. The touchstone
// campaign suite and the standalone runners both import this.

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
// lib → app-qa → .qa → matrix-devqa
export const DEVOPS_ROOT = resolve(HERE, '..', '..', '..');
const SDK = join(DEVOPS_ROOT, '..', 'matrix-device-agents', 'sdk', 'src', 'room-auth.mjs');
const { loadRoomAuth, signEnvelope, encodeEnvelopeHeader } = await import(SDK);

const P = (name, dflt) => Number(process.env[name] || dflt);
export const HOSTS = {
  registry: `http://localhost:${P('REGISTRY_PORT', 4430)}`,
  planner: `http://localhost:${P('PLANNER_API_PORT', 14500)}`,
  sim: `http://localhost:${P('NEXXIS_SIM_PORT', 4599)}`,
  barco: `http://localhost:${P('BARCO_PORT', 4550)}`,
  recorder: `http://localhost:${P('RECORDER_PORT', 4530)}`,
  lights: `http://localhost:${P('LIGHT_PORT', 4520)}`,
  pump: `http://localhost:${P('PUMP_PORT', 4560)}`,
  audio: `http://localhost:${P('AUDIO_PORT', 4590)}`,
  cart: `http://localhost:${P('CART_PORT', 4580)}`,
  shell: `http://localhost:${P('MATRIX_DEV_CASE_CONTROL_PORT', 4787)}`,
};
export const SITE = 'SITE-001';
export const ROOM = 'OR-03';

const roomAuth = loadRoomAuth(join(DEVOPS_ROOT, 'certs', 'site-cert-package', 'operating-rooms', ROOM, 'room-auth.json'));
export const readHeaders = () => ({ 'x-matrix-room-auth': encodeEnvelopeHeader(signEnvelope({ roomAuth, appId: 'shell' })) });

let seq = 0;
export const command = async (base, body) => {
  const payload = { schema: 'matrix.agentCommand/1', requestId: `qa-${Date.now()}-${++seq}`, ...body };
  return fetch(`${base}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, auth: signEnvelope({ roomAuth, appId: 'shell', body: payload }) }),
  }).then((r) => r.json());
};
export const getJson = (url, headers = {}) => fetch(url, { headers }).then((r) => r.json());
export const agentState = (base) => getJson(`${base}/state`, readHeaders());
export const agentHealth = (base) => getJson(`${base}/health`, readHeaders());
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const compose = (args) => execSync(`docker compose ${args}`, { cwd: DEVOPS_ROOT, stdio: 'pipe' }).toString();

// ---- device tier ------------------------------------------------------------
export const deviceRow = async (deviceId) =>
  (await getJson(`${HOSTS.registry}/api/sites/${SITE}/rooms/${ROOM}/devices/${deviceId}`)).device;
export const topology = async () => (await getJson(`${HOSTS.registry}/api/sites/${SITE}/rooms/${ROOM}/topology`)).topology;

export const waitFor = async (fn, { tries = 12, gapMs = 1000 } = {}) => {
  for (let i = 0; i < tries; i += 1) { const v = await fn(); if (v) return v; await sleep(gapMs); }
  return null;
};

// ---- chaos injectors --------------------------------------------------------
export const chaos = {
  // A cable is kicked out / an agent crashes → Last-Will offline.
  async killAgent(service) { compose(`kill ${service}`); },
  async startAgent(service) { compose(`start ${service}`); },
  // A vendor tech re-routes at the physical panel (nexxis-sim injection).
  async panelDivergence({ videoSinkId = 'sink-main', slotId = 'slot-1', videoSourceId = 'enc-roomcam' } = {}) {
    await fetch(`${HOSTS.sim}/sim/routes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoSinkId, slotId, videoSourceId }) });
  },
  // A source cable is pulled.
  async sourceUnavailable(videoSourceId, availability = 'unavailable') {
    await fetch(`${HOSTS.sim}/sim/sources/availability`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoSourceId, availability }) });
  },
};

// ---- shell dev-operator console (optional; only when the shell is running) ---
export const shellProbe = async () => Boolean((await getJson(`${HOSTS.shell}/alarms`).catch(() => null))?.ok);
export const shell = {
  get: (path) => getJson(`${HOSTS.shell}${path}`),
  post: (path, body) => fetch(`${HOSTS.shell}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json()),
  async caseState() { return (await this.get('/case')).lifecycleState; },
  async alarms() { return (await this.get('/alarms')).active ?? []; },
  async alarm(code) { return (await this.alarms()).find((a) => a.code === code) ?? null; },
  async waitForAlarm(code, tries = 12) { return waitFor(() => this.alarm(code), { tries, gapMs: 1500 }); },
  async controlModel() { return this.get('/display/model'); },
};

// Establish a CLEAN active case at room-prep (control model built, displays not
// procedure-locked). Returns the selected case profile or null.
export const establishCase = async (procedureMatch = /rotator|cuff/i) => {
  await shell.post('/case/clear', {});
  await shell.post('/case/refresh-worklist', {});
  const board = await shell.get('/case');
  const c = (board.worklist ?? []).find((x) => procedureMatch.test(x.procedureName ?? '')) ?? board.worklist?.[0];
  if (!c) return null;
  await shell.post('/case/select', { caseId: c.caseId });
  await shell.post('/case/transition', { target: 'room-prep' });
  await sleep(1000); // shell builds the display control model from the plan
  return c;
};

export const CASE_PHASES = ['room-prep', 'pre-op-timeout', 'in-procedure', 'closing', 'post-op'];
export const advanceCase = async (target, reason = 'qa campaign') => shell.post('/case/transition', { target, reason });

// ---- plan-vs-actual conformance ----------------------------------------------
// Expected = the bound plan's slot assignments for a phase (shell control
// model). Actual = the barco agent's route truth. A slot conforms when the
// route carries the plan's stream (or its underlying source) into that slot.
export const phaseConformance = async (phase) => {
  const expected = await shell.get(`/display/expected?phase=${encodeURIComponent(phase)}`);
  if (!expected.ok) return { phase, ok: false, error: expected.error, expected: 0, matched: 0, pct: null, missing: [] };
  const routes = (await agentState(HOSTS.barco)).capabilities.routing.routes ?? [];
  const routed = new Map(routes.map((r) => [`${r.displayId}::${r.slotId}`, r.sourceId]));
  const missing = [];
  let matched = 0;
  const video = expected.assignments.filter((a) => a.displayId); // app-only slots (no display) are scored via compose later
  for (const a of video) {
    const actual = routed.get(`${a.displayId}::${a.slotId}`);
    const want = new Set([a.streamId, a.sourceId].filter(Boolean));
    if (actual && want.has(actual)) matched += 1;
    else missing.push(`${a.displayId}/${a.slotId} wanted ${a.streamId ?? a.sourceId}, got ${actual ?? 'nothing'}`);
  }
  return {
    phase,
    ok: true,
    planId: expected.planId,
    expected: video.length,
    matched,
    pct: video.length ? Math.round((matched / video.length) * 100) : null,
    missing,
  };
};

// ---- deterministic per-case RNG (seeded, so a campaign is reproducible) ------
export const rng = (seed) => {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
};
export const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
