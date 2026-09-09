'use strict';

/*
 * Authoritative game simulation. No networking in here: the server feeds inputs in,
 * calls tick(), reads snapshots and events out. Tests drive it the same way.
 */
const Shared = require('../public/shared.js');
const { WORLD, PLAYER: PMOVE, clamp, overlaps, generateWorld, stepPhysics, groundBelow, movePlayer, moveGhost } = Shared;

const PLAYER = {
  ...PMOVE,
  shootCooldown: 0.22, invuln: 0.6,
  reviveTime: 3, reviveHp: 10, reviveReach: 36,
  friendlyFire: 10, teamKillPenalty: 20,
  disconnectGrace: 60,
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
  speed: { weight: 2, duration: 12 },
};
const PICKUP = { w: 22, h: 22, life: 25, every: [14, 22], max: 3, dropChance: 0.08, megaDropChance: 0.6 };
const FIRE = { life: 6, radius: 34, height: 44, tick: 0.5, playerDamage: 6, foxDamage: 8, foxAvoid: 120, rainDrain: 3 };
const DEN = { hp: 80, collapseTime: 12, regen: 3 };
const WEATHER = { duration: 20, gap: [35, 60], kinds: ['fog', 'rain', 'storm'], lightning: [2.5, 5.5], lightningDamage: 25 };
const MUSHROOM_BOX = (d) => ({ x: d.x - 8, y: WORLD.groundY - 26, w: 16, h: 26 });
const STUMP_HALF = 24;
const ROUND_RESTART = 12;

const rand = (a, b) => a + Math.random() * (b - a);

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

class Game {
  constructor(opts = {}) {
    this.players = new Map();
    this.foxes = new Map();
    this.bullets = new Map();
    this.pickups = new Map();
    this.fires = new Map();
    this.events = [];
    this.nextId = 1;
    this.totalKills = 0;
    this.spawnTimer = 2;
    this.pickupTimer = 10;
    this.time = 0;
    this.announcedWave = 1;
    this.round = { number: 1, over: false, restartTimer: 0 };
    this.weather = { kind: 'clear', t: 0 };
    this.weatherTimer = rand(WEATHER.gap[0], WEATHER.gap[1]);
    this.lightningTimer = 0;
    this.roundStartedAt = 0;
    this.onGameOver = opts.onGameOver || null;
    this.seedFn = opts.seedFn || (() => Math.floor(Math.random() * 2 ** 31));
    this.newWorld();
  }

  // ---------------------------------------------------------------------
  // World
  // ---------------------------------------------------------------------
  newWorld(seed) {
    this.world = generateWorld(seed !== undefined ? seed : this.seedFn());
    this.dens = this.world.dens.map((d) => ({ ...d, damage: 0, collapsed: false, timer: 0 }));
    this.broken = new Set();
  }

  get wave() {
    return 1 + Math.floor(this.totalKills / 12);
  }

  get maxFoxes() {
    return 3 + this.wave * 2 + this.connectedCount() * 2;
  }

  connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  push(ev) {
    this.events.push(ev);
  }

  takeEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  // ---------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------
  pickOutfit(wanted) {
    const used = new Set([...this.players.values()].map((p) => p.outfit));
    if (Number.isInteger(wanted) && wanted >= 0 && wanted < 8 && !used.has(wanted)) return wanted;
    for (let i = 0; i < 8; i++) if (!used.has(i)) return i;
    return this.players.size % 8;
  }

  addPlayer({ name, outfit, token }) {
    const id = this.nextId++;
    const spawn = { x: WORLD.width / 2 - PLAYER.w / 2 + rand(-80, 80), y: WORLD.groundY - PLAYER.h };
    const p = {
      id, name, token, outfit: this.pickOutfit(outfit), connected: true, disconnectedAt: 0,
      x: spawn.x, y: spawn.y, vx: 0, vy: 0, w: PLAYER.w, h: PLAYER.h,
      hp: this.round.over ? 0 : PLAYER.hp, alive: !this.round.over,
      score: 0, kills: 0, deaths: 0, teamKills: 0, roundRevives: 0,
      totalKills: 0, totalRevives: 0, totalTeamKills: 0, rounds: 0,
      facing: 1, onGround: false, climbing: false, dashT: 0, dashDir: 1, dashCd: 0, jumpHeld: false, jumpTime: 0, speedBoost: false,
      shootTimer: 0, invulnTimer: 0, fireTick: 0, emoteTimer: 0,
      weapon: 'rifle', weaponTimer: 0, speedTimer: 0,
      reviveProgress: 0, reviver: 0, reviving: 0,
      spawnedAt: this.time, lastSurvival: 0, lifeKills: 0, bestSurvival: 0, bestLifeKills: 0, bestScore: 0,
      input: { left: false, right: false, jump: false, shoot: false, down: false, revive: false, dash: 0 },
      seq: 0,
    };
    this.players.set(id, p);
    this.push({ kind: 'join', id, name, ghost: !p.alive });
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.push({ kind: 'leave', id, name: p.name });
    this.checkRoundOver();
  }

