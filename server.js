'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// ---------------------------------------------------------------------------
// Static HTTP server
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------------------------------------------------------------------------
// Game constants
// ---------------------------------------------------------------------------
const WORLD = { width: 3200, height: 720, groundY: 660 };
const GRAVITY = 1900;
const MAX_FALL = 1300;
const TICK_RATE = 60;
const SNAPSHOT_RATE = 20;

const PLAYER = { w: 30, h: 48, speed: 270, jump: 680, hp: 100, shootCooldown: 0.22, invuln: 0.6, respawn: 3 };
const FOX = { w: 46, h: 28, hp: 30, damage: 12, biteCooldown: 0.9, jump: 560 };
const BULLET = { speed: 1000, life: 1.1, damage: 10, w: 10, h: 4 };

// Platforms: first one is the ground (solid), the rest are one-way (you can jump through them from below).
const PLATFORMS = [
  { x: 0, y: WORLD.groundY, w: WORLD.width, h: 60, ground: true },
  { x: 200, y: 545, w: 190, h: 18 },
  { x: 480, y: 455, w: 160, h: 18 },
  { x: 760, y: 565, w: 230, h: 18 },
  { x: 1070, y: 470, w: 150, h: 18 },
  { x: 1290, y: 380, w: 210, h: 18 },
  { x: 1420, y: 260, w: 120, h: 18 },
  { x: 1600, y: 520, w: 260, h: 18 },
  { x: 1950, y: 430, w: 160, h: 18 },
  { x: 2190, y: 560, w: 200, h: 18 },
  { x: 2450, y: 460, w: 180, h: 18 },
  { x: 2740, y: 545, w: 230, h: 18 },
  { x: 3000, y: 450, w: 150, h: 18 },
];

const SPAWN_POINT = { x: WORLD.width / 2 - PLAYER.w / 2, y: WORLD.groundY - PLAYER.h };

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const players = new Map(); // id -> player
const foxes = new Map(); // id -> fox
const bullets = new Map(); // id -> bullet
let events = []; // one-shot events flushed with next snapshot
let nextId = 1;
let totalKills = 0;
let spawnTimer = 2;
let gameTime = 0;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function currentWave() {
  return 1 + Math.floor(totalKills / 12);
}

function pushEvent(ev) {
  events.push(ev);
}

// ---------------------------------------------------------------------------
// Physics shared by players and foxes
// ---------------------------------------------------------------------------
function stepPhysics(e, dt) {
  e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL);
  const prevBottom = e.y + e.h;
  e.x = clamp(e.x + e.vx * dt, 0, WORLD.width - e.w);
  e.y += e.vy * dt;
  e.onGround = false;

  if (e.vy >= 0) {
    for (const p of PLATFORMS) {
      if (e.x + e.w <= p.x || e.x >= p.x + p.w) continue;
      const bottom = e.y + e.h;
      if (prevBottom <= p.y + 0.5 && bottom >= p.y) {
        e.y = p.y - e.h;
        e.vy = 0;
        e.onGround = true;
      }
    }
  }
  // Safety net so nobody ever falls out of the world.
  if (e.y + e.h > WORLD.groundY) {
    e.y = WORLD.groundY - e.h;
    e.vy = 0;
    e.onGround = true;
  }
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
function createPlayer(ws, name) {
  const id = nextId++;
  const player = {
    id,
    ws,
    name,
    x: SPAWN_POINT.x + rand(-80, 80),
    y: SPAWN_POINT.y,
    vx: 0,
    vy: 0,
    w: PLAYER.w,
    h: PLAYER.h,
    hp: PLAYER.hp,
    score: 0,
    kills: 0,
    deaths: 0,
    facing: 1,
    onGround: false,
    alive: true,
    respawnTimer: 0,
    shootTimer: 0,
    invulnTimer: 0,
    input: { left: false, right: false, jump: false, shoot: false },
    jumpHeld: false,
  };
  players.set(id, player);
  return player;
}

function respawnPlayer(p) {
  p.alive = true;
  p.hp = PLAYER.hp;
  p.x = SPAWN_POINT.x + rand(-80, 80);
  p.y = SPAWN_POINT.y;
  p.vx = 0;
  p.vy = 0;
  p.invulnTimer = 1.5;
  pushEvent({ kind: 'respawn', id: p.id, x: p.x, y: p.y });
}

