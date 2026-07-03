# Matrix Plus — Platform Architecture

> Status: living document. Defines both **what exists today** (grounded in the
> `/matrixplus` repos) and **the target it needs to reach the goal**, with a
> phased roadmap from one to the other. Not a flag-day rewrite — every phase is
> independently shippable and locks a contract the next depends on.

---

## 1. Goal

Matrix Plus is the platform that **runs the digital operating room across a
hospital fleet**. Nurses and staff plan rooms in the multi-user **Matrix Planner**
web app; the in-room **Matrix Shell** drives the displays, sources, and AI for each
live case.

**Core promise: deterministic, auditable case readiness at fleet scale** — the
right plan reaches the right room at the right time, every action is attributable
to a verified human or service, and clinical/safety compliance is provable after
the fact. The platform evolves its four layers incrementally, keeping
**`matrix.snapshot/2`** as the stable load-bearing seam between authoring and
runtime.

## 2. Design principles

1. **Authority is layered and explicit.** Planner = **authoring** authority;
   Runtime Services = **publish/distribution** authority; the in-room Shell =
   **runtime policy** authority that executes a published plan.
2. **Control-plane vs runtime separation.** Cloud authors and distributes intent;
   the Shell is the single trusted in-room policy authority. **AI and adapters
   propose; the Shell disposes** — the trusted computing base never widens.
3. **Safety-gated by default.** Every action that touches the displays, routes video,
   or invokes AI passes one in-room gate (`display-policy`/`authority-service`) with
   confidence + role + lifecycle checks. Failures **downgrade to require-confirm**,
   never fail open.
4. **Everything attributable and tamper-evident.** Every mutation, publish, route,
   approval, and AI action carries a verified actor and lands in an append-only,
   hash-chained audit trail that aggregates fleet-wide.
5. **Contracts are the spine.** All wire artifacts carry an explicit
   `schemaVersion` (SemVer-on-schema: minor additive, major needs a migrator) and
   live in one shared `@matrix/contract` package — Planner and Shell deploy
   independently.
6. **Freeze the seam, bridge with adapters.** Do not re-bump `matrix.snapshot` in
   place; resolve the /1-vs-/2 split with a shell-side **normalizer**. Onboard new
   device classes / hospital systems as **descriptor + adapter**, never core edits.
7. **Role-portable RBAC.** One canonical role+permission vocabulary (`@matrix/authz`)
   governs both planning verbs (Planner) and room verbs (Shell), from a single
   source so they cannot drift.
8. **PHI stays out of the platform spine.** Snapshot, audit, and event payloads
   carry only `caseId` / procedure-code / role / opaque ids; real patient data
   lives in the clinical source-of-record, referenced by id.
9. **Incremental and reversible.** Each phase is independently shippable;
   new enforcement rolls out **fail-open then fail-closed**.
10. **Least privilege everywhere.** Services authenticate to each other, rooms
    enroll per-room credentials, AI skills read only the context scopes their
    manifest declares.

---

## 3. Layered model (current → target)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  CLOUD / SERVER — control plane                                                │
│  Matrix Planner(evolve) · Runtime Services(new) · Case Worklist(new)           │
│  Fleet Registry(new) · Identity/OIDC + @matrix/authz(new) · Audit & Event(new) │
│  App Store(evolve) · Device Registry(evolve) · Router/Barco(evolve)            │
│  Support/LiveKit(evolve) · DICOM gw(new) · HL7/FHIR ingest(new)                │
└───────────────────────────────┬──────────────────────────────────────────────┘
              matrix.snapshot/2 envelope · case.assigned · snapshot.published
                                │  (Event backbone: SSE + long-poll, signed)   ▲ heartbeat/applied
┌───────────────────────────────▼──────────────────────────────────────────────┐
│  IN-ROOM — Matrix Shell (Electron, trusted host & policy authority)            │
│  Snapshot Normalizer(new) → displayPlan/roomPlan · display-policy/action-broker      │
│  authority-service(RBAC) · case state machine · source orchestration           │
│  skill-registry(new) · ai-context-provider(new) · hash-chained audit           │
└───────────────────────────────┬──────────────────────────────────────────────┘
              window.matrixApi · shell:bus (validated inter-app envelopes)
