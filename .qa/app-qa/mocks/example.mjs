/**
 * Example external-service mock — a named server-side double. INERT until referenced: add it to qa.config
 * `mockServer.use: ['example']` to activate; unreferenced, it contributes nothing. Prove it:
 *   node --test .qa/app-qa/mocks/
 * A mock exports `routes` (match → canned response) + optional `envRedirects` (point the app's outbound
 * service base-URL env at the mock). See the shipped library: `touchstone/mocks/` and `examples/external/`.
 */
export default {
  // When `use`d, redirect the app's outbound base URL to the mock server — only if you haven't set it yourself.
  envRedirects: { EXAMPLE_API_URL: '/example' },
  routes: [
    { match: '/example/ping', json: { ok: true, mocked: true } },
    { match: /\/example\/users\/\d+$/, json: { id: 1, name: 'Example User' } },
  ],
};
