#!/usr/bin/env bash
# Boot the Electron OR shell headless on a virtual X display and expose it over noVNC.
#   Xvfb :99  ->  x11vnc :5900  ->  websockify/noVNC :6080  (open in a browser)
# Alongside it we run the two non-GUI pieces the shell's `npm run dev` normally starts:
#   the LiveKit support-token server and the Vite renderer.
set -euo pipefail

export DISPLAY=:99
SCREEN_GEOMETRY="${SCREEN_GEOMETRY:-1920x1080x24}"

echo "[shell] starting Xvfb on ${DISPLAY} (${SCREEN_GEOMETRY})"
Xvfb :99 -screen 0 "${SCREEN_GEOMETRY}" -nolisten tcp &
# Wait for the X socket before anything tries to draw.
for _ in $(seq 1 30); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.5; done

echo "[shell] starting x11vnc (5900) + noVNC/websockify (6080)"
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -bg -quiet -noxdamage
# Debian's novnc package ships the web client at /usr/share/novnc (vnc.html).
websockify --web=/usr/share/novnc 6080 localhost:5900 &

echo "[shell] starting support-token server (4786)"
node server/support-token-server.cjs &

echo "[shell] starting Vite renderer (5173)"
npx --no-install vite --host 0.0.0.0 --strictPort --port 5173 &

echo "[shell] waiting for the renderer to come up..."
until node -e "fetch('http://localhost:5173').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
  sleep 1
done

echo "[shell] launching Electron (headless, --no-sandbox) against the renderer"
export ELECTRON_START_URL="http://localhost:5173"
export MATRIX_SECURITY_PROFILE="${MATRIX_SECURITY_PROFILE:-demo}"
export MATRIX_DEV_LOCAL_APPS="${MATRIX_DEV_LOCAL_APPS:-true}"
exec npx --no-install electron . --no-sandbox --disable-gpu --disable-dev-shm-usage
