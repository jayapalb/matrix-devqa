#!/usr/bin/env node
// nexxis-sim — a vendor-NMS simulator for the dev OR (dev-tooling, NOT a
// product component).
//
// Implements the matrix-routing-api surface the barco-agent drives, plus the
// Nexxis-style /events WebSocket. With this below it, the barco-agent runs
// GENUINELY healthy (real upstream, real events) — planner/shell/registry see
// a normal room; "simulated" exists only in this compose file.
//
//   barco-agent ──HTTP──▶ nexxis-sim (this)   ──/events ws──▶ barco-agent
//                                    ▲
//   dev engineer / run-surgery ── /sim/* ── fault injection:
//     POST /sim/routes   {videoSinkId, slotId, videoSourceId}   "vendor tech
//       changed a route at the physical panel" → broadcasts the same event a
//       real NMS would; the agent folds it; the shell's reconciler sees it.
//     POST /sim/sources/availability {videoSourceId, availability}
//     GET  /sim/state
//
// Zero dependencies: hand-rolled WebSocket server (server→client frames only).

import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 4599) || 4599;

// ---- vendor-side state ------------------------------------------------------
const routes = new Map(); // `${videoSinkId}::${slotId}` → {videoSinkId, slotId, videoSourceId, via, at}
const layouts = new Map(); // videoSinkId → {templateId, at}
const audioRoutes = new Map(); // audioSinkId → {audioSourceId, volume, at}
const shares = new Map(); // sourceId → Set(roomId)
const availability = new Map(); // videoSourceId → 'available' | 'unavailable'
const log = (m) => console.log(`[nexxis-sim] ${m}`);

// ---- WebSocket server (text frames out; tolerate pings/close in) ------------
const clients = new Set(); // {socket, filters:Set|null}

const wsFrame = (text) => {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
};

const broadcast = (event) => {
  const message = JSON.stringify(event);
  for (const client of clients) {
    if (client.filters && client.filters.size && !client.filters.has(event.eventType)) continue;
    try { client.socket.write(wsFrame(message)); } catch { clients.delete(client); }
  }
  log(`event ${event.eventType} → ${clients.size} subscriber(s)`);
};

const acceptUpgrade = (request, socket) => {
  const key = request.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const url = new URL(request.url, 'http://sim.local');
  const filters = new Set(url.searchParams.getAll('eventType'));
  const client = { socket, filters: filters.size ? filters : null };
  clients.add(client);
  log(`events subscriber connected (${filters.size ? [...filters].length + ' filters' : 'all events'})`);
  socket.on('data', (chunk) => {
    // Minimal client-frame handling: pong pings, honor close. Client data
    // frames are ignored (the bridge never sends application messages).
    const opcode = chunk[0] & 0x0f;
    if (opcode === 0x9) { try { socket.write(Buffer.from([0x8a, 0x00])); } catch { /* gone */ } }
    if (opcode === 0x8) { clients.delete(client); try { socket.end(); } catch { /* gone */ } }
  });
  socket.on('close', () => clients.delete(client));
  socket.on('error', () => clients.delete(client));
};

// ---- HTTP API ----------------------------------------------------------------
const readBody = (request) => new Promise((resolve) => {
  let data = '';
  request.setEncoding('utf8');
  request.on('data', (c) => { data += c; if (data.length > 1e6) request.destroy(); });
  request.on('end', () => { try { resolve(data.trim() ? JSON.parse(data) : {}); } catch { resolve({}); } });
});
const sendJson = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const applyRoute = (p, via) => {
  const key = `${p.videoSinkId}::${p.routingSlotId ?? p.slotId}`;
  routes.set(key, { videoSinkId: p.videoSinkId, slotId: p.routingSlotId ?? p.slotId, videoSourceId: p.videoSourceId, via, at: new Date().toISOString() });
  broadcast({ eventType: 'VideoSourceLinkedToSinkLayoutSlot', videoSinkId: p.videoSinkId, videoSourceId: p.videoSourceId, slotId: p.routingSlotId ?? p.slotId });
};
const releaseRoute = (p) => {
  routes.delete(`${p.videoSinkId}::${p.routingSlotId ?? p.slotId}`);
  broadcast({ eventType: 'VideoSourceUnlinkedFromSinkLayoutSlots', videoSinkId: p.videoSinkId, slotId: p.routingSlotId ?? p.slotId });
};

