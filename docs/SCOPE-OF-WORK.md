# Matrix Plus — Scope of Work to Production Readiness

> Companion to `MATRIX-ARCHITECTURE.md` (target design) and `progress-tracker.md`
> (current status). This document is the **work breakdown**: component by
> component, what must be built/hardened to reach the target scores, with
> acceptance criteria ("definition of done") per component.
> Grounded in the 2026-07-01 four-tier code review.
>
> Targets: Planner **9.5/10** · Shell **9.5/10** · Device Registry **9/10** ·
> Device Agents **9/10** · AI capability (new, formalized).

---

## Phase 0 — Cross-cutting foundations (prerequisite for every target)

The reviews found the *same six defects in every repo*. Fix them once, as shared
packages, and every component inherits the fix.

| # | Deliverable | Replaces | Used by |
|---|---|---|---|
| 0.1 | **`@matrix/net`** — fetch wrapper: AbortController timeout (default 8s), retry + exponential backoff + jitter, circuit breaker, structured error taxonomy | bare `fetch()` with no timeout in barco-agent `core.mjs:446`, registrar, shell, planner clients | all |
| 0.2 | **`@matrix/outbox`** — durable local queue (SQLite/JSONL WAL): enqueue, flush-on-reconnect, idempotency keys, lag alarm | fire-and-forget `audit-client.ts`, `case-event-client.js`, registrar heartbeat | Planner, Shell, agents |
| 0.3 | **Postgres migration kit** — schema + migrations + backup/restore runbook | `writeFileSync` single-JSON stores in Planner `store.ts`, app-store `managed-deployments.json`, registry, audit service | Planner, App Store, Registry, Audit |
| 0.4 | **Identity spine** — OIDC/JWKS (Keycloak or hospital IdP), `matrix.session/1` verification, `service-token/1` issuance, mTLS between services; **refuse-to-start gate**: any service with auth mode `off` in `NODE_ENV=production` exits non-zero | `DEFAULT_DEV_ACTOR`, plaintext `MATRIX_CASE_EVENT_TOKEN`, shared `AGENT_TOKEN` | all |
| 0.5 | **Signing infrastructure** — Ed25519 keypairs: snapshot envelope signature (replaces FNV-1a-as-integrity), app package signatures, agent event signatures; key distribution via room-cert evolution (see 4.2) | unchecked checksum, unsigned zips, unsigned agent events | Planner, Shell, App Store, agents |
| 0.6 | **Event backbone** — MQTT broker (EMQX/Mosquitto; managed NATS acceptable) with per-room topic namespaces `matrix/{siteId}/{roomId}/...`, TLS + per-client certs, Last-Will-and-Testament for presence | SSE/long-poll placeholder; lease-expiry-as-presence | Registry, agents, Shell, Runtime Services |
| 0.7 | **`@matrix/phi`** — single shared PHI guard package | duplicated `EHR_ONLY` lists in Planner `phi.ts` and audit `store.cjs` (drift risk) + CI guard | Planner, Audit, Shell |
| 0.8 | **OpenTelemetry** baseline across services; clock-sync requirement (NTP/chrony) documented for rooms — audit ordering depends on it | — | all |

**Also Phase 0 (paper, not code): the regulatory position.** One document —
device boundary (Shell orchestrates a cleared routing device, never renders
clinical images), IEC 62304 software safety class, ISO 14971 risk file approach,
IEC 80001 story for hospital networks, and the CDS/non-device line for AI
(advisory-only, clinician can inspect basis). This constrains Shell and AI scope
below — write it before building more runtime capability.

---

## 1. Matrix Planner — current ~8/10 (tier-complete) → **9.5/10**

The tier is functionally complete; the gap is production infrastructure and a
handful of validation holes. Keep: contract package, cascades, step-driven
resolve/merge, drift detection, PHI egress guard — all verified exemplary.

