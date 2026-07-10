// Contract self-test for the example signal adapter — Touchstone refuses a non-conformant adapter, so
// this must be green first:  node --test .qa/app-qa/signals/
import { test } from 'node:test';
import assert from 'node:assert';
import adapter from './example.mjs';
import { conformSignalAdapter, normalizeSignalResult } from 'touchstone/signal-adapter';

test('example: passes the conformance gate', () => {
  const { ok, problems } = conformSignalAdapter(adapter);
  assert.ok(ok, 'not conformant:\n' + problems.map((p) => '  • ' + p).join('\n'));
});

test('example: measure() returns a scorable shape (edit to match YOUR dimension)', async () => {
  const raw = await adapter.measure({ root: process.cwd(), baseURL: null, runDir: null });
  const decided = normalizeSignalResult(raw);
  // A well-formed result is a decision the framework can fold in — one of skip / pass / a breach:
  assert.ok(typeof decided.failing === 'boolean' && typeof decided.skipped === 'boolean',
    'measure() must yield { status | value+threshold | failing | skip } — got ' + JSON.stringify(raw));
});
