import * as THREE from 'three';

/* =====================================================================
   SEASIDE SMASH — twilight tennis
   A playable recreation of the reference clip: pink-violet dusk sky,
   glittering navy sea, pine/cypress silhouettes, glowing lamps,
   green court, black-silhouette players, glowing ball.
   ===================================================================== */

// ---------- constants ----------
const COURT = { L: 23.77, WD: 10.97, WS: 8.23, SERV: 6.4, NET_C: 0.914, NET_P: 1.07 };
const GRAV = 16;
const BALL_R = 0.11;
const NEAR = 1, FAR = -1;                 // side signs (near = camera side, z+)
const WIN_GAMES = 3;
const PTS = ['0', '15', '30', '40'];

const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- tiny audio engine (all synthesized) ----------
const SFX = {
  ctx: null, master: null, muted: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.waves();
    } catch (e) { /* no audio */ }
  },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; },
  env(g, t0, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  },
  tone(freq, dur, type = 'sine', peak = 0.5, slide = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    this.env(g, t, 0.005, peak, dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.1);
  },
  noise(dur, peak = 0.4, fc = 1200) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = this.ctx.createBufferSource(); s.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fc;
    const g = this.ctx.createGain(); this.env(g, t, 0.004, peak, dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  },
  pop(power, perfect) {
    this.noise(0.09, 0.25 + power * 0.3, 2500);
    this.tone(perfect ? 620 : 380 + power * 260, 0.12, 'square', 0.22, perfect ? 300 : 120);
    if (perfect) this.tone(1240, 0.18, 'sine', 0.2, 400);
  },
  bounce() { this.tone(150, 0.09, 'sine', 0.3, -60); this.noise(0.05, 0.12, 700); },
  net() { this.tone(110, 0.25, 'sawtooth', 0.25, -40); },
  fault() { this.tone(220, 0.3, 'sawtooth', 0.25, -120); },
  whistle(win) {
    this.tone(win ? 2100 : 1700, 0.35, 'sine', 0.25);
    setTimeout(() => this.tone(win ? 2700 : 1400, 0.5, 'sine', 0.25), 180);
  },
  click() { this.tone(700, 0.06, 'sine', 0.2); },
  chime(win) {
    const seq = win ? [523, 659, 784, 1046] : [392, 330, 262, 196];
    seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.4, 'triangle', 0.3), i * 140));
  },
  gull() {
    if (!this.ctx || this.muted) return;
    const f = 1250 + Math.random() * 600;
    this.tone(f, 0.16, 'sine', 0.045, -260);
    setTimeout(() => this.tone(f * 0.78, 0.22, 'sine', 0.035, -180), 170);
  },
  waves() {
    // endless soft surf: looped noise -> lowpass, slow swell LFO
    const ctx = this.ctx, len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) { v = v * 0.98 + (Math.random() * 2 - 1) * 0.02; d[i] = v * 8; }
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.06;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lg = ctx.createGain(); lg.gain.value = 0.035;
    lfo.connect(lg); lg.connect(g.gain);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(); lfo.start();
  }
};

// ---------- input (keyboard + touch stick + buttons) ----------
const Input = {
  move: { x: 0, y: 0 },           // -1..1 (x: left/right, y: up/deep positive)
  keys: {},
  charging: false, chargeT: 0,
  lobQueued: false,
  hitPressed: null,               // callback set by game
  serveTap: null,
  init() {
    addEventListener('keydown', e => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
      if (e.repeat) return;
      this.keys[e.key.toLowerCase()] = true;
      SFX.init();
      if (e.key === ' ' || e.key.toLowerCase() === 'j') Game.onHitButton(true);
      if (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'l') Game.onLobButton();
      if (e.key.toLowerCase() === 'p' || e.key === 'Escape') Game.togglePause();
      if (e.key.toLowerCase() === 'm') Game.toggleMute();
    });
    addEventListener('keyup', e => {
      this.keys[e.key.toLowerCase()] = false;
      if (e.key === ' ' || e.key.toLowerCase() === 'j') Game.onHitButton(false);
    });
    // ----- touch -----
    if (IS_TOUCH) document.body.classList.add('touch');
    $('keysTouch').style.display = document.body.classList.contains('touch') ? 'grid' : 'none';
    $('keysDesk').style.display = document.body.classList.contains('touch') ? 'none' : 'grid';
    const stick = $('stick'), knob = $('knob');
    let stickId = null, ox = 0, oy = 0;
    const setKnob = (dx, dy) => { knob.style.left = (33 + dx) + 'px'; knob.style.top = (33 + dy) + 'px'; };
    addEventListener('pointerdown', e => {
      SFX.init();
      if (e.target.closest('#hitBtn,#lobBtn,.overlay,.iconbtn')) return;
      if (stickId === null && e.clientX < innerWidth * 0.55) {
        stickId = e.pointerId; ox = e.clientX; oy = e.clientY;
        stick.style.display = 'block';
        stick.style.left = (ox - 60) + 'px'; stick.style.top = (oy - 60) + 'px';
        setKnob(0, 0);
      }
    });
    addEventListener('pointermove', e => {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const m = Math.hypot(dx, dy), max = 48;
      if (m > max) { dx = dx / m * max; dy = dy / m * max; }
      setKnob(dx, dy);
      this.stickMove = { x: dx / max, y: -dy / max };
    });
    const endStick = e => {
      if (e.pointerId !== stickId) return;
      stickId = null; this.stickMove = null;
      stick.style.display = 'none';
    };
    addEventListener('pointerup', endStick);
    addEventListener('pointercancel', endStick);
    const hb = $('hitBtn');
    hb.addEventListener('pointerdown', e => { e.preventDefault(); SFX.init(); hb.classList.add('charge'); Game.onHitButton(true); });
    hb.addEventListener('pointerup', e => { e.preventDefault(); hb.classList.remove('charge'); Game.onHitButton(false); });
    $('lobBtn').addEventListener('pointerdown', e => { e.preventDefault(); SFX.init(); Game.onLobButton(); });
    addEventListener('contextmenu', e => e.preventDefault());
  },
  poll() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k['arrowleft'] || k['a']) x -= 1;
    if (k['arrowright'] || k['d']) x += 1;
    if (k['arrowup'] || k['w']) y += 1;
    if (k['arrowdown'] || k['s']) y -= 1;
    if (this.stickMove) { x = this.stickMove.x; y = this.stickMove.y; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    this.move.x = x; this.move.y = y;
  }
};

// ---------- renderer / scene ----------
const container = $('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, IS_TOUCH ? 1.75 : 2));
renderer.setSize(innerWidth, innerHeight);
// flat illustration look: unlit colours, no tone-map crush
renderer.toneMapping = THREE.NoToneMapping;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.5, 20000);
// reference framing: high telephoto camera behind the near baseline,
// horizon at ~19% of frame, far baseline ~56%, net ~66%, near baseline ~95%
const CAM_BASE = new THREE.Vector3(0, 14.69, 46.33);
const CAM_LOOK = new THREE.Vector3(0, 1.59, -20);
let camShake = 0;
let hitStop = 0;

function fitCamera() {
  const a = camera.aspect = innerWidth / innerHeight;
  if (a < 0.9) {
    // portrait: pull straight back along the view ray on narrow phones
    const k = clamp(0.8 / a, 1, 1.16);
    camera.fov = 35;
    CAM_BASE.set(0, 14.69 * k, 46.33 * k);
    CAM_LOOK.set(0, 1.59 * k, -20 * k);
  } else {
    camera.fov = 40;
    CAM_BASE.set(0, 12.8, 40.0);
    CAM_LOOK.set(0, 1.5, -18.0);
  }
  camera.updateProjectionMatrix();
  camera.projectionMatrix.elements[0] *= 1.13;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', fitCamera);
fitCamera();

// everything is unlit flat colour, so no scene lights are needed

// ---------- canvas texture helpers ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const glowTex = canvasTex(128, 128, (g) => {
  const r = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});
