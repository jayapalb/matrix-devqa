# Evidence analyzers (app-tier)

Drop `<name>.mjs` default-exporting `{ name, analyze(ctx) }`. After a run, analyzers mine the captured
evidence (console / network / metrics) + the verdict and **return findings the assertions missed** —
deterministic, no AI. They run alongside the built-ins (passed-but-dirty, slow-requests,
console-error-aggregate). Turn the stage on with `analyze: { mode: 'on-failure' | 'always' }` in qa.config
(or `touchstone qa --analyze`). See `touchstone/docs/EXTENDING.md`.