### 1.1 Persistence & scale
- Migrate `apps/api/src/store.ts` to Postgres (Phase 0.3): transactional writes,
  no data-loss window, multi-node capable behind a load balancer.
- **Soft-delete** for procedures, preference cards, plans, layouts — the audit
  trail must be able to resolve any historical reference.
- **Layout immutability on publish**: a published snapshot pins layout revisions;
  deleting/mutating a layout referenced by `stepTuning[].layoutId` → 409, or
  version the layout and keep the pinned revision resolvable. (Today a narrower
  `PUT /rooms/:roomId/layouts` silently drops referenced layouts.)
- Close the generic-PUT hole: `PUT /rooms/:roomId` (`server.ts:327`) must reject
  `layouts` like the other cascade-bearing keys.

### 1.2 Identity & RBAC (with Phase 0.4)
- Real OIDC login; `publishedBy` becomes a verified `clin:U-…` subject.
- All 36 routes mapped to `@matrix/authz` permissions (not just the 3 gated
  actions); planner-staff vs planner-admin separation.
- Rate limiting on all mutating routes and on `/case-events`.

### 1.3 Publish integrity
- Sign the `matrix.snapshot/2` envelope (Ed25519, Phase 0.5); keep FNV-1a only
  as a fast drift hint. Publish → `{payload, checksum, signature, keyId}`.
- Key rotation runbook; Shell-side verification is item 2.1.

### 1.4 Event & audit hardening
- `audit-client.ts` and case-event ingest onto `@matrix/outbox` (0.2): retry,
  idempotency, dead-letter, lag alarm. No silently dropped audit records.
