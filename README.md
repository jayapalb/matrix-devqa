# Matrix Plus — Dev Environment (`matrix-devqa`)

A **complete simulated operating room** on your laptop. Every platform
component runs in Docker; devices without real hardware are played by
**simulators that are indistinguishable on the wire** — the Planner, Shell,
and Device Registry never learn whether a device is real or simulated. You
can bring the room up, run an entire surgery end-to-end, inject faults, and
tear it down — on macOS, Windows, or Linux.

## The one rule

> **Real-vs-simulated is a deployment fact, not a protocol fact.**

- Every "device" is a **real `@matrix/agent-sdk` agent** (signed envelopes,
  Ed25519 identity, durable jobs, MQTT presence, conformance-certified). Only
  the hardware *beneath* it is simulated.
- The barco agent drives **`nexxis-sim`** — a vendor-NMS simulator
  implementing the routing-api + `/events` WebSocket — so it is *genuinely*
  healthy (`state: ok`, real upstream, live event bridge). Same wire shape as
  a real Nexxis install.
- Device agents run with `MATRIX_SIM_HARDWARE=true` (set **only** in this
  compose file): their sim drivers report as healthy upstreams. Outside this
  rig the same agents honestly report `mock` (spec §6) — the flag lives here,
  not in the product.
- **The trust seam runs hospital-grade in the rig**: the planner signs
  `snapshot/2` envelopes (Ed25519, key `or-fleet-1`, mounted from
  `certs/planner-signing-key.pem`), and the shell pins the public key with
  `MATRIX_SNAPSHOT_TRUST=required` — tampered or unsigned plans are NEVER
  applied, in dev exactly as in production.

## Prerequisites

| OS | Install |
|---|---|
| macOS | Docker Desktop, Node 20+ (22+ recommended) |
| Windows | Docker Desktop (WSL2 backend), Node 20+; run make targets from WSL2 or use the raw `docker compose` commands below |
| Linux | Docker Engine + compose plugin, Node 20+ |

Node on the host is used for cert generation and the surgery runner; the
stack itself is all containers.

## Quickstart

```bash
cd matrix-devqa
make certs        # one-time: site key package for OR-01..03 + roaming cart
make up           # build + start the whole OR              (docker compose up -d --build)
make smoke        # health + topology + planner live-readiness checks
make surgery      # ⬅ headless END-TO-END SURGERY through the story, asserted
make logs         # follow everything        make down     # stop
```

Without make (any OS): `docker compose up -d --build`,
`node scripts/run-surgery.mjs`.

**Just want the OR Planner?** `make up-planner` brings up exactly the 12
services the Planner needs (adaptors included, shell-story hardware excluded)
— see [docs/RUN-OR-PLANNER.md](docs/RUN-OR-PLANNER.md) for the saved setup,
URLs, and first-run steps.

## What's running (17 services)

| Tier | Service (host port) |
|---|---|
| Room bus | `mqtt-broker` :1883 — presence (LWT) + retained state |
| Control plane | `device-registry` :4430 · `audit-service` :4460 · `app-store` :4410 |
| Planning | `planner-api` :14500 · `planner-web` :15500 · `ehr-adapter` :14600 |
| Cloud app | `arthrex-surgeon` :14402 |
| Vendor sim | `nexxis-sim` :4599 — the "NMS rack" (routing-api + `/events` + fault injection) |
| Router agent | `barco-agent` :4550 (video + audio routing, inter-OR; drives nexxis-sim) |
| Device agents | `light-agent` :4520 · `recorder-agent` :4530 · `display-agent` :4540 (2× 4K) · `pump-agent` :4560 · `shaver-agent` :4570 · `audio-agent` :4590 (alerts + music) |
| Roaming cart | `cart-agent` :4580 — multi-room package, touchscreen at `/device` |

The **Matrix Shell (Electron) runs natively on the laptop** and points at
this stack: `make shell` launches it (matrix-shell/.env carries the stack
URLs; the OR-03 room identity is pre-seeded — or import
`certs/.../OR-03/room-auth.json` via Shell Settings). Run `make surgery`
while the window is open to WATCH the surgery: the shell loads the published
plan, drives phase layouts, tracks every device over broker presence, and
polices display truth as the case runs.

UIs: room console `http://localhost:4430/assets/room.html?siteId=SITE-001&roomId=OR-03`
(per-device pages linked) · planner `http://localhost:15500` · cart
touchscreen `http://localhost:4580/cart`.

