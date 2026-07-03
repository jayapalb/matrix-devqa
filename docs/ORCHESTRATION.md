# Matrix Plus — Procedure Orchestration

> How the four tiers — **Planner** (authoring), **Fleet/Registry + Runtime**
> (distribution + truth), **Shell** (in-room policy authority), **device
> agents** (executors) — orchestrate a single operating-room procedure end to
> end, and how online/offline, safety, risk control, discoverability,
> observability, and the AI assist tier ride on top of that spine.
>
> Companion to `MATRIX-ARCHITECTURE.md` (target design), `SCOPE-OF-WORK.md`
> (build state), and `matrix-device-agents/docs/MATRIX-AGENT-SPEC.md`.

---

## 0. The one-paragraph model

The **Planner authors intent** (a signed, room-scoped plan). The **Fleet tier
distributes it and holds device truth**. The **Shell is the single in-room
authority** that verifies intent, decides, and commands. **Agents execute** on
real devices behind a conformance contract. Every arrow is one-directional and
single-authority: the Planner can't reach into a room, the Fleet tier can't
command a device, only the Shell commands agents, and an agent only ever obeys
its active room. That is what makes the whole thing auditable and safe by
construction rather than by vigilance.

```
 SCHEDULE ──▶ PLAN ──▶ READY ──▶ CONDUCT ──▶ REVIEW        (the clinical loop)
   MWL/HL7    Planner   Shell     Shell        Shell→Planner
     │          │        │  pulls   │ drives      │ emits
     ▼          ▼        ▼  verifies ▼ agents      ▼ caseEvents
 ehr-adapter  snapshot/2  signed   display-ctrl  learning loop
             (signed)    seam      + agents      (card re-tune)
```

---

## 1. The five stages, tier by tier

### SCHEDULE — cloud/site control plane
- **MWL / HL7 → `ehr-adapter` → `CaseProfile`** (PHI masked at the adapter
  edge; only `caseId`/procedure-code/opaque ids cross the spine).
- Planner worklist consumes `matrix.worklist/1.0`; a nurse **assigns** a case →
  room + procedure + surgeon preference card + plan → emits `PlanBinding` and
  `case.assigned` (the delivery trigger).
- *Authority: Planner (authoring). No device is touched.*

### PLAN — Planner
- Plan = **procedure ⊕ surgeon card ⊕ per-step tuning**, resolved into
  `matrix.snapshot/2` (room, capabilities, displays, sources, per-phase
  presets, routes, overlays).
- **Readiness now blends authored + LIVE truth**: the Planner fetches the
  registry room topology and folds in graduated presence, device-cert trust,
  and **device busy-state** — a required recorder mid-session or an offline
  scope fails/warns readiness *before* the case starts. Registry down →
  readiness still computes on authored data (`live:null`).
- **Publish** signs the envelope (Ed25519 + payload hash) and **pushes the
  expected-inventory baseline** to the registry so drift is plan-vs-reality.
- *Authority: Planner. Output is signed intent, not action.*

### READY — Shell (the in-room hand-off)
- Shell **pulls** `/published-plan`, then before anything touches the displays:
  **verify signature → verify room binding** (a genuine plan for another room
  is refused) → on any failure keep the last-good plan, alarm, audit.
- **OR-plan-readiness preflight** against the room's *real* assets (installed
  apps, display surfaces, discovered devices/sources). `unknown ≠ missing`:
  unknowns never block; error-severity misses do.
- *Authority: Shell (runtime policy). This is the trust boundary.*

### CONDUCT — Shell + agents (the live case)
- The **case lifecycle state machine** (scheduled → room-prep → time-out →
  procedure → closing → …) is the clock. Each transition drives the **display
  controller**, which computes desired display state and issues only deltas:
  - `compose-intent` → device agents (arrange apps into a source)
  - `layout-intent` → Barco agent (create decoder slots)
  - `route-intent` → Barco agent (source → slot)
- Every command is a **signed, bodyHash-bound `matrix.agentCommand/1`**; the
  agent verifies against its active room, acks immediately, executes async,
  and reports terminal state.
- **The Shell decides and commands; it never renders.** (Locked architecture.)
- *Authority: Shell disposes; agents execute; AI/apps only propose.*

