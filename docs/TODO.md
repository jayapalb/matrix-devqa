# TODO — Turning THE-STORY.md Into Product

> Derived 2026-07-02 by auditing `THE-STORY.md` against the current tree.
> The currently audited present-tense beats are met and test-backed (shell,
> agent SDK, registry, planner suites green at last audit). The items below are
> the known gap set for moving from acceptance narrative to pilotable product.
> Closing a story-beat item flips its row from `[FUTURE]` to present tense.

## A. Product Safety Gates

1. **Named authenticated actors + RBAC** — ⏳ IN PROGRESS 2026-07-02:
   ✅ OIDC/JWKS verifier (`apps/api/src/jwks.ts`): RS256/ES256/EdDSA, pinned
   iss/aud, exp/nbf skew, kid rotation w/ bounded refetch, alg-confusion
   refused; claims → `clin:<sub>` matrix.session/1; async-capable identity
   middleware (sync for off/dev). ✅ Service tokens
   (`matrix.serviceToken/1`, mint+verify, HS256-pinned): case-events now
   authenticates a NAMED `svc:` principal; legacy shared token deprecated
   (warn) and ingest closed in production without a service secret.
   REMAINING: RBAC matrix extension (override/ack/lifecycle actors), Shell
   session + shell sends svc token, mint CLI, audit subject assertions.
   - Add OIDC/JWKS on Planner + Shell sessions.
   - Add service tokens for M2M flows; remove shared-token case-event ingest.
   - Define an action permission matrix: publish plan, select case, transition
     lifecycle, acknowledge critical, override display slot, approve card edit.
   - Make `publishedBy`, `approval.by`, override actor, and lifecycle actor
     verified `clin:U-...` subjects.
   - Proof: auth contract tests, RBAC denial tests, audit subject assertions.

2. **Alarm acknowledgment + escalation workflow** — ⏳ engine DONE 2026-07-02:
   `matrix-shell/electron/alarm-registry.js` (raise/ack/resolve, actor+reason,
   per-code policy: block-class criticals gate `caseMayProceed`, non-block
   escalate on a deadline sweep; dedupe by code+subject; recurrence re-opens
   an ack). Wired: all four critical emitters auto-raise, `shell:acknowledge-alarm`
   IPC (audited), alarms + caseMayProceed in shell state, device recovery
   resolves. 7 tests. REMAINING: renderer ack flow (banner + reason + escalation
   timer), lifecycle-UI honoring caseMayProceed.
   - Define who must acknowledge `DISPLAY_ACTUATION_FAILED`,
     `DISPLAY_DIVERGENCE`, `DEVICE_OFFLINE_MID_CASE`, and wrong-room/tamper alarms.
   - Define whether the case may proceed with each unresolved critical.
   - Add renderer flows for ack, reason, escalation timer, recovery state.
   - Feed the safety/risk register.
   - Proof: renderer tests + policy tests + audit trail assertions.

3. **Free-text PHI content scanning**
   - Add scanning at spine ingress: `ehr-adapter`, case-event ingest, operator
     notes/reasons, AI context inputs, and card-retune suggestions.
   - Keep structured identifier stripping via `assertSpineSafe`.
   - When this is proven, remove "designed so" from the PHI claim in
     `THE-STORY.md`.
   - Proof: PHI fixture corpus, false-positive review set, egress guard tests,
     risk-register cite.

4. **Central audit forwarding** — ✅ DONE 2026-07-02:
   `matrix-shell/electron/audit-forwarder.js` — local hash-chain streams →
   audit service as `matrix.audit/1`, durable per-stream cursor (survives
   restart; advances only on ack), retry-on-outage without cursor drift,
   periodic `chain.anchor` snapshotting local {stream,seq,hash} for
   cross-verification, 207 poison-pill advance. Correlation (caseId in
   target; snapshotId/requestId/jobId in meta) survives forwarding. Wired via
   MATRIX_AUDIT_URL. 4 e2e tests against the REAL audit service; central
   verify stays intact.
   - Forward shell hash-chain segments to the audit service through outbox.
   - Add periodic chain anchors and replay verification.
   - Ensure caseId → snapshotId → requestId → jobId correlation survives
     forwarding.
   - Proof: audit service tests, chain-verify tests, outage/retry tests.

## B. Reliability & Operations

5. **Durable outbox for cross-service delivery** — ✅ first leg DONE 2026-07-02:
   `apps/api/src/outbox.ts` (retry-until-2xx, idempotency key header,
   latest-wins per key, restart-safe) under the expected-inventory publish;
   story marker flipped. REMAINING: reuse for Planner audit forwarding +
   Shell case-events; stuck-delivery visibility.
   - Put `@matrix/outbox` under Planner → registry expected-inventory publish.
   - Reuse the shared outbox for Planner audit forwarding and Shell case-events.
   - Retry until acknowledged; expose stuck delivery state.
   - Proof: delivery retry tests, duplicate/idempotency tests, live smoke.

