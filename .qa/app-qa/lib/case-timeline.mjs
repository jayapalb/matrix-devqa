// Case timeline — merge every tier's events into ONE chronological story per
// case: campaign markers (phases, injection), the Electron shell's audit log,
// registry lifecycle events, and vendor-sim route truth. The output is the
// per-case narrative an analyst reads first, plus phase-duration metrics.

import { HOSTS, SITE, ROOM, getJson } from './or-harness.mjs';

const inWindow = (at, start, end) => {
  const t = Date.parse(at ?? '');
  return Number.isFinite(t) && t >= start - 2000 && t <= end + 2000;
};

/** Collect + merge all tiers for one case window. Best-effort per tier. */
export const buildCaseTimeline = async (record) => {
  const start = Date.parse(record.startedAt);
  const end = Date.parse(record.finishedAt ?? new Date().toISOString());
  const rows = [];

  // campaign markers — the test's own ground truth
  rows.push({ at: record.startedAt, tier: 'campaign', event: `case ${record.n} start — ${record.scenario} (${record.procedure ?? 'headless'}, plan ${record.planId ?? '—'})` });
  for (const p of record.phases ?? []) {
    rows.push({ at: p.at, tier: 'campaign', event: `phase ${p.phase} — conformance ${p.conformance?.pct ?? '—'}%${p.conformance?.missing?.length ? ` (missing: ${p.conformance.missing[0]})` : ''}` });
  }

  // shell audit tail (system stream)
  try {
    const ev = await getJson(`${HOSTS.shell}/evidence?log=120`);
    for (const e of ev.auditTail?.system ?? []) {
      if (!inWindow(e.recordedAt, start, end)) continue;
      rows.push({ at: e.recordedAt, tier: 'shell', event: `${e.title ?? e.code ?? 'log'}${e.message ? ` — ${String(e.message).slice(0, 110)}` : ''}` });
    }
  } catch { rows.push({ at: record.startedAt, tier: 'shell', event: '(shell evidence unavailable)' }); }

  // registry lifecycle events
  try {
    const ev = await getJson(`${HOSTS.registry}/api/events?since=0`);
    for (const e of ev.events ?? []) {
      if (!inWindow(e.ts, start, end)) continue;
      rows.push({ at: e.ts, tier: 'registry', event: `${e.type} ${e.deviceId ?? ''}${e.via ? ` (via ${e.via})` : ''}` });
    }
  } catch { /* registry down is its own finding elsewhere */ }

  // vendor-sim truth (routes carry timestamps)
  try {
    const sim = await getJson(`${HOSTS.sim}/sim/state`);
    for (const r of sim.routes ?? []) {
      if (!inWindow(r.at, start, end)) continue;
      rows.push({ at: r.at, tier: 'vendor-sim', event: `route ${r.videoSinkId}/${r.slotId} ← ${r.videoSourceId} (${r.via})` });
    }
  } catch { /* sim optional */ }

  rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  // phase durations from the campaign markers
  const phaseRows = (record.phases ?? []).map((p) => ({ phase: p.phase, at: Date.parse(p.at) }));
  const durations = phaseRows.map((p, i) => ({
    phase: p.phase,
    ms: (i + 1 < phaseRows.length ? phaseRows[i + 1].at : end) - p.at,
  }));

  const md = [
    `# Case ${record.n} timeline — ${record.procedure ?? 'headless'} (${record.scenario})`,
    ``,
    `plan: ${record.planId ?? '—'} · recovery: ${record.recoveryMode} · conformance: ${record.conformancePct ?? '—'}%`,
    `phase durations: ${durations.map((d) => `${d.phase} ${(d.ms / 1000).toFixed(1)}s`).join(' · ') || '—'}`,
    ``,
    `| time | tier | event |`,
    `|---|---|---|`,
    ...rows.map((r) => `| ${String(r.at).slice(11, 23)} | ${r.tier} | ${r.event.replace(/\|/g, '\\|')} |`),
  ].join('\n');

  return { rows, durations, md };
};
