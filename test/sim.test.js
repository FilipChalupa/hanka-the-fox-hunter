'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PLAYER, DEN, FIRE, TRAP, HORN, SEED: SEED_CFG, TREE_BURN, BOSS } = require('../game/sim.js');
const Shared = require('../public/shared.js');
const { WORLD, encodeDelta, applyDelta } = Shared;

const SEED = 42;

function mk() {
  const game = new Game({ seedFn: () => SEED });
  game.spawnTimer = Infinity; // no random foxes unless a test asks for them
  game.pickupTimer = Infinity;
  return game;
}

function run(game, seconds, step = 1 / 60) {
  const events = [];
  for (let t = 0; t < seconds; t += step) {
    game.tick(step);
    events.push(...game.takeEvents());
  }
  return events;
}

function place(p, x, y = WORLD.groundY - PLAYER.h) {
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  p.onGround = true;
}

const input = (o) => ({ left: false, right: false, jump: false, shoot: false, down: false, revive: false, dash: 0, ...o });

test('world generation is deterministic and platforms are reachable', () => {
  const a = Shared.generateWorld(7);
  const b = Shared.generateWorld(7);
  assert.deepEqual(a.platforms, b.platforms);
  assert.ok(a.trunks.length >= 3);
  for (const p of a.platforms) {
    if (p.ground) continue;
    assert.ok(p.w >= 90 || p.canopy || p.branch, `platform too narrow: ${JSON.stringify(p)}`);
    assert.ok(p.x >= 0 && p.x + p.w <= WORLD.width);
  }
  assert.equal(a.dens.length, 2);
});

test('a ghost is revived with 10 HP by a hunter who stands still and holds revive', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const b = game.addPlayer({ name: 'B' });
  place(a, 1500);
  place(b, 1500);
  game.damagePlayer(a, 999, 1400);
  assert.equal(a.alive, false);
  game.setInput(b.id, input({ revive: true }));
  let events = run(game, 1);
  assert.ok(a.reviveProgress > 0.8 && a.reviveProgress < 1.2, 'progress accumulates');
  // Moving interrupts the revive and progress decays
  game.setInput(b.id, input({ revive: true, right: true }));
  run(game, 0.5);
  assert.ok(a.reviveProgress < 0.9, 'progress decays while the reviver moves');
  place(b, a.x);
  game.setInput(b.id, input({ revive: true }));
  events = run(game, 3.5);
  assert.equal(a.alive, true);
  assert.equal(a.hp, PLAYER.reviveHp);
  assert.equal(b.score, 15);
  assert.equal(b.roundRevives, 1);
  assert.ok(events.some((e) => e.kind === 'revived' && e.id === a.id && e.by === b.id));
});

test('reviving is impossible while shooting', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const b = game.addPlayer({ name: 'B' });
  place(a, 1500);
  place(b, 1500);
  game.damagePlayer(a, 999, 1400);
  game.setInput(b.id, input({ revive: true, shoot: true }));
  run(game, 3.5);
  assert.equal(a.alive, false);
  assert.equal(a.reviveProgress, 0);
});

test('bullets from two hunters flying at each other cancel out and start a fire', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const b = game.addPlayer({ name: 'B' });
  place(a, 1000);
  place(b, 1300);
  a.facing = 1;
  b.facing = -1;
  game.setInput(a.id, input({ shoot: true }));
  game.setInput(b.id, input({ shoot: true }));
  const events = run(game, 1);
  assert.ok(events.some((e) => e.kind === 'clash'), 'clash event');
  assert.ok(game.fires.size >= 1, 'a fire burns');
  const fire = [...game.fires.values()][0];
  assert.equal(fire.y, WORLD.groundY);
  assert.ok(fire.x > 1000 && fire.x < 1330);
});

test('fire hurts a hunter standing in it and rain puts it out faster', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  place(a, 1500);
  const fire = game.spawnFire(1515, WORLD.groundY - 20);
  run(game, 1.1);
  assert.ok(a.hp < PLAYER.hp, 'burned');
  const lifeBefore = fire.life;
  game.startWeather('rain');
  run(game, 0.5);
  assert.ok(lifeBefore - fire.life > 1.2, `rain drains ${FIRE.rainDrain}x: ${lifeBefore} -> ${fire.life}`);
});