┌───────────────────────────────▼──────────────────────────────────────────────┐
│  HOSTED APPS — sandboxed in WebContentsView                                    │
│  Matrix Apps (surgeon-pref, vitals, implant-readiness) · ai-case-copilot       │
│  Vendor adapters (Barco, Arthrex Vision) · DICOM/HL7 adapter apps(new)         │
└───────────────────────────────┬──────────────────────────────────────────────┘
              approved route intent · device control
┌───────────────────────────────▼──────────────────────────────────────────────┐
│  DEVICES / VENDOR fleet                                                         │
│  Barco Nexxis routed displays · OR devices (CCU·pump·camera·scope·encoder/decoder·vitals) │
│  LiveKit · OR carts · room-cert (per-room enrollment)                          │
│  + Device Type Catalog / Source-Kind Registry (deviceKinds/2, new)             │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Component status

| Component | Repo / where | Status | Target responsibility |
|---|---|---|---|
| **Matrix Planner** | `matrix-planner` | evolve | **Authoring only.** OIDC authn, ETag concurrency, signs publishes, delegates distribution to Runtime Services. Absorbs legacy Console authoring. |
| **Runtime Services** (snapshot-store + publish API) | — | **new** | System of record for published snapshots (Postgres), room-scoped pull + push. The single control-plane URL the Shell points at. |
| **Case Worklist Service** | — | **new** | Per-case schedule, case→room→plan binding; emits `case.assigned` (the delivery trigger). |
| **HL7/FHIR ingest adapter** | — | **new** | ORM/ORU/SIU/Appointment → versioned `CaseProfile`, PHI-masked. |
| **Fleet Registry** | — | **new** | One fleet truth: sites/rooms/shell-versions/running-snapshot; drift detection. |
| **Identity / OIDC + `@matrix/authz`** | — | **new** | Clinical SSO; canonical role+permission matrix for Planner **and** Shell. |
| **Audit & Event Service** | — | **new** | Append-only fleet clinical audit; ingests Planner events + forwarded Shell segments. |
| **Service Identity / mTLS issuer** | — | **new** | Per-service workload credentials (SPIFFE-lite). |
| **Matrix App Store** | `matrix-app-store` | evolve | Catalog + deploy; `desiredApps` derived from `snapshot.apps[]`; service-token gated. |
| **Device Registry** | `device-discovery-service` | evolve | Typed device taxonomy + capability descriptors; feeds Fleet Registry. |
| **Matrix Router** | Barco adapter (`2.0.0` API) | evolve | Registers as encoder/decoder/display protocol handler; reports health. |
| **Matrix Support** | `repremotesupport` | evolve | LiveKit tokens bound to verified user/room identity; audited. |
| **DICOM gateway** | — | **new** | C-FIND/C-MOVE/WADO; projects studies as `dicom-image` Sources. |
| **Matrix Shell** | `matrix-shell` | evolve | In-room policy authority; consumes snapshot/2 via normalizer; connects to backbone. |
| **Snapshot Normalizer** | in `matrix-shell` | **new** | `snapshot/2` → internal `displayPlan`/`roomPlan`; verifies signature; **retires snapshot/1**. |
| **Matrix AI** (skills/agents) | `ai-case-copilot` + shell routing | evolve | Skill manifest + intent envelope, single-gated suggest→approve→act. |
| **Matrix Devices** | `device-discovery-service`, `or-cart-device`, `room-cert-gen` | evolve | Device Type Catalog + per-room enrollment. |
| **Legacy Matrix Console** | `operating-wall-control-plane` | **retire** | Read-only compat shim during migration → decommission. |

---

## 4. Key contracts (the spine)

> All carry `schemaVersion`. Authored in `@matrix/contract`; validators +
> migrators ship with them.

