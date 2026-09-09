/*
 * Code shared by the server simulation and the browser client:
 * world generation, player movement (used for client-side prediction) and
 * snapshot delta encoding. UMD so it works with require() and a <script> tag.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WORLD = { width: 3200, height: 720, groundY: 660 };
  const GRAVITY = 1900;
  const MAX_FALL = 1300;

  const PLAYER = {
    w: 30, h: 48, speed: 270, jump: 680, hp: 100,
    ghostSpeed: 220, climbSpeed: 170,
    dashSpeed: 760, dashTime: 0.17, dashCooldown: 1.0,
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // -------------------------------------------------------------------------
  // World generation: platforms, climbable trunks, decorations, fox dens
  // -------------------------------------------------------------------------
  function generateWorld(seed) {
    const rnd = seeded(seed);
    const platforms = [{ x: 0, y: WORLD.groundY, w: WORLD.width, h: 60, ground: true }];
    const fits = (p) => platforms.every((q) => q.ground || p.x + p.w + 40 < q.x || p.x > q.x + q.w + 40 || Math.abs(p.y - q.y) > 70);

    // Climbable trunks: tall foreground trees with a canopy platform on top and a branch halfway.
    const trunks = [];
    const trunkCount = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < trunkCount; i++) {
      const slot = (WORLD.width - 600) / trunkCount;
      const x = Math.round(300 + slot * i + rnd() * (slot - 200) + 100);
      const top = Math.round(140 + rnd() * 90);
      trunks.push({ id: i, x, top, bottom: WORLD.groundY });
      platforms.push({ x: x - 70, y: top, w: 140, h: 18, canopy: true, trunk: i });
      const branchY = Math.round(top + 120 + rnd() * (WORLD.groundY - top - 300));
      const side = rnd() < 0.5 ? -1 : 1;
      platforms.push({ x: side < 0 ? x - 14 - 95 : x + 14, y: branchY, w: 95, h: 14, branch: true, trunk: i });
    }

    let x = 120 + rnd() * 120;
    while (x < WORLD.width - 260) {
      let y = WORLD.groundY - 95 - Math.floor(rnd() * 20);
      let w = 130 + Math.floor(rnd() * 130);
      let px = x;
      const tiers = 1 + (rnd() < 0.7 ? 1 : 0) + (rnd() < 0.35 ? 1 : 0);
      for (let t = 0; t < tiers; t++) {
        const p = { x: Math.round(px), y: Math.round(y), w: Math.round(w), h: 18 };
        if (p.x + p.w > WORLD.width - 40) p.w = WORLD.width - 40 - p.x;
        const nearTrunk = trunks.some((tr) => p.x < tr.x + 30 && p.x + p.w > tr.x - 30 && p.y < tr.top + 40);
        if (p.w >= 90 && fits(p) && !nearTrunk) platforms.push(p);
        y -= 85 + rnd() * 25;
        px += (rnd() < 0.5 ? -1 : 1) * (60 + rnd() * 90);
        w = 100 + rnd() * 110;
        if (px < 20) px = 20;
      }
      x += 260 + rnd() * 220;
    }

    // Ground decorations: stumps (cover), rocks, mushrooms (destructible), ferns
    const decor = [];
    let did = 0;
    for (let dx = 160; dx < WORLD.width - 160; dx += 60 + rnd() * 120) {
      if (trunks.some((tr) => Math.abs(tr.x - dx) < 44)) continue;
      const r = rnd();
      decor.push({ id: did++, x: Math.round(dx), kind: r < 0.2 ? 'stump' : r < 0.45 ? 'rock' : r < 0.7 ? 'mushroom' : 'fern', s: 0.7 + rnd() * 0.6, flip: rnd() < 0.5 });
    }

    const dens = [
      { id: 0, side: -1, x: 10, y: WORLD.groundY - 46, w: 76, h: 46 },
      { id: 1, side: 1, x: WORLD.width - 86, y: WORLD.groundY - 46, w: 76, h: 46 },
    ];

    return { seed, platforms, trunks, decor, dens };
  }

  // -------------------------------------------------------------------------
  // Physics
  // -------------------------------------------------------------------------
  // `dropY`: while dropping through a one-way platform, ignore platforms at that height.
  function stepPhysics(e, dt, platforms, dropY) {
    e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL);
    const prevBottom = e.y + e.h;
    e.x = clamp(e.x + e.vx * dt, 0, WORLD.width - e.w);
    e.y += e.vy * dt;
    e.onGround = false;
    if (e.vy >= 0) {
      for (const p of platforms) {
        if (e.x + e.w <= p.x || e.x >= p.x + p.w) continue;
        if (dropY !== undefined && !p.ground && Math.abs(p.y - dropY) < 6) continue;
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

  function groundBelow(platforms, x, w, bottom) {
    let best = WORLD.groundY;
    for (const p of platforms) {
      if (p.ground) continue;
      if (x + w > p.x && x < p.x + p.w && p.y >= bottom - 2 && p.y < best) best = p.y;
    }
    return best;
  }

  function platformUnder(platforms, p) {
    const bottom = p.y + p.h;
    for (const pl of platforms) {
      if (pl.ground) continue;
      if (p.x + p.w > pl.x && p.x < pl.x + pl.w && Math.abs(bottom - pl.y) < 1.5) return pl;
    }
    return null;
  }

  function trunkAt(trunks, p) {
    const cx = p.x + p.w / 2;
    for (const t of trunks) {
      if (Math.abs(cx - t.x) <= 18 && p.y + p.h > t.top + 4 && p.y < t.bottom) return t;
    }
    return null;
  }

  /*
   * Moves an alive player for one step. Deterministic given (state, input, dt), which is
   * what lets the client predict its own hunter and the server stay authoritative.
   * `inp` = { left, right, jump, down, dash } where dash is -1/0/1 for a one-shot dodge request.
   * Returns a list of things that happened ('jump', 'dash', 'grab', 'land') for effects.
   */
  function movePlayer(p, inp, dt, world) {
    const out = [];
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const speed = PLAYER.speed * (p.speedBoost ? 1.45 : 1);
    p.dashCd = Math.max(0, (p.dashCd || 0) - dt);
    const wasGround = p.onGround;

    // Dodge dash: a quick burst with brief invulnerability, usable on the ground or in the air.
    if (inp.dash && p.dashCd <= 0 && !p.climbing) {
      p.dashT = PLAYER.dashTime;
      p.dashDir = inp.dash > 0 ? 1 : -1;
      p.dashCd = PLAYER.dashCooldown;
      p.facing = p.dashDir;
      out.push('dash');
    }
    if (p.dashT > 0) {
      p.dashT = Math.max(0, p.dashT - dt);
      p.vx = p.dashDir * PLAYER.dashSpeed;
      p.vy = 0;
      p.x = clamp(p.x + p.vx * dt, 0, WORLD.width - p.w);
      p.jumpHeld = inp.jump;
      return out;
    }

    // Climbing trunks
    const trunk = trunkAt(world.trunks, p);
    if (p.climbing) {
      if (!trunk) p.climbing = false;
      else {
        p.x = trunk.x - p.w / 2;
        p.vx = 0;
        const v = (inp.down ? 1 : 0) - (inp.jump ? 1 : 0);
        p.vy = v * PLAYER.climbSpeed;
        p.y += p.vy * dt;
        p.onGround = false;
        if (inp.jump && !p.jumpHeld && dir !== 0) {
          // Jump off sideways
          p.climbing = false;
          p.vy = -PLAYER.jump * 0.75;
          p.vx = dir * speed;
          p.facing = dir;
          p.x += dir * 6;
          out.push('jump');
        } else if (p.y + p.h <= trunk.top + 2) {
          // Reached the canopy: step onto it
          p.climbing = false;
          p.y = trunk.top - p.h;
          p.vy = 0;
          p.onGround = true;
        } else if (p.y + p.h >= WORLD.groundY) {
          p.climbing = false;
          p.y = WORLD.groundY - p.h;
          p.onGround = true;
        }
        p.jumpHeld = inp.jump;
        return out;
      }
    }

    p.vx = dir * speed;
    if (dir !== 0) p.facing = dir;

    p.dropT = Math.max(0, (p.dropT || 0) - dt);
    // Pressing down on a one-way platform drops through it (a trunk at your feet takes priority: that climbs).
    const downPressed = inp.down && !p.downHeld;
    p.downHeld = inp.down;
    const under = p.onGround && downPressed && !trunk ? platformUnder(world.platforms, p) : null;
    if (under) {
      p.dropT = 0.3;
      p.dropY = under.y;
      p.y += 3;
      p.vy = 120;
      p.onGround = false;
      out.push('drop');
    } else if (inp.jump && !p.jumpHeld && p.onGround) {
      p.vy = -PLAYER.jump;
      p.onGround = false;
      p.jumpTime = 0;
      out.push('jump');
    }
    p.jumpTime = inp.jump ? (p.jumpTime || 0) + dt : 0;
    p.jumpHeld = inp.jump;

    stepPhysics(p, dt, world.platforms, p.dropT > 0 ? p.dropY : undefined);

    // Grab a trunk: hold up while airborne next to it, or press down while standing at its foot.
    if (trunk && !p.onGround && inp.jump && p.jumpTime > 0.12 && p.vy > -200) {
      p.climbing = true;
      p.vy = 0;
      out.push('grab');
    } else if (trunk && p.onGround && inp.down && p.y + p.h > trunk.top + 60 && p.y + p.h < WORLD.groundY - 1) {
      p.climbing = true;
      p.vy = 0;
      out.push('grab');
    }
    if (!wasGround && p.onGround) out.push('land');
    return out;
  }

  function moveGhost(p, inp, dt) {
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const vdir = (inp.down ? 1 : 0) - (inp.jump ? 1 : 0);
    p.vx = dir * PLAYER.ghostSpeed;
    p.vy = vdir * PLAYER.ghostSpeed;
    if (dir !== 0) p.facing = dir;
    p.x = clamp(p.x + p.vx * dt, 0, WORLD.width - p.w);
    p.y = clamp(p.y + p.vy * dt, 0, WORLD.groundY - p.h);
    p.onGround = false;
    p.climbing = false;
    p.dashT = 0;
  }

  // -------------------------------------------------------------------------
  // Snapshot deltas: only entities/fields that changed since the last snapshot
  // -------------------------------------------------------------------------
  const COLLECTIONS = ['players', 'foxes', 'bullets', 'pickups', 'fires', 'traps', 'lures', 'saplings', 'burning'];

  function same(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function encodeDelta(prev, curr) {
    const out = { t: 'delta' };
    for (const key of Object.keys(curr)) {
      if (key === 't' || key === 'events' || COLLECTIONS.includes(key)) continue;
      if (!same(prev[key], curr[key])) out[key] = curr[key];
    }
    out.events = curr.events;
    for (const col of COLLECTIONS) {
      const prevById = new Map((prev[col] || []).map((e) => [e.id, e]));
      const upd = [];
      const seen = new Set();
      for (const e of curr[col] || []) {
        seen.add(e.id);
        const old = prevById.get(e.id);
        if (!old) {
          upd.push(e);
          continue;
        }
        let changed = null;
        for (const k of Object.keys(e)) {
          if (!same(old[k], e[k])) {
            if (!changed) changed = { id: e.id };
            changed[k] = e[k];
          }
        }
        if (changed) upd.push(changed);
      }
      const del = [];
      for (const id of prevById.keys()) if (!seen.has(id)) del.push(id);
      if (upd.length || del.length) out[col] = { u: upd, d: del };
    }
    return out;
  }

  // Applies a delta to a full snapshot object and returns a new full snapshot.
  function applyDelta(base, delta) {
    const next = { ...base, t: 'state' };
    for (const key of Object.keys(delta)) {
      if (key === 't' || COLLECTIONS.includes(key)) continue;
      next[key] = delta[key];
    }
    for (const col of COLLECTIONS) {
      const list = (base[col] || []).map((e) => ({ ...e }));
      const d = delta[col];
      if (!d) {
        next[col] = list;
        continue;
      }
      const byId = new Map(list.map((e) => [e.id, e]));
      for (const id of d.d || []) byId.delete(id);
      for (const u of d.u || []) {
        const old = byId.get(u.id);
        byId.set(u.id, old ? Object.assign(old, u) : { ...u });
      }
      next[col] = [...byId.values()];
    }
    if (!delta.events) next.events = [];
    return next;
  }

  return { WORLD, GRAVITY, PLAYER, clamp, overlaps, seeded, generateWorld, stepPhysics, groundBelow, trunkAt, platformUnder, movePlayer, moveGhost, encodeDelta, applyDelta, COLLECTIONS };
});
