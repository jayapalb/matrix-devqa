/**
 * mqtt DB lifecycle adapter — gives this app the lifecycle Mongo apps get for free:
 * preflight probe · clean-slate wipe · failure-evidence snapshot. Scaffolded by `touchstone db-adapter mqtt`.
 *
 * IMPLEMENT the TODOs, then PROVE it:  node --test .qa/app-qa/db/
 * Touchstone runs the same conformance gate at qa time and REFUSES a non-conformant adapter.
 */
const TEST_NAME = /(_|-)(test|qa|ci)\b/i;                                  // what an unmistakably-test name looks like
const PROD_SIGN = /\bprod(uction)?\b/i;                                   // what must never be touched
const LOCAL_HOST = /localhost|127\.0\.0\.1|\[?::1\]?|host\.docker\.internal/i;

const adapter = {
  name: 'mqtt',
  // The .env.test vars that configure this resource — adjust to your app's REAL names.
  envKeys: ['MQTT_URL', 'MQTT_BUCKET'],

  /** Is the resource configured at all? (false → Touchstone skips the lifecycle, like a no-DB app) */
  detect: (env = process.env) => Boolean(env['MQTT_URL']),

  /**
   * FAIL-SAFE safety: ok ONLY when every configured value is unmistakably a TEST target.
   * Empty/unknown → NOT ok. Tighten for your infra (e.g. also require your dedicated test-cluster
   * host) — but never loosen: the conformance gate rejects an adapter that accepts prod-looking values.
   */
  validateSafety(env = process.env) {
    const problems = [];
    const vals = this.envKeys.map((k) => [k, env[k] || '']);
    if (vals.every(([, v]) => !v)) return { ok: false, problems: ['no mqtt env configured — set ' + this.envKeys.join(', ') + ' in .env.test'] };
    for (const [k, v] of vals) {
      if (!v) continue;
      if (PROD_SIGN.test(v)) problems.push(`${k} looks like PROD: "${v}"`);
      else if (!TEST_NAME.test(v) && !LOCAL_HOST.test(v)) problems.push(`${k} is not unmistakably a test target (want a _test/_qa/_ci name or a local host): "${v}"`);
    }
    return { ok: problems.length === 0, problems };
  },

  /** Connectivity check (preflight) — fail fast with an actionable detail string. */
  async probe() {
    // TODO(db-adapter): connect + ping the TEST resource; return { ok: true, detail: 'reachable' }.
    throw new Error('TODO(db-adapter): implement probe() for mqtt');
  },

  /** Clean slate before/after the run. Only ever called AFTER validateSafety passed. */
  async wipe() {
    // TODO(db-adapter): flush the TEST bucket/keyspace/tables (e.g. bucket flush · DELETE FROM …).
    throw new Error('TODO(db-adapter): implement wipe() for mqtt');
  },

  /** OPTIONAL failure evidence: write relevant state as files into `dir` (cap sizes — evidence, not a backup). */
  async snapshot(dir) {
    // TODO(db-adapter): e.g. writeFileSync(`${dir}/mqtt-docs.json`, JSON.stringify(await dumpSample(), null, 2))
    //                   …or DELETE this method if snapshots don't make sense for mqtt.
    throw new Error('TODO(db-adapter): implement snapshot() for mqtt (or delete this method)');
  },

  /** OPTIONAL: release connections at teardown (delete if not needed). */
  async close() {},
};

export default adapter;