### REVIEW — Shell → Planner (the learning loop)
- Shell emits `matrix.caseEvent/1` (lifecycle + utilization: phase durations,
  route deviations, failures) back to the Planner.
- Planner aggregates per preference card → **re-tune suggestions** the surgeon
  approves. Closes Schedule→Plan→…→Review without changing the contract.

---

## 2. Online / Offline — offline-first is the invariant, not the fallback

The room must finish a case with the cloud gone. How each dependency degrades:

| Dependency lost | Behavior | Why safe |
|---|---|---|
| **Planner unreachable** | Shell runs on the **last verified snapshot** (cached, signature-checked when received); banner "operating from cache" | Plan already in hand; no new plan needed mid-case |
| **Registry unreachable** | Shell uses last-known topology; Planner readiness annotates `live:null` | Discovery is a pre-case concern; the room already knows its devices |
| **Barco agent stalls** | Command times out (AbortController), job → `failed`, red route state, retried next reconcile | No silent hang; surgeon sees the displays didn't change |
| **Any agent down** | Graduated presence degrades → stale → offline; readiness reflects it; commands fail visibly | Device absence is *surfaced*, never assumed-present |
| **Network severed mid-case** | Shell + agents keep running on durable local state (journals, shadows, cached plan) | Every tier persists; nothing in the hot path needs the WAN |
| **MQTT broker down** | Falls back to HTTP + lease presence | Broker is an optimization over the lease clock, not a dependency |

The spine is designed so the **in-room hot path touches no database and no
cloud service**. Cloud/Fleet is for authoring, distribution, aggregation, and
learning — never for turning intent into action.

---

## 3. Safety — layered, and enforced in code (not policy)

Six independent layers, each a hard line even if the one above it fails:

1. **Verify before apply.** No unsigned/tampered/wrong-room plan drives the
   displays; failure keeps last-good + alarms. (Shell `snapshot-verify`.)
2. **Fail visible, never fail-open.** Route/layout failures escalate to a red
   board state + critical log + audit + retry; a frozen feed never looks live.
   (Shell `display-controller` failure tracking.)
3. **Reconcile against display truth.** Shell belief is periodically compared to
   the Barco agent's reported state (which folds the Nexxis event stream incl.
   manual operator changes); divergence alarms + re-drives. (Shell
   `route-reconciler`.)
4. **Approval + interlocks on physical actuation.** `actuate`-class ops need
   `approval{confirmed,by}`, agent-side range/rate interlocks, and an e-stop
   that is never blocked. (Agent SDK command queue.)
5. **Device busy-state.** A pump infusing / recorder mid-session refuses room
   switches and `requiresIdle` ops — the device knows it's engaged
   independent of the command journal. (Agent SDK `busy()`.)
6. **Room isolation everywhere.** Room-auth envelopes (HMAC + nonce + bodyHash)
   + per-device CA certs mean a shell/device only ever acts on its own room;
   roaming carts bind one active room and are refused mid-actuate. (Room CA +
   agent §7.1.)

The **AI tier sits above all six** — it can only *propose*; every proposal
passes the same Shell gate as any other actor.

---

## 4. Risk control — the hazard → mitigation → detection → fallback map

The mitigations exist in code; the ISO-14971 risk *register* (the document
indexing them) is the near-term deliverable. Coverage today:

| Hazard | Mitigation | Detection | User-visible fallback |
|---|---|---|---|
| Wrong room's plan | signature + **room-binding** check | `SNAPSHOT_WRONG_ROOM` | keep last-good; alarm |
| Tampered plan | Ed25519 + payload hash | verify fails | keep last-good; alarm |
| Stale case data | signed snapshot + version | drift banner | "unpublished changes" / cache banner |
| Device offline | graduated presence | readiness fail + presence event | Ready phase blocks; console shows red |
| Frozen/failed route | actuator outcome tracking | `DISPLAY_ACTUATION_FAILED` | red route state; retry; require-confirm |
| Displays ≠ plan (manual change) | display-truth reconciler | `DISPLAY_DIVERGENCE` | alarm + re-drive |
| Wrong device commanded | room-auth + device cert | envelope verify fails | command refused (401/403) |
| Roaming device mis-bind | active-room binding | 409 unknown/busy | switch refused; audited |
| Engaged device disturbed | busy interlock | 409 busy | op refused until idle |
| Preference mismatch | two-axis drift (proc + card) | drift warning | re-tune prompt |
| Cloud/network outage | offline-first + timeouts | breaker/degraded health | run on cache; visible banner |

