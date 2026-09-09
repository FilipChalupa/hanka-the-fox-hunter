'use strict';

// ===========================================================================
// Setup
// ===========================================================================
const S = window.Shared;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const VIEW = { w: 960, h: 540 };
const ZOOM = 1.35;
const CAM = { w: VIEW.w / ZOOM, h: VIEW.h / ZOOM };
let renderScale = 1;

const overlay = document.getElementById('overlay');
const nameInput = document.getElementById('name');
const playBtn = document.getElementById('play');
const statusEl = document.getElementById('status');
const previewCanvas = document.getElementById('preview');
const outfitNameEl = document.getElementById('outfitName');
const boardEl = document.getElementById('board');

const FONT_TITLE = '"Cinzel", "Georgia", serif';
const FONT_BODY = '"Nunito", "Trebuchet MS", sans-serif';

const clamp = S.clamp;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

let ws = null;
let myId = 0;
let myToken = null;
let myName = '';
let world = S.generateWorld(1);
let reconnectTries = 0;
let wantReconnect = false;

let prevSnap = null;
let currSnap = null;

// Client-side prediction of my own hunter
const pred = { x: 0, y: 0, vx: 0, vy: 0, w: S.PLAYER.w, h: S.PLAYER.h, onGround: false, climbing: false, dashT: 0, dashDir: 1, dashCd: 0, jumpHeld: false, jumpTime: 0, facing: 1, speedBoost: false, alive: true };
let predActive = false;
let inputSeq = 0;
const inputHistory = [];
let renderOff = { x: 0, y: 0 };
let pendingDash = 0;
let pendingUse = false;
let lastInputSent = 0;
let lastInputKey = '';

// Local effect state
const particles = [];
const floatingTexts = [];
const feed = [];
const dyingFoxes = [];
const flashes = [];
const scoreFlyers = [];
const leaves = [];
const rainDrops = [];
const anims = new Map();
const emoteBubbles = new Map();
const hornRings = [];
let shake = 0;
let hitStop = 0;
let hurtFlash = 0;
let lightningFlash = 0;
let latency = 0;
let banner = null;
let gameOver = null;
let ghostHint = 0;
let scoreShown = 0;
let scoreBump = 0;
let owl = null;
let owlTimer = 8;
let camX = 0;
let camY = 0;
let camLook = 0;
let camInit = false;

const EMOTES = ['', '👍 Dobrá!', '🆘 Pomoc!', '😂', '❤️ Díky'];
const PICKUP_INFO = {
  medkit: { label: 'Lékárnička', icon: '✚', color: '#e8383d' },
  shotgun: { label: 'Brokovnice', icon: '⋔', color: '#ffb347' },
  rapid: { label: 'Rychlopalba', icon: '⚡', color: '#ffe066' },
  speed: { label: 'Rychlé nohy', icon: '»', color: '#7fe0a8' },
  stink: { label: 'Smrad', icon: '☁', color: '#9fd66b' },
  incendiary: { label: 'Zápalné náboje', icon: '✹', color: '#ff8c42' },
  double: { label: 'Dvojité body', icon: '×2', color: '#ffd27f' },
  disguise: { label: 'Liščí převlek', icon: 'ᗢ', color: '#e0561f' },
  trap: { label: 'Past', icon: '⌗', color: '#c9c9c9', held: true, hint: 'polož past' },
  horn: { label: 'Lovecký roh', icon: '♪', color: '#d9b44a', held: true, hint: 'zatrub' },
  seed: { label: 'Semínko', icon: '❀', color: '#7fe0a8', held: true, hint: 'zasaď strom' },
  lantern: { label: 'Světluška', icon: '✺', color: '#d6ff78', held: true, hint: 'postav lucernu' },
  bait: { label: 'Vnadidlo', icon: '♨', color: '#e07a5f', held: true, hint: 'polož maso' },
  curse: { label: 'Prokletí!', icon: '☠', color: '#c9b3ff' },
};
const WEATHER_INFO = {
  clear: { label: '', icon: '' },
  fog: { label: 'Mlha', icon: '🌫️', sub: 'Vidíš jen kousek před sebe.' },
  rain: { label: 'Déšť', icon: '🌧️', sub: 'Ohně hasnou rychleji.' },
  storm: { label: 'Bouřka', icon: '⛈️', sub: 'Blesky osvítí les. A občas trefí lišku.' },
};

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  renderScale = w / VIEW.w;
}
window.addEventListener('resize', resizeCanvas);

// ===========================================================================
// Outfits
// ===========================================================================
const OUTFITS = [
  { name: 'Myslivec', jacket: '#2f6b32', trim: '#3f8a42', trousers: '#4b3520', hair: '#6b3d1e', hat: '#3d5a2a', feather: '#d63d3d', skin: '#f2c9a0' },
  { name: 'Rudý kabát', jacket: '#b8322d', trim: '#d94a44', trousers: '#2c2c3a', hair: '#2b1a10', hat: '#7a1f1c', feather: '#f2d16b', skin: '#f2c9a0' },
  { name: 'Modrý kabát', jacket: '#2a4f9e', trim: '#3a6bd1', trousers: '#3b2a1a', hair: '#e8c46a', hat: '#1f3a75', feather: '#ffffff', skin: '#f5d5b5' },
  { name: 'Fialový plášť', jacket: '#6b2f8a', trim: '#8a45ad', trousers: '#26262e', hair: '#1a1a1a', hat: '#4a1f63', feather: '#7fe0a8', skin: '#c9a27a' },
  { name: 'Oranžová vesta', jacket: '#d9772a', trim: '#f09443', trousers: '#4b3520', hair: '#8a2b1a', hat: '#a85a1c', feather: '#2f6b32', skin: '#f2c9a0' },
  { name: 'Tyrkysový', jacket: '#1f7a7a', trim: '#2a9e9e', trousers: '#2c2c3a', hair: '#d1d1d1', hat: '#145454', feather: '#ffb347', skin: '#e8b98f' },
  { name: 'Žlutý pytlák', jacket: '#c9a417', trim: '#e6c02a', trousers: '#3b2a1a', hair: '#5a2d0c', hat: '#8a6f0d', feather: '#2a4f9e', skin: '#f5d5b5' },
  { name: 'Růžová lovkyně', jacket: '#c9407a', trim: '#e05b94', trousers: '#26262e', hair: '#3a1f14', hat: '#8f2a55', feather: '#7fd1ff', skin: '#f2c9a0' },
];
const outfitOf = (p) => OUTFITS[(p.outfit || 0) % OUTFITS.length];
let chosenOutfit = -1;

// ===========================================================================
// Audio
// ===========================================================================
let audioCtx = null;
let ambientStarted = false;
let rainNode = null;
let footTimer = 0;
let heartTimer = 0;

function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      audioCtx = null;
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (audioCtx && !ambientStarted) {
    ambientStarted = true;
    startAmbient();
  }
}

function noiseBuffer(seconds, brown) {
  const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * seconds), audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = white;
  }
  return buf;
}

function playTone({ type = 'square', from = 440, to = 220, dur = 0.1, gain = 0.08, noise = false, delay = 0, filterType = 'lowpass' }) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + delay;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(audioCtx.destination);
  if (noise) {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer(dur, false);
    const filter = audioCtx.createBiquadFilter();
    filter.type = filterType;
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

function startAmbient() {
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer(4, true);
  src.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 380;
  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 0.12;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();
  const g = audioCtx.createGain();
  g.gain.value = 0.05;
  src.connect(filter).connect(g).connect(audioCtx.destination);
  src.start();

  const cricket = () => {
    if (!audioCtx) return;
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) playTone({ type: 'sine', from: 4300, to: 4100, dur: 0.03, gain: 0.012, delay: i * 0.07 });
    setTimeout(cricket, rand(500, 1800));
  };
  setTimeout(cricket, 800);
  const hoot = () => {
    if (!audioCtx) return;
    playTone({ type: 'sine', from: 390, to: 330, dur: 0.35, gain: 0.05 });
    playTone({ type: 'sine', from: 370, to: 300, dur: 0.5, gain: 0.05, delay: 0.45 });
    setTimeout(hoot, rand(14000, 30000));
  };
  setTimeout(hoot, rand(5000, 12000));
}

function setRainSound(on) {
  if (!audioCtx) return;
  if (on && !rainNode) {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer(3, false);
    src.loop = true;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600;
    filter.Q.value = 0.6;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.06, audioCtx.currentTime + 1.5);
    src.connect(filter).connect(g).connect(audioCtx.destination);
    src.start();
    rainNode = { src, g };
  } else if (!on && rainNode) {
    const { src, g } = rainNode;
    rainNode = null;
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1.5);
    setTimeout(() => src.stop(), 1600);
  }
}

const SFX = {
  shoot: () => {
    playTone({ noise: true, from: 3200, to: 300, dur: 0.14, gain: 0.14 });
    playTone({ type: 'square', from: 180, to: 60, dur: 0.08, gain: 0.05 });
  },
  shotgun: () => {
    playTone({ noise: true, from: 2200, to: 120, dur: 0.3, gain: 0.2 });
    playTone({ type: 'square', from: 120, to: 40, dur: 0.18, gain: 0.08 });
  },
  rapid: () => playTone({ noise: true, from: 3800, to: 600, dur: 0.06, gain: 0.08 }),
  hit: () => playTone({ type: 'triangle', from: 300, to: 120, dur: 0.08, gain: 0.06 }),
  kill: () => {
    playTone({ type: 'sawtooth', from: 900, to: 200, dur: 0.25, gain: 0.07 });
    playTone({ noise: true, from: 800, to: 100, dur: 0.25, gain: 0.05 });
  },
  hurt: () => playTone({ type: 'square', from: 200, to: 80, dur: 0.2, gain: 0.08 }),
  jump: () => playTone({ type: 'sine', from: 300, to: 600, dur: 0.1, gain: 0.04 }),
  land: () => playTone({ noise: true, from: 500, to: 100, dur: 0.08, gain: 0.04 }),
  step: () => playTone({ noise: true, from: 700, to: 150, dur: 0.05, gain: 0.025 }),
  heart: () => {
    playTone({ type: 'sine', from: 70, to: 45, dur: 0.12, gain: 0.12 });
    playTone({ type: 'sine', from: 60, to: 40, dur: 0.14, gain: 0.09, delay: 0.16 });
  },
  breath: () => playTone({ noise: true, from: 900, to: 400, dur: 0.5, gain: 0.02, filterType: 'bandpass' }),
  dash: () => playTone({ noise: true, from: 1500, to: 4000, dur: 0.16, gain: 0.06, filterType: 'bandpass' }),
  grab: () => playTone({ noise: true, from: 400, to: 200, dur: 0.1, gain: 0.05 }),
  death: () => playTone({ type: 'sawtooth', from: 400, to: 40, dur: 0.6, gain: 0.1 }),
  wave: () => {
    playTone({ type: 'triangle', from: 330, to: 330, dur: 0.25, gain: 0.07 });
    playTone({ type: 'triangle', from: 440, to: 440, dur: 0.25, gain: 0.07, delay: 0.22 });
    playTone({ type: 'triangle', from: 660, to: 660, dur: 0.5, gain: 0.08, delay: 0.44 });
  },
  bite: () => playTone({ noise: true, from: 1500, to: 200, dur: 0.1, gain: 0.05 }),
  respawn: () => playTone({ type: 'sine', from: 500, to: 900, dur: 0.3, gain: 0.05 }),
  clash: () => {
    playTone({ type: 'sine', from: 1800, to: 300, dur: 0.35, gain: 0.12 });
    playTone({ noise: true, from: 4000, to: 200, dur: 0.4, gain: 0.12 });
  },
  pickup: () => {
    playTone({ type: 'sine', from: 660, to: 660, dur: 0.1, gain: 0.06 });
    playTone({ type: 'sine', from: 880, to: 880, dur: 0.15, gain: 0.06, delay: 0.1 });
    playTone({ type: 'sine', from: 1320, to: 1320, dur: 0.25, gain: 0.06, delay: 0.2 });
  },
  thunder: () => {
    playTone({ noise: true, from: 300, to: 40, dur: 1.6, gain: 0.18 });
    playTone({ type: 'sine', from: 80, to: 30, dur: 1.2, gain: 0.1 });
  },
  rubble: () => playTone({ noise: true, from: 600, to: 60, dur: 0.6, gain: 0.12 }),
  horn: () => {
    playTone({ type: 'sawtooth', from: 220, to: 230, dur: 0.5, gain: 0.09 });
    playTone({ type: 'sawtooth', from: 330, to: 340, dur: 0.6, gain: 0.09, delay: 0.45 });
    playTone({ type: 'sawtooth', from: 440, to: 430, dur: 0.9, gain: 0.1, delay: 1.0 });
  },
  snap: () => {
    playTone({ noise: true, from: 2500, to: 300, dur: 0.08, gain: 0.12 });
    playTone({ type: 'square', from: 500, to: 150, dur: 0.1, gain: 0.06 });
  },
  place: () => playTone({ noise: true, from: 500, to: 150, dur: 0.12, gain: 0.05 }),
  grow: () => {
    playTone({ type: 'sine', from: 300, to: 600, dur: 0.4, gain: 0.05 });
    playTone({ type: 'sine', from: 450, to: 900, dur: 0.5, gain: 0.05, delay: 0.2 });
  },
  curse: () => {
    playTone({ type: 'sawtooth', from: 200, to: 60, dur: 0.7, gain: 0.12 });
    playTone({ type: 'square', from: 90, to: 40, dur: 0.6, gain: 0.08, delay: 0.1 });
  },
  pop: () => playTone({ type: 'sine', from: 900, to: 300, dur: 0.08, gain: 0.05 }),
};

// ===========================================================================
// Input
// ===========================================================================
const input = { left: false, right: false, jump: false, shoot: false, down: false, revive: false };
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  ArrowDown: 'down', KeyS: 'down',
  // Ctrl is deliberately not a shoot key: Ctrl+W (shoot + jump) would close the tab.
  ShiftLeft: 'shoot', ShiftRight: 'shoot', KeyF: 'shoot', KeyX: 'shoot', KeyJ: 'shoot', KeyK: 'shoot',
  KeyE: 'revive',
  KeyQ: 'use',
};
const EMOTE_KEYS = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4 };
const lastTap = { left: 0, right: 0 };

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function currentInput() {
  return { left: input.left, right: input.right, jump: input.jump, down: input.down, shoot: input.shoot, revive: input.revive, dash: pendingDash, use: pendingUse };
}

function sendInput(force) {
  if (!myId) return;
  const key = `${input.left}${input.right}${input.jump}${input.shoot}${input.down}${input.revive}${pendingDash}${pendingUse}`;
  const now = performance.now();
  if (!force && key === lastInputKey && now - lastInputSent < 50) return;
  lastInputKey = key;
  lastInputSent = now;
  send({ t: 'input', ...currentInput(), seq: inputSeq });
}

function requestDash(dir) {
  pendingDash = dir;
}

window.addEventListener('keydown', (e) => {
  if (document.activeElement === nameInput) return;
  if (EMOTE_KEYS[e.code] && !e.repeat) send({ t: 'emote', n: EMOTE_KEYS[e.code] });
  const action = KEYMAP[e.code];
  if (!action) return;
  e.preventDefault();
  if (e.repeat) return;
  if (action === 'left' || action === 'right') {
    const now = performance.now();
    if (now - lastTap[action] < 260) requestDash(action === 'right' ? 1 : -1);
    lastTap[action] = now;
  }
  if (action === 'use') {
    pendingUse = true;
    return;
  }
  if (!input[action]) {
    input[action] = true;
    ensureAudio();
  }
});
window.addEventListener('keyup', (e) => {
  const action = KEYMAP[e.code];
  if (!action) return;
  e.preventDefault();
  input[action] = false;
});
window.addEventListener('blur', () => {
  for (const k in input) input[k] = false;
});
canvas.addEventListener('mousedown', () => ensureAudio());
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Accidental Ctrl+W / tab close while playing: ask first (the browser shows its own dialog).
window.addEventListener('beforeunload', (e) => {
  if (!myId) return;
  e.preventDefault();
  e.returnValue = '';
});

