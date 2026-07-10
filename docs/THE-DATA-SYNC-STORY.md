# THE DATA-SYNC STORY — how a fact travels from a shaver to the record

**Status:** DESIGN narrative for the **Data Sync Core (v0.0.5)**. This is a **separate system from Matrix Plus** — it meets the platform only at the named seams (§ *The seams*). Same discipline as [THE-STORY](THE-STORY.md): every beat is meant to be **demonstrable**; once built, a beat that stops being demonstrable is a regression.

**The premise.** One shaver — `Shaver-042` — through one chaotic surgical day. Follow a single fact it authors and watch it survive a power yank, a dead network, a room change, and a trauma with no time to log in, until it lands *correctly attributed* in the patient's record. Nothing here is ever a database "sync." Every step is a **transfer of custody** of an immutable, signed fact.

---

## Act I — Identity & binding (before the first cut)

**Beat 1 — The device wakes up trustworthy, and holds no PHI.**
`Shaver-042` powers on and, before anything else, proves two separate things: it is *genuine hardware* (a non-exportable key in its secure element, signed at the factory by the Manufacturer Attestation CA) and it is *enrolled here* (an operational certificate from this hospital's CA). It opens its append-only SQLite journal — `WAL` + `synchronous=EXTRA` + `trusted_schema=OFF` — and writes `device_booted`. From this moment it will author facts forever, and it will never store a patient's identity.

**Beat 2 — It finds its room without being told a secret.**
mDNS answers exactly one question — *where is the room hub?* (`_hospital-data-hub._tcp.local`) — an IP endpoint, nothing more. No patient, no case, no PHI rides discovery. The device opens **mTLS** to `Hub-OR-02`, which checks its certificate against an **offline CRL cache** (it could have been revoked while the WAN was down) and issues a **signed context lease**: `procedure_context_id = ctx-proc-01J1ZP7K3`, nurse-confirmed via an opaque staff token, valid for the case. That id is deliberately meaningless — random, non-derived, rotatable, resolvable to a patient only far upstream. The device writes `procedure_context_bound` and starts tagging its facts with it.

## Act II — Authoring facts through chaos

**Beat 3 — Every action becomes an immutable, signed fact.**
The surgeon starts cutting. `usage_started`, `telemetry_sample`, `alarm_raised`, `alarm_cleared`, `usage_stopped` — each **appended, never edited**. Each carries a monotonic `device_seq` (the *authoritative* order — not the wall clock), the hash of the fact before it (tamper-evidence + gap detection), and a hardware-backed signature. The ledger is now a chain no one can quietly rewrite.

**Beat 4 — A nurse yanks the cord. Nothing is lost.**
Mid-cut the cart is unplugged and the battery was flat; the device dies instantly. But `WAL` + `synchronous=EXTRA` meant the last write either committed fully to flash or never happened — no torn record (and the vendor *proved* this under forced power-cuts on the real flash + firmware, not in theory). It reboots, opens the same journal with a new `boot_id`, and resumes exactly where it stopped. The unsynced facts are still there, still marked unsynced.

**Beat 5 — The network is gone. It keeps logging anyway.**
The hub is unreachable for twenty minutes. The device does not care — *central was never required for it to log.* Facts pile up locally, each awaiting custody transfer. This is the whole point: **the device is the author of record until someone proves they've taken custody.**

## Act III — Transfer of custody

**Beat 6 — Opportunistic custody transfer (not a sync).**
Wi-Fi returns. The device selects facts with no `hub_accepted` receipt (oldest `device_seq` first) and POSTs a batch under an idempotency key. The hub runs **insert-or-compare**: new facts are durably committed; an exact replay (`event_id` + `device_id` + `device_seq` + `event_hash` all match) is acknowledged as a safe duplicate; anything with the *same key but a different hash* is **rejected and raised as an integrity incident** — the hub never overwrites, never silently ignores. It returns a **signed receipt** naming exactly which facts it now holds. Only then does the device record `hub_accepted`.

**Beat 7 — The receipt dies in transit. The system self-heals.**
Power drops after the hub committed but before the device saved the receipt. The device still believes those facts are unsynced, so it re-sends them. The hub sees the identical `id`+`seq`+`hash`, recognizes a safe duplicate, and re-acks. **At-least-once delivery + integrity-checked idempotency = effectively-once** — nothing lost, nothing double-counted.

**Beat 8 — The shaver is wheeled to another room.**
Between cases it rolls to `OR-03`. It **re-binds** — a new signed lease, a new `procedure_context_id` — and tags everything from that second forward with the new context. It never rewrites the `OR-02` facts it is still carrying; those sync up to whatever hub they meet, unchanged. A device that is "everywhere and nowhere" stays consistent because **it only ever appends.**

## Act IV — The hard cases

**Beat 9 — A trauma. No time to log in.**
A code comes in; there is no moment to bind a case. The surgeon grabs the shaver and it works *instantly*. The device flips to an explicit `emergency_override` mode — `procedure_context_id` null, a fresh `override_session_id` — and logs anonymously but completely. **Care is never blocked by a handshake.** The facts are real; they are simply not yet attributed.

**Beat 10 — Resolution happens where the trust is.**
The hub forwards its holdings to central through the same signed outbox; central applies the same insert-or-compare and confirms custody. And **only here, above the adapter edge**, does `procedure_context_id` resolve to a patient / encounter / EHR case — in central mapping tables the device never saw. For the trauma, an authorized human late-binds hours later: central appends an `emergency_events_reconciled` fact linking that `override_session_id` to the real case. **History is never mutated** — the correction is itself a new, permanent fact, and every downstream reader computes the truth by replaying the timeline.

## Act V — Rest

**Beat 11 — Custody-gated forgetting.**
The device deletes a fact only after it holds a valid `hub_accepted` receipt *and* its retention window has passed. The hub deletes only after `central_confirmed` *and* its window. Central keeps everything, permanently, under institutional compliance. **Nothing is ever dropped before someone provably took the baton.**

---

## The seams — how this meets Matrix Plus (a separate system)

This layer is **not part of Matrix Plus.** It touches it at exactly four points — get these right and it slots in cleanly:

| Seam | Contract |
|---|---|
| **`procedure_context_id` ↔ case** | Minted by the Matrix Plus **Planner** (or EHR-adapter) when the case is scheduled, so the opaque handle the device carries is the same one the platform — which owns `case → patient` above the adapter edge — can resolve. **The key seam.** |
| **`device_id`** | The *same* identifier the device uses as a `matrix.agent/1` device, so facts correlate across the control and data planes. |
| **Device identity / enrollment** | Either **rides** the platform's existing device PKI (`matrix.deviceCert/1`, registry CA, per-device revocation) or runs **deliberately parallel** — a conscious decision, not an accident. |
| **`operator_session_ref`** | Resolves through the *same* upstream actor identity Matrix Plus uses for RBAC — not a parallel staff-token scheme. |

The **live planes stay where they are**: surgical video on **Barco/Nexxis**, live telemetry + device control on the Matrix Plus **signed-command + MQTT** planes. This layer carries **durable records only**.

---

## Why the story can't lie (the invariants)

- **Immutable facts + hash chain** → no one rewrites history; gaps are detectable.
- **Signed custody receipts** → no fact is "gone" until someone provably holds it; no fact is double-counted.
- **De-identification at the edge** → a device lost in a hallway carries zero patient *or* staff identity; identity lives only in central mapping tables and the EHR.
- **Autonomy** → the room never waits on the cloud; the device never waits on the network; care is never blocked by a bind handshake.

---

## Demonstrability map (beat → spec § → the check that must hold once built)

| Beat | v0.0.5 § | The invariant to demonstrate |
|---|---|---|
| 1 Trustworthy boot, no PHI | §2, §4, §21 | Device journal opens; `device_events` has no patient column; genuine + enrolled certs required |
| 2 Discover + signed lease | §7, §22 | mDNS returns endpoint only (no PHI); mTLS + CRL check; lease carries opaque `procedure_context_id` |
| 3 Immutable signed facts | §3, §5, §6 | Hash-chain verifies; `device_seq` monotonic; tamper of any row is detectable |
| 4 Power-yank durability | §4, §19 | Forced power-cut on production flash → no torn/corrupt record; resumes on reboot |
| 5 Offline logging | §0, §19 | Hub/central down → device keeps appending; nothing blocks |
| 6 Insert-or-compare custody | §11, §12 | New → commit; exact replay → safe duplicate; same-key/different-hash → rejected + incident |
| 7 Effectively-once | §13, §19 | Receipt lost → re-send → duplicate re-ack; zero loss, zero dup in the record |
| 8 Room-hop | §7, §19 | Re-bind to new context; old facts unchanged and still deliver |
| 9 Emergency override | §8 | Anonymous immediate logging; explicit `override_session_id`; no handshake gate |
| 10 Upstream resolution + reconcile | §14, §16, §17 | `procedure_context_id → patient` only at central; late-bind appends a correction, never mutates |
| 11 Custody-gated retention | §18, §25 | No delete without the receipt for the next tier + the window |

---

## Not yet in this story (roadmap)

The Data Sync **Core** is device→hub→central **event ingestion**. Two datasets that started this discussion still need their own (differently-shaped) designs:
- **Surgeon preferences** — a **down-sync** (central-authored → edge), the *opposite* direction; it feeds the **Planner**, not the device directly.
- **Media (image/video)** — payloads to an **object store (MinIO)** with metadata/refs; blobs, not events.

*This narrative is the ingestion core. Extend it as those land.*