| Contract | From → To | Shape (abridged) |
|---|---|---|
| **`matrix.snapshot/2`** *(frozen)* | Planner → Runtime Services | Inner payload **frozen** (room, capabilities, controllers, roles, apps, displays, sources, surfaces, layouts, `plans[].steps[]{routes,overlays,fallback}`). Wrapped in transport envelope `{schema, schemaVersion:2, snapshotId, roomKey:{siteId,roomId}, version, publishedAt, publishedBy, checksum, payload}`. **No /3 without a migrator.** |
| **Shell ingest** (normalizer target) | Runtime Services → Shell | Maps snapshot/2 → internal `publishedRoomPlan` the Shell already consumes → versioned `displayPlan/roomPlan/1`. Resolves /1-vs-/2 with **zero** runtime rewrite. |
| **`case.assigned`** | Worklist → Runtime → Shell | `{caseId, roomKey, procedureId, preferenceCardId?, planId, snapshotVersion, scheduledStart, status}`. **The delivery trigger** — assigning a case publishes that room's snapshot live. |
| **`snapshot.published` / `.applied` / `shell.heartbeat`** | Runtime ↔ Shell ↔ Fleet Registry | published `{snapshotId,roomKey,version,checksum,mode}`; applied ack `{shellVersion,snapshotVersion,ok,normalizerWarnings[],capabilityStatus}`; heartbeat `{currentSnapshotVersion,installedAppIds[],lifecycleState}`. Registry computes drift. |
| **`matrix.session/1` + `service-token/1`** | Identity → all | User JWT `{sub:'clin:U-…', facilityId, matrixRoles[], scope[], roomId?, amr[], exp≤15m}`; service token `{sub:'svc:…', aud, scope[], exp≤10m}`; room token from `room-auth` enrollment. |
| **`@matrix/authz` role matrix** | shared | Canonical roles (circulator, surgeon, anesthesia, scrub-tech, rep, biomed, planner-staff) → perms `{source.route, layout.apply, preset.apply, agent.invoke, plan.adopt}`. Shell `authority-service` loads **this**, not a hardcoded policy. |
| **`matrix.audit.entry/1`** | all → Audit Service | Hash-chained `{seq, prevHash, hash, stream, facilityId, roomId, actor{sub,role,attestation,amr}, action, authzDecision, target(non-PHI), reason}`. |
| **`matrix.skill/1` + `matrix.aiIntent/1`** | apps/AI → Shell gate | Skill manifest in `matrix-app.json.capabilities.ai`: `{skillId, kind, runtime, contextScopes[], intents[{id, actionClass, defaultApprovalPolicy, minConfidence, cooldownMs}], guardrails}`. Intent envelope is a strict superset of `matrix:display-recommend`. |
| **`matrix.caseProfile/1.0` + worklist** | Worklist → Shell | `{caseId, patientLabel(masked), procedureName/Type, roomId, scheduledStart, surgeons[], staff[], requiredApps[], requiredDevices[], implantRequirements?}`. |
| **ETag concurrency + `appManifest/1.0`** | Planner / App Store | `GET` returns `ETag: W/"<roomId>:<rev>"`; mutating writes require `If-Match` → **412** on stale (replaces last-writer-wins). `matrix-app.json` gains required `schemaVersion`. |
| **`matrix.deviceType/1` + `deviceKinds/2`** | Device Registry | `{deviceClass, mediaKinds[], capabilities{canSource,canSink,canRoute,controllable,paramSchema?}, controlProtocol:'barco-nms'|'dicom'|'hl7'|'webrtc'|…, sourceKind}`. Kills the three-place `kind` duplication. |

---

## 5. Roadmap (current → target, highest-leverage first)

| Phase | Goal | Key deliverables | Locks |
|---|---|---|---|
| **P1 — Close the core loop** | Shell actually consumes what Planner publishes; concurrent edits stop clobbering. | **Snapshot Normalizer** (snapshot/2 → displayPlan/roomPlan) + golden-snapshot conformance tests; `schemaVersion` discriminant + `migrate('publishedPlan/1'→'snapshot/2')`; Planner serves one SnapshotV2 envelope; **ETag/If-Match** concurrency (412 on stale). | `matrix.snapshot/2` as the seam |
| **P2 — Identity, RBAC, audit** | Every change/publish/route/approval attributable — precondition for hospital deployment. | OIDC on Planner (`matrix.session/1`); `@matrix/authz` generating Planner perms **and** Shell action policy; Shell loads policy from `snapshot.roles[]`; central **Audit & Event Service**; PHI CI guard. | `@matrix/authz`, `audit.entry/1` |
| **P3 — Runtime Services + fleet delivery** | Cloud becomes the durable, signed, push-capable system of record. | snapshot-store on **Postgres**; transport envelope (checksum/provenance); **Event backbone** (per-room, signed; SSE + long-poll); **Fleet Registry** + drift detection; **mTLS** between services. | delivery + fleet truth |
| **P4 — Case Worklist + HL7** | Cases flow in automatically; `case.assigned` = explicit delivery trigger. | **Case Worklist Service** behind the URL Shell already calls; HL7v2/FHIR ingest → `CaseProfile`; cut Shell off `DEMO_CASE_PROFILES`; implant-readiness wired to real data. | `caseProfile/1.0` |
| **P5 — Formalize Matrix AI** | Auditable suggest→approve→act; AI never widens the TCB. | `matrix.skill/1` validated by Shell; `matrix.aiIntent/1` (superset of `display-recommend`); `effectiveApprovalPolicy = min(skill, Planner ceiling, case policy)`; scope-filtered `ai-context-provider`; Claude/Anthropic provider + deterministic local fallback. | AI contracts |
| **P6 — Devices, DICOM, fleet ops** | Onboard device classes/hospital systems as descriptor+adapter; run on real infra. | `deviceKinds/2` + Device Type Catalog; class→protocol map; **DICOM gateway** (studies as Sources); migrate file-JSON → Postgres; **OpenTelemetry** across control plane; enforce `appManifest/1.0`. | device taxonomy |