  disconnect(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = this.time;
    p.input = { left: false, right: false, jump: false, shoot: false, down: false, revive: false, dash: 0 };
    this.push({ kind: 'away', id, name: p.name });
  }

  reconnect(token) {
    for (const p of this.players.values()) {
      if (p.token === token && !p.connected) {
        p.connected = true;
        this.push({ kind: 'back', id: p.id, name: p.name });
        return p;
      }
    }
    return null;
  }

  setInput(id, msg) {
    const p = this.players.get(id);
    if (!p) return;
    const i = p.input;
    i.left = !!msg.left;
    i.right = !!msg.right;
    i.jump = !!msg.jump;
    i.shoot = !!msg.shoot;
    i.down = !!msg.down;
    i.revive = !!msg.revive;
    if (msg.dash === 1 || msg.dash === -1) i.dash = msg.dash;
    if (Number.isFinite(msg.seq)) p.seq = msg.seq;
  }

  emote(id, n) {
    const p = this.players.get(id);
    if (!p || !(n >= 1 && n <= 4) || p.emoteTimer > 0) return;
    p.emoteTimer = 0.6;
    this.push({ kind: 'emote', id, n });
  }

  respawnPlayer(p) {
    Object.assign(p, {
      alive: true, hp: PLAYER.hp, spawnedAt: this.time, lifeKills: 0, score: 0, kills: 0, teamKills: 0, roundRevives: 0,
      weapon: 'rifle', weaponTimer: 0, speedTimer: 0, speedBoost: false, reviveProgress: 0, climbing: false, dashT: 0,
      x: WORLD.width / 2 - PLAYER.w / 2 + rand(-80, 80), y: WORLD.groundY - PLAYER.h, vx: 0, vy: 0, invulnTimer: 1.5,
    });
    this.push({ kind: 'respawn', id: p.id, x: p.x, y: p.y });
  }

  fireBullets(p) {
    const weapon = WEAPONS[p.weapon] || WEAPONS.rifle;
    p.shootTimer = weapon.cooldown;
    const gunY = p.y + 22;
    const bx = p.facing > 0 ? p.x + p.w + 4 : p.x - BULLET.w - 4;
    for (let i = 0; i < weapon.pellets; i++) {
      const k = weapon.pellets === 1 ? 0 : i / (weapon.pellets - 1) - 0.5;
      const id = this.nextId++;
      this.bullets.set(id, { id, owner: p.id, x: bx, y: gunY, w: BULLET.w, h: BULLET.h, vx: p.facing * BULLET.speed, vy: k * weapon.spread * 2, damage: weapon.damage, life: BULLET.life, leafed: new Set() });
    }
    this.push({ kind: 'shoot', id: p.id, x: bx, y: gunY, dir: p.facing, weapon: p.weapon });
  }

  findGhostNear(p) {
    const reach = { x: p.x - PLAYER.reviveReach, y: p.y - PLAYER.reviveReach, w: p.w + PLAYER.reviveReach * 2, h: p.h + PLAYER.reviveReach * 2 };
    let best = null;
    for (const g of this.players.values()) {
      if (g.alive || g === p || !g.connected) continue;
      if (overlaps(reach, g) && (!best || g.reviveProgress > best.reviveProgress)) best = g;
    }
    return best;
  }

  reviveGhost(g, by) {
    Object.assign(g, { alive: true, hp: PLAYER.reviveHp, spawnedAt: this.time, lifeKills: 0, reviveProgress: 0, reviver: 0, x: by.x, y: by.y, vx: 0, vy: 0, invulnTimer: 2, weapon: 'rifle', climbing: false });
    by.score += 15;
    by.roundRevives++;
    by.totalRevives++;
    this.push({ kind: 'revived', id: g.id, by: by.id, name: g.name, byName: by.name, x: g.x + g.w / 2, y: g.y + g.h / 2 });
  }