- `POST /case-events` behind service/room identity (kills the plaintext-token
  M2M exemption noted in the tracker's caveats).

### 1.5 Validation completeness
- Config flag: degraded/unavailable routed source **blocks publish** vs warns
  (hospital-selectable; default block).
- Dangling-reference validation on read: a plan referencing a missing layout
  returns a structured 4xx, never a silent partial resolve.

### 1.6 Learning-loop production close-out
- Run and document the live two-service smoke (Planner + Shell, room auth,
  `MATRIX_PLANNER_URL` / `MATRIX_CASE_EVENTS_URL`) — already #1 in the tracker.
- 412-conflict UX in the web app: surface "someone else edited this room"
  with a diff, instead of silent retry divergence.

**Definition of 9.5:** Postgres-backed, OIDC-authenticated, every route
authz-mapped and rate-limited, signed publishes, outbox-backed audit/events with
zero-loss guarantee, no dangling-reference states reachable, live smoke runbook
recorded, and a restore-from-backup drill documented and executed.

---

## 2. Matrix Shell — current ~5/10 → **9.5/10**

> **Status 2026-07-01:** 2.1 ✅ signed+verified seam (Planner Ed25519 signing +
> `/api/planner-identity`; shell trust modes w/ TOFU pinning; keep-last-good;
> live smoke: tampered provenance/payload refused) + adapter timeouts ·
> 2.2 ✅ route-failure escalation (red board state, never-believed, retried,
> audited) + display-truth reconciler vs barco-agent reported state + net
> discipline on all control-loop calls · 2.3 ✅ demo eradicated (explicit
> demo mode + watermark; production refuses relaxations; worklist hard-block
> w/ visible status) · 2.4 ✅ verified bus sender identity + production-gated
> DOM bridge (publish/subscribe manifest contracts pre-existed) · 194 tests
> green. **≈8.5/10** — remaining: renderer UI for red-routes/watermark,
> packaging/auto-update/rollback (2.5 ops), offline-first Electron e2e,
> central audit forwarding via outbox, malformed-adapter fuzz set.

The runtime and P1 seam are real; the gap is trust, fail-safety, and
production ops. Four workstreams, ordered by patient-safety impact.

### 2.1 Seam integrity (trust what you execute)
- **Verify snapshot signature + checksum in `refreshPublishedRoomPlan()`**
  (`main.js:3348`) before applying anything; mismatch → reject, keep last-good,
  raise a visible room alarm, audit the rejection.
- Authenticate all control-plane calls (room identity from room-auth; TLS with
  pinned control-plane identity). No plain unauthenticated HTTP to Planner /
  Runtime Services / Registry.
- Adapter hardening (`planner-snapshot-adapter.js`): malformed-input test suite
  (missing room.id, null layouts, oversized payloads, hostile labels), **warn on
  lossy appId sanitization** (`arthrex.vision`→`arthrex-vision` must log a
  mapping warning when it breaks registry match), warn on array truncation and
  unknown phases instead of silently dropping.

### 2.2 Fail-safe runtime (never fail open, never fail dark)
- **Route failure escalation**: Barco route/apply failures stop being silent
  best-effort (`main.js:3471`). Failure → red route-state on the displays UI +
  require-confirm before proceeding + audit entry. A frozen feed that looks
  live is the single most dangerous behavior in the codebase today.
- Per-operation timeouts via `@matrix/net` on every Barco/device/registry call.
- **Actual-state reconciliation**: subscribe to Barco `/events` (via barco-agent
  bridge, item 4.3) so shell belief converges with display reality after manual
  operator changes or agent restarts.
- **Degraded-mode ladder**, designed and tested per failure: cloud down →
  cached signed snapshot, banner "operating from cache"; worklist down → hard
  block on new case selection (no demo fallback), existing case continues;
  renderer death after watchdog retries → **static safe fallback layout**
  (primary source full-screen), never dark displays.
- **Offline-first as a named invariant**: a full case runs start-to-finish with
  zero cloud connectivity; add an automated test that severs the network
  mid-case and asserts the invariant.

### 2.3 Demo eradication
- All demo data (`DEMO_CASE_PROFILES` `case-workspace.js:181`,
  `DEMO_EXTERNAL_SOURCES` `main.js:122`, `DEMO_OR_ROOM_DEVICES` `main.js:273`)
  behind a single `MATRIX_DEMO_MODE` gate that also **watermarks the entire UI**;
  production builds exclude demo modules at package time.
- Demo devices never merge into real topology; demo cases never exportable.

### 2.4 App-platform hardening (make "apps propose, shell disposes" true at the bus)
- **Per-app bus ACLs** derived from the manifest: publishable message types,
  subscribable topics, declared `contextScopes[]` — enforced in the broker, not
  the preload. Kills sender forgery and subscribe-everything.
- Broker stamps verified sender identity on every message (apps cannot claim
  another `appId`).
- **Signed app packages** (Phase 0.5): SHA-256 + signature verified at install;
  version pinning per room; app-registry mutations (`shell:register-app`,
  `installAppFromUrl`) gated by an admin role, not open to the renderer.
- Remove/production-gate the `executeJavaScript` + `sendInputEvent` debugger
  bridge (`main.js:4297`) — cross-app DOM automation is an attack path.
- `MATRIX_DEMO_MODE`/`MATRIX_SECURITY_PROFILE=demo` relaxations refuse to
  activate in production builds.

### 2.5 Audit & ops
- Forward local hash-chain segments to the central audit service via outbox;
  periodic chain-anchor (publish latest hash to the cloud) so local tampering
  is detectable even with file access.
- Packaging & update: signed installers, staged rollout, one-command rollback
  to previous shell version + last-good snapshot; kiosk/lockdown config;
  crash reporting into fleet telemetry.

**Definition of 9.5:** no unverified byte executes (snapshot, app package,
bus message all authenticated); every mid-case failure mode has a designed,
tested, visible degraded state; demo data cannot appear in production; a
network-severed case completes; update/rollback drill executed; the security
profile passes an external penetration review.

---

## 3. Device Registry — current ~4/10 → **9/10** ("Greengrass for the OR")

> **Status 2026-07-01:** 3.1 ✅ atomic writes; leases/room-keys/certs/expected
> inventory durable (Postgres stays the Phase-0 upgrade) · 3.2 ✅ device CA
> (challenge→PoP enroll, `matrix.deviceCert/1`, per-device revocation, trust
> modes permissive→required) · 3.3 ✅ graduated presence + lifecycle event feed
> + MQTT LWT bridge · 3.4 ✅ deviceKinds/2 open catalog (firmware/license
> constraint checks in Planner readiness remain) · 3.5 ✅ topology API + live
> room console (`/assets/room.html`) with drift. 14 tests green; verified live
> in-browser. **≈8.5/10** — remaining: Postgres, room-scoped read auth,
> constraint validation at readiness time.

Target: the per-room source of truth — every device, its capabilities, health,
firmware, and live presence, visible per room and consumable by Planner
readiness and Shell topology. Keep: lease model, dual registration path,
capability-preserving derivation (`store.cjs:587`).

### 3.1 Durable core
- Postgres (or SQLite-per-site) store; **leases and room keys persist across
  restarts**; startup reconciliation sweeps expired leases instead of losing all.

### 3.2 Device identity & trust
- **Enrollment**: registry (or a small CA sidecar evolving `room-cert-gen`)
  issues **per-device certificates**; registration requires proof-of-possession
  (signed nonce). No more "any `kind` + URL is believed".
- **Per-device revocation** (deny list / short-lived certs) — compromising one
  agent no longer forces a whole-room key rotation.
- Mutating endpoints require device cert or service token; read endpoints
  room-scoped for non-local callers.

### 3.3 Presence model (beyond binary online/offline)
- States: `online → degraded → stale → offline` with grace periods; TTL raised
  to 60–90s with adaptive heartbeat.
- MQTT LWT (Phase 0.6) as the primary presence signal; HTTP lease as fallback.
- Registry publishes lifecycle events (`device.online`, `device.degraded`,
  `device.offline`, `device.replaced`) on the backbone — Shell and Planner
  subscribe instead of polling.

### 3.4 Capability catalog (`deviceKinds/2`)
- Schema-versioned `/spec` (`matrix.deviceSpec/2`): capability blocks carry
  their own version; registry validates against the Device Type Catalog;
  kills the three-place `kind` duplication (architecture doc §4).
- **Capability dependency validation**: layout/preset requirements checked
  against the specific device's slot map, firmware, and license *at readiness
  time*, not at apply time ("unknown slot" must be a Planner readiness warning,
  never a mid-case failure).
- Firmware/license tracked per device; Planner can pin minimums
  ("requires Barco fw ≥ 2.4.1").

### 3.5 Fleet/room view
- **Room topology API + UI**: live per-room picture — devices, capabilities,
  health, firmware, current routes — the "Greengrass console" for a room.
- Drift detection: expected inventory (from Planner room config) vs actual
  registrations; drift surfaces in Planner readiness and Fleet Registry.

**Definition of 9:** registry restart loses nothing; a device cannot register
without proving identity; one compromised device is revocable alone; presence
distinguishes degraded from dead; every capability claim is schema-validated;
a nurse or biomed can open one screen and see everything in the room and
whether it's healthy.

---

## 4. matrix-device-agents — current ~3/10 → **9/10** (the Agent Spec)

> **Status 2026-07-01 (second pass):** 4.1 spec ✅ · 4.2 SDK + conformance ✅
> (38 SDK tests; 15 L1 checks + opt-in `--broker` L2 and `--registry` L3
> checks; MQTT transport unit-tested via injected module) · **enrollment ✅**
> — agents auto-enroll with the registry CA on boot, sign registrations, and
> re-enroll on rejection; enroll→certified→revoke→re-enroll loop test-covered
> cross-tier · 4.3 barco ✅ retrofit + **Nexxis `/events` bridge** (display truth
> folds into reported state) + **durable route/layout/job state** (idempotency
> survives restarts) · 4.4 `light-controller-agent` (actuate, 15/15) +
> `recorder-agent` (media seam, **16/16 incl. live L3**) — streaming/vitals
> agents remain · 4.5 win/linux SDK port remains. **≈8.5/10** — remaining:
> live room broker (L2 end-to-end), live Barco hardware smoke, win/linux port.

The centerpiece: a formal **`matrix.agent/1` specification + SDK** that every
agent implements — Greengrass-style — so recorders, streamers, displays, light
controllers, shavers, pumps, etc. onboard as *conforming agents*, never core
edits. The `shell-agent-interface.md` draft is the seed; this formalizes and
implements it.

### 4.1 The spec (`matrix.agent/1`) — normative document
Every conforming agent provides:

| Concern | Requirement |
|---|---|
| **Identity** | Per-**device cert** (from registry CA, 3.2) + **room cert** (room-auth, as or-cart-device already does — extend the proven 7/10 pattern to all agents). All commands/events in signed envelopes. |
| **Lifecycle** | Auto-register on boot (registrar library), heartbeat/lease renew, graceful deregister, LWT on MQTT. |
| **Transports** | **HTTP** (required): `/health`, `/spec`, `/command`, `/state`. **MQTT** (required for production): subscribe `matrix/{site}/{room}/agent/{deviceId}/command`, publish `.../events`, `.../state`, retained state topic + LWT. |
| **Commands** | `matrix.agentCommand/1`: idempotent `requestId`, immediate ack (`accepted`), **async result as an event** (`applied`/`failed` with reason) — never a long-held HTTP request. Command queue with per-command timeout. |
| **State** | **Device-shadow model**: durable local `reported` state, shell publishes `desired`, agent reconciles and reports — survives reboots, converges after manual vendor-side changes. |
| **Capabilities** | Versioned `/spec` → `matrix.deviceSpec/2` (3.4); command whitelist + feature flags declared, not implied. |
| **Safety** | Command classes: `observe` (telemetry) < `route` (video/layout) < `actuate` (physical effect). `actuate` requires: interlock declaration, rate limits, e-stop semantics, require-confirm default at the Shell gate. |
| **Observability** | Structured logs, OTel traces, health includes upstream-dependency depth (a mock/simulated upstream MUST be reported — mock mode must never look real). |

### 4.2 The SDK (`@matrix/agent-sdk`)
- Node.js (and later Python for embedded) library implementing the whole spec:
  cert loading, register/heartbeat, HTTP server scaffold, MQTT client, command
  queue, shadow store, signed envelopes, `@matrix/net` built in.
- **Conformance test suite** (golden tests): a CLI that runs against any agent
  endpoint and certifies spec compliance — the gate for onboarding any new
  device class. This is what makes 9/10 *stay* 9/10 as vendors add agents.

### 4.3 Retrofit barco-agent (reference implementation)
- Adopt SDK: timeouts/retry/circuit-breaker, durable route/layout state,
  room-auth + device cert (drop shared `AGENT_TOKEN`), async result events.
- **Bridge Barco `/events` (wss)** → agent state → backbone: actual display state
  streams to the Shell (feeds 2.2 reconciliation).
- Deep health: verify configured sinks/sources exist in live Barco inventory;
  report `degraded` when routing-api is flaky; mock mode loudly labeled.

### 4.4 Reference agents (prove the spec breadth)
Priority order — observe/route classes first, actuate last:
1. **display-agent** (exists — port to SDK)
2. **recorder-agent** — start/stop/segment surgical recording, media-lifecycle
   events (reserves the media-management seam)
3. **streaming-agent** — encoder/WebRTC/LiveKit source projection
4. **light-controller-agent** — first `actuate`-class agent; exercises
   interlocks/require-confirm end-to-end on something low-risk
5. **vitals-agent** — telemetry-only projection of monitor data (display in
   apps; alarm management stays on the cleared device — IEC 60601-1-8 boundary)
6. **Generic serial/GPIO adapter** — the long tail
- **Pumps/shavers and other clinical actuators: telemetry/status first.**
  Direct control of therapeutic devices crosses the medical-device regulatory
  line — do not build `actuate` for them until the Phase 0 regulatory position
  explicitly covers it. The spec supports it; the rollout gates it.

### 4.5 Windows/linux host agents
- Port to SDK; harden install/update (signed packages, service supervision,
  auto-restart with backoff).

**Definition of 9:** the spec + SDK published; conformance CLI green on every
shipped agent; barco-agent survives reboot/network-flap/routing-api-stall with
correct degraded reporting; all agents use per-device certs and signed events;
one new device class (recorder or lights) onboarded end-to-end by *only*
writing an agent against the SDK — zero core edits.

---

## 5. AI capability — formalize P5: skills & agents for pre/post-procedure

Principle held throughout: **AI proposes, the Shell (or Planner) disposes; a
human approves anything that acts.** Advisory-only keeps it on the non-device
CDS side of the regulatory line (clinician can always inspect the basis).

### 5.1 Contracts (build first)
- **`matrix.skill/1`** manifest (in `matrix-app.json.capabilities.ai`):
  `{skillId, kind, runtime, contextScopes[], intents[{id, actionClass,
  defaultApprovalPolicy, minConfidence, cooldownMs}], guardrails}` — validated
  by the Shell at app install; undeclared scope/intent → rejected.
- **`matrix.aiIntent/1`** envelope (strict superset of `matrix:display-recommend`):
  every suggestion carries provenance, confidence, inputs-hash, and the
  evidence the human can inspect.

### 5.2 The gate & context provider (Shell)
- `effectiveApprovalPolicy = min(skill default, Planner ceiling, case policy)`
  — enforced in the shell gate, not the app.
- **`ai-context-provider`**: apps receive only their manifest-declared
  `contextScopes[]` (today the copilot gets the full `caseWorkspace` — close
  this). All context is spine-safe (PHI never reaches a model provider).
- Every suggest → approve/deny → act lands in the hash-chained audit with the
  intent envelope.

### 5.3 Provider layer
- **Anthropic/Claude provider** behind a provider interface + the existing
  **deterministic local router as the always-available fallback** (network
  down ≠ AI feature dark, it degrades to rules).
- Prompt/response capture into audit (spine-safe), token/cost telemetry,
  per-skill model pinning.

### 5.4 First skills — pre/post-op, where the data already exists
Pre-op (consumes Planner readiness + worklist + registry):
1. **Readiness summarizer** — readiness report → prioritized action list for
   the circulator ("tray X unverified, implant sizes missing, app Y not
   installed on room").
2. **Preference-card drift explainer** — turns two-axis drift into a plain
   change summary + adopt/keep recommendation.
3. **Schedule/turnover risk** — flags at-risk starts (needs real case-event
   history; enable after the learning loop accumulates data).

Post-op (consumes the case-event learning loop — the pipeline already built):
4. **Case debrief generator** — lifecycle + utilization events → structured
   summary (durations per phase, deviations from plan, route failures).
5. **Card re-tune suggester** — aggregated per-card signals → *proposed* card
   edits presented in the Planner for surgeon/staff approval (closes the
   learning loop with a human hand on it).

Intra-op stays **suggest-only** and comes last, after pre/post skills prove
value and the gate is battle-tested.

### 5.5 Replace the mock, measure honestly
- `ai-case-copilot` re-implemented as `matrix.skill/1` skills on the real
  provider; retire the deterministic-arithmetic model (or keep it, honestly
  labeled, as the fallback router).
- **Evaluation harness**: golden case fixtures, suggestion-quality review
  workflow, acceptance metric (% of suggestions approved by staff) — the number
  that tells you whether the AI is solving a real problem. No skill ships
  without an eval.

**Definition of done:** contracts enforced at install; no skill sees a scope it
didn't declare; nothing acts without the gate; provider outage degrades to the
deterministic fallback; the five launch skills pass their evals; every AI
action is reconstructable from the audit chain alone.

---

## Maturity roadmap (2026-07 — reconciled with external reviews)

External reviews (codex) land on the same ten pillars this SOW already tracks,
but score against a stale snapshot: their "30/60-day" items — event schemas,
hash-chained audit, device simulators, contract/failure-mode tests, RBAC
contracts — are **built and green** (≈380 tests across four tiers, versioned
`matrix.*/N` contracts everywhere, simulated Barco/MQTT/WS in tests, signed
snapshots, room CA). The honest remaining distance is concentrated in
**papers + identity + ops**, not core engineering:

**Next 30 days — the gates.**
1. Regulatory position paper (intended use, FDA CDS line, IEC 62304 class,
   device boundary) + **ISO 14971-style risk register** that mostly INDEXES
   already-built mitigations (wrong-room → room-auth; stale plan → signed
   snapshot keep-last-good; device offline → graduated presence readiness
   fail; outage → offline-first; engaged device → busy interlock) and names
   the uncovered hazards. Cheap, unblocks everything clinical.
2. **P2 identity**: real OIDC/JWKS + service tokens; refuse-to-start gates
   already exist. The single true deployment blocker.
3. Planner store atomicity (last non-atomic write path) + one-command
   cross-repo test runner.

**Next 60 days — proof under pressure.**
4. Observability: OpenTelemetry + correlation-ID stitching (caseId /
   snapshotId / requestId / jobId already exist as fields — make them travel),
   device-heartbeat dashboard (room console is the seed), alerting.
5. Deployment: Dockerized per-site stack (SOW §5.1 topology), CI running all
   suites, secrets management, staging/prod separation, signed releases +
   rollback.
6. Central audit forwarding via durable outbox; browser/UI test layer
   (Planner web + Shell renderer) — the one genuinely missing test tier.

**Next 90 days — external proof.**
7. Failure-mode DRILLS as scripted runbooks (sever network mid-case, registry
   down, cert revocation mid-shift, e-stop, planner outage) — the tests exist;
   drills make them operational evidence.
8. External security review / pentest against NIST CSF 2.0 mapping;
   live Barco hardware smoke; pilot-readiness runbook
   ("one room, one week, no engineer").

## Sequencing & dependency map

```
Phase 0 (foundations + regulatory paper)          [everything depends on this]
   │
   ├─► 1. Planner hardening ──────────┐
   ├─► 2. Shell 2.1–2.3 (trust+failsafe+demo)     [patient-safety first]
   │        └─► 2.4–2.5 (app platform, ops)
   ├─► 3. Registry (identity, presence, catalog)
   │        └─► 4. Agent spec + SDK ─► barco retrofit ─► reference agents
   └────────────► 5. AI contracts+gate ─► pre-op skills ─► post-op skills
                                    (5.4.3/5.4.5 wait for learning-loop data)
```

Rough sizing (focused engineer-weeks, parallelizable across streams):
Phase 0 ≈ 8–10 · Planner ≈ 6–8 · Shell ≈ 12–16 · Registry ≈ 6–8 ·
Agent spec/SDK/retrofit ≈ 10–14 · reference agents ≈ 2–4 each ·
AI ≈ 8–12. Order of magnitude: **~5–7 engineer-months of core work** to hit the
stated scores, excluding hospital-side integration (HL7/DICOM/OIDC tenant work)
and hardware validation time on real Barco/Nexxis gear.

The two milestones that matter more than any score:
1. **One room, one real case list, one week, no engineer present** — after
   Phase 0 + Shell 2.1–2.3 + Planner 1.4/1.6.
2. **One new device class onboarded with zero core edits** — after the agent
   spec + conformance suite (4.1–4.2).