## The surgery runner (end-to-end testability)

`make surgery` plays THE-STORY.md against the live stack, signing every
command with the room key exactly as the Shell does, and asserts each beat:

1. **06:45** cart wheeled in → docked to OR-03 (roaming rebind)
2. Preflight: full fleet online via broker LWT; barco healthy on its real
   (simulated) upstream; planner readiness merges live registry truth;
   published + signed snapshot present
3. **07:30** case start: lights scene (actuate + approval), endoscope →
   main display, music routed + playing, case-start chime, recording on
4. Mid-case: infusion under approval/interlocks; busy-state visible platform-wide
5. **Scene 9**: a "vendor tech" flips a route at the physical panel
   (`nexxis-sim` injection) → the agent folds display truth (`via
   barco-event`, planner ids) → re-drive restores the plan
6. Critical voice alert **ducks the music**, then restores it
7. Inter-OR consult share + unshare (runtime-only — never planner-authored)
8. Close: everything stands down; registry lifecycle feed populated
9. **When the Electron shell is running** (`make shell` with
   `MATRIX_DEV_CASE_CONTROL=true`), the runner also plays the **circulator**:
   it selects the case on the shell and advances the lifecycle through the
   authority-gated path — room-prep → pre-op-timeout → in-procedure →
   closing → post-op — so the case progresses ON SCREEN (headless CI skips
   these beats cleanly)

Exit 0 = the story holds. Non-zero = a beat regressed. Wire it into CI as-is.

## The chaos drill (does it FAIL SAFE?)

`make chaos` (`scripts/run-chaos.mjs`) is the adversarial twin: it injects
exceptions into the LIVE room and asserts each produces the correct defensive
reaction — not that nothing breaks, but that breakage is caught, refused, or
re-driven. Six exceptions:

1. **Device drops mid-case** (hard-kill an agent) → registry detects it via
   Last-Will in seconds; shell raises `DEVICE_OFFLINE_MID_CASE`; device recovers.
2. **Display divergence** — a "vendor tech" re-routes at the panel
   (`nexxis-sim` injection) → agent folds display truth; shell reconciler flags
   `DISPLAY_DIVERGENCE`; re-drive restores the plan.
3. **Interlock** — calibrate the pump while it's infusing (`requiresIdle`) →
   refused.
4. **Forged plan** — a tampered / wrong-room snapshot → refused by the shell
   verifier (`payload-tampered` / `bad-signature`), never applied.
5. **Break-glass** (Scene 12) — the surgeon forces a source outside the plan →
   applied and **logged with actor + reason** (or a procedure-locked refusal —
   both auditable, neither silent).
6. **Emergency stop** — `system.stop` **latches** the device degraded and
   refuses new actuate work until an explicit `system.reset`.

Exit 0 = the room fails safe. Runs shell-aware (alarms + break-glass when the
Electron shell is up) or device-tier-only headless.

## The campaign — simulate procedures day in, day out (touchstone)

`make campaign` runs a **day of surgical cases** through the
[touchstone](/Users/jayapalboompally/work-p/touchstone) QA framework
(vendored as a tarball; the `.qa/` layer lives here, in-workspace). One test =
one case, run serially; chaos is **woven into** the procedure (not a separate
drill), and each case is classified by how the room coped:

| Recovery mode | Meaning |
|---|---|
| `clean` | baseline case, no fault |
| `auto-recovered` | the system detected + fixed it with no blocking operator action (re-register, reconciler re-drive, availability reflect) |
| `refused-safe` | an unsafe command was correctly refused (interlock, forged plan) |
| `manual-override` | the operator intervened and it was **logged with actor + reason** (break-glass) |
| `unhandled` | ❌ a fault went undetected/unrecovered — the run fails |

Each case records a data bundle (fault, MTTR, recovery mode, alarms,
caseMayProceed); the day writes an aggregate to
`.qa/artifacts/campaign/latest.md` and touchstone emits one honest verdict.
A run is a "day"; repeat it (the `or-campaign` nightly workflow) for
day-in-day-out trends.

```bash
make campaign-install         # one-time: install the QA host deps
make campaign                 # a day of 8 cases (QA_CAMPAIGN_CASES=N to scale)
cat .qa/artifacts/campaign/latest.md
```

