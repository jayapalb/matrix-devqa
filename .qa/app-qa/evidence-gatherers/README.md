# Evidence gatherers (app-tier)

Drop `<name>.mjs` here, default-exporting `{ name, when, async gather(ctx) }` (or an array of them).
They run **alongside** Touchstone's built-in gatherers (app log, screenshot, console, network, DB snapshot,
system metrics) on failure — you don't copy the built-ins, you **add** to them. `ctx` gives you
`write(filename, data)`, `connectDb()`, `baseURL`, `testInfo`.

Example — snapshot Postgres rows on failure:
```js
export default {
  name: 'pg-snapshot', when: 'on-failure',
  async gather(ctx) { /* query your TEST db, ctx.write('users.json', rows) */ },
};
```
An inert `example.mjs` (+ its contract self-test) ships here — flip `when: 'off'` → `'on-failure'` to activate.
See `touchstone/docs/EXTENDING.md`.