test('friendly fire hurts a teammate and a team kill costs points', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const b = game.addPlayer({ name: 'B' });
  place(a, 1000);
  place(b, 1200);
  a.facing = 1;
  a.score = 50;
  b.hp = 10;
  game.setInput(a.id, input({ shoot: true }));
  const events = run(game, 0.6);
  assert.ok(events.some((e) => e.kind === 'ff' && e.by === a.id && e.victim === b.id));
  assert.equal(b.alive, false);
  assert.equal(a.score, 30);
  assert.equal(a.teamKills, 1);
  assert.equal(a.totalTeamKills, 1);
});

test('shooting a fox den collapses it for a while and stops spawns from it', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const den = game.dens[0];
  place(a, den.x + den.w + 40);
  a.facing = -1;
  game.setInput(a.id, input({ shoot: true }));
  const events = run(game, 2.5);
  assert.ok(events.some((e) => e.kind === 'denhit'));
  assert.ok(events.some((e) => e.kind === 'dencollapse' && e.id === den.id), 'den collapsed');
  assert.equal(den.collapsed, true);
  game.dens[1].collapsed = true;
  game.dens[1].timer = 100;
  assert.equal(game.spawnFox('normal'), null, 'no open den => no spawn');
  game.setInput(a.id, input({}));
  run(game, DEN.collapseTime + 0.5);
  assert.equal(den.collapsed, false, 'den reopens');
  const fox = game.spawnFox('normal');
  assert.ok(fox && fox.x < 200, 'fox comes out of the left den');
});

test('dodge dash moves the hunter quickly and grants brief invulnerability', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  place(a, 1000);
  game.setInput(a.id, input({ dash: 1 }));
  const events = run(game, 0.1);
  assert.ok(events.some((e) => e.kind === 'dash' && e.id === a.id));
  assert.ok(a.dashT > 0 && a.invulnTimer > 0, 'dashing and invulnerable');
  run(game, 0.2);
  assert.ok(a.x > 1000 + 100, `moved far: ${a.x}`);
  assert.equal(a.dashT, 0);
  // Cooldown: a second dash right away is ignored
  const xBefore = a.x;
  game.setInput(a.id, input({ dash: 1 }));
  run(game, 0.2);
  assert.ok(a.x - xBefore < 30, 'no second dash during cooldown');
});

test('hunters can climb a marked trunk and step onto its canopy', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const trunk = game.world.trunks[0];
  place(a, trunk.x - PLAYER.w / 2);
  game.setInput(a.id, input({ jump: true }));
  run(game, 0.5);
  assert.equal(a.climbing, true, 'grabbed the trunk while holding up in the air');
  // Hands are on the trunk: shooting does nothing while climbing
  game.setInput(a.id, input({ jump: true, shoot: true }));
  const shots = run(game, 1).filter((e) => e.kind === 'shoot');
  assert.equal(shots.length, 0, 'no shots while climbing');
  assert.equal(game.bullets.size, 0);
  game.setInput(a.id, input({ jump: true }));
  run(game, 5);
  assert.equal(a.climbing, false);
  assert.equal(a.onGround, true);
  assert.equal(Math.round(a.y + a.h), trunk.top, 'standing on the canopy');
  // Foxes cannot follow: a fox at the foot stays on the ground
  const fox = game.spawnFox('normal');
  fox.x = trunk.x;
  run(game, 2);
  assert.ok(fox.y + fox.h > trunk.top + 100);
});

test('a fox that cannot reach a hunter up a tree gives up for a while, then returns', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const trunk = game.world.trunks[1];
  place(a, trunk.x - PLAYER.w / 2, trunk.top - PLAYER.h);
  const fox = game.spawnFox('normal');
  fox.x = trunk.x + 40;
  fox.y = WORLD.groundY - fox.h;
  let farthest = 0;
  let gaveUp = false;
  let cameBack = false;
  for (let t = 0; t < 14; t += 1 / 60) {
    game.tick(1 / 60);
    for (const e of game.takeEvents()) if (e.kind === 'foxgiveup' && e.id === fox.id) gaveUp = true;
    const d = Math.abs(fox.x + fox.w / 2 - trunk.x);
    farthest = Math.max(farthest, d);
    if (gaveUp && !fox.roam && d < 60) cameBack = true;
  }
  assert.ok(gaveUp, 'fox gave up');
  assert.ok(farthest > 90, `fox wandered off: ${farthest}`);
  assert.ok(cameBack, 'fox came back to harass again');
  assert.ok(fox.y + fox.h > trunk.top + 100, 'still on the ground');
});