const blobTex = canvasTex(128, 128, (g) => {
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(0,0,0,.55)');
  r.addColorStop(0.7, 'rgba(0,0,0,.28)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});

// ---------- sky dome (flat dusk gradient: violet zenith -> magenta -> pink horizon) ----------
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    varying vec3 vDir; uniform float uTime; uniform vec2 uRes;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    void main(){
      float h = normalize(vDir).y;
      // sampled from the reference: violet zenith, magenta belt at ~3 deg,
      // deepening to mauve right at the waterline
      vec3 hor = vec3(0.541,0.388,0.612);   // #8A639C
      vec3 belt= vec3(0.631,0.388,0.616);   // #A1639D
      vec3 zen = vec3(0.432,0.398,0.590);   // sampled zenith
      vec3 col = mix(hor, belt, smoothstep(0.0, 0.045, h));
      col = mix(col, zen, smoothstep(0.045, 0.115, h));
      col = mix(col, vec3(0.463,0.384,0.584), smoothstep(0.022, 0.004, h));
      col = mix(col, vec3(0.155,0.225,0.385), smoothstep(0.002, -0.006, h));
      float sx = gl_FragCoord.x / uRes.x;
      float dark = smoothstep(0.40, 0.02, h) * smoothstep(0.46, 0.04, sx);
      col = mix(col, vec3(0.401, 0.390, 0.585), dark);
      col += (hash(gl_FragCoord.xy) - 0.5) * 0.005;
      gl_FragColor = vec4(col, 1.0);
    }`
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(12000, 48, 32), skyMat));

// ---------- sea: deep navy with sparse silver glitter ----------
const seaMat = new THREE.ShaderMaterial({
  fog: false,
  uniforms: { uTime: { value: 0 } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `
    varying vec3 vW; uniform float uTime;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float glitter(vec2 p, float thr){
      vec2 cell = floor(p), f = fract(p) - 0.5;
      float m = smoothstep(0.31, 0.02, length(f * vec2(1.0, 1.4)));
      return m * step(thr, hash(cell));
    }
    void main(){
      float far = clamp((-vW.z - 30.0) / 400.0, 0.0, 1.0);
      vec3 col = vec3(0.128,0.190,0.332);
      col += vec3(0.010,0.014,0.024) * smoothstep(0.45, 1.0, far);
      vec2 p1 = vec2(vW.x * 0.78, vW.z * 2.15 + uTime * 0.05);
      vec2 p2 = vec2(vW.x * 2.65 + 13.0, vW.z * 6.0 - uTime * 0.08);
      float g = glitter(p1, 0.695) * 0.8 + glitter(p2, 0.845) * 0.42;
      float cl = 0.58 + 0.24 * sin(vW.x * 0.11 + vW.z * 0.07) * sin(vW.z * 0.09 - vW.x * 0.025);
      float band = smoothstep(0.01, 0.10, far) * (1.0 - smoothstep(0.80, 1.0, far)) * (0.36 + 0.55 * cl);
      col += vec3(0.62,0.72,0.88) * g * band * 0.45;
      col += vec3(0.008,0.012,0.02) * sin(vW.z * 0.04 + uTime * 0.2);
      gl_FragColor = vec4(col, 1.0);
    }`
});
{
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(16000, 12000), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -6, -6000);
  scene.add(sea);
  // dark headland / cliff edge between garden and water
  const cliff = new THREE.Mesh(new THREE.BoxGeometry(260, 9, 6),
    new THREE.MeshBasicMaterial({ color: 0x060b13 }));
  cliff.position.set(0, -4.2, -41);
  scene.add(cliff);
  // dark garden floor that carries the eye out to the headland
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(340, 46),
    new THREE.MeshBasicMaterial({ color: 0x060d09 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.06, -33);
  scene.add(floor);
}

// ---------- garden: wall, hedge, bougainvillea, pines, lamps ----------
const garden = new THREE.Group(); scene.add(garden);
{
  const MAT_BLACK = new THREE.MeshBasicMaterial({ color: 0x040705 });
  const MAT_BLACK2 = new THREE.MeshBasicMaterial({ color: 0x060b07 });
  const MAT_FG = new THREE.MeshBasicMaterial({ color: 0x081108 });
  const MAT_POLE = new THREE.MeshBasicMaterial({ color: 0x0c1016 });

  // fine leaf-cluster cutouts: break hedge and canopies into wispy silhouettes
  function leafTexture(seed) {
    return canvasTex(256, 256, (g, W, H) => {
      g.clearRect(0, 0, W, H);
      let r = seed;
      const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
      for (let i = 0; i < 820; i++) {
        const a = rnd() * Math.PI * 2;
        const rad = Math.pow(rnd(), 0.52) * 116;
        const x = W / 2 + Math.cos(a) * rad;
        const y = H / 2 + Math.sin(a) * rad * 0.92;
        const len = 1.5 + rnd() * 3.6, wid = 1.3 + rnd() * 3.0;
        g.fillStyle = `rgba(255,255,255,${0.5 + rnd() * 0.5})`;
        g.save(); g.translate(x, y); g.rotate(rnd() * Math.PI * 2);
        g.beginPath(); g.ellipse(0, 0, len, wid, 0, 0, 7); g.fill(); g.restore();
      }
    });
  }
  const leafMats = [11, 47, 89].map((seed, i) => new THREE.MeshBasicMaterial({
    map: leafTexture(seed), color: [0x040906, 0x081109, 0x0e1d12][i],
    alphaTest: 0.34, side: THREE.DoubleSide
  }));
  let leafPick = 0;
  function leafCard(parent, x, y, z, w, h, rz, mi) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      leafMats[mi === undefined ? (leafPick++) % 3 : mi]);
    m.position.set(x, y, z);
    m.rotation.x = -0.16; m.rotation.z = rz;
    parent.add(m);
  }

  // low pale wall right behind the far baseline
  const wallMat = new THREE.MeshBasicMaterial({ color: 0xa39179 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(33, 0.12, 0.26), wallMat);
  back.position.set(0, 0.09, -14.5); garden.add(back);

  const blob = (mat, r, x, y, z, sy = 0.7) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat);
    m.position.set(x, y, z); m.scale.y = sy;
    m.rotation.set(rand(0, 3), Math.random() * 6, rand(0, 3)); garden.add(m); return m;
  };

  // continuous near-black hedge behind the wall
  for (let x = -17; x <= 17; x += 1.1) {
    blob(Math.random() < 0.5 ? MAT_BLACK : MAT_BLACK2, rand(0.75, 1.3), x + rand(-0.3, 0.3), rand(0.7, 1.15), -16.5, rand(0.7, 0.95));
    if (Math.random() < 0.7) blob(MAT_BLACK2, rand(0.45, 0.85), x + rand(-0.4, 0.4), rand(0.3, 0.65), -15.4, 0.7);
  }
  // low bushes filling the strip in front of the hedge
  for (let x = -16; x <= 16; x += 1.0) {
    blob(MAT_BLACK2, rand(0.35, 0.75), x + rand(-0.3, 0.3), rand(0.2, 0.5), -15.25, 0.65);
  }
  // low side beds outside the court
  for (let z = -13; z <= 13; z += 1.35) {
    for (const sx of [-10.9, 10.9]) {
      blob(MAT_BLACK2, rand(0.55, 0.95), sx + rand(-0.3, 0.3), 0.38, z, 0.72);
    }
  }
  // ragged leaf fringe along the top of the hedge
  for (let i = 0; i < 46; i++) {
    leafCard(garden, rand(-18, 18), rand(0.95, 1.55), rand(-15.6, -15.1),
      rand(1.1, 2.0), rand(0.55, 1.1), rand(0, 6));
  }

  // bougainvillea haze: pink speckle sprites along the hedge and side beds
  const bloomTex = canvasTex(256, 128, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    // draw into a handful of soft clumps so the hedge has gaps, not a pink stripe
    const centers = [];
    for (let i = 0; i < 6; i++) centers.push([rand(34, W - 34), rand(H * 0.3, H * 0.9), rand(28, 58)]);
    for (let i = 0; i < 600; i++) {
      const c = centers[i % centers.length];
      const a = Math.random() * Math.PI * 2, rad = Math.pow(Math.random(), 0.65) * c[2];
      const x = c[0] + Math.cos(a) * rad, y = c[1] + Math.sin(a) * rad * 0.72;
      const rr = 205 + Math.random() * 45, gg = 74 + Math.random() * 58, bb = 124 + Math.random() * 52;
      g.fillStyle = `rgba(${rr | 0},${gg | 0},${bb | 0},${0.45 + Math.random() * 0.5})`;
      g.beginPath(); g.arc(x, y, rand(0.7, 2.3), 0, 7); g.fill();
    }
  });
  const bloomMat = new THREE.SpriteMaterial({ map: bloomTex, transparent: true, depthWrite: false, opacity: 1 });
  const clusters = [-11.5, -8.6, -6.2, -2.4, 1.2, 6.4, 9.1, 12.8, 15.2];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(bloomMat.clone());
    const w = rand(4.8, 7.8);
    s.scale.set(w, w * 0.55, 1);
    s.position.set(clusters[i % clusters.length] + rand(-1.8, 1.8), rand(0.9, 2.0), -16.0 + rand(-0.5, 0.25));
    s.material.opacity = rand(0.8, 1);
    garden.add(s);
  }
  for (const sx of [-10.7, 10.7]) {
    for (let z = -12.5; z < 12; z += 1.0) {
      const s = new THREE.Sprite(bloomMat.clone());
      const w = rand(2.4, 4.0);
      s.scale.set(w, w * 0.58, 1);
      s.position.set(sx + rand(-0.45, 0.45), rand(0.3, 0.85), z + rand(-0.5, 0.5));
      s.material.opacity = rand(0.72, 1);
      garden.add(s);
    }
  }

  // --- umbrella pines: black, wide layered canopies on splayed branches
  function pine(x, z, s, ry = 0) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.20 * s, 0.36 * s, 5.4 * s, 7), MAT_BLACK);
    trunk.position.y = 2.7 * s; g.add(trunk);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const len = rand(2.6, 3.5) * s;
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.15 * s, len, 5), MAT_BLACK);
      br.position.set(Math.cos(a) * len * 0.32, (4.65 + rand(0, 0.3)) * s, Math.sin(a) * len * 0.32);
      br.rotation.z = -Math.cos(a) * 0.72;
      br.rotation.x = Math.sin(a) * 0.72;
      g.add(br);
    }
    const canopy = new THREE.Group(); canopy.position.y = 4.65 * s; g.add(canopy);
    for (let i = 0; i < 6; i++) {
      const tall = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.9, 1.35) * s, 1), MAT_BLACK);
      tall.position.set(rand(-1.2, 1.2) * s, rand(0.4, 0.95) * s, rand(-1.0, 1.0) * s);
      tall.scale.y = rand(0.50, 0.72);
      canopy.add(tall);
    }
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), MAT_BLACK);
    core.scale.set(2.55 * s, 1.12 * s, 2.30 * s); core.position.y = 0.90 * s; canopy.add(core);
    // a few larger sub-crowns give the layered, clumped pine shape
    for (let i = 0; i < 3; i++) {
      const sub = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.9, 1.3) * s, 1), MAT_BLACK);
      sub.position.set(rand(-1.8, 1.8) * s, rand(0.55, 1.25) * s, rand(-1.4, 1.4) * s);
      sub.scale.y = rand(0.55, 0.75);
      canopy.add(sub);
    }
    for (let i = 0; i < 130; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.pow(Math.random(), 0.42) * 3.02 * s;
      const lobe = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.32, 0.86) * s, 1), MAT_BLACK);
      lobe.position.set(Math.cos(a) * rr, rand(-0.25, 1.3) * s, Math.sin(a) * rr * 0.86);
      lobe.scale.y = rand(0.5, 0.7);
      lobe.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      canopy.add(lobe);
    }
    g.position.set(x, 0, z); g.rotation.y = ry; garden.add(g);
  }
  function cypress(x, z, s) {
    const g = new THREE.Group();
    for (const [r, h, yy] of [[0.85, 5.3, 2.7], [0.62, 3.8, 4.4], [0.40, 2.6, 6.0]]) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(r * s, h * s, 7), MAT_BLACK);
      c.position.y = yy * s; c.rotation.y = rand(0, 3); g.add(c);
    }
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.26 * s, 1.1 * s, 6), MAT_BLACK);
    top.position.y = 6.9 * s; g.add(top);
    g.position.set(x, 0, z); garden.add(g);
  }
  // left cluster, big right pine, far-left cypress; centre kept open to the sea
  pine(6.4, -27, 1.78, 0.35);
  pine(13.6, -30, 1.20, 1.2);
  pine(-8.0, -27.5, 1.42, 0.1);
  pine(-12.8, -30, 1.15, 0.8);
  cypress(-12.0, -18.9, 1.9);
  function agave(x, z, s) {
    const g = new THREE.Group();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rand(-0.1, 0.1);
      const len = rand(1.4, 2.4) * s;
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.11 * s, len, 4), MAT_BLACK);
      leaf.position.set(Math.cos(a) * 0.35 * s, len * 0.45, Math.sin(a) * 0.35 * s);
      leaf.rotation.z = -Math.cos(a) * rand(0.55, 0.95);
      leaf.rotation.x = Math.sin(a) * rand(0.55, 0.95);
      g.add(leaf);
    }
    g.position.set(x, 0.5, z); garden.add(g);
  }
  agave(7.6, -20.5, 1.15);
  agave(11.4, -22.5, 0.8);
  agave(-11.2, -19.5, 0.7);
  // low black treeline immediately behind the hedge
  for (let i = 0; i < 34; i++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.8, 1.7), 1), MAT_BLACK);
    m.position.set(rand(-30, 30), rand(0.35, 1.0), rand(-23, -19.5));
    m.scale.y = rand(0.6, 0.85);
    garden.add(m);
  }
  // distant soft treeline connecting the heads
  for (let i = 0; i < 26; i++) {
    const x = rand(-30, 30), s = rand(1.0, 2.0);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), MAT_BLACK2);
    m.position.set(x, rand(0.1, 0.8), rand(-34, -27));
    m.scale.y = rand(0.4, 0.7);
    garden.add(m);
  }

  // lamps: slim posts, small bright globes at the far corners
  window.__lampLights = [];
  for (const sx of [-12.6, 12.6]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 6.95, 8), MAT_POLE);
    pole.position.set(sx, 3.475, -15.5); garden.add(pole);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xfffdf0 }));
    orb.position.set(sx, 7.0, -15.5); garden.add(orb);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xfff8e8, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    halo.scale.set(1.45, 1.45, 1); halo.material.opacity = 0.65;
    halo.position.copy(orb.position); garden.add(halo);
    window.__lampLights.push({ halo, seed: Math.random() * 10 });
  }

  // fine foreground thicket: tiny leaf clusters, ragged top around 90%
  for (let layer = 0; layer < 5; layer++) {
    for (let i = 0; i < 300; i++) {
      const x = rand(-9.4, 9.4);
      const z = rand(16.0, 20.6);
      const edge = Math.abs(x) > 5.4;
      const h = rand(0.09, 0.24) + (z - 16.0) * 0.09 + layer * 0.015;
      const hh = h * (edge ? 1.16 : 1.0);
      const w = rand(0.09, 0.28);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1),
        Math.random() < 0.6 ? MAT_FG : MAT_BLACK2);
      m.position.set(x, hh * 0.55, z);
      m.scale.set(w, hh * 0.5, w * 0.8);
      m.rotation.set(rand(0, 3), rand(0, 6), rand(0, 3));
      garden.add(m);
    }
  }
  // tall rounded bushes anchoring the bottom corners
  for (const [bx, bz] of [[-7.0, 17.0], [7.0, 17.2]]) {
    for (let i = 0; i < 5; i++) {
      const h = rand(0.9, 1.35);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), MAT_BLACK);
      m.position.set(bx + rand(-0.5, 0.5), h * 0.55, bz + rand(-0.35, 0.35));
      m.scale.set(rand(0.5, 0.9), h * 0.5, rand(0.5, 0.8));
      m.rotation.set(rand(0, 3), rand(0, 6), rand(0, 3));
      garden.add(m);
    }
  }
  for (let i = 0; i < 380; i++) {
    const x = rand(-9.4, 9.4);
    const z = rand(15.8, 20.6);
    const len = rand(0.18, 0.62);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(rand(0.012, 0.04), len, 3), MAT_BLACK);
    blade.position.set(x, len * 0.55, z);
    blade.rotation.set(rand(-0.6, 0.6), rand(0, 6), rand(-0.6, 0.6));
    garden.add(blade);
  }
  // fine leaf crown at the far edge of the thicket, shaping the silhouette
  for (let i = 0; i < 170; i++) {
    const x = rand(-9.6, 9.6);
    const z = rand(15.9, 18.3);
    const h = rand(0.24, 0.44) + (18.3 - z) * 0.08;
    leafCard(garden, x, h * 0.46, z, h * rand(1.6, 2.6), h, rand(-0.55, 0.55),
      Math.random() < 0.35 ? 2 : 1);
  }
  // deeper fill so the band stays solid
  for (let i = 0; i < 100; i++) {
    const x = rand(-9.6, 9.6);
    const z = rand(17.8, 20.8);
    const h = rand(0.6, 1.4);
    leafCard(garden, x, h * 0.44, z, h * rand(1.4, 2.2), h, rand(-0.5, 0.5),
      Math.random() < 0.6 ? 0 : 1);
  }
  // landmark bushes matching the reference's uneven top
  for (const [bx, bz, bh] of [[-5.9, 16.1, 1.15], [3.5, 16.0, 1.0], [6.9, 18.8, 0.7], [-6.9, 19.0, 0.7]]) {
    for (let i = 0; i < 6; i++) {
      const h = bh * rand(0.7, 1.15);
      leafCard(garden, bx + rand(-1.0, 1.0), h * 0.46, bz + rand(-0.5, 0.5),
        h * rand(1.2, 1.9), h, rand(-0.55, 0.55), Math.random() < 0.5 ? 1 : 0);
    }
  }
  // solid mass under the tall left bush
  for (let i = 0; i < 4; i++) {
    const h = rand(0.4, 0.7);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), MAT_FG);
    m.position.set(-6.0 + rand(-0.9, 0.9), h * 0.55, 16.1 + rand(-0.6, 0.6));
    m.scale.set(rand(0.45, 0.9), h * 0.55, rand(0.4, 0.8));
    m.rotation.set(rand(0, 3), rand(0, 6), rand(0, 3));
    garden.add(m);
  }
  // yucca fans breaking the edge
  for (const [fx, fz, fs, n] of [[-6.4, 19.4, 1.25, 13], [3.4, 19.8, 1.35, 14], [7.2, 20.2, 1.05, 10]]) {
    for (let i = 0; i < n; i++) {
      const len = rand(1.1, 2.0) * fs;
      const a = (i / n) * Math.PI * 2 + rand(-0.14, 0.14);
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(rand(0.06, 0.13), len, 4), MAT_BLACK);
      leaf.position.set(fx + Math.cos(a) * 0.28, len * 0.42, fz + Math.sin(a) * 0.22);
      leaf.rotation.set(Math.sin(a) * rand(0.5, 0.9), rand(0, 6), -Math.cos(a) * rand(0.5, 0.9));
      garden.add(leaf);
    }
  }
}

// merge the static garden into a few draw calls (big mobile win)
(function mergeGarden() {
  const groups = new Map();
  garden.traverse(o => {
    if (!o.isMesh) return;
    if (!groups.has(o.material)) groups.set(o.material, []);
    groups.get(o.material).push(o);
  });
  for (const [mat, list] of groups) {
    if (list.length < 2) continue;
    let total = 0;
    const geos = list.map(o => {
      o.updateWorldMatrix(true, false);
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      total += g.attributes.position.count;
      return g;
    });
    const pos = new Float32Array(total * 3);
    const useUV = geos.every(g => g.attributes.uv);
    const uv = useUV ? new Float32Array(total * 2) : null;
    let off = 0, uoff = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, off);
      off += g.attributes.position.array.length;
      if (uv) { uv.set(g.attributes.uv.array, uoff); uoff += g.attributes.uv.array.length; }
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (uv) merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(merged, mat);
    mesh.frustumCulled = false;
    garden.add(mesh);
    for (const o of list) o.parent.remove(o);
  }
})();

// ---------- court ----------
function courtTexture() {
  return canvasTex(1024, 2220, (g, W, H) => {
    g.fillStyle = '#365033'; g.fillRect(0, 0, W, H);
    // barely-there mow bands
    const bands = 9;
    g.fillStyle = 'rgba(255,255,255,0.022)';
    for (let i = 0; i < bands; i += 2) g.fillRect(0, H / bands * i, W, H / bands);
    const sh = g.createLinearGradient(0, 0, 0, H * 0.30);
    sh.addColorStop(0, 'rgba(8,34,20,0.44)'); sh.addColorStop(0.30, 'rgba(8,28,16,0.24)'); sh.addColorStop(1, 'rgba(8,24,14,0)');
    g.fillStyle = sh; g.fillRect(0, 0, W, H * 0.30);
    // fine grain
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.018)';
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    // slightly darker at the sides
    const vg = g.createLinearGradient(0, 0, W, 0);
    vg.addColorStop(0, 'rgba(0,0,0,0.09)'); vg.addColorStop(0.12, 'rgba(0,0,0,0)');
    vg.addColorStop(0.88, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.09)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);

    const s = 93.4;                        // px per metre — texture fills the court plane
    const cx = W / 2, cy = H / 2;
    const hwD = COURT.WD / 2 * s, hl = COURT.L / 2 * s;
    const hwS = COURT.WS / 2 * s, serv = COURT.SERV * s;
    g.strokeStyle = '#ecdfc0'; g.fillStyle = '#ecdfc0';
    g.lineWidth = 2.7;
    g.strokeRect(cx - hwD + 4, cy - hl + 4, hwD * 2 - 8, hl * 2 - 8);
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(cx - hwS, cy - hl + 4); g.lineTo(cx - hwS, cy + hl - 4);
    g.moveTo(cx + hwS, cy - hl + 4); g.lineTo(cx + hwS, cy + hl - 4);
    g.moveTo(cx - hwS, cy - serv); g.lineTo(cx + hwS, cy - serv);
    g.moveTo(cx - hwS, cy + serv); g.lineTo(cx + hwS, cy + serv);
    g.stroke();
    g.fillRect(cx - 1.1, cy - serv, 2.2, serv * 2);
    g.fillRect(cx - 1.1, cy - hl + 4, 2.2, 16); g.fillRect(cx - 1.1, cy + hl - 20, 2.2, 16);
  });
}
{
  // dark surrounding grass, then the court itself
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(38, 46),
    new THREE.MeshBasicMaterial({ color: 0x314b34 }));
  apron.rotation.x = -Math.PI / 2; apron.position.set(0, -0.03, 0); scene.add(apron);
  const court = new THREE.Mesh(new THREE.PlaneGeometry(COURT.WD, COURT.L),
    new THREE.MeshBasicMaterial({ map: courtTexture() }));
  court.rotation.x = -Math.PI / 2; scene.add(court);
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(90, 70),
    new THREE.MeshBasicMaterial({ color: 0x16251c }));
  surround.rotation.x = -Math.PI / 2; surround.position.set(0, -0.05, -6); scene.add(surround);
  // black planting bed under the foreground shrubs so the bottom band stays solid
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(110, 34),
    new THREE.MeshBasicMaterial({ color: 0x030604 }));
  bed.rotation.x = -Math.PI / 2; bed.position.set(0, 0.012, 33); scene.add(bed);
  const hedgeShade = new THREE.Mesh(new THREE.PlaneGeometry(46, 4.2),
    new THREE.MeshBasicMaterial({ color: 0x0f1a12 }));
  hedgeShade.rotation.x = -Math.PI / 2; hedgeShade.position.set(0, -0.02, -14.4); scene.add(hedgeShade);
}
// ---------- net ----------
const netTopAt = x => COURT.NET_C + (COURT.NET_P - COURT.NET_C) * Math.min(1, (Math.abs(x) / 6.4) ** 2);
{
  const netTex = canvasTex(1024, 64, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(118,130,120,0.5)'; g.lineWidth = 1.1;
    for (let x = 0; x <= W; x += 7) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += 7) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  });
  const geo = new THREE.PlaneGeometry(12.8, 0.95, 32, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0.4) pos.setY(i, pos.getY(i) - (1 - Math.min(1, Math.abs(pos.getX(i)) / 6.4)) * 0.156);
  }
  const net = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: netTex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.15
  }));
  net.position.set(0, 0.55, 0.8); scene.add(net);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.042, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xe7dcbb }));
  tape.position.set(0, 1.0, 0.8); scene.add(tape);
  const postMat = new THREE.MeshBasicMaterial({ color: 0x0b0d12 });
  for (const sx of [-6.55, 6.55]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1.12, 8), postMat);
    p.position.set(sx, 0.56, 0.8); scene.add(p);
  }
  // soft net shade pooling toward the camera
  const shadeTex = canvasTex(256, 96, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.45, 'rgba(255,255,255,.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
    for (let x = 0; x < W; x += 12) g.fillRect(x, 0, 2, H);
    for (let y = 0; y < H; y += 12) g.fillRect(0, y, W, 2);
  });
  const netShade = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 3.0),
    new THREE.MeshBasicMaterial({ map: shadeTex, color: 0x0b140d, transparent: true, opacity: 0.4, depthWrite: false }));
  netShade.rotation.x = -Math.PI / 2;
  netShade.position.set(0, 0.016, 1.5); scene.add(netShade);
}
// (no floating motes — the reference is still and clean)
// ---------- player rigs (black silhouettes like the clip) ----------
const SILH = new THREE.MeshBasicMaterial({ color: 0x05070b });
function makeRacket() {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 8, 20), SILH);
  head.position.y = 0.55; g.add(head);
  const strings = new THREE.Mesh(new THREE.CircleGeometry(0.25, 16),
    new THREE.MeshBasicMaterial({ color: 0x232a33, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  strings.position.y = 0.55; g.add(strings);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.5, 6), SILH);
  handle.position.y = 0.12; g.add(handle);
  return g;
}
function makePlayer() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.5, 4, 10), SILH);
  torso.position.y = 0.45; hips.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), SILH);
  head.position.y = 1.05; hips.add(head);
  function limb(r, len) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), SILH);
    return m;
  }
  const legL = limb(0.09, 0.7); legL.position.set(-0.13, 0.5, 0); root.add(legL);
  const legR = limb(0.09, 0.7); legR.position.set(0.13, 0.5, 0); root.add(legR);
  const armL = limb(0.07, 0.5); armL.position.set(-0.3, 1.25, 0); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.3, 1.25, 0); body.add(armR);
  const armRm = limb(0.07, 0.5); armRm.position.y = -0.25; armR.add(armRm);
  const racket = makeRacket(); racket.position.y = -0.5; racket.rotation.x = 0.4; armR.add(racket);
  // blob shadow
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 6.4),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.4 }));
  blob.rotation.x = -Math.PI / 2; blob.position.set(0.35, 0.02, -2.3); root.add(blob);
  scene.add(root);
  return {
    root, body, hips, torso, head, legL, legR, armL, armR, racket, blob,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    phase: Math.random() * 9, swingT: 1, swingKind: 'fh', jumpT: 1, tossT: 1,
    swing(kind) { this.swingT = 0; this.swingKind = kind; if (kind === 'serve') this.tossT = 0; },
    update(dt, speed, faceX, faceZ) {
      this.phase += dt * (2.2 + speed * 1.9);
      const sw = Math.sin(this.phase) * clamp(speed / 7, 0, 1);
      this.legL.rotation.x = sw * 0.85; this.legR.rotation.x = -sw * 0.85;
      const idle = Math.sin(this.phase * 0.5) * 0.03;
      this.body.position.y = idle - clamp(speed / 7, 0, 1) * 0.06;
      this.body.rotation.x = clamp(speed / 7, 0, 1) * 0.16;         // run lean
      this.body.rotation.y = lerp(this.body.rotation.y, clamp(-faceX * 0.35, -0.6, 0.6), 8 * dt);
      this.root.rotation.y = Math.atan2(faceX, faceZ);
      // swing animation
      if (this.swingT < 1) {
        this.swingT = Math.min(1, this.swingT + dt / 0.38);
        const t = this.swingT, snap = Math.sin(t * Math.PI);
        if (this.swingKind === 'bh') {
          this.armR.rotation.set(-1.2 + snap * 0.4, 0, 1.5 - t * 2.4);
          this.body.rotation.y = -0.5 + t * 0.9;
        } else if (this.swingKind === 'serve') {
          this.armR.rotation.set(-2.6 + t * 3.4, 0, -0.3);
          this.armL.rotation.set(-2.4 + Math.min(1, t * 2) * 1.8, 0, 0.4);
          this.body.rotation.x = -0.18 + t * 0.3;
        } else {
          this.armR.rotation.set(-1.4 + snap * 0.5, 0, -1.3 + t * 2.5);
          this.body.rotation.y = 0.5 - t * 0.95;
        }
      } else {
        // ready stance
        this.armR.rotation.set(lerp(this.armR.rotation.x, -0.72, 6 * dt), 0, lerp(this.armR.rotation.z, -0.30, 6 * dt));
        this.armL.rotation.set(lerp(this.armL.rotation.x, -0.52, 6 * dt), 0, lerp(this.armL.rotation.z, 0.35, 6 * dt));
        this.legL.rotation.z = lerp(this.legL.rotation.z, 0.10, 6 * dt);
        this.legR.rotation.z = lerp(this.legR.rotation.z, -0.10, 6 * dt);
        if (speed < 0.6) this.body.rotation.x = lerp(this.body.rotation.x, 0.10, 4 * dt);
      }
      if (this.jumpT < 1) {
        this.jumpT = Math.min(1, this.jumpT + dt / 0.5);
        this.root.position.y = Math.sin(this.jumpT * Math.PI) * 0.55;
      } else this.root.position.y = 0;
    }
  };
}
const playerRig = makePlayer();   // YOU (near)
const rivalRig = makePlayer();    // RIVAL (far)
playerRig.root.scale.setScalar(1.08); rivalRig.root.scale.setScalar(1.08);

// ---------- ball, trail, markers ----------
const ball = {
  mesh: new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 14, 12),
    new THREE.MeshBasicMaterial({ color: 0xd8ff5e })),
  glow: new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xc6ff4d, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false
  })),
  light: new THREE.PointLight(0xc6ff4d, 8, 9, 2),
  pos: new THREE.Vector3(0, 1, 12), vel: new THREE.Vector3(),
  live: false, dead: false, lastHitter: 0, bounces: 0, firstIn: false, netTouch: false, deadT: 0, airT: 0,
};
ball.glow.scale.set(0.32, 0.32, 1);
scene.add(ball.mesh, ball.glow, ball.light);

const trailPool = [];
for (let i = 0; i < 18; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xc6ff4d, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  scene.add(sp); trailPool.push(sp);
}
const trailPts = [];
// landing predictor ring
const marker = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.035, 8, 28),
  new THREE.MeshBasicMaterial({ color: 0xc6ff4d, transparent: true, opacity: 0.9 }));
marker.rotation.x = -Math.PI / 2; marker.visible = false; scene.add(marker);
const apexRing = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.03, 8, 28),
  new THREE.MeshBasicMaterial({ color: 0xffd94d, transparent: true, opacity: 0.9 }));
apexRing.rotation.x = -Math.PI / 2; apexRing.visible = false; scene.add(apexRing);
// shot aim ring shown while charging
const aimRing = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 8, 26),
  new THREE.MeshBasicMaterial({ color: 0xd8ff5e, transparent: true, opacity: 0.6, depthWrite: false }));
aimRing.rotation.x = -Math.PI / 2; aimRing.visible = false; scene.add(aimRing);

// pink petals celebrating points
const petalTex = canvasTex(64, 64, (g) => {
  g.clearRect(0, 0, 64, 64);
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,214,231,1)');
  grd.addColorStop(0.55, 'rgba(255,127,165,.95)');
  grd.addColorStop(1, 'rgba(255,127,165,0)');
  g.fillStyle = grd;
  g.beginPath(); g.ellipse(32, 32, 27, 14, 0.5, 0, 7); g.fill();
});
const petalPool = [];
for (let i = 0; i < 24; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: petalTex, transparent: true, opacity: 0, depthWrite: false
  }));
  sp.scale.set(0.3, 0.16, 1);
  scene.add(sp);
  petalPool.push({ sp, life: 0, max: 1, v: new THREE.Vector3() });
}
function petalBurst(x, z, n = 16, height = 1.4) {
  let made = 0;
  for (const p of petalPool) {
    if (p.life > 0) continue;
    p.max = p.life = rand(1.4, 2.4);
    p.sp.position.set(x + rand(-1.5, 1.5), height + rand(0, 1.4), z + rand(-1.5, 1.5));
    p.v.set(rand(-2.2, 2.2), rand(0.8, 3.2), rand(-2.2, 2.2));
    p.sp.material.rotation = rand(0, 6);
    p.sp.material.opacity = 0;
    if (++made >= n) break;
  }
}

function predictLanding(p, v) {
  const q = p.clone(), w = v.clone(), dt = 1 / 60;
  for (let i = 0; i < 240; i++) {
    w.y -= GRAV * dt; q.addScaledVector(w, dt);
    if (q.y <= BALL_R && w.y < 0) return q;
    if (Math.abs(q.z) > 30 || Math.abs(q.x) > 24) return q;
  }
  return q;
}
// ballistic velocity to land exactly on target after T seconds
function shotVelocity(from, target, T) {
  return new THREE.Vector3(
    (target.x - from.x) / T,
    (target.y - from.y) / T + 0.5 * GRAV * T,
    (target.z - from.z) / T
  );
}
function clearShot(from, target, T0, clearance) {
  for (let i = 0; i < 9; i++) {
    const T = T0 + i * 0.09;
    const v = shotVelocity(from, target, T);
    if (Math.abs(v.z) < 0.01) continue;
    const t0 = (0 - from.z) / v.z;
    if (t0 < 0 || t0 > T) return { v, T };
    const yNet = from.y + v.y * t0 - 0.5 * GRAV * t0 * t0;
    const apex = from.y + v.y * v.y / (2 * GRAV);
    if (yNet > netTopAt(0) + clearance && apex < 8.5) return { v, T };
  }
  const v = shotVelocity(from, target, T0 + 0.9);
  return { v, T: T0 + 0.9 };
}

// ---------- game state ----------
const Game = {
  mode: 'serve', paused: false, over: false,
  server: NEAR, pointIndex: 0, faults: 0,
  pts: { [NEAR]: 0, [FAR]: 0 }, games: { [NEAR]: 0, [FAR]: 0 },
  rally: 0, best: 0, topSpeed: 0, perfects: 0, aces: 0,
  tossApex: 3.0, tossed: false, serveSide: 1,
  ai: { home: new THREE.Vector3(0.9, 0, -10.5), err: 0, react: 0, cool: 0, serveT: 0, plan: null },
  diff: 0.45,
  charge: 0, charging: false,
  msgTimer: 0,
  stats: { rallies: [] },

  resetPositions() {
    const s = this.serveSide;
    if (this.server === NEAR) {
      playerRig.pos.set(2.7 * s, 0, COURT.L / 2 + 1.3);
      rivalRig.pos.set(-0.9 * s, 0, -(COURT.L / 2 - 3.0));
    } else {
      rivalRig.pos.set(2.7 * s, 0, -(COURT.L / 2 + 1.3));
      playerRig.pos.set(-0.9 * s, 0, COURT.L / 2 - 3.0);
    }
    playerRig.vel.set(0, 0, 0); rivalRig.vel.set(0, 0, 0);
    playerRig.root.position.copy(playerRig.pos); rivalRig.root.position.copy(rivalRig.pos);
    ball.live = false; ball.dead = false; ball.bounces = 0; ball.deadT = 0; ball.netTouch = false;
    this.tossed = false; this.rally = 0; this.charge = 0; this.charging = false;
    $('power').classList.remove('show');
    trailPts.length = 0;
    $('rally').textContent = 'RALLY 0';
  },
  startMatch() {
    this.pts[NEAR] = this.pts[FAR] = 0;
    this.games[NEAR] = this.games[FAR] = 0;
    this.pointIndex = 0; this.faults = 0; this.server = NEAR;
    this.over = false; this.diff = 0.45;
    this.rally = 0; this.best = 0; this.topSpeed = 0; this.perfects = 0; this.aces = 0;
    this.updateBoard();
    this.nextPoint(true);
  },
  nextPoint(first = false) {
    this.serveSide = (this.pointIndex % 2 === 0) ? -1 : 1;
    this.faults = 0;
    this.resetPositions();
    this.mode = 'serve';
    // ball in server's hand
    const r = this.server === NEAR ? playerRig : rivalRig;
    ball.pos.set(r.pos.x, 1.3, r.pos.z - (this.server === NEAR ? 0.4 : -0.4));
    ball.vel.set(0, 0, 0);
    if (this.server === NEAR) {
    } else {
      this.ai.serveT = rand(1.0, 1.6);
    }
  },
  // ----- scoring -----
  scoreText(n) { return n <= 3 ? PTS[n] : '40'; },
  updateBoard() {
    const p = this.pts[NEAR], r = this.pts[FAR];
    let ps = this.scoreText(p), rs = this.scoreText(r);
    if (p >= 3 && r >= 3) {
      if (p === r) { ps = rs = '40'; }
      else if (p === r + 1) { ps = 'AD'; rs = '40'; }
      else if (r === p + 1) { rs = 'AD'; ps = '40'; }
    }
    $('ptsYou').textContent = ps; $('ptsRiv').textContent = rs;
    $('gmsYou').textContent = 'GAMES ' + this.games[NEAR];
    $('gmsRiv').textContent = 'GAMES ' + this.games[FAR];
    $('serveDot').textContent = this.server === NEAR ? '● YOUR SERVE' : '● RIVAL SERVE';
    $('serveDot').style.color = this.server === NEAR ? '#c6ff4d' : '#ff7fa5';
    this.updateStake();
  },
  updateStake() {
    const a = this.pts[NEAR], b = this.pts[FAR];
    let txt = '';
    if (a >= 3 && a > b) txt = this.games[NEAR] === WIN_GAMES - 1 ? 'MATCH POINT' : 'GAME POINT';
    else if (b >= 3 && b > a) txt = this.games[FAR] === WIN_GAMES - 1 ? 'RIVAL MATCH POINT' : 'RIVAL GAME POINT';
    const el = $('stake');
    el.textContent = txt;
    el.classList.toggle('show', !!txt && !this.over);
  },
  awardPoint(w, reason, big) {
    this.mode = 'point';
    if (w === NEAR) petalBurst(clamp(ball.pos.x, -7, 7), clamp(ball.pos.z, -9, 9), 14, 1.2);
    ball.live = false; ball.dead = true; apexRing.visible = false;
    const loser = w === NEAR ? FAR : NEAR;
    // standard tennis scoring on raw point counts (0,1,2,3 = 0,15,30,40)
    const p = this.pts;
    p[w]++;
    const gameDone = p[w] >= 4 && p[w] - p[loser] >= 2;
    if (this.best < this.rally) this.best = this.rally;

    if (gameDone) {
      this.games[w]++;
      this.pts[NEAR] = this.pts[FAR] = 0;
      this.server = this.server === NEAR ? FAR : NEAR;
      this.pointIndex = 0;
      this.diff = clamp(this.diff + (w === FAR ? 0.07 : -0.04), 0.35, 0.92);
      this.updateBoard();
      SFX.whistle(w === NEAR);
      if (this.games[w] >= WIN_GAMES) return this.matchOver(w);
      // Removed msg() call - no helper text display
      SFX.chime(w === NEAR);
      setTimeout(() => { if (!this.over) { this.nextPoint(); } }, 2500);
    } else {
      this.pointIndex++;
      this.updateBoard();
      // Removed msg() call - no helper text display
      if (w === NEAR) SFX.whistle(true);
      setTimeout(() => { if (!this.over && this.mode === 'point') this.nextPoint(); }, 2000);
    }
  },
  matchOver(w) {
    this.over = true; this.mode = 'over';
    $('stake').classList.remove('show');
    if (w === NEAR) {
      petalBurst(0, 2, 24, 2.0);
      playerRig.jumpT = 0; playerRig.swing('fh');
      camShake = 0.35;
    }
    SFX.chime(w === NEAR); SFX.whistle(w === NEAR);
  // Removed endTitle/endScore/endStats display - no overlay
  },
// unstruck toss fell flat — back to the hand, no penalty
  resetToss() {
    this.tossed = false; ball.live = false; ball.dead = false; ball.deadT = 0; ball.bounces = 0;
    apexRing.visible = false;
    const r = this.server === NEAR ? playerRig : rivalRig;
    ball.pos.set(r.pos.x, 1.3, r.pos.z - (this.server === NEAR ? 0.4 : -0.4));
    ball.vel.set(0, 0, 0);
    if (this.server === FAR) this.ai.serveT = rand(0.6, 1.2);
  },
  // ----- buttons -----
  onHitButton(down) {
    if (this.paused || this.over) return;
    if (this.mode === 'menu') return;
    if (down) {
      // serve: first press tosses, second press strikes (timing = press moment)
      if (this.mode === 'serve' && this.server === NEAR) {
        if (!this.tossed) return this.tossServe(NEAR);
        return this.strikeServe(NEAR);
      }
      if (this.mode === 'rally') {
        this.charging = true; this.charge = 0;
        $('power').classList.add('show');
      }
    } else if (this.charging) {
      $('power').classList.remove('show');
      this.charging = false;
      if (this.mode === 'rally') {
        if (!this.tryHit(NEAR, 'flat', this.charge, Input.move)) playerRig.swing('fh'); // whiff
      }
      this.charge = 0;
    }
  },
  onLobButton() {
    if (this.paused || this.over) return;
    if (this.mode === 'rally') {
      if (!this.tryHit(NEAR, 'lob', 0.5, Input.move)) playerRig.swing('fh');
    }
    else if (this.mode === 'serve' && this.tossed && this.server === NEAR) this.strikeServe(NEAR);
  },
  togglePause() {
    if (this.over || this.mode === 'menu') return;
    this.paused = !this.paused;
    if (this.ctxFix) return;
  },
  toggleMute() {
    SFX.setMuted(!SFX.muted);
    $('muteBtn').textContent = SFX.muted ? '🔇' : '🔊';
  },
  // ----- serve -----
  tossServe(side) {
    const r = side === NEAR ? playerRig : rivalRig;
    this.tossed = true;
    ball.pos.set(r.pos.x, 1.5, r.pos.z + (side === NEAR ? -0.3 : 0.3));
    ball.vel.set(rand(-0.2, 0.2), 7.2, 0);
    ball.live = true; ball.dead = false; ball.lastHitter = 0; ball.bounces = 0; ball.netTouch = false; ball.airT = 0; ball.deadT = 0;
    this.tossApex = 1.5 + 7.2 * 7.2 / (2 * GRAV);
    r.swing('serve');
    if (side === NEAR) {
      apexRing.position.set(ball.pos.x, this.tossApex, ball.pos.z);
      apexRing.visible = true;
    }
  },
  strikeServe(side) {
    if (!this.tossed || !ball.live) return;
    // too late — the toss already dropped; re-toss without penalty
    if (ball.lastHitter === 0 && ball.pos.y < 0.6) {
      this.resetToss();
      return;
    }
    const r = side === NEAR ? playerRig : rivalRig;
    const q = clamp(1 - Math.abs(ball.pos.y - this.tossApex) / 1.5, 0, 1);
    const aim = side === NEAR ? Input.move : { x: rand(-1, 1), y: 0.3 };
    const recvSide = -side;
    // diagonal box: server's right side -> receiver's box on the opposite x
    const aiErr = side === FAR ? (1.05 - Game.diff) * 1.6 : 0;
    const target = new THREE.Vector3(
      -2.05 * this.serveSide + (1 - q) * rand(-2.4, 2.4) + (aim.x * 1.2) + rand(-aiErr, aiErr),
      0,
      recvSide * (COURT.SERV - rand(1.0, 2.2) + (1 - q) * rand(-1.5, 2.5))
    );
    const speed = 30 + q * 11;
    const dist = Math.hypot(target.x - ball.pos.x, target.z - ball.pos.z);
    const T = clamp(dist / speed, 0.45, 1.1);
    const { v } = clearShot(ball.pos, target, T, q > 0.35 ? 0.12 : 0.45);
    ball.vel.copy(v); ball.lastHitter = side; ball.bounces = 0; ball.firstIn = false; ball.netTouch = false; ball.airT = 0; ball.dead = false;
    this.serving = true;
    r.swing('serve'); r.jumpT = 0;
    const kmh = v.length() * 3.6;
    if (side === NEAR) {
      $('spd').textContent = Math.round(kmh);
      this.topSpeed = Math.max(this.topSpeed, kmh);
      apexRing.visible = false;
      if (q > 0.75) { this.perfects++; }
    }
    SFX.pop(0.6 + q * 0.4, q > 0.75);
    camShake = Math.min(0.5, 0.2 + q * 0.3);
    if (q > 0.8) hitStop = 0.05;
    this.mode = 'rally';
  },
  // ----- rally hits -----
  racketPoint(rig, side) {
    return new THREE.Vector3(rig.pos.x, clamp(ball.pos.y, 0.6, 2.6), rig.pos.z + (side === NEAR ? -0.5 : 0.5));
  },
  tryHit(side, kind, power, aimVec) {
    if (!ball.live) return false;
    // can't hit twice in a row — ball must be touched by foe or bounce first
    if (ball.lastHitter === side && ball.bounces === 0) return false;
    const rig = side === NEAR ? playerRig : rivalRig;
    // must be on hitter's half (or near it)
    if (Math.sign(ball.pos.z) !== side && Math.abs(ball.pos.z) > 1.2) return false;
    const rp = this.racketPoint(rig, side);
    const d = Math.hypot(ball.pos.x - rp.x, ball.pos.z - rp.z);
    const reach = kind === 'serve' ? 2.6 : 2.35;
    if (d > reach || ball.pos.y > 3.5 || ball.pos.y < 0.15) return false;
    // quality: closeness + timing (descending near waist = best)
    const qDist = 1 - clamp(d / reach, 0, 1);
    const qH = ball.pos.y < 2.4 ? 1 : clamp(1 - (ball.pos.y - 2.4) / 1.2, 0.2, 1);
    let q = clamp(qDist * 0.7 + qH * 0.3 + 0.1, 0, 1);
    this.serving = false;
    ball.airT = 0;
    // pick target on opponent half
    const foe = side === NEAR ? rivalRig : playerRig;
    let target, T0, clearance = 0.3;
    const ax = clamp(aimVec ? aimVec.x : 0, -1, 1);
    const ay = clamp(aimVec ? aimVec.y : 0, -1, 1);
    if (kind === 'lob') {
      target = new THREE.Vector3(clamp(-foe.pos.x * 0.7 + rand(-1, 1), -4, 4), 0, -side * (COURT.L / 2 - rand(0.8, 2)));
      T0 = 1.15; clearance = 1.6;
    } else if (ay < -0.45) {
      // drop shot — just over the net
      target = new THREE.Vector3(clamp(foe.pos.x * 0.2 + ax * 3, -4, 4), 0, -side * rand(2.2, 3.6));
      T0 = 0.62; clearance = 0.55; q = Math.min(1, q + 0.1);
    } else {
      const deep = ay > 0.3 ? rand(9.5, 11.3) : rand(7.2, 10.2);
      // aim: positive ax -> toward +x corner; blend with open court
      const openX = foe.pos.x > 0 ? -3.1 : 3.1;
      const tx = clamp(lerp(openX, ax * 3.9, 0.55) + rand(-0.4, 0.4), -4.05, 4.05);
      target = new THREE.Vector3(tx, 0, -side * deep);
      const dist = Math.hypot(target.x - ball.pos.x, target.z - ball.pos.z);
      T0 = clamp(dist / (19 + power * 13 + q * 4), 0.5, 1.0);
    }
    // error: poor timing / wild overcharge can spray it long or wide
    const err = (1 - q) * 1.5 + Math.max(0, power - 0.82) * 6;
    target.x += rand(-err, err); target.z += -side * rand(-err * 0.4, err);
    const { v, T } = clearShot(ball.pos, target, T0, clearance);
    ball.vel.copy(v);
    ball.lastHitter = side; ball.bounces = 0; ball.firstIn = false; ball.netTouch = false; ball.deadT = 0; ball.dead = false;
    this.rally += 1;
    $('rally').textContent = 'RALLY ' + this.rally;
    if (side === NEAR && [10, 16, 22].includes(this.rally)) {
    }
    // anim: forehand/backhand by ball side
    const onBackhand = (side === NEAR ? (ball.pos.x < rig.pos.x - 0.25) : (ball.pos.x > rig.pos.x + 0.25));
    rig.swing(onBackhand ? 'bh' : 'fh');
    if (ball.pos.y > 2.2) rig.jumpT = 0;
    const kmh = v.length() * 3.6;
    if (side === NEAR) {
      $('spd').textContent = Math.round(kmh);
      this.topSpeed = Math.max(this.topSpeed, kmh);
      if (q > 0.72) {
        this.perfects++;
      }
    }
    SFX.pop(clamp(power * 0.7 + q * 0.5, 0.2, 1), q > 0.72);
    camShake = Math.min(0.6, 0.15 + (0.4 * power + 0.3 * q) * 0.5);
    if (q > 0.78 || power > 0.86) hitStop = 0.055;
    return true;
  },
};

// ---------- AI ----------
function aiUpdate(dt) {
  const ai = Game.ai, rig = rivalRig;
  ai.cool -= dt; ai.react -= dt;
  if (Game.mode === 'serve' && Game.server === FAR && !Game.tossed) {
    ai.serveT -= dt;
    // drift to serve spot (already placed) then toss
    if (ai.serveT <= 0) { Game.tossServe(FAR); ai.serveT = 99; ai.react = 0.5; }
    return;
  }
  if (Game.mode === 'serve' && Game.server === FAR && Game.tossed) {
    // strike near apex with skill-based timing
    if (ball.vel.y < 2.2 && ai.react <= 0) Game.strikeServe(FAR);
    return;
  }
  if (Game.mode !== 'rally' || !ball.live) {
    // recover home
    moveRig(rig, FAR, ai.home.x, ai.home.z, dt, 0.8);
    return;
  }
  const toFarSide = ball.vel.z < 1.5; // ball staying/coming to far half
  if (ball.lastHitter === NEAR || (ball.lastHitter === 0)) {
    if (ai.react <= 0) {
      const land = predictLanding(ball.pos, ball.vel);
      ai.plan = {
        x: clamp(land.x + rand(-0.4, 0.4) * (1.2 - Game.diff), -6.4, 6.4),
        z: clamp(land.z - 0.7, -13.4, -0.6)
      };
      ai.react = 0.18;
    }
    if (ai.plan) moveRig(rig, FAR, ai.plan.x, ai.plan.z, dt, 1);
    // swing?
    if (ai.cool <= 0 && (Math.sign(ball.pos.z) === FAR || Math.abs(ball.pos.z) < 1.2)) {
      if (ball.lastHitter !== FAR || ball.bounces > 0) {
        const rp = Game.racketPoint(rig, FAR);
        const d = Math.hypot(ball.pos.x - rp.x, ball.pos.z - rp.z);
        const reachBoost = (1.1 - Game.diff) * 0.5;
        if (d < 2.3 + reachBoost && ball.pos.y < 3.3 && ball.pos.y > 0.12) {
          // choose shot
          const r = Math.random();
          let kind = 'flat', pw = rand(0.3, 0.75);
          if (r > 0.9 && Game.diff > 0.55) kind = 'lob';
          else if (r < 0.12 && Math.abs(ball.pos.z) < 7) { kind = 'flat'; }
          const aimX = clamp((playerRig.pos.x > 0 ? -1 : 1) * rand(0.3, 1) + rand(-0.5, 0.5), -1, 1);
          if (Game.tryHit(FAR, kind, pw, { x: aimX, y: rand(-0.2, 0.8) })) {
            ai.cool = 0.6;
            // drift home after hitting
            ai.plan = null;
            ai.home.set(clamp(playerRig.pos.x * -0.25, -2.5, 2.5), 0, -11);
          }
        }
      }
    }
  } else {
    if (ai.plan) { /* watch */ }
    moveRig(rig, FAR, ai.home.x, ai.home.z, dt, 0.7);
  }
}
function moveRig(rig, side, tx, tz, dt, urgency) {
  const sp = (5.2 + Game.diff * 3.2) * urgency;
  const dx = tx - rig.pos.x, dz = tz - rig.pos.z;
  const m = Math.hypot(dx, dz);
  if (m > 0.05) {
    const s = Math.min(sp * dt, m);
    rig.pos.x += dx / m * s; rig.pos.z += dz / m * s;
    rig.vel.set(dx / m * sp, 0, dz / m * sp);
  } else rig.vel.multiplyScalar(0.8);
  rig.pos.x = clamp(rig.pos.x, -6.8, 6.8);
  rig.pos.z = side === NEAR ? clamp(rig.pos.z, 0.4, 13.8) : clamp(rig.pos.z, -13.8, -0.4);
}

// ---------- physics ----------
function stepBall(dt) {
  if (!ball.live && !ball.dead) return;
  const judging = ball.live; // struck-serve/rally ball: judge net + bounces; dead balls just fall
  const sub = 2, h = dt / sub;
  for (let i = 0; i < sub; i++) {
    ball.vel.y -= GRAV * h;
    ball.pos.addScaledVector(ball.vel, h);
    // net crossing (plane z=0)
    const prevZ = ball.pos.z - ball.vel.z * h;
    if (!judging) { if (ball.pos.y <= BALL_R && ball.vel.y < 0) { ball.pos.y = BALL_R; ball.vel.y *= -0.4; ball.vel.x *= 0.8; ball.vel.z *= 0.8; } continue; }
    if ((prevZ > 0) !== (ball.pos.z > 0) && Math.abs(ball.pos.x) < 6.6) {
      const t = Math.abs(ball.vel.z) > 0.01 ? prevZ / (prevZ - ball.pos.z) : 0.5;
      const yCross = (ball.pos.y - ball.vel.y * h) + ball.vel.y * h * t;
      if (yCross < netTopAt(ball.pos.x) + BALL_R && yCross > 0) {
        // clip the tape — drop it
        ball.pos.z = prevZ > 0 ? 0.12 : -0.12;
        ball.vel.z *= -0.22; ball.vel.x *= 0.3; ball.vel.y *= 0.4;
        ball.netTouch = true;
        SFX.net();
      }
    }
    // bounce — only hard impacts (or long-airborne drops) count for judging;
    // rolling micro-bounces are just physics so a dribble can't fake a 2nd bounce
    if (ball.pos.y <= BALL_R && ball.vel.y < 0) {
      const impact = -ball.vel.y;
      ball.pos.y = BALL_R;
      ball.vel.y *= -0.72;
      ball.vel.x *= 0.86; ball.vel.z *= 0.86;
      if (Math.abs(ball.vel.y) < 1.1) ball.vel.y = 0;
      if (impact > 1.2 || ball.airT > 0.3) { ball.airT = 0; onBounce(); }
      if (!ball.live) return;
    }
  }
  ball.airT += dt;
  // dead ball (netted dribble that stopped, or an unstruck toss that fell)
  if (ball.pos.y <= BALL_R + 0.02 && ball.vel.length() < 1.4) {
    ball.deadT += dt;
    if (ball.deadT > 0.45 && ball.live) {
      if (Game.mode === 'serve' && ball.lastHitter === 0) return Game.resetToss();
      if (ball.bounces >= 1 && ball.firstIn) endRally(ball.lastHitter, 'WINNER!');
      else endRally(ball.lastHitter === NEAR ? FAR : NEAR, ball.netTouch ? 'INTO THE NET!' : 'OUT!');
    }
  } else ball.deadT = 0;
  // lost ball
  if (ball.pos.y < -3 || Math.abs(ball.pos.x) > 26 || Math.abs(ball.pos.z) > 32) {
    if (ball.live) {
      if (Game.mode === 'serve' && ball.lastHitter === 0) return Game.resetToss();
      if (ball.bounces === 0) endRally(ball.lastHitter === NEAR ? FAR : NEAR, 'OUT!');
      else if (ball.firstIn) endRally(ball.lastHitter, 'WINNER!');
      else endRally(ball.lastHitter === NEAR ? FAR : NEAR, 'OUT!');
    }
  }
}
function inSingles(x, z) {
  return Math.abs(x) <= COURT.WS / 2 + 0.001 && Math.abs(z) <= COURT.L / 2 + 0.001;
}
function inServeBox(x, z, forSide) {
  // forSide: the side the ball must land on (receiver side)
  if (Math.sign(z) !== forSide || Math.abs(z) > COURT.SERV) return false;
  if (Math.sign(x) !== -Game.serveSide) return false; // diagonal box
  if (Math.abs(x) > COURT.WS / 2) return false;
  return true;
}
function onBounce() {
  if (!ball.live) return;
  SFX.bounce();
  ball.bounces++;
  const hitter = ball.lastHitter, foe = hitter === NEAR ? FAR : NEAR;
  if (hitter === 0) return;
  const expectSide = -hitter;
  if (ball.bounces === 1) {
    const rightSide = Math.sign(ball.pos.z) === expectSide || Math.abs(ball.pos.z) < 0.05;
    let good;
    if (Game.serving && hitter === Game.server) good = rightSide && inServeBox(ball.pos.x, ball.pos.z, expectSide);
    else good = rightSide && inSingles(ball.pos.x, ball.pos.z);
    ball.firstIn = good;
    if (!good) {
      if (Game.serving && hitter === Game.server) return onFault(ball.netTouch ? 'NET — FAULT' : 'FAULT');
      return endRally(foe, ball.netTouch ? 'INTO THE NET!' : 'OUT!');
    }
    // serve landed in: keep Game.serving true until the return so an
    // untouched second bounce can be scored as an ACE in the bounces===2 branch
    if (Game.serving && hitter === Game.server) {
      Game.rally = 0; $('rally').textContent = 'RALLY 0';
    }
  } else if (ball.bounces === 2) {
    if (ball.firstIn) {
      const servingAce = Game.serving && hitter === Game.server;
      Game.serving = false;
      if (hitter === NEAR && servingAce) { Game.aces++; return endRally(NEAR, 'ACE! ⚡'); }
      return endRally(hitter, hitter === NEAR ? 'WINNER! 🔥' : 'RIVAL WINNER');
    }
  }
}
function onFault(label) {
  Game.serving = false;
  ball.live = false; ball.dead = true;
  SFX.fault();
  Game.faults++;
  Game.tossed = false; apexRing.visible = false;
  if (Game.faults >= 2) {
    const receiver = Game.server === NEAR ? FAR : NEAR;
    Game.awardPoint(receiver, 'DOUBLE FAULT', receiver === FAR ? 'DOUBLE FAULT' : 'DOUBLE FAULT');
  } else {
    Game.msg(label, 'SECOND SERVE', 1.6);
    Game.mode = 'serve-pending';
    setTimeout(() => {
      if (Game.over) return;
      Game.resetPositions();
      Game.mode = 'serve';
      const r = Game.server === NEAR ? playerRig : rivalRig;
      ball.pos.set(r.pos.x, 1.3, r.pos.z - (Game.server === NEAR ? 0.4 : -0.4));
      ball.vel.set(0, 0, 0);
      if (Game.server === FAR) Game.ai.serveT = rand(1.0, 1.6);
      else Game.sub('Second serve — play it safe!', 2.5);
    }, 1700);
  }
}
function endRally(w, label) {
  if (Game.mode !== 'rally') return;
  ball.live = false;
  apexRing.visible = false;
  // ball pop effect
  Game.awardPoint(w, label, w === NEAR ? label : label);
}

// ---------- per-frame update ----------
const clock = new THREE.Clock();
let elapsed = 0;
let gullT = rand(6, 12);
function update(dt) {
  elapsed += dt;
  skyMat.uniforms.uTime.value = elapsed;
  skyMat.uniforms.uRes.value.set(renderer.domElement.width, renderer.domElement.height);
  seaMat.uniforms.uTime.value = elapsed;
  gullT -= dt;
  if (gullT <= 0) { gullT = rand(12, 26); SFX.gull(); }
  // lamp flicker (subtle)
  for (const L of window.__lampLights) {
    const f = 0.92 + Math.sin(elapsed * 7 + L.seed) * 0.03 + Math.sin(elapsed * 23 + L.seed * 2) * 0.02;
    L.halo.material.opacity = 0.55 * f;
  }
  // player movement (YOU)
  if (!Game.paused && (Game.mode === 'rally' || Game.mode === 'serve' || Game.mode === 'serve-pending')) {
    Input.poll();
    const rig = playerRig;
    const maxSp = 7.6, acc = 46;
    rig.vel.x = lerp(rig.vel.x, Input.move.x * maxSp, clamp(acc * dt / maxSp, 0, 1));
    rig.vel.z = lerp(rig.vel.z, -Input.move.y * maxSp, clamp(acc * dt / maxSp, 0, 1));
    rig.pos.addScaledVector(rig.vel, dt);
    rig.pos.x = clamp(rig.pos.x, -6.8, 6.8);
    rig.pos.z = clamp(rig.pos.z, 0.4, 13.8);
    // charge grows while held
    if (Game.charging) {
      Game.charge = Math.min(1, Game.charge + dt / 0.85);
      $('powerfill').style.width = (Game.charge * 100) + '%';
    }
  }
  aiUpdate(dt);
  if (!Game.paused) stepBall(dt);

  // sync rigs
  playerRig.root.position.set(playerRig.pos.x, playerRig.root.position.y, playerRig.pos.z);
  rivalRig.root.position.set(rivalRig.pos.x, rivalRig.root.position.y, rivalRig.pos.z);
  const pSp = playerRig.vel.length(), rSp = rivalRig.vel.length();
  playerRig.update(dt, Game.paused ? 0 : pSp, ball.pos.x - playerRig.pos.x, ball.pos.z - playerRig.pos.z);
  rivalRig.update(dt, Game.paused ? 0 : rSp, ball.pos.x - rivalRig.pos.x, ball.pos.z - rivalRig.pos.z);
  playerRig.blob.position.y = 0.02 - playerRig.root.position.y;
  rivalRig.blob.position.y = 0.02 - rivalRig.root.position.y;

  // ball visuals
  ball.mesh.position.copy(ball.pos);
  ball.glow.position.copy(ball.pos);
  ball.light.position.copy(ball.pos);
  const spd = ball.vel.length();
  const glowS = 0.26 + clamp(spd / 30, 0, 1) * 0.40;
  ball.glow.scale.set(glowS, glowS, 1);
  // trail
  if (ball.live && spd > 4) {
    trailPts.unshift(ball.pos.clone());
    if (trailPts.length > 18) trailPts.pop();
  } else if (trailPts.length) trailPts.pop();
  for (let i = 0; i < trailPool.length; i++) {
    const sp = trailPool[i], p = trailPts[i];
    if (p) {
      sp.position.copy(p);
      const f = 1 - i / trailPool.length;
      sp.material.opacity = 0.32 * f;
      const s = 0.22 * f + 0.04;
      sp.scale.set(s, s, 1);
    } else sp.material.opacity = 0;
  }
  // petals
  for (const p of petalPool) {
    if (p.life <= 0) { p.sp.material.opacity = 0; continue; }
    p.life -= dt;
    p.v.y -= 2.8 * dt;
    p.v.multiplyScalar(1 - 0.5 * dt);
    p.sp.position.addScaledVector(p.v, dt);
    p.sp.material.rotation += dt * 1.8;
    p.sp.material.opacity = clamp(p.life / p.max * 1.6, 0, 1) * 0.9;
  }
  // landing marker
  if (ball.live && (Game.mode === 'rally')) {
    const land = predictLanding(ball.pos, ball.vel);
    const mine = Math.sign(land.z) === NEAR;
    marker.visible = true;
    marker.position.set(land.x, 0.06, land.z);
    marker.material.color.setHex(mine ? 0xc6ff4d : 0xff7fa5);
    const pulse = 1 + Math.sin(elapsed * 10) * 0.12;
    marker.scale.set(pulse, pulse, 1);
    marker.material.opacity = mine ? 0.95 : 0.4;
  } else marker.visible = false;
  // charge aim preview
  if (Game.charging && Game.mode === 'rally') {
    const ax = clamp(Input.move.x, -1, 1), ay = clamp(Input.move.y, -1, 1);
    const deep = ay > 0.3 ? 10.2 : 8.6;
    const openX = rivalRig.pos.x > 0 ? -3.1 : 3.1;
    let tx = clamp(lerp(openX, ax * 3.9, 0.55), -4.05, 4.05);
    let tz = -deep;
    if (ay < -0.45) { tx = clamp(ax * 3, -4, 4); tz = -3.0; }
    aimRing.position.set(tx, 0.07, tz);
    aimRing.visible = true;
    aimRing.material.opacity = 0.35 + Game.charge * 0.45;
    const pulse = 1 + Math.sin(elapsed * 9) * 0.07;
    aimRing.scale.set(pulse, pulse, 1);
  } else aimRing.visible = false;
  // serve timing ring tightens as the toss reaches its peak
  if (apexRing.visible) {
    const q = 1 - clamp(Math.abs(ball.pos.y - Game.tossApex) / 1.5, 0, 1);
    const s = 1.25 - q * 0.5;
    apexRing.scale.set(s, s, 1);
    apexRing.material.opacity = 0.45 + q * 0.55;
  }

  // camera: gentle follow + shake, keeps reference framing
  camShake = Math.max(0, camShake - dt * 2.2);
  const shx = (Math.random() - 0.5) * camShake * 0.5;
  const shy = (Math.random() - 0.5) * camShake * 0.35;
  camera.position.set(
    CAM_BASE.x + clamp(ball.pos.x * 0.012 + playerRig.pos.x * 0.008, -0.22, 0.22) + shx,
    CAM_BASE.y + shy,
    CAM_BASE.z - camShake * 0.9
  );
  camera.lookAt(CAM_LOOK);
}

// ---------- main loop ----------
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (hitStop > 0) hitStop = Math.max(0, hitStop - dt);
  else if (!Game.paused) update(dt);
  renderer.render(scene, camera);
}

// ---------- wire up UI ----------
$('pauseBtn').onclick = () => Game.togglePause();
$('muteBtn').onclick = () => Game.toggleMute();
Input.init();
Game.updateBoard();
const QS = new URLSearchParams(location.search);
if (QS.get('hud') === '0') document.body.classList.add('shot');
window.__gameBooted = true;
Game.startMatch();
$('loader').classList.add('hidden');
loop();
