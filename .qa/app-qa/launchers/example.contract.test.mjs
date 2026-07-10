// Contract self-test for the example launcher — Touchstone refuses a non-conformant launcher, so this
// must be green first:  node --test .qa/app-qa/launchers/
import { test } from 'node:test';
import assert from 'node:assert';
import adapter from './example.mjs';
import { conformLauncher } from 'touchstone/launcher';

test('example: passes the conformance gate', () => {
  const { ok, problems } = conformLauncher(adapter);
  assert.ok(ok, 'not conformant:\n' + problems.map((p) => '  • ' + p).join('\n'));
});

// NOTE: start() spawns real processes (docker/tunnel/…), so it is NOT exercised here. Test it against your
// real infra in CI, or add an integration test that calls start()/stop() when the infra is available.