test('a stinking hunter makes nearby foxes turn around and run the other way', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  place(a, 1500);
  const fox = game.spawnFox('normal');
  fox.x = 1650;
  fox.y = WORLD.groundY - fox.h;
  run(game, 0.5);
  assert.ok(fox.x < 1650, 'fox approaches first');
  game.pickups.set(999, { id: 999, kind: 'stink', x: a.x, y: a.y, w: 22, h: 22, life: 10 });
  const events = run(game, 1.5);
  assert.ok(a.stinkTimer > 8, 'stink active');
  assert.ok(events.some((e) => e.kind === 'foxflee' && e.id === fox.id));
  assert.ok(fox.x > 1720, `fox ran away: ${fox.x}`);
  assert.equal(a.hp, PLAYER.hp, 'not bitten');
  const mega = game.spawnFox('mega');
  mega.x = 1600;
  mega.y = WORLD.groundY - mega.h;
  run(game, 0.5);
  assert.ok(mega.x < 1600, 'mega fox does not care about the smell');
});

test('a bullet bursts a mushroom and shakes leaves off a trunk', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const mushroom = game.world.decor.find((d) => d.kind === 'mushroom' && d.x > 400);
  place(a, mushroom.x - 200);
  a.facing = 1;
  game.setInput(a.id, input({ shoot: true }));
  const events = run(game, 0.5);
  assert.ok(game.broken.has(mushroom.id), 'mushroom destroyed');
  assert.ok(events.some((e) => e.kind === 'mushroom' && e.id === mushroom.id));
  const trunk = game.world.trunks[0];
  place(a, trunk.x - 150);
  game.broken.clear();
  const ev2 = run(game, 0.5);
  assert.ok(ev2.some((e) => e.kind === 'leaves' && e.trunk === trunk.id), 'leaves fall');
});

test('a stump is cover: the digger surfaces beside it, dazed', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const stump = game.world.decor.find((d) => d.kind === 'stump');
  place(a, stump.x - PLAYER.w / 2);
  const fox = game.spawnFox('digger');
  fox.x = stump.x - 600;
  const events = run(game, 4);
  const emerge = events.find((e) => e.kind === 'emerge' && e.id === fox.id);
  assert.ok(emerge && emerge.blocked, 'blocked emerge');
  assert.equal(a.hp, PLAYER.hp, 'the hunter behind the stump was not bitten on emerge');
});

test('when everyone is dead the round ends, then a new round starts with a new forest', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const b = game.addPlayer({ name: 'B' });
  a.kills = 3;
  a.score = 30;
  let summary = null;
  game.onGameOver = (s) => (summary = s);
  game.damagePlayer(a, 999, 0);
  game.damagePlayer(b, 999, 0);
  assert.equal(game.round.over, true);
  assert.ok(summary && summary.ranking[0].name === 'A');
  assert.ok(summary.ranking[0].badges.includes('Nejlepší střelec'));
  const seedBefore = game.world.seed;
  game.seedFn = () => 4242;
  run(game, 12.5);
  assert.equal(game.round.over, false);
  assert.equal(game.round.number, 2);
  assert.ok(a.alive && b.alive);
  assert.equal(a.score, 0, 'round score reset');
  assert.equal(a.totalKills, 0);
  assert.equal(a.rounds, 1);
  assert.notEqual(game.world.seed, seedBefore);
});

test('a disconnected hunter keeps their body for the grace period and can come back', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A', token: 'tok-1' });
  a.score = 70;
  game.disconnect(a.id);
  run(game, 5);
  assert.ok(game.players.has(a.id));
  const back = game.reconnect('tok-1');
  assert.equal(back, a);
  assert.equal(a.connected, true);
  assert.equal(a.score, 70);
  game.disconnect(a.id);
  run(game, PLAYER.disconnectGrace + 1);
  assert.equal(game.players.has(a.id), false, 'removed after the grace period');
  assert.equal(game.reconnect('tok-1'), null);
});

