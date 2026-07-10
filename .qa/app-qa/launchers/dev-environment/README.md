# Matrix+ dev environment (Docker)

A full local development stack for Matrix+, brought up by the **`dev-environment`** Touchstone
launcher (`../dev-environment.mjs`). Everything runs in Docker; the Electron OR shell is viewable in
your browser over noVNC.

## What comes up

| Service | Host URL | Notes |
|---|---|---|
| **matrix-shell** (Electron) | http://localhost:6080/vnc.html | headless via Xvfb → x11vnc → noVNC |
| matrix-planner — API | http://localhost:4500/health | rooms, plans, **surgeon preference cards** |
| matrix-planner — EHR adapter | http://localhost:4600/v1/worklist | **"EHR for cases"** worklist |
| matrix-planner — web UI | http://localhost:5500/ | authoring UI (Vite) |
| matrix-device-registry | http://localhost:4430/ | fleet / device registry |
| matrix-app-store | http://localhost:4410/ | serves the shell's micro-apps |
| matrix-audit-service | http://localhost:4460/ | audit / case-event trail |
| barco-agent | http://localhost:4550/health | Barco/Nexxis routing agent |
| streaming-agent | http://localhost:4585/health | streaming device (mock) |
| system-agent | http://localhost:5050/health | **system with displays** (mock of linux-agent) |
| mosquitto | mqtt://localhost:1883 | MQTT broker (presence/events) |
| registrar-* | — | sidecars registering each agent into the fleet |

## Run it standalone (no QA / no Touchstone)

The launcher file doubles as a CLI — run it directly. Note it lives one level up (in `launchers/`),
next to its `dev-environment/` payload folder:

```bash
cd .qa/app-qa/launchers
node dev-environment.mjs up          # build + start, wait until healthy, print URLs (containers stay up)
node dev-environment.mjs ps          # container status
node dev-environment.mjs logs shell  # follow one service's logs
node dev-environment.mjs down        # stop + remove everything (incl. volumes)
node dev-environment.mjs restart     # down, then up
node dev-environment.mjs urls        # just print the endpoint table
```

This reuses the exact same `start()`/`stop()` the QA launcher uses, so the standalone boot is identical.

Or drive Compose directly if you prefer:

```bash
docker compose up -d --build --wait      # first run builds ~8 images; can take several minutes
docker compose down -v
```

Then open **http://localhost:6080/vnc.html** to interact with the OR shell.

## Run it through Touchstone

The launcher is `enabled: true` but **not selected by default** (so `npm run qa` doesn't boot the whole
stack unexpectedly). To use it, set it in `.qa/app-qa/qa.config.mjs`:

```js
app: { launcher: 'dev-environment', useRunningServer: true, healthPath: '/' },
```

Conformance self-test (no Docker needed):

```bash
node --test .qa/app-qa/launchers/
```

## Design notes / decisions

- **Non-invasive to the app repos.** Each image is declared inline in `docker-compose.yml`
  (`dockerfile_inline`) with the build context pointing at the sibling repo. The only files added to an
  app repo are a `.dockerignore` in `matrix-shell` (to keep macOS-built `node_modules` out of the build
  context). Helper scripts (`shell/entrypoint.sh`, `mosquitto/mosquitto.conf`, the system mock) live here.
- **System-with-displays is a mock.** The real `linux-agent` is a C binary needing X11 + wmctrl + xdotool;
  `system-agent-mock/agent.mjs` is a zero-dependency Node service that speaks the same `/spec`, `/sources`,
  `/apps`, `/command` surface the registrar forwards, so a display device shows up in the fleet.
- **Agents register via registrar sidecars** (`registrar-barco/-streaming/-system`), matching the real
  deployment pattern — no per-agent room-auth files required for dev.
- **`node_modules` is reinstalled inside every image.** The repos ship macOS-built modules; native deps
  (electron, esbuild/tsx, mqtt) must be Linux builds, so each Dockerfile runs `npm install`.
- **Electron runs `--no-sandbox`** under Xvfb (required for Chromium as root in a container).

## Ports summary

`1883` mqtt · `4410` app-store · `4430` registry · `4460` audit · `4500` planner-api ·
`4550` barco · `4585` streaming · `4600` ehr-adapter · `4786` support-token · `5050` system ·
`5500` planner-web · `6080` shell(noVNC)
