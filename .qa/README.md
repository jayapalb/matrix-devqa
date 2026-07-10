# QA — scaffolded by `touchstone init`

One command (`npm run qa`) runs every quality dimension and prints a single ship-confidence verdict.

## What init set up — and why
- **How QA reaches the app:** point at a running URL (—).
- **Auth:** `none`.
- **Database lifecycle:** off — non-Mongo; you manage the test DB.
- **Devices:** Desktop Chrome.
- **Evidence capture:** `on-failure` — zero cost on green; captured only when a test fails.
- **Analyze stage:** `on-failure` — mines the evidence for findings the assertions missed (deterministic, no AI); runs when a test fails.
- **Evidence gatherers:** built-ins only (console, app log, network, system, Mongo, OS-deep / Windows events).
- **Agents wired:** Claude Code, GitHub Copilot CLI — skills run on the model YOU set in that agent's CLI (Touchstone never picks it).
- **Files:** `playwright.config.mjs` · `app-qa/qa.config.mjs` · `app-qa/qa-resources.mjs` · `app-qa/.env.test` · `app-qa/suites/smoke.spec.mjs`.

## ⚠ Before `npm run qa` — placeholders to complete
1. **`.env.test`** — fill TEST values for: PLANNER_WEB_PORT, PLANNER_API_PORT, EHR_PORT, REGISTRY_PORT, AUDIT_PORT, APPSTORE_PORT, ARTHREX_PORT, BARCO_PORT, LIGHT_PORT, RECORDER_PORT, DISPLAY_PORT, PUMP_PORT, SHAVER_PORT, MQTT_PORT, CART_PORT, AUDIO_PORT, NEXXIS_SIM_PORT, STREAM_PORT. If the app uses SQL/Supabase, point **`DATABASE_URL` at a TEST database** — the safety guard refuses denylisted prod hosts + non-test-named DBs, so also list your prod host(s) in `safety.prod.uriHostDenylist`.
2. **Real tests** — the smoke suite is a placeholder; add suites under `app-qa/suites/`.

## Extension points — drop a file, it's auto-discovered
- `app-qa/evidence-gatherers/` — custom evidence on failure (logs / DB / files / shell / cloud)
- `app-qa/mocks/` — external-service doubles · `app-qa/factories/` — test-data builders
- `app-qa/trackers/` — where findings get filed · `app-qa/strategies/` — custom auth
- `app-qa/analyzers/` — mine evidence for findings the assertions missed (the analyze stage)
- `app-qa/knowledge/` — app-specific playbook cards

## Next
- **Complete the smart parts with your agent:** run `/qa-discover` (maps your DB / evidence / services from the code), then `/qa-author` (writes real suites), then `/visual-qa` (judge the UI — dark mode / responsive). The scaffold above is intentionally minimal — the agent fills it in.
- `npm i -D @playwright/test && npx playwright install`
- `npm run qa` → verdict · `npm run qa:summary` → report · `npm run qa:doctor` → readiness

Full docs: `node_modules/touchstone/docs/` (INTEGRATION · CONFIG · EVIDENCE · WINDOWS).