function updatePlayer(p, dt) {
  if (!p.alive) {
    p.respawnTimer -= dt;
    if (p.respawnTimer <= 0) respawnPlayer(p);
    return;
  }

  p.shootTimer = Math.max(0, p.shootTimer - dt);
  p.invulnTimer = Math.max(0, p.invulnTimer - dt);

  const inp = p.input;
  const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  p.vx = dir * PLAYER.speed;
  if (dir !== 0) p.facing = dir;

  if (inp.jump && !p.jumpHeld && p.onGround) {
    p.vy = -PLAYER.jump;
    p.onGround = false;
    pushEvent({ kind: 'jump', id: p.id, x: p.x + p.w / 2, y: p.y + p.h });
  }
  p.jumpHeld = inp.jump;

  stepPhysics(p, dt);

  if (inp.shoot && p.shootTimer <= 0) {
    p.shootTimer = PLAYER.shootCooldown;
    const id = nextId++;
    const gunY = p.y + 22;
    const bx = p.facing > 0 ? p.x + p.w + 4 : p.x - BULLET.w - 4;
    bullets.set(id, {
      id,
      owner: p.id,
      x: bx,
      y: gunY,
      w: BULLET.w,
      h: BULLET.h,
      vx: p.facing * BULLET.speed,
      life: BULLET.life,
    });
    pushEvent({ kind: 'shoot', id: p.id, x: bx, y: gunY, dir: p.facing });
  }
}

function damagePlayer(p, amount, fromX) {
  if (!p.alive || p.invulnTimer > 0) return;
  p.hp -= amount;
  p.invulnTimer = PLAYER.invuln;
  const pushDir = p.x + p.w / 2 < fromX ? -1 : 1;
  p.vx = pushDir * 200;
  p.vy = Math.min(p.vy, -260);
  pushEvent({ kind: 'hurt', id: p.id, x: p.x + p.w / 2, y: p.y + p.h / 2 });

  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    p.deaths++;
    p.respawnTimer = PLAYER.respawn;
    pushEvent({ kind: 'death', id: p.id, name: p.name, x: p.x + p.w / 2, y: p.y + p.h / 2 });
  }
}

// ---------------------------------------------------------------------------
// Foxes
// ---------------------------------------------------------------------------
function spawnFox() {
  const wave = currentWave();
  const id = nextId++;
  const fromLeft = Math.random() < 0.5;
  const speed = rand(120, 170) + wave * 10;
  foxes.set(id, {
    id,
    x: fromLeft ? -FOX.w : WORLD.width,
    y: WORLD.groundY - FOX.h,
    vx: 0,
    vy: 0,
    w: FOX.w,
    h: FOX.h,
    hp: FOX.hp + Math.floor(wave / 2) * 10,
    maxHp: FOX.hp + Math.floor(wave / 2) * 10,
    speed,
    facing: fromLeft ? 1 : -1,
    onGround: false,
    biteTimer: rand(0, 0.5),
    jumpTimer: rand(0.3, 1.2),
    wanderDir: fromLeft ? 1 : -1,
    wanderTimer: 0,
  });
}

