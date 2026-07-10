// Contract self-test for the example auth strategy. KEEP THIS GREEN — run: node --test .qa/app-qa/strategies/
import { test } from 'node:test';
import assert from 'node:assert';
import { apiHeaders, browserAuth } from './example.mjs';

test('apiHeaders(role): returns auth headers scoped to the role', async () => {
  const h = await apiHeaders('admin');
  assert.equal(typeof h, 'object');
  const auth = h.authorization || h.Authorization;
  assert.ok(auth && /admin/.test(auth), 'headers should authenticate as the requested role');
});

test('browserAuth(context, role): seeds the browser context (no real network)', async () => {
  const added = [];
  const fakeContext = { addCookies: async (c) => { added.push(...c); } };
  await browserAuth(fakeContext, 'user');
  assert.ok(added.length >= 1, 'should seed at least one cookie/state entry');
  assert.ok(added.every((c) => c.name && (c.url || c.domain)), 'each cookie needs a name + url/domain');
});