  updatePlayer(p, dt) {
    p.reviving = 0;
    if (!p.connected && this.time - p.disconnectedAt > PLAYER.disconnectGrace) {
      this.removePlayer(p.id);
      return;
    }
    if (!p.alive) {
      moveGhost(p, p.input, dt);
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
    p.speedBoost = p.speedTimer > 0;

    const inp = p.input;
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);

    // Reviving: must stand still on the ground and must not shoot.
    if (inp.revive && dir === 0 && !inp.shoot && p.onGround && !p.climbing) {
      const ghost = this.findGhostNear(p);
      if (ghost) {
        p.reviving = ghost.id;
        ghost.reviver = p.id;
        ghost.reviveProgress += dt;
        if (ghost.reviveProgress >= PLAYER.reviveTime) this.reviveGhost(ghost, p);
      }
    }

    const wasDashing = p.dashT > 0;
    const happened = movePlayer(p, inp, dt, this.world);
    inp.dash = 0;
    for (const h of happened) {
      if (h === 'jump') this.push({ kind: 'jump', id: p.id, x: p.x + p.w / 2, y: p.y + p.h });
      if (h === 'dash') {
        p.invulnTimer = Math.max(p.invulnTimer, PLAYER.dashTime + 0.1);
        this.push({ kind: 'dash', id: p.id, x: p.x + p.w / 2, y: p.y + p.h / 2, dir: p.dashDir });
      }
      if (h === 'grab') this.push({ kind: 'grab', id: p.id, x: p.x + p.w / 2, y: p.y + p.h });
    }
    if (wasDashing && p.dashT <= 0) p.invulnTimer = Math.min(p.invulnTimer, 0.1);

    if (inp.shoot && p.shootTimer <= 0 && !p.reviving && p.dashT <= 0) this.fireBullets(p);

    for (const pk of this.pickups.values()) {
      if (overlaps(p, pk)) {
        this.pickups.delete(pk.id);
        this.applyPickup(p, pk);
      }
    }
  }

  applyPickup(p, pk) {
    if (pk.kind === 'medkit') p.hp = Math.min(PLAYER.hp, p.hp + 40);
    else if (pk.kind === 'speed') p.speedTimer = PICKUPS.speed.duration;
    else {
      p.weapon = pk.kind;
      p.weaponTimer = WEAPONS[pk.kind].duration;
    }
    this.push({ kind: 'pickup', id: p.id, item: pk.kind, x: pk.x + pk.w / 2, y: pk.y + pk.h / 2 });
  }

