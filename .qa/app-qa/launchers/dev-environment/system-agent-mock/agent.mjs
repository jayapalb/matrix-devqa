// system-agent-mock — a dependency-free stand-in for the C "system (with displays)" agent
// (matrix-device-agents/linux-agent), which needs X11 + wmctrl + xdotool and cannot run in a
// plain container. This mock speaks the same HTTP surface the registrar's /spec path forwards
// verbatim to matrix-device-registry, so a system device with display sources shows up in the
// fleet for development. Node 18+, zero npm deps.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 5050);
const DEVICE_ID = process.env.DEVICE_ID || 'system-or03-01';
const DEVICE_LABEL = process.env.DEVICE_LABEL || 'OR-03 System (dev mock)';

// Two fake wall displays + their capture sources, mirroring what linux-agent would expose.
const displays = [
  { id: `${DEVICE_ID}.HDMI-1`, label: 'Main Wall (HDMI-1)', w: 3840, h: 2160 },
  { id: `${DEVICE_ID}.DP-2`, label: 'Side Wall (DP-2)', w: 1920, h: 1080 },
];
const sources = [
  { id: 'HDMI-1', x: 0, y: 0, width: 3840, height: 2160 },
  { id: 'DP-2', x: 3840, y: 0, width: 1920, height: 1080 },
];
const apps = [
  { id: 'firefox', name: 'Firefox' },
  { id: 'vlc', name: 'VLC Media Player' },
];

// /spec is the modern capability doc the registrar forwards as-is (kind + capabilities).
const spec = () => ({
  kind: 'display-agent',
  deviceId: DEVICE_ID,
  label: DEVICE_LABEL,
  capabilities: { os: 'linux', displays, sources, apps },
});

const startedAt = Date.now();
const json = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
};

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'GET' && pathname === '/health') {
    return json(res, 200, { ok: true, app: 'system-agent-mock', os: 'linux', deviceId: DEVICE_ID, uptimeMs: Date.now() - startedAt });
  }
  if (req.method === 'GET' && pathname === '/spec') return json(res, 200, spec());
  if (req.method === 'GET' && pathname === '/sources') return json(res, 200, { sources });
  if (req.method === 'GET' && pathname === '/apps') return json(res, 200, { apps });
  if (req.method === 'POST' && pathname === '/command') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let cmd = null;
      try { cmd = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { ok: false, error: 'invalid json' }); }
      console.log(`[system-agent-mock] command`, cmd);
      json(res, 200, { ok: true, deviceId: DEVICE_ID, received: cmd });
    });
    return;
  }
  json(res, 404, { ok: false, error: 'not found', path: pathname });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[system-agent-mock] ${DEVICE_ID} listening on http://0.0.0.0:${PORT} (displays: ${displays.map((d) => d.id).join(', ')})`);
});
