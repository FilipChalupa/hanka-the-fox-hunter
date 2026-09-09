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
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
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

const PLAYER = {
  w: 30, h: 48, speed: 270, jump: 680, hp: 100,
  shootCooldown: 0.22, invuln: 0.6, ghostSpeed: 220,
  reviveTime: 3, reviveHp: 10, reviveReach: 36,
  friendlyFire: 10, teamKillPenalty: 20,
};

// Fox kinds. `minWave` says when a kind starts showing up; `weight` is its spawn chance.
const FOX_KINDS = {
  normal: { w: 46, h: 28, hp: 30, hpPerWave: 5, damage: 12, bite: 0.9, jump: 720, speed: [120, 170], speedPerWave: 10, score: 10, minWave: 1, weight: 5 },
  fast:   { w: 34, h: 20, hp: 12, hpPerWave: 3, damage: 6, bite: 0.55, jump: 620, speed: [250, 300], speedPerWave: 8, score: 15, minWave: 2, weight: 3 },
  jumper: { w: 44, h: 30, hp: 30, hpPerWave: 5, damage: 12, bite: 0.9, jump: 900, speed: [130, 160], speedPerWave: 8, score: 15, minWave: 3, weight: 2 },
  digger: { w: 48, h: 26, hp: 40, hpPerWave: 6, damage: 18, bite: 1.1, jump: 560, speed: [90, 120], speedPerWave: 6, score: 20, minWave: 4, weight: 2 },
  mega:   { w: 92, h: 56, hp: 150, hpPerWave: 15, damage: 30, bite: 1.2, jump: 820, speed: [95, 120], speedPerWave: 5, score: 50, minWave: 3, weight: 0 },
};
const MEGA_EVERY = 3;

const BULLET = { speed: 1000, life: 1.1, w: 10, h: 4 };
const WEAPONS = {
  rifle:   { cooldown: 0.22, damage: 10, pellets: 1, spread: 0 },
  shotgun: { cooldown: 0.5, damage: 8, pellets: 3, spread: 140, duration: 12 },
  rapid:   { cooldown: 0.08, damage: 7, pellets: 1, spread: 0, duration: 10 },
};
const PICKUPS = {
  medkit: { weight: 4 },
  shotgun: { weight: 3 },
  rapid: { weight: 3 },
  speed: { weight: 2, duration: 12, factor: 1.45 },
};
const PICKUP = { w: 22, h: 22, life: 25, every: [14, 22], max: 3, dropChance: 0.08, megaDropChance: 0.6 };

const FIRE = { life: 6, radius: 34, height: 44, tick: 0.5, playerDamage: 6, foxDamage: 8, foxAvoid: 120 };

