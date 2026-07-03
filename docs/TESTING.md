# Matrix Plus — Testing

The durable map of how the platform is tested, top to bottom. Five layers,
from fast per-component unit tests to a full simulated-OR campaign with chaos.

> **North star:** every layer of THE-STORY.md is backed by a test. A beat that
> stops being demonstrable is a regression — and something below fails red.

---

## The layers at a glance

```
  Layer 5 · CI gates ............ every push + nightly (GitHub Actions)
  Layer 4 · Touchstone campaign . a DAY of surgical cases, chaos woven in, conformance-scored
  Layer 3 · System runners ...... drive the whole docker OR (surgery / chaos / smoke)
  Layer 2 · Conformance certifier  gate a live agent onto matrix.agent/1 (L1/L2/L3)
  Layer 1 · Component unit suites  each component's logic in isolation (no docker)
```

Run cost climbs with the layer. Layers 1–2 are seconds and gate every commit;
3–4 need the docker stack up (`make up`) and take minutes; 5 runs them for you.

---

## Layer 1 — Component unit / integration suites

Fast, hermetic, no docker. Each component proves its own logic.

| Component | Location | Count | What it covers |
|---|---|---|---|
| **Agent SDK** | `matrix-device-agents/sdk/src/*.test.mjs` (13 files) | **43** | room-auth envelopes (sign/verify/replay/expire), Ed25519 device keys, durable job journal + idempotency across restart, desired/reported shadow + reconcile, event outbox + **dead-subscriber prune**, roaming + **device-busy interlocks**, **latched e-stop + reset**, net timeout/retry/breaker |
| **barco-agent** | `matrix-device-agents/barco-agent/*.test.mjs` | **17** | routing/layout/preset commands, **audio routing + inter-OR**, events-bridge folds vendor truth, catalog verified vs **NMS 2.0.0** docs, token auth |
| **device-registry** | `matrix-device-registry` (`node --test`, 2 files) | **14** | presence graduation (lease → LWT), trust levels, deviceKinds catalog, inventory derivation, drift, mount-mode capture |
| **Matrix Shell** | `matrix-shell/electron/__tests__/*.test.js` (36 files) | **243** | snapshot-verify (trust off/warn/required, tamper, wrong-room), alarm registry + escalation + ack, route reconciler + display-truth, audit forwarder cursor/anchor, agent-envelope signing (interop vs real SDK verifier), display-control model, extracted main.js modules (demo-fixtures, validators, notification/manifest normalizers, shell-state shared-ref contract, json-store, app-package sha/manifest, app-registry rebuild/serialize, app-installer guard/automation-safety, micro-app-host state/capability, **shell-events catalog** — every emitted `code:` is a registered, typed event, enforced no-orphans), **bus router** (publish/deliver, channel ACLs, contract + schema enforcement, rejected-event ledger — stub-dep tested), **notification pipeline** (store→admission→lifecycle, clinical-noise suppression outside a case, ack/dismiss/action, critical-always-escalates), **plan executor** (API surface, null-safe display-control slice, never-ready-without-a-plan, plan-less rebuild clears the model, reconciler does not auto-arm without a Barco agent). main.js is now ~1.7k lines of wiring over 14 modules; the 51 IPC handlers live in `shell-ipc.js` behind `registerShellIpc(ctx)`. **`shell-fuzz.spec.mjs`** (`@fuzz`, `make shell-fuzz`) hammers all 54 exposed IPC methods × 16 hostile payloads (~864 calls: null/huge-string/proto-pollution/deep-nest/path-traversal/injection/unicode/wrong-typed-actor) with a liveness ping after each — main process must never crash; runs against a THROWAWAY profile (touchstone 0.8.1 `electron.ephemeralUserData`, gated to the fuzz run) so it can't touch the real room-auth, and RELAUNCHES on crash so one bad channel doesn't blind the sweep. **Renderer units** (`src/**/*.test.tsx`, Vitest + Testing Library, jsdom): panels render with a stub main-process bridge injected through the real `useMatrixShell` seam (`renderWithShell(<Panel/>, stub)` — un-stubbed calls throw, no false-pass); `NotificationsPanel.test.tsx` (4: ack/dismiss route through the bridge, failed-ack surfaces the error, empty-state touches nothing). Run: `npm run test:react`; `npm run check` runs BOTH shell layers |
| **Planner contract** | `matrix-planner/packages/contract` | **34** asserts | snapshot/2 signing (Ed25519 + payloadHash), device-telemetry merge, PHI spine-safe, normalize, device-registration |
| **Planner API** | `matrix-planner/apps/api` | suite | OIDC/JWKS (RS256/ES256/EdDSA, alg-confusion rejected), service tokens, durable outbox, identity/RBAC action-matrix, plan/source/device cascades |
| **audit-service** | `matrix-audit-service` | **5** | hash-chain integrity, matrix.audit/1 schema, poison-pill advance |

