// Contract self-test for the example coverage adapter — Touchstone refuses a non-conformant adapter, so
// this must be green first:  node --test .qa/app-qa/coverage/
import { test } from 'node:test';
import assert from 'node:assert';
import adapter from './example.mjs';
import { conformCoverageAdapter, runCoverageAdapter } from 'touchstone/coverage-adapter';

test('example: passes the conformance gate', () => {
  const { ok, problems } = conformCoverageAdapter(adapter);
  assert.ok(ok, 'not conformant:\n' + problems.map((p) => '  • ' + p).join('\n'));
});

test('example: a SAMPLE report yields a coverage % (edit to match YOUR report)', async () => {
  // A tiny lcov with 8/10 lines covered. If you switched format/parse, replace with a sample of YOUR shape.
  const sampleLcov = 'TN:\nSF:src/app.js\nLF:10\nLH:8\nend_of_record\n';
  const res = await runCoverageAdapter(adapter, { root: process.cwd(), readFile: () => sampleLcov });
  // With no real .env.test/report present, ingest skips gracefully (non-blocking). With the sample injected
  // above it measures — assert the number your report should produce:
  if (!res.skipped) assert.equal(res.lines, 80, '8/10 lines → 80%');
});
