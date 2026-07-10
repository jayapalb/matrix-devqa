# Data-Sync Layer — Integration Brief for External Designers

**Status:** design guidance, not a build spec. **This layer is a SEPARATE system from Matrix Plus** — it sits *beside* the OR platform, not inside it. This brief gives you the constraints, the pieces that already exist (so you don't rebuild them), and the narrow seams where your layer meets ours. Design against these and the platform's hardest property — *the OR keeps working when the cloud drops* — stays intact.

---

## 1. What this layer IS and IS NOT

**IS** — a durable-record + convergence layer for three datasets:
- **Surgeon preferences** — authored centrally, synced to the edge.
- **Captured media** — stills / clips / recorded segments, associated with a case.
- **Device usage & event ledgers** — what a device did during a case (post-hoc record + analytics/billing).

**IS NOT** — a real-time transport, a device-control path, or a shared operational database. Live video and live telemetry already ride their own real-time planes (§2). **Never route a live stream through here.** Your instinct to "ditch streaming, use opportunistic delta sync" is exactly right — *because the live planes already exist elsewhere.*

---

## 2. The platform you sit beside (just enough context)

Matrix Plus is an OR control platform. The parts relevant to you:

- **Control plane** — an in-room controller (the **shell**, running on the OR Wall PC) executes a signed plan and drives devices **only via signed `matrix.agent/1` commands**. Devices ("agents": pump, shaver, scope, camera…) actuate **only** on those commands.
- **Authoring** — a per-site **Planner** authors the plan + preference cards; the shell executes them.
- **Live planes (already exist — do NOT duplicate):**
  - Surgical **VIDEO** rides **Barco/Nexxis** routing (real-time SDI/IP, source→display).
  - Device **TELEMETRY** (pressure, presence, alarms, busy-state) rides **MQTT** + agent state.
- **Coordination** — a per-site device **Registry** holds inventory, presence, and desired-state. It is the desired-state *authority*; it never commands.
- **Trust** — every command is a **signed envelope**; **PHI stops at the "adapter edge"** (the planner/EHR side). The device tier never holds patient identity.
- **Autonomy** — the OR must keep functioning when the network/cloud drops. **Nothing you add may make the room depend on your layer to operate.**

---

## 3. Hard constraints (non-negotiable — patient-safety / security / compliance)

1. **PHI: opaque IDs only below the adapter edge.** Devices and the in-room tier carry only `caseId` / `roomId` / `deviceId` — **never** patient name / MRN / identity. A mobile device that loses power in a hallway must contain **zero PHI**. The patient-identity join happens *above* the adapter edge. **Captured media *is* PHI** → access-controlled, encrypted at rest, retention-governed.
2. **No second control path.** Your layer must **never actuate a device.** Surgeon preferences feed the **Planner** (which authors them into the plan → shell → signed command, gated by device-idle). A device must **not** change behavior from a synced document.
3. **Live stays live.** Video = Barco plane; telemetry = MQTT plane. Your layer carries **durable records synced opportunistically**, not streams.
4. **Signed room binding, not open discovery.** When a mobile device enters a room, it binds via the platform's **signed room-auth (roaming key)** — *not* an unauthenticated mDNS "who runs this room?" exchange, and **never** exchange PHI over discovery. (The *idea* — device learns its room context on entry, appends-never-overwrites — is right; the *mechanism* must be the signed bind + opaque IDs.)
5. **Single-primary-per-database (LiteFS reality) → partition.** LiteFS has one write **primary** per db; replicas are read-only and cannot write while disconnected. So partition such that **each database has exactly one writer**, and the direction of replication matches the data flow. The edge must be able to **write its own db offline** (media/usage capture) and **read replicas offline** (preferences).

---

## 4. What already exists — reuse, don't rebuild

- **The "spoke" already exists.** Matrix Plus device agents already keep a **durable, append-only, opportunistically-synced outbox + journal** (`event-outbox.jsonl`, `jobs.jsonl`; atomic `tmp→rename` writes; retry + dead-subscriber prune). That **is** the `synced=0 → send → synced=1` ledger pattern. **Extend/consume that pipeline** rather than adding a *second* standalone SQLite ledger + sync daemon on the same device — two durable stores on one battery is a consistency/corruption hazard.
- **The "hub" is the shell's host.** The stationary Wall-PC controller per room is where a **LiteFS hub belongs**. The device→hub leg is the **existing agent→shell/registry channel** — reuse it; don't stand up a parallel HTTP path with its own trust surface.
- **Room / identity context comes from the platform.** Get `caseId` / `roomId` / `deviceId` and the room binding from the **registry + signed roaming-bind**, not from your own discovery.

**So the genuinely NEW pieces you own are narrow:** LiteFS across the stationary **hubs** (hub↔hub↔cloud), **MinIO** (or any S3-compatible store) for media payloads, and the record **schema**.

---

## 5. The seams (your contract surface — keep it narrow)

- **Down (preferences):** the Planner **reads** preference documents from your store to author the plan. Model prefs as **surgeon-authoritative, centrally-written, edge-read**.
- **Up (records):** capture/usage **writes** documents keyed by opaque `caseId` + `roomId` + `deviceId` + UTC timestamp; they converge to the case record.
- **Media:** payloads → **MinIO**; your document holds **metadata + object-store reference + thumbnail / small stills**. **Never** sync multi-GB blobs through the DB layer (SQLite is *worse* at big blobs than most stores).
- **Record of truth:** the case record ultimately reaches the **EHR via the platform's `ehr-adapter`** (above the PHI boundary). Your layer *feeds* that; it is not the permanent legal record unless explicitly scoped to be.

---

## 6. Design decisions you own (with the consideration for each)

| Decision | What to weigh |
|---|---|
| **DB partition topology** | Single-primary per db. e.g. per-OR/per-case media+usage db with the **edge as primary** (writes offline → replicates **up**); a central prefs db with the **cloud as primary** (edge **reads** a replica offline). One writer per db ⇒ **no conflict resolution needed** — keep it that way. |
| **Idempotent ingest** | Dedupe by record **UUID** at the hub (`INSERT OR IGNORE`). At-least-once delivery + idempotent ingest = **effectively-once**, and it closes the "hub wrote the row but power died before `synced=1`" gap. |
| **Device durability** | `PRAGMA journal_mode=WAL; PRAGMA synchronous=EXTRA;` for battery-yank safety (correct — matches the platform's atomic-write discipline). |
| **Access-control granularity** | LiteFS replicates whole db **files** (no per-document channels). Make the **db boundary your access boundary** (per-OR / per-case db, replicated only to authorized nodes) + app-layer authz. Design this in from the start — retrofitting PHI scope is painful. |
| **MinIO layout + lifecycle** | Bucket/prefix by site/room/case; server-side encryption; retention/lifecycle rules; access via **short-lived signed URLs**, not open reads. |
| **Clock discipline** | Mobile clocks drift. Carry a **monotonic device sequence** + device-stamped UTC + **hub-stamped receive time**; don't order the record on device wall-clock alone. |
| **Schema evolution** | Version every document. The fleet updates asynchronously (devices are offline for stretches), so hubs must read **version N and N-1**. |
| **Retention + purge** | PHI retention is regulated. Define purge explicitly: device-side after ack, hub-side per policy, object-store lifecycle. |
| **Backpressure + batching** | Bounded opportunistic delta (`WHERE synced=0 LIMIT N`). The device must **never stall its primary clinical function** to sync. |

---

## 7. Open questions to settle jointly with us

1. Is media captured by the **device** or by the **shell** on the device's behalf? (Decides where the SQLite/Lite + MinIO client live.)
2. Which node hosts the **LiteFS hub** — the shell process host, or a sidecar on the Wall PC?
3. DB granularity: **per-OR vs per-case** for the media/usage store (drives access scope + retention).
4. **Retention policy**, MinIO cluster ownership, and key management (KMS).
5. Is your layer the **record-of-truth** for media, or a **staging/convergence** tier that feeds the EHR-adapter?

---

## 8. Explicit non-goals (say *no* to these)

- **Not** a live video/telemetry transport — Barco + MQTT own those.
- **Not** a device-control path — preferences feed the Planner, never the device.
- **Not** a shared operational DB the OR reads to function — that would break room autonomy.
- **Not** a PHI store on mobile devices — opaque IDs only.

---

*One-line summary for your team:* build a **durable-record convergence layer** (LiteFS hubs on the stationary Wall PCs + MinIO for payloads), **partitioned single-writer-per-db**, that carries **preferences down / media + usage up** using **opaque IDs and signed room binding** — reusing the device agents' existing append-only outbox and the shell as the hub, and staying strictly out of the live-video, live-telemetry, and device-control planes that already exist.