**Run:**
```bash
cd matrix-device-agents && node --test sdk/src/*.test.mjs
cd matrix-device-agents/barco-agent && npm test
cd matrix-device-registry && node --test
cd matrix-shell && npm test          # electron main (node:test)
cd matrix-shell && npm run test:react # renderer panels (vitest) — or `make shell-units` for both
# ^ ALSO folded into the touchstone ship verdict as the `external` signal (qa.config externalSuites) on `npm run qa`/`make campaign`
cd matrix-planner && npm test --workspace @matrix/contract --workspace @matrix/api
cd matrix-audit-service && npm test
```

---

## Layer 2 — Conformance certifier (the onboarding gate)

`matrix-device-agents/conformance/conformance.mjs` — runs against a **live**
agent and certifies it against the normative `matrix.agent/1` spec. This is the
gate a new device class must pass to join the platform.

- **L1 (15 checks)** — `/health` honesty, `/spec` + safety classes, device
  identity, unsigned/tampered/replayed/expired envelopes rejected, signed ack +
  terminal state, idempotency, actuate-approval gate, e-stop op, `/subscribe`.
- **L2** — MQTT retained presence + state on the room broker.
- **L3** — registered + certified at the registry.

Every reference + mock agent passes **15/15**. Run against any agent:
```bash
node conformance/conformance.mjs --base http://localhost:4520 \
     --room-auth <room-auth.json> [--broker <url>] [--registry <url>]
```

---

## Layer 3 — System runners (drive the whole docker OR)

In `matrix-devqa/scripts/`. Need the stack up (`make up`); the full path also
needs the native shell (`make shell`).

| Runner | Make | Asserts |
|---|---|---|
| **smoke.sh** | `make smoke` | all 18 containers healthy, topology online, planner live-readiness |
| **run-surgery.mjs** | `make surgery` | THE-STORY beat-by-beat (**~36 beats**): cart dock → case lifecycle (room-prep→post-op) → signed device orchestration → busy-state visible → Scene-9 vendor-panel divergence → fold → re-drive → alert-ducking → inter-OR consult → clean stand-down |
| **run-chaos.mjs** | `make chaos` | fails SAFE (**16 checks**): device drop → LWT + alarm + recovery · panel divergence → reconciler flag + re-drive · requiresIdle interlock refused · tampered + wrong-room plan refused · break-glass logged with actor+reason · e-stop latches until reset |

Each runs shell-aware: full beats with the shell up, device-tier only headless
(CI sets `QA_ALLOW_HEADLESS=1`).

---

## Layer 4 — Touchstone QA campaign (the world-class layer)

`matrix-devqa/.qa/` — the deterministic touchstone QA host. This is where
"does the OR integration system work, day in and day out" is measured.

**`campaign.spec.mjs`** (`@campaign`, `make campaign`) — a **day of surgical
cases**, one test each, run serially, chaos woven into the procedure. Per case:
- the case follows **its surgeon's plan** (Dr. Patel's rotator vs Dr. Morris's
  ACL build different control models — planner-decorated worklist → shell);
- **plan-vs-actual conformance** scored every lifecycle phase vs barco route
  truth (target 100%);
- **apps tier** — the plan's composited surfaces reach the display host;
- **review loop** — shell case-events ingested into planner metrics (asserted);
- recovery classified (`auto-recovered` / `manual-override` / `refused-safe` /
  `unhandled`) + MTTR;
- a cross-tier **timeline** + phase durations written to evidence.

**`shell-electron.spec.mjs`** (`@shellui`, `make shell-qa`) — the **real
Electron window** (stop `make shell` first — shared profile): boots from built
dist, mounts OR navigation, main-process OR-03 identity, Case Execution renders
the planner worklist.

**Supporting libraries** (`.qa/app-qa/`):
- `lib/or-harness.mjs` — signed commands, chaos injectors, shell operator
  console, `phaseConformance()`.
- `lib/or-evidence.mjs` + `evidence-gatherers/or-state.mjs` — per-case
  cross-tier snapshot (registry topology/drift/events, per-agent telemetry,
  barco routes, planner readiness, vendor-sim truth, shell audit/alarms/case).
