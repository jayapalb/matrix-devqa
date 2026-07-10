// Contract self-test for the example scanner adapter — Touchstone REFUSES a non-conformant scanner, so
// this must be green first:  node --test .qa/app-qa/scanners/
import { test } from 'node:test';
import assert from 'node:assert';
import adapter from './example.mjs';
import { conformScanner, runScanner, parseSarif } from 'touchstone/scanner';

test('example: passes the conformance gate', () => {
  const { ok, problems } = conformScanner(adapter);
  assert.ok(ok, 'not conformant:\n' + problems.map((p) => '  • ' + p).join('\n'));
});

test('example: a SAMPLE report normalizes to counts + findings (edit to match YOUR report)', async () => {
  // A tiny SARIF sample with one high finding. If you switched to a custom parse(), replace this with a
  // sample of YOUR report shape and assert the counts you expect.
  const sampleSarif = JSON.stringify({
    runs: [{ tool: { driver: { name: 'example' } }, results: [
      { ruleId: 'demo/rule', level: 'error', message: { text: 'example finding' },
        locations: [{ physicalLocation: { artifactLocation: { uri: 'src/app.js' }, region: { startLine: 10 } } }] },
    ] }],
  });
  const parsed = parseSarif(sampleSarif);
  assert.equal(parsed.counts.high, 1, 'the sample high finding is counted');

  // End-to-end via run/ingest, feeding the sample instead of touching the filesystem:
  const res = await runScanner(adapter, { root: process.cwd(), readFile: () => sampleSarif });
  assert.ok(!res.refused, res.reason);
  // A real .env.test + report makes res.skipped false; with none present it skips gracefully (non-blocking).
});
