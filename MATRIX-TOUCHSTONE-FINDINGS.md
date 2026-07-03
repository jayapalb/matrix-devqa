# Touchstone findings — from the Matrix Plus adoption (2026-07-02)

Findings from exercising **touchstone 0.7.0** against the Matrix Plus simulated
OR: the campaign/gatherer layer in production use (`matrix-devqa/.qa`), plus
a deliberate evaluation pass over the discovery tools (`init`, `detect-app`,
`detect-infra`, `detectMonorepo`, `crawl`) against real matrix repos and the
live stack. Every finding below was reproduced, with source references.
Self-contained — paste into the touchstone repo as-is.

**Target context (matters for the crawl findings):** a multi-repo platform.
The two browser UIs are (a) a Vite SPA whose navigation is `<button>` clicks
mutating client state (no router hrefs), and (b) a plain-HTML console served
under `/assets/*` and routed by **query string** (`room.html?siteId=&roomId=`,
`device.html?deviceId=`), with real `<a href>` links between pages.

---

## What worked (keep doing this)

- **The deterministic split is real and it pays.** The whole OR campaign
  (multi-case chaos suite) runs with no model and no API key; seeded and
  reproducible. This is the framework's standout property in practice.
- **Evidence gatherers are excellent architecture.** One dropped-in file
  (`evidence-gatherers/or-state.mjs`) gave every test a cross-tier evidence
  bundle, auto-discovered, bounded, tied to pass/fail. Zero plumbing written.
- **The safety gate works** — it refused to run until `QA_ALLOW=true` was set
  in `.env.test`. Right behavior for a framework that mutates its target.
- **`detect-app` on an Electron app is genuinely impressive**: for
  `matrix-shell` it returned `electron: true`, framework Vite, port 5173, the
  correct entry, **and all 27 env keys from `.env`** — which included the
  app's full integration surface (`MATRIX_PLANNER_URL`,
  `MATRIX_BARCO_AGENT_URL`, `MATRIX_AUDIT_URL`, trust-mode flags). "What URLs
  does this app need?" answered statically, correctly.
- **Crawl's per-surface capture is high quality even when the walk fails**: on
  the SPA it still recorded title, headings, **an inventory of all 13 nav
  buttons**, console errors (none), failed requests (none), and a screenshot.
  The raw material for an SPA mode is already being collected (see F5).

---

## Findings

### F1 · `--help` is not guarded — commands execute for real — **P1**

`touchstone init --help` **ran init** (scaffolded `.qa/`, linked
`.claude/skills`, edited `package.json`) in whatever cwd it was invoked from —
in this case the touchstone repo itself. `touchstone crawl --help` **ran
crawl**, which wiped the test DB (see F2) and then crashed. There is no
help/flag parsing before dispatch (`cli.mjs` maps `argv[2]` straight to a tool
module).

*Repro:* `node cli.mjs init --help` in any directory.
*Expected:* print usage, exit 0, touch nothing.
*Suggested fix:* intercept `-h/--help` (and unknown flags) in `cli.mjs` before
importing the tool module; print per-command usage.

### F2 · `crawl` performs its destructive step before its dependencies resolve — **P1**

Order in `tools/crawl.mjs`: `assertTestEnvironment()` → `startEphemeralMongo()`
→ **`wipe()`** (`[crawl] test DB wiped`) → `startMockServer()` → `startApp()`
→ `await import('@playwright/test')`. When the peer dep is unresolvable (see
F3), the run dies **after** the wipe. A misconfigured invocation can destroy
test data and produce nothing.

*Repro:* run `node <touchstone>/cli.mjs crawl` from a directory without a
consumer install → `ERR_MODULE_NOT_FOUND: @playwright/test`, but the wipe has
already happened.
*Suggested fix:* resolve all imports (playwright included) up front, before
any mutating step; or move the wipe to just before `crawlSurfaces`.

### F3 · CLI requires a consumer install; bare/`file:`-symlink invocation breaks on the peer dep — **P2**

