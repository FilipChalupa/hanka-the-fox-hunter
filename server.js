'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game } = require('./game/sim.js');
const { Leaderboard } = require('./game/leaderboard.js');
const { encodeDelta, PROTOCOL } = require('./public/shared.js');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TICK_RATE = 60;
const SNAPSHOT_RATE = 20;
const KEYFRAME_EVERY = 5; // seconds between full snapshots (deltas in between)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

// ---------------------------------------------------------------------------
// Game + leaderboard
// ---------------------------------------------------------------------------
const leaderboard = new Leaderboard(path.join(DATA_DIR, 'leaderboard.json'));
const startedAt = Date.now();
// Rolling metrics for /metrics
const metrics = { tickMs: [], fullBytes: [], deltaBytes: [], snapshots: 0, roundsFinished: 0, roundsWon: 0 };
const pushMetric = (arr, v, cap = 600) => {
  arr.push(v);
  if (arr.length > cap) arr.shift();
};
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const maxOf = (arr) => (arr.length ? Math.max(...arr) : 0);
const game = new Game({
  onGameOver: (summary) => {
    metrics.roundsFinished++;
    if (summary.won) metrics.roundsWon++;
    leaderboard.recordRound(summary);
  },
});

// ---------------------------------------------------------------------------
// HTTP: static files + tiny JSON API
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  if (urlPath === '/api/leaderboard') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(leaderboard.top(5)));
  }
  if (urlPath === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ online: game.connectedCount(), wave: game.wave, round: game.round.number, foxes: game.foxes.size, boss: game.bossPhase, uptime: Math.round((Date.now() - startedAt) / 1000), protocol: PROTOCOL }));
  }
  if (urlPath === '/metrics') {
    const lines = [
      '# HELP foxhunter_players_online Connected hunters', '# TYPE foxhunter_players_online gauge', `foxhunter_players_online ${game.connectedCount()}`,
      '# HELP foxhunter_players_total Hunters including disconnected bodies', '# TYPE foxhunter_players_total gauge', `foxhunter_players_total ${game.players.size}`,
      '# HELP foxhunter_foxes Foxes alive', '# TYPE foxhunter_foxes gauge', `foxhunter_foxes ${game.foxes.size}`,
      '# HELP foxhunter_wave Current wave', '# TYPE foxhunter_wave gauge', `foxhunter_wave ${game.wave}`,
      '# HELP foxhunter_round Current round number', '# TYPE foxhunter_round gauge', `foxhunter_round ${game.round.number}`,
      '# HELP foxhunter_tick_ms Simulation tick duration in ms (rolling)', '# TYPE foxhunter_tick_ms gauge', `foxhunter_tick_ms{stat="avg"} ${avg(metrics.tickMs).toFixed(3)}`, `foxhunter_tick_ms{stat="max"} ${maxOf(metrics.tickMs).toFixed(3)}`,
      '# HELP foxhunter_snapshot_bytes Snapshot size in bytes (rolling)', '# TYPE foxhunter_snapshot_bytes gauge', `foxhunter_snapshot_bytes{kind="full"} ${Math.round(avg(metrics.fullBytes))}`, `foxhunter_snapshot_bytes{kind="delta"} ${Math.round(avg(metrics.deltaBytes))}`,
      '# HELP foxhunter_snapshots_total Snapshots broadcast', '# TYPE foxhunter_snapshots_total counter', `foxhunter_snapshots_total ${metrics.snapshots}`,
      '# HELP foxhunter_rounds_total Rounds finished', '# TYPE foxhunter_rounds_total counter', `foxhunter_rounds_total{result="lost"} ${metrics.roundsFinished - metrics.roundsWon}`, `foxhunter_rounds_total{result="won"} ${metrics.roundsWon}`,
      '# HELP foxhunter_uptime_seconds Seconds since start', '# TYPE foxhunter_uptime_seconds counter', `foxhunter_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`,
      '# HELP foxhunter_protocol Protocol version', '# TYPE foxhunter_protocol gauge', `foxhunter_protocol ${PROTOCOL}`,
    ];
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(lines.join('\n') + '\n');
  }
  if (urlPath === '/healthz') {
    res.writeHead(200);
    return res.end('ok');
  }

  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Scripts and the page must revalidate so a new protocol reaches every browser quickly.
      'Cache-Control': ext === '.html' || ext === '.js' || ext === '.webmanifest' ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(data);
  });
});