test('snapshot deltas round-trip back to the full snapshot', () => {
  const game = mk();
  game.addPlayer({ name: 'A' });
  game.spawnFox('normal');
  const prev = game.snapshot();
  game.takeEvents();
  run(game, 0.5);
  game.spawnFox('fast');
  game.startWeather('fog');
  const curr = game.snapshot();
  const delta = encodeDelta(prev, curr);
  const rebuilt = applyDelta(prev, delta);
  for (const key of Object.keys(curr)) {
    if (key === 'events') continue;
    assert.deepEqual(rebuilt[key], curr[key], `field ${key}`);
  }
  assert.ok(JSON.stringify(delta).length < JSON.stringify(curr).length, 'delta is smaller');
  assert.equal(delta.players.u[0].name, undefined, 'unchanged fields are not resent');
});

test('storm lightning strikes foxes', () => {
  const game = mk();
  game.addPlayer({ name: 'A' });
  const fox = game.spawnFox('normal');
  game.roundStartedAt = -100; // weather only runs once a round is under way
  game.startWeather('storm');
  game.lightningTimer = 0.1;
  const events = run(game, 0.5);
  const strike = events.find((e) => e.kind === 'lightning');
  assert.ok(strike);
  if (strike.hit === fox.id) assert.ok(fox.hp < fox.maxHp || !game.foxes.has(fox.id));
});

let giveId = 9000;
function give(game, p, kind) {
  const id = giveId++;
  game.pickups.set(id, { id, kind, look: kind, x: p.x, y: p.y, w: 22, h: 22, life: 10 });
  run(game, 1 / 30);
}

test('a placed trap catches the first fox that steps on it for 3 seconds', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  place(a, 1500);
  give(game, a, 'trap');
  assert.equal(a.item, 'trap');
  game.setInput(a.id, input({ use: true }));
  run(game, 0.1);
  assert.equal(a.item, null);
  assert.equal(game.traps.size, 1);
  const fox = game.spawnFox('normal');
  fox.x = 1700;
  fox.y = WORLD.groundY - fox.h;
  place(a, 1300);
  const events = run(game, 2.5);
  assert.ok(events.some((e) => e.kind === 'trap' && e.fox === fox.id), 'fox trapped');
  assert.equal(game.traps.size, 0, 'trap is used up');
  const xAt = fox.x;
  run(game, 1);
  assert.equal(Math.round(fox.x), Math.round(xAt), 'trapped fox does not move');
  assert.equal(a.hp, PLAYER.hp, 'a trapped fox cannot bite');
  run(game, TRAP.hold + 0.5);
  assert.ok(fox.trapped <= 0, 'free again');
  assert.ok(Math.abs(fox.x - a.x) < 80, `back on the hunter: ${fox.x} vs ${a.x}`);
});

test('incendiary rounds set the ground on fire where they land', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  place(a, 1000);
  a.facing = 1;
  give(game, a, 'incendiary');
  assert.ok(a.incTimer > 9);
  game.setInput(a.id, input({ shoot: true }));
  const events = run(game, 1.2);
  assert.ok(events.some((e) => e.kind === 'ignite'), 'ignite event');
  assert.ok(game.fires.size >= 1, 'fire on the ground');
  const fire = [...game.fires.values()][0];
  assert.ok(fire.x > 1000 && fire.x < 1900, `fire lands ahead: ${fire.x}`);
  assert.equal(fire.y, WORLD.groundY);
});

test('the hunting horn draws every fox to the hunter who blew it', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const b = game.addPlayer({ name: 'B' });
  place(a, 400);
  place(b, 2600);
  const fox = game.spawnFox('normal');
  fox.x = 2400;
  fox.y = WORLD.groundY - fox.h;
  run(game, 0.3);
  assert.ok(fox.vx > 0, 'fox heads for the nearer hunter B');
  give(game, a, 'horn');
  game.setInput(a.id, input({ use: true }));
  const events = run(game, 0.5);
  assert.ok(events.some((e) => e.kind === 'horn' && e.id === a.id));
  assert.ok(fox.vx < 0, 'fox turned towards A after the horn');
  run(game, HORN.duration);
  assert.ok(fox.vx > 0, 'after the horn fades the fox goes for the nearer hunter again');
});