  damagePlayer(p, amount, fromX, source) {
    if (!p.alive || p.invulnTimer > 0) return false;
    p.hp -= amount;
    p.invulnTimer = PLAYER.invuln;
    const pushDir = p.x + p.w / 2 < fromX ? -1 : 1;
    p.vx = pushDir * 200;
    p.vy = Math.min(p.vy, -260);
    p.climbing = false;
    this.push({ kind: 'hurt', id: p.id, x: p.x + p.w / 2, y: p.y + p.h / 2, source: source ? source.kind : 'fox' });

    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      p.deaths++;
      p.lastSurvival = this.time - p.spawnedAt;
      p.bestSurvival = Math.max(p.bestSurvival, p.lastSurvival);
      p.bestLifeKills = Math.max(p.bestLifeKills, p.lifeKills);
      p.bestScore = Math.max(p.bestScore, p.score);
      p.reviveProgress = 0;
      p.vy = -120;
      const ev = { kind: 'death', id: p.id, name: p.name, x: p.x + p.w / 2, y: p.y + p.h / 2 };
      if (source && source.kind === 'player') {
        const killer = this.players.get(source.id);
        if (killer) {
          killer.score = Math.max(0, killer.score - PLAYER.teamKillPenalty);
          killer.teamKills++;
          killer.totalTeamKills++;
          ev.by = killer.id;
          ev.byName = killer.name;
        }
      } else if (source && source.kind === 'fire') ev.fire = true;
      else if (source && source.kind === 'lightning') ev.lightning = true;
      this.push(ev);
      this.checkRoundOver();
    }
    return true;
  }

  // ---------------------------------------------------------------------
  // Rounds, ranking, badges
  // ---------------------------------------------------------------------
  ranking() {
    const list = [...this.players.values()];
    const sorted = list.sort((a, b) => b.score - a.score || b.lastSurvival - a.lastSurvival);
    const badges = new Map();
    const award = (label, pick) => {
      let best = null;
      for (const p of list) {
        const v = pick(p);
        if (v > 0 && (!best || v > pick(best))) best = p;
      }
      if (best) badges.set(best.id, [...(badges.get(best.id) || []), label]);
    };
    award('Nejlepší střelec', (p) => p.kills);
    award('Zachránce', (p) => p.roundRevives);
    award('Přežil nejdéle', (p) => (p.alive ? this.time - p.spawnedAt : p.lastSurvival));
    return sorted.map((p) => ({
      id: p.id, name: p.name, outfit: p.outfit, score: p.score, kills: p.kills, survived: Math.round(p.alive ? this.time - p.spawnedAt : p.lastSurvival),
      badges: badges.get(p.id) || [],
      totalKills: p.totalKills, totalRevives: p.totalRevives, totalTeamKills: p.totalTeamKills, rounds: p.rounds + 1,
    }));
  }

  checkRoundOver() {
    if (this.round.over || this.players.size === 0) return;
    for (const p of this.players.values()) if (p.alive) return;
    this.round.over = true;
    this.round.restartTimer = ROUND_RESTART;
    const summary = { wave: this.wave, kills: this.totalKills, ranking: this.ranking(), round: this.round.number, restartIn: ROUND_RESTART };
    for (const p of this.players.values()) p.rounds++;
    this.push({ kind: 'gameover', ...summary });
    if (this.onGameOver) this.onGameOver(summary);
  }

  clearWorld() {
    this.foxes.clear();
    this.bullets.clear();
    this.pickups.clear();
    this.fires.clear();
    this.totalKills = 0;
    this.announcedWave = 1;
    this.spawnTimer = 3;
    this.pickupTimer = 10;
    this.weather = { kind: 'clear', t: 0 };
    this.weatherTimer = rand(WEATHER.gap[0], WEATHER.gap[1]);
    this.roundStartedAt = this.time;
    this.newWorld();
  }

  startRound() {
    this.round.number++;
    this.round.over = false;
    this.clearWorld();
    for (const p of this.players.values()) this.respawnPlayer(p);
    this.push({ kind: 'newround', number: this.round.number, world: this.world });
  }

  resetWorld() {
    this.clearWorld();
    this.round.over = false;
    this.round.restartTimer = 0;
  }

  // ---------------------------------------------------------------------
  // Foxes and dens
  // ---------------------------------------------------------------------
  openDens() {
    return this.dens.filter((d) => !d.collapsed);
  }

  spawnFox(kind) {
    const dens = this.openDens();
    if (dens.length === 0) return null;
    const den = dens[Math.floor(Math.random() * dens.length)];
    const wave = this.wave;
    const K = FOX_KINDS[kind];
    const id = this.nextId++;
    const hp = K.hp + Math.floor(wave / 2) * K.hpPerWave;
    const fox = {
      id, kind, mega: kind === 'mega',
      x: den.x + den.w / 2 - K.w / 2, y: WORLD.groundY - K.h, vx: 0, vy: 0, w: K.w, h: K.h,
      hp, maxHp: hp, speed: rand(K.speed[0], K.speed[1]) + wave * K.speedPerWave,
      damage: K.damage, jump: K.jump, biteCooldown: K.bite, score: K.score,
      facing: -den.side, onGround: false,
      biteTimer: rand(0.3, 0.8), jumpTimer: rand(0.3, 1.2), wanderDir: -den.side, wanderTimer: 0, fireTick: 0,
      dug: kind === 'digger', digTimer: kind === 'digger' ? 0 : rand(3, 6), stun: 0,
    };
    this.foxes.set(id, fox);
    this.push({ kind: 'foxspawn', id, den: den.id, x: fox.x + fox.w / 2, y: fox.y + fox.h, foxKind: kind });
    return fox;
  }

  nearestAlivePlayer(fox) {
    let best = null;
    let bestDist = Infinity;
    for (const p of this.players.values()) {
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

  fireAhead(fox) {
    const cx = fox.x + fox.w / 2;
    const bottom = fox.y + fox.h;
    for (const f of this.fires.values()) {
      const dx = f.x - cx;
      if (Math.abs(dx) < FIRE.foxAvoid && Math.abs(f.y - bottom) < 70 && Math.sign(dx) === Math.sign(fox.vx || fox.facing)) return f;
    }
    return null;
  }

  stumpCover(p) {
    const cx = p.x + p.w / 2;
    return this.world.decor.find((d) => d.kind === 'stump' && Math.abs(d.x - cx) < STUMP_HALF && p.y + p.h >= WORLD.groundY - 2);
  }

  updateFox(fox, dt) {
    fox.biteTimer = Math.max(0, fox.biteTimer - dt);
    fox.jumpTimer = Math.max(0, fox.jumpTimer - dt);
    if (fox.stun > 0) {
      fox.stun -= dt;
      fox.vx = 0;
      stepPhysics(fox, dt, this.world.platforms);
      return;
    }
    const target = this.nearestAlivePlayer(fox);
    const fcx = fox.x + fox.w / 2;

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
            const cover = this.stumpCover(target);
            fox.dug = false;
            fox.digTimer = rand(4, 7);
            fox.onGround = false;
            if (cover) {
              // The hunter stands behind a stump: the digger surfaces beside it, dazed.
              fox.x = clamp(cover.x + (fox.facing > 0 ? -STUMP_HALF - fox.w : STUMP_HALF), 0, WORLD.width - fox.w);
              fox.vy = -fox.jump * 0.5;
              fox.stun = 1.6;
              fox.biteTimer = 1.8;
              this.push({ kind: 'emerge', id: fox.id, x: fox.x + fox.w / 2, y: fox.y + fox.h, blocked: true, by: target.id });
            } else {
              fox.vy = -fox.jump;
              fox.biteTimer = 0.15;
              this.push({ kind: 'emerge', id: fox.id, x: fcx, y: fox.y + fox.h });
            }
          }
        } else fox.vx = 0;
        return;
      }
      fox.digTimer -= dt;
      if (fox.digTimer <= 0 && fox.onGround && fox.y + fox.h >= WORLD.groundY - 1) {
        fox.dug = true;
        this.push({ kind: 'dig', id: fox.id, x: fcx, y: fox.y + fox.h });
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
          this.push({ kind: 'foxjump', id: fox.id, x: fcx, y: fox.y + fox.h });
        } else if (jumpy && Math.random() < 0.5) {
          fox.vy = -fox.jump * 0.7;
          fox.vx = fox.facing * fox.speed * 1.5;
          fox.jumpTimer = rand(0.5, 1.0);
          this.push({ kind: 'foxjump', id: fox.id, x: fcx, y: fox.y + fox.h });
        } else if (Math.abs(dx) < 120 && Math.random() < 0.4) {
          fox.vy = -fox.jump * 0.55;
          fox.vx = fox.facing * fox.speed * 1.4;
          fox.jumpTimer = rand(1.0, 2.0);
          this.push({ kind: 'foxjump', id: fox.id, x: fcx, y: fox.y + fox.h });
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

    const fire = this.fireAhead(fox);
    if (fire) {
      const away = fox.x + fox.w / 2 < fire.x ? -1 : 1;
      fox.vx = away * fox.speed * 0.7;
      fox.facing = away;
    }

    stepPhysics(fox, dt, this.world.platforms);

    if (fox.biteTimer <= 0) {
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (overlaps(fox, p)) {
          fox.biteTimer = fox.biteCooldown;
          this.damagePlayer(p, fox.damage, fox.x + fox.w / 2);
          this.push({ kind: 'bite', id: fox.id, x: fox.x + fox.w / 2, y: fox.y });
          break;
        }
      }
    }
  }

  dropPickup(x, y) {
    const id = this.nextId++;
    const kind = weightedPick(PICKUPS);
    const gy = groundBelow(this.world.platforms, x - PICKUP.w / 2, PICKUP.w, y);
    this.pickups.set(id, { id, kind, x: clamp(x - PICKUP.w / 2, 0, WORLD.width - PICKUP.w), y: gy - PICKUP.h, w: PICKUP.w, h: PICKUP.h, life: PICKUP.life });
  }

  damageFox(fox, amount, shooter, source) {
    fox.hp -= amount;
    if (fox.hp <= 0) {
      this.foxes.delete(fox.id);
      this.totalKills++;
      if (shooter) {
        shooter.score += fox.score;
        shooter.kills++;
        shooter.lifeKills++;
        shooter.totalKills++;
      }
      this.push({ kind: 'kill', id: fox.id, x: fox.x + fox.w / 2, y: fox.y + fox.h / 2, by: shooter ? shooter.id : 0, mega: fox.mega, foxKind: fox.kind, score: fox.score, source });
      if (Math.random() < (fox.mega ? PICKUP.megaDropChance : PICKUP.dropChance)) this.dropPickup(fox.x + fox.w / 2, fox.y + fox.h);
    } else {
      this.push({ kind: 'hit', id: fox.id, x: fox.x + fox.w / 2, y: fox.y + fox.h / 2 });
    }
  }

  updateDens(dt) {
    for (const d of this.dens) {
      if (d.collapsed) {
        d.timer -= dt;
        if (d.timer <= 0) {
          d.collapsed = false;
          d.damage = 0;
          this.push({ kind: 'denopen', id: d.id, x: d.x + d.w / 2, y: d.y + d.h });
        }
      } else if (d.damage > 0) d.damage = Math.max(0, d.damage - DEN.regen * dt);
    }
  }

  hitDen(d, amount) {
    if (d.collapsed) return;
    d.damage += amount;
    this.push({ kind: 'denhit', id: d.id, x: d.x + d.w / 2, y: d.y + 10 });
    if (d.damage >= DEN.hp) {
      d.collapsed = true;
      d.timer = DEN.collapseTime;
      this.push({ kind: 'dencollapse', id: d.id, x: d.x + d.w / 2, y: d.y + d.h });
    }
  }

  // ---------------------------------------------------------------------
  // Bullets, clashes, fire, environment
  // ---------------------------------------------------------------------
  spawnFire(x, y) {
    const gy = groundBelow(this.world.platforms, x - FIRE.radius, FIRE.radius * 2, y);
    this.push({ kind: 'clash', x, y, fireY: gy });
    for (const f of this.fires.values()) {
      if (Math.abs(f.x - x) < FIRE.radius * 1.5 && Math.abs(f.y - gy) < 10) {
        f.life = FIRE.life;
        f.x = (f.x + x) / 2;
        return f;
      }
    }
    const id = this.nextId++;
    const fire = { id, x, y: gy, life: FIRE.life, maxLife: FIRE.life };
    this.fires.set(id, fire);
    return fire;
  }

  updateBullets(dt) {
    const list = [...this.bullets.values()];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!this.bullets.has(a.id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!this.bullets.has(b.id) || a.owner === b.owner || Math.sign(a.vx) === Math.sign(b.vx)) continue;
        const ax = { x: a.x - 6, y: a.y - 6, w: a.w + 12, h: a.h + 12 };
        if (overlaps(ax, b)) {
          this.bullets.delete(a.id);
          this.bullets.delete(b.id);
          this.spawnFire((a.x + b.x) / 2, (a.y + b.y) / 2);
          break;
        }
      }
    }
    for (const b of this.bullets.values()) {
      const prevX = b.x;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x + b.w < 0 || b.x > WORLD.width || b.y > WORLD.groundY) {
        this.bullets.delete(b.id);
        continue;
      }
      // Trees: a bullet crossing a climbable trunk shakes leaves out of its canopy.
      for (const t of this.world.trunks) {
        if (b.leafed.has(t.id)) continue;
        if ((prevX - t.x) * (b.x + b.w - t.x) <= 0 && b.y > t.top) {
          b.leafed.add(t.id);
          this.push({ kind: 'leaves', trunk: t.id, x: t.x, y: t.top });
        }
      }
      // Mushrooms burst
      let removed = false;
      for (const d of this.world.decor) {
        if (d.kind !== 'mushroom' || this.broken.has(d.id)) continue;
        if (overlaps(b, MUSHROOM_BOX(d))) {
          this.broken.add(d.id);
          this.bullets.delete(b.id);
          this.push({ kind: 'mushroom', id: d.id, x: d.x, y: WORLD.groundY - 12 });
          removed = true;
          break;
        }
      }
      if (removed) continue;
      // Dens can be collapsed by shooting them
      for (const d of this.dens) {
        if (!d.collapsed && overlaps(b, d)) {
          this.bullets.delete(b.id);
          this.hitDen(d, b.damage);
          removed = true;
          break;
        }
      }
      if (removed) continue;
      for (const fox of this.foxes.values()) {
        if (fox.dug) continue;
        if (overlaps(b, fox)) {
          this.bullets.delete(b.id);
          this.damageFox(fox, b.damage, this.players.get(b.owner));
          removed = true;
          break;
        }
      }
      if (removed) continue;
      for (const p of this.players.values()) {
        if (!p.alive || p.id === b.owner) continue;
        if (overlaps(b, p)) {
          this.bullets.delete(b.id);
          this.damagePlayer(p, PLAYER.friendlyFire, b.x, { kind: 'player', id: b.owner });
          this.push({ kind: 'ff', by: b.owner, victim: p.id, x: b.x, y: b.y });
          break;
        }
      }
    }
  }

  updateFires(dt) {
    const drain = this.weather.kind === 'rain' || this.weather.kind === 'storm' ? FIRE.rainDrain : 1;
    for (const f of this.fires.values()) {
      f.life -= dt * drain;
      if (f.life <= 0) {
        this.fires.delete(f.id);
        continue;
      }
      const box = { x: f.x - FIRE.radius, y: f.y - FIRE.height, w: FIRE.radius * 2, h: FIRE.height };
      for (const p of this.players.values()) {
        if (!p.alive || !overlaps(box, p)) continue;
        p.fireTick -= dt;
        if (p.fireTick <= 0) {
          p.fireTick = FIRE.tick;
          p.invulnTimer = 0;
          this.damagePlayer(p, FIRE.playerDamage, f.x, { kind: 'fire' });
        }
      }
      for (const fox of this.foxes.values()) {
        if (fox.dug || !overlaps(box, fox)) continue;
        fox.fireTick -= dt;
        if (fox.fireTick <= 0) {
          fox.fireTick = FIRE.tick;
          this.damageFox(fox, FIRE.foxDamage, null, 'fire');
        }
      }
    }
  }

  updatePickups(dt) {
    for (const pk of this.pickups.values()) {
      pk.life -= dt;
      if (pk.life <= 0) this.pickups.delete(pk.id);
    }
    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0) {
      this.pickupTimer = rand(PICKUP.every[0], PICKUP.every[1]);
      if (this.pickups.size < PICKUP.max) {
        const ps = this.world.platforms;
        const p = ps[Math.floor(Math.random() * ps.length)];
        const x = p.ground ? rand(200, WORLD.width - 200) : p.x + rand(10, p.w - 10);
        this.dropPickup(x, p.y);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Night weather events
  // ---------------------------------------------------------------------
  updateWeather(dt) {
    if (this.weather.kind !== 'clear') {
      this.weather.t -= dt;
      if (this.weather.kind === 'storm') {
        this.lightningTimer -= dt;
        if (this.lightningTimer <= 0) {
          this.lightningTimer = rand(WEATHER.lightning[0], WEATHER.lightning[1]);
          this.strikeLightning();
        }
      }
      if (this.weather.t <= 0) {
        this.push({ kind: 'weather', weather: 'clear' });
        this.weather = { kind: 'clear', t: 0 };
        this.weatherTimer = rand(WEATHER.gap[0], WEATHER.gap[1]);
      }
      return;
    }
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) this.startWeather(WEATHER.kinds[Math.floor(Math.random() * WEATHER.kinds.length)]);
  }

  startWeather(kind) {
    this.weather = { kind, t: WEATHER.duration };
    this.lightningTimer = 1;
    this.push({ kind: 'weather', weather: kind, duration: WEATHER.duration });
  }

  strikeLightning() {
    // Lightning prefers a fox; otherwise it just lights up a random spot in the forest.
    const targets = [...this.foxes.values()].filter((f) => !f.dug && !f.mega);
    if (targets.length && Math.random() < 0.7) {
      const fox = targets[Math.floor(Math.random() * targets.length)];
      this.push({ kind: 'lightning', x: fox.x + fox.w / 2, y: fox.y + fox.h, hit: fox.id });
      this.damageFox(fox, WEATHER.lightningDamage, null, 'lightning');
    } else {
      this.push({ kind: 'lightning', x: rand(100, WORLD.width - 100), y: WORLD.groundY });
    }
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  tick(dt) {
    this.time += dt;
    for (const p of [...this.players.values()]) this.updatePlayer(p, dt);
    for (const g of this.players.values()) {
      if (!g.alive && !g.reviver) g.reviveProgress = Math.max(0, g.reviveProgress - dt * 1.5);
      g.reviver = 0;
    }
    for (const f of this.foxes.values()) this.updateFox(f, dt);
    this.updateBullets(dt);
    this.updateFires(dt);
    this.updateDens(dt);

    if (this.players.size === 0) {
      if (this.foxes.size > 0 || this.round.over || this.pickups.size > 0) this.resetWorld();
      return;
    }
    if (this.round.over) {
      this.round.restartTimer -= dt;
      if (this.round.restartTimer <= 0) this.startRound();
      return;
    }

    this.updatePickups(dt);
    if (this.time - this.roundStartedAt > 25) this.updateWeather(dt);

    const wave = this.wave;
    if (wave !== this.announcedWave) {
      this.announcedWave = wave;
      this.push({ kind: 'wave', wave, maxFoxes: this.maxFoxes });
      if (wave % MEGA_EVERY === 0) {
        const count = Math.ceil(wave / (MEGA_EVERY * 2));
        for (let i = 0; i < count; i++) this.spawnFox('mega');
        this.push({ kind: 'mega', count, wave });
      }
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.foxes.size < this.maxFoxes) {
      if (this.spawnFox(weightedPick(FOX_KINDS, (k, v) => v.minWave <= wave))) {
        this.spawnTimer = Math.max(0.9, 3.4 - wave * 0.3) * rand(0.7, 1.3);
      } else this.spawnTimer = 0.5;
    }
  }

  snapshot() {
    return {
      t: 'state',
      time: Math.round(this.time * 1000),
      wave: this.wave,
      kills: this.totalKills,
      maxFoxes: this.maxFoxes,
      round: { number: this.round.number, over: this.round.over, restartIn: Math.max(0, Math.ceil(this.round.restartTimer)) },
      weather: { kind: this.weather.kind, t: Math.ceil(this.weather.t) },
      dens: this.dens.map((d) => ({ id: d.id, collapsed: d.collapsed, dmg: Math.round((d.damage / DEN.hp) * 100) / 100, t: Math.ceil(d.timer) })),
      broken: [...this.broken],
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, outfit: p.outfit, on: p.connected,
        x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, vx: Math.round(p.vx), vy: Math.round(p.vy),
        hp: p.hp, score: p.score, kills: p.kills, deaths: p.deaths,
        facing: p.facing, alive: p.alive, onGround: p.onGround, climbing: p.climbing, dash: p.dashT > 0, inv: p.invulnTimer > 0,
        dashCd: Math.round(p.dashCd * 100) / 100, jumpHeld: p.jumpHeld, jumpTime: Math.round(p.jumpTime * 100) / 100, dashDir: p.dashDir,
        seq: p.seq,
        weapon: p.weapon, weaponT: Math.ceil(p.weaponTimer), speedT: Math.ceil(p.speedTimer),
        revive: p.alive ? 0 : Math.round((p.reviveProgress / PLAYER.reviveTime) * 100) / 100,
        reviving: p.reviving,
        survived: Math.round(p.alive ? this.time - p.spawnedAt : p.lastSurvival || 0),
        lifeKills: p.lifeKills, best: Math.round(p.bestSurvival), bestKills: p.bestLifeKills, bestScore: p.bestScore,
        totalKills: p.totalKills, totalRevives: p.totalRevives, totalTeamKills: p.totalTeamKills,
      })),
      foxes: [...this.foxes.values()].map((f) => ({
        id: f.id, kind: f.kind, mega: f.mega, w: f.w, h: f.h, dug: f.dug || false, stun: f.stun > 0,
        x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10, vx: Math.round(f.vx),
        hp: f.hp, maxHp: f.maxHp, facing: f.facing, onGround: f.onGround,
      })),
      bullets: [...this.bullets.values()].map((b) => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), dir: Math.sign(b.vx) })),
      pickups: [...this.pickups.values()].map((pk) => ({ id: pk.id, kind: pk.kind, x: pk.x, y: pk.y, life: Math.round(pk.life) })),
      fires: [...this.fires.values()].map((f) => ({ id: f.id, x: Math.round(f.x), y: Math.round(f.y), k: Math.round((f.life / f.maxLife) * 100) / 100 })),
      events: this.events,
    };
  }
}

module.exports = { Game, PLAYER, FOX_KINDS, WEAPONS, PICKUPS, FIRE, DEN, WEATHER, BULLET, ROUND_RESTART };
