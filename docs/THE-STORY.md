# The Story — One Procedure Through Matrix Plus

> **This is the platform's acceptance narrative.** Every beat below is a claim
> the system must keep true — each maps to a component and a test (see the
> conformance table at the end). Beats marked **[FUTURE]** are specced but not
> yet code. When the platform changes, THIS DOCUMENT changes with it; when a
> beat can no longer be demonstrated, that is a regression. The story
> describes the CORRECT target OR procedure: where the system lags the story,
> the beat is marked [FUTURE] and becomes engineering work — the story is
> never downgraded to match a gap, and it must never contain clinically
> wrong or confused OR events.
>
> Companions: `ORCHESTRATION.md` (the reference version, by stage and by
> concern), `MATRIX-ARCHITECTURE.md`, `SCOPE-OF-WORK.md`, `progress-tracker.md`.

## In plain English

Matrix Plus runs the digital side of an operating room. Nurses plan each
case ahead of time — which video goes on which display at each step of the
surgery, which apps and devices must be ready. The room checks itself: every
device reports in, proves its identity, and says whether it is free or busy.
When the case starts, the room configures itself step by step, refuses
instructions that are forged or meant for another room, shows staff
immediately when anything on the displays does not match the plan, and keeps
working even if the network or servers go down. Afterward, what actually
happened feeds back into better plans — and the platform is **designed so
that no patient-identifying data leaves the hospital's clinical systems**:
structured identifiers are stripped at the boundary and machine-blocked at
every exit after it (content-level scanning of free-text fields is the
remaining hardening item before the claim drops the word "designed").
Matrix orchestrates the room; it **does not make clinical decisions and does
not replace the surgical time-out or any clinical safety workflow** — staff
remain the authority, and the platform's job is to make their intent happen
and their reality visible. Matrix shows only the spine-safe case label; staff
confirm patient identity, procedure, laterality, consent, and site in the
hospital's clinical systems and surgical safety workflow — Matrix must never
become the only place clinical identity is verified.

**Five terms:**

- **Spine** — the platform's shared data plane: everything that flows between
  planning, the room, and devices.
- **PHI spine boundary** — real patient identifiers never enter the spine;
  it carries only opaque case ids.
- **PlanBinding** — ties one scheduled case to one room, procedure, surgeon
  card, and plan.
- **Drift** — any gap between expected state and actual state: a missing
  device, an unexpected device, a stale preference card, a changed room
  configuration.
- **Display truth** — what the displays are *actually* showing, continuously
  compared against what the plan says they should show.

---

## Tuesday. OR-03. Total knee arthroplasty. Dr. Rao, 07:30 first case.

### The night before — 18:40

The hospital's MWL/HL7 system emits the schedule; the **ehr-adapter** at the
DMZ maps the ORM/SIU feed into `matrix.worklist/1.0` — at this edge the
patient becomes `caseId: C-4412, patientLabel: "Case C-4412",
procedureType: TKA`. Name, MRN, DOB never cross this line; that is the **PHI
spine boundary** — the "spine" being the platform's shared data plane (plans,
events, telemetry moving between Planner, Shell, and devices), which carries
only opaque ids while real identifiers stay in the hospital's clinical
systems. It is enforced by `assertSpineSafe` at every egress after it.

The charge nurse opens the **Planner**, picks **Tuesday** and **OR-03** on the
worklist board — a day- and room-scoped, time-ordered schedule showing each
case's care team (surgeon, circulator, scrub, anesthesia) — sees C-4412, and
assigns it: **room OR-03 + procedure "TKA" + Dr. Rao's preference card +
plan**. The plan is a **reusable room artifact** — she can mint a fresh one or
attach one OR-03 already holds: when Dr. Rao's second knee of the day is
assigned, it attaches the *same* TKA plan (two `PlanBinding`s sharing one
plan), and unbinding one case never deletes a plan another case still uses.
A `PlanBinding` is written; `case.assigned` is queued as the delivery
trigger. The plan itself is the three-layer merge — the procedure's step
baseline, Rao's card overrides (C-arm fullscreen on the main display during
implant trial, PACS on the side display, vitals on the top bar), and the
per-step hand-tuning
from last month that survived because tuning patches are non-destructive.

