// Contract self-test for the example factory. KEEP THIS GREEN — run: node --test .qa/app-qa/factories/
import { test } from 'node:test';
import assert from 'node:assert';
import { makeExample } from './example.mjs';

test('makeExample: returns a valid object with sensible defaults', () => {
  const u = makeExample();
  assert.equal(typeof u.id, 'number');
  assert.match(u.email, /@/);
  assert.equal(u.active, true);
});

test('makeExample: overrides win, and each build is independently identifiable', () => {
  const a = makeExample();
  const b = makeExample({ name: 'Custom', active: false });
  assert.notEqual(a.id, b.id, 'ids must be unique per call');
  assert.equal(b.name, 'Custom');
  assert.equal(b.active, false);
});