const ROUND_RESTART = 12;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function weightedPick(table, filter) {
  const entries = Object.entries(table).filter(([k, v]) => v.weight > 0 && (!filter || filter(k, v)));
  const total = entries.reduce((n, [, v]) => n + v.weight, 0);
  let r = Math.random() * total;
  for (const [k, v] of entries) {
    r -= v.weight;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

// ---------------------------------------------------------------------------
// Forest generation: a fresh platform layout every round
// ---------------------------------------------------------------------------
let PLATFORMS = [];
let worldSeed = 1;

function generatePlatforms(seed) {
  const rnd = seeded(seed);
  const list = [{ x: 0, y: WORLD.groundY, w: WORLD.width, h: 60, ground: true }];
  const fits = (p) => list.every((q) => q.ground || p.x + p.w + 40 < q.x || p.x > q.x + q.w + 40 || Math.abs(p.y - q.y) > 70);
  let x = 120 + rnd() * 120;
  while (x < WORLD.width - 260) {
    // First tier is always reachable from the ground (player jump height ~120 px)
    let y = WORLD.groundY - 95 - Math.floor(rnd() * 20);
    let w = 130 + Math.floor(rnd() * 130);
    let px = x;
    const tiers = 1 + (rnd() < 0.7 ? 1 : 0) + (rnd() < 0.35 ? 1 : 0);
    for (let t = 0; t < tiers; t++) {
      const p = { x: Math.round(px), y: Math.round(y), w: Math.round(w), h: 18 };
      if (p.x + p.w > WORLD.width - 40) p.w = WORLD.width - 40 - p.x;
      if (p.w >= 90 && fits(p)) list.push(p);
      // Next tier: higher, shifted sideways but still within a jump
      y -= 85 + rnd() * 25;
      px += (rnd() < 0.5 ? -1 : 1) * (60 + rnd() * 90);
      w = 100 + rnd() * 110;
      if (px < 20) px = 20;
    }
    x += 260 + rnd() * 220;
  }
  return list;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const players = new Map();
const foxes = new Map();
const bullets = new Map();
const pickups = new Map();
const fires = new Map();
let events = [];
let nextId = 1;
let totalKills = 0;
let spawnTimer = 2;
let pickupTimer = 10;
let gameTime = 0;
let announcedWave = 1;
const round = { number: 1, over: false, restartTimer: 0 };

const SPAWN_POINT = { x: WORLD.width / 2 - PLAYER.w / 2, y: WORLD.groundY - PLAYER.h };
const currentWave = () => 1 + Math.floor(totalKills / 12);
const pushEvent = (ev) => events.push(ev);

function newWorld() {
  worldSeed = Math.floor(Math.random() * 2 ** 31);
  PLATFORMS = generatePlatforms(worldSeed);
}
newWorld();

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
  if (e.y + e.h > WORLD.groundY) {
    e.y = WORLD.groundY - e.h;
    e.vy = 0;
    e.onGround = true;
  }
}

function groundBelow(x, w, bottom) {
  let best = WORLD.groundY;
  for (const p of PLATFORMS) {
    if (p.ground) continue;
    if (x + w > p.x && x < p.x + p.w && p.y >= bottom - 2 && p.y < best) best = p.y;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
const OUTFIT_COUNT = 8;

function pickOutfit() {
  const used = new Set([...players.values()].map((p) => p.outfit));
  for (let i = 0; i < OUTFIT_COUNT; i++) if (!used.has(i)) return i;
  return players.size % OUTFIT_COUNT;
}

function createPlayer(ws, name, wantedOutfit) {
  const id = nextId++;
  const used = new Set([...players.values()].map((p) => p.outfit));
  const outfit =
    Number.isInteger(wantedOutfit) && wantedOutfit >= 0 && wantedOutfit < OUTFIT_COUNT && !used.has(wantedOutfit) ? wantedOutfit : pickOutfit();
  const player = {
    id, ws, name, outfit,
    x: SPAWN_POINT.x + rand(-80, 80), y: SPAWN_POINT.y, vx: 0, vy: 0, w: PLAYER.w, h: PLAYER.h,
    hp: round.over ? 0 : PLAYER.hp, alive: !round.over,
    score: 0, kills: 0, deaths: 0, teamKills: 0,
    facing: 1, onGround: false,
    shootTimer: 0, invulnTimer: 0, fireTick: 0, emoteTimer: 0,
    weapon: 'rifle', weaponTimer: 0, speedTimer: 0,
    reviveProgress: 0, reviver: 0, reviving: 0,
    spawnedAt: gameTime, lastSurvival: 0, lifeKills: 0, bestSurvival: 0, bestLifeKills: 0, bestScore: 0,
    input: { left: false, right: false, jump: false, shoot: false, down: false, revive: false },
    jumpHeld: false,
  };
  players.set(id, player);
  return player;
}

function respawnPlayer(p) {
  p.alive = true;
  p.hp = PLAYER.hp;
  p.spawnedAt = gameTime;
  p.lifeKills = 0;
  p.score = 0;
  p.kills = 0;
  p.teamKills = 0;
  p.weapon = 'rifle';
  p.weaponTimer = 0;
  p.speedTimer = 0;
  p.reviveProgress = 0;
  p.x = SPAWN_POINT.x + rand(-80, 80);
  p.y = SPAWN_POINT.y;
  p.vx = 0;
  p.vy = 0;
  p.invulnTimer = 1.5;
  pushEvent({ kind: 'respawn', id: p.id, x: p.x, y: p.y });
}

function updateGhost(p, dt) {
  const inp = p.input;
  const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  const vdir = (inp.down ? 1 : 0) - (inp.jump ? 1 : 0);
  p.vx = dir * PLAYER.ghostSpeed;
  p.vy = vdir * PLAYER.ghostSpeed;
  if (dir !== 0) p.facing = dir;
  p.x = clamp(p.x + p.vx * dt, 0, WORLD.width - p.w);
  p.y = clamp(p.y + p.vy * dt, 0, WORLD.groundY - p.h);
  p.onGround = false;
}

function fireBullets(p) {
  const weapon = WEAPONS[p.weapon] || WEAPONS.rifle;
  p.shootTimer = weapon.cooldown;
  const gunY = p.y + 22;
  const bx = p.facing > 0 ? p.x + p.w + 4 : p.x - BULLET.w - 4;
  for (let i = 0; i < weapon.pellets; i++) {
    const k = weapon.pellets === 1 ? 0 : i / (weapon.pellets - 1) - 0.5;
    const id = nextId++;
    bullets.set(id, {
      id, owner: p.id, x: bx, y: gunY, w: BULLET.w, h: BULLET.h,
      vx: p.facing * BULLET.speed, vy: k * weapon.spread * 2,
      damage: weapon.damage, life: BULLET.life,
    });
  }
  pushEvent({ kind: 'shoot', id: p.id, x: bx, y: gunY, dir: p.facing, weapon: p.weapon });
}

function findGhostNear(p) {
  const reach = { x: p.x - PLAYER.reviveReach, y: p.y - PLAYER.reviveReach, w: p.w + PLAYER.reviveReach * 2, h: p.h + PLAYER.reviveReach * 2 };
  let best = null;
  for (const g of players.values()) {
    if (g.alive || g === p) continue;
    if (overlaps(reach, g) && (!best || g.reviveProgress > best.reviveProgress)) best = g;
  }
  return best;
}

function reviveGhost(g, by) {
  g.alive = true;
  g.hp = PLAYER.reviveHp;
  g.spawnedAt = gameTime;
  g.lifeKills = 0;
  g.reviveProgress = 0;
  g.reviver = 0;
  g.x = by.x;
  g.y = by.y;
  g.vx = 0;
  g.vy = 0;
  g.invulnTimer = 2;
  g.weapon = 'rifle';
  by.score += 15;
  pushEvent({ kind: 'revived', id: g.id, by: by.id, name: g.name, byName: by.name, x: g.x + g.w / 2, y: g.y + g.h / 2 });
}

function updatePlayer(p, dt) {
  p.reviving = 0;
  if (!p.alive) {
    updateGhost(p, dt);
    return;
  }

  p.shootTimer = Math.max(0, p.shootTimer - dt);
  p.invulnTimer = Math.max(0, p.invulnTimer - dt);
  p.emoteTimer = Math.max(0, p.emoteTimer - dt);
  if (p.weaponTimer > 0) {
    p.weaponTimer -= dt;
    if (p.weaponTimer <= 0) {
      p.weapon = 'rifle';
      p.weaponTimer = 0;
    }
  }
  p.speedTimer = Math.max(0, p.speedTimer - dt);

  const inp = p.input;
  const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  const speed = PLAYER.speed * (p.speedTimer > 0 ? PICKUPS.speed.factor : 1);

  // Reviving: must stand still on the ground and must not shoot.
  if (inp.revive && dir === 0 && !inp.shoot && p.onGround) {
    const ghost = findGhostNear(p);
    if (ghost) {
      p.reviving = ghost.id;
      ghost.reviver = p.id;
      ghost.reviveProgress += dt;
      if (ghost.reviveProgress >= PLAYER.reviveTime) reviveGhost(ghost, p);
    }
  }

  p.vx = dir * speed;
  if (dir !== 0) p.facing = dir;

  if (inp.jump && !p.jumpHeld && p.onGround) {
    p.vy = -PLAYER.jump;
    p.onGround = false;
    pushEvent({ kind: 'jump', id: p.id, x: p.x + p.w / 2, y: p.y + p.h });
  }
  p.jumpHeld = inp.jump;

  stepPhysics(p, dt);

  if (inp.shoot && p.shootTimer <= 0 && !p.reviving) fireBullets(p);

  for (const pk of pickups.values()) {
    if (overlaps(p, pk)) {
      pickups.delete(pk.id);
      applyPickup(p, pk);
    }
  }
}

function applyPickup(p, pk) {
  if (pk.kind === 'medkit') p.hp = Math.min(PLAYER.hp, p.hp + 40);
  else if (pk.kind === 'speed') p.speedTimer = PICKUPS.speed.duration;
  else {
    p.weapon = pk.kind;
    p.weaponTimer = WEAPONS[pk.kind].duration;
  }
  pushEvent({ kind: 'pickup', id: p.id, item: pk.kind, x: pk.x + pk.w / 2, y: pk.y + pk.h / 2 });
}

function damagePlayer(p, amount, fromX, source) {
  if (!p.alive || p.invulnTimer > 0) return;
  p.hp -= amount;
  p.invulnTimer = PLAYER.invuln;
  const pushDir = p.x + p.w / 2 < fromX ? -1 : 1;
  p.vx = pushDir * 200;
  p.vy = Math.min(p.vy, -260);
  pushEvent({ kind: 'hurt', id: p.id, x: p.x + p.w / 2, y: p.y + p.h / 2, source: source ? source.kind : 'fox' });

  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    p.deaths++;
    p.lastSurvival = gameTime - p.spawnedAt;
    p.bestSurvival = Math.max(p.bestSurvival, p.lastSurvival);
    p.bestLifeKills = Math.max(p.bestLifeKills, p.lifeKills);
    p.bestScore = Math.max(p.bestScore, p.score);
    p.reviveProgress = 0;
    p.vy = -120;
    const ev = { kind: 'death', id: p.id, name: p.name, x: p.x + p.w / 2, y: p.y + p.h / 2 };
    if (source && source.kind === 'player') {
      const killer = players.get(source.id);
      if (killer) {
        killer.score = Math.max(0, killer.score - PLAYER.teamKillPenalty);
        killer.teamKills++;
        ev.by = killer.id;
        ev.byName = killer.name;
      }
    } else if (source && source.kind === 'fire') ev.fire = true;
    pushEvent(ev);
    checkRoundOver();
  }
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------
function ranking() {
  return [...players.values()]
    .sort((a, b) => b.score - a.score || b.lastSurvival - a.lastSurvival)
    .map((p) => ({ id: p.id, name: p.name, outfit: p.outfit, score: p.score, kills: p.kills, survived: Math.round(p.lastSurvival) }));
}

function checkRoundOver() {
  if (round.over || players.size === 0) return;
  for (const p of players.values()) if (p.alive) return;
  round.over = true;
  round.restartTimer = ROUND_RESTART;
  pushEvent({ kind: 'gameover', wave: currentWave(), kills: totalKills, ranking: ranking(), restartIn: ROUND_RESTART });
}

function clearWorld() {
  foxes.clear();
  bullets.clear();
  pickups.clear();
  fires.clear();
  totalKills = 0;
  announcedWave = 1;
  spawnTimer = 3;
  pickupTimer = 10;
  newWorld();
}

function startRound() {
  round.number++;
  round.over = false;
  clearWorld();
  for (const p of players.values()) respawnPlayer(p);
  pushEvent({ kind: 'newround', number: round.number, platforms: PLATFORMS, seed: worldSeed });
}

function resetWorld() {
  clearWorld();
  round.over = false;
  round.restartTimer = 0;
}

// ---------------------------------------------------------------------------
// Foxes
// ---------------------------------------------------------------------------
function spawnFox(kind) {
  const wave = currentWave();
  const K = FOX_KINDS[kind];
  const id = nextId++;
  const fromLeft = Math.random() < 0.5;
  const hp = K.hp + Math.floor(wave / 2) * K.hpPerWave;
  foxes.set(id, {
    id, kind, mega: kind === 'mega',
    x: fromLeft ? -K.w : WORLD.width, y: WORLD.groundY - K.h, vx: 0, vy: 0, w: K.w, h: K.h,
    hp, maxHp: hp, speed: rand(K.speed[0], K.speed[1]) + wave * K.speedPerWave,
    damage: K.damage, jump: K.jump, biteCooldown: K.bite, score: K.score,
    facing: fromLeft ? 1 : -1, onGround: false,
    biteTimer: rand(0, 0.5), jumpTimer: rand(0.3, 1.2), wanderDir: fromLeft ? 1 : -1, wanderTimer: 0,
    fireTick: 0,
    dug: kind === 'digger', digTimer: kind === 'digger' ? 0 : rand(3, 6),
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

function fireAhead(fox) {
  const cx = fox.x + fox.w / 2;
  const bottom = fox.y + fox.h;
  for (const f of fires.values()) {
    const dx = f.x - cx;
    if (Math.abs(dx) < FIRE.foxAvoid && Math.abs(f.y - bottom) < 70 && Math.sign(dx) === Math.sign(fox.vx || fox.facing)) return f;
  }
  return null;
}

function updateFox(fox, dt) {
  fox.biteTimer = Math.max(0, fox.biteTimer - dt);
  fox.jumpTimer = Math.max(0, fox.jumpTimer - dt);
  const target = nearestAlivePlayer(fox);
  const fcx = fox.x + fox.w / 2;

  // --- Digger: travels underground, pops up beneath its victim ---
  if (fox.kind === 'digger') {
    if (fox.dug) {
      fox.y = WORLD.groundY - fox.h;
      fox.vy = 0;
      fox.onGround = true;
      if (target) {
        const dx = target.x + target.w / 2 - fcx;
        fox.facing = Math.sign(dx) || fox.facing;
        fox.vx = fox.facing * fox.speed * 1.7;
        fox.x = clamp(fox.x + fox.vx * dt, 0, WORLD.width - fox.w);
        if (Math.abs(dx) < 24) {
          fox.dug = false;
          fox.digTimer = rand(4, 7);
          fox.vy = -fox.jump;
          fox.onGround = false;
          fox.biteTimer = 0.15;
          pushEvent({ kind: 'emerge', id: fox.id, x: fcx, y: fox.y + fox.h });
        }
      } else fox.vx = 0;
      return;
    }
    fox.digTimer -= dt;
    if (fox.digTimer <= 0 && fox.onGround && fox.y + fox.h >= WORLD.groundY - 1) {
      fox.dug = true;
      pushEvent({ kind: 'dig', id: fox.id, x: fcx, y: fox.y + fox.h });
      return;
    }
  }

  if (target) {
    const tcx = target.x + target.w / 2;
    const dx = tcx - fcx;
    const dy = target.y + target.h - (fox.y + fox.h);
    if (Math.abs(dx) > 14) {
      fox.facing = Math.sign(dx);
      fox.vx = fox.facing * fox.speed;
    } else fox.vx = 0;

    if (fox.onGround && fox.jumpTimer <= 0) {
      const jumpy = fox.kind === 'jumper';
      if (dy < -40 && Math.abs(dx) < (jumpy ? 420 : 260)) {
        fox.vy = -fox.jump;
        fox.jumpTimer = jumpy ? rand(0.3, 0.7) : rand(0.6, 1.2);
        pushEvent({ kind: 'foxjump', id: fox.id, x: fcx, y: fox.y + fox.h });
      } else if (jumpy && Math.random() < 0.5) {
        fox.vy = -fox.jump * 0.7;
        fox.vx = fox.facing * fox.speed * 1.5;
        fox.jumpTimer = rand(0.5, 1.0);
        pushEvent({ kind: 'foxjump', id: fox.id, x: fcx, y: fox.y + fox.h });
      } else if (Math.abs(dx) < 120 && Math.random() < 0.4) {
        fox.vy = -fox.jump * 0.55;
        fox.vx = fox.facing * fox.speed * 1.4;
        fox.jumpTimer = rand(1.0, 2.0);
        pushEvent({ kind: 'foxjump', id: fox.id, x: fcx, y: fox.y + fox.h });
      }
    }
  } else {
    fox.wanderTimer -= dt;
    if (fox.wanderTimer <= 0) {
      fox.wanderDir = Math.random() < 0.5 ? -1 : 1;
      fox.wanderTimer = rand(1, 3);
    }
    fox.facing = fox.wanderDir;
    fox.vx = fox.wanderDir * fox.speed * 0.5;
  }

  // Foxes keep their distance from fire.
  const fire = fireAhead(fox);
  if (fire) {
    const away = fox.x + fox.w / 2 < fire.x ? -1 : 1;
    fox.vx = away * fox.speed * 0.7;
    fox.facing = away;
  }

  const wasOutside = fox.x < 0 || fox.x + fox.w > WORLD.width;
  stepPhysics(fox, dt);
  if (wasOutside) fox.x = clamp(fox.x, 0, WORLD.width - fox.w);

  if (fox.biteTimer <= 0) {
    for (const p of players.values()) {
      if (!p.alive) continue;
      if (overlaps(fox, p)) {
        fox.biteTimer = fox.biteCooldown;
        damagePlayer(p, fox.damage, fox.x + fox.w / 2);
        pushEvent({ kind: 'bite', id: fox.id, x: fox.x + fox.w / 2, y: fox.y });
        break;
      }
    }
  }
}

function dropPickup(x, y) {
  const id = nextId++;
  const kind = weightedPick(PICKUPS);
  const gy = groundBelow(x - PICKUP.w / 2, PICKUP.w, y);
  pickups.set(id, { id, kind, x: clamp(x - PICKUP.w / 2, 0, WORLD.width - PICKUP.w), y: gy - PICKUP.h, w: PICKUP.w, h: PICKUP.h, life: PICKUP.life });
}

function damageFox(fox, amount, shooter, source) {
  fox.hp -= amount;
  if (fox.hp <= 0) {
    foxes.delete(fox.id);
    totalKills++;
    if (shooter) {
      shooter.score += fox.score;
      shooter.kills++;
      shooter.lifeKills++;
    }
    pushEvent({ kind: 'kill', id: fox.id, x: fox.x + fox.w / 2, y: fox.y + fox.h / 2, by: shooter ? shooter.id : 0, mega: fox.mega, foxKind: fox.kind, score: fox.score, fire: source === 'fire' });
    if (Math.random() < (fox.mega ? PICKUP.megaDropChance : PICKUP.dropChance)) dropPickup(fox.x + fox.w / 2, fox.y + fox.h);
  } else {
    pushEvent({ kind: 'hit', id: fox.id, x: fox.x + fox.w / 2, y: fox.y + fox.h / 2 });
  }
}

// ---------------------------------------------------------------------------
// Bullets, clashes and fire
// ---------------------------------------------------------------------------
function spawnFire(x, y) {
  const id = nextId++;
  const gy = groundBelow(x - FIRE.radius, FIRE.radius * 2, y);
  fires.set(id, { id, x, y: gy, life: FIRE.life, maxLife: FIRE.life });
  pushEvent({ kind: 'clash', x, y, fireY: gy });
}

function updateBullets(dt) {
  const list = [...bullets.values()];
  // Bullet vs bullet: opposite directions, different owners
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!bullets.has(a.id)) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!bullets.has(b.id) || a.owner === b.owner || Math.sign(a.vx) === Math.sign(b.vx)) continue;
      const ax = { x: a.x - 6, y: a.y - 6, w: a.w + 12, h: a.h + 12 };
      if (overlaps(ax, b)) {
        bullets.delete(a.id);
        bullets.delete(b.id);
        spawnFire((a.x + b.x) / 2, (a.y + b.y) / 2);
        break;
      }
    }
  }
  for (const b of bullets.values()) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || b.x + b.w < 0 || b.x > WORLD.width || b.y > WORLD.groundY) {
      bullets.delete(b.id);
      continue;
    }
    let hit = false;
    for (const fox of foxes.values()) {
      if (fox.dug) continue;
      if (overlaps(b, fox)) {
        bullets.delete(b.id);
        damageFox(fox, b.damage, players.get(b.owner));
        hit = true;
        break;
      }
    }
    if (hit) continue;
    // Friendly fire
    for (const p of players.values()) {
      if (!p.alive || p.id === b.owner) continue;
      if (overlaps(b, p)) {
        bullets.delete(b.id);
        damagePlayer(p, PLAYER.friendlyFire, b.x, { kind: 'player', id: b.owner });
        pushEvent({ kind: 'ff', by: b.owner, victim: p.id, x: b.x, y: b.y });
        break;
      }
    }
  }
}

function updateFires(dt) {
  for (const f of fires.values()) {
    f.life -= dt;
    if (f.life <= 0) {
      fires.delete(f.id);
      continue;
    }
    const box = { x: f.x - FIRE.radius, y: f.y - FIRE.height, w: FIRE.radius * 2, h: FIRE.height };
    for (const p of players.values()) {
      if (!p.alive || !overlaps(box, p)) continue;
      p.fireTick -= dt;
      if (p.fireTick <= 0) {
        p.fireTick = FIRE.tick;
        p.invulnTimer = 0;
        damagePlayer(p, FIRE.playerDamage, f.x, { kind: 'fire' });
      }
    }
    for (const fox of foxes.values()) {
      if (fox.dug || !overlaps(box, fox)) continue;
      fox.fireTick -= dt;
      if (fox.fireTick <= 0) {
        fox.fireTick = FIRE.tick;
        damageFox(fox, FIRE.foxDamage, null, 'fire');
      }
    }
  }
}

function updatePickups(dt) {
  for (const pk of pickups.values()) {
    pk.life -= dt;
    if (pk.life <= 0) pickups.delete(pk.id);
  }
  pickupTimer -= dt;
  if (pickupTimer <= 0) {
    pickupTimer = rand(PICKUP.every[0], PICKUP.every[1]);
    if (pickups.size < PICKUP.max) {
      const p = PLATFORMS[Math.floor(Math.random() * PLATFORMS.length)];
      const x = p.ground ? rand(200, WORLD.width - 200) : p.x + rand(10, p.w - 10);
      dropPickup(x, p.y);
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function tick(dt) {
  gameTime += dt;
  for (const p of players.values()) updatePlayer(p, dt);
  for (const g of players.values()) {
    if (!g.alive && !g.reviver) g.reviveProgress = Math.max(0, g.reviveProgress - dt * 1.5);
    g.reviver = 0;
  }
  for (const f of foxes.values()) updateFox(f, dt);
  updateBullets(dt);
  updateFires(dt);

  if (players.size === 0) {
    if (foxes.size > 0 || round.over || pickups.size > 0) resetWorld();
    return;
  }
  if (round.over) {
    round.restartTimer -= dt;
    if (round.restartTimer <= 0) startRound();
    return;
  }

  updatePickups(dt);

  const wave = currentWave();
  const maxFoxes = 3 + wave * 2 + players.size * 2;
  if (wave !== announcedWave) {
    announcedWave = wave;
    pushEvent({ kind: 'wave', wave, maxFoxes });
    if (wave % MEGA_EVERY === 0) {
      const count = Math.ceil(wave / (MEGA_EVERY * 2));
      for (let i = 0; i < count; i++) spawnFox('mega');
      pushEvent({ kind: 'mega', count, wave });
    }
  }
  spawnTimer -= dt;
  if (spawnTimer <= 0 && foxes.size < maxFoxes) {
    spawnFox(weightedPick(FOX_KINDS, (k, v) => v.minWave <= wave));
    spawnTimer = Math.max(0.9, 3.4 - wave * 0.3) * rand(0.7, 1.3);
  }
}

function snapshot() {
  return {
    t: 'state',
    time: Math.round(gameTime * 1000),
    wave: currentWave(),
    kills: totalKills,
    maxFoxes: 3 + currentWave() * 2 + players.size * 2,
    round: { number: round.number, over: round.over, restartIn: Math.max(0, Math.ceil(round.restartTimer)) },
    players: [...players.values()].map((p) => ({
      id: p.id, name: p.name, outfit: p.outfit,
      x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, vx: Math.round(p.vx),
      hp: p.hp, score: p.score, kills: p.kills, deaths: p.deaths,
      facing: p.facing, alive: p.alive, onGround: p.onGround, inv: p.invulnTimer > 0,
      weapon: p.weapon, weaponT: Math.ceil(p.weaponTimer), speedT: Math.ceil(p.speedTimer),
      revive: p.alive ? 0 : Math.round((p.reviveProgress / PLAYER.reviveTime) * 100) / 100,
      reviving: p.reviving,
      survived: Math.round(p.alive ? gameTime - p.spawnedAt : p.lastSurvival || 0),
      lifeKills: p.lifeKills, best: Math.round(p.bestSurvival), bestKills: p.bestLifeKills, bestScore: p.bestScore,
    })),
    foxes: [...foxes.values()].map((f) => ({
      id: f.id, kind: f.kind, mega: f.mega, w: f.w, h: f.h, dug: f.dug || false,
      x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10, vx: Math.round(f.vx),
      hp: f.hp, maxHp: f.maxHp, facing: f.facing, onGround: f.onGround,
    })),
    bullets: [...bullets.values()].map((b) => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), dir: Math.sign(b.vx) })),
    pickups: [...pickups.values()].map((pk) => ({ id: pk.id, kind: pk.kind, x: pk.x, y: pk.y, life: Math.round(pk.life) })),
    fires: [...fires.values()].map((f) => ({ id: f.id, x: Math.round(f.x), y: Math.round(f.y), k: Math.round((f.life / f.maxLife) * 100) / 100 })),
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
  for (const p of players.values()) if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg);
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
      player = createPlayer(ws, sanitizeName(msg.name), msg.outfit);
      ws.send(JSON.stringify({ t: 'welcome', id: player.id, world: WORLD, platforms: PLATFORMS, seed: worldSeed }));
      pushEvent({ kind: 'join', id: player.id, name: player.name, ghost: !player.alive });
      console.log(`+ ${player.name} (#${player.id}) joined, ${players.size} online`);
      return;
    }
    if (!player) return;

    if (msg.t === 'input') {
      const i = player.input;
      i.left = !!msg.left;
      i.right = !!msg.right;
      i.jump = !!msg.jump;
      i.shoot = !!msg.shoot;
      i.down = !!msg.down;
      i.revive = !!msg.revive;
    } else if (msg.t === 'emote') {
      const n = Number(msg.n);
      if (n >= 1 && n <= 4 && player.emoteTimer <= 0) {
        player.emoteTimer = 0.6;
        pushEvent({ kind: 'emote', id: player.id, n });
      }
    } else if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', ts: msg.ts }));
    }
  });

  ws.on('close', () => {
    if (!player) return;
    players.delete(player.id);
    pushEvent({ kind: 'leave', id: player.id, name: player.name });
    console.log(`- ${player.name} (#${player.id}) left, ${players.size} online`);
    checkRoundOver();
  });
});

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
