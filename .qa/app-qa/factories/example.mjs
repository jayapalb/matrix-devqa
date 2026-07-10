/**
 * Example test-data factory — builds a valid domain object for suites: `import { makeExample } from
 * '../../factories/example.mjs'`. Plain module, no registration; inert until a suite imports it. Keep
 * factories realistic + overridable so tests read clearly and the data stays valid. Prove it:
 *   node --test .qa/app-qa/factories/
 */
let seq = 0;
export function makeExample(overrides = {}) {
  seq += 1;
  return { id: seq, name: `Example ${seq}`, email: `example${seq}@test.local`, active: true, ...overrides };
}
