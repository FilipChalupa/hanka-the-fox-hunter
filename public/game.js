'use strict';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const VIEW = { w: canvas.width, h: canvas.height };

const overlay = document.getElementById('overlay');
const nameInput = document.getElementById('name');
const playBtn = document.getElementById('play');
const statusEl = document.getElementById('status');

let ws = null;
let myId = 0;
let world = { width: 3200, height: 720, groundY: 660 };
let platforms = [];
let connected = false;

// Snapshots for interpolation
let prevSnap = null;
let currSnap = null;

// Local effects
const particles = [];
const floatingTexts = [];
const feed = []; // kill feed / messages
let shake = 0;
let latency = 0;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------
// Audio (tiny procedural sounds)
// ---------------------------------------------------------------------------
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      audioCtx = null;
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone({ type = 'square', from = 440, to = 220, dur = 0.1, gain = 0.08, noise = false }) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(audioCtx.destination);

  if (noise) {
    const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    src.connect(filter).connect(g);
    src.start(t0);
    src.stop(t0 + dur);
  } else {
    const osc = audioCtx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + dur);
  }
}

const SFX = {
  shoot: () => playTone({ noise: true, from: 3000, to: 300, dur: 0.12, gain: 0.12 }),
  hit: () => playTone({ type: 'triangle', from: 300, to: 120, dur: 0.08, gain: 0.06 }),
  kill: () => playTone({ type: 'sawtooth', from: 900, to: 200, dur: 0.25, gain: 0.07 }),
  hurt: () => playTone({ type: 'square', from: 200, to: 80, dur: 0.2, gain: 0.08 }),
  jump: () => playTone({ type: 'sine', from: 300, to: 600, dur: 0.1, gain: 0.04 }),
  death: () => playTone({ type: 'sawtooth', from: 400, to: 40, dur: 0.6, gain: 0.1 }),
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const input = { left: false, right: false, jump: false, shoot: false };
let lastSent = '';

function sendInput() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !myId) return;
  const key = `${input.left}${input.right}${input.jump}${input.shoot}`;
  if (key === lastSent) return;
  lastSent = key;
  ws.send(JSON.stringify({ t: 'input', ...input }));
}

const KEYMAP = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'jump',
  KeyW: 'jump',
  Space: 'jump',
  ControlLeft: 'shoot',
  ControlRight: 'shoot',
  KeyF: 'shoot',
  KeyX: 'shoot',
};

window.addEventListener('keydown', (e) => {
  if (document.activeElement === nameInput) return;
  const action = KEYMAP[e.code];
  if (!action) return;
  e.preventDefault();
  if (!input[action]) {
    input[action] = true;
    sendInput();
  }
});
window.addEventListener('keyup', (e) => {
  const action = KEYMAP[e.code];
  if (!action) return;
  e.preventDefault();
  input[action] = false;
  sendInput();
});
window.addEventListener('blur', () => {
  for (const k in input) input[k] = false;
  sendInput();
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  ensureAudio();
  input.shoot = true;
  sendInput();
});
window.addEventListener('mouseup', () => {
  if (input.shoot) {
    input.shoot = false;
    sendInput();
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Touch buttons
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  document.body.classList.add('touch');
  for (const btn of document.querySelectorAll('.tbtn')) {
    const key = btn.dataset.key;
    const on = (e) => {
      e.preventDefault();
      ensureAudio();
      btn.classList.add('active');
      input[key] = true;
      sendInput();
    };
    const off = (e) => {
      e.preventDefault();
      btn.classList.remove('active');
      input[key] = false;
      sendInput();
    };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
  }
}

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------
function connect(name) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  statusEl.textContent = 'Připojuji…';

  ws.addEventListener('open', () => {
    connected = true;
    ws.send(JSON.stringify({ t: 'join', name }));
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.t === 'welcome') {
      myId = msg.id;
      world = msg.world;
      platforms = msg.platforms;
      overlay.classList.add('hidden');
      statusEl.textContent = '';
      lastSent = '';
      sendInput();
      addFeed(`Vítej v lese, ${name}!`, '#ffd27f');
    } else if (msg.t === 'state') {
      prevSnap = currSnap;
      currSnap = { data: msg, at: performance.now() };
      handleEvents(msg.events);
    } else if (msg.t === 'pong') {
      latency = Math.round(performance.now() - msg.ts);
    }
  });

  ws.addEventListener('close', () => {
    connected = false;
    myId = 0;
    prevSnap = currSnap = null;
    overlay.classList.remove('hidden');
    statusEl.textContent = 'Spojení se serverem bylo přerušeno.';
  });
  ws.addEventListener('error', () => {
    statusEl.textContent = 'Nepodařilo se připojit k serveru.';
  });
}

setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping', ts: performance.now() }));
}, 2000);

playBtn.addEventListener('click', () => {
  ensureAudio();
  const name = nameInput.value.trim() || 'Hanka';
  try {
    localStorage.setItem('hanka-name', name);
  } catch {}
  connect(name);
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') playBtn.click();
});
try {
  nameInput.value = localStorage.getItem('hanka-name') || '';
} catch {}
nameInput.focus();

// Auto-join when the URL carries a name, e.g. /?name=Hanka
const urlName = new URLSearchParams(location.search).get('name');
if (urlName) {
  nameInput.value = urlName;
  playBtn.click();
}

// ---------------------------------------------------------------------------
// Events -> effects
// ---------------------------------------------------------------------------
function addFeed(text, color = '#fff') {
  feed.unshift({ text, color, life: 5 });
  if (feed.length > 6) feed.pop();
}

function burst(x, y, n, opts) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(opts.minSpeed || 40, opts.maxSpeed || 200);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - (opts.up || 0),
      life: rand(0.3, opts.life || 0.7),
      maxLife: opts.life || 0.7,
      size: rand(2, opts.size || 5),
      color: opts.colors[Math.floor(Math.random() * opts.colors.length)],
      gravity: opts.gravity ?? 500,
    });
  }
}

function playerName(id) {
  const p = currSnap && currSnap.data.players.find((pl) => pl.id === id);
  return p ? p.name : '?';
}

