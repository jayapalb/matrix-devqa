// Contract self-test for the example tracker. KEEP THIS GREEN — run: node --test .qa/app-qa/trackers/
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('example tracker: file() then exists() round-trips a finding (dedup)', async () => {
  const prev = process.env.QA_DIR;
  const tmp = mkdtempSync(join(tmpdir(), 'tracker-'));
  process.env.QA_DIR = tmp;
  try {
    const { file, exists } = await import('./example.mjs');
    const finding = { fingerprint: 'demo-1', title: 'Example finding', severity: 'low' };
    assert.equal(await exists(finding), false, 'not filed yet');
    const ref = await file(finding);
    assert.ok(ref && typeof ref === 'string', 'file() must return a ref');
    assert.ok(await exists(finding), 'exists() must find it after filing (dedup)');
  } finally {
    if (prev === undefined) delete process.env.QA_DIR; else process.env.QA_DIR = prev;
    rmSync(tmp, { recursive: true, force: true });
  }
});