test('a seed grows into a climbable trunk with canopy and branch', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const x = 1560;
  place(a, x - PLAYER.w / 2);
  const before = game.world.trunks.length;
  give(game, a, 'seed');
  game.setInput(a.id, input({ use: true }));
  let events = run(game, 0.1);
  assert.ok(events.some((e) => e.kind === 'seed'), 'planted');
  events = run(game, SEED_CFG.grow + 0.2);
  const grown = events.find((e) => e.kind === 'treegrown');
  assert.ok(grown, 'tree grew');
  assert.equal(game.world.trunks.length, before + 1);
  assert.ok(game.world.platforms.some((pl) => pl.canopy && pl.trunk === grown.trunk.id));
  assert.equal(grown.trunk.x, x);
  // Too close to an existing trunk: cannot plant, keeps the seed
  const t0 = game.world.trunks[0];
  place(a, t0.x + 40);
  give(game, a, 'seed');
  game.setInput(a.id, input({ use: true }));
  events = run(game, 0.1);
  assert.ok(events.some((e) => e.kind === 'noplant'));
  assert.equal(a.item, 'seed');
});

test('bait gathers foxes into a scuffle instead of attacking hunters', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  place(a, 1500);
  give(game, a, 'bait');
  game.setInput(a.id, input({ use: true }));
  run(game, 0.1);
  place(a, 1100);
  const foxes = [game.spawnFox('normal'), game.spawnFox('normal')];
  foxes[0].x = 1700;
  foxes[1].x = 1800;
  for (const f of foxes) f.y = WORLD.groundY - f.h;
  run(game, 3);
  for (const f of foxes) assert.ok(Math.abs(f.x + f.w / 2 - 1515) < 60, `fox at the bait: ${f.x}`);
  assert.equal(a.hp, PLAYER.hp, 'hunter left alone');
  const events = run(game, 6);
  assert.ok(events.some((e) => e.kind === 'lureend' && e.item === 'bait'), 'bait eaten');
  assert.equal(game.lures.size, 0);
});

test('a rifle shot on flat ground hits even the small fast fox', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  place(a, 1000);
  a.facing = 1;
  const fox = game.spawnFox('fast');
  fox.x = 1200;
  fox.y = WORLD.groundY - fox.h;
  fox.stun = 5;
  game.setInput(a.id, input({ shoot: true }));
  const events = run(game, 0.5);
  assert.ok(events.some((e) => e.kind === 'hit' || e.kind === 'kill'), 'fast fox got hit');
});

test('double points doubles the score of kills for a while', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  place(a, 1000);
  a.facing = 1;
  give(game, a, 'double');
  const fox = game.spawnFox('fast');
  fox.x = 1200;
  fox.y = WORLD.groundY - fox.h;
  fox.hp = 1;
  fox.vx = 0;
  fox.stun = 5;
  game.setInput(a.id, input({ shoot: true }));
  const events = run(game, 0.5);
  const kill = events.find((e) => e.kind === 'kill');
  assert.ok(kill && kill.score === 30, `fast fox worth 15 doubled: ${kill && kill.score}`);
  assert.equal(a.score, 30);
});

test('a disguised hunter is ignored by foxes and cannot shoot', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  place(a, 1500);
  give(game, a, 'disguise');
  const fox = game.spawnFox('normal');
  fox.x = 1560;
  fox.y = WORLD.groundY - fox.h;
  game.setInput(a.id, input({ shoot: true }));
  const events = run(game, 2);
  assert.equal(events.filter((e) => e.kind === 'shoot').length, 0, 'no shots in disguise');
  assert.equal(a.hp, PLAYER.hp, 'foxes ignore the disguise');
  assert.ok(!events.some((e) => e.kind === 'bite'));
});