She opens **Readiness**. The authored checks pass — but the *live* section,
fed from the **registry topology**, shows one warn:
`OR-03 Recorder (live) — warn — online · engaged: recording session rec-91 in
progress · certified · L1`. The recorder cart is still finishing a case in
OR-02 — its busy flag rode its registration heartbeat into the registry, and
the Planner read it. She flags evening staff to dock it back. *(If the
registry were down right now: the live section says `live: null` and she
plans on authored data — planning never depends on the device tier being up.)*

She hits **Publish**. Three things happen in one action: the snapshot passes
the **structured PHI/egress guard** (free-text content scanning remains the
tracked hardening item), is wrapped in the `matrix.snapshot/2` envelope, and
**signed** —
Ed25519 over the envelope identity plus the SHA-256 payload hash,
`keyId: or-fleet-1`. And the Planner **durably publishes the room's authored
device list to the registry as the expected-inventory baseline**, retried
until acknowledged — from this second, the registry's drift view for OR-03
means *plan vs reality* — delivered through the **durable outbox**: retried
until the registry acknowledges, latest publish per room wins, and a Planner
restart re-delivers anything still pending.

### 06:45 — the room wakes up

Devices power on. Each **agent** (the Barco agent, the lights, the recorder
cart now docked in OR-03) comes up on the `@matrix/agent-sdk` runtime: loads
its room key, its Ed25519 device key, its durable state (job journal, shadow
— nothing forgotten from yesterday), and **registers with the registry**:
signed registration, device cert attached, capabilities from `/spec`, busy
state riding along.

The recorder cart is a **roaming** device — it restores its persisted active
room, sees it is now physically in OR-03, and the dock (or the circulator on
the cart UI) posts `POST /room {roomId: OR-03}` signed with *OR-03's* key.
Old room deregistered, MQTT topics rebound, an audited `room-rebind` lands in
the event stream. Had OR-02's shell tried to keep it via `system.setRoom`
mid-recording last night, the busy interlock would have refused: *the
recorder stays in its room while it records.*

The registry's **room console** for OR-03 now shows: every device, `online`,
`certified` (green serials from the room CA), capabilities with safety-class
chips, **no drift** — expected five, present five, nothing unexpected. That
screen is the biomed's morning glance.

The **Shell** boots, pulls `/api/rooms/OR-03/published-plan`, and runs the
gauntlet before a single pixel is driven: signature verifies against the
**pinned planner trust root** (established at room commissioning and
persisted; any change alarms until an operator re-pins — implementation note:
bootstrap is trust-on-first-use, or an explicitly configured key) → payload
hash matches → **room binding**: envelope says `roomKey: {SITE-001, OR-03}`,
shell *is* OR-03 — pass. *(Inject the failure: a replayed OR-05 plan —
genuinely signed — dies right here with `SNAPSHOT_WRONG_ROOM`, last-good plan
kept, critical alarm, audit entry. A tampered one dies one line earlier with
`payload-tampered`.)* The adapter maps snapshot/2 into the room plan; the
preflight checks installed apps, display surfaces, discovered devices. Ready.

**[FUTURE] AI, pre-op** (contracts specced; skills are the next build): the
readiness summarizer reads the same readiness report + topology and hands the
circulator a prioritized list — "recorder docked ✓, implant tray unverified,
PACS source degraded — check encoder ENC-12." Suggest-only; she acts, it
never does.

### 07:05 — the schedule moves (they always do)

