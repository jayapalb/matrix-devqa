# One Procedure Through Matrix Plus — Orchestration, Offline, Safety, AI

> How Planner, Shell, Device Registry, and Device Agents work **together** to
> run an OR procedure — online and offline, with the safety/risk ladder,
> discoverability, observability, and where the AI tier assists pre/in/post
> procedure. Everything marked ✅ is built and test-covered today; 🔜 marks the
> designed-but-pending pieces. Vendor systems (Barco control, HL7/DICOM/MWL)
> plug into the adapter seams — `barco-agent`, `ehr-adapter`, DICOM gateway —
> and are assumed proven (the operator's existing production frameworks).

---

## 0. The cast — one authority each

| Component | Its ONE authority | Never does |
|---|---|---|
| **Planner** (per site) | AUTHORS intent: procedures ⊕ surgeon cards ⊕ room config → signed `matrix.snapshot/2` | never commands a device, never holds room keys |
| **Device Registry** (per site) | KNOWS the fleet: identity (room CA), presence, capabilities, busy, drift | never commands, never routes |
| **Matrix Shell** (per room) | DECIDES + COMMANDS: verifies plans, drives the case lifecycle, gates every action | never renders clinical video, never invents plans |
| **Device Agents** (per machine) | EXECUTE + REPORT TRUTH: verified commands in, actual state + events out | never accept unsigned traffic, never obey another room |
| **Apps / AI skills** (sandboxed) | PROPOSE: readiness summaries, suggestions, surfaces | never act — the Shell gate disposes |

Every seam is one-directional and signed: Shell **pulls** from Planner;
Planner **reads** registry / **pushes** only its expected-inventory baseline;
only the Shell **commands** agents; agents **report** to registry + Shell.

---

## 1. Timeline of one procedure

### T-1 · Schedule → Plan (Planner, at the site)
1. The worklist arrives through **`ehr-adapter`** (`matrix.worklist/1.0`,
   PHI masked at the edge — your HL7/MWL framework lands here ✅ seam).
2. Staff assign the case → room + procedure + surgeon preference card;
   `resolvePlan` merges procedure ⊕ card ⊕ per-step tuning (non-destructive);
   drift on both axes (procedure rev, card rev) is surfaced ✅.
3. **Publish**: PHI egress guard → `matrix.snapshot/2` in a signed envelope
   (Ed25519 over identity + SHA-256 payloadHash) ✅, `case.assigned` fires ✅,
   and the room's **expected inventory** is pushed to the registry — the drift
   baseline becomes *plan vs reality* ✅.

### T-0 morning · Room wakes up (discoverability)
4. Fixed agents boot: load `room-auth.json`, generate/load device key,
   **auto-enroll with the registry CA** (challenge → proof-of-possession →
   `matrix.deviceCert/1`) ✅, register with signed registrations → `certified`
   trust ✅, heartbeat presence (+ MQTT Last-Will when the room broker is up).
5. A **cart docks**: its agents hold the site key package, bind the room via
   `POST /room` signed with *this* room's key (dock/UI), re-enroll lazily for
   this room, republish presence under this room's topics ✅. Until bound they
   refuse everything (`no-active-room`) ✅.
6. The **room console** (`/assets/room.html`) now shows the live topology:
   presence (online/degraded/stale/offline), trust, busy, capabilities with
   safety classes, and drift vs the published baseline — *missing* (planned
   but absent) and *unexpected* (present but unplanned) both flagged ✅.

### T-0 · Shell prepares the room (Ready)
7. Shell pulls the published plan, **verifies before applying**: Ed25519
   signature against the pinned Planner key (TOFU or configured) + payload
   hash + **room binding** (a genuine envelope for another room is refused) ✅.
   Failure of any check → last-good plan stays, critical alarm, audit entry ✅.
8. Shell preflights **readiness** twice: its own or-plan-readiness (apps,
   surfaces, capabilities vs installed reality ✅) and the Planner's readiness
   report now carries **live device truth** — required device offline/stale →
   fail; engaged elsewhere (busy) → warn; uncertified → warn; roaming device
   bound to another room → warn with the hint ✅.
9. 🔜 **AI pre-op skills** (P5): readiness summarizer ("tray unverified,
   implant sizes missing, recorder still busy in OR-2"), preference-card
   drift explainer, schedule-risk flag. Suggest-only, scope-filtered context,
   every suggestion audited.

### In procedure · Conduct
10. The circulator advances the **case lifecycle**; each phase change drives
    the display controller: desired display state diffed against believed state →
    layout intents, route intents, compose intents — all **signed with the
    room key (bodyHash-bound)** to the agents ✅.
11. Agents verify (room, fingerprint, TTL, nonce anti-replay, body binding),
    ack async, execute against the vendor system (your Barco control lands
    inside `barco-agent` ✅ seam), and report terminal job events ✅.
12. **Truth loops run continuously**: the barco-agent folds the Nexxis event
    stream into its reported state (manual operator changes included) ✅; the
    Shell's display-truth reconciler compares belief vs reported every ~20s —
    missing/mismatched/unexpected routes alarm and re-drive ✅. Route failures
    are never silent: red board state, critical log, audit, retry ✅.
13. Protection during the case: actuate ops need explicit approval ✅;
    device **busy-state** blocks room switches and `requiresIdle` ops (the
    pump stays in its room while it infuses) ✅; `system.stop` e-stop is never
    blocked ✅; operator slot overrides are phase-scoped and announced ✅.
14. 🔜 **AI in-op** stays suggest-only (`matrix:display-recommend` →
    `matrix.aiIntent/1`): propose a layout/route for the phase; the Shell gate
    (min of skill policy, Planner ceiling, case policy) requires confirmation.

### Close → Review
15. Case events (lifecycle, utilization, overrides, route failures) post to
    the Planner (`matrix.caseEvent/1`, idempotent) ✅ → per-card aggregation →
    re-tune signals ✅. The recorder's session manifests (start/segments/stop,
    spine-safe) reserve the media chain ✅.
16. 🔜 **AI post-op skills**: case debrief from the event stream; preference-
    card re-tune *suggestions* presented in the Planner for surgeon approval —
    the learning loop closes with a human hand on it.

---

## 2. Offline behavior (designed invariant: the room never depends on anything outside itself mid-case)

| Down | During Ready | During Conduct |
|---|---|---|
| **Planner** | Shell keeps last **verified** snapshot; banner "operating from cache" 🔜(banner UI); no new publishes | Zero effect — plan already local ✅ |
| **Registry** | Planner readiness shows `live: null` (authored checks still run) ✅; enrollment defers | Zero effect — Shell↔agent traffic is direct, never brokered through the registry ✅ |
| **Room broker (MQTT)** | Agents run HTTP-only (L1), presence falls back to lease ✅ | Same — commands are HTTP; MQTT is push freshness, not a dependency ✅ |
| **An agent** | Presence degrades gracefully (degraded→stale→offline) ✅; readiness fails that device ✅ | Reconciler surfaces the truth gap after 3 misses; route failures alarm + retry ✅ |
| **Whole WAN** | Site stack is on-prem (per-site topology) — nothing leaves the building anyway ✅ | Room is self-contained: plan cached, keys local, agents local ✅ |
| **Shell renderer** | — | Watchdog reloads ×3 → 🔜 static safe fallback layout (never dark displays) |

Timeout discipline everywhere (no call can hang the console) ✅; circuit
breakers on agent upstreams ✅; durable state on every tier (journals, shadow,
outboxes, atomic writes) so restarts recover instead of forgetting ✅.

---

## 3. Safety & risk-control ladder (hazard → enforcing layer)

1. **Wrong room** → room keys: agents verify only their active room; Shell
   refuses wrong-room snapshots even when genuinely signed ✅
2. **Tampered/forged plan** → Ed25519 envelope + payloadHash + pinned key ✅
3. **Forged command** → HMAC envelope, bodyHash-bound, nonce anti-replay ✅
4. **Impostor device** → CA enrollment (PoP), per-device revocation ✅
5. **Unauthorized physical action** → safety classes; actuate ⇒ explicit
   approval + agent-side interlocks (last line of defense) ✅
6. **Engaged device misused** → busy-state: no room switch, no requiresIdle
   ops mid-engagement; e-stop always available ✅
7. **Silent failure** → route-failure escalation, display-truth reconciler,
   honest health (mock ≠ real, degraded visible) ✅
8. **Fake data in production** → demo eradication + production refuses demo
   relaxations + watermark ✅
9. **Who did what** → hash-chained audit on every tier; rebinds, refusals,
   overrides, AI suggestions all land in it ✅ (central forwarding 🔜)
10. **Wrong human** → 🔜 OIDC identity (P2) — the rem