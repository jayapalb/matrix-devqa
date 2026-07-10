/**
 * Example evidence analyzer — mines a finished run's evidence for findings the assertions missed, ALONGSIDE
 * the built-ins (passed-but-dirty · slow-requests · console-error-aggregate). Analyzers AUTO-RUN, so this
 * ships INERT: it only fires on a sentinel no real app emits — replace the predicate with a real heuristic
 * to activate. Turn the stage on with `analyze: { mode: 'on-failure' | 'always' }` in qa.config.
 * Prove it: node --test .qa/app-qa/analyzers/     Shape: { name, analyze(ctx) } → findings[].
 */
const MARKER = 'EXAMPLE_ANALYZER_HIT'; // demo trigger — swap for a real signal (bad body, slow endpoint, missing header)

export default {
  name: 'example',
  analyze(ctx) {
    const findings = [];
    for (const t of ctx.tests || []) {
      const lines = [...(t.console || []), ...(t.pageErrors || [])];
      if (!lines.some((l) => String(l).includes(MARKER))) continue;
      findings.push({
        title: `Example analyzer matched in ${t.test}`,
        severity: 'low',
        tags: ['analyze', 'example'],
        test: t.test,
        detail: `found "${MARKER}" — replace this demo predicate with a real heuristic`,
        fingerprint: `example-${t.test}`,
      });
    }
    return findings;
  },
};