Anesthesia calls: the first case is delayed. The charge nurse updates the
Planner — **C-4412 remains the selected TKA for OR-03**; its expected start
moves, the corrected plan republishes (signed, same gauntlet), the Shell's
next worklist refresh shows the change, and readiness re-runs against the
same procedure requirements. Had a *different* case been moved into OR-03
instead, that case would receive **its own PlanBinding** and C-4412 would be
removed from the room's slot — a reassignment is never a silent mutation of
the original case. The **wrong-room and wrong-plan paths are closed by
construction**: the Shell only offers cases the Planner bound to THIS room,
every plan passes signature, payload-hash, and room-binding checks, and
**selection itself is guarded** — while a case is mid-flight, choosing a
different case is refused until it closes or returns to scheduled. Clinical
wrong-patient, wrong-procedure, and wrong-site prevention remain the
hospital's clinical workflow and surgical time-out; Matrix supports that
workflow by keeping the digital room aligned to the selected case, but it is
not the clinical source of truth for patient identity or consent.

**07:12 — an emergency add-on with no MWL entry yet.** A trauma case is pushed
into OR-05 before the hospital's scheduling feed catches up. The charge nurse
creates it directly in the Planner ("+ Add-on case" on the worklist): the
**ehr-adapter mints it spine-safe** — an opaque `caseId` and a *generated* label
`Add-on · OR-05 · 07:12`, with **no patient identifier ever entering from the
browser** (the label is built at the edge, `assertSpineSafe` re-proves it). It
appears in the worklist beside the scheduled cases and is assigned, planned, and
published through the **identical gauntlet** — the only difference is where the
`caseId` was born (this adapter, not the MWL/HL7 feed). Patient identity stays in
the hospital's clinical system and is confirmed at the surgical time-out; Matrix
shows only the spine-safe label. *(The chosen procedure's code rides along so the
assign panel pre-selects the right procedure.)*

### 07:20 — the room enters digital prep

The circulator advances the **case lifecycle**: `scheduled → room-prep`.
This is **not the clinical surgical time-out** — that happens later, run by
staff under the hospital's safety workflow, outside Matrix; when it is
complete the circulator records it by advancing to `pre-op-timeout`, a
staff-entered marker Matrix observes but never performs. The lifecycle
transition is the clock for everything digital: the **display controller** computes
the desired display set for this phase, diffs against what it believes is applied,
and issues only the deltas — `layout-intent` then `route-intent` to the
**barco-agent**, `compose-intent` to the cart agent. Every command is a
signed, bodyHash-bound `matrix.agentCommand/1` with a fresh `requestId`; the
agent verifies it against *its active room*, acks `202 accepted`, executes
against Nexxis, reports `applied` as a signed event. The Shell decided; the
agent executed; the displays changed.

After patient-in-room setup and the hospital's clinical time-out are
completed, the circulator records the staff-entered marker `pre-op-timeout`
and then advances Matrix to `procedure`. Matrix does not perform or approve
the time-out; it only records the staff-entered lifecycle marker — and the
`procedure` transition drives the procedure-phase display plan.

**07:31 — injection one: the Planner's VM is rebooted by IT.** Nothing
happens in OR-03. The plan is already verified and cached; the hot path
touches no cloud service. The shell banner notes it is operating from the
last verified plan. The case proceeds.

**08:10 — injection two: a vendor tech at the Barco panel manually swaps the
aux display to the room camera.** The barco-agent's Nexxis event bridge folds
that display truth into its reported state; within a reconcile tick the Shell's
**display-truth reconciler** sees belief ≠ display truth: `DISPLAY_DIVERGENCE — display.aux:
expected pacs, display shows roomcam (barco-event)`. Critical log, audit entry,
the diverged belief is forgotten, and the next reconcile re-drives the
planned route. The wrong image is never silently treated as planned: the
display is marked divergent, the alarm is raised, the stale belief is
forgotten, and the planned route is re-driven — unless a sanctioned operator
override says otherwise.

**08:25 — injection three: the recorder cart loses power mid-case.** Its
MQTT last-will fires (or its lease lapses): registry presence walks
`online → degraded → stale → offline`, the lifecycle event lands in the feed,
and the room console goes red on that row — with drift now showing a required
device missing. The recorder's own journal will mark the interrupted session
honestly on reboot. And the **Shell is watching the same feed**: within a
poll tick it raises `DEVICE_OFFLINE_MID_CASE` — a critical, audited,
operator-visible alarm for THIS room's device — and announces the recovery
when the cart comes back. The barco-agent additionally has the reconciler's
truth-gap alarm watching its actual routing state.