// Fullscreen with Keyboard Lock: in fullscreen Chrome lets the page keep Ctrl+W, Alt+Tab etc.
const fsBtn = document.getElementById('fs');
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (navigator.keyboard && navigator.keyboard.lock) await navigator.keyboard.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyX', 'KeyJ', 'KeyK', 'KeyE', 'Space', 'Escape']);
    }
  } catch {
    /* fullscreen not allowed here; nothing to do */
  }
}
if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
window.addEventListener('keydown', (e) => {
  if (e.code === 'F11' && document.activeElement !== nameInput) {
    e.preventDefault();
    toggleFullscreen();
  }
});
document.addEventListener('fullscreenchange', () => {
  if (fsBtn) fsBtn.textContent = document.fullscreenElement ? '⤡' : '⛶';
});

if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  document.body.classList.add('touch');
  for (const btn of document.querySelectorAll('.tbtn')) {
    const key = btn.dataset.key;
    const on = (e) => {
      e.preventDefault();
      ensureAudio();
      btn.classList.add('active');
      if (key === 'dash') requestDash(pred.facing || 1);
      else if (key === 'use') pendingUse = true;
      else input[key] = true;
    };
    const off = (e) => {
      e.preventDefault();
      btn.classList.remove('active');
      if (key !== 'dash' && key !== 'use') input[key] = false;
    };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
  }
  for (const btn of document.querySelectorAll('#emotes button')) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      send({ t: 'emote', n: Number(btn.dataset.emote) });
    });
  }
  const joy = document.getElementById('joy');
  const knob = document.getElementById('knob');
  let joyPointer = null;
  const setJoy = (dx, dy) => {
    const max = 50;
    const len = Math.hypot(dx, dy);
    const k = len > max ? max / len : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const dead = 16;
    input.left = dx < -dead;
    input.right = dx > dead;
    input.jump = dy < -dead * 1.4;
    input.down = dy > dead * 1.4;
  };
  joy.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudio();
    joyPointer = e.pointerId;
    joy.setPointerCapture(e.pointerId);
    const r = joy.getBoundingClientRect();
    setJoy(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  });
  joy.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joyPointer) return;
    const r = joy.getBoundingClientRect();
    setJoy(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  });
  const joyEnd = (e) => {
    if (e.pointerId !== joyPointer) return;
    joyPointer = null;
    knob.style.transform = '';
    input.left = input.right = input.jump = input.down = false;
  };
  joy.addEventListener('pointerup', joyEnd);
  joy.addEventListener('pointercancel', joyEnd);
}

// ===========================================================================
// Networking
// ===========================================================================
function connect(name) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  statusEl.textContent = reconnectTries ? `Obnovuji spojení… (${reconnectTries})` : 'Připojuji…';
  myName = name;

  ws.addEventListener('open', () => {
    send({ t: 'join', name, outfit: chosenOutfit >= 0 ? chosenOutfit : undefined, token: myToken || undefined });
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
      myToken = msg.token;
      try {
        localStorage.setItem('hanka-token', myToken);
      } catch {}
      world = msg.world;
      buildScenery(world.seed);
      camInit = false;
      predActive = false;
      inputHistory.length = 0;
      overlay.classList.add('hidden');
      statusEl.textContent = '';
      wantReconnect = true;
      reconnectTries = 0;
      lastInputKey = '';
      addFeed(msg.rejoined ? `Vítej zpět, ${msg.name}! Tvoje tělo tu na tebe počkalo.` : `Vítej v lese, ${msg.name}!`, '#ffd27f');
    } else if (msg.t === 'state' || msg.t === 'delta') {
      const data = msg.t === 'state' ? msg : currSnap ? S.applyDelta(currSnap.data, msg) : null;
      if (!data) return;
      prevSnap = currSnap;
      currSnap = { data, at: performance.now() };
      if (data.round.over && !gameOver) gameOver = { ranking: [...data.players].sort((a, b) => b.score - a.score).map((p) => ({ ...p, badges: [] })), wave: data.wave, kills: data.kills, t: 0 };
      if (!data.round.over && gameOver) gameOver = null;
      reconcile(data);
      handleEvents(data.events);
    } else if (msg.t === 'pong') {
      latency = Math.round(performance.now() - msg.ts);
    }
  });

  ws.addEventListener('close', () => {
    const hadId = myId;
    myId = 0;
    prevSnap = currSnap = null;
    predActive = false;
    overlay.classList.remove('hidden');
    if (wantReconnect && hadId && reconnectTries < 8) {
      reconnectTries++;
      statusEl.textContent = `Spojení se přerušilo. Zkouším znovu za chvilku… (${reconnectTries})`;
      setTimeout(() => connect(myName), Math.min(6000, 800 * reconnectTries));
    } else statusEl.textContent = 'Spojení se serverem bylo přerušeno.';
  });
  ws.addEventListener('error', () => {
    statusEl.textContent = 'Nepodařilo se připojit k serveru.';
  });
}

setInterval(() => send({ t: 'ping', ts: performance.now() }), 2000);

// ===========================================================================
// Prediction: my hunter moves immediately, the server confirms later
// ===========================================================================
function serverMe(data) {
  return data.players.find((p) => p.id === myId);
}

function reconcile(data) {
  const me = serverMe(data);
  if (!me) return;
  const before = { x: pred.x, y: pred.y };
  const wasActive = predActive;
  Object.assign(pred, {
    x: me.x, y: me.y, vx: me.vx, vy: me.vy || 0, onGround: me.onGround, climbing: me.climbing, alive: me.alive,
    dashT: me.dash ? Math.max(pred.dashT, 0.05) : 0, dashDir: me.dashDir || pred.dashDir, dashCd: me.dashCd || 0,
    jumpHeld: me.jumpHeld, jumpTime: me.jumpTime || 0, facing: me.facing, speedBoost: me.speedT > 0,
  });
  // Drop acknowledged inputs, replay the rest on top of the server state.
  while (inputHistory.length && inputHistory[0].seq <= me.seq) inputHistory.shift();
  for (const h of inputHistory) {
    if (pred.alive) S.movePlayer(pred, h.inp, h.dt, world);
    else S.moveGhost(pred, h.inp, h.dt);
  }
  if (wasActive) {
    const ex = before.x - pred.x;
    const ey = before.y - pred.y;
    if (Math.abs(ex) < 120 && Math.abs(ey) < 120) {
      renderOff.x += ex;
      renderOff.y += ey;
    } else renderOff = { x: 0, y: 0 };
  }
  predActive = true;
}

function predictStep(dt) {
  if (!predActive || !currSnap) return;
  if (gameOver) return;
  const inp = currentInput();
  inputSeq++;
  inputHistory.push({ seq: inputSeq, inp: { ...inp }, dt });
  if (inputHistory.length > 240) inputHistory.shift();
  if (pred.alive) {
    const happened = S.movePlayer(pred, inp, dt, world);
    for (const h of happened) {
      if (h === 'jump') SFX.jump();
      if (h === 'dash') {
        SFX.dash();
        shake = Math.max(shake, 2);
      }
      if (h === 'grab') SFX.grab();
      if (h === 'land') SFX.land();
    }
  } else S.moveGhost(pred, inp, dt);
  sendInput(pendingDash !== 0 || pendingUse);
  pendingDash = 0;
  pendingUse = false;
  // Error smoothing: the render offset melts away over ~100 ms
  const k = Math.min(1, dt * 12);
  renderOff.x -= renderOff.x * k;
  renderOff.y -= renderOff.y * k;
}

// ===========================================================================
// Start screen
// ===========================================================================
function updateOutfitLabel() {
  outfitNameEl.textContent = chosenOutfit < 0 ? 'Automaticky' : OUTFITS[chosenOutfit].name;
}
document.getElementById('outfitPrev').addEventListener('click', () => {
  chosenOutfit = chosenOutfit <= -1 ? OUTFITS.length - 1 : chosenOutfit - 1;
  updateOutfitLabel();
});
document.getElementById('outfitNext').addEventListener('click', () => {
  chosenOutfit = chosenOutfit >= OUTFITS.length - 1 ? -1 : chosenOutfit + 1;
  updateOutfitLabel();
});
playBtn.addEventListener('click', () => {
  ensureAudio();
  const name = nameInput.value.trim() || 'Hanka';
  try {
    localStorage.setItem('hanka-name', name);
    localStorage.setItem('hanka-outfit', String(chosenOutfit));
  } catch {}
  reconnectTries = 0;
  connect(name);
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') playBtn.click();
});
try {
  nameInput.value = localStorage.getItem('hanka-name') || '';
  myToken = localStorage.getItem('hanka-token') || null;
  const o = parseInt(localStorage.getItem('hanka-outfit'), 10);
  if (Number.isInteger(o) && o >= -1 && o < OUTFITS.length) chosenOutfit = o;
} catch {}
updateOutfitLabel();
nameInput.focus();

function fillBoard(listEl, rows, fmt) {
  listEl.innerHTML = '';
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'zatím nikdo';
    listEl.appendChild(li);
    return;
  }
  for (const r of rows) {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = r.name;
    li.appendChild(b);
    li.appendChild(document.createTextNode(` · ${fmt(r)}`));
    listEl.appendChild(li);
  }
}

async function loadLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    fillBoard(document.getElementById('boardScore'), data.bestRound, (r) => `${r.score} b.`);
    fillBoard(document.getElementById('boardWave'), data.highestWave, (r) => `vlna ${r.wave}`);
    fillBoard(document.getElementById('boardKills'), data.mostKills, (r) => `${r.kills} lišek`);
    boardEl.hidden = false;
  } catch {
    /* offline or no API: keep the panel hidden */
  }
}
loadLeaderboard();

const urlName = new URLSearchParams(location.search).get('name');
if (urlName) {
  nameInput.value = urlName;
  playBtn.click();
}
if (document.fonts && document.fonts.load) {
  document.fonts.load(`900 20px ${FONT_TITLE}`);
  document.fonts.load(`800 14px ${FONT_BODY}`);
}

// ===========================================================================
// Effects & events
// ===========================================================================
function playerName(id) {
  const p = currSnap && currSnap.data.players.find((pl) => pl.id === id);
  return p ? p.name : '?';
}

function addFeed(text, color = '#fff') {
  feed.unshift({ text, color, life: 6 });
  if (feed.length > 6) feed.pop();
}

function announce(title, sub, color = '#e8d9ff', glow = '#7a4fd1', maxT = 3.5) {
  banner = { title, sub, color, glow, t: 0, maxT };
}

function burst(x, y, n, opts) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(opts.minSpeed || 40, opts.maxSpeed || 200);
    particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (opts.up || 0),
      life: rand(0.3, opts.life || 0.7), maxLife: opts.life || 0.7, size: rand(2, opts.size || 5),
      color: opts.colors[Math.floor(Math.random() * opts.colors.length)], gravity: opts.gravity ?? 500, round: !!opts.round,
    });
  }
}

function dust(x, y, n = 6) {
  burst(x, y, n, { colors: ['#b7a37a', '#8d7b55', '#d8c9a3'], minSpeed: 20, maxSpeed: 80, life: 0.4, size: 4, gravity: 120, up: 30, round: true });
}

function spawnLeafBurst(x, y, n) {
  for (let i = 0; i < n; i++) {
    const rnd = Math.random();
    leaves.push({ x: x + rand(-60, 60), y: y + rand(-30, 20), vx: rand(-30, 30), vy: rand(30, 70), rot: rand(0, 6), spin: rand(-4, 4), phase: rand(0, 10), color: rnd < 0.4 ? '#c9742b' : rnd < 0.7 ? '#d9a441' : '#7fa843', size: rand(3, 5) });
  }
}

function anim(id) {
  let a = anims.get(id);
  if (!a) {
    a = { squash: 0, recoil: 0, bite: 0, hurt: 0, wasGround: true, lastSeen: 0 };
    anims.set(id, a);
  }
  return a;
}