const server = http.createServer(async (request, response) => {
  const path = new URL(request.url, 'http://sim.local').pathname;
  const body = request.method === 'POST' ? await readBody(request) : {};
  try {
    if (request.method === 'GET' && path === '/health') return sendJson(response, 200, { ok: true, service: 'nexxis-sim', routes: routes.size, subscribers: clients.size });
    if (request.method === 'GET' && path === '/api/topology') return sendJson(response, 200, { ok: true, routes: [...routes.values()], layouts: [...layouts.values()] });
    if (request.method === 'GET' && path === '/sim/state') {
      return sendJson(response, 200, {
        ok: true,
        routes: [...routes.values()],
        layouts: [...layouts.values()],
        audioRoutes: [...audioRoutes.entries()].map(([sink, r]) => ({ audioSinkId: sink, ...r })),
        shares: [...shares.entries()].map(([sourceId, rooms]) => ({ sourceId, rooms: [...rooms] })),
        availability: Object.fromEntries(availability),
      });
    }
    if (request.method !== 'POST') return sendJson(response, 404, { ok: false, error: 'not found' });

    switch (path) {
      // ---- the routing-api surface the barco-agent calls ----
      case '/api/routes/apply': applyRoute(body, 'controller'); return sendJson(response, 200, { ok: true });
      case '/api/routes/release': releaseRoute(body); return sendJson(response, 200, { ok: true });
      case '/api/layouts/apply':
        layouts.set(body.videoSinkId, { videoSinkId: body.videoSinkId, templateId: body.templateId, at: new Date().toISOString() });
        broadcast({ eventType: 'VideoLayoutChanged', videoSinkId: body.videoSinkId });
        return sendJson(response, 200, { ok: true });
      case '/api/presets/apply':
        broadcast({ eventType: 'PresetApplied', videoSinkId: body.videoSinkId });
        return sendJson(response, 200, { ok: true });
      case '/api/overlays/apply':
      case '/api/overlays/clear':
      case '/api/overlays/parameters':
      case '/api/video-sinks/3d-mode':
      case '/api/video-sources/3d-mode':
      case '/api/video-sinks/workspot-mode':
      case '/api/video-sinks/slots/cropping/reset':
      case '/api/video-sinks/slots/scaling/reset':
      case '/api/routes/kmt':
        return sendJson(response, 200, { ok: true }); // accepted; no state modeled yet
      case '/api/audio/routes/apply':
        audioRoutes.set(body.audioSinkId, { audioSourceId: body.audioSourceId, volume: body.volume ?? null, at: new Date().toISOString() });
        return sendJson(response, 200, { ok: true });
      case '/api/audio/routes/release':
        audioRoutes.delete(body.audioSinkId);
        return sendJson(response, 200, { ok: true });
      case '/api/interor/share': {
        const set = shares.get(body.sourceId) ?? new Set();
        set.add(body.targetRoomId);
        shares.set(body.sourceId, set);
        return sendJson(response, 200, { ok: true });
      }
      case '/api/interor/unshare': {
        const set = shares.get(body.sourceId);
        if (set) { set.delete(body.targetRoomId); if (!set.size) shares.delete(body.sourceId); }
        return sendJson(response, 200, { ok: true });
      }
      case '/api/interor/unshare-all': shares.clear(); return sendJson(response, 200, { ok: true });

      // ---- fault injection (the dev engineer's hand on the vendor panel) ----
      case '/sim/routes': applyRoute({ ...body, routingSlotId: body.slotId }, 'manual-panel'); return sendJson(response, 200, { ok: true, injected: true });
      case '/sim/routes/release': releaseRoute({ ...body, routingSlotId: body.slotId }); return sendJson(response, 200, { ok: true, injected: true });
      case '/sim/sources/availability':
        availability.set(body.videoSourceId, body.availability === 'unavailable' ? 'unavailable' : 'available');
        broadcast({ eventType: body.availability === 'unavailable' ? 'VideoSourceDisconnected' : 'VideoSourceConnected', videoSourceId: body.videoSourceId });
        return sendJson(response, 200, { ok: true, injected: true });
      default: return sendJson(response, 404, { ok: false, error: `no such path ${path}` });
    }
  } catch (error) {
    return sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.on('upgrade', (request, socket) => {
  const path = new URL(request.url, 'http://sim.local').pathname;
  if (path === '/events') acceptUpgrade(request, socket);
  else socket.destroy();
});

server.listen(PORT, () => log(`vendor NMS simulator listening on :${PORT} (routing-api + /events ws + /sim fault injection)`));