Full campaign (case lifecycle + break-glass + alarms) needs the Electron shell
up (`make shell`); headless it runs the device-tier scenarios and skips the
shell-dependent beats cleanly — so CI stays green without a GUI.

## Evidence — every tier, folded into each case

As each case runs, touchstone collects evidence from the **whole OR**, not just
pass/fail. Two mechanisms:

- **Auto gatherer** (`.qa/app-qa/evidence-gatherers/or-state.mjs`) — runs after
  every case and writes `or-state.json`: a full snapshot of
  **device-registry** (topology, drift, event feed), **device telemetry**
  (every agent's `/state` + `/health`: jobs, upstreams, busy, latched e-stop),
  **barco** routes/audio/inter-OR, **planner** readiness + published version,
  **vendor-sim** truth (what the "hardware" actually did), and the **Electron
  shell** (audit tail, alarms, case lifecycle, display control) via the shell's
  `/evidence` dev-console endpoint. On a failed case it also grabs bounded
  **container logs**.
- **Suite push** — the campaign attaches the case record + an
  injection-moment cross-tier snapshot (`case-N-tiers.json`) via
  `attachEvidence`.

Everything lands in `.qa/artifacts/runs/<id>/evidence/<case>/`. A red case
carries everything needed to explain it — from every tier — without a re-run.
The collector is `.qa/app-qa/lib/or-evidence.mjs` (`collectAllTiers()`); most
tiers already expose their state over HTTP, so the only instrumentation added
was the shell's consolidated `/evidence` endpoint.

## Fault-injection cookbook

```bash
# vendor tech changes a route at the panel (display-truth divergence):
curl -X POST localhost:4599/sim/routes -H 'content-type: application/json' \
  -d '{"videoSinkId":"sink-main","slotId":"slot-1","videoSourceId":"enc-roomcam"}'

# a source cable is pulled / restored:
curl -X POST localhost:4599/sim/sources/availability -H 'content-type: application/json' \
  -d '{"videoSourceId":"enc-endo","availability":"unavailable"}'

# hard-kill a device → offline via Last-Will in ~4s (not lease expiry):
docker compose kill shaver-agent    # docker compose start shaver-agent to recover

# engage a device (busy-state gates room switches + requiresIdle ops):
# → run the pump: infusion.start via a signed command (see scripts/run-surgery.mjs)

# vendor-side truth at any time:
curl localhost:4599/sim/state
```

## Adding a new simulated device

1. Write the agent on `@matrix/agent-sdk` (`matrix-device-agents/<name>/agent.mjs`)
   — capabilities with safety classes, `busy()` if it can be engaged,
   `safeState` for e-stop. **Never hand-roll a server.**
2. Certify: `node conformance/conformance.mjs --base http://localhost:<port> --room-auth <room-auth.json>`
3. Catalog the kind in `matrix-device-registry/data/device-kinds.json`
   (or let it surface as `uncataloged` — the open catalog accepts it).
4. Add a compose service (copy any device block; set `DEVICE_ID`,
   `MATRIX_MOUNT_MODE`, port) — the shared `x-agent-env` gives it the
   registry, broker, and sim-hardware flag.
5. It self-registers, shows in the room console, and is drivable via signed
   commands — planner/shell/registry treat it like any other device.

## Test matrix

| Layer | Command |
|---|---|
| Full OR e2e | `make surgery` (this folder) |
| Stack health | `make smoke` |
| SDK + agents | `node --test matrix-device-agents/sdk/src/*.test.mjs` · `cd matrix-device-agents/barco-agent && npm test` |
| Registry | `cd matrix-device-registry && node --test` |
| Planner | `cd matrix-planner && npm test --workspace @matrix/contract --workspace @matrix/api` |
| Shell | `cd matrix-shell && npm test` |

## Layout

```
matrix-devqa/
├── docker-compose.yml       the whole OR (17 services)
├── .env                     host-port overrides
├── Makefile                 certs/up/down/logs/ps/smoke/surgery/shell-env/clean
├── docker/                  planner.Dockerfile · agents.Dockerfile (node:22) ·
│                            node-service.Dockerfile · mosquitto.conf
├── sim/nexxis-sim/          vendor NMS simulator (routing-api + /events + /sim/*)
├── scripts/
│   ├── smoke.sh             quick health sweep
│   └── run-surgery.mjs      the asserted end-to-end surgery
└── certs/                   generated room-auth (make certs; git-ignored)
```