function nearestAlivePlayer(fox) {
  let best = null;
  let bestDist = Infinity;
  for (const p of players.values()) {
    if (!p.alive) continue;
    const dx = p.x + p.w / 2 - (fox.x + fox.w / 2);
    const dy = p.y + p.h / 2 - (fox.y + fox.h / 2);
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function updateFox(fox, dt) {
  fox.biteTimer = Math.max(0, fox.biteTimer - dt);
  fox.jumpTimer = Math.max(0, fox.jumpTimer - dt);

  const target = nearestAlivePlayer(fox);
  if (target) {
    const fcx = fox.x + fox.w / 2;
    const tcx = target.x + target.w / 2;
    const dx = tcx - fcx;
    const dy = target.y + target.h - (fox.y + fox.h); // negative = target is above

    if (Math.abs(dx) > 14) {
      fox.facing = Math.sign(dx);
      fox.vx = fox.facing * fox.speed;
    } else {
      fox.vx = 0;
    }

    // Jump if the player is noticeably above us, or randomly as a lunge.
    if (fox.onGround && fox.jumpTimer <= 0) {
      if (dy < -40 && Math.abs(dx) < 260) {
        fox.vy = -FOX.jump;
        fox.jumpTimer = rand(0.6, 1.2);
      } else if (Math.abs(dx) < 120 && Math.random() < 0.4) {
        fox.vy = -FOX.jump * 0.55;
        fox.vx = fox.facing * fox.speed * 1.4;
        fox.jumpTimer = rand(1.0, 2.0);
      }
    }
  } else {
    // Nobody alive: wander around.
    fox.wanderTimer -= dt;
    if (fox.wanderTimer <= 0) {
      fox.wanderDir = Math.random() < 0.5 ? -1 : 1;
      fox.wanderTimer = rand(1, 3);
    }
    fox.facing = fox.wanderDir;
    fox.vx = fox.wanderDir * fox.speed * 0.5;
  }

  // Foxes may start off-screen; physics clamps x to world, so give them a moment to enter.
  const wasOutside = fox.x < 0 || fox.x + fox.w > WORLD.width;
  stepPhysics(fox, dt);
  if (wasOutside) fox.x = clamp(fox.x, 0, WORLD.width - fox.w);

  // Bite
  if (fox.biteTimer <= 0) {
    for (const p of players.values()) {
      if (!p.alive) continue;
      if (overlaps(fox, p)) {
        fox.biteTimer = FOX.biteCooldown;
        damagePlayer(p, FOX.damage, fox.x + fox.w / 2);
        pushEvent({ kind: 'bite', id: fox.id, x: fox.x + fox.w / 2, y: fox.y });
        break;
      }
    }
  }
}

function damageFox(fox, amount, shooter) {
  fox.hp -= amount;
  if (fox.hp <= 0) {
    foxes.delete(fox.id);
    totalKills++;
    if (shooter) {
      shooter.score += 10;
      shooter.kills++;
    }
    pushEvent({ kind: 'kill', id: fox.id, x: fox.x + fox.w / 2, y: fox.y + fox.h / 2, by: shooter ? shooter.id : 0 });
  } else {
    pushEvent({ kind: 'hit', id: fox.id, x: fox.x + fox.w / 2, y: fox.y + fox.h / 2 });
  }
}

// ---------------------------------------------------------------------------
// Bullets
// ---------------------------------------------------------------------------
function updateBullet(b, dt) {
  b.x += b.vx * dt;
  b.life -= dt;
  if (b.life <= 0 || b.x + b.w < 0 || b.x > WORLD.width) {
    bullets.delete(b.id);
    return;
  }
  for (const fox of foxes.values()) {
    if (overlaps(b, fox)) {
      bullets.delete(b.id);
      damageFox(fox, BULLET.damage, players.get(b.owner));
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function tick(dt) {
  gameTime += dt;

  for (const p of players.values()) updatePlayer(p, dt);
  for (const f of foxes.values()) updateFox(f, dt);
  for (const b of bullets.values()) updateBullet(b, dt);

  // Spawn foxes only while someone is playing.
  if (players.size > 0) {
    const wave = currentWave();
    const maxFoxes = 3 + wave * 2 + players.size * 2;
    spawnTimer -= dt;
    if (spawnTimer <= 0 && foxes.size < maxFoxes) {
      spawnFox();
      spawnTimer = Math.max(0.9, 3.4 - wave * 0.3) * rand(0.7, 1.3);
    }
  } else if (foxes.size > 0) {
    foxes.clear();
    bullets.clear();
  }
}

function snapshot() {
  return {
    t: 'state',
    time: Math.round(gameTime * 1000),
    wave: currentWave(),
    kills: totalKills,
    players: [...players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      vx: Math.round(p.vx),
      hp: p.hp,
      score: p.score,
      kills: p.kills,
      deaths: p.deaths,
      facing: p.facing,
      alive: p.alive,
      onGround: p.onGround,
      respawn: p.alive ? 0 : Math.ceil(p.respawnTimer),
      inv: p.invulnTimer > 0,
    })),
    foxes: [...foxes.values()].map((f) => ({
      id: f.id,
      x: Math.round(f.x * 10) / 10,
      y: Math.round(f.y * 10) / 10,
      vx: Math.round(f.vx),
      hp: f.hp,
      maxHp: f.maxHp,
      facing: f.facing,
      onGround: f.onGround,
    })),
    bullets: [...bullets.values()].map((b) => ({
      id: b.id,
      x: Math.round(b.x),
      y: Math.round(b.y),
      dir: Math.sign(b.vx),
    })),
    events,
  };
}

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 0.05);
  lastTick = now;
  tick(dt);
}, 1000 / TICK_RATE);

setInterval(() => {
  if (players.size === 0) {
    events = [];
    return;
  }
  const msg = JSON.stringify(snapshot());
  events = [];
  for (const p of players.values()) {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg);
  }
}, 1000 / SNAPSHOT_RATE);

// ---------------------------------------------------------------------------
// WebSocket handling
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server });

function sanitizeName(raw) {
  const name = String(raw || '')
    .replace(/[^\p{L}\p{N} _\-.!]/gu, '')
    .trim()
    .slice(0, 16);
  return name || `Lovec${Math.floor(Math.random() * 900 + 100)}`;
}

wss.on('connection', (ws) => {
  let player = null;
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'join' && !player) {
      player = createPlayer(ws, sanitizeName(msg.name));
      ws.send(
        JSON.stringify({
          t: 'welcome',
          id: player.id,
          world: WORLD,
          platforms: PLATFORMS,
          consts: { PLAYER, FOX, BULLET },
        })
      );
      pushEvent({ kind: 'join', id: player.id, name: player.name });
      console.log(`+ ${player.name} (#${player.id}) joined, ${players.size} online`);
      return;
    }

    if (!player) return;

    if (msg.t === 'input') {
      player.input.left = !!msg.left;
      player.input.right = !!msg.right;
      player.input.jump = !!msg.jump;
      player.input.shoot = !!msg.shoot;
    } else if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', ts: msg.ts }));
    }
  });

  ws.on('close', () => {
    if (!player) return;
    players.delete(player.id);
    pushEvent({ kind: 'leave', id: player.id, name: player.name });
    console.log(`- ${player.name} (#${player.id}) left, ${players.size} online`);
  });
});

// Drop dead connections.
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
