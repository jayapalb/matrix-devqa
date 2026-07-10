// Contract self-test for the example mock. KEEP THIS GREEN — run: node --test .qa/app-qa/mocks/
// Self-contained: replicates the mock server's tiny URL matcher so it runs anywhere (no framework import).
import { test } from 'node:test';
import assert from 'node:assert';
import mock from './example.mjs';

const matches = (m, u) => (m instanceof RegExp ? m.test(u) : typeof m === 'string' && u.includes(m));

test('example mock: exports a non-empty routes[] — each with a matcher and a response', () => {
  assert.ok(Array.isArray(mock.routes) && mock.routes.length, 'routes must be a non-empty array');
  for (const r of mock.routes) {
    assert.ok(typeof r.match === 'string' || r.match instanceof RegExp, 'each route needs a string/RegExp match');
    assert.ok(r.json !== undefined || r.file !== undefined, 'each route needs a json or file response');
  }
});

test('example mock: routes match their intended URLs (edit to match YOUR service)', () => {
  assert.ok(mock.routes.some((r) => matches(r.match, '/example/ping')), 'a route should answer /example/ping');
  assert.ok(mock.routes.some((r) => matches(r.match, '/example/users/42')), 'a route should answer /example/users/:id');
});

test('example mock: envRedirects (if present) map an ENV var name → a path', () => {
  for (const [k, v] of Object.entries(mock.envRedirects || {})) {
    assert.match(k, /^[A-Z][A-Z0-9_]*$/, `envRedirects key ${k} should be an ENV var name`);
    assert.match(v, /^\//, `envRedirects[${k}] should be a path starting with /`);
  }
});
