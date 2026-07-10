// Contract self-test for the dev-environment launcher — Touchstone refuses a non-conformant launcher,
// so this must be green first:  node --test .qa/app-qa/launchers/
import { test } from 'node:test';
import assert from 'node:assert';
import adapter from './dev-environment.mjs';
import { conformLauncher } from 'touchstone/launcher';

test('dev-environment: passes the conformance gate', () => {
  const { ok, problems } = conformLauncher(adapter);
  assert.ok(ok, 'not conformant:\n' + problems.map((p) => '  • ' + p).join('\n'));
});

// NOTE: start() builds images and spawns real Docker containers, so it is NOT exercised here.
// Bring it up manually to smoke-test the stack:
//   docker compose -f ./dev-environment/docker-compose.yml up -d --build --wait
//   docker compose -f ./dev-environment/docker-compose.yml down -v
