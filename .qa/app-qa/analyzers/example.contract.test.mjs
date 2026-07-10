// Contract self-test for the example analyzer. KEEP THIS GREEN — run: node --test .qa/app-qa/analyzers/
import { test } from 'node:test';
import assert from 'node:assert';
import analyzer from './example.mjs';

test('example analyzer: has the { name, analyze } shape', () => {
  assert.equal(typeof analyzer.name, 'string');
  assert.equal(typeof analyzer.analyze, 'function');
});

test('example analyzer: returns a well-shaped finding when its trigger is present', () => {
  const ctx = { tests: [{ test: 'demo', console: ['[error] EXAMPLE_ANALYZER_HIT here'], pageErrors: [] }] };
  const out = analyzer.analyze(ctx);
  assert.equal(out.length, 1, 'the demo trigger should produce one finding');
  assert.ok(out[0].fingerprint && out[0].title, 'findings need a fingerprint + title');
});

test('example analyzer: INERT on real evidence — no sentinel, no findings', () => {
  const ctx = { tests: [{ test: 'demo', console: ['[error] a normal app error'], pageErrors: [] }] };
  assert.deepEqual(analyzer.analyze(ctx), [], 'ships inert: contributes nothing until you implement it');
});
