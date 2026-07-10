// Contract self-test for the example verdict sink — Touchstone refuses a non-conformant sink, so this
// must be green first:  node --test .qa/app-qa/sinks/
import { test } from 'node:test';
import assert from 'node:assert';
import sink from './example.mjs';
import { conformVerdictSink } from 'touchstone/verdict-sink';

test('example: passes the conformance gate', () => {
  const { ok, problems } = conformVerdictSink(sink);
  assert.ok(ok, 'not conformant:\n' + problems.map((p) => '  • ' + p).join('\n'));
});

test('example: publish() is a no-op when unconfigured (never throws on a normal verdict)', async () => {
  // With the webhook env unset, publish should quietly do nothing — best-effort, non-blocking.
  await sink.publish({ shipVerdict: '🟢 SHIP', testConfidence: 100, totals: { passed: 1, failed: 0 } }, { runId: 'test', runDir: '.' });
});
