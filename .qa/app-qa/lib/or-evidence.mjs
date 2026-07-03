// OR evidence collector — one function that snapshots EVERY tier of the running
// OR into a structured bundle. Most tiers already expose their state over HTTP;
// the Electron shell exposes a consolidated /evidence via its dev-console. All
// best-effort: a tier that is down is annotated, never fatal.
//
// Used two ways:
//   • the campaign suite pushes snapshots at key moments (attachEvidence)
//   • the touchstone gatherer (evidence-gatherers/or-state.mjs) writes the full
//     bundle after each case (always) / on failure.

import { HOSTS, SITE, ROOM, readHeaders, compose } from './or-harness.mjs';

const tryJson = async (url, headers = {}) => {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : { _error: `HTTP ${r.status}` };
  } catch (e) { return { _error: e.message }; }
};

// ---- per-tier snapshots ------------------------------------------------------

export const registrySnapshot = async () => {
  const topo = await tryJson(`${HOSTS.registry}/api/sites/${SITE}/rooms/${ROOM}/topology`);
  const events = await tryJson(`${HOSTS.registry}/api/events?since=0`);
  const t = topo.topology ?? topo;
  return {
    counts: t.counts ?? null,
    drift: t.drift ?? null,
    devices: (t.devices ?? []).map((d) => ({ deviceId: d.deviceId, kind: d.kind, mountMode: d.mountMode, presence: d.presence?.state, via: d.presence?.via, trust: d.trust?.level, busy: d.busy ?? null, conformance: d.conformance })),
    recentEvents: (events.events ?? []).slice(-40).map((e) => ({ ts: e.ts, type: e.type, deviceId: e.deviceId, via: e.via ?? e.previous })),
  };
};

// Per-agent telemetry: /state (jobs, capability state, busy) + /health
// (upstreams, degraded, latched e-stop). This is the "device telemetry" tier.
export const deviceTelemetry = async () => {
  const agents = {
    barco: HOSTS.barco, lights: HOSTS.lights, pump: HOSTS.pump,
    recorder: HOSTS.recorder, audio: HOSTS.audio, shaver: `http://localhost:${process.env.SHAVER_PORT || 4570}`,
    display: `http://localhost:${process.env.DISPLAY_PORT || 4540}`, cart: HOSTS.cart,
  };
  const out = {};
  for (const [name, base] of Object.entries(agents)) {
    const health = await tryJson(`${base}/health`, readHeaders());
    const state = await tryJson(`${base}/state`, readHeaders());
    out[name] = {
      health: health._error ? { error: health._error } : { state: health.state, upstreams: (health.upstreams ?? []).map((u) => `${u.name}:${u.state}`), busy: health.busy ?? null, emergencyStop: health.emergencyStop ?? null, pendingEvents: health.pendingEvents },
      jobs: state._error ? null : (state.jobs ?? []).slice(-6).map((j) => ({ action: j.action, state: j.state, error: j.error })),
      capabilities: state._error ? null : Object.keys(state.capabilities ?? {}),
    };
  }
  return out;
};

export const barcoRoutes = async () => {
  const s = await tryJson(`${HOSTS.barco}/state`, readHeaders());
  const r = s.capabilities?.routing ?? {};
  return {
    routes: (r.routes ?? []).map((x) => `${x.displayId}/${x.slotId} ← ${x.sourceId} (${x.via ?? 'controller'})`),
    sourceAvailability: r.sourceAvailability ?? {},
    audio: s.capabilities?.audio ? (s.capabilities.audio.routes ?? []).map((x) => `${x.sourceId} → ${x.speakerId}`) : null,
    interor: s.capabilities?.interor ? (s.capabilities.interor.sharedOut ?? []) : null,
  };
};

export const plannerSnapshot = async () => {
  const readiness = await tryJson(`${HOSTS.planner}/api/rooms/${ROOM}/readiness`);
  const snap = await tryJson(`${HOSTS.planner}/api/rooms/${ROOM}/snapshot`);
  return {
    published: snap.published ?? null,
    version: snap.version ?? null,
    readinessLive: readiness.report?.live ?? null,
    readinessOverall: readiness.report?.overall ?? readiness.report?.status ?? null,
  };
};

// Vendor truth — what the simulated NMS "hardware" actually did.
export const simTruth = async () => tryJson(`${HOSTS.sim}/sim/state`);

// The Electron shell's consolidated view (audit tail, alarms, case, displays).
export const shellEvidence = async () => tryJson(`${HOSTS.shell}/evidence?log=40`);

// ---- the full bundle ---------------------------------------------------------

export const collectAllTiers = async (label = '') => {
  const [registry, telemetry, barco, planner, sim, shell] = await Promise.all([
    registrySnapshot(), deviceTelemetry(), barcoRoutes(), plannerSnapshot(), simTruth(), shellEvidence(),
  ]);
  return {
    label,
    at: new Date().toISOString(),
    registry,
    deviceTelemetry: telemetry,
    barco,
    planner,
    vendorSim: sim,
    shell: shell._error ? { error: shell._error, note: 'Electron shell not running (headless)' } : shell,
  };
};

// Container logs for the tiers most likely to explain a failure (bounded tail).
export const dockerLogs = (services = ['device-registry', 'barco-agent', 'nexxis-sim'], tail = 60) => {
  const out = {};
  for (const svc of services) {
    try { out[svc] = compose(`logs --no-color --tail ${tail} ${svc}`); }
    catch (e) { out[svc] = `(logs unavailable: ${e.message})`; }
  }
  return out;
};