- `lib/case-timeline.mjs` — chronological merge of every tier.

Evidence per case lands in `.qa/artifacts/runs/<id>/evidence/<case>/`; the day
aggregate is `.qa/artifacts/campaign/latest.md`. Touchstone emits one honest
ship verdict.

```bash
cd matrix-devqa
make campaign-install          # one-time: touchstone QA host deps
make up && make shell          # stack + native shell
make campaign                  # a day (QA_CAMPAIGN_CASES=N to scale)
make shell-qa                  # the real shell window (stop `make shell` first)
```

---

## Layer 5 — CI gates

`.github/workflows/`:
- **`or-e2e.yml`** (every push/PR) — unit suites → certs → stack up → smoke →
  **surgery** → **chaos** → build renderer → **@shellui** (under xvfb).
- **`or-campaign.yml`** (nightly + manual) — a day-of-cases for trends; uploads
  the campaign report + evidence.

> ⚠️ **Not yet active:** the workspace is not a git repo. These workflows are
> staged and validated; `git init` + push to GitHub activates them.

---

## Coverage by component

| Component | Unit | Conformance | Runners | Campaign | Shell-UI |
|---|---|---|---|---|---|
| Agent SDK | ✅ | — | ✅ | ✅ | — |
| barco-agent | ✅ | ✅ | ✅ | ✅ | — |
| light/pump/shaver/recorder/audio/cart agents | ✅ (via SDK) | ✅ | ✅ | ✅ | — |
| windows/display agent | ✅ (via SDK) | ✅ | ✅ | ✅ (apps) | — |
| device-registry | ✅ | (target) | ✅ | ✅ (evidence) | — |
| Planner (contract+API) | ✅ | — | ✅ (readiness) | ✅ (binding, conformance, review) | ✅ (worklist) |
| Matrix Shell | ✅ (210) | — | ✅ (main proc) | ✅ (operator) | ✅ (window) |
| nexxis-sim | — | — | ✅ (fault inject) | ✅ | — |
| audit-service | ✅ | — | — | ✅ (via forwarding) | — |
| matrix-apps | — | — | — | ✅ (composite only) | — |
| **ehr-adapter** | ⚠️ none | — | ✅ (live only) | ✅ (worklist) | — |
| **app-store** | ⚠️ none | — | ✅ (health only) | — | — |

**Honest gaps:** the **ehr-adapter** (worklist/HL7/DICOM mapping) and
**app-store** (deploy/check-in) have no dedicated suite — exercised live but
not unit-asserted. matrix-apps are asserted only at "did the surface composite,"
not their internal behavior.

---

## How touchstone relates to these tests (FAQ)

**Q: Does `touchstone init` / its discovery pick up the L1/L2/L3 conformance
tests — or any of our existing suites?**

**No — and that is by design.** Touchstone is a QA *layer you add beside* an app
to author NEW deterministic suites against the app's surface; it is **not a test
aggregator that inventories your existing tests**. Its discovery maps three
things so an agent (or you) can author suites:

- `detect-app` — how to boot the app + port + env (found the shell's Electron +
  27 env keys);
- `detect-infra` — backing services (deps / `.env` / compose images);
- `crawl` — browsable surfaces (the registry console's pages).

It never scans for test files. In fact `detect-app` explicitly **ignores**
`test/`, `tests/`, `__tests__/` directories, and `touchstone init` writes its
*own* placeholder `smoke.spec` ("the smoke suite is a placeholder; add suites
under `app-qa/suites/`"). So the conformance certifier — a bespoke CLI that runs
against a *live agent* — was never going to be discovered; nor were the SDK
`*.test.mjs` or shell `__tests__` suites.

**To make touchstone aware of L1/L2/L3**, you *wrap* the certifier as a
touchstone suite: a `@smoke`/`@api` spec under `.qa/app-qa/suites/` that imports
or shells out to `conformance.mjs` for each live agent and asserts the verdict.
That folds agent conformance into touchstone's ship verdict — a deliberate
one-file authoring step, not auto-discovery. (Same shape as how the campaign
already wraps the signed-command harness.)

**Bottom line:** touchstone runs the suites in `.qa/app-qa/suites/`
(`@campaign`, `@shellui`) and its own quality signals. Layers 1–3 above run
independently (npm/node/make) and are gated separately in CI. They are
complementary, not overlapping — touchstone is the system/acceptance layer, the
unit suites + certifier are the component/contract layer.
