/**
 * Example finding tracker — files findings into your issue system. INERT until selected: qa.config
 * `tracker: { type: 'example' }`. This OFFLINE placeholder writes each finding to
 * `.qa/app-qa/.findings/<fp>.json` (no network, no secrets) so you see the shape — swap it for your REAL
 * system (Jira / GitLab / a webhook); see `examples/trackers/`. Prove it: node --test .qa/app-qa/trackers/
 * Exports `async file(finding)` → a ref/URL, and optional `async exists(finding)` → ref | false (dedup).
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Lazy so a test can point QA_DIR at a temp dir, and so importing the module has NO side effects.
const dir = () => resolve(process.env.QA_DIR || '.qa', 'app-qa', '.findings');
const pathFor = (fp) => resolve(dir(), `${String(fp).replace(/[^a-z0-9._-]/gi, '_')}.json`);

/** Dedup: has this fingerprint already been filed? → its ref, else false. */
export async function exists(finding) {
  const p = pathFor(finding.fingerprint);
  return existsSync(p) ? `file://${p}` : false;
}

/** File the finding; return a ref (a URL in a real tracker). */
export async function file(finding) {
  mkdirSync(dir(), { recursive: true });
  const p = pathFor(finding.fingerprint);
  writeFileSync(p, JSON.stringify(finding, null, 2));
  return `file://${p}`;
}
