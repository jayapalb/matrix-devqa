# Run the OR Planner — quickstart

One command brings up **everything the Planner needs and nothing it doesn't**
(12 of the 18 dev-environment services). This is the saved setup for demoing
or working on the Planner without the full shell/campaign rig.

```
cd matrix-devqa
make up-planner
```

Then open the URL the command prints — with the checked-in example ports:

| What | URL |
|---|---|
| **Planner UI** | http://localhost:15500 |
| Planner API | http://localhost:14500 |
| EHR adapter (dummy worklist) | http://localhost:14600/v1/worklist |
| Device registry — fleet | http://localhost:4430 |
| Device registry — OR-03 console | http://localhost:4430/assets/room.html?siteId=SITE-001&roomId=OR-03 |
| App store / admin | http://localhost:4410 · /admin.html |
| Surgeons portal (Arthrex) | http://localhost:14402 |

Then prove it, don't trust it:

```
make smoke-planner
```

asserts all 7 HTTP surfaces, the three adaptors online in the registry, the
planner's live-inventory chain, and that OR-03 carries the demo rig exactly
as specced (2× MNA-420 quad decoders · PC 4K+HD · 4 sources 2×4K+2×HD ·
streamer). Non-zero exit = the saved setup no longer holds.

Optionally, make the SHELL a discovered fleet member too:

```
make register-shell-apps
```

drives the real matrix-shell `registry-app-host` module (no Electron) against
the live registry: the shell enrolls and registers as kind `shell` carrying
its actual micro-app manifests — they appear in the Planner's Apps tab fleet
panel under host `shell.or-03` as "UI — via the shell", with no command
endpoint and no display claims. 11 assertions; `TRUTH HOLDS` on success.

Stop everything with `make down`. Full stack (shell/campaign devices too) is
`make up`; the story gates are `make surgery` and `make chaos` (need `make up`).

## First run on a fresh machine

1. **Docker Desktop** running (`open -a Docker` on macOS if it isn't).
2. **Sibling repos** cloned next to this one (compose builds from `../…`):
   `matrix-devqa` · `matrix-planner` · `matrix-device-agents` ·
   `matrix-device-registry` · `matrix-app-store` · `arthrex-surgeon` ·
   `matrix-audit-service` · `matrix-tools` (cert generator).
3. `cp .env.example .env` — the checked-in ports (Planner UI on **15500**,
   API 14500, EHR 14600) avoid collisions with local dev servers; edit if
   anything clashes.
4. `make up-planner` — the first run also generates the room certs
   (`make certs` is a dependency) and builds all images (a few minutes).

## What `up-planner` includes (and why)

| Service | Role for the Planner |
|---|---|
| `planner-api`, `planner-web` | the Planner itself (API seeds a demo facility on first boot) |
| `ehr-adapter` | scheduled cases with **dummy data** — PHI stripped at this edge, day-anchored to the site timezone |
| `device-registry` + `mqtt-broker` | live device truth: presence (MQTT LWT), certification, busy/free, drift |
| `audit-service` | publish provenance / audit trail target |
| `app-store` | app listings tier (+ the Integrations tile) |
| `arthrex-surgeon` | surgeon identity/preferences portal (Integrations tile) |
| `barco-agent` + `nexxis-sim` | the **BARCO adaptor**: 2× MNA-420 quad decoders (4 slots each), 4 clinical sources (Endoscope 4K, C-arm 4K, Room Camera HD, PACS HD), 1 speaker + 2 audio sources — fronting the simulated Nexxis NMS |
| `display-agent` | the **PC adaptor**: system displays (4K + HD) that host apps directly |
| `streaming-agent` | the **streaming adaptor**: outbound stream sessions, busy-while-live |

Not included (shell-story hardware, not Planner requirements): lights,
recorder, pump, shaver, audio, cart agents — `make up` adds them.

## Troubleshooting

- **`localhost:5500` refuses / shows nothing** — your `.env` remaps the UI to
  **15500**; always use the URL `make up-planner` prints.
- **`Cannot connect to the Docker daemon`** — Docker Desktop isn't running.
- **Rebuilding `planner-api` reseeds the demo DB** — runtime edits (assigned
  cases, published snapshots since the seed) reset; the seeded facility, rooms,
  rig, and Dr. Patel's published case return. That's by design for demos.
- **Room looks stale after a reseed** — fixed (boot-scoped ETags); if you ever
  see it again, hard-reload once.