function handleEvents(events) {
  if (!events) return;
  for (const ev of events) {
    switch (ev.kind) {
      case 'shoot': {
        const big = ev.weapon === 'shotgun';
        burst(ev.x + ev.dir * 6, ev.y + 2, big ? 10 : 5, { colors: ['#ffe27a', '#ffb347', '#fff'], minSpeed: 30, maxSpeed: big ? 220 : 140, life: 0.2, size: 3, gravity: 0 });
        flashes.push({ x: ev.x + ev.dir * 12, y: ev.y + 2, r: big ? 200 : 150, t: 0.12, maxT: 0.12, color: '255,210,120' });
        anim(ev.id).recoil = 1;
        if (big) SFX.shotgun();
        else if (ev.weapon === 'rapid') SFX.rapid();
        else SFX.shoot();
        break;
      }
      case 'ignite':
        burst(ev.x, ev.fireY, 10, { colors: ['#ffd27f', '#ff8c42', '#ffffff'], minSpeed: 30, maxSpeed: 160, life: 0.4, size: 3, gravity: 100 });
        flashes.push({ x: ev.x, y: ev.fireY - 10, r: 120, t: 0.2, maxT: 0.2, color: '255,200,120' });
        break;
      case 'place':
        dust(ev.x, ev.y, 5);
        SFX.place();
        break;
      case 'trap':
        burst(ev.x, ev.y, 10, { colors: ['#c9c9c9', '#8a8a8a', '#e0561f'], minSpeed: 40, maxSpeed: 180, life: 0.5, size: 3 });
        floatingTexts.push({ x: ev.x, y: ev.y - 40, text: 'Chycena!', color: '#c9c9c9', life: 1.2, size: 13 });
        SFX.snap();
        break;
      case 'horn':
        hornRings.push({ x: ev.x, y: ev.y, t: 0 });
        addFeed(`📯 ${playerName(ev.id)} zatroubil(a) na roh, lišky se sbíhají!`, '#d9b44a');
        shake = Math.max(shake, 3);
        SFX.horn();
        break;
      case 'seed':
        burst(ev.x, ev.y, 8, { colors: ['#6b4726', '#7fe0a8'], minSpeed: 20, maxSpeed: 80, life: 0.5, size: 3, up: 40 });
        SFX.place();
        break;
      case 'noplant':
        floatingTexts.push({ x: ev.x, y: ev.y - 10, text: 'Tady strom nevyroste', color: '#ffb3a7', life: 1.2, size: 12 });
        break;
      case 'treegrown':
        if (ev.trunk && !world.trunks.some((t) => t.id === ev.trunk.id)) {
          world.trunks.push(ev.trunk);
          world.platforms.push(...(ev.platforms || []));
        }
        spawnLeafBurst(ev.x, ev.y, 20);
        burst(ev.x, ev.y + 60, 16, { colors: ['#7fe0a8', '#3f9a5a', '#fff6c2'], minSpeed: 30, maxSpeed: 160, life: 0.8, gravity: -40, round: true });
        addFeed('🌳 Vyrostl nový strom!', '#7fe0a8');
        shake = Math.max(shake, 4);
        SFX.grow();
        break;
      case 'treefire':
        addFeed('🔥 Strom hoří! Slez dolů.', '#ffb347');
        SFX.rubble();
        break;
      case 'treeburnt': {
        const idx = world.trunks.findIndex((t) => t.id === ev.id);
        if (idx >= 0) world.trunks.splice(idx, 1);
        world.platforms = world.platforms.filter((pl) => pl.trunk !== ev.id);
        burst(ev.x, ev.y + 100, 40, { colors: ['#3b2a1a', '#5e6a66', '#ff8c42', '#222'], minSpeed: 40, maxSpeed: 260, life: 1.2, size: 6, up: 120 });
        shake = Math.max(shake, 8);
        addFeed('🪵 Strom shořel na popel.', '#a08c78');
        SFX.rubble();
        break;
      }
      case 'curse':
        burst(ev.x, ev.y, 26, { colors: ['#c9b3ff', '#7a4fd1', '#3b2a1a'], minSpeed: 40, maxSpeed: 240, life: 0.8, size: 5, up: 120 });
        if (ev.id === myId) {
          shake = 12;
          hurtFlash = 0.6;
          floatingTexts.push({ x: ev.x, y: ev.y - 60, text: 'PROKLETÍ!', color: '#c9b3ff', life: 1.5, size: 18 });
        }
        SFX.curse();
        break;
      case 'lureend':
        burst(ev.x, ev.y, 8, { colors: ['#e07a5f', '#d6ff78'], minSpeed: 20, maxSpeed: 80, life: 0.5, size: 3, up: 30 });
        break;
      case 'clash':
        burst(ev.x, ev.y, 26, { colors: ['#fff6c2', '#ffd27f', '#ff8c42', '#ffffff'], minSpeed: 60, maxSpeed: 320, life: 0.6, size: 4, gravity: 200 });
        flashes.push({ x: ev.x, y: ev.y, r: 260, t: 0.35, maxT: 0.35, color: '255,240,200' });
        shake = Math.max(shake, 9);
        hitStop = 0.05;
        addFeed('💥 Střely se střetly, vzplál oheň!', '#ffb347');
        SFX.clash();
        break;
      case 'ff':
        burst(ev.x, ev.y, 6, { colors: ['#d61f1f', '#ffb3a7'], life: 0.4 });
        if (ev.by === myId) floatingTexts.push({ x: ev.x, y: ev.y - 16, text: 'Kamarád!', color: '#ffb3a7', life: 0.9, size: 12 });
        break;
      case 'pickup': {
        if (ev.item === 'curse') break;
        const info = PICKUP_INFO[ev.item] || { label: ev.item, color: '#fff' };
        burst(ev.x, ev.y, 14, { colors: [info.color, '#ffffff'], minSpeed: 30, maxSpeed: 160, life: 0.6, gravity: -60, round: true });
        flashes.push({ x: ev.x, y: ev.y, r: 120, t: 0.4, maxT: 0.4, color: '255,255,220' });
        floatingTexts.push({ x: ev.x, y: ev.y - 20, text: info.label, color: info.color, life: 1.1, size: 13 });
        if (ev.id === myId) SFX.pickup();
        break;
      }
      case 'emote':
        emoteBubbles.set(ev.id, { n: ev.n, t: 2.2 });
        break;
      case 'revived':
        burst(ev.x, ev.y, 22, { colors: ['#dff3ff', '#7fe0a8', '#ffffff'], minSpeed: 20, maxSpeed: 150, life: 1, gravity: -80, round: true });
        flashes.push({ x: ev.x, y: ev.y, r: 180, t: 0.6, maxT: 0.6, color: '200,240,255' });
        addFeed(`✨ ${ev.byName} oživil(a) hráče ${ev.name}`, '#a8e6a1');
        if (ev.id === myId) {
          ghostHint = 0;
          SFX.respawn();
        }
        if (ev.by === myId) scoreFlyers.push({ wx: ev.x, wy: ev.y - 20, t: 0, text: '+15', delta: 15 });
        break;
      case 'dig':
        burst(ev.x, ev.y, 14, { colors: ['#6b4726', '#8a5a30', '#3b2a1a'], minSpeed: 40, maxSpeed: 160, life: 0.6, up: 120, size: 5 });
        SFX.land();
        break;
      case 'emerge':
        burst(ev.x, ev.y, 22, { colors: ['#6b4726', '#8a5a30', '#3b2a1a', '#4c9a3f'], minSpeed: 60, maxSpeed: 260, life: 0.7, up: 180, size: 6 });
        shake = Math.max(shake, 6);
        if (ev.blocked) floatingTexts.push({ x: ev.x, y: ev.y - 40, text: 'Pařez = kryt!', color: '#c9e6b8', life: 1.2, size: 13 });
        SFX.bite();
        break;
      case 'hit':
        burst(ev.x, ev.y, 7, { colors: ['#e0561f', '#ff8c42', '#ffd9b3'], life: 0.4 });
        floatingTexts.push({ x: ev.x, y: ev.y - 10, text: '-10', color: '#fff', life: 0.6, size: 12 });
        anim(ev.id).hurt = 0.15;
        SFX.hit();
        break;
      case 'kill': {
        const big = ev.mega ? 2.5 : 1;
        burst(ev.x, ev.y, 14 * big, { colors: ['#e0561f', '#ff8c42', '#ffffff'], maxSpeed: 260 * big, life: 0.8, up: 80 });
        burst(ev.x, ev.y, 8 * big, { colors: ['rgba(255,255,255,0.7)', '#ddd'], minSpeed: 10, maxSpeed: 50 * big, life: 0.9, size: 9 * big, gravity: -40, round: true });
        const fox = currSnap && currSnap.data.foxes.find((f) => f.id === ev.id);
        dyingFoxes.push({ x: ev.x, y: ev.y, facing: fox ? fox.facing : 1, mega: !!ev.mega, kind: ev.foxKind, scale: fox ? fox.w / 46 : 1, t: 0, maxT: ev.mega ? 1.1 : 0.7 });
        if (ev.by === myId) {
          scoreFlyers.push({ wx: ev.x, wy: ev.y - 20, t: 0, text: `+${ev.score || 10}`, delta: ev.score || 10 });
          shake = Math.max(shake, ev.mega ? 12 : 4);
          hitStop = ev.mega ? 0.09 : 0.04;
        }
        if (ev.mega) {
          flashes.push({ x: ev.x, y: ev.y, r: 260, t: 0.5, maxT: 0.5, color: '255,120,60' });
          addFeed(`💥 ${ev.by ? playerName(ev.by) : 'Někdo'} složil(a) MEGA lišku!`, '#ffb347');
        }
        SFX.kill();
        break;
      }
      case 'hurt':
        burst(ev.x, ev.y, 8, { colors: ['#d61f1f', '#8f0e0e'], life: 0.5 });
        if (ev.id === myId) {
          shake = 10;
          hurtFlash = 1;
          SFX.hurt();
        }
        break;
      case 'bite':
        anim(ev.id).bite = 0.25;
        SFX.bite();
        break;
      case 'death':
        burst(ev.x, ev.y, 24, { colors: ['#d61f1f', '#8f0e0e', '#ffffff'], maxSpeed: 300, life: 1, up: 120 });
        burst(ev.x, ev.y, 10, { colors: ['rgba(200,230,255,0.8)', 'rgba(255,255,255,0.6)'], minSpeed: 10, maxSpeed: 40, life: 1.2, size: 8, gravity: -80, round: true });
        if (ev.by) addFeed(`🔫 ${ev.byName} zastřelil(a) kamaráda ${ev.name} (−20)`, '#ffb3a7');
        else if (ev.fire) addFeed(`🔥 ${ev.name} uhořel(a)`, '#ffb347');
        else if (ev.lightning) addFeed(`⚡ ${ev.name} dostal(a) bleskem`, '#c9b3ff');
        else addFeed(`🦊 Lišky dostaly hráče ${ev.name}`, '#ff8b8b');
        if (ev.id === myId) {
          shake = 16;
          hurtFlash = 1;
          ghostHint = 7;
          SFX.death();
        }
        break;
      case 'respawn':
        burst(ev.x + 15, ev.y + 24, 16, { colors: ['#ffd27f', '#fff6c2', '#7fe0a8'], minSpeed: 20, maxSpeed: 120, life: 0.8, gravity: -60, round: true });
        flashes.push({ x: ev.x + 15, y: ev.y + 24, r: 120, t: 0.5, maxT: 0.5, color: '255,230,160' });
        if (ev.id === myId) SFX.respawn();
        break;
      case 'jump':
        dust(ev.x, ev.y, 4);
        if (ev.id !== myId) SFX.jump();
        break;
      case 'dash':
        burst(ev.x, ev.y, 8, { colors: ['#ffffff', '#dff3ff'], minSpeed: 20, maxSpeed: 90, life: 0.3, size: 4, gravity: 0, round: true });
        if (ev.id !== myId) SFX.dash();
        break;
      case 'grab':
        dust(ev.x, ev.y, 3);
        break;
      case 'foxjump':
        dust(ev.x, ev.y, 3);
        break;
      case 'foxgiveup':
        floatingTexts.push({ x: ev.x, y: ev.y - 6, text: '…?', color: '#ffd9b3', life: 1.2, size: 13 });
        break;
      case 'foxflee':
        floatingTexts.push({ x: ev.x, y: ev.y - 6, text: 'fuj!', color: '#9fd66b', life: 1, size: 12 });
        burst(ev.x, ev.y + 10, 5, { colors: ['#9fd66b', '#c9e6b8'], minSpeed: 20, maxSpeed: 70, life: 0.5, size: 4, gravity: -60, round: true });
        break;
      case 'foxspawn':
        burst(ev.x, ev.y, 8, { colors: ['#3b2a1a', '#5a3a1f'], minSpeed: 20, maxSpeed: 90, life: 0.5, up: 60, size: 4 });
        break;
      case 'denhit':
        burst(ev.x, ev.y, 6, { colors: ['#6b4726', '#3b2a1a', '#8d7b55'], minSpeed: 30, maxSpeed: 120, life: 0.4, size: 4 });
        break;
      case 'dencollapse':
        burst(ev.x, ev.y, 30, { colors: ['#6b4726', '#3b2a1a', '#5e6a66', '#8d7b55'], minSpeed: 40, maxSpeed: 220, life: 0.9, up: 160, size: 7 });
        shake = Math.max(shake, 8);
        addFeed('🪨 Liščí nora se zavalila!', '#c9e6b8');
        SFX.rubble();
        break;
      case 'denopen':
        burst(ev.x, ev.y, 16, { colors: ['#6b4726', '#3b2a1a'], minSpeed: 30, maxSpeed: 150, life: 0.6, up: 100, size: 5 });
        addFeed('🦊 Lišky si noru zase prohrabaly.', '#ffb08a');
        break;
      case 'leaves':
        spawnLeafBurst(ev.x, ev.y, 14);
        break;
      case 'mushroom':
        burst(ev.x, ev.y, 16, { colors: ['#c93b2e', '#e8dcc0', '#ffffff'], minSpeed: 30, maxSpeed: 180, life: 0.6, up: 80, size: 4 });
        SFX.pop();
        break;
      case 'weather': {
        const info = WEATHER_INFO[ev.weather];
        if (ev.weather === 'clear') addFeed('🌙 Nebe se vyjasnilo.', '#c9e6b8');
        else {
          announce(`${info.icon} ${info.label}`, info.sub, '#cfe6ff', '#3a6bd1', 3);
          addFeed(`${info.icon} ${info.label} na ${ev.duration} s`, '#cfe6ff');
        }
        setRainSound(ev.weather === 'rain' || ev.weather === 'storm');
        break;
      }
      case 'lightning':
        lightningFlash = 1;
        flashes.push({ x: ev.x, y: ev.y - 40, r: 420, t: 0.4, maxT: 0.4, color: '220,230,255' });
        burst(ev.x, ev.y, 14, { colors: ['#ffffff', '#cfe6ff', '#ffe066'], minSpeed: 60, maxSpeed: 260, life: 0.5, up: 100, size: 3 });
        shake = Math.max(shake, 6);
        SFX.thunder();
        break;
      case 'wave':
        announce(`Vlna ${ev.wave}`, `Lišky zuří. Přichází jich až ${ev.maxFoxes}.`);
        addFeed(`🌙 Vlna ${ev.wave}: přichází až ${ev.maxFoxes} lišek`, '#c9b3ff');
        SFX.wave();
        break;
      case 'mega':
        announce(ev.count > 1 ? `${ev.count}× MEGA LIŠKA!` : 'MEGA LIŠKA!', 'Země se třese. Schovej se, nebo střílej.', '#ffb347', '#d63d3d', 4);
        addFeed(`🔥 Přichází ${ev.count > 1 ? ev.count + ' mega lišky' : 'mega liška'}!`, '#ffb347');
        shake = Math.max(shake, 10);
        playTone({ type: 'sawtooth', from: 120, to: 40, dur: 0.9, gain: 0.12 });
        break;
      case 'gameover':
        gameOver = { ranking: ev.ranking, wave: ev.wave, kills: ev.kills, t: 0 };
        addFeed('☠️ Lišky ovládly les. Nové kolo za chvíli.', '#ff8b8b');
        playTone({ type: 'sawtooth', from: 300, to: 50, dur: 1.4, gain: 0.1 });
        break;
      case 'newround':
        gameOver = null;
        ghostHint = 0;
        scoreShown = 0;
        if (ev.world) {
          world = ev.world;
          buildScenery(world.seed);
        }
        camInit = false;
        setRainSound(false);
        announce(`Kolo ${ev.number}`, 'Nový les, nové nory. Zatím ticho.', '#c9e6b8', '#2f6b32', 3);
        SFX.wave();
        break;
      case 'join':
        addFeed(`➕ ${ev.name} vstoupil(a) do lesa${ev.ghost ? ' jako duch' : ''}`, '#a8e6a1');
        break;
      case 'leave':
        addFeed(`➖ ${ev.name} opustil(a) les`, '#bbb');
        break;
      case 'away':
        if (ev.id !== myId) addFeed(`📵 ${ev.name} ztratil(a) spojení, tělo čeká minutu`, '#bbb');
        break;
      case 'back':
        if (ev.id !== myId) addFeed(`📶 ${ev.name} je zpět`, '#a8e6a1');
        break;
      default:
        break;
    }
  }
}

// ===========================================================================
// Scenery
// ===========================================================================
const LAYERS = [
  { parallax: 0.12, vp: 0.65, off: -140, count: 40, minH: 100, maxH: 170, color: '#0f2f22', trunk: '#0b241a' },
  { parallax: 0.3, vp: 0.8, off: -40, count: 44, minH: 130, maxH: 220, color: '#16412c', trunk: '#10301f' },
  { parallax: 0.55, vp: 1, off: 6, count: 34, minH: 170, maxH: 300, color: '#1f5a38', trunk: '#3d2a18' },
];
let forestLayers = [];
let fireflies = [];

function buildScenery(seed) {
  forestLayers = LAYERS.map((layer, li) => {
    const rnd = S.seeded(seed + 1234 + li * 999);
    const span = S.WORLD.width * layer.parallax + CAM.w * 2;
    const trees = [];
    for (let i = 0; i < layer.count; i++) trees.push({ x: rnd() * span, h: layer.minH + rnd() * (layer.maxH - layer.minH), w: 34 + rnd() * 40, conifer: rnd() < 0.7, phase: rnd() * 10 });
    return { ...layer, trees, span };
  });
  const rf = S.seeded(seed + 77);
  fireflies = [];
  for (let i = 0; i < 70; i++) fireflies.push({ x: rf() * S.WORLD.width, y: 320 + rf() * 320, phase: rf() * Math.PI * 2, speed: 0.5 + rf() });
}
buildScenery(1);

const SKY_EARLY = { top: [14, 29, 51], mid: [28, 58, 60], bottom: [46, 90, 58], moon: [245, 241, 214] };
const SKY_LATE = { top: [30, 8, 40], mid: [70, 20, 60], bottom: [90, 40, 40], moon: [255, 200, 170] };
function skyFor(wave, weather) {
  const k = clamp((wave - 1) / 7, 0, 1);
  const grey = weather === 'rain' ? 0.35 : weather === 'storm' ? 0.55 : 0;
  const mix = (a, b) => {
    let c = [0, 1, 2].map((i) => lerp(a[i], b[i], k));
    if (grey) c = c.map((v) => lerp(v, 40, grey));
    return `rgb(${c.map(Math.round).join(',')})`;
  };
  return { top: mix(SKY_EARLY.top, SKY_LATE.top), mid: mix(SKY_EARLY.mid, SKY_LATE.mid), bottom: mix(SKY_EARLY.bottom, SKY_LATE.bottom), moon: mix(SKY_EARLY.moon, SKY_LATE.moon) };
}