`@playwright/test` is a peerDependency, so the CLI only resolves it when run
via a consumer's `node_modules` (`node node_modules/touchstone/cli.mjs …`).
Running the CLI from the framework checkout against another directory, or
consuming touchstone via a `file:` **symlink** dependency, both fail with
`Cannot find package '@playwright/test' imported from …/define-qa.mjs`. The
packed-tarball path works (and is what Matrix now vendors:
`vendor/touchstone-0.7.0.tgz`).

*Suggested fix:* document loudly ("always run via the consumer install"); or
lazy-resolve playwright from `process.cwd()` first; or fail fast with a
friendly message naming the fix.

### F4 · `crawl` ignores `staticRoutes` and the `baseURL` path — BFS is hardcoded to `/` — **P2**

`tools/crawl.mjs` calls `crawlSurfaces(page, { baseURL, maxPages })` — no seed
routes. `core/crawl.mjs` starts at `/`. Consequences observed live:

- config `staticRoutes: ['/assets/room.html?…']` → never visited;
- setting `baseURL` to the console page itself
  (`http://…/assets/room.html?siteId=…`) → the crawler still fetched `/`
  (`new URL(path, baseURL)` with root-absolute `path`).

Any app whose UI does not live at `/` yields exactly one surface (`/`).

*Suggested fix:* seed the queue with `['/', baseURL.pathname+search,
...staticRoutes]`.

### F5 · `crawl` link rules structurally exclude two common app shapes — **P2**

1. **Pages under `/assets/` are hard-excluded** — `core/crawl.mjs`
   `internalLinks` drops `/^\/(auth|logout|signout|uploads|fonts|static|assets)\b/`.
   The registry console's real pages (`/assets/room.html`,
   `/assets/device.html`) can never be crawled even when properly linked.
2. **Query strings are stripped before queueing** (`h.split('?')[0]`) — a
   query-routed app (`device.html?deviceId=X`) collapses to one paramless
   visit, losing the instance dimension that path-routed apps keep via
   `:id` collapsing.
3. **SPA button navigation is invisible** — a Vite SPA with `<button>` nav and
   zero `<a href>` yields one surface. Crawl already inventories the buttons
   (13/13 captured on the Matrix Planner), so a "click-walk mode" (BFS over
   captured buttons with URL/DOM-signature dedupe) has its inputs available.

*Suggested fix:* make the exclusion list configurable; add an opt-in
"query-aware" routing mode (`?k=v` → `?k=:v` in `normalizeRoute`); SPA
click-walk as a follow-on.

### F6 · `detectMonorepo` misses nested workspace globs — the standard npm layout — **P2**

`matrix-planner` declares `workspaces: ['packages/*', 'apps/*']` yet returns
`{ isMonorepo: false }`. The gate is
`childPkgs.length >= 1 && (wsArr.length > 0 || …)`, where `childPkgs` only
contains **top-level** dirs with a `package.json`. With nested globs the
packages live one level down (`apps/api/package.json`), `childPkgs` is empty,
and the declared-workspaces evidence is collected into `reasons` and then
discarded.

*Repro:* `detectMonorepo({ pkg: { workspaces: ['apps/*'] }, entries: [{name:'apps', isDir:true}], readChildPkg })` → false.
*Suggested fix:* when `wsArr.length > 0`, expand the globs one level and
gather sub-apps from the matches; a declared `workspaces` field should be
sufficient evidence on its own.

### F7 · `detect-infra` has no MQTT signature — **P3**

`INFRA_SIGNATURES` covers rabbitmq/kafka/redis/sql/object-storage, but not
MQTT. Matrix's only backing service is a room broker (`mqtt` npm dep in the
registry + agents; `eclipse-mosquitto:2` compose image) and detect-infra
reported "none" across all six repos — the one true positive available was
out of vocabulary.