6. **Renderer pass for critical room state**
   - Render the signals main already emits: red route states, demo watermark,
     verification/cache status, device-lost alarms, and override state.
   - Make degraded state visible without requiring dev tools/logs.
   - Proof: Playwright screenshots and state-specific renderer tests.

7. **Packaging + CI** — ⏳ dev environment DONE 2026-07-02:
   `matrix-devqa/` — docker-compose brings up the whole platform (planner
   api+web, ehr, registry, audit, app-store, arthrex cloud app, barco mock
   adapter, and 5 SDK device agents: light/recorder/display[2×4K]/pump/shaver)
   on a shared network, room-auth via room-cert-gen, Makefile + smoke.sh.
   VERIFIED in real Docker: registry + light + pump built and the agents
   registered into the registry over container DNS. New mock agents: pump,
   shaver, windows-display. REMAINING: CI runner, signed releases/rollback,
   optional headless-shell container.
   - One-command cross-repo test runner.
   - Per-site stack packaging from SOW §5.1.
   - Signed releases, rollback, release notes, and smoke tests.
   - Proof: CI gate, release artifact verification, rollback drill.

8. **Electron-level offline e2e**
   - Sever Planner/control-plane/network mid-case.
   - Assert the story's 07:31 beat at app level: verified cache, case proceeds,
     operator-visible banner, no unsafe refetch dependency.
   - Module-level coverage exists; this must exercise the packaged shell path.
   - Proof: Electron e2e with network cut and restart cases.

9. **Key/cert runbooks**
   - Document and drill room-key rotation across Shell, agents, and registry.
   - Document planner trust-root re-pin with operator approval.
   - Include compromised key, expired key, and revoked device recovery.
   - Per-device revocation is built/tested; room-key and trust-root runbooks
     remain.
   - Proof: runbook, tabletop, and at least one scripted rotation drill.

10. **Clock discipline**
    - Make NTP/time sync a site ops requirement.
    - Document how audit hash-links provide per-stream ordering independent of
      wall clocks.
    - Surface clock skew warnings where possible.
    - Proof: ops doc + skew detection test where supported.

11. **Observability plumbing**
    - Add OTel traces stitching caseId → snapshotId → requestId → jobId.
    - Add room heartbeat dashboard, event lag, outbox depth, device presence,
      and critical alarm metrics.
    - Add alert routing for room-critical vs platform-critical failures.
    - Proof: dashboard screenshots, trace fixtures, alert test.

12. **Backup, restore, retention**
    - Define retention for plans, case events, audit chains, device telemetry,
      AI suggestions, and operator notes.
    - Add backup/restore procedure for Planner, registry, and audit service.
    - Add purge/export policy for pilot sites.
    - Proof: restore drill and retention config tests.

13. **Secrets and environment management**
    - Define site config layout, secret storage, rotation, and least-privilege
      service credentials.
    - Remove any remaining development defaults from production profile.
    - Proof: config validation, secret presence checks, production profile scan.

14. **Versioned event/schema compatibility**
    - Publish compatibility policy for `matrix.*` envelopes and device events.
    - Add contract tests for old/new producers and consumers.
    - Define deprecation and migration process.
    - Proof: schema compatibility suite and fixture replay.

## C. Story Beat Flips

15. **AI skills behind the gate** (`THE-STORY.md` `[FUTURE]`, SOW §5)
    - Build `matrix.skill/1` + `matrix.aiIntent/1` validation in the Shell.
    - Add scope-filtered `ai-context-provider`.
    - Add min-of-three approval gate: skill ceiling, planner ceiling, case
      policy.
    - Add Claude provider + deterministic fallback.
    - Skills: readiness summarizer, drift explainer, suggest-only display hints,
      case debrief, card re-tune suggester.
    - Proof: eval harness per skill, policy-denial tests, audit tests.

16. **Named human actors on every action**
    - This becomes present tense only after item 1 is complete.
    - Proof: every story action has a verified actor or a declared service
      principal.

## D. Proof & Papers

17. **Regulatory position paper + ISO-14971 risk register**
    - State intended use and explicit clinical safety boundary.
    - Index existing mitigations from `THE-STORY.md`.
    - Track residual risks: wrong case, wrong display route, stale plan, device
      offline, PHI leakage, AI overreach, operator override misuse.
    - Proof: reviewed position paper and risk register.

18. **Security review + threat model**
    - Threat model Planner, Shell, registry, agents, audit service, and adapter
      boundary.
    - Cover forged commands, stolen room key, compromised device, replayed plan,
      malicious app package, PHI in free text, and network partition.
    - Proof: threat model doc, mitigations mapped to tests/issues.

19. **Support/runbook model**
    - Define who responds when a room is red.
    - Add incident severities, escalation contacts, operator scripts, and
      support handoff from hospital staff to Matrix support.
    - Proof: runbook and tabletop exercise.

20. **Pilot acceptance checklist**
    - One room, one real case list, one week, no engineer present.
    - Include setup, daily readiness, mid-case failure drills, audit review,
      downtime procedure, and end-of-week signoff.
    - Proof: signed pilot checklist and issue log.