// ---------------------------------------------------------------------------
// WebSocket handling with reconnection tokens
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, perMessageDeflate: true });
const sockets = new Map(); // player id -> ws

function sanitizeName(raw) {
  const name = String(raw || '')
    .replace(/[^\p{L}\p{N} _\-.!]/gu, '')
    .trim()
    .slice(0, 16);
  return name || `Lovec${Math.floor(Math.random() * 900 + 100)}`;
}

function sendJson(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  let player = null;
  ws.isAlive = true;
  ws.needsFull = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'join' && !player) {
      // Same token within the grace period => same hunter, same score.
      const token = typeof msg.token === 'string' && msg.token.length >= 16 && msg.token.length <= 64 ? msg.token : null;
      let rejoined = false;
      if (token) {
        player = game.reconnect(token);
        if (player) {
          rejoined = true;
          const old = sockets.get(player.id);
          if (old && old !== ws) old.terminate();
        }
      }
      if (!player) player = game.addPlayer({ name: sanitizeName(msg.name), outfit: msg.outfit, token: token || crypto.randomUUID() });
      sockets.set(player.id, ws);
      sendJson(ws, { t: 'welcome', proto: PROTOCOL, id: player.id, token: player.token, world: game.world, rejoined, name: player.name });
      console.log(`+ ${player.name} (#${player.id}) ${rejoined ? 'is back' : 'joined'}, ${game.connectedCount()} online`);
      return;
    }
    if (!player) return;

    if (msg.t === 'input') game.setInput(player.id, msg);
    else if (msg.t === 'emote') game.emote(player.id, Number(msg.n));
    else if (msg.t === 'ready') game.setReady(player.id);
    else if (msg.t === 'ping') sendJson(ws, { t: 'pong', ts: msg.ts });
  });

  ws.on('close', () => {
    if (!player) return;
    if (sockets.get(player.id) === ws) {
      sockets.delete(player.id);
      game.disconnect(player.id);
      console.log(`- ${player.name} (#${player.id}) disconnected, ${game.connectedCount()} online`);
    }
  });
});

// ---------------------------------------------------------------------------
// Loops
// ---------------------------------------------------------------------------
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 0.05);
  lastTick = now;
  const t0 = process.hrtime.bigint();
  game.tick(dt);
  pushMetric(metrics.tickMs, Number(process.hrtime.bigint() - t0) / 1e6);
}, 1000 / TICK_RATE);

let lastSent = null;
let keyframeTimer = 0;
setInterval(() => {
  if (game.players.size === 0) {
    game.takeEvents();
    lastSent = null;
    return;
  }
  const snap = game.snapshot();
  game.takeEvents();
  keyframeTimer += 1 / SNAPSHOT_RATE;
  const keyframe = !lastSent || keyframeTimer >= KEYFRAME_EVERY;
  if (keyframe) keyframeTimer = 0;
  const full = JSON.stringify(snap);
  const delta = keyframe ? full : JSON.stringify(encodeDelta(lastSent, snap));
  metrics.snapshots++;
  if (keyframe) pushMetric(metrics.fullBytes, full.length, 60);
  else pushMetric(metrics.deltaBytes, delta.length);
  for (const ws of wss.clients) {
    if (ws.readyState !== ws.OPEN) continue;
    if (keyframe || ws.needsFull) {
      ws.send(full);
      ws.needsFull = false;
    } else ws.send(delta);
  }
  lastSent = snap;
}, 1000 / SNAPSHOT_RATE);

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => {
  console.log(`Hanka The Fox Hunter běží na http://localhost:${PORT}`);
});