**08:40 — injection four: the routing API hiccups mid-phase-change.** The
route command times out (nothing in this platform waits forever), the job
lands `failed`, the route goes **red on the board** with
`DISPLAY_ACTUATION_FAILED — display.main ← carm: displays may not match the
plan`, audit written, and the controller retries on the next reconcile —
which succeeds. Thirty seconds of visible, honest degradation instead of a
silent frozen feed.

**08:50 — break-glass: the human overrides the plan.** Dr. Rao wants PACS on the
main display NOW, plan or no plan. The circulator forces it
from the Shell's display board — a **slot override**, recorded with
`{actor, reason, at}`, applied to the desired model so the display changes
immediately **and the reconciler does not fight a sanctioned override**
(out-of-band panel changes get re-driven; in-band human overrides become the
temporary plan). Overrides are **phase-scoped**: the next lifecycle transition
auto-clears them and announces the drop on the board, so a forced route
never silently outlives its moment.

**[FUTURE] AI, intra-op**: phase-aware and suggest-only — "implant-trial step
reached; Dr. Rao's card routes the C-arm fullscreen — apply?" flows as
`matrix.aiIntent/1` through the Shell gate at `min(skill, planner ceiling,
case policy)` = require-confirm. The circulator taps yes or ignores it. The
AI cannot touch the displays, and every suggestion — accepted or not — is in the
audit chain.

### 09:55 — closing, and the loop closes

`procedure → closing`: the displays re-drive to the closing preset; the
recorder's `stop` writes a durable, spine-safe session manifest (segments the
circulator marked, duration, opaque `caseId` only). Through the whole case
the Shell has been emitting `matrix.caseEvent/1` — phase durations, the route
failure, the manual-override divergence, utilization. The Planner ingests and
aggregates them **per preference card**.

**[FUTURE] AI, post-op**: the debrief writes itself from those events —
"phase overrun 12 min in trial; one route failure recovered; aux display
diverged once" — and the **card re-tune suggester** notices Rao forced PACS onto the main display
during closure in three of his last five TKAs — today's 08:50 override was
the third — and proposes adding it to the card's closing step. It appears in the Planner as a *suggestion*; Rao approves it
Thursday. Next Tuesday's plan is better because of this Tuesday. That is the
flywheel.

### What the record shows

One correlated trail across every tier: `caseId C-4412` → `snapshotId
OR-03-…` (signed, by whom) → each `requestId` → each `jobId` → each device
event, hash-chained in the audit log, device-signed where it matters, with
the day's incidents each carrying a detection code and a resolution. "What
failed, when, why, who was impacted" is answerable from the chain alone.

---

## Story → system conformance

Every beat maps to code + proof. When any row stops being demonstrable, the
story — and the platform — has regressed.