function drawTree(g, t, baseY, color, trunk, time, windK) {
  const sway = Math.sin(time * 0.7 + t.phase) * 0.018 * windK;
  g.fillStyle = trunk;
  g.fillRect(t.x - 4, baseY - t.h * 0.35, 8, t.h * 0.35);
  g.save();
  g.translate(t.x, baseY - t.h * 0.3);
  g.rotate(sway);
  g.fillStyle = color;
  if (t.conifer) {
    for (let i = 0; i < 3; i++) {
      const tierH = t.h * 0.4;
      const yTop = -t.h * 0.7 + i * tierH * 0.6;
      const w = t.w * (0.5 + i * 0.35);
      g.beginPath();
      g.moveTo(0, yTop);
      g.lineTo(-w / 2, yTop + tierH);
      g.lineTo(w / 2, yTop + tierH);
      g.closePath();
      g.fill();
    }
  } else {
    g.beginPath();
    g.ellipse(0, -t.h * 0.3, t.w * 0.6, t.h * 0.45, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(-t.w * 0.3, -t.h * 0.15, t.w * 0.4, t.h * 0.3, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function spawnLeaf() {
  const rnd = Math.random();
  leaves.push({ x: camX + rand(-40, CAM.w + 40), y: camY - 10, vx: rand(-15, 15), vy: rand(25, 55), rot: rand(0, Math.PI * 2), spin: rand(-3, 3), phase: rand(0, 10), color: rnd < 0.4 ? '#c9742b' : rnd < 0.7 ? '#d9a441' : '#8a3b1a', size: rand(3, 5) });
}

function drawBackground(g, time, wave, weather) {
  const sky = skyFor(wave, weather);
  const windK = weather === 'storm' ? 3 : weather === 'rain' ? 1.8 : 1;
  const grad = g.createLinearGradient(0, 0, 0, CAM.h);
  grad.addColorStop(0, sky.top);
  grad.addColorStop(0.5, sky.mid);
  grad.addColorStop(1, sky.bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, CAM.w, CAM.h);

  if (weather !== 'storm') {
    const rnd = S.seeded(5);
    for (let i = 0; i < 70; i++) {
      const sx = (((rnd() * 2000 - camX * 0.05) % CAM.w) + CAM.w) % CAM.w;
      const sy = rnd() * 180 - camY * 0.05;
      g.globalAlpha = (0.4 + 0.6 * Math.abs(Math.sin(time * 1.5 + i))) * (weather === 'rain' ? 0.4 : 1);
      g.fillStyle = '#fff';
      g.fillRect(sx, sy, 1.5, 1.5);
    }
    g.globalAlpha = 1;
  }

  const mx = CAM.w - 120 - camX * 0.02;
  const my = 70 - camY * 0.05;
  const glow = g.createRadialGradient(mx, my, 20, mx, my, 110);
  glow.addColorStop(0, 'rgba(255,240,200,0.25)');
  glow.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = glow;
  g.fillRect(mx - 110, my - 110, 220, 220);
  g.fillStyle = sky.moon;
  g.beginPath();
  g.arc(mx, my, 26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = sky.mid;
  g.beginPath();
  g.arc(mx + 10, my - 8, 23, 0, Math.PI * 2);
  g.fill();

  if (owl) {
    const flap = Math.sin(time * 12) * 6;
    g.fillStyle = 'rgba(10,15,20,0.9)';
    g.save();
    g.translate(owl.x - camX * 0.1, owl.y - camY * 0.08);
    g.scale(owl.dir, 1);
    g.beginPath();
    g.moveTo(-12, 0);
    g.quadraticCurveTo(-6, -4 - flap, 0, 0);
    g.quadraticCurveTo(6, -4 - flap, 12, 0);
    g.quadraticCurveTo(6, 2, 0, 3);
    g.quadraticCurveTo(-6, 2, -12, 0);
    g.fill();
    g.restore();
  }

  g.fillStyle = 'rgba(8,30,20,0.9)';
  g.beginPath();
  g.moveTo(0, CAM.h);
  for (let x = 0; x <= CAM.w; x += 16) {
    const wx = x + camX * 0.08;
    g.lineTo(x, CAM.h * 0.55 - camY * 0.1 + Math.sin(wx / 180) * 26 + Math.sin(wx / 71) * 10);
  }
  g.lineTo(CAM.w, CAM.h);
  g.closePath();
  g.fill();

  for (const layer of forestLayers) {
    const offset = camX * layer.parallax;
    const baseY = S.WORLD.groundY - camY * layer.vp + layer.off;
    for (const t of layer.trees) {
      const sx = ((((t.x - offset) % layer.span) + layer.span) % layer.span) - CAM.w * 0.5;
      if (sx < -150 || sx > CAM.w + 150) continue;
      drawTree(g, { ...t, x: sx }, baseY, layer.color, layer.trunk, time, windK);
    }
    const fog = g.createLinearGradient(0, baseY - 110, 0, baseY);
    fog.addColorStop(0, 'rgba(120,170,150,0)');
    fog.addColorStop(1, `rgba(120,170,150,${weather === 'fog' ? 0.3 : 0.14})`);
    g.fillStyle = fog;
    g.fillRect(0, baseY - 110, CAM.w, 110);
  }

  if (weather !== 'rain' && weather !== 'storm') {
    for (const f of fireflies) {
      const fx = f.x - camX;
      if (fx < -10 || fx > CAM.w + 10) continue;
      const fy = f.y - camY + Math.sin(time * f.speed + f.phase) * 12;
      const a = 0.3 + 0.7 * Math.abs(Math.sin(time * 1.5 * f.speed + f.phase));
      const px = fx + Math.cos(time * f.speed + f.phase) * 10;
      g.fillStyle = `rgba(214,255,120,${a})`;
      g.beginPath();
      g.arc(px, fy, 1.6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = `rgba(214,255,120,${a * 0.18})`;
      g.beginPath();
      g.arc(px, fy, 7, 0, Math.PI * 2);
      g.fill();
    }
  }
}

// Climbable trunks: pale bark with notches, a big canopy up top
function drawTrunk(g, t, time, burn) {
  const x = t.x - camX;
  const top = t.top - camY;
  const bottom = t.bottom - camY;
  if (x < -120 || x > CAM.w + 120) return;
  const h = bottom - top;
  const char = burn ? 1 - burn.k : 0; // 0 = fresh, 1 = about to fall
  g.fillStyle = '#4a3320';
  g.beginPath();
  g.moveTo(x - 30, bottom + 2);
  g.quadraticCurveTo(x - 16, bottom - 12, x - 12, bottom - 30);
  g.lineTo(x + 12, bottom - 30);
  g.quadraticCurveTo(x + 16, bottom - 12, x + 30, bottom + 2);
  g.closePath();
  g.fill();
  const bark = g.createLinearGradient(x - 14, 0, x + 14, 0);
  const mix = (c1, c2) => (char ? c2 : c1);
  bark.addColorStop(0, mix('#6f4a2b', '#2a1a10'));
  bark.addColorStop(0.5, mix('#b08a5c', '#4a3320'));
  bark.addColorStop(1, mix('#5c3c22', '#1f130a'));
  g.fillStyle = bark;
  g.fillRect(x - 14, top + 6, 28, h - 6);
  // Bark rings and knots in world coordinates, so they stay put when the camera moves
  g.fillStyle = 'rgba(40,20,8,0.45)';
  for (let wy = t.top + 24; wy < t.bottom - 8; wy += 26) {
    const y = wy - camY;
    const k = Math.round((wy - t.top) / 26);
    g.fillRect(x - 12, y, 24, 3);
    g.fillRect(x - 6 + ((k * 7) % 9) - 4, y - 9, 4, 6);
  }
  g.fillStyle = 'rgba(255,240,200,0.18)';
  g.fillRect(x - 10, top + 6, 3, h - 6);
  const sway = Math.sin(time * 0.6 + t.x * 0.01) * 4;
  const shrink = 1 - char * 0.6;
  g.fillStyle = char ? '#3a2a20' : t.planted ? '#2a6b3f' : '#255f3a';
  g.beginPath();
  g.ellipse(x + sway, top - 30, 98 * shrink, 46 * shrink, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = char ? '#4a3a2a' : t.planted ? '#358a52' : '#2f7a48';
  g.beginPath();
  g.ellipse(x - 30 + sway, top - 44, 60 * shrink, 36 * shrink, 0, 0, Math.PI * 2);
  g.ellipse(x + 40 + sway, top - 40, 56 * shrink, 32 * shrink, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = char ? '#5a4a3a' : '#3f9a5a';
  g.beginPath();
  g.ellipse(x + 10 + sway, top - 58, 46 * shrink, 24 * shrink, 0, 0, Math.PI * 2);
  g.fill();
  if (burn) {
    // Flames licking up the trunk and through the crown
    for (let i = 0; i < 12; i++) {
      const fy = bottom - 10 - i * (h / 12) - Math.sin(time * 7 + i) * 6;
      const fh = 18 + Math.sin(time * 9 + i * 1.7) * 8;
      const fx = x + Math.sin(time * 3 + i * 2) * 10;
      const grd = g.createLinearGradient(0, fy, 0, fy - fh);
      grd.addColorStop(0, 'rgba(255,120,30,0.9)');
      grd.addColorStop(1, 'rgba(255,230,150,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(fx - 8, fy);
      g.quadraticCurveTo(fx, fy - fh * 0.6, fx + Math.sin(time * 11 + i) * 4, fy - fh);
      g.quadraticCurveTo(fx + 4, fy - fh * 0.5, fx + 8, fy);
      g.fill();
    }
    fireGlows.push({ x: t.x, y: t.top + 60, r: 220, a: 0.3 });
    fireGlows.push({ x: t.x, y: t.bottom - 60, r: 160, a: 0.25 });
    // Smoke
    for (let i = 0; i < 3; i++) {
      const k = (time * 0.5 + i * 0.33) % 1;
      g.fillStyle = `rgba(60,50,45,${0.35 * (1 - k)})`;
      g.beginPath();
      g.arc(x + Math.sin(k * 6 + i) * 20, top - 60 - k * 90, 10 + k * 18, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function drawSapling(g, sp, time) {
  const x = sp.x - camX;
  const y = S.WORLD.groundY - camY;
  if (x < -60 || x > CAM.w + 60) return;
  const k = sp.k;
  const h = 10 + k * 90;
  g.strokeStyle = '#6f4a2b';
  g.lineWidth = 2 + k * 6;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + Math.sin(time * 2) * 2, y - h);
  g.stroke();
  g.fillStyle = '#3f9a5a';
  for (let i = 0; i < 3; i++) {
    const ly = y - h * (0.5 + i * 0.22);
    g.beginPath();
    g.ellipse(x + (i % 2 ? 10 : -10) * (0.5 + k), ly, 10 * (0.5 + k), 5 * (0.5 + k), (i % 2 ? -0.5 : 0.5), 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(x - 14, y - h - 16, 28, 4);
  g.fillStyle = '#7fe0a8';
  g.fillRect(x - 14, y - h - 16, 28 * k, 4);
}

function drawTrap(g, tr, time) {
  const x = tr.x - camX;
  const y = tr.y - camY;
  if (x < -40 || x > CAM.w + 40) return;
  g.fillStyle = tr.armed ? '#9a9a9a' : '#6a6a6a';
  g.fillRect(x, y + 4, 30, 4);
  g.strokeStyle = '#c9c9c9';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x + 15, y + 5, 14, Math.PI, Math.PI * 1.5 + (tr.armed ? 0 : 0.3));
  g.arc(x + 15, y + 5, 14, Math.PI * 1.5 - (tr.armed ? 0 : 0.3), 0);
  g.stroke();
  g.fillStyle = '#e8e8e8';
  for (let i = 0; i < 5; i++) g.fillRect(x + 3 + i * 6, y - 2 - (i % 2) * 2, 2, 5);
  if (tr.armed && Math.sin(time * 6) > 0.7) {
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(x + 13, y - 4, 4, 2);
  }
}

function drawLure(g, l, time) {
  const x = l.x - camX;
  const y = l.y - camY;
  if (x < -60 || x > CAM.w + 60) return;
  if (l.kind === 'bait') {
    g.fillStyle = '#c94a3a';
    g.beginPath();
    g.ellipse(x + 12, y + 6, 12, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f3ecd8';
    g.fillRect(x + 20, y + 3, 6, 3);
    g.fillStyle = '#e07a5f';
    g.beginPath();
    g.ellipse(x + 10, y + 4, 7, 3, 0, 0, Math.PI * 2);
    g.fill();
    // Scent wisps
    for (let i = 0; i < 3; i++) {
      const t = (time * 0.7 + i * 0.33) % 1;
      g.globalAlpha = (1 - t) * 0.5;
      g.strokeStyle = '#ffd9b3';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x + 6 + i * 6, y - t * 20);
      g.quadraticCurveTo(x + 10 + i * 6, y - 6 - t * 20, x + 6 + i * 6, y - 12 - t * 20);
      g.stroke();
    }
    g.globalAlpha = 1;
  } else {
    // Firefly lantern: a small jar with a glowing dot
    g.fillStyle = 'rgba(200,230,255,0.35)';
    roundRect(g, x, y, 16, 18, 4);
    g.fill();
    g.strokeStyle = '#c9c9c9';
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = '#8a5a30';
    g.fillRect(x + 2, y - 3, 12, 4);
    const pulse = 0.6 + 0.4 * Math.sin(time * 5 + l.id);
    g.fillStyle = `rgba(214,255,120,${pulse})`;
    g.beginPath();
    g.arc(x + 8 + Math.sin(time * 3) * 3, y + 10 + Math.cos(time * 2.3) * 3, 2.5, 0, Math.PI * 2);
    g.fill();
    fireGlows.push({ x: l.x + 8, y: l.y + 8, r: 170, a: 0.25 * pulse, green: true });
  }
  g.font = `700 9px ${FONT_BODY}`;
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,0.6)';
  tabText(g, `${l.life} s`, x + (l.kind === 'bait' ? 12 : 8), y - 6, 'center');
}

function drawDecor(g, d, x, y) {
  g.save();
  g.translate(x, y);
  g.scale(d.flip ? -d.s : d.s, d.s);
  switch (d.kind) {
    case 'stump':
      g.fillStyle = '#4a2f18';
      g.fillRect(-14, -18, 28, 18);
      g.fillStyle = '#8a5a30';
      g.beginPath();
      g.ellipse(0, -18, 14, 5, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#5a3a1f';
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(0, -18, 8, 2.6, 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#3f8a42';
      g.fillRect(-16, -6, 4, 6);
      break;
    case 'rock':
      g.fillStyle = '#5e6a66';
      g.beginPath();
      g.moveTo(-14, 0);
      g.lineTo(-9, -10);
      g.lineTo(2, -13);
      g.lineTo(13, -6);
      g.lineTo(14, 0);
      g.closePath();
      g.fill();
      g.fillStyle = '#7d8a86';
      g.beginPath();
      g.moveTo(-9, -10);
      g.lineTo(2, -13);
      g.lineTo(6, -8);
      g.lineTo(-4, -6);
      g.closePath();
      g.fill();
      break;
    case 'mushroom':
      g.fillStyle = '#e8dcc0';
      g.fillRect(-3, -14, 6, 14);
      g.fillRect(6, -8, 3, 8);
      g.fillStyle = '#c93b2e';
      g.beginPath();
      g.ellipse(0, -14, 11, 7, 0, Math.PI, 0);
      g.fill();
      g.beginPath();
      g.ellipse(7.5, -8, 5, 3, 0, Math.PI, 0);
      g.fill();
      g.fillStyle = '#fff';
      g.fillRect(-5, -18, 2, 2);
      g.fillRect(2, -17, 2, 2);
      break;
    default:
      g.strokeStyle = '#3f8a42';
      g.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(i * 5, -10, i * 9, -16 + Math.abs(i) * 3);
        g.stroke();
      }
  }
  g.restore();
}

function drawDen(g, d, state, time) {
  const x = d.x - camX;
  const y = d.y - camY;
  if (x + d.w < -50 || x > CAM.w + 50) return;
  const cx = x + d.w / 2;
  const bottom = y + d.h;
  g.fillStyle = '#4a3320';
  g.beginPath();
  g.ellipse(cx, bottom, d.w / 2 + 12, d.h, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = '#3f8a42';
  g.beginPath();
  g.ellipse(cx, bottom - d.h + 4, d.w / 2 - 6, 6, 0, Math.PI, 0);
  g.fill();
  if (state && state.collapsed) {
    g.fillStyle = '#5e6a66';
    for (let i = 0; i < 6; i++) {
      const rx = cx - 22 + (i % 3) * 20;
      const ry = bottom - 10 - Math.floor(i / 3) * 14;
      g.beginPath();
      g.moveTo(rx - 10, ry + 8);
      g.lineTo(rx - 6, ry - 6);
      g.lineTo(rx + 6, ry - 8);
      g.lineTo(rx + 11, ry + 2);
      g.lineTo(rx + 8, ry + 8);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#7d8a86';
    g.fillRect(cx - 6, bottom - 30, 8, 4);
    g.font = `800 10px ${FONT_BODY}`;
    g.textAlign = 'center';
    g.fillStyle = '#c9e6b8';
    tabText(g, `zavaleno ${state.t} s`, cx, y - 8, 'center');
  } else {
    g.fillStyle = '#120a04';
    g.beginPath();
    g.ellipse(cx, bottom - 6, 22, 20, 0, Math.PI, 0);
    g.fill();
    const blink = Math.sin(time * 2 + d.id) > 0.9 ? 0.2 : 1;
    g.fillStyle = '#ffcc44';
    g.fillRect(cx - 9, bottom - 18, 5, 3 * blink);
    g.fillRect(cx + 4, bottom - 18, 5, 3 * blink);
    if (state && state.dmg > 0) {
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(cx - 24, y - 12, 48, 5);
      g.fillStyle = '#ffb347';
      g.fillRect(cx - 24, y - 12, 48 * state.dmg, 5);
      g.strokeStyle = 'rgba(30,15,5,0.7)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cx - 20, bottom - 30);
      g.lineTo(cx - 10 + state.dmg * 10, bottom - 18);
      g.moveTo(cx + 18, bottom - 34);
      g.lineTo(cx + 8, bottom - 20);
      g.stroke();
    }
    g.font = `800 9px ${FONT_BODY}`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,200,140,0.75)';
    g.fillText('NORA', cx, y - 6);
  }
}

function drawPlatforms(g, time, broken) {
  const platforms = world.platforms;
  platforms.forEach((p, idx) => {
    const x = p.x - camX;
    const y = p.y - camY;
    if (x + p.w < 0 || x > CAM.w) return;
    if (p.ground) {
      const dirt = g.createLinearGradient(0, y, 0, y + 140);
      dirt.addColorStop(0, '#6b4726');
      dirt.addColorStop(1, '#2a1a0e');
      g.fillStyle = dirt;
      g.fillRect(x, y, p.w, CAM.h);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let gx = Math.floor(camX / 90) * 90; gx < camX + CAM.w + 90; gx += 90) {
        const k = (gx / 90) | 0;
        g.fillRect(gx - camX + (k % 4) * 11, y + 24 + (k % 3) * 17, 14 + (k % 3) * 4, 6);
        g.fillRect(gx - camX + 40 + (k % 5) * 7, y + 56 + (k % 2) * 13, 8, 8);
      }
      for (const d of world.decor) {
        const dx = d.x - camX;
        if (dx < -40 || dx > CAM.w + 40) continue;
        if (d.kind === 'mushroom' && broken.has(d.id)) continue;
        drawDecor(g, d, dx, y + 2);
      }
      g.fillStyle = '#2f6b32';
      g.fillRect(x, y, p.w, 10);
      g.fillStyle = '#4c9a3f';
      for (let gx = Math.floor(camX / 14) * 14; gx < camX + CAM.w + 14; gx += 14) {
        const k = (gx / 14) | 0;
        const h = 5 + (k % 3) * 3;
        const lean = Math.sin(time * 1.3 + k) * 1.5;
        g.beginPath();
        g.moveTo(gx - camX, y + 1);
        g.lineTo(gx - camX + lean, y - h);
        g.lineTo(gx - camX + 3, y + 1);
        g.fill();
      }
      return;
    }
    if (p.canopy) {
      g.fillStyle = '#5a3a1f';
      g.fillRect(x, y, p.w, p.h);
      g.fillStyle = '#3f9a5a';
      g.fillRect(x - 6, y - 4, p.w + 12, 7);
      return;
    }
    if (p.branch) {
      g.fillStyle = '#6f4a2b';
      g.beginPath();
      g.moveTo(x, y + p.h / 2);
      g.quadraticCurveTo(x + p.w / 2, y - 2, x + p.w, y + p.h / 2);
      g.quadraticCurveTo(x + p.w / 2, y + p.h + 4, x, y + p.h / 2);
      g.fill();
      g.fillStyle = '#4c9a3f';
      g.fillRect(x + 6, y - 3, p.w - 12, 4);
      return;
    }
    g.fillStyle = '#5a3a1f';
    g.fillRect(x, y, p.w, p.h);
    g.fillStyle = '#7a4f2a';
    g.fillRect(x, y + 3, p.w, 4);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    for (let i = 12; i < p.w; i += 28) g.fillRect(x + i, y + 8, 3, p.h - 10);
    for (const ex of [x, x + p.w]) {
      g.fillStyle = '#c9975a';
      g.beginPath();
      g.ellipse(ex, y + p.h / 2, 5, p.h / 2, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#8a5a30';
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(ex, y + p.h / 2, 3, p.h / 3.2, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#4c9a3f';
    g.fillRect(x + 4, y - 3, p.w - 8, 4);
    g.fillStyle = '#6fbf5a';
    for (let i = 6; i < p.w - 6; i += 18) g.fillRect(x + i + (idx % 3) * 2, y - 5, 5, 3);
    g.fillStyle = '#3f8a42';
    g.beginPath();
    g.ellipse(x + p.w * 0.3, y + p.h * 0.7, 10, 4, 0, 0, Math.PI * 2);
    g.fill();
    if (idx % 4 === 2) drawDecor(g, { kind: 'fern', s: 0.7, flip: true }, x + 16, y - 2);
  });
}

function drawGroundFog(g, time, weather) {
  const gy = S.WORLD.groundY - camY;
  const strength = weather === 'fog' ? 0.32 : 0.16;
  for (let i = 0; i < 6; i++) {
    const wx = ((i * 700 + time * 18 * (1 + (i % 3) * 0.3)) % (S.WORLD.width + 800)) - 400;
    const sx = wx - camX * 0.9;
    if (sx < -400 || sx > CAM.w + 400) continue;
    const grd = g.createRadialGradient(sx, gy - 6, 10, sx, gy - 6, 220);
    grd.addColorStop(0, `rgba(170,200,190,${strength})`);
    grd.addColorStop(1, 'rgba(170,200,190,0)');
    g.fillStyle = grd;
    g.fillRect(sx - 220, gy - 60, 440, 70);
  }
}

function updateRain(dt, weather) {
  const heavy = weather === 'storm';
  if (weather === 'rain' || heavy) {
    for (let i = 0; i < (heavy ? 6 : 3); i++) rainDrops.push({ x: camX + rand(-60, CAM.w + 60), y: camY - 20, vy: rand(520, 700), vx: heavy ? -140 : -40 });
  }
  for (let i = rainDrops.length - 1; i >= 0; i--) {
    const r = rainDrops[i];
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    const gy = S.groundBelow(world.platforms, r.x, 1, r.y);
    if (r.y >= gy) {
      rainDrops.splice(i, 1);
      if (Math.random() < 0.35) burst(r.x, gy, 1, { colors: ['rgba(190,220,255,0.7)'], minSpeed: 20, maxSpeed: 60, life: 0.25, size: 2, gravity: 300, up: 40, round: true });
    }
  }
}

function drawRain(g) {
  if (!rainDrops.length) return;
  g.strokeStyle = 'rgba(190,220,255,0.45)';
  g.lineWidth = 1;
  g.beginPath();
  for (const r of rainDrops) {
    const x = r.x - camX;
    const y = r.y - camY;
    g.moveTo(x, y);
    g.lineTo(x + r.vx * 0.02, y + r.vy * 0.02);
  }
  g.stroke();
}

// ===========================================================================
// Shadows & lighting
// ===========================================================================
function drawShadow(g, x, w, bottom) {
  const gy = S.groundBelow(world.platforms, x, w, bottom);
  const dist = clamp(gy - bottom, 0, 300);
  const k = 1 - (dist / 300) * 0.65;
  g.fillStyle = `rgba(0,0,0,${0.3 * k})`;
  g.beginPath();
  g.ellipse(x + w / 2 - camX, gy - camY + 1, (w / 2) * k, 4 * k, 0, 0, Math.PI * 2);
  g.fill();
}

const fireGlows = [];
function drawLights(g, playersR) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const f of fireGlows) {
    const cx = f.x - camX;
    const cy = f.y - camY;
    const grd = g.createRadialGradient(cx, cy, 6, cx, cy, f.r);
    const col = f.green ? '190,255,120' : '255,150,60';
    grd.addColorStop(0, `rgba(${col},${f.a})`);
    grd.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grd;
    g.fillRect(cx - f.r, cy - f.r, f.r * 2, f.r * 2);
  }
  fireGlows.length = 0;
  for (const p of playersR) {
    if (!p.alive) continue;
    const cx = p.rx + 15 - camX;
    const cy = p.ry + 24 - camY;
    const grd = g.createRadialGradient(cx, cy, 10, cx, cy, 95);
    grd.addColorStop(0, 'rgba(255,220,150,0.16)');
    grd.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = grd;
    g.fillRect(cx - 95, cy - 95, 190, 190);
  }
  for (const f of flashes) {
    const a = (f.t / f.maxT) * 0.55;
    const cx = f.x - camX;
    const cy = f.y - camY;
    const grd = g.createRadialGradient(cx, cy, 4, cx, cy, f.r);
    grd.addColorStop(0, `rgba(${f.color},${a})`);
    grd.addColorStop(1, `rgba(${f.color},0)`);
    g.fillStyle = grd;
    g.fillRect(cx - f.r, cy - f.r, f.r * 2, f.r * 2);
  }
  g.restore();
}

// ===========================================================================
// Characters
// ===========================================================================
function drawHunterSprite(g, o, opts) {
  const { facing = 1, swing = 0, lean = 0, squash = 0, recoil = 0, flash = 0, flicker = false, time = 0, climbing = false, dashing = false } = opts;
  g.save();
  g.scale(facing, 1);
  g.rotate(lean * facing);
  g.scale(1 + squash * 0.18, 1 - squash * 0.22);
  if (flicker) g.globalAlpha = 0.5 + 0.5 * Math.sin(time * 25);
  if (dashing) g.globalAlpha *= 0.85;

  const armUp = climbing ? Math.sin(time * 8) * 6 : 0;
  g.fillStyle = o.trousers;
  g.fillRect(-9 + swing * 0.5, -20, 7, 18);
  g.fillRect(2 - swing * 0.5, -20, 7, 18);
  g.fillStyle = '#1f1610';
  g.fillRect(-10 + swing * 0.5, -5, 9, 5);
  g.fillRect(1 - swing * 0.5, -5, 9, 5);

  g.fillStyle = o.jacket;
  g.fillRect(-10, -38, 20, 20);
  g.fillStyle = o.trim;
  g.fillRect(-10, -38, 20, 4);
  g.fillStyle = 'rgba(0,0,0,0.15)';
  g.fillRect(-10, -38, 4, 20);
  g.fillStyle = '#7a4f2a';
  g.fillRect(-10, -22, 20, 3);
  g.fillStyle = '#d9b44a';
  g.fillRect(-2, -22, 4, 3);

  if (climbing) {
    g.fillStyle = '#5a3a1f';
    g.fillRect(-13, -44, 4, 26);
    g.fillStyle = o.jacket;
    g.fillRect(-8, -52 + armUp, 5, 16);
    g.fillRect(3, -56 - armUp, 5, 20);
    g.fillStyle = o.skin;
    g.fillRect(-8, -56 + armUp, 5, 4);
    g.fillRect(3, -60 - armUp, 5, 4);
  } else {
    const rx = -recoil * 4;
    g.fillStyle = o.jacket;
    g.fillRect(-2 + rx, -34, 12, 6);
    g.fillStyle = o.skin;
    g.fillRect(8 + rx, -33, 4, 4);
    g.fillStyle = '#5a3a1f';
    g.fillRect(-6 + rx, -31, 14, 4);
    g.fillStyle = '#2b2b2b';
    g.fillRect(6 + rx, -30, 21, 3);
    g.fillRect(2 + rx, -27, 5, 5);
    g.fillStyle = '#8a8a8a';
    g.fillRect(24 + rx, -31, 3, 1);
    if (flash > 0) {
      g.save();
      g.globalAlpha = flash;
      g.fillStyle = '#fff2a8';
      g.beginPath();
      g.moveTo(27 + rx, -29);
      g.lineTo(38 + rx, -35);
      g.lineTo(34 + rx, -29);
      g.lineTo(38 + rx, -23);
      g.closePath();
      g.fill();
      g.fillStyle = '#ffb347';
      g.beginPath();
      g.arc(29 + rx, -29, 4, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  g.fillStyle = o.skin;
  g.fillRect(-7, -52, 14, 14);
  g.fillStyle = o.hair;
  g.fillRect(-8, -54, 16, 5);
  g.fillRect(-9, -52, 3, 9);
  g.beginPath();
  g.moveTo(-8, -50);
  g.lineTo(-16 - swing * 0.3, -44);
  g.lineTo(-14 - swing * 0.3, -34);
  g.lineTo(-8, -40);
  g.closePath();
  g.fill();
  g.fillStyle = '#222';
  g.fillRect(3, -47, 2, 3);
  g.fillStyle = '#d98b8b';
  g.fillRect(4, -42, 3, 1);
  g.fillStyle = o.hat;
  g.fillRect(-10, -58, 20, 6);
  g.fillRect(-7, -64, 14, 7);
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(-7, -58, 14, 2);
  g.fillStyle = o.feather;
  g.beginPath();
  g.moveTo(3, -62);
  g.quadraticCurveTo(10, -70, 14, -60);
  g.quadraticCurveTo(9, -61, 3, -60);
  g.fill();
  g.restore();
}

function drawHunter(g, p, x, y, time, isMe) {
  const o = outfitOf(p);
  const a = anim(p.id);
  const moving = Math.abs(p.vx) > 10 && p.onGround;
  const swing = moving ? Math.sin(time * 14) * 7 : 0;
  const bob = moving ? Math.abs(Math.sin(time * 14)) * 2 : 0;
  const lean = p.dash ? p.facing * 0.25 : p.climbing ? 0 : p.onGround ? (p.vx / 270) * 0.06 : clamp(-p.vy / 2500, -0.18, 0.18);
  const cx = x + 15;

  drawShadow(g, p.rx, 30, p.ry + 48);
  if (p.disguiseT > 0) {
    // Fox costume: ears on the hat and a bushy tail
    g.save();
    g.translate(cx, y + 48 - bob);
    g.scale(p.facing, 1);
    g.fillStyle = '#e0561f';
    g.beginPath();
    g.moveTo(-9, -62);
    g.lineTo(-6, -74);
    g.lineTo(-2, -62);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(2, -62);
    g.lineTo(6, -74);
    g.lineTo(9, -62);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(-10, -20);
    g.quadraticCurveTo(-30, -26 + Math.sin(time * 4) * 3, -28, -6);
    g.quadraticCurveTo(-20, -4, -10, -12);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(-27, -7, 4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  if (p.dash) {
    for (let i = 1; i <= 3; i++) {
      g.save();
      g.globalAlpha = 0.18 / i;
      g.translate(cx - p.facing * i * 14, y + 48);
      drawHunterSprite(g, o, { facing: p.facing, lean, time });
      g.restore();
    }
  }
  g.save();
  g.translate(cx, y + 48 - bob);
  drawHunterSprite(g, o, { facing: p.facing, swing, lean, squash: a.squash, recoil: a.recoil, flash: a.recoil > 0.55 ? (a.recoil - 0.55) / 0.45 : 0, flicker: p.inv && !p.dash, time, climbing: p.climbing, dashing: p.dash });
  g.restore();

  if (p.stinkT > 0) {
    // Green wisps rising off the reeking hunter
    for (let i = 0; i < 4; i++) {
      const t = (time * 0.8 + i * 0.27) % 1;
      g.globalAlpha = (1 - t) * 0.55;
      g.strokeStyle = '#9fd66b';
      g.lineWidth = 2;
      g.beginPath();
      const bx = cx - 14 + i * 9;
      const by = y + 10 - t * 46;
      g.moveTo(bx, by + 12);
      g.quadraticCurveTo(bx + 5, by + 6, bx, by);
      g.quadraticCurveTo(bx - 5, by - 6, bx, by - 12);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  g.font = `800 11px ${FONT_BODY}`;
  g.textAlign = 'center';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.fillStyle = isMe ? '#ffd27f' : p.on === false ? '#999' : '#fff';
  const label = p.on === false ? `${p.name} 📵` : p.name;
  g.strokeText(label, cx, y - 26);
  g.fillText(label, cx, y - 26);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(cx - 18, y - 22, 36, 5);
  g.fillStyle = p.hp > 40 ? '#5ad35a' : '#e04b4b';
  g.fillRect(cx - 18, y - 22, 36 * (p.hp / 100), 5);
}

function drawGhost(g, p, x, y, time, isMe) {
  const cx = x + 15;
  const bob = Math.sin(time * 2.5 + p.id) * 3;
  g.save();
  g.translate(cx, y + 48 + bob);
  g.scale(p.facing, 1);
  g.globalAlpha = isMe ? 0.7 : 0.5;
  g.fillStyle = '#dff3ff';
  g.beginPath();
  g.moveTo(-12, -8);
  g.lineTo(-12, -40);
  g.arc(0, -40, 12, Math.PI, 0);
  g.lineTo(12, -8);
  for (let i = 12; i > -12; i -= 6) g.quadraticCurveTo(i - 3, -2 + Math.sin(time * 6 + i) * 2, i - 6, -8);
  g.closePath();
  g.fill();
  g.fillStyle = outfitOf(p).hat;
  g.globalAlpha = isMe ? 0.8 : 0.6;
  g.fillRect(-11, -52, 22, 4);
  g.fillRect(-7, -58, 14, 6);
  g.globalAlpha = 1;
  g.fillStyle = '#2b3a4a';
  g.fillRect(-5, -42, 3, 4);
  g.fillRect(3, -42, 3, 4);
  g.restore();
  g.font = `800 11px ${FONT_BODY}`;
  g.textAlign = 'center';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.fillStyle = 'rgba(223,243,255,0.8)';
  g.strokeText(`${p.name} 👻`, cx, y - 14 + bob);
  g.fillText(`${p.name} 👻`, cx, y - 14 + bob);
  if (p.revive > 0) {
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(cx, y + 20 + bob, 22, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = '#7fe0a8';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, y + 20 + bob, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.revive);
    g.stroke();
    g.font = `800 10px ${FONT_BODY}`;
    g.fillStyle = '#7fe0a8';
    tabText(g, `${Math.ceil((1 - p.revive) * 3)} s`, cx, y + 58 + bob, 'center');
  }
}

function drawFoxSprite(g, opts) {
  const { facing = 1, run = 0, air = false, bite = 0, hurt = false, alpha = 1, rot = 0, mega = false, scale = 1, time = 0, kind = 'normal' } = opts;
  const PAL = { normal: ['#e0561f', '#e8641f'], fast: ['#d9a441', '#e8b85a'], jumper: ['#5a6d84', '#6d8199'], digger: ['#6b4a2a', '#7d5a36'], mega: ['#b8391a', '#c9461f'] }[kind] || ['#e0561f', '#e8641f'];
  g.save();
  g.globalAlpha = alpha;
  g.rotate(rot);
  g.scale(facing * scale, scale);
  if (air) g.scale(1.14, 0.86);
  if (kind === 'fast') g.scale(1.1, 0.9);
  if (kind === 'jumper') g.scale(0.95, 1.1);
  const fur = hurt ? '#ffb38a' : PAL[0];
  const furLight = hurt ? '#ffc39a' : PAL[1];

  g.fillStyle = fur;
  g.beginPath();
  g.moveTo(-16, -16);
  g.quadraticCurveTo(-34, -26 + run * 4, -30, -8 + run * 3);
  g.quadraticCurveTo(-24, -6, -16, -10);
  g.closePath();
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(-30, -9 + run * 3, 4, 0, Math.PI * 2);
  g.fill();

  const legH = kind === 'jumper' ? 14 : 10;
  g.fillStyle = kind === 'jumper' ? '#2f3a48' : kind === 'digger' ? '#2b1a0c' : '#3a1a08';
  g.fillRect(-14 + run * 4, -legH, 5, legH);
  g.fillRect(-6 - run * 4, -legH, 5, legH);
  g.fillRect(6 + run * 4, -legH, 5, legH);
  g.fillRect(13 - run * 4, -legH, 5, legH);
  if (kind === 'digger') {
    g.fillStyle = '#d8c9a3';
    g.fillRect(6 + run * 4, -1, 7, 2);
    g.fillRect(13 - run * 4, -1, 7, 2);
  }

  g.fillStyle = furLight;
  g.beginPath();
  g.ellipse(-2, -16, 18, 9, 0, 0, Math.PI * 2);
  g.fill();
  if (mega) {
    g.strokeStyle = '#4a1508';
    g.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(-10 + i * 5, -22);
      g.lineTo(-7 + i * 5, -14);
      g.stroke();
    }
    g.fillStyle = '#7a2410';
    for (let i = -14; i < 8; i += 5) {
      g.beginPath();
      g.moveTo(i, -22);
      g.lineTo(i + 2.5, -29 + Math.sin(time * 10 + i) * 1.5);
      g.lineTo(i + 5, -22);
      g.closePath();
      g.fill();
    }
  }
  g.fillStyle = '#ffe3c8';
  g.beginPath();
  g.ellipse(-2, -12, 12, 4, 0, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = furLight;
  g.beginPath();
  g.ellipse(16, -20, 9, 7, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffe3c8';
  g.beginPath();
  g.moveTo(19, -18);
  g.lineTo(27, -15);
  g.lineTo(19, -13);
  g.closePath();
  g.fill();
  if (bite > 0) {
    g.save();
    g.translate(19, -13);
    g.rotate(0.6 * bite);
    g.fillStyle = '#ffe3c8';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(8, 2);
    g.lineTo(0, 4);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.fillRect(2, -1, 1.5, 2);
    g.fillRect(5, 0, 1.5, 2);
    g.restore();
    g.fillStyle = '#fff';
    g.fillRect(21, -14, 1.5, 2);
    g.fillRect(24, -14.5, 1.5, 2);
  }
  g.fillStyle = '#222';
  g.fillRect(25, -16, 3, 2);
  g.fillStyle = fur;
  g.beginPath();
  g.moveTo(10, -25);
  g.lineTo(13, -34);
  g.lineTo(17, -25);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(17, -26);
  g.lineTo(21, -34);
  g.lineTo(24, -25);
  g.closePath();
  g.fill();
  g.fillStyle = mega ? '#ffe066' : '#fff';
  g.fillRect(17, -23, 4, 3);
  g.fillStyle = mega ? '#d61f1f' : '#111';
  g.fillRect(19, -23, 2, 3);
  if (mega) {
    g.fillStyle = 'rgba(255,200,80,0.35)';
    g.beginPath();
    g.arc(19, -21.5, 5, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#3a1a08';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(15, -26);
  g.lineTo(22, -24);
  g.stroke();
  g.restore();
}

function drawMound(g, f, x, y, time) {
  const w = f.w || 48;
  const cx = x + w / 2;
  const gy = y + (f.h || 26);
  g.fillStyle = '#5a3a1f';
  g.beginPath();
  g.ellipse(cx, gy - 2, w * 0.55, 9 + Math.sin(time * 20) * 1.5, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = '#7d5a36';
  g.beginPath();
  g.ellipse(cx - f.facing * 6, gy - 5, w * 0.3, 5, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = '#3b2a1a';
  for (let i = 0; i < 4; i++) {
    const t = (time * 6 + i * 1.7) % 1;
    g.globalAlpha = 1 - t;
    g.fillRect(cx - f.facing * (10 + t * 26) + Math.sin(i * 9) * 8, gy - 6 - Math.sin(t * Math.PI) * 18, 3, 3);
  }
  g.globalAlpha = 1;
}

function drawFox(g, f, x, y, time) {
  if (f.dug) {
    drawMound(g, f, x, y, time);
    return;
  }
  const a = anim(f.id);
  const w = f.w || 46;
  const h = f.h || 28;
  const scale = w / 46;
  const moving = Math.abs(f.vx) > 10 && f.onGround;
  const run = moving ? Math.sin(time * (f.mega ? 11 : 18) + f.id) : f.onGround ? 0 : 0.8;
  const sniff = f.roam && !moving ? Math.sin(time * 5 + f.id) * 0.06 : 0;
  drawShadow(g, f.rx, w, f.ry + h);
  g.save();
  g.translate(x + w / 2, y + h);
  g.scale(1 + a.squash * 0.15, 1 - a.squash * 0.2);
  drawFoxSprite(g, { facing: f.facing, run, air: !f.onGround, bite: a.bite > 0 ? Math.sin((a.bite / 0.25) * Math.PI) : 0, hurt: a.hurt > 0, mega: f.mega, scale, time, kind: f.kind, rot: sniff });
  g.restore();
  if (f.trapped) {
    g.strokeStyle = '#c9c9c9';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x + w / 2, y + h - 2, 16, Math.PI, 0);
    g.stroke();
    g.fillStyle = '#e8e8e8';
    for (let i = 0; i < 5; i++) g.fillRect(x + w / 2 - 12 + i * 6, y + h - 8 - (i % 2) * 2, 2, 5);
    g.fillStyle = '#c9c9c9';
    g.font = `900 11px ${FONT_BODY}`;
    g.textAlign = 'center';
    g.fillText('✦', x + w / 2 + Math.sin(time * 8) * 12, y - 10);
  }
  if (f.stun) {
    g.fillStyle = '#ffe066';
    g.font = `900 12px ${FONT_BODY}`;
    g.textAlign = 'center';
    for (let i = 0; i < 3; i++) g.fillText('✦', x + w / 2 + Math.cos(time * 6 + i * 2.1) * 16, y - 14 + Math.sin(time * 6 + i * 2.1) * 5);
  }
  if (f.mega || f.hp < f.maxHp) {
    const bw = f.mega ? 60 : 28;
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x + w / 2 - bw / 2, y - 12, bw, f.mega ? 6 : 4);
    g.fillStyle = f.mega ? '#ff4d2e' : '#ff8c42';
    g.fillRect(x + w / 2 - bw / 2, y - 12, bw * (f.hp / f.maxHp), f.mega ? 6 : 4);
    if (f.mega) {
      g.font = `900 9px ${FONT_TITLE}`;
      g.textAlign = 'center';
      g.fillStyle = '#ffb347';
      g.fillText('MEGA', x + w / 2, y - 16);
    }
  }
}

function drawDyingFox(g, d) {
  const k = d.t / d.maxT;
  g.save();
  g.translate(d.x - camX, d.y - camY + 14 * (d.scale || 1) - Math.sin(k * Math.PI) * 30);
  drawFoxSprite(g, { facing: d.facing, run: 0, alpha: 1 - k * k, rot: -d.facing * k * 3.2, mega: d.mega, scale: d.scale || 1, kind: d.kind });
  g.restore();
}

function drawBullet(g, b, x, y) {
  g.save();
  g.shadowColor = '#ffe27a';
  g.shadowBlur = 10;
  g.fillStyle = b.fire ? '#ffb347' : '#fff4b0';
  g.fillRect(x, y + 3, 10, 4);
  g.fillStyle = b.fire ? 'rgba(255,90,30,0.8)' : 'rgba(255,179,71,0.6)';
  g.fillRect(b.dir > 0 ? x - 14 : x + 10, y + 4, 14, 2);
  if (b.fire) {
    g.fillStyle = 'rgba(255,200,80,0.9)';
    g.fillRect(x + 2, y + 1, 5, 2);
  }
  g.restore();
}

function drawPickup(g, pk, x, y, time) {
  const info = PICKUP_INFO[pk.kind] || PICKUP_INFO.medkit;
  const bob = Math.sin(time * 3 + pk.id) * 3;
  const blink = pk.life <= 5 && Math.sin(time * 12) > 0;
  g.save();
  g.globalAlpha = blink ? 0.35 : 1;
  g.translate(x + 11, y + 11 + bob);
  g.fillStyle = `${info.color}44`;
  g.beginPath();
  g.arc(0, 0, 18, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#8a5a30';
  roundRect(g, -11, -11, 22, 22, 4);
  g.fill();
  g.strokeStyle = '#2b1708';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = info.color;
  g.font = `900 15px ${FONT_BODY}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(info.icon, 0, 1);
  g.textBaseline = 'alphabetic';
  g.restore();
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.ellipse(x + 11, y + 24, 10, 3, 0, 0, Math.PI * 2);
  g.fill();
}

function drawFire(g, f, x, y, time) {
  const k = 0.35 + 0.65 * Math.min(1, f.k * 1.5);
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(20,10,5,0.55)';
  g.beginPath();
  g.ellipse(0, 1, 38 * k + 6, 5, 0, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 7; i++) {
    const ph = time * (6 + i) + i * 1.3;
    const fx = (i - 3) * 9 * k + Math.sin(ph) * 3;
    const fh = (22 + Math.sin(ph * 1.7) * 8 + (i % 2) * 8) * k;
    const fw = (7 + (i % 3) * 2) * k;
    const grd = g.createLinearGradient(0, 0, 0, -fh);
    grd.addColorStop(0, 'rgba(255,120,30,0.95)');
    grd.addColorStop(0.5, 'rgba(255,200,60,0.9)');
    grd.addColorStop(1, 'rgba(255,240,180,0.2)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(fx - fw, 0);
    g.quadraticCurveTo(fx - fw * 0.6, -fh * 0.5, fx + Math.sin(ph * 2) * 3, -fh);
    g.quadraticCurveTo(fx + fw * 0.6, -fh * 0.5, fx + fw, 0);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#ffd27f';
  for (let i = 0; i < 5; i++) {
    const t = (time * 1.2 + i * 0.37) % 1;
    g.globalAlpha = (1 - t) * k;
    g.fillRect((i - 2) * 10 * k + Math.sin(time * 5 + i) * 5, -t * 60 - 10, 2, 2);
  }
  g.restore();
  fireGlows.push({ x: f.x, y: f.y - 14, r: 150, a: 0.35 * Math.min(1, f.k * 1.5) });
}

function drawEmote(g, p, x, y, dt) {
  const b = emoteBubbles.get(p.id);
  if (!b) return;
  b.t -= dt;
  if (b.t <= 0) {
    emoteBubbles.delete(p.id);
    return;
  }
  const text = EMOTES[b.n] || '';
  const a = Math.min(1, b.t * 3);
  const pop = 1 + Math.max(0, 0.3 - (2.2 - b.t)) * 2;
  g.save();
  g.globalAlpha = a;
  g.translate(x + 15, y - 40);
  g.scale(pop, pop);
  g.font = `800 12px ${FONT_BODY}`;
  const w = g.measureText(text).width + 16;
  g.fillStyle = '#f3ecd8';
  roundRect(g, -w / 2, -12, w, 22, 8);
  g.fill();
  g.beginPath();
  g.moveTo(-5, 10);
  g.lineTo(0, 17);
  g.lineTo(5, 10);
  g.fill();
  g.fillStyle = '#2b1708';
  g.textAlign = 'center';
  g.fillText(text, 0, 4);
  g.restore();
}

// ===========================================================================
// HUD
// ===========================================================================
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Canvas has no font-variant-numeric, so digits are laid out by hand in fixed-width
// slots: countdowns and scores stop jittering as the numbers change.
const digitWidths = new Map();
function tabText(g, text, x, y, align = 'left') {
  const font = g.font;
  let dw = digitWidths.get(font);
  if (dw === undefined) {
    dw = 0;
    for (const d of '0123456789') dw = Math.max(dw, g.measureText(d).width);
    digitWidths.set(font, dw);
  }
  const parts = [...String(text)];
  const widths = parts.map((c) => (/\d/.test(c) ? dw : g.measureText(c).width));
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  const prevAlign = g.textAlign;
  g.textAlign = 'left';
  parts.forEach((c, i) => {
    if (/\d/.test(c)) g.fillText(c, cx + (dw - g.measureText(c).width) / 2, y);
    else g.fillText(c, cx, y);
    cx += widths[i];
  });
  g.textAlign = prevAlign;
}

function drawPanel(g, x, y, w, h) {
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 12;
  g.shadowOffsetY = 4;
  const wood = g.createLinearGradient(x, y, x, y + h);
  wood.addColorStop(0, '#7a4f2a');
  wood.addColorStop(0.5, '#5a3a1f');
  wood.addColorStop(1, '#46290f');
  g.fillStyle = wood;
  roundRect(g, x, y, w, h, 8);
  g.fill();
  g.shadowColor = 'transparent';
  g.strokeStyle = '#2b1708';
  g.lineWidth = 3;
  g.stroke();
  g.strokeStyle = 'rgba(200,150,90,0.35)';
  g.lineWidth = 1;
  roundRect(g, x + 4, y + 4, w - 8, h - 8, 5);
  g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let gy = y + 9; gy < y + h - 6; gy += 8) g.fillRect(x + 8, gy, w - 16, 1.5);
  g.fillStyle = '#c9c9c9';
  for (const [nx, ny] of [[x + 7, y + 7], [x + w - 7, y + 7], [x + 7, y + h - 7], [x + w - 7, y + h - 7]]) {
    g.beginPath();
    g.arc(nx, ny, 2, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function drawHeart(g, x, y, s, fill) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.beginPath();
  g.moveTo(0, 3);
  g.bezierCurveTo(-5, -2, -5, -8, 0, -6);
  g.bezierCurveTo(5, -8, 5, -2, 0, 3);
  g.closePath();
  g.fillStyle = '#3a1010';
  g.fill();
  if (fill > 0) {
    g.save();
    g.clip();
    g.fillStyle = '#e8383d';
    g.fillRect(-6, 3 - 9 * fill, 12, 9 * fill);
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(-3, -5 + (1 - fill) * 6, 1.5, 1.5);
    g.restore();
  }
  g.strokeStyle = '#2b1708';
  g.lineWidth = 0.8;
  g.stroke();
  g.restore();
}

function drawMinimap(g, snap) {
  const mw = 260;
  const mh = 36;
  const mx = VIEW.w / 2 - mw / 2;
  const my = VIEW.h - mh - 12;
  drawPanel(g, mx, my, mw, mh);
  const ix = mx + 10;
  const iy = my + 8;
  const iw = mw - 20;
  const ih = mh - 16;
  const sx = iw / S.WORLD.width;
  const sy = ih / S.WORLD.height;
  g.fillStyle = 'rgba(10,25,15,0.85)';
  g.fillRect(ix, iy, iw, ih);
  g.fillStyle = 'rgba(120,200,110,0.5)';
  for (const p of world.platforms) g.fillRect(ix + p.x * sx, iy + p.y * sy, Math.max(1, p.w * sx), p.ground ? 2 : 1);
  g.fillStyle = 'rgba(200,170,120,0.6)';
  for (const t of world.trunks) g.fillRect(ix + t.x * sx - 0.5, iy + t.top * sy, 1.5, (t.bottom - t.top) * sy);
  for (const d of world.dens) {
    const st = (snap.dens || []).find((s) => s.id === d.id);
    g.fillStyle = st && st.collapsed ? '#7d8a86' : '#ffcc44';
    g.fillRect(ix + d.x * sx, iy + d.y * sy - 1, 4, 4);
  }
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 1;
  g.strokeRect(ix + camX * sx, iy + camY * sy, CAM.w * sx, CAM.h * sy);
  for (const pk of snap.pickups || []) {
    g.fillStyle = (PICKUP_INFO[pk.kind] || PICKUP_INFO.medkit).color;
    g.fillRect(ix + pk.x * sx - 1.5, iy + pk.y * sy - 1.5, 3, 3);
  }
  for (const f of snap.fires || []) {
    g.fillStyle = '#ffb347';
    g.fillRect(ix + f.x * sx - 2, iy + f.y * sy - 2, 4, 4);
  }
  for (const f of snap.foxes) {
    if (f.dug) continue;
    const r = f.mega ? 3 : 1.5;
    g.fillStyle = f.mega ? '#ff4d2e' : '#ff8c42';
    g.fillRect(ix + f.x * sx - r, iy + f.y * sy - r, r * 2, r * 2);
  }
  for (const p of snap.players) {
    g.fillStyle = !p.alive ? 'rgba(223,243,255,0.5)' : p.id === myId ? '#ffd27f' : outfitOf(p).trim;
    g.beginPath();
    g.arc(ix + p.x * sx, iy + p.y * sy, p.id === myId ? 3 : 2.5, 0, Math.PI * 2);
    g.fill();
  }
}

function drawHUD(g, me, snap, dt) {
  drawPanel(g, 12, 12, 320, 82);
  g.textAlign = 'left';
  g.font = `900 15px ${FONT_TITLE}`;
  g.fillStyle = '#ffd27f';
  g.fillText('Hanka The Fox Hunter', 24, 34);
  g.font = `800 12px ${FONT_BODY}`;
  g.fillStyle = '#f3ecd8';
  tabText(g, `Kolo ${snap.round.number} · Vlna ${snap.wave}`, 24, 54);
  g.fillStyle = '#ffb08a';
  tabText(g, `🦊 ${snap.foxes.length}/${snap.maxFoxes}`, 138, 54);
  g.fillStyle = '#c9e6b8';
  tabText(g, `Ulov. ${snap.kills}`, 196, 54);
  const hp = me ? me.hp : 0;
  for (let i = 0; i < 5; i++) drawHeart(g, 34 + i * 22, 74, 1.7, clamp((hp - i * 20) / 20, 0, 1));
  g.fillStyle = '#f3ecd8';
  g.font = `800 11px ${FONT_BODY}`;
  tabText(g, `${hp}`, 150, 78);
  if (me && me.alive) {
    const items = [];
    if (me.weapon && me.weapon !== 'rifle') items.push({ info: PICKUP_INFO[me.weapon], t: me.weaponT });
    if (me.speedT > 0) items.push({ info: PICKUP_INFO.speed, t: me.speedT });
    if (me.stinkT > 0) items.push({ info: PICKUP_INFO.stink, t: me.stinkT });
    if (me.incT > 0) items.push({ info: PICKUP_INFO.incendiary, t: me.incT });
    if (me.doubleT > 0) items.push({ info: PICKUP_INFO.double, t: me.doubleT });
    if (me.disguiseT > 0) items.push({ info: PICKUP_INFO.disguise, t: me.disguiseT });
    items.slice(0, 4).forEach((it, i) => {
      const x = 172 + i * 38;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(g, x, 62, 35, 22, 4);
      g.fill();
      g.fillStyle = it.info.color;
      g.font = `900 12px ${FONT_BODY}`;
      tabText(g, `${it.info.icon}${it.t}`, x + 4, 78);
    });
    if (me.item && PICKUP_INFO[me.item]) {
      const info = PICKUP_INFO[me.item];
      drawPanel(g, 12, 104, 320, 30);
      g.font = `800 12px ${FONT_BODY}`;
      g.textAlign = 'left';
      g.fillStyle = info.color;
      g.fillText(`${info.icon} ${info.label}`, 24, 124);
      g.fillStyle = '#f3ecd8';
      g.textAlign = 'right';
      g.fillText(`Q: ${info.hint}`, 320, 124);
    }
    const cd = clamp(1 - pred.dashCd / S.PLAYER.dashCooldown, 0, 1);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(22, 86, 60, 3);
    g.fillStyle = cd >= 1 ? '#dff3ff' : '#8fb3c9';
    g.fillRect(22, 86, 60 * cd, 3);
    g.font = `700 9px ${FONT_BODY}`;
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText('úhyb', 86, 90);
  }

  if (snap.weather && snap.weather.kind !== 'clear') {
    const info = WEATHER_INFO[snap.weather.kind];
    drawPanel(g, 344, 12, 108, 32);
    g.font = `800 12px ${FONT_BODY}`;
    g.fillStyle = '#cfe6ff';
    g.textAlign = 'left';
    tabText(g, `${info.icon} ${info.label} ${snap.weather.t}s`, 354, 33);
  }

  const sorted = [...snap.players].sort((a, b) => b.score - a.score).slice(0, 8);
  const boardH = 34 + sorted.length * 18;
  const bx = VIEW.w - 232;
  drawPanel(g, bx, 12, 220, boardH);
  g.font = `900 14px ${FONT_TITLE}`;
  g.fillStyle = '#ffd27f';
  g.textAlign = 'left';
  g.fillText('Lovci', bx + 14, 34);
  g.textAlign = 'right';
  g.fillText('Body', bx + 206, 34);
  g.font = `700 12px ${FONT_BODY}`;
  sorted.forEach((p, i) => {
    const yy = 54 + i * 18;
    g.fillStyle = outfitOf(p).jacket;
    roundRect(g, bx + 14, yy - 10, 10, 10, 2);
    g.fill();
    g.fillStyle = p.id === myId ? '#ffd27f' : p.alive ? '#f3ecd8' : '#a08c78';
    g.textAlign = 'left';
    const tag = !p.alive ? ' 👻' : p.on === false ? ' 📵' : p.weapon && p.weapon !== 'rifle' ? ` ${PICKUP_INFO[p.weapon].icon}` : '';
    g.fillText(`${i + 1}. ${p.name}${tag}`, bx + 30, yy);
    g.textAlign = 'right';
    if (p.id === myId) {
      g.save();
      g.translate(bx + 206, yy);
      g.scale(1 + scoreBump * 0.5, 1 + scoreBump * 0.5);
      tabText(g, `${scoreShown}`, 0, 0, 'right');
      g.restore();
    } else tabText(g, `${p.score}`, bx + 206, yy, 'right');
  });

  g.textAlign = 'left';
  g.font = `700 12px ${FONT_BODY}`;
  for (let i = feed.length - 1; i >= 0; i--) {
    const f = feed[i];
    f.life -= dt;
    if (f.life <= 0) {
      feed.splice(i, 1);
      continue;
    }
    g.globalAlpha = Math.min(1, f.life);
    const yy = VIEW.h - 64 - i * 20;
    g.fillStyle = 'rgba(20,12,5,0.6)';
    roundRect(g, 12, yy - 14, g.measureText(f.text).width + 16, 19, 4);
    g.fill();
    g.fillStyle = f.color;
    g.fillText(f.text, 20, yy);
  }
  g.globalAlpha = 1;

  g.textAlign = 'right';
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.font = `600 10px ${FONT_BODY}`;
  tabText(g, `${latency} ms`, VIEW.w - 14, VIEW.h - 10, 'right');
}

function drawBanner(g, dt) {
  if (!banner) return;
  banner.t += dt;
  const { t, maxT } = banner;
  if (t >= maxT) {
    banner = null;
    return;
  }
  const inK = easeOut(clamp(t / 0.4, 0, 1));
  const outK = clamp((maxT - t) / 0.5, 0, 1);
  g.save();
  g.globalAlpha = Math.min(inK, outK);
  g.translate(VIEW.w / 2, VIEW.h * 0.3);
  g.scale(0.7 + inK * 0.3, 0.7 + inK * 0.3);
  g.fillStyle = 'rgba(20,10,30,0.55)';
  roundRect(g, -230, -46, 460, 92, 12);
  g.fill();
  g.strokeStyle = banner.color;
  g.lineWidth = 2;
  g.stroke();
  g.textAlign = 'center';
  g.font = `900 38px ${FONT_TITLE}`;
  g.fillStyle = banner.color;
  g.shadowColor = banner.glow;
  g.shadowBlur = 18;
  g.fillText(banner.title, 0, 4);
  g.shadowBlur = 0;
  g.font = `700 15px ${FONT_BODY}`;
  g.fillStyle = '#f3ecd8';
  g.fillText(banner.sub, 0, 30);
  g.restore();
}

function drawGhostHint(g, me, dt) {
  if (ghostHint <= 0 || gameOver) return;
  ghostHint -= dt;
  g.save();
  g.globalAlpha = clamp(ghostHint, 0, 1);
  const pw = 440;
  const ph = 74;
  const px = VIEW.w / 2 - pw / 2;
  const py = 104;
  drawPanel(g, px, py, pw, ph);
  g.textAlign = 'center';
  g.font = `900 20px ${FONT_TITLE}`;
  g.fillStyle = '#dff3ff';
  g.fillText('Lišky tě dostaly. Teď jsi duch.', VIEW.w / 2, py + 30);
  g.font = `700 12px ${FONT_BODY}`;
  g.fillStyle = '#f3ecd8';
  g.fillText(`Přežil(a) jsi ${me.survived} s. Přileť k živému lovci, ať tě oživí klávesou E (10 HP).`, VIEW.w / 2, py + 52);
  g.restore();
}

function drawGameOver(g, snap, dt, time) {
  if (!gameOver) return;
  gameOver.t += dt;
  const k = easeOut(clamp(gameOver.t / 0.6, 0, 1));
  g.fillStyle = `rgba(30,0,0,${0.55 * k})`;
  g.fillRect(0, 0, VIEW.w, VIEW.h);
  const rows = gameOver.ranking.slice(0, 6);
  const pw = 760;
  const rowH = 34;
  const ph = 162 + rows.length * rowH;
  const px = VIEW.w / 2 - pw / 2;
  const py = VIEW.h / 2 - ph / 2;
  g.save();
  g.globalAlpha = k;
  g.translate(0, (1 - k) * 30);
  drawPanel(g, px, py, pw, ph);
  g.textAlign = 'center';
  g.font = `900 30px ${FONT_TITLE}`;
  g.fillStyle = '#ff8b8b';
  g.shadowColor = '#d63d3d';
  g.shadowBlur = 14;
  g.fillText('Lišky ovládly les', VIEW.w / 2, py + 44);
  g.shadowBlur = 0;
  g.font = `700 13px ${FONT_BODY}`;
  g.fillStyle = '#f3ecd8';
  g.fillText(`Došli jste do vlny ${gameOver.wave} a ulovili ${gameOver.kills} lišek.`, VIEW.w / 2, py + 68);

  const cols = { score: px + pw - 430, kills: px + pw - 370, survived: px + pw - 300, total: px + pw - 24 };
  const hy = py + 94;
  g.font = `900 12px ${FONT_TITLE}`;
  g.fillStyle = '#ffd27f';
  g.textAlign = 'left';
  g.fillText('Lovec', px + 40, hy);
  g.textAlign = 'right';
  g.fillText('Body', cols.score, hy);
  g.fillText('Lišky', cols.kills, hy);
  g.fillText('Přežil', cols.survived, hy);
  g.fillText('Celkem', cols.total, hy);
  // Legend for the totals column on its own line, so it never collides with the headers
  g.font = `700 9px ${FONT_BODY}`;
  g.fillStyle = 'rgba(243,236,216,0.7)';
  g.fillText('lišky / oživení / teamkilly (kolo)', cols.total, hy + 12);
  rows.forEach((r, i) => {
    const yy = py + 130 + i * rowH;
    g.fillStyle = outfitOf(r).jacket;
    roundRect(g, px + 22, yy - 10, 10, 10, 2);
    g.fill();
    g.font = `700 13px ${FONT_BODY}`;
    g.fillStyle = r.id === myId ? '#ffd27f' : '#f3ecd8';
    g.textAlign = 'left';
    g.fillText(`${i + 1}. ${r.name}`, px + 40, yy);
    if (r.badges && r.badges.length) {
      g.font = `700 10px ${FONT_BODY}`;
      g.fillStyle = '#c9b3ff';
      g.fillText(r.badges.map((b) => `🏅 ${b}`).join('   '), px + 40, yy + 14);
    }
    g.font = `700 13px ${FONT_BODY}`;
    g.fillStyle = r.id === myId ? '#ffd27f' : '#f3ecd8';
    g.textAlign = 'right';
    tabText(g, `${r.score}`, cols.score, yy, 'right');
    tabText(g, `${r.kills}`, cols.kills, yy, 'right');
    tabText(g, `${r.survived} s`, cols.survived, yy, 'right');
    g.fillStyle = '#c9e6b8';
    g.font = `700 12px ${FONT_BODY}`;
    tabText(g, `${r.totalKills ?? '–'} / ${r.totalRevives ?? '–'} / ${r.totalTeamKills ?? '–'}  (${r.rounds ?? '?'}. kolo)`, cols.total, yy, 'right');
  });
  g.textAlign = 'center';
  g.font = `900 16px ${FONT_TITLE}`;
  g.fillStyle = '#c9e6b8';
  g.save();
  g.translate(VIEW.w / 2, py + ph - 18);
  const pulse = 1 + Math.sin(time * 4) * 0.03;
  g.scale(pulse, pulse);
  tabText(g, `Nové kolo za ${snap.round.restartIn} s`, 0, 0, 'center');
  g.restore();
  g.restore();
}

// ===========================================================================
// Start-screen preview
// ===========================================================================
(function previewLoop() {
  requestAnimationFrame(previewLoop);
  if (overlay.classList.contains('hidden')) return;
  const g = previewCanvas.getContext('2d');
  const t = performance.now() / 1000;
  const dpr = window.devicePixelRatio || 1;
  if (previewCanvas.width !== Math.round(120 * dpr)) {
    previewCanvas.width = Math.round(120 * dpr);
    previewCanvas.height = Math.round(130 * dpr);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, 120, 130);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(60, 112, 26, 6, 0, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.translate(60, 110 + Math.sin(t * 2) * 1.5);
  g.scale(1.5, 1.5);
  const o = OUTFITS[chosenOutfit < 0 ? Math.floor(t / 1.6) % OUTFITS.length : chosenOutfit];
  drawHunterSprite(g, o, { facing: 1, swing: Math.sin(t * 6) * 3, time: t });
  g.restore();
})();

// ===========================================================================
// Body sounds: footsteps, heartbeat and breathing at low HP
// ===========================================================================
function updateBodySounds(me, dt) {
  if (!me || !me.alive || !audioCtx) return;
  if (pred.onGround && Math.abs(pred.vx) > 10 && !pred.climbing) {
    footTimer -= dt;
    if (footTimer <= 0) {
      footTimer = pred.speedBoost ? 0.2 : 0.28;
      SFX.step();
    }
  } else footTimer = 0.05;
  if (me.hp <= 30) {
    heartTimer -= dt;
    if (heartTimer <= 0) {
      heartTimer = 0.55 + (me.hp / 30) * 0.5;
      SFX.heart();
      if (me.hp <= 20) SFX.breath();
    }
  }
}

// ===========================================================================
// Render loop
// ===========================================================================
let lastFrame = performance.now();
let frozenAt = 0;
let leafTimer = 0;

function interpolated(kind, alpha, dtSnap) {
  const curr = currSnap.data[kind];
  if (!prevSnap) return curr.map((e) => ({ ...e, rx: e.x, ry: e.y }));
  const prevById = new Map(prevSnap.data[kind].map((e) => [e.id, e]));
  return curr.map((e) => {
    const p = prevById.get(e.id);
    if (!p || Math.abs(p.x - e.x) > 300) return { ...e, rx: e.x, ry: e.y };
    return { ...e, rx: lerp(p.x, e.x, alpha), ry: lerp(p.y, e.y, alpha), vy: e.vy ?? (e.y - p.y) / dtSnap };
  });
}

function frame(realNow) {
  requestAnimationFrame(frame);
  const realDt = Math.min((realNow - lastFrame) / 1000, 0.1);
  lastFrame = realNow;
  resizeCanvas();
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);

  let now = realNow;
  let dt = realDt;
  if (hitStop > 0) {
    if (!frozenAt) frozenAt = realNow;
    hitStop -= realDt;
    now = frozenAt;
    dt = 0;
  } else frozenAt = 0;
  const time = now / 1000;

  if (!currSnap) {
    ctx.save();
    ctx.scale(ZOOM, ZOOM);
    camX = 0;
    camY = S.WORLD.height - CAM.h;
    drawBackground(ctx, time, 1, 'clear');
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return;
  }

  predictStep(realDt);

  const snap = currSnap.data;
  const weather = snap.weather ? snap.weather.kind : 'clear';
  const broken = new Set(snap.broken || []);
  let alpha = 1;
  let dtSnap = 0.05;
  if (prevSnap) {
    dtSnap = Math.max(0.001, (currSnap.at - prevSnap.at) / 1000);
    alpha = clamp((now - currSnap.at) / (dtSnap * 1000), 0, 1);
  }

  const playersR = interpolated('players', alpha, dtSnap);
  const foxesR = interpolated('foxes', alpha, dtSnap);
  const bulletsR = interpolated('bullets', alpha, dtSnap);
  const me = playersR.find((p) => p.id === myId);
  if (me && predActive) {
    Object.assign(me, { rx: pred.x + renderOff.x, ry: pred.y + renderOff.y, vx: pred.vx, vy: pred.vy, onGround: pred.onGround, climbing: pred.climbing, facing: pred.facing, dash: pred.dashT > 0 });
  }

  for (const e of [...playersR, ...foxesR]) {
    const a = anim(e.id);
    a.lastSeen = now;
    if (!a.wasGround && e.onGround) {
      a.squash = 1;
      dust(e.rx + (e.w || 30) / 2, e.ry + (e.h || 48), e.mega ? 12 : 5);
      if (e.mega) shake = Math.max(shake, 5);
    }
    a.wasGround = e.onGround;
    a.squash = Math.max(0, a.squash - dt * 6);
    a.recoil = Math.max(0, a.recoil - dt * 8);
    a.bite = Math.max(0, a.bite - dt);
    a.hurt = Math.max(0, a.hurt - dt);
  }
  for (const [id, a] of anims) if (now - a.lastSeen > 5000) anims.delete(id);

  const lookTarget = me ? me.facing * 55 : 0;
  camLook += (lookTarget - camLook) * Math.min(1, dt * 2.2);
  const targetX = clamp(me ? me.rx + 15 - CAM.w / 2 + camLook : S.WORLD.width / 2 - CAM.w / 2, 0, S.WORLD.width - CAM.w);
  const targetY = clamp(me ? me.ry + 24 - CAM.h * 0.6 : S.WORLD.height - CAM.h, 0, S.WORLD.height - CAM.h);
  if (!camInit) {
    camX = targetX;
    camY = targetY;
    camInit = true;
  } else {
    camX += (targetX - camX) * Math.min(1, dt * 9);
    camY += (targetY - camY) * Math.min(1, dt * 5);
  }

  shake = Math.max(0, shake - dt * 30);
  const sx = shake ? rand(-shake, shake) : 0;
  const sy = shake ? rand(-shake, shake) : 0;

  owlTimer -= dt;
  if (owlTimer <= 0 && !owl && weather === 'clear') {
    const dir = Math.random() < 0.5 ? 1 : -1;
    owl = { x: dir > 0 ? camX * 0.1 - 40 : camX * 0.1 + CAM.w + 40, y: rand(40, 140) + camY * 0.08, dir, speed: rand(60, 110) };
    owlTimer = rand(12, 25);
  }
  if (owl) {
    owl.x += owl.dir * owl.speed * dt;
    const scr = owl.x - camX * 0.1;
    if (scr < -80 || scr > CAM.w + 80) owl = null;
  }
  leafTimer -= dt;
  if (leafTimer <= 0) {
    spawnLeaf();
    leafTimer = weather === 'storm' ? 0.06 : rand(0.15, 0.4);
  }
  updateRain(dt, weather);
  updateBodySounds(me, dt);

  ctx.save();
  ctx.scale(ZOOM, ZOOM);
  ctx.translate(sx / ZOOM, sy / ZOOM);

  drawBackground(ctx, time, snap.wave, weather);
  const burningById = new Map((snap.burning || []).map((b) => [b.id, b]));
  for (const t of world.trunks) drawTrunk(ctx, t, time, burningById.get(t.id));
  for (const sp of snap.saplings || []) drawSapling(ctx, sp, time);
  drawPlatforms(ctx, time, broken);
  for (const tr of snap.traps || []) drawTrap(ctx, tr, time);
  for (const l of snap.lures || []) drawLure(ctx, l, time);
  for (const d of world.dens) drawDen(ctx, d, (snap.dens || []).find((s) => s.id === d.id), time);

  for (const pk of snap.pickups || []) drawPickup(ctx, pk, pk.x - camX, pk.y - camY, time);
  for (const b of bulletsR) drawBullet(ctx, b, b.rx - camX, b.ry - camY);
  for (const d of dyingFoxes) drawDyingFox(ctx, d);
  for (const f of foxesR) drawFox(ctx, f, f.rx - camX, f.ry - camY, time);
  for (const p of playersR) {
    if (p.alive) drawHunter(ctx, p, p.rx - camX, p.ry - camY, time, p.id === myId);
    else drawGhost(ctx, p, p.rx - camX, p.ry - camY, time, p.id === myId);
    drawEmote(ctx, p, p.rx - camX, p.ry - camY, dt);
  }
  for (const f of snap.fires || []) drawFire(ctx, f, f.x - camX, f.y - camY, time);
  for (let i = hornRings.length - 1; i >= 0; i--) {
    const r = hornRings[i];
    r.t += dt;
    if (r.t > 1.6) {
      hornRings.splice(i, 1);
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const rr = ((r.t + k * 0.3) % 1.6) * 260;
      ctx.strokeStyle = `rgba(217,180,74,${0.6 * (1 - rr / 260)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x - camX, r.y - camY, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  if (me && me.alive) {
    const near = playersR.find((g) => !g.alive && g.on !== false && Math.abs(g.rx - me.rx) < 66 && Math.abs(g.ry - me.ry) < 84);
    if (near) {
      ctx.font = `800 11px ${FONT_BODY}`;
      ctx.textAlign = 'center';
      const text = me.reviving ? `Oživuji ${near.name}… stůj a nestřílej` : `Drž E: oživit ${near.name}`;
      const w = ctx.measureText(text).width + 14;
      ctx.fillStyle = 'rgba(20,12,5,0.7)';
      roundRect(ctx, me.rx + 15 - camX - w / 2, me.ry - camY - 58, w, 18, 4);
      ctx.fill();
      ctx.fillStyle = me.reviving ? '#7fe0a8' : '#ffd27f';
      ctx.fillText(text, me.rx + 15 - camX, me.ry - camY - 45);
    }
    if (me.climbing && input.shoot) {
      ctx.font = `700 10px ${FONT_BODY}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,200,140,0.85)';
      ctx.fillText('při lezení nejde střílet', me.rx + 15 - camX, me.ry - camY - 34);
    }
  }

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
    if (pt.round) {
      ctx.beginPath();
      ctx.arc(pt.x - camX, pt.y - camY, pt.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else ctx.fillRect(pt.x - camX, pt.y - camY, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;

  for (let i = leaves.length - 1; i >= 0; i--) {
    const l = leaves[i];
    l.y += l.vy * dt;
    l.x += (l.vx + Math.sin(time * 1.5 + l.phase) * 25 + (weather === 'storm' ? -120 : 0)) * dt;
    l.rot += l.spin * dt;
    if (l.y > S.WORLD.groundY || l.x < camX - 200 || l.x > camX + CAM.w + 200) {
      leaves.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.translate(l.x - camX, l.y - camY);
    ctx.rotate(l.rot);
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, l.size, l.size * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawRain(ctx);
  drawGroundFog(ctx, time, weather);

  for (let i = dyingFoxes.length - 1; i >= 0; i--) {
    dyingFoxes[i].t += dt;
    if (dyingFoxes[i].t >= dyingFoxes[i].maxT) dyingFoxes.splice(i, 1);
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].t -= dt;
    if (flashes[i].t <= 0) flashes.splice(i, 1);
  }
  drawLights(ctx, playersR);

  if (weather === 'fog') {
    const fx = me ? me.rx + 15 - camX : CAM.w / 2;
    const fy = me ? me.ry + 24 - camY : CAM.h / 2;
    // A firefly lantern (held, or standing nearby) doubles how far you can see
    const lanternNear = me && ((me.item === 'lantern') || (snap.lures || []).some((l) => l.kind === 'lantern' && Math.abs(l.x - me.rx) < 300 && Math.abs(l.y - me.ry) < 200));
    const r = (150 + Math.sin(time * 1.3) * 8) * (lanternNear ? 2 : 1);
    const fog = ctx.createRadialGradient(fx, fy, r * 0.45, fx, fy, r);
    fog.addColorStop(0, 'rgba(180,200,195,0)');
    fog.addColorStop(1, 'rgba(180,200,195,0.93)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, CAM.w, CAM.h);
    ctx.fillStyle = `rgba(180,200,195,${0.08 + 0.04 * Math.sin(time * 0.7)})`;
    ctx.fillRect(0, 0, CAM.w, CAM.h);
  }

  ctx.textAlign = 'center';
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.life -= dt;
    ft.y -= 40 * dt;
    if (ft.life <= 0) {
      floatingTexts.splice(i, 1);
      continue;
    }
    ctx.font = `800 ${ft.size || 14}px ${FONT_BODY}`;
    ctx.globalAlpha = clamp(ft.life, 0, 1);
    ctx.fillStyle = ft.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.strokeText(ft.text, ft.x - camX, ft.y - camY);
    ctx.fillText(ft.text, ft.x - camX, ft.y - camY);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (lightningFlash > 0) {
    lightningFlash = Math.max(0, lightningFlash - dt * 4);
    ctx.fillStyle = `rgba(230,240,255,${0.75 * lightningFlash * lightningFlash})`;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }

  const vg = ctx.createRadialGradient(VIEW.w / 2, VIEW.h / 2, VIEW.h * 0.45, VIEW.w / 2, VIEW.h / 2, VIEW.w * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  if (hurtFlash > 0) {
    hurtFlash = Math.max(0, hurtFlash - dt * 2.5);
    const hg = ctx.createRadialGradient(VIEW.w / 2, VIEW.h / 2, VIEW.h * 0.3, VIEW.w / 2, VIEW.h / 2, VIEW.w * 0.7);
    hg.addColorStop(0, 'rgba(200,0,0,0)');
    hg.addColorStop(1, `rgba(200,0,0,${0.55 * hurtFlash})`);
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }
  if (me && me.alive && me.hp <= 30) {
    const pulse = 0.12 + 0.1 * Math.abs(Math.sin(time * (me.hp <= 15 ? 5 : 3)));
    const lg = ctx.createRadialGradient(VIEW.w / 2, VIEW.h / 2, VIEW.h * 0.4, VIEW.w / 2, VIEW.h / 2, VIEW.w * 0.7);
    lg.addColorStop(0, 'rgba(120,0,0,0)');
    lg.addColorStop(1, `rgba(120,0,0,${pulse})`);
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }

  const myRank = Math.max(0, [...snap.players].sort((a, b) => b.score - a.score).findIndex((p) => p.id === myId));
  const targetSX = VIEW.w - 26;
  const targetSY = 54 + myRank * 18;
  for (let i = scoreFlyers.length - 1; i >= 0; i--) {
    const f = scoreFlyers[i];
    f.t += dt / 0.9;
    if (f.t >= 1) {
      scoreFlyers.splice(i, 1);
      scoreBump = 1;
      scoreShown += f.delta || 10;
      continue;
    }
    const k = easeOut(f.t);
    const x = lerp((f.wx - camX) * ZOOM + sx, targetSX, k);
    const y = lerp((f.wy - camY) * ZOOM + sy, targetSY, k) - Math.sin(f.t * Math.PI) * 60;
    ctx.font = `900 ${18 - k * 6}px ${FONT_BODY}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd27f';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.strokeText(f.text, x, y);
    ctx.fillText(f.text, x, y);
  }
  if (me) {
    if (scoreFlyers.length === 0 && scoreShown !== me.score) scoreShown = me.score;
    if (scoreShown > me.score) scoreShown = me.score;
  }
  scoreBump = Math.max(0, scoreBump - dt * 4);

  drawHUD(ctx, me, snap, dt);
  drawMinimap(ctx, snap);
  drawBanner(ctx, dt);
  if (me && !me.alive) drawGhostHint(ctx, me, dt);
  drawGameOver(ctx, snap, dt, time);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

requestAnimationFrame(frame);
