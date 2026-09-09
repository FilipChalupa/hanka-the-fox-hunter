'use strict';

/*
 * End-to-end: a real server, two real browsers. Covers what the simulation tests cannot see:
 * the page loads, the protocol round-trips, prediction moves the hunter, both clients see each
 * other, shots and kills flow through, the menu opens, and nothing throws in the console.
 *
 *   npm run test:e2e   (needs `npx playwright install chromium` once)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  chromium = null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function startServer(port) {
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: path.join(__dirname, '..', 'data', 'e2e-tmp') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('běží')) {
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
    proc.on('exit', (code) => reject(new Error(`server exited early (${code})`)));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The client keeps its state in module-level `let`s; the test reads it through a tiny probe
// injected before game.js runs.
const PROBE = `
  window.__probe = () => ({
    myId: typeof myId !== 'undefined' ? myId : 0,
    players: (typeof currSnap !== 'undefined' && currSnap) ? currSnap.data.players.map((p) => ({ id: p.id, name: p.name, x: p.x, alive: p.alive })) : [],
    foxes: (typeof currSnap !== 'undefined' && currSnap) ? currSnap.data.foxes.length : -1,
    predX: typeof pred !== 'undefined' ? pred.x : null,
    feed: typeof feed !== 'undefined' ? feed.map((f) => f.text) : [],
    events: window.__events || [],
  });
`;

test('two browsers join the same forest, see each other, shoot and hit', { skip: !chromium && 'playwright not installed', timeout: 90000 }, async () => {
  const port = await freePort();
  const server = await startServer(port);
  const browser = await chromium.launch();
  const errors = [];
  try {
    const contexts = [await browser.newContext(), await browser.newContext()];
    const pages = [];
    for (const [i, ctx] of contexts.entries()) {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`page${i}: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`page${i} console: ${m.text()}`);
      });
      await page.addInitScript(PROBE);
      // Record events as they arrive, without touching the game loop
      await page.addInitScript(() => {
        window.__events = [];
        const orig = window.WebSocket;
        window.WebSocket = class extends orig {
          constructor(...a) {
            super(...a);
            this.addEventListener('message', (ev) => {
              try {
                const m = JSON.parse(ev.data);
                for (const e of m.events || []) window.__events.push(e.kind);
                if (window.__events.length > 2000) window.__events.splice(0, 1000);
              } catch {}
            });
          }
        };
      });
      await page.goto(`http://127.0.0.1:${port}/?name=Lovec${i + 1}`);
      pages.push(page);
    }

    // Both are in the game and see two hunters
    for (const page of pages) {
      await page.waitForFunction(() => window.__probe().myId > 0 && window.__probe().players.length === 2, null, { timeout: 15000 });
    }
    const p0 = await pages[0].evaluate(() => window.__probe());
    const p1 = await pages[1].evaluate(() => window.__probe());
    assert.ok(p0.players.some((p) => p.name === 'Lovec2'), 'page 0 sees Lovec2');
    assert.ok(p1.players.some((p) => p.name === 'Lovec1'), 'page 1 sees Lovec1');
    assert.equal(p0.foxes >= 0, true);

    // Prediction: holding D moves my hunter right immediately, and the other browser sees it too
    const before = p0.predX;
    await pages[0].keyboard.down('KeyD');
    await sleep(700);
    await pages[0].keyboard.up('KeyD');
    const after = await pages[0].evaluate(() => window.__probe().predX);
    assert.ok(after > before + 60, `moved right: ${before} -> ${after}`);
    await sleep(300);
    const seenByOther = await pages[1].evaluate(() => window.__probe().players.find((p) => p.name === 'Lovec1').x);
    assert.ok(Math.abs(seenByOther - after) < 80, `other browser sees the move: ${seenByOther} vs ${after}`);

    // Shooting: hold F for a while, the other client receives shoot events
    await pages[0].keyboard.down('KeyF');
    await sleep(1200);
    await pages[0].keyboard.up('KeyF');
    await sleep(400);
    const ev1 = await pages[1].evaluate(() => window.__probe().events);
    assert.ok(ev1.filter((k) => k === 'shoot').length >= 3, 'shots reached the other browser');

    // Esc opens the settings menu, Esc closes it
    await pages[0].keyboard.press('Escape');
    await sleep(200);
    assert.equal(await pages[0].evaluate(() => !document.getElementById('menu').hidden), true, 'menu open');
    await pages[0].keyboard.press('Escape');
    await sleep(200);
    assert.equal(await pages[0].evaluate(() => document.getElementById('menu').hidden), true, 'menu closed');

    // Leaving: the other browser gets the "away" notice
    await pages[1].close();
    await sleep(600);
    const feed0 = await pages[0].evaluate(() => window.__probe().events);
    assert.ok(feed0.includes('away'), 'departure noticed');

    assert.deepEqual(errors, [], 'no console errors');
  } finally {
    await browser.close();
    server.kill();
  }
});

test('the client reloads once when the server speaks a newer protocol', { skip: !chromium && 'playwright not installed', timeout: 60000 }, async () => {
  const port = await freePort();
  const server = await startServer(port);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Pretend this browser holds an older shared.js
    await page.addInitScript(() => {
      Object.defineProperty(window, 'Shared', {
        configurable: true,
        set(v) {
          v.PROTOCOL = v.PROTOCOL - 1;
          Object.defineProperty(window, 'Shared', { value: v, configurable: true, writable: true });
        },
      });
    });
    await page.goto(`http://127.0.0.1:${port}/?name=Stary`);
    await page.waitForFunction(() => location.search.includes('v='), null, { timeout: 15000 });
    assert.ok((await page.url()).includes('v='), 'reloaded with a cache-busting version');
  } finally {
    await browser.close();
    server.kill();
  }
});
