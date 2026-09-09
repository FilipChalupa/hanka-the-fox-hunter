'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PLAYER, DEN, FIRE } = require('../game/sim.js');
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
  run(game, 6);
  assert.equal(a.climbing, false);
  assert.equal(a.onGround, true);
  assert.equal(Math.round(a.y + a.h), trunk.top, 'standing on the canopy');
  // Foxes cannot follow: a fox at the foot stays on the ground
  const fox = game.spawnFox('normal');
  fox.x = trunk.x;
  run(game, 2);
  assert.ok(fox.y + fox.h > trunk.top + 100);
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