test('a cursed crate looks ordinary and unleashes a digger under the hunter', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  place(a, 1500);
  game.pickups.set(1, { id: 1, kind: 'curse', look: 'medkit', x: a.x, y: a.y, w: 22, h: 22, life: 10 });
  assert.equal(game.snapshot().pickups[0].kind, 'medkit', 'clients only see the disguise');
  const events = run(game, 0.2);
  assert.ok(events.some((e) => e.kind === 'curse' && e.id === a.id));
  const digger = [...game.foxes.values()].find((f) => f.kind === 'digger');
  assert.ok(digger && !digger.dug, 'digger is out');
  assert.ok(Math.abs(digger.x + digger.w / 2 - (a.x + a.w / 2)) < 30, 'right under the hunter');
});

test('fire at the foot of a climbable tree burns it down after a few seconds', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const trunk = game.world.trunks[0];
  const id = trunk.id;
  place(a, trunk.x - PLAYER.w / 2, trunk.top - PLAYER.h);
  game.spawnFire(trunk.x + 20, WORLD.groundY - 10);
  let events = run(game, 0.2);
  assert.ok(events.some((e) => e.kind === 'treefire' && e.id === id), 'tree caught fire');
  run(game, 1.2);
  assert.ok(a.hp < PLAYER.hp, 'standing in the burning canopy hurts');
  events = run(game, TREE_BURN.time);
  assert.ok(events.some((e) => e.kind === 'treeburnt' && e.id === id), 'tree burnt down');
  assert.ok(!game.world.trunks.some((t) => t.id === id));
  assert.ok(!game.world.platforms.some((pl) => pl.trunk === id), 'its platforms are gone');
  run(game, 1.5);
  assert.ok(a.y + a.h > trunk.top + 100 || !a.alive, 'the hunter fell');
});

test('pressing down on a one-way platform drops the hunter through it', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const pl = game.world.platforms.find((p) => !p.ground && !p.canopy && !p.branch && p.y > 500);
  place(a, pl.x + pl.w / 2 - PLAYER.w / 2, pl.y - PLAYER.h);
  run(game, 0.1);
  assert.equal(a.onGround, true);
  game.setInput(a.id, input({ down: true }));
  const events = run(game, 0.05);
  assert.ok(events.some((e) => e.kind === 'drop'), 'drop event');
  assert.ok(a.y > pl.y - PLAYER.h + 1, 'moved below the platform top');
  game.setInput(a.id, input({}));
  run(game, 1.5);
  assert.ok(a.y + a.h > pl.y + 20, `fell through: ${a.y + a.h} vs ${pl.y}`);
  // Plain jump still jumps
  const y0 = a.y;
  game.setInput(a.id, input({ jump: true }));
  run(game, 0.2);
  assert.ok(a.y < y0 - 20, 'normal jump goes up');
});

test('clearing a wave gives a 5 s breather without spawns before the next wave starts', () => {
  const game = mk();
  game.addPlayer({ name: 'A' });
  game.spawnTimer = 0.2;
  game.totalKills = 12; // wave 2 reached
  let events = run(game, 0.1);
  assert.ok(events.some((e) => e.kind === 'wavedone' && e.wave === 1 && e.next === 2), 'wave done');
  assert.ok(game.breather > 4.5);
  events = run(game, 4);
  assert.equal(events.filter((e) => e.kind === 'foxspawn').length, 0, 'no spawns during the breather');
  assert.ok(!events.some((e) => e.kind === 'wave'));
  events = run(game, 3);
  assert.ok(events.some((e) => e.kind === 'wave' && e.wave === 2), 'next wave announced');
  assert.ok(events.some((e) => e.kind === 'foxspawn'), 'spawning resumed');
});