## 5.1 Deployment topology (decided 2026-07-01): per-site control plane, cloud aggregates

**The Planner (and its control-plane peers) deploy PER SITE, not as a cloud
service.** Rationale: the Planner's inputs are inherently site-local — room
inventory/capabilities from the site Device Registry, the worklist from the
site's EHR adapter — and its output (signed snapshots) is pulled by shells on
the site LAN. Keeping it on-site means no PHI, no room topology, and no device
control ever leaves the building, and the room keeps working with zero WAN.

**Per-site stack** (one VM / small server in the hospital's rack):
Planner + Device Registry (room CA) + Audit service + App Store + optional
room MQTT broker; `ehr-adapter` at the hospital integration DMZ; shells and
agents on the OR VLAN. Each site's Planner has its **own signing key**; that
site's shells pin that key. Site-local storage (atomic-write JSON → SQLite →
Postgres per site as the site's ops maturity demands) — fleet-scale storage is
NOT a per-site requirement.

**The cloud tier aggregates; it never commands.** If/when a fleet layer is
added it is hub-and-spoke: sites push **spine-safe summaries UP** (room
status, published versions, drift, `caseEvent/1` aggregates, device health
roll-ups — all PHI-free by construction) and the hub syncs **shared assets
DOWN** (procedure/preference-card template libraries, app catalog packages,
policy baselines). The hub holds no room keys, no CA keys, and no path to a
device. A fully hosted Planner for sites without server rooms remains
*possible* over the same snapshot/2 seam (it would consume a site-inventory
mirror pushed by the site registry), but it is explicitly NOT the default and
needs its own risk review before offering.

## 6. Build vs integrate

- **BUILD** (platform-specific, load-bearing): the **Snapshot Normalizer** + golden conformance tests; **`@matrix/contract`** (schemas/validators/migrators) and **`@matrix/authz`**; **Runtime Services**, **Fleet Registry**, the `case.assigned` trigger.
- **BUY / OSS** (don't roll your own): **OIDC identity** (Keycloak / managed clinical IdP / SMART-on-FHIR); **HL7v2/FHIR** + **DICOM** toolkits (HAPI / dcm4che-class) behind the manifest surface; **event backbone** (managed NATS/MQTT); **Postgres** + **OpenTelemetry**.
- **INTEGRATE** provider SDKs for AI (add **Anthropic/Claude** alongside existing) — but BUILD the `skill`/`aiIntent` contract, the gate, and the audit; keep the deterministic local router as the safe default.
- **EVOLVE not rebuild**: App Store, Device Discovery (→ Registry), Router (Barco), Support, room-cert, the in-room `shell:bus` + audit hash chain.
- **RETIRE**: legacy `operating-wall-control-plane` / Matrix Console — read-only shim → fold authoring into Planner → decommission once Runtime Services is live.

---

## 7. The one decision that unblocks everything

**P1’s Snapshot Normalizer** is the highest-leverage next build: it makes
Planner→Shell real (today Planner emits `/2`, Shell consumes `/1`), freezes
`matrix.snapshot/2` as the contract everything else hangs off, and is a thin,
testable, in-room adapter that needs **no** Shell runtime rewrite. **P2 (identity
+ audit)** is the deployment blocker right behind it.

*Derived from a grounded map of the `/matrixplus` repos plus a target-architecture
design pass. Component/contract names are stable handles for tracking.*