Every row has a **detection signal** (a specific log code / event) and a
**visible fallback** — the two things a safety review checks for.

---

## 5. Discoverability — how the room knows what it has

- **Agents auto-register** on boot (and per-room on dock, for carts) with the
  registry: identity (device cert), capabilities (`/spec`), endpoints,
  firmware, transports, conformance level.
- **The registry is the room's source of device truth** — the "Greengrass
  console": one screen shows every device, its graduated presence, trust
  level, busy-state, capabilities, and **drift vs the Planner's expected
  inventory** (missing / unexpected / uncertified).
- **The Shell discovers** the room from the registry topology + its own asset
  scan; the **Planner discovers** the same topology for readiness. Neither
  hard-codes a device list.
- **Zero-core-edit onboarding**: a new device class (lights, recorder, vitals)
  is a conforming agent + a catalog entry — it appears in discovery and
  becomes drivable without touching Shell, Planner, or registry core.

---

## 6. Observability — what failed, when, why, who

Present today (the raw material): structured system logs with stable codes,
hash-chained tamper-evident audit, a registry lifecycle event feed, per-device
health with honest degraded/mock states, and correlation ids that exist as
fields — `caseId`, `snapshotId`, `requestId`, `jobId`, cert serials.

The near-term work (SOW Phase 0.8) is **making them travel together** —
OpenTelemetry traces stitching case → snapshot → command → job → device event,
a heartbeat dashboard (the room console is the seed), and alerting. The
observability *design* is in place (every event is already attributable and
correlatable); the *plumbing* to a dashboard is the remaining build.

---

## 7. The AI assist tier — pre / in / post procedure

Principle: **AI proposes, a human disposes, everything is audited, and AI never
widens the trusted computing base.** Advisory-only keeps it on the non-device
CDS side of the regulatory line. It rides the same contracts as any app.

- **Contracts** (`matrix.skill/1` manifest + `matrix.aiIntent/1` envelope):
  every skill declares its context scopes, intents, action class, min
  confidence, and default approval policy — validated at install; a skill
  never sees a scope it didn't declare (spine-safe: PHI never reaches a model).
- **The gate**: `effectiveApprovalPolicy = min(skill, Planner ceiling, case
  policy)`; every suggest→approve/deny→act lands in the audit chain with the
  intent envelope. Provider is Claude with a **deterministic local fallback**
  (network down ≠ AI dark; it degrades to rules).

| Phase | AI assist | Data it uses (spine-safe) | Disposition |
|---|---|---|---|
| **Pre** | Readiness summarizer; preference-card drift explainer; schedule/turnover risk | Planner readiness + worklist + registry topology | Circulator acts on a prioritized list |
| **In** | Suggest-only display hints (surface a source, flag a missed step); phase-aware prompts | Case lifecycle + live device/display state | Shell gate → require-confirm; **never auto-acts** |
| **Post** | Case debrief (durations, deviations, route failures); **preference-card re-tune suggestions** | `caseEvent/1` aggregates | Surgeon/staff approve edits in the Planner |

Sequence intentionally pre/post first (where data already exists and stakes are
low), intra-op suggest-only last, after the gate is battle-tested. The
learning loop is the flywheel: better data → better suggestions → approved
card edits → better plans.

---

## 8. What's architecturally settled vs. what remains

**Settled and verified in code + tests** (the spine): the five-stage loop; the
signed room-scoped seam; the six safety layers; room isolation + per-device
certs + roaming; graduated presence + drift; live readiness; offline-first
hot path; the agent conformance contract; the AI gate contracts.

**Remaining — and none of it is more spine:**
- **Papers**: regulatory position + ISO-14971 risk register (indexes §4).
- **Identity**: real OIDC/JWKS + service tokens (the deployment gate).
- **Ops**: observability plumbing (§6), per-site packaging/CI, renderer UI to
  *display* the safety signals the main process emits.
- **AI**: build the §7 skills on the real provider (contracts are specced).
- **Proof**: one room, one real list, one week, no engineer present.