function handleEvents(events) {
  if (!events) return;
  for (const ev of events) {
    switch (ev.kind) {
      case 'shoot':
        burst(ev.x + ev.dir * 6, ev.y + 2, 4, { colors: ['#ffe27a', '#ffb347', '#fff'], minSpeed: 30, maxSpeed: 120, life: 0.2, size: 3, gravity: 0 });
        if (ev.id === myId) SFX.shoot();
        else SFX.shoot();
        break;
      case 'hit':
        burst(ev.x, ev.y, 6, { colors: ['#e0561f', '#ff8c42', '#ffd9b3'], life: 0.4 });
        floatingTexts.push({ x: ev.x, y: ev.y - 10, text: '-10', color: '#fff', life: 0.6 });
        SFX.hit();
        break;
      case 'kill':
        burst(ev.x, ev.y, 18, { colors: ['#e0561f', '#ff8c42', '#ffffff', '#5a2a0a'], maxSpeed: 260, life: 0.8, up: 80 });
        if (ev.by === myId) {
          floatingTexts.push({ x: ev.x, y: ev.y - 20, text: '+10', color: '#ffd27f', life: 1 });
          shake = Math.max(shake, 4);
        }
        SFX.kill();
        break;
      case 'hurt':
        burst(ev.x, ev.y, 8, { colors: ['#d61f1f', '#8f0e0e'], life: 0.5 });
        if (ev.id === myId) {
          shake = 8;
          SFX.hurt();
        }
        break;
      case 'death':
        burst(ev.x, ev.y, 24, { colors: ['#d61f1f', '#8f0e0e', '#ffffff'], maxSpeed: 300, life: 1, up: 120 });
        addFeed(`🦊 Lišky dostaly hráče ${ev.name}`, '#ff8b8b');
        if (ev.id === myId) {
          shake = 14;
          SFX.death();
        }
        break;
      case 'jump':
        burst(ev.x, ev.y, 3, { colors: ['#b7a37a', '#8d7b55'], minSpeed: 20, maxSpeed: 60, life: 0.3, size: 3, gravity: 200 });
        if (ev.id === myId) SFX.jump();
        break;
      case 'join':
        addFeed(`➕ ${ev.name} vstoupil(a) do lesa`, '#a8e6a1');
        break;
      case 'leave':
        addFeed(`➖ ${ev.name} opustil(a) les`, '#bbb');
        break;
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Forest background (procedurally generated, deterministic)
// ---------------------------------------------------------------------------
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const LAYERS = [
  { parallax: 0.15, count: 34, minH: 120, maxH: 200, color: '#0f2f22', trunk: '#0b241a', y: 0.62 },
  { parallax: 0.35, count: 42, minH: 150, maxH: 260, color: '#16412c', trunk: '#10301f', y: 0.75 },
  { parallax: 0.6, count: 30, minH: 200, maxH: 330, color: '#1f5a38', trunk: '#3d2a18', y: 0.98 },
];

const forestLayers = LAYERS.map((layer, li) => {
  const rnd = seeded(1234 + li * 999);
  const span = world.width * layer.parallax + VIEW.w * 2;
  const trees = [];
  for (let i = 0; i < layer.count; i++) {
    trees.push({
      x: rnd() * span,
      h: layer.minH + rnd() * (layer.maxH - layer.minH),
      w: 40 + rnd() * 50,
      conifer: rnd() < 0.7,
      shade: rnd() * 0.15,
    });
  }
  return { ...layer, trees, span };
});

const fireflies = (() => {
  const rnd = seeded(77);
  const list = [];
  for (let i = 0; i < 60; i++) {
    list.push({ x: rnd() * world.width, y: 300 + rnd() * 320, phase: rnd() * Math.PI * 2, speed: 0.5 + rnd() });
  }
  return list;
})();

function drawTree(t, baseY, color, trunk) {
  ctx.fillStyle = trunk;
  ctx.fillRect(t.x - 5, baseY - t.h * 0.35, 10, t.h * 0.35);
  ctx.fillStyle = color;
  if (t.conifer) {
    const tiers = 3;
    for (let i = 0; i < tiers; i++) {
      const tierH = t.h * 0.4;
      const yTop = baseY - t.h + i * tierH * 0.6;
      const w = t.w * (0.5 + i * 0.35);
      ctx.beginPath();
      ctx.moveTo(t.x, yTop);
      ctx.lineTo(t.x - w / 2, yTop + tierH);
      ctx.lineTo(t.x + w / 2, yTop + tierH);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.ellipse(t.x, baseY - t.h * 0.6, t.w * 0.6, t.h * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBackground(camX, camY, time) {
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  sky.addColorStop(0, '#0e1d33');
  sky.addColorStop(0.5, '#1c3a3c');
  sky.addColorStop(1, '#2e5a3a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  // Moon
  ctx.fillStyle = '#f5f1d6';
  ctx.beginPath();
  ctx.arc(VIEW.w - 140 - camX * 0.02, 80 - camY * 0.05, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1c3a3c';
  ctx.beginPath();
  ctx.arc(VIEW.w - 128 - camX * 0.02, 70 - camY * 0.05, 30, 0, Math.PI * 2);
  ctx.fill();

  // Stars
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  const rnd = seeded(5);
  for (let i = 0; i < 60; i++) {
    const sx = ((rnd() * 2000 - camX * 0.05) % VIEW.w + VIEW.w) % VIEW.w;
    const sy = rnd() * 200 - camY * 0.05;
    const tw = 0.5 + 0.5 * Math.sin(time * 2 + i);
    ctx.globalAlpha = tw;
    ctx.fillRect(sx, sy, 2, 2);
  }
  ctx.globalAlpha = 1;

  // Distant hills
  ctx.fillStyle = '#0b2418';
  ctx.beginPath();
  ctx.moveTo(0, VIEW.h);
  for (let x = 0; x <= VIEW.w; x += 20) {
    const wx = x + camX * 0.08;
    const y = VIEW.h * 0.58 - camY * 0.1 + Math.sin(wx / 180) * 30 + Math.sin(wx / 71) * 12;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(VIEW.w, VIEW.h);
  ctx.closePath();
  ctx.fill();

  // Tree layers
  for (const layer of forestLayers) {
    const offset = camX * layer.parallax;
    const baseY = VIEW.h * layer.y - camY * (0.3 + layer.parallax * 0.5) + 60;
    for (const t of layer.trees) {
      let sx = ((t.x - offset) % layer.span + layer.span) % layer.span - VIEW.w * 0.5;
      if (sx < -150 || sx > VIEW.w + 150) continue;
      drawTree({ ...t, x: sx }, baseY, layer.color, layer.trunk);
    }
    // Fog band between layers
    const fog = ctx.createLinearGradient(0, baseY - 120, 0, baseY);
    fog.addColorStop(0, 'rgba(120,170,150,0)');
    fog.addColorStop(1, 'rgba(120,170,150,0.12)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, baseY - 120, VIEW.w, 120);
  }

  // Fireflies
  for (const f of fireflies) {
    const fx = f.x - camX;
    if (fx < -10 || fx > VIEW.w + 10) continue;
    const fy = f.y - camY + Math.sin(time * f.speed + f.phase) * 12;
    const a = 0.3 + 0.7 * Math.abs(Math.sin(time * 1.5 * f.speed + f.phase));
    ctx.fillStyle = `rgba(214,255,120,${a})`;
    ctx.beginPath();
    ctx.arc(fx + Math.cos(time * f.speed + f.phase) * 10, fy, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlatforms(camX, camY) {
  for (const p of platforms) {
    const x = p.x - camX;
    const y = p.y - camY;
    if (x + p.w < 0 || x > VIEW.w) continue;
    if (p.ground) {
      const dirt = ctx.createLinearGradient(0, y, 0, y + 140);
      dirt.addColorStop(0, '#6b4726');
      dirt.addColorStop(1, '#2a1a0e');
      ctx.fillStyle = dirt;
      ctx.fillRect(x, y, p.w, VIEW.h);
      // Stones and roots in the soil
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let gx = Math.floor(camX / 90) * 90; gx < camX + VIEW.w + 90; gx += 90) {
        const k = (gx / 90) | 0;
        ctx.fillRect(gx - camX + (k % 4) * 11, y + 24 + (k % 3) * 17, 14 + (k % 3) * 4, 6);
        ctx.fillRect(gx - camX + 40 + (k % 5) * 7, y + 56 + (k % 2) * 13, 8, 8);
      }
      ctx.fillStyle = '#2f6b32';
      ctx.fillRect(x, y, p.w, 12);
      ctx.fillStyle = '#4c9a3f';
      for (let gx = Math.floor(camX / 16) * 16; gx < camX + VIEW.w + 16; gx += 16) {
        const h = 6 + ((gx / 16) % 3) * 3;
        ctx.fillRect(gx - camX, y - h, 3, h);
      }
    } else {
      // Log-style platform
      ctx.fillStyle = '#5a3a1f';
      ctx.fillRect(x, y, p.w, p.h);
      ctx.fillStyle = '#7a4f2a';
      ctx.fillRect(x, y + 3, p.w, 4);
      ctx.fillStyle = '#4c9a3f';
      ctx.fillRect(x, y - 4, p.w, 5);
      ctx.fillStyle = '#3b2a1a';
      for (let i = 12; i < p.w; i += 28) ctx.fillRect(x + i, y + 8, 3, p.h - 10);
    }
  }
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------
function drawHunter(p, x, y, time, isMe) {
  const w = 30;
  const h = 48;
  const moving = Math.abs(p.vx) > 10 && p.onGround;
  const swing = moving ? Math.sin(time * 14) * 7 : 0;
  const bob = moving ? Math.abs(Math.sin(time * 14)) * 2 : 0;
  const cx = x + w / 2;

  ctx.save();
  ctx.translate(cx, y + h - bob);
  ctx.scale(p.facing, 1);
  if (p.inv) ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 25);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, bob, 15, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs (brown trousers, boots)
  ctx.fillStyle = '#4b3520';
  ctx.fillRect(-9 + swing * 0.5, -20, 7, 18);
  ctx.fillRect(2 - swing * 0.5, -20, 7, 18);
  ctx.fillStyle = '#1f1610';
  ctx.fillRect(-10 + swing * 0.5, -5, 9, 5);
  ctx.fillRect(1 - swing * 0.5, -5, 9, 5);

  // Body (green hunting jacket)
  ctx.fillStyle = '#2f6b32';
  ctx.fillRect(-10, -38, 20, 20);
  ctx.fillStyle = '#3f8a42';
  ctx.fillRect(-10, -38, 20, 4);
  // Belt
  ctx.fillStyle = '#7a4f2a';
  ctx.fillRect(-10, -22, 20, 3);

  // Arm holding rifle
  ctx.fillStyle = '#2f6b32';
  ctx.fillRect(-2, -34, 12, 6);
  // Rifle
  ctx.fillStyle = '#5a3a1f';
  ctx.fillRect(-6, -31, 14, 4);
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(6, -30, 20, 3);
  ctx.fillRect(2, -27, 5, 5);

  // Head
  ctx.fillStyle = '#f2c9a0';
  ctx.fillRect(-7, -52, 14, 14);
  // Hair (brown ponytail)
  ctx.fillStyle = '#6b3d1e';
  ctx.fillRect(-8, -54, 16, 5);
  ctx.fillRect(-9, -52, 3, 9);
  ctx.beginPath();
  ctx.moveTo(-8, -50);
  ctx.lineTo(-16, -44);
  ctx.lineTo(-14, -34);
  ctx.lineTo(-8, -40);
  ctx.closePath();
  ctx.fill();
  // Eye
  ctx.fillStyle = '#222';
  ctx.fillRect(3, -47, 2, 3);
  // Hat (hunter's hat with feather)
  ctx.fillStyle = '#3d5a2a';
  ctx.fillRect(-10, -58, 20, 6);
  ctx.fillRect(-7, -64, 14, 7);
  ctx.fillStyle = '#d63d3d';
  ctx.fillRect(4, -63, 6, 2);

  ctx.restore();

  // Name + HP bar
  ctx.globalAlpha = 1;
  ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = isMe ? '#ffd27f' : '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 3;
  ctx.strokeText(p.name, cx, y - 26);
  ctx.fillText(p.name, cx, y - 26);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(cx - 18, y - 22, 36, 5);
  ctx.fillStyle = p.hp > 40 ? '#5ad35a' : '#e04b4b';
  ctx.fillRect(cx - 18, y - 22, 36 * (p.hp / 100), 5);
}

function drawFox(f, x, y, time) {
  const w = 46;
  const h = 28;
  const moving = Math.abs(f.vx) > 10;
  const run = moving ? Math.sin(time * 18 + f.id) : 0;
  const cx = x + w / 2;

  ctx.save();
  ctx.translate(cx, y + h);
  ctx.scale(f.facing, 1);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail
  ctx.fillStyle = '#e0561f';
  ctx.beginPath();
  ctx.moveTo(-16, -16);
  ctx.quadraticCurveTo(-34, -26 + run * 4, -30, -8 + run * 3);
  ctx.quadraticCurveTo(-24, -6, -16, -10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-30, -9 + run * 3, 4, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.fillStyle = '#3a1a08';
  ctx.fillRect(-14 + run * 4, -10, 5, 10);
  ctx.fillRect(-6 - run * 4, -10, 5, 10);
  ctx.fillRect(6 + run * 4, -10, 5, 10);
  ctx.fillRect(13 - run * 4, -10, 5, 10);

  // Body
  ctx.fillStyle = '#e8641f';
  ctx.beginPath();
  ctx.ellipse(-2, -16, 18, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe3c8';
  ctx.beginPath();
  ctx.ellipse(-2, -12, 12, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#e8641f';
  ctx.beginPath();
  ctx.ellipse(16, -20, 9, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // Snout
  ctx.fillStyle = '#ffe3c8';
  ctx.beginPath();
  ctx.moveTo(19, -18);
  ctx.lineTo(27, -15);
  ctx.lineTo(19, -13);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#222';
  ctx.fillRect(25, -16, 3, 2);
  // Ears
  ctx.fillStyle = '#e0561f';
  ctx.beginPath();
  ctx.moveTo(10, -25);
  ctx.lineTo(13, -34);
  ctx.lineTo(17, -25);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(17, -26);
  ctx.lineTo(21, -34);
  ctx.lineTo(24, -25);
  ctx.closePath();
  ctx.fill();
  // Eye (angry)
  ctx.fillStyle = '#fff';
  ctx.fillRect(17, -23, 4, 3);
  ctx.fillStyle = '#111';
  ctx.fillRect(19, -23, 2, 3);
  ctx.strokeStyle = '#3a1a08';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(15, -26);
  ctx.lineTo(22, -24);
  ctx.stroke();

  ctx.restore();

  // HP bar if damaged
  if (f.hp < f.maxHp) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(cx - 14, y - 10, 28, 4);
    ctx.fillStyle = '#ff8c42';
    ctx.fillRect(cx - 14, y - 10, 28 * (f.hp / f.maxHp), 4);
  }
}

function drawBullet(b, x, y) {
  ctx.save();
  ctx.shadowColor = '#ffe27a';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#fff4b0';
  ctx.fillRect(x, y, 10, 4);
  ctx.fillStyle = '#ffb347';
  ctx.fillRect(b.dir > 0 ? x - 8 : x + 10, y + 1, 8, 2);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function drawHUD(me, snap, dt) {
  ctx.textAlign = 'left';
  ctx.font = 'bold 14px "Trebuchet MS", sans-serif';

  // Left panel
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(12, 12, 230, 74);
  ctx.fillStyle = '#ffd27f';
  ctx.fillText(`Hanka The Fox Hunter`, 22, 32);
  ctx.fillStyle = '#fff';
  ctx.fillText(`Vlna ${snap.wave}   Lišek: ${snap.foxes.length}   Ulov.: ${snap.kills}`, 22, 52);

  // HP bar
  const hp = me ? me.hp : 0;
  ctx.fillStyle = '#222';
  ctx.fillRect(22, 62, 200, 14);
  ctx.fillStyle = hp > 40 ? '#5ad35a' : '#e04b4b';
  ctx.fillRect(22, 62, 200 * (hp / 100), 14);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
  ctx.fillText(`HP ${hp}`, 26, 73);

  // Scoreboard
  const sorted = [...snap.players].sort((a, b) => b.score - a.score).slice(0, 8);
  const boardH = 26 + sorted.length * 18;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(VIEW.w - 222, 12, 210, boardH);
  ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
  ctx.fillStyle = '#ffd27f';
  ctx.fillText('Lovci', VIEW.w - 212, 30);
  ctx.textAlign = 'right';
  ctx.fillText('Body', VIEW.w - 24, 30);
  ctx.font = '13px "Trebuchet MS", sans-serif';
  sorted.forEach((p, i) => {
    const yy = 48 + i * 18;
    ctx.fillStyle = p.id === myId ? '#ffd27f' : p.alive ? '#fff' : '#999';
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}. ${p.name}${p.alive ? '' : ' ✝'}`, VIEW.w - 212, yy);
    ctx.textAlign = 'right';
    ctx.fillText(`${p.score}`, VIEW.w - 24, yy);
  });

  // Feed
  ctx.textAlign = 'left';
  ctx.font = '13px "Trebuchet MS", sans-serif';
  for (let i = feed.length - 1; i >= 0; i--) {
    const f = feed[i];
    f.life -= dt;
    if (f.life <= 0) {
      feed.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = Math.min(1, f.life);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    const yy = VIEW.h - 24 - i * 20;
    ctx.fillRect(12, yy - 14, ctx.measureText(f.text).width + 16, 18);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, 20, yy);
  }
  ctx.globalAlpha = 1;

  // Latency
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '11px monospace';
  ctx.fillText(`${latency} ms`, VIEW.w - 14, VIEW.h - 10);

  // Death overlay
  if (me && !me.alive) {
    ctx.fillStyle = 'rgba(80,0,0,0.45)';
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px "Trebuchet MS", sans-serif';
    ctx.fillText('Lišky tě dostaly!', VIEW.w / 2, VIEW.h / 2 - 10);
    ctx.font = '20px "Trebuchet MS", sans-serif';
    ctx.fillText(`Zpátky do lesa za ${me.respawn} s…`, VIEW.w / 2, VIEW.h / 2 + 28);
  }
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
let lastFrame = performance.now();

function interpolated(kind, alpha) {
  const curr = currSnap.data[kind];
  if (!prevSnap) return curr.map((e) => ({ ...e, rx: e.x, ry: e.y }));
  const prevById = new Map(prevSnap.data[kind].map((e) => [e.id, e]));
  return curr.map((e) => {
    const p = prevById.get(e.id);
    if (!p || Math.abs(p.x - e.x) > 300) return { ...e, rx: e.x, ry: e.y };
    return { ...e, rx: lerp(p.x, e.x, alpha), ry: lerp(p.y, e.y, alpha) };
  });
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  const time = now / 1000;

  if (!currSnap) {
    drawBackground(0, 0, time);
    drawPlatforms(0, 0);
    return;
  }

  const snap = currSnap.data;
  let alpha = 1;
  if (prevSnap) {
    const span = Math.max(1, currSnap.at - prevSnap.at);
    alpha = clamp((now - currSnap.at) / span, 0, 1);
  }

  const playersR = interpolated('players', alpha);
  const foxesR = interpolated('foxes', alpha);
  const bulletsR = interpolated('bullets', alpha);
  const me = playersR.find((p) => p.id === myId);

  // Camera
  const targetX = me ? me.rx + 15 - VIEW.w / 2 : world.width / 2 - VIEW.w / 2;
  const targetY = me ? me.ry + 24 - VIEW.h * 0.62 : world.height - VIEW.h;
  const camX = clamp(targetX, 0, world.width - VIEW.w);
  const camY = clamp(targetY, 0, world.height - VIEW.h);

  shake = Math.max(0, shake - dt * 30);
  const sx = shake ? rand(-shake, shake) : 0;
  const sy = shake ? rand(-shake, shake) : 0;

  ctx.save();
  ctx.translate(sx, sy);
  drawBackground(camX, camY, time);
  drawPlatforms(camX, camY);

  for (const b of bulletsR) drawBullet(b, b.rx - camX, b.ry - camY);
  for (const f of foxesR) drawFox(f, f.rx - camX, f.ry - camY, time);
  for (const p of playersR) {
    if (!p.alive) continue;
    drawHunter(p, p.rx - camX, p.ry - camY, time, p.id === myId);
  }

  // Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.life -= dt;
    if (pt.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    pt.vy += pt.gravity * dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - camX, pt.y - camY, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;

  // Floating texts
  ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.life -= dt;
    ft.y -= 40 * dt;
    if (ft.life <= 0) {
      floatingTexts.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = clamp(ft.life, 0, 1);
    ctx.fillStyle = ft.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.strokeText(ft.text, ft.x - camX, ft.y - camY);
    ctx.fillText(ft.text, ft.x - camX, ft.y - camY);
  }
  ctx.globalAlpha = 1;

  // Vignette
  const vg = ctx.createRadialGradient(VIEW.w / 2, VIEW.h / 2, VIEW.h * 0.45, VIEW.w / 2, VIEW.h / 2, VIEW.w * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.restore();

  drawHUD(me, snap, dt);
}

requestAnimationFrame(frame);