| Story beat | Component | Proof |
|---|---|---|
| PHI stops at the adapter edge | `ehr-adapter`, `@matrix/contract` phi | contract PHI tests; egress guards at snapshot/publish |
| Schedule board: pick a **day + OR**, see that room's time-ordered cases with **care-team context** (surgeon/circulator/scrub/anesthesia) | Planner `Worklist` date+room filter + `ehr-adapter` staff mapping | adapter mapping/worklist tests (staff parsed, room filter); live worklist dated today |
| Assign → PlanBinding → `case.assigned` — mint a fresh plan **or attach the room's existing plan** (a plan is a reusable room artifact; many cases may bind one plan; re-assign/unbind never deletes a plan another case still references) | Planner worklist + assign route | planner API tests + attach/shared-plan e2e |
| **[FUTURE]** Per-step intents: streaming allowance / music / alert policy authored on the procedure step; readiness ties a streaming allowance to a registry-known streaming device in the room; the shell honors the allowance per step — **WHO checkpoints refuse streaming regardless of authoring** (that floor is already enforced + tested shell-side) | contract `Step` (additive fields) + step editor + readiness + shell source policy | checkpoint-refusal tests exist (`source-orchestration`); **the streaming DEVICE is now real** (`streaming-agent-mock`, L1-conformant, busy-while-live, registered in-room — what readiness will bind the allowance to); authoring half not yet built |
| Card ⊕ procedure ⊕ tuning, non-destructive | `resolve.ts` | contract resolve tests |
| Every room app names its REPORTING HOST — the thing that can actually run it: a registry **device** (fleet-discovered, bound to its own displays) or the **shell** (micro-apps — reaching barco displays only as a source COMPOSITED by the composer, or shown on the room display). An enabled app with no host is flagged un-runnable (VAL-APP-HOST); a barco decoder is never a host. **[FUTURE]**: the shell registers its installed micro-app list with the registry exactly like the windows agent does (shell hosts become discovered, not authored); headless API devices (the streamer) surface as plannable CAPABILITIES the planner authors against — never live-commanded by the planner (shell remains the only commander) | contract `AppInstall.host` + VAL-APP-HOST + live-inventory import (registry deviceId → host) + AppsForm host chips | contract tests (unhosted-enabled warns; hosted/disabled clean); import carries the reporting deviceId |
| TWO DISPLAY KINDS are first-class: **barco-decoder** sinks whose slots take routed **sources** (slot capacity modeled — more windows than a decoder's `maxSlots` is a publish **FAIL**, VAL-SLOTS) vs **computer-agent system displays** that host **apps** (VAL-APP-DISP); the demo fleet registers both kinds and the phase preview renders EVERY display with its driver semantics ("Barco · 4 slots (sources)" / "System · hosts apps"). **The demo rig IS the spec**: PC adaptor with a 4K + an HD system display; two barco MNA-420 quad decoders; exactly FOUR clinical barco sources (Endoscope 4K, C-arm 4K, Room Camera HD, PACS HD — plan-alias entries follow the canonicals, and the events-bridge reverse map is first-entry-wins so folds always use canonical ids); ONE speaker + TWO audio sources (music, voice alerts); and a **streaming adaptor** (`streaming-agent-mock`, kind `streamer`, busy-while-live) — same ids the planner authors, so import reads "known" | contract `Display.driver`/`maxSlots` + VAL-SLOTS + `DisplaysPreview` + barco env + `windows-agent-mock` + `streaming-agent-mock` | contract validate tests (overflow fails, system displays exempt); barco-agent bridge tests (canonical-id fold regression, 18/18); streamer **L1-conformant 15/15**, online in-room via MQTT LWT; `make surgery` 30/30 + `make chaos` 12/12 on the new rig |
| Procedure templates author all THREE WHO Surgical Safety Checklist checkpoints — Sign In (pre-induction), Time Out (pre-incision), Sign Out (pre-departure) — not just the middle one; each a staff-entered marker, Matrix never performs/approves any of them | contract `PhaseId`/`PHASES` + seeded procedure steps + Plan preview | contract tests; matrix-shell's case-lifecycle (`case-workspace.js`/`planner-control-model.js`) now consumes a single canonical array — `CASE_LIFECYCLE_STATES` in `electron/case-lifecycle.js` — generated (not hand-typed) via a pinned-ref codegen script (`electron/scripts/sync-contract-phases.mjs`) that fetches matrix-planner's `packages/contract/src/phases.ts` at a pinned commit SHA and regenerates the file with a "GENERATED FILE — DO NOT HAND-EDIT" header; matrix-shell's `npm run check` composite runs `sync:contract:check` to catch any hand-edit drift. **Pinned, not live**: this doesn't auto-detect matrix-planner-side phase changes — a human still has to notice `phases.ts` changed and run `npm run sync:contract -- --ref=<new-sha>` in matrix-shell (`phases.ts` now carries a comment with this exact instruction, right at the array) |
| Live readiness: presence/trust/**busy**/roaming | `device-telemetry.ts` + registry topology | contract telemetry tests + live smoke |
| Busy rides the registration heartbeat | agent-sdk registrar → registry → topology | registry tests + live smoke |
| Signed publish (Ed25519 + payloadHash) | `signing.ts` + publish route | contract signing tests + live smoke |
| Publish pushes expected inventory → drift = plan-vs-reality | publish route + registry expected/drift | live smoke (missing + unexpected both shown) |
| Agents boot with durable state + certs, signed registration | `@matrix/agent-sdk` | SDK suite (journal/shadow/enroll/revoke) |
| Roaming: bind by target key, audited rebind, busy refuses switch | SDK §7.1 | roaming e2e tests (incl. infusion-pump case) |
| FLEET OTA: agents self-update from a PINNED-signed artifact (Ed25519 over {version,sha256}, verified vs a pinned key — a compromised registry can't ship malware), refused during a case / e-stop / busy, staged→apply-on-restart→**rollback** on failed health; the registry is the desired-version AUTHORITY (`versionDrift`), a `fleet-updater` RECONCILES by dispatching the signed command — agents never self-authorize | `sdk/update-capability.mjs` + registry `versionDrift` + `fleet-updater` | 13 unit + 6 e2e (real `/command`: unapproved/wrong-key/busy/e-stop all refused) + registry versionDrift + **full-loop e2e: drift→dispatch→stage→apply→drift-CLEARS**; `update-agent-mock` **L1 conformant 15/15** |
| Mount mode: in-room (fixed) vs cart (roaming) device panel + OR selector | SDK §7.1 (`/spec.room.mountMode`, `/device`) | mount-mode + cart-UI (in-room bind refused 403; cart selector live) |
| THE WHOLE STORY runs headless on a laptop: simulated OR (all components dockerized; sims below the agent line — consumers can't tell real from sim), asserted beat-by-beat | `matrix-devqa` (nexxis-sim + MATRIX_SIM_HARDWARE + `run-surgery.mjs`) | `make surgery` — 36/36 beats incl. cart dock, case lifecycle on the shell (room-prep→post-op via authority-gated dev operator), actuate approvals, busy-state, Scene-9 divergence via vendor-panel injection → fold → re-drive, alert-ducking, inter-OR, clean stand-down |
| THE ROOM FAILS SAFE under chaos: every injected exception yields the correct defensive reaction (alarm / refusal / re-drive / latch), not just "nothing breaks" | `matrix-devqa` (`run-chaos.mjs`) | `make chaos` — 16/16: device-drop→`DEVICE_OFFLINE_MID_CASE`, panel divergence→reconciler flag→re-drive, requiresIdle interlock refused, tampered+wrong-room snapshots refused, break-glass logged with actor+reason, e-stop **latches** degraded + refuses actuate until `system.reset` |
| DAY-IN-DAY-OUT resilience: a campaign of surgical cases with chaos woven in, each classified by how the room coped (auto-recover / manual-override / refused-safe / unhandled), data collected + trended | touchstone QA host in `matrix-devqa/.qa` (`campaign.spec.mjs`) | `make campaign` — 8/8 cases, 6/6 faults handled: auto-recovered ×4, refused-safe ×1, manual-override ×1; per-case MTTR + report; 🟢 SHIP verdict; nightly `or-campaign` workflow for trends |
| THE SHELL RUNS ALL DAY WITHOUT LEAKING: the REAL Electron shell is driven through a compressed surgical shift (case-after-case + app-after-app + woven chaos), sampling a `/diagnostics` health surface; a shift compressed into operation COUNT surfaces the same per-operation accumulation an 8-hour day would | shell `/diagnostics` endpoint + touchstone `@soak` (`shell-soak.spec.mjs`) + `soak-metrics.mjs` (leak analysis) | `make shell-soak` — 200 cycles 🟢 SHIP: views/windows/overrides flat (webContents 5, attached 4 — no residue), bounded collections held at cap (notif≤100/bus≤150/logs≤200), RSS 225→235MB (trend gated by r²≥0.6 **and** magnitude, 6% ≪ 50% budget), 0 renderer crashes; detector proven fail-closed by 17 adversarial unit tests + a negative control that flips view-leak/cap-breach/mem-creep/crash on real samples |
| APPS REACH THE ROOM + every case tells its story: composited app surfaces are asserted on the source-composer host (v0 compat shim records truth); each case emits a cross-tier chronological timeline + phase durations | shell compose fallback to source-composer + windows-agent `legacyV0Routes` + `case-timeline.mjs` | campaign 3/3: apps 3/3 composited (checklist/vitals/telestration), timelines in evidence; id-collision + container-DNS + synthetic-stream gaps caught by the assertion and fixed |
| THE CASE FOLLOWS ITS SURGEON: planner-decorated worklist (planBinding) → shell builds each case's control model from ITS plan; campaign walks every phase scoring PLAN-VS-ACTUAL conformance against barco route truth; shell case events close the Review loop into planner metrics | planner `GET /api/worklist` + shell binding + `/display/expected` + `phaseConformance()` + case-event client | campaign 6/6: Patel + Morris plans produce different models; **100% avg conformance across all phases**; planner review metrics.events > 0 asserted per case |
| Emergency stop LATCHES: system.stop degrades the device + refuses new actuate work until an explicit system.reset (an e-stop must not self-clear) | SDK §4.2 (`system.stop` / `system.reset`) | roaming.test.mjs (latch → actuate refused → reset → ok) + chaos drill |
| Endpoint discovery → authoring: barco agent registers its commissioned decoders/encoders (videoSinks→displayIds, videoSources→sourceId); registry derives the room's display/source inventory; Planner imports it (`live-inventory`); routes execute with planner ids, agent resolves vendor ids | barco-agent `registrationExtra` + registry `deriveFromRegistrations` + planner `import-live-inventory` | dockerized e2e: 4 decoders + 6 encoders derived → imported (idempotent) → signed `applyRoute disp.or3.main ← src.or3.endoscope` applied (state shows sink-main/enc-endo resolved agent-side) |
| Audio routing: commissioned speakers + audio channels (music / voice-alert / mic) register → derive → import, so plans know which music/voice alerts can play where; signed `audio.applyAudioRoute` with volume | barco-agent `audio` capability (feature follows commissioning) + registry `speaker`/`routed-audio` kinds + planner import | barco tests (audio route durable state, feature-gate) + dockerized e2e: music→Room Speakers @35, alerts→Nurse Station @80 |
| Audio GENERATION is its own device: audio-agent plays music + speaks voice alerts into the commissioned encoders (barco routes them); warning/critical announce DUCKS music to 15% and restores on end; e-stop silences | `audio-agent-mock` (kind `audio-host`, cataloged) | L1 certified 15/15 + docker e2e (duck at announce, restore at durationMs — reported-shadow published from the timer) |
| Inter-OR sharing is RUNTIME-ONLY: peers + `interor.shareSourceToRoom` live in agent /spec + /state for the Shell; deliberately absent from the registration → never enters Planner authoring | barco-agent `interor` capability; registration omits `interOrRooms` | barco tests (share/unshare durable, unknown peer refused, registration-material assertion) + docker e2e: endo→OR-01 shared; registration has no interOrRooms |
| Room console: presence, trust, capabilities, drift | registry `room.html` + topology API | registry tests + browser verification |
| Verify signature → room binding → keep-last-good | `snapshot-verify.js` + refresh path | shell tests + live tamper/wrong-room smoke |
| Lifecycle drives desired-state display deltas | `display-controller.js` | controller tests |
| Signed bodyHash-bound shell→agent commands | `agent-envelope.js` | **interop test vs the SDK's real verifier** |
| Planner down mid-case → cache, case proceeds | offline-first hot path | module tests (Electron e2e pending) |
| Manual display change → divergence alarm → re-drive | barco events bridge + `route-reconciler.js` | bridge + reconciler tests |
| Route failure → red, un-believed, retried, audited | controller failure tracking | escalation tests |
| Demo data impossible in production | security profile + worklist gating | eradication tests |
| Case events → per-card aggregation — the shell EMITS the deviation dimension, not just lifecycle/utilization: break-glass `layout-override`, route-actuation-failure `fallback-engaged`, and case `duration-overrun` (actual vs surgeon-card estimate), so Review runs on real detections, not seed data | shell `case-event-client` `buildDeviationCaseEvent` + `emitCaseDeviation` wired at the override / `onActuationFailure` / post-op sites → planner caseEvent ingest + `summarizeCaseEvents` roll-up | planner tests + shell deviation tests (8/8) + cross-repo check: shell-emitted deviations aggregate in the planner summarizer (overrun summed) |
| Correlated audit trail | hash-chained audit + stable codes | audit service tests |
| Shell audit forwarded to central service (correlation + local-chain anchors survive) | `audit-forwarder.js` → matrix-audit-service | audit-forwarder e2e (real service) |
| Break-glass slot override: **RBAC-gated — "who may drive the displays" comes from the room's PUBLISHED controller-role perms** (`display.route` via `authorize()`; an actor whose role lacks the `route` perm is refused + audited `DISPLAY_CONTROL_REFUSED`), then actor+reason recorded, phase-scoped, reconciler respects it | shell `displaySlotOverrides` + override-applied model + `authority-service` display policies (perm-bound) + published `controllerRoles` threaded snapshot→adapter→plan | display-control tests; **authority display-gate tests (published perms govern + override the static default + safe fallback) + cross-tier check: snapshot roles → adapter → normalize → gate**; override auto-clear announced |
| Schedule correction: reassign → republish → worklist refresh | Planner assign/publish + shell worklist | planner assign tests; publish gauntlet tests |
| Emergency add-on: staff mint a spine-safe case when it isn't in the MWL yet (opaque id + generated label, assign→plan→publish as normal) | ehr-adapter `POST /v1/cases` (`addons.ts`) + planner `addon-case` proxy + Worklist "+ Add-on case" | adapter addon tests (spine-safe mint, worklist merge, room filter) |
| Device offline mid-case → graduated presence + console red + drift | registry presence/LWT + room console | registry presence/sweeper tests |
| Cert lifecycle: revoked → refused → re-enroll; expiry auto-renews | registry CA + SDK enroll | cross-tier revoke/re-enroll e2e |
| selectCase guard: no case switch mid-procedure | case-workspace | story-gaps tests |
| Shell in-case alerts from registry lifecycle events (this room only, recovery announced) | `device-lifecycle-watch.js` | story-gaps tests |
| Shell restart while Planner down resumes from the verified plan cache | plan cache (save on verified apply, restore on boot-fetch failure) | story-gaps tests + `PLAN_CACHE_RESTORED` |
| Expected-inventory publish durable + acknowledged (idempotent, restart-safe) + **AUTHENTICATED**: the outbox sends the registry write-token so the drift baseline can't be spoofed (the registry refuses an unauthenticated `expected` PUT with 401; reads stay open) | Planner `outbox.ts` (authToken) → registry `MATRIX_DEVICE_REGISTRY_TOKEN` gate | outbox tests (retry-until-ack, latest-wins, restart, **token-rides-every-delivery**) + registry-enforcement e2e (with-token 200 / without 401) |
| **[FUTURE]** Free-text PHI content scanning at spine ingress | ehr-adapter + case-event ingest | to build + test (risk-register cite) |
| **[FUTURE]** AI pre/in/post skills behind the gate | `matrix.skill/1` + `matrix.aiIntent/1` + gate | contracts specced; build = SOW §5 |
| **[FUTURE]** Named human actors on every action | OIDC/JWKS (P2) | contracts exist; wiring pending |

**Also pending** (tracked, not story-blocking): renderer UI renders the red
route states / watermark the main process emits; packaging + CI; Electron
sever-the-network e2e; central audit forwarding via outbox; observability
dashboards over the existing correlated signals; **alarm acknowledgment + escalation workflow** (who must
ack a critical, when a case may proceed); **key-rotation runbooks** (room
key redistribute + planner trust-root re-pin; per-device revocation is
built); **clock discipline** as a site ops requirement (NTP; note the audit
chain's hash-links give per-stream ordering independent of wall clocks).