test('the Fox Mother arrives at the boss wave, howls the pack in phase 2 and her death wins the round', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  place(a, 1500);
  game.totalKills = (BOSS.wave - 1) * 12;
  game.announcedWave = BOSS.wave - 1;
  game.roundStartedAt = -100;
  game.weatherTimer = 1e9;
  let events = run(game, 6);
  const bossEv = events.find((e) => e.kind === 'boss');
  assert.ok(bossEv, 'boss announced');
  const boss = game.foxes.get(bossEv.id);
  assert.ok(boss && boss.boss && boss.kind === 'mother');
  game.spawnTimer = 0;
  events = run(game, 3);
  assert.equal(events.filter((e) => e.kind === 'foxspawn' && e.foxKind !== 'mother').length, 0, 'phase 1: she fights alone');
  boss.hp = boss.maxHp / 2 - 1;
  events = run(game, 2);
  assert.ok(events.some((e) => e.kind === 'bossphase' && e.phase === 2), 'phase 2');
  assert.ok(events.some((e) => e.kind === 'howl'), 'she howls');
  assert.ok(game.foxes.size > 1, 'the pack came out');
  let summary = null;
  game.onGameOver = (s) => (summary = s);
  a.roundRevives = 3;
  game.damageFox(boss, 99999, a);
  assert.equal(game.round.over, true);
  assert.equal(game.round.won, true);
  assert.ok(summary && summary.won);
  assert.ok(summary.teamBadges.includes('Liščí matka poražena'));
  assert.ok(summary.teamBadges.includes('Tři oživení v jednom kole'));
  assert.equal(game.foxes.size, 0, 'the forest goes quiet');
  assert.ok(a.score >= 300);
});

test('pickup kinds unlock with the wave', () => {
  const game = mk();
  game.addPlayer({ name: 'A' });
  for (let i = 0; i < 200; i++) game.dropPickup(1000 + i, 600);
  const early = new Set([...game.pickups.values()].map((p) => p.kind));
  assert.ok(early.has('medkit') || early.has('shotgun'));
  assert.ok(!early.has('seed') && !early.has('disguise') && !early.has('lantern'), 'late kinds locked at wave 1');
  game.pickups.clear();
  game.totalKills = 12 * 6;
  for (let i = 0; i < 400; i++) game.dropPickup(1000 + i, 600);
  const late = new Set([...game.pickups.values()].map((p) => p.kind));
  assert.ok(late.has('seed') || late.has('disguise') || late.has('lantern'), 'late kinds available now');
});

test('a held item can be thrown to a teammate', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const b = game.addPlayer({ name: 'B' });
  place(a, 1000);
  place(b, 1250);
  give(game, a, 'trap');
  assert.equal(a.item, 'trap');
  game.setInput(a.id, input({ throw: 1 }));
  let events = run(game, 0.1);
  assert.ok(events.some((e) => e.kind === 'throw' && e.item === 'trap'));
  assert.equal(a.item, null);
  assert.equal(game.pickups.size, 1, 'the crate is in the air');
  events = run(game, 2);
  assert.ok(b.item === 'trap' || events.some((e) => e.kind === 'land'), 'B caught it or it landed');
  assert.equal(a.item, null, 'the thrower did not take it straight back');
});

test('a revived hunter is fragile: 3 s invulnerable and marked until healed', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const b = game.addPlayer({ name: 'B' });
  place(a, 1500);
  place(b, 1500);
  game.damagePlayer(a, 999, 1400);
  game.setInput(b.id, input({ revive: true }));
  run(game, 3.3);
  assert.equal(a.alive, true);
  assert.equal(a.fragile, true);
  assert.ok(a.invulnTimer > 2.5, `3 s of grace: ${a.invulnTimer}`);
  give(game, a, 'medkit');
  assert.equal(a.fragile, false);
});

test('team badges: no death before wave 5 and both dens collapsed', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  game.totalKills = 12 * 5;
  game.dens[0].collapsed = true;
  game.hitDen(game.dens[1], 999);
  assert.equal(game.teamStats.bothDens, true);
  game.damagePlayer(a, 999, 0);
  const badges = game.teamBadges(false);
  assert.ok(badges.includes('Nikdo neumřel do vlny 5'));
  assert.ok(badges.includes('Zavaleny obě nory najednou'));
});

test('a sideways press lets go of the trunk', () => {
  const game = mk();
  const a = game.addPlayer({ name: 'A' });
  const trunk = game.world.trunks[0];
  place(a, trunk.x - PLAYER.w / 2);
  game.setInput(a.id, input({ jump: true }));
  run(game, 1.5);
  assert.equal(a.climbing, true);
  game.setInput(a.id, input({ right: true }));
  run(game, 0.1);
  assert.equal(a.climbing, false, 'let go');
  assert.ok(a.vx > 0 || a.x > trunk.x - PLAYER.w / 2 + 3, 'stepped off to the side');
});
