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

// Bullets leave the muzzle at rifle height and are drawn there; their hitbox reaches 22 px
// below that, so a shot fired from the hip still catches the small fast fox on flat ground.
const BULLET = { speed: 1000, life: 1.1, w: 10, h: 22 };
const WEAPONS = {
  rifle:   { cooldown: 0.22, damage: 10, pellets: 1, spread: 0 },
  shotgun: { cooldown: 0.28, damage: 9, pellets: 3, spread: 140, duration: 12 },
  rapid:   { cooldown: 0.08, damage: 7, pellets: 1, spread: 0, duration: 10 },
};
// Pickups. `held` items go to the hunter's hand and are placed/used with the use key.
const PICKUPS = {
  medkit: { weight: 4 },
  shotgun: { weight: 3 },
  rapid: { weight: 3 },
  speed: { weight: 2, duration: 12 },
  stink: { weight: 2, duration: 10 },
  incendiary: { weight: 2, duration: 10 },
  double: { weight: 2, duration: 15 },
  disguise: { weight: 2, duration: 8 },
  trap: { weight: 3, held: true },
  horn: { weight: 2, held: true },
  seed: { weight: 2, held: true },
  lantern: { weight: 2, held: true },
  bait: { weight: 3, held: true },
  curse: { weight: 2 },
};
const TRAP = { w: 30, h: 8, arm: 0.5, life: 40, hold: 3 };
const LURES = { bait: { life: 8, radius: 500, w: 24, h: 10 }, lantern: { life: 20, radius: 400, w: 16, h: 18 } };
const HORN = { duration: 4 };
const SEED = { grow: 5, minTrunkGap: 160, minDenGap: 160, height: [300, 400] };
const TREE_BURN = { time: 6, igniteDist: 60, damage: 4 };
const STINK = { radius: 190, vertical: 90, fleeTime: 2.5 };
const PICKUP_LOOKS = Object.keys(PICKUPS).filter((k) => k !== 'curse');
const PICKUP = { w: 22, h: 22, life: 25, every: [14, 22], max: 3, dropChance: 0.08, megaDropChance: 0.6 };
const FIRE = { life: 6, radius: 34, height: 44, tick: 0.5, playerDamage: 6, foxDamage: 8, foxAvoid: 120, rainDrain: 3 };
const DEN = { hp: 80, collapseTime: 12, regen: 3 };
const WEATHER = { duration: 20, gap: [35, 60], kinds: ['fog', 'rain', 'storm'], lightning: [2.5, 5.5], lightningDamage: 25 };
const MUSHROOM_BOX = (d) => ({ x: d.x - 8, y: WORLD.groundY - 26, w: 16, h: 26 });
const STUMP_HALF = 24;
const FOX_AI = { giveUpAfter: 2.5, roamMove: [1.5, 3.5], roamPause: [0.8, 2.0] };
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
    this.traps = new Map();
    this.lures = new Map();
    this.saplings = new Map();
    this.burning = new Map(); // trunk id -> { t, x, top }
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
      weapon: 'rifle', weaponTimer: 0, speedTimer: 0, stinkTimer: 0, incTimer: 0, doubleTimer: 0, disguiseTimer: 0, item: null,
      reviveProgress: 0, reviver: 0, reviving: 0,
      spawnedAt: this.time, lastSurvival: 0, lifeKills: 0, bestSurvival: 0, bestLifeKills: 0, bestScore: 0,
      input: { left: false, right: false, jump: false, shoot: false, down: false, revive: false, dash: 0, use: false },
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
    p.input = { left: false, right: false, jump: false, shoot: false, down: false, revive: false, dash: 0, use: false };
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
    if (msg.use) i.use = true;
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
      weapon: 'rifle', weaponTimer: 0, speedTimer: 0, stinkTimer: 0, incTimer: 0, doubleTimer: 0, disguiseTimer: 0, item: null, speedBoost: false, reviveProgress: 0, climbing: false, dashT: 0,
      x: WORLD.width / 2 - PLAYER.w / 2 + rand(-80, 80), y: WORLD.groundY - PLAYER.h, vx: 0, vy: 0, invulnTimer: 1.5,
    });
    this.push({ kind: 'respawn', id: p.id, x: p.x, y: p.y });
  }

  fireBullets(p) {
    const weapon = WEAPONS[p.weapon] || WEAPONS.rifle;
    p.shootTimer = weapon.cooldown;
    const gunY = p.y + 19;
    const bx = p.facing > 0 ? p.x + p.w + 4 : p.x - BULLET.w - 4;
    for (let i = 0; i < weapon.pellets; i++) {
      const k = weapon.pellets === 1 ? 0 : i / (weapon.pellets - 1) - 0.5;
      const id = this.nextId++;
      this.bullets.set(id, { id, owner: p.id, x: bx, y: gunY, w: BULLET.w, h: BULLET.h, vx: p.facing * BULLET.speed, vy: k * weapon.spread * 2, damage: weapon.damage, life: BULLET.life, leafed: new Set(), fire: p.incTimer > 0 });
    }
    this.push({ kind: 'shoot', id: p.id, x: bx, y: gunY, dir: p.facing, weapon: p.weapon, fire: p.incTimer > 0 });
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
    p.stinkTimer = Math.max(0, p.stinkTimer - dt);
    p.incTimer = Math.max(0, p.incTimer - dt);
    p.doubleTimer = Math.max(0, p.doubleTimer - dt);
    p.disguiseTimer = Math.max(0, p.disguiseTimer - dt);
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
      if (h === 'drop') this.push({ kind: 'drop', id: p.id, x: p.x + p.w / 2, y: p.y });
    }
    if (wasDashing && p.dashT <= 0) p.invulnTimer = Math.min(p.invulnTimer, 0.1);

    // Both hands are busy on the trunk: no shooting while climbing. A disguised fox does not shoot either.
    if (inp.shoot && p.shootTimer <= 0 && !p.reviving && p.dashT <= 0 && !p.climbing && p.disguiseTimer <= 0) this.fireBullets(p);
    if (inp.use) {
      inp.use = false;
      if (p.item && !p.climbing && p.dashT <= 0) this.useItem(p);
    }

    for (const pk of this.pickups.values()) {
      if (overlaps(p, pk)) {
        this.pickups.delete(pk.id);
        this.applyPickup(p, pk);
      }
    }
  }

  applyPickup(p, pk) {
    const k = pk.kind;
    if (k === 'medkit') p.hp = Math.min(PLAYER.hp, p.hp + 40);
    else if (k === 'speed') p.speedTimer = PICKUPS.speed.duration;
    else if (k === 'stink') p.stinkTimer = PICKUPS.stink.duration;
    else if (k === 'incendiary') p.incTimer = PICKUPS.incendiary.duration;
    else if (k === 'double') p.doubleTimer = PICKUPS.double.duration;
    else if (k === 'disguise') p.disguiseTimer = PICKUPS.disguise.duration;
    else if (k === 'curse') {
      // A cursed crate: a digger erupts right under the hunter's feet.
      const fox = this.spawnFox('digger');
      if (fox) {
        fox.dug = false;
        fox.x = clamp(p.x + p.w / 2 - fox.w / 2, 0, WORLD.width - fox.w);
        fox.y = Math.min(WORLD.groundY - fox.h, p.y + p.h - fox.h + 10);
        fox.vy = -fox.jump;
        fox.onGround = false;
        fox.biteTimer = 0.3;
        fox.digTimer = rand(5, 8);
      }
      this.push({ kind: 'curse', id: p.id, x: p.x + p.w / 2, y: p.y + p.h });
    } else if (PICKUPS[k] && PICKUPS[k].held) p.item = k;
    else if (WEAPONS[k]) {
      p.weapon = k;
      p.weaponTimer = WEAPONS[k].duration;
    }
    this.push({ kind: 'pickup', id: p.id, item: k, x: pk.x + pk.w / 2, y: pk.y + pk.h / 2 });
  }

  useItem(p) {
    const item = p.item;
    const cx = p.x + p.w / 2;
    const gy = groundBelow(this.world.platforms, p.x, p.w, p.y + p.h);
    if (item === 'trap') {
      const id = this.nextId++;
      this.traps.set(id, { id, owner: p.id, x: cx - TRAP.w / 2, y: gy - TRAP.h, w: TRAP.w, h: TRAP.h, arm: TRAP.arm, life: TRAP.life });
      this.push({ kind: 'place', id: p.id, item, x: cx, y: gy });
    } else if (item === 'bait' || item === 'lantern') {
      const L = LURES[item];
      const id = this.nextId++;
      this.lures.set(id, { id, kind: item, owner: p.id, x: cx - L.w / 2, y: gy - L.h, w: L.w, h: L.h, life: L.life, radius: L.radius });
      this.push({ kind: 'place', id: p.id, item, x: cx, y: gy });
    } else if (item === 'horn') {
      for (const fox of this.foxes.values()) fox.lure = { pid: p.id, t: HORN.duration };
      this.push({ kind: 'horn', id: p.id, x: cx, y: p.y + 20 });
    } else if (item === 'seed') {
      const tooClose = this.world.trunks.some((t) => Math.abs(t.x - cx) < SEED.minTrunkGap) || this.world.dens.some((d) => Math.abs(d.x + d.w / 2 - cx) < SEED.minDenGap) || cx < 120 || cx > WORLD.width - 120 || gy !== WORLD.groundY;
      if (tooClose) {
        this.push({ kind: 'noplant', id: p.id, x: cx, y: p.y });
        return;
      }
      const id = this.nextId++;
      this.saplings.set(id, { id, owner: p.id, x: Math.round(cx), t: SEED.grow, max: SEED.grow });
      this.push({ kind: 'seed', id, x: cx, y: gy });
    }
    p.item = null;
  }

  growTree(sap) {
    const id = 100 + sap.id;
    const top = Math.round(WORLD.groundY - rand(SEED.height[0], SEED.height[1]));
    const trunk = { id, x: sap.x, top, bottom: WORLD.groundY, planted: true };
    const canopy = { x: sap.x - 70, y: top, w: 140, h: 18, canopy: true, trunk: id };
    const side = Math.random() < 0.5 ? -1 : 1;
    const branch = { x: side < 0 ? sap.x - 14 - 95 : sap.x + 14, y: Math.round(top + 120 + rand(0, 60)), w: 95, h: 14, branch: true, trunk: id };
    this.world.trunks.push(trunk);
    this.world.platforms.push(canopy, branch);
    this.push({ kind: 'treegrown', trunk, platforms: [canopy, branch], x: sap.x, y: top });
  }

  burnTrunkDown(id) {
    const idx = this.world.trunks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const trunk = this.world.trunks[idx];
    this.world.trunks.splice(idx, 1);
    this.world.platforms = this.world.platforms.filter((pl) => pl.trunk !== id);
    for (const p of this.players.values()) if (p.climbing && Math.abs(p.x + p.w / 2 - trunk.x) < 20) p.climbing = false;
    this.burning.delete(id);
    this.push({ kind: 'treeburnt', id, x: trunk.x, y: trunk.top });
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
    this.traps.clear();
    this.lures.clear();
    this.saplings.clear();
    this.burning.clear();
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
      bestDist: Infinity, stuckT: 0, roam: null, fleeing: false, fleeT: 0, fleeDir: 1,
    };
    this.foxes.set(id, fox);
    this.push({ kind: 'foxspawn', id, den: den.id, x: fox.x + fox.w / 2, y: fox.y + fox.h, foxKind: kind });
    return fox;
  }

  pickTarget(fox) {
    // Horn: everyone rushes the hunter who blew it.
    if (fox.lure && fox.lure.t > 0) {
      const lp = this.players.get(fox.lure.pid);
      if (lp && lp.alive) return lp;
    }
    // Bait and lanterns: the closest one within its radius beats any hunter.
    let lure = null;
    let lureD = Infinity;
    const fcx = fox.x + fox.w / 2;
    for (const l of this.lures.values()) {
      const d = Math.abs(l.x + l.w / 2 - fcx);
      if (d < l.radius && d < lureD) {
        lureD = d;
        lure = l;
      }
    }
    if (lure) return { x: lure.x, y: lure.y, w: lure.w, h: lure.h, alive: true, isLure: lure };
    return this.nearestAlivePlayer(fox);
  }

  nearestAlivePlayer(fox) {
    let best = null;
    let bestDist = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive || p.disguiseTimer > 0) continue;
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

  nearestStinker(fox) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive || p.stinkTimer <= 0) continue;
      const dx = Math.abs(p.x + p.w / 2 - (fox.x + fox.w / 2));
      const dy = Math.abs(p.y + p.h - (fox.y + fox.h));
      if (dx < STINK.radius && dy < STINK.vertical && dx < bestD) {
        bestD = dx;
        best = p;
      }
    }
    return best;
  }

  stumpCover(p) {
    const cx = p.x + p.w / 2;
    return this.world.decor.find((d) => d.kind === 'stump' && Math.abs(d.x - cx) < STUMP_HALF && p.y + p.h >= WORLD.groundY - 2);
  }

  updateFox(fox, dt) {
    fox.biteTimer = Math.max(0, fox.biteTimer - dt);
    fox.jumpTimer = Math.max(0, fox.jumpTimer - dt);
    if (fox.lure) {
      fox.lure.t -= dt;
      if (fox.lure.t <= 0) fox.lure = null;
    }
    if (fox.trapped > 0) {
      // Caught in a trap: stuck in place, jaws busy with the iron.
      fox.trapped -= dt;
      fox.vx = 0;
      fox.biteTimer = Math.max(fox.biteTimer, 0.3);
      stepPhysics(fox, dt, this.world.platforms);
      return;
    }
    if (fox.stun > 0) {
      fox.stun -= dt;
      fox.vx = 0;
      stepPhysics(fox, dt, this.world.platforms);
      return;
    }
    const target = this.pickTarget(fox);
    const fcx = fox.x + fox.w / 2;

    // Stink: a reeking hunter drives nearby foxes the other way (mega foxes have no nose for it).
    const stinker = fox.mega ? null : this.nearestStinker(fox);
    if (stinker) {
      if (!fox.fleeing) this.push({ kind: 'foxflee', id: fox.id, x: fcx, y: fox.y });
      fox.fleeing = true;
      fox.fleeT = STINK.fleeTime;
      fox.fleeDir = fcx < stinker.x + stinker.w / 2 ? -1 : 1;
    }
    if (fox.fleeing) {
      fox.fleeT -= dt;
      fox.facing = fox.fleeDir;
      fox.vx = fox.fleeDir * fox.speed * 0.9;
      if ((fox.x <= 2 && fox.vx < 0) || (fox.x + fox.w >= WORLD.width - 2 && fox.vx > 0)) fox.fleeDir = -fox.fleeDir;
      fox.roam = null;
      fox.bestDist = Infinity;
      fox.stuckT = 0;
      if (fox.fleeT <= 0) {
        // Far enough: sniff around for a bit before daring to come back
        fox.fleeing = false;
        fox.roam = { steps: [{ dir: 0, t: rand(1, 2) }, { dir: fox.fleeDir, t: rand(0.5, 1.5) }] };
      }
      if (fox.dug) {
        fox.x = clamp(fox.x + fox.vx * dt, 0, WORLD.width - fox.w);
        return;
      }
      stepPhysics(fox, dt, this.world.platforms);
      return;
    }

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

    // Frustration: a fox that cannot get closer to its target for a while gives up,
    // roams somewhere else (with the odd pause) and only then comes back to harass.
    if (target && !fox.roam && !target.isLure) {
      if (fox.targetId !== target.id) {
        fox.targetId = target.id;
        fox.bestDist = Infinity;
        fox.stuckT = 0;
      }
      const dist = Math.abs(target.x + target.w / 2 - fcx) + Math.max(0, (fox.y + fox.h) - (target.y + target.h)) * 0.5;
      if (dist < fox.bestDist - 6) {
        fox.bestDist = dist;
        fox.stuckT = 0;
      } else fox.stuckT += dt;
      if (fox.stuckT > FOX_AI.giveUpAfter && !fox.mega) {
        fox.roam = this.planRoam(fox, target);
        this.push({ kind: 'foxgiveup', id: fox.id, x: fcx, y: fox.y });
      }
    }
    if (fox.roam) {
      const step = fox.roam.steps[0];
      step.t -= dt;
      if (step.t <= 0) {
        fox.roam.steps.shift();
        if (!fox.roam.steps.length) {
          fox.roam = null;
          fox.bestDist = Infinity;
          fox.stuckT = 0;
        }
      }
      if (fox.roam) {
        const cur = fox.roam.steps[0];
        fox.vx = cur.dir * fox.speed * (cur.dir ? 0.6 : 0);
        if (cur.dir) fox.facing = cur.dir;
        // Bounce off the edges of the world
        if ((fox.x <= 2 && fox.vx < 0) || (fox.x + fox.w >= WORLD.width - 2 && fox.vx > 0)) cur.dir = -cur.dir;
        // If the target came down to our level, drop the sulking and chase again
        if (target && Math.abs(target.y + target.h - (fox.y + fox.h)) < 40 && Math.abs(target.x - fox.x) < 300) {
          fox.roam = null;
          fox.bestDist = Infinity;
          fox.stuckT = 0;
        }
      }
    }

    if (target && !fox.roam) {
      const tcx = target.x + target.w / 2;
      const dx = tcx - fcx;
      const dy = target.y + target.h - (fox.y + fox.h);
      if (target.isLure && Math.abs(dx) < 34) {
        // At the bait: a scuffle, foxes jostle and snap at each other
        fox.vx = Math.sin(this.time * 9 + fox.id) * fox.speed * 0.5;
        fox.facing = Math.sin(this.time * 4 + fox.id * 2) > 0 ? 1 : -1;
        fox.bestDist = Infinity;
        fox.stuckT = 0;
        stepPhysics(fox, dt, this.world.platforms);
        return;
      }
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
    } else if (!fox.roam) {
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
        if (!p.alive || p.disguiseTimer > 0) continue;
        if (overlaps(fox, p)) {
          fox.biteTimer = fox.biteCooldown;
          this.damagePlayer(p, fox.damage, fox.x + fox.w / 2);
          this.push({ kind: 'bite', id: fox.id, x: fox.x + fox.w / 2, y: fox.y });
          break;
        }
      }
    }
  }

  planRoam(fox, target) {
    // Walk away from the target for a bit, stop and sniff around, maybe walk some more.
    const away = target ? (fox.x + fox.w / 2 < target.x + target.w / 2 ? -1 : 1) : Math.random() < 0.5 ? -1 : 1;
    const dir = Math.random() < 0.75 ? away : -away;
    const steps = [{ dir, t: rand(FOX_AI.roamMove[0], FOX_AI.roamMove[1]) }];
    if (Math.random() < 0.7) steps.push({ dir: 0, t: rand(FOX_AI.roamPause[0], FOX_AI.roamPause[1]) });
    if (Math.random() < 0.5) steps.push({ dir: Math.random() < 0.5 ? -1 : 1, t: rand(0.8, 2) });
    return { steps };
  }

  dropPickup(x, y) {
    const id = this.nextId++;
    const kind = weightedPick(PICKUPS);
    const gy = groundBelow(this.world.platforms, x - PICKUP.w / 2, PICKUP.w, y);
    // A cursed crate wears the face of an ordinary one.
    const look = kind === 'curse' ? PICKUP_LOOKS[Math.floor(Math.random() * PICKUP_LOOKS.length)] : kind;
    this.pickups.set(id, { id, kind, look, x: clamp(x - PICKUP.w / 2, 0, WORLD.width - PICKUP.w), y: gy - PICKUP.h, w: PICKUP.w, h: PICKUP.h, life: PICKUP.life });
  }

  damageFox(fox, amount, shooter, source) {
    fox.hp -= amount;
    if (fox.hp <= 0) {
      this.foxes.delete(fox.id);
      this.totalKills++;
      let score = fox.score;
      if (shooter) {
        if (shooter.doubleTimer > 0) score *= 2;
        shooter.score += score;
        shooter.kills++;
        shooter.lifeKills++;
        shooter.totalKills++;
      }
      this.push({ kind: 'kill', id: fox.id, x: fox.x + fox.w / 2, y: fox.y + fox.h / 2, by: shooter ? shooter.id : 0, mega: fox.mega, foxKind: fox.kind, score, source });
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
  spawnFire(x, y, scale = 1) {
    const gy = groundBelow(this.world.platforms, x - FIRE.radius, FIRE.radius * 2, y);
    this.push({ kind: scale >= 1 ? 'clash' : 'ignite', x, y, fireY: gy });
    const life = FIRE.life * scale;
    for (const f of this.fires.values()) {
      if (Math.abs(f.x - x) < FIRE.radius * 1.5 && Math.abs(f.y - gy) < 10) {
        f.life = Math.max(f.life, life);
        f.x = (f.x + x) / 2;
        return f;
      }
    }
    const id = this.nextId++;
    const fire = { id, x, y: gy, life, maxLife: FIRE.life };
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
      if (b.fire) b.vy += 700 * dt; // incendiary rounds arc down and set the ground alight
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.fire) {
        const gy = groundBelow(this.world.platforms, b.x, b.w, b.y);
        if (b.y + b.h >= gy) {
          this.bullets.delete(b.id);
          this.spawnFire(b.x, gy, 0.7);
          continue;
        }
      }
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
          if (b.fire) this.spawnFire(fox.x + fox.w / 2, fox.y + fox.h, 0.7);
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
      // Fire at the foot of a climbable tree sets the whole tree alight.
      for (const t of this.world.trunks) {
        if (this.burning.has(t.id)) continue;
        if (Math.abs(f.x - t.x) < TREE_BURN.igniteDist && Math.abs(f.y - t.bottom) < 20) {
          this.burning.set(t.id, { t: TREE_BURN.time, x: t.x, top: t.top });
          this.push({ kind: 'treefire', id: t.id, x: t.x, y: t.top });
        }
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

  updateBurning(dt) {
    const drain = this.weather.kind === 'rain' || this.weather.kind === 'storm' ? 2 : 1;
    for (const [id, b] of this.burning) {
      b.t -= dt * drain;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const onTree = (p.climbing && Math.abs(p.x + p.w / 2 - b.x) < 20) || this.world.platforms.some((pl) => pl.trunk === id && p.onGround && Math.abs(p.y + p.h - pl.y) < 2 && p.x + p.w > pl.x && p.x < pl.x + pl.w);
        if (!onTree) continue;
        p.fireTick -= dt;
        if (p.fireTick <= 0) {
          p.fireTick = FIRE.tick;
          p.invulnTimer = 0;
          this.damagePlayer(p, TREE_BURN.damage, b.x, { kind: 'fire' });
        }
      }
      if (b.t <= 0) this.burnTrunkDown(id);
    }
  }

  updateTrapsAndLures(dt) {
    for (const tr of this.traps.values()) {
      tr.arm = Math.max(0, tr.arm - dt);
      tr.life -= dt;
      if (tr.life <= 0) {
        this.traps.delete(tr.id);
        continue;
      }
      if (tr.arm > 0) continue;
      for (const fox of this.foxes.values()) {
        if (fox.dug || fox.trapped > 0) continue;
        if (overlaps(tr, fox)) {
          fox.trapped = TRAP.hold;
          fox.vx = 0;
          this.traps.delete(tr.id);
          this.push({ kind: 'trap', id: tr.id, fox: fox.id, x: fox.x + fox.w / 2, y: fox.y + fox.h });
          break;
        }
      }
    }
    for (const l of this.lures.values()) {
      l.life -= dt;
      if (l.life <= 0) {
        this.lures.delete(l.id);
        this.push({ kind: 'lureend', id: l.id, item: l.kind, x: l.x + l.w / 2, y: l.y + l.h });
      }
    }
    for (const sap of this.saplings.values()) {
      sap.t -= dt;
      if (sap.t <= 0) {
        this.saplings.delete(sap.id);
        this.growTree(sap);
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
    this.updateBurning(dt);
    this.updateTrapsAndLures(dt);
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
      dropT: Math.round((p.dropT || 0) * 100) / 100, dropY: p.dropY || 0,
        seq: p.seq,
        weapon: p.weapon, weaponT: Math.ceil(p.weaponTimer), speedT: Math.ceil(p.speedTimer), stinkT: Math.ceil(p.stinkTimer),
      incT: Math.ceil(p.incTimer), doubleT: Math.ceil(p.doubleTimer), disguiseT: Math.ceil(p.disguiseTimer), item: p.item,
        revive: p.alive ? 0 : Math.round((p.reviveProgress / PLAYER.reviveTime) * 100) / 100,
        reviving: p.reviving,
        survived: Math.round(p.alive ? this.time - p.spawnedAt : p.lastSurvival || 0),
        lifeKills: p.lifeKills, best: Math.round(p.bestSurvival), bestKills: p.bestLifeKills, bestScore: p.bestScore,
        totalKills: p.totalKills, totalRevives: p.totalRevives, totalTeamKills: p.totalTeamKills,
      })),
      foxes: [...this.foxes.values()].map((f) => ({
        id: f.id, kind: f.kind, mega: f.mega, w: f.w, h: f.h, dug: f.dug || false, stun: f.stun > 0,
        x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10, vx: Math.round(f.vx),
        hp: f.hp, maxHp: f.maxHp, facing: f.facing, onGround: f.onGround, roam: !!f.roam, flee: !!f.fleeing, trapped: f.trapped > 0,
      })),
      bullets: [...this.bullets.values()].map((b) => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), dir: Math.sign(b.vx), fire: b.fire || false })),
      pickups: [...this.pickups.values()].map((pk) => ({ id: pk.id, kind: pk.look || pk.kind, x: pk.x, y: pk.y, life: Math.round(pk.life) })),
      fires: [...this.fires.values()].map((f) => ({ id: f.id, x: Math.round(f.x), y: Math.round(f.y), k: Math.round((f.life / f.maxLife) * 100) / 100 })),
      traps: [...this.traps.values()].map((t) => ({ id: t.id, x: t.x, y: t.y, armed: t.arm <= 0 })),
      lures: [...this.lures.values()].map((l) => ({ id: l.id, kind: l.kind, x: l.x, y: l.y, life: Math.ceil(l.life) })),
      saplings: [...this.saplings.values()].map((sp) => ({ id: sp.id, x: sp.x, k: Math.round((1 - sp.t / sp.max) * 100) / 100 })),
      burning: [...this.burning.entries()].map(([id, b]) => ({ id, k: Math.round((b.t / TREE_BURN.time) * 100) / 100 })),
      events: this.events,
    };
  }
}

module.exports = { Game, PLAYER, FOX_KINDS, WEAPONS, PICKUPS, FIRE, DEN, WEATHER, BULLET, ROUND_RESTART, TRAP, LURES, HORN, SEED, TREE_BURN };