*Suggested fix:* add
`{ name: 'mqtt', kind: 'queue', lifecycle: 'adapter', deps: ['mqtt', 'async-mqtt', 'aedes'], envKey: /^(MQTT|BROKER)_/, schemes: ['mqtt', 'mqtts', 'ws+mqtt'], images: ['eclipse-mosquitto', 'emqx', 'hivemq'] }`.

---

## Evaluator errors (not findings — recorded so nobody chases ghosts)

- First `detectApp` calls passed `{}` as `envText` (expects a string) →
  `env.matchAll is not a function`. Harness error; correct calls worked.
- First `detectMonorepo` call passed a bare `pkg` instead of
  `{ pkg, entries, readChildPkg }` → trivially false. The **correct** call is
  what exposed F6.

## Incident note (cleanup owed in the touchstone repo)

F1's `init --help` misfire ran inside the touchstone checkout: `package.json`
was modified (reverted via git) and `.qa/` + `.claude/` were written
(untracked; left in place for review). Caveat: an **untracked `.qa/` existed
there from Jun 22 and init overwrote it** — if its contents mattered, they are
not recoverable from git. Cleanup once reviewed: `rm -rf .qa .claude` in the
touchstone repo.

## Scorecard against Matrix (one platform's data point)

| Tool | Verdict on this platform |
|---|---|
| deterministic runner + gatherers + verdict | **Carried a real multi-case chaos campaign; the standout** |
| `detect-app` | **Strong** — Electron/Vite/env-URL surface extraction correct |
| `detect-infra` | Sound mechanism; vocabulary gap (F7) made it silent here |
| `detectMonorepo` | Blind to nested-glob workspaces (F6) |
| `crawl` | Right architecture, wrong assumptions for SPA/button nav and query-routed `/assets` pages (F4, F5) — 1 surface on both UIs |
| `init` / CLI | Needs F1–F3 before it can be judged fairly |

---

## REMATCH — after commit `36b92cf` (same battery, re-run 2026-07-02 evening)

Every finding re-tested against the fixed framework, same targets, same method.

| # | Finding | Rematch result |
|---|---|---|
| F1 | `--help` executed commands | ✅ **Fixed** — `init --help`/`crawl --help` print per-command usage, zero side effects (verified in an empty dir); crawl's usage line now *discloses* the wipe |
| F2 | crawl wiped DB before deps resolved | ✅ **Fixed** — bare-dir crawl fails immediately, **no wipe line**, imports resolve first |
| F3 | peer-dep crash was a raw stack trace | ✅ **Fixed** — friendly failure naming the exact remedies (consumer install / packed tarball / `file:`-symlink gotcha), citing the KB card |
| F4 | `staticRoutes` + `baseURL` path ignored as seeds | ✅ **Fixed** — `1 seed(s)` honored; off-root consoles reached |
| F5 | `/assets` hard-excluded; query routing collapsed | ✅ **Fixed** — `crawl.exclude` configurable + `crawl.queryRoutes: true`: the registry went **1 → 3 surfaces**, including `device.html?deviceId=:v&roomId=:v&siteId=:v` discovered by following real links, all device instances collapsed to one parameterized surface with title/headings/0 console errors/screenshot |
| F6 | nested workspace globs undetected | ✅ **Fixed** — planner: `isMonorepo: true`, 4 sub-apps enumerated and typed (`apps/api` Express·api, `apps/ehr-adapter` Express·api, `apps/web` Vite, `packages/contract`) — note the API grew a `listDir` param callers must supply for glob expansion |
| F7 | no MQTT signature | ✅ **Fixed** — registry: `mqtt via [dependency mqtt]`; devtest: `mqtt via [env MQTT_PORT, compose image eclipse-mosquitto:2]`; planner correctly clean |

**7/7 verified fixed.** The crawl rematch is the headline: on the same registry
console that previously yielded one blind `/` surface, the fixed crawler
walked the real link graph and produced exactly the surface map a test author
needs. The Matrix vendored tarball was repacked from the fixed tree
(`vendor/touchstone-0.7.0.tgz`) and the OR campaign re-ran green on it
(🟢 SHIP) — no regressions from the fix batch.

