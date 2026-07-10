// Contract self-test for the example evidence gatherer. KEEP THIS GREEN — run:
//   node --test .qa/app-qa/evidence-gatherers/
// Self-contained on purpose: gatherers are the lightest seam (no conformance gate — they just run), so this
// validates the shape and exercises gather() against a fake ctx. No framework import, so it runs anywhere.
import { test } from 'node:test';
import assert from 'node:assert';
import gatherer from './example.mjs';

const MODES = new Set(['off', 'on-failure', 'always']);

test('example: has a valid gatherer shape', () => {
  assert.equal(typeof gatherer, 'object', 'default export must be a gatherer object (or an array of them)');
  assert.ok(gatherer && typeof gatherer.name === 'string' && gatherer.name, '`name` must be a non-empty string');
  assert.ok(MODES.has(gatherer.when ?? 'on-failure'), `\`when\` must be one of ${[...MODES].join(' | ')}`);
  assert.equal(typeof gatherer.gather, 'function', '`gather` must be a function');
});

test('example: ships INERT (when: off) — captures nothing until you turn it on', () => {
  assert.equal(gatherer.when, 'off', 'the scaffolded example must stay off until you implement + activate it');
});

test('example: gather() writes evidence via ctx.write (edit to match YOUR diagnostics)', async () => {
  const written = [];
  const ctx = {
    write: (relPath, data) => { written.push({ relPath, data }); },
    baseURL: 'http://localhost:3000',
    testInfo: { title: 'demo test' },
    failed: true,
  };
  await gatherer.gather(ctx);
  assert.ok(written.length >= 1, 'gather() should write at least one evidence file into the bundle');
  assert.ok(written.every((w) => typeof w.relPath === 'string' && w.relPath), 'every write needs a filename');
});
