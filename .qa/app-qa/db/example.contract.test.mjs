// Contract self-test for the example DB adapter. KEEP THIS GREEN — Touchstone refuses a non-conformant
// adapter at qa time. Run:  node --test .qa/app-qa/db/
import { test, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { conformDbAdapter } from 'touchstone';
import adapter from './example.mjs';

test('conforms to the Touchstone DB-adapter contract (shape + FAIL-SAFE safety)', () => {
  const c = conformDbAdapter(adapter);
  assert.deepEqual(c.problems, []);
  assert.equal(c.ok, true);
});

test('refuses YOUR real prod shapes — add the exact hosts/names this must never touch', () => {
  // TODO(db-adapter): replace with your actual prod host + bucket/db names (defense in depth
  // alongside qa.config safety.denylist).
  for (const v of ['couchbase://db.prod.internal/app_prod', 'https://prod-cluster.example.com']) {
    const env = Object.fromEntries(adapter.envKeys.map((k) => [k, v]));
    assert.equal(adapter.validateSafety(env).ok, false, `must refuse ${v}`);
  }
});

const configured = adapter.detect(process.env) && adapter.validateSafety(process.env).ok;

test('LIVE: probe → wipe → probe round-trip against .env.test', { skip: !configured && 'no example test env configured (.env.test)' }, async () => {
  assert.equal((await adapter.probe()).ok, true, 'probe must reach the TEST resource');
  await adapter.wipe();
  assert.equal((await adapter.probe()).ok, true, 'still reachable after wipe');
});

test('LIVE: snapshot writes at least one evidence file', { skip: (!configured || typeof adapter.snapshot !== 'function') && 'no test env / no snapshot()' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'example-snap-'));
  try { await adapter.snapshot(dir); assert.ok(readdirSync(dir).length >= 1, 'snapshot() should write file(s) into the dir it is given'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

after(async () => { await adapter.close?.(); });