*Rematch side-find (Matrix's own, not touchstone's):* the campaign's first
re-run failed because the docker containers predated the
`_matrix-devops → matrix-devqa` rename and still bind-mounted the dead
certs path — invisible while running, fatal on container re-create
(`docker compose start`). Fixed by `docker compose up -d` (recreate). Lesson:
after renaming a compose project directory, **recreate the fleet**, don't
trust long-running containers.

---

## ELECTRON MODE — pointing touchstone at the real Matrix Shell (2026-07-02 night)

Wired touchstone's experimental `electronTest` at the shell (built dist
renderer, shell `.env` → launch env, `@shellui` browser category). It launched
the real window and immediately found **two real product bugs** — neither
visible in the dev shell, both fatal to a packaged build:

- **P1 · blank renderer under `file://`** — Vite defaulted `base: '/'`, so the
  built `dist/index.html` referenced `/assets/main-*.js` (absolute). A packaged
  Electron shell loads the renderer over `file://`, where `/assets/...`
  resolves to the filesystem root — the bundle never loads and the window boots
  BLANK. Fixed: `base: './'` in `vite.config.ts`. (The dev shell hid this — it
  loads from the vite dev server over http, where absolute paths work.)
- **P2 · non-deterministic userData** — launched by script path
  (`electron electron/main.js`, how Playwright/packaging invoke it) the app
  name defaulted to `Electron`, so `userData` → `.../Application Support/
  Electron`, NOT `.../matrix-plus`. The shell then booted against an empty,
  unprovisioned profile (no room-auth, no plan cache). Fixed:
  `app.setName('matrix-plus')` at the top of `electron/main.js` — identity is
  now the same in dev (`electron .`), packaged, and test launches.

Both are exactly the class of bug that only surfaces when you run the REAL
window, not the dev server — which is the point of electron mode. After the
fixes: `@shellui` 3/3 (boots + mounts OR nav · main-process OR-03 identity ·
Case Execution renders the planner worklist), 🟢 SHIP. Touchstone's electron
support (window + main-process access + evidence) worked as documented; the
only friction was needing `electron` installed in the QA host (peer, like
`@playwright/test`) — same lesson as F3.

---

## AI HALF — qa-bughunter + qa-author on the planner UI (2026-07-03)

Ran the two AI-authoring skills for real (agent-executed) against the running
planner web app — the test I'd deferred. Full loop, one sitting:

1. **qa-bughunter** drove the planner adversarially (surface walk → hostile
   inputs → a11y/responsive). Results, honestly judged:
   - **1 real bug** — 5 layout `<select>` controls with no accessible name
     (`LayoutList.tsx:44`, `WindowInspector.tsx`) → filed
     `.qa/findings/2026-07-03-planner-layout-select-a11y.md`.
   - **1 false positive, investigated + killed** — `412` on rapid Add-Source
     looked like an error but is correct optimistic concurrency; the client
     reconciles and empirically loses no data. Downgraded, not filed.
   - **1 low note** — 87px mobile overflow on a desktop-only tool. Noted.
2. **qa-author** codified both into `suites/planner-ui.spec.mjs`: `@a11y`
   (accessible names — FAILED, catching the bug) + `@ux` (rapid-add persists —
   PASSED, guarding the good behavior).
3. **Fix + green** — added `aria-label`s (app fix, since it's our planner),
   rebuilt planner-web; `@a11y` flipped 🟢. The regression guard now holds.

**Verdict on the AI half:** it works — *with the right mental model.* The "AI"
is the AGENT executing the skill; touchstone supplies the disciplined method
(the adversarial-exploration checklist), the safe boot (`serve` + `.env.test`),
the evidence/findings plumbing, the categories, and the codify-to-regression
convention. That structure is exactly what turns "an agent poked around and
chatted some observations" into "a filed finding + a runnable regression test +
a fix verified green." It is not autonomous bug-finding; it is an agent made
rigorous and reproducible. On that framing, it cleared the bar the
deterministic half already set.
