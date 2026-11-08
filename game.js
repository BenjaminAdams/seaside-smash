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

import { SFX } from './audio.js';

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
      if (e.key.toLowerCase() === 'n') Game.toggleMusic();
      if (e.key === 'Enter' && !$('menu').classList.contains('hidden')) Game.startFromMenu();
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
// The static world is a clean plate pulled from the reference clip (temporal
// median of every frame, so the players vanish). A fixed camera solved
// against the plate's court lines lets the 3D players and ball sit exactly
// on it. The stage keeps the clip's 4:5 framing at any window size.
const PLATE_W = 1080, PLATE_H = 1350, PLATE_ASPECT = PLATE_W / PLATE_H;
const stage = $('stage');
const container = $('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, IS_TOUCH ? 1.75 : 2));
renderer.toneMapping = THREE.NoToneMapping;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// camera solved by least squares on 47 court-line samples (max error 0.16 m)
const CAM = { h: 11.9226, d: 52.9111, pitch: 0.122600, yaw: -0.0029851, roll: 0.0048539, vfov: 27.1394 };
const camera = new THREE.PerspectiveCamera(CAM.vfov, PLATE_ASPECT, 0.5, 400);
camera.position.set(0, CAM.h, CAM.d);
camera.rotation.set(-CAM.pitch, -CAM.yaw, -CAM.roll, 'YXZ');
camera.updateMatrixWorld();
let camShake = 0;
let hitStop = 0;
const drawSize = new THREE.Vector2(1, 1);

function fitStage() {
  // contain a 4:5 stage in the viewport, leaving room for nothing else
  let w = innerWidth, h = innerWidth / PLATE_ASPECT;
  if (h > innerHeight) { h = innerHeight; w = h * PLATE_ASPECT; }
  w = Math.floor(w); h = Math.floor(h);
  stage.style.width = w + 'px'; stage.style.height = h + 'px';
  renderer.setSize(w, h);
  renderer.getDrawingBufferSize(drawSize);
  document.documentElement.style.setProperty('--stage-w', w + 'px');
  document.documentElement.style.setProperty('--stage-h', h + 'px');
}
addEventListener('resize', fitStage);
fitStage();

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

// ---------- the plate: sky, sea, gardens, court (from the clip) ----------
const plateTex = new THREE.TextureLoader().load('./assets/plate.jpg', () => { plateReady = true; });
let plateReady = false;
plateTex.colorSpace = THREE.NoColorSpace;      // sampled + written raw, so the plate's pixels pass through untouched
plateTex.minFilter = THREE.LinearFilter;
plateTex.generateMipmaps = false;

// full-frame background: plate + living details (sea glints, lamp flicker, swell shimmer)
const plateMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { uPlate: { value: plateTex }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D uPlate; uniform float uTime;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    void main(){
      vec3 col = texture2D(uPlate, vUv).rgb;
      vec2 px = vec2(vUv.x * 1080.0, (1.0 - vUv.y) * 1350.0);   // plate pixels, y down
      // ---- sea: navy pixels between the horizon and the treeline
      float sea = step(257.0, px.y) * (1.0 - step(770.0, px.y))
                * smoothstep(0.05, 0.11, col.b - col.r) * smoothstep(0.0, 0.05, col.b - col.g);
      float d = px.y - 255.0;
      // perspective cells: rows grow toward the viewer
      float lv = log(d + 12.0) * 26.0;
      float row = floor(lv), fy = fract(lv);
      float dRow = exp((row + 0.5) / 26.0) - 12.0;
      float cw = (3.2 + dRow * 0.075) * 3.4;
      float cx = px.x / cw + hash(vec2(row, 3.1)) * 9.0;
      float cell = floor(cx), fx = fract(cx);
      float h1 = hash(vec2(cell, row)), h2 = hash(vec2(cell * 1.7 + 4.0, row * 2.3));
      vec2 e = vec2((fx - 0.5) / 0.30, (fy - 0.5) / 0.34);
      float shape = smoothstep(1.0, 0.15, dot(e, e));
      // glitter band: wide near the horizon, centred right of middle, fading toward the trees
      float bw = 300.0 - d * 0.36;
      float bx = (px.x - 750.0) / max(bw, 60.0);
      float band = exp(-bx * bx * bx * bx) * smoothstep(590.0, 262.0, px.y);
      float on = step(1.0 - band * 0.55, h2);
      float tw = pow(max(0.0, sin(h1 * 6.283 + uTime * (1.1 + h1 * 2.2))), 5.0);
      float glint = shape * on * tw;
      col += vec3(0.50, 0.58, 0.76) * glint * sea * 0.62;
      // slow swell shimmer
      col *= 1.0 + sea * 0.022 * sin(px.y * 0.42 - uTime * 0.9 + sin(px.x * 0.012 + uTime * 0.3) * 2.0);
      // ---- lamp globes: soft flicker + breathing halo
      for (int i = 0; i < 2; i++) {
        vec2 c = i == 0 ? vec2(34.0, 552.8) : vec2(1019.4, 552.9);
        float s = float(i) * 3.7;
        float fl = 1.0 + 0.05 * sin(uTime * 6.1 + s) + 0.03 * sin(uTime * 17.3 + s * 2.0);
        float r = length(px - c);
        col += vec3(1.0, 0.93, 0.80) * (exp(-r * r / 520.0) * 0.16 + exp(-r / 70.0) * 0.045) * fl;
      }
      gl_FragColor = vec4(col, 1.0);
    }`
});
{
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), plateMat);
  bg.frustumCulled = false; bg.renderOrder = -100;
  scene.add(bg);
}

// occluders re-draw plate pixels in front of anything that is behind them in 3D
function plateOccluderMat(kind) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uPlate: { value: plateTex }, uRes: { value: drawSize } },
    vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uPlate; uniform vec2 uRes;
      void main(){
        vec3 c = texture2D(uPlate, gl_FragCoord.xy / uRes).rgb;
        float lum = dot(c, vec3(0.299, 0.587, 0.114));
        ${kind === 'net'
          ? 'float a = max(0.52, smoothstep(0.42, 0.62, lum));'                  // mesh veils, tape hides
          : 'float a = 1.0 - smoothstep(0.075, 0.13, lum); if (a < 0.01) discard;'} // only the dark hedge
        gl_FragColor = vec4(c, a);
      }`
  });
}
// net: matches the plate's net (posts at x = ±6.88 m, tape 1.07 m at posts, 0.914 m centre)
const NET_HALF = 6.88;
const netTopAt = x => COURT.NET_C + (COURT.NET_P - COURT.NET_C) * Math.min(1, (Math.abs(x) / NET_HALF) ** 2);
{
  const geo = new THREE.PlaneGeometry(NET_HALF * 2, 1, 48, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), top = pos.getY(i) > 0;
    const k = Math.min(1, (x / NET_HALF) ** 2);
    pos.setY(i, top ? COURT.NET_C + (COURT.NET_P - COURT.NET_C) * k + 0.035 : 0);
  }
  const net = new THREE.Mesh(geo, plateOccluderMat('net'));
  net.renderOrder = 10; scene.add(net);
}
// foreground hedge: a low vertical card just past the near baseline
{
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(60, 1.3), plateOccluderMat('fg'));
  fg.position.set(0, 0.65, 15.0); fg.renderOrder = 11; scene.add(fg);
}

// a few fireflies drifting over the flower beds — barely there
const fireflies = [];
{
  const spots = [[-9.5, -12], [-10.5, -6], [-9, 2], [9.8, -11], [10.6, -5], [9.2, 4], [-4, -15.5], [3.5, -15.8], [7.5, -15.2]];
  for (const [x, z] of spots) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xe8ff9a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    sp.scale.set(0.16, 0.16, 1);
    scene.add(sp);
    fireflies.push({ sp, x, z, y: rand(0.4, 1.6), ph: rand(0, 20), sp2: rand(0.5, 1.2) });
  }
}
function updateScenery(t) {
  plateMat.uniforms.uTime.value = t;
  for (const f of fireflies) {
    const a = t * 0.35 * f.sp2 + f.ph;
    f.sp.position.set(f.x + Math.sin(a) * 0.9, f.y + Math.sin(a * 1.7) * 0.35, f.z + Math.cos(a * 0.8) * 0.9);
    const blink = Math.max(0, Math.sin(t * 0.9 * f.sp2 + f.ph * 3.0));
    f.sp.material.opacity = blink * blink * 0.55;
  }
}

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
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.35),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.5 }));
  blob.rotation.x = -Math.PI / 2; blob.position.set(0, 0.02, 0); root.add(blob);
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
// sized to the clip's silhouettes (~104 px near, ~74 px far on the 1350 px plate)
playerRig.root.scale.setScalar(0.76); rivalRig.root.scale.setScalar(0.76);

// ---------- ball, trail, markers ----------
const ball = {
  mesh: new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 14, 12),
    new THREE.MeshBasicMaterial({ color: 0xd8ff5e })),
  glow: new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xc6ff4d, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false
  })),
  pos: new THREE.Vector3(0, 1, 12), vel: new THREE.Vector3(),
  live: false, dead: false, lastHitter: 0, bounces: 0, firstIn: false, netTouch: false, deadT: 0, airT: 0,
};
ball.glow.scale.set(0.32, 0.32, 1);
scene.add(ball.mesh, ball.glow);

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
  mode: 'menu', paused: false, over: false,
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
  startFromMenu() {
    SFX.init(); SFX.click();
    document.body.classList.remove('menu');
    $('menu').classList.add('hidden');
    this.startMatch();
  },
  startMatch() {
    this.pts[NEAR] = this.pts[FAR] = 0;
    this.games[NEAR] = this.games[FAR] = 0;
    this.pointIndex = 0; this.faults = 0; this.server = NEAR;
    this.over = false; this.diff = 0.45;
    SFX.setIntensity(1);
    this.rally = 0; this.best = 0; this.topSpeed = 0; this.perfects = 0; this.aces = 0;
    $('endOv').classList.add('hidden');
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
      this.sub(this.pointIndex === 0 && first
        ? 'SPACE / HIT to toss — strike at the peak! ← → aims'
        : 'Your serve — toss, then strike at the peak!', 4);
      this.msg(this.pointIndex === 0 && first ? 'YOUR SERVE' : '', '', 1.2);
    } else {
      this.sub('Rival serving — get ready!', 2.5);
      this.msg('RIVAL SERVES', '', 1.2);
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
      if (this.games[w] >= WIN_GAMES) return this.matchOver(w);
      this.msg(w === NEAR ? 'GAME — YOU!' : 'GAME — RIVAL', `Games ${this.games[NEAR]} — ${this.games[FAR]}`, 2.4);
      SFX.game(w === NEAR);
      setTimeout(() => { if (!this.over) { this.nextPoint(); } }, 2500);
    } else {
      this.pointIndex++;
      this.updateBoard();
      const deuce = this.pts[NEAR] >= 3 && this.pts[FAR] >= 3 && this.pts[NEAR] === this.pts[FAR];
      this.msg(big || reason, deuce ? 'DEUCE' : '', 1.8);
      SFX.point(w === NEAR);
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
    SFX.match(w === NEAR);
    setTimeout(() => SFX.setIntensity(0), 2500);
    $('endTitle').textContent = w === NEAR ? 'VICTORY ✨' : 'RIVAL WINS';
    $('endScore').textContent = `${this.games[NEAR]} — ${this.games[FAR]}`;
    $('endStats').innerHTML =
      `<div><b>${this.best}</b>longest rally</div>
       <div><b>${Math.round(this.topSpeed)}</b>top km/h</div>
       <div><b>${this.perfects}</b>perfect hits</div>
       <div><b>${this.aces}</b>aces</div>`;
    setTimeout(() => $('endOv').classList.remove('hidden'), 1200);
    this.msg(w === NEAR ? 'YOU WIN THE MATCH!' : 'RIVAL TAKES IT', '', 3);
  },
  // ----- HUD helpers -----
  msg(t, sub = '', dur = 1.6) {
    const m = $('msg');
    m.innerHTML = t ? t + (sub ? `<small>${sub}</small>` : '') : '';
    m.classList.toggle('show', !!t);
    clearTimeout(this.msgTimer);
    if (t) this.msgTimer = setTimeout(() => m.classList.remove('show'), dur * 1000);
  },
  sub(t, dur = 3) {
    const s = $('sub');
    s.textContent = t || ''; s.classList.toggle('show', !!t);
    clearTimeout(this.subTimer);
    if (t) this.subTimer = setTimeout(() => s.classList.remove('show'), dur * 1000);
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
        SFX.chargeStart();
      }
    } else if (this.charging) {
      $('power').classList.remove('show');
      this.charging = false;
      SFX.chargeStop();
      if (this.mode === 'rally') {
        if (!this.tryHit(NEAR, 'flat', this.charge, Input.move)) { playerRig.swing('fh'); SFX.swing(this.charge * 0.6, panOf(playerRig.pos.x)); } // whiff
      }
      this.charge = 0;
    }
  },
  onLobButton() {
    if (this.paused || this.over) return;
    if (this.mode === 'rally') {
      if (!this.tryHit(NEAR, 'lob', 0.5, Input.move)) { playerRig.swing('fh'); SFX.swing(0.3, panOf(playerRig.pos.x)); }
    }
    else if (this.mode === 'serve' && this.tossed && this.server === NEAR) this.strikeServe(NEAR);
  },
  togglePause() {
    if (this.over || this.mode === 'menu') return;
    this.paused = !this.paused;
    $('pauseOv').classList.toggle('hidden', !this.paused);
    SFX.setPaused(this.paused);
    if (this.paused && this.charging) { this.charging = false; this.charge = 0; $('power').classList.remove('show'); }
  },
  toggleMute() {
    SFX.setMuted(!SFX.muted);
    $('muteBtn').textContent = SFX.muted ? '🔇' : '🔊';
  },
  toggleMusic() {
    SFX.init();
    SFX.setMusic(!SFX.musicOn);
    $('musicBtn').classList.toggle('off', !SFX.musicOn);
  },
  // ----- serve -----
  tossServe(side) {
    const r = side === NEAR ? playerRig : rivalRig;
    this.tossed = true;
    ball.pos.set(r.pos.x, 1.5, r.pos.z + (side === NEAR ? -0.3 : 0.3));
    ball.vel.set(rand(-0.2, 0.2), 7.2, 0);
    ball.live = true; ball.dead = false; ball.lastHitter = 0; ball.bounces = 0; ball.netTouch = false; ball.airT = 0; ball.deadT = 0;
    this.tossApex = 1.5 + 7.2 * 7.2 / (2 * GRAV);
    SFX.toss(side === FAR);
    r.swing('serve');
    if (side === NEAR) {
      apexRing.position.set(ball.pos.x, this.tossApex, ball.pos.z);
      apexRing.visible = true;
      this.sub('Strike at the peak! ← → aims', 2.5);
    }
  },
  strikeServe(side) {
    if (!this.tossed || !ball.live) return;
    // too late — the toss already dropped; re-toss without penalty
    if (ball.lastHitter === 0 && ball.pos.y < 0.6) {
      this.resetToss();
      if (side === NEAR) this.sub('Too late — toss again!', 2);
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
    SFX.pop(0.6 + q * 0.4, q > 0.75, panOf(ball.pos.x), side === FAR);
    SFX.swing(0.6 + q * 0.4, panOf(r.pos.x), side === FAR);
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
      this.msg('RALLY ' + this.rally + '!', this.rally >= 16 ? 'unreal tennis' : 'the crowd is up', 1.0);
      SFX.rallyCheer(this.rally);
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
        this.msg(q > 0.9 ? 'PERFECT!' : 'CRACKING SHOT!', Math.round(kmh) + ' km/h', 0.8);
      }
    }
    SFX.pop(clamp(power * 0.7 + q * 0.5, 0.2, 1), q > 0.72, panOf(ball.pos.x), side === FAR);
    SFX.swing(power, panOf(rig.pos.x), side === FAR);
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
    if (!judging) {
      if (ball.pos.y <= BALL_R && ball.vel.y < 0) {
        if (ball.vel.y < -1.5) SFX.bounce(-ball.vel.y * 0.6, panOf(ball.pos.x), ball.pos.z < 0);
        ball.pos.y = BALL_R; ball.vel.y *= -0.4; ball.vel.x *= 0.8; ball.vel.z *= 0.8;
      }
      continue;
    }
    if ((prevZ > 0) !== (ball.pos.z > 0) && Math.abs(ball.pos.x) < NET_HALF) {
      const t = Math.abs(ball.vel.z) > 0.01 ? prevZ / (prevZ - ball.pos.z) : 0.5;
      const yCross = (ball.pos.y - ball.vel.y * h) + ball.vel.y * h * t;
      if (yCross < netTopAt(ball.pos.x) + BALL_R && yCross > 0) {
        // clip the tape — drop it
        ball.pos.z = prevZ > 0 ? 0.12 : -0.12;
        ball.vel.z *= -0.22; ball.vel.x *= 0.3; ball.vel.y *= 0.4;
        ball.netTouch = true;
        SFX.net();
        camShake = Math.max(camShake, 0.12);
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
      if (impact > 1.2 || ball.airT > 0.3) { ball.airT = 0; onBounce(impact); }
      else if (impact > 0.6) SFX.bounce(impact * 0.5, panOf(ball.pos.x), ball.pos.z < 0);
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
function onBounce(impact = 8) {
  if (!ball.live) return;
  SFX.bounce(impact, panOf(ball.pos.x), ball.pos.z < 0);
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
const panOf = x => clamp(x / 8, -0.9, 0.9);
// shoe audio: footfalls on the gait cycle, squeaks on hard cuts and stops
function footAudio(rig, far, dt) {
  const sp = rig.vel.length();
  rig.sqCool = Math.max(0, (rig.sqCool || 0) - dt);
  const prev = rig.prevVel || (rig.prevVel = new THREE.Vector3());
  const prevSp = prev.length();
  if (rig.sqCool <= 0 && prevSp > 4.2) {
    const cut = sp > 1 ? prev.dot(rig.vel) / (prevSp * sp) : 1;
    if (cut < 0.2 || sp < prevSp - 3.2) { SFX.squeak(panOf(rig.pos.x), far); rig.sqCool = 0.45; }
  }
  const stepIdx = Math.floor(rig.phase / Math.PI);
  if (sp > 2.2 && stepIdx !== rig.lastStep) SFX.step(panOf(rig.pos.x), far);
  rig.lastStep = stepIdx;
  prev.copy(rig.vel);
}
function update(dt) {
  elapsed += dt;
  updateScenery(elapsed);
  // player movement (YOU)
  if (!Game.paused && (Game.mode === 'rally' || Game.mode === 'serve' || Game.mode === 'serve-pending')) {
    Input.poll();
    const rig = playerRig;
    const maxSp = 7.6, acc = 46;
    rig.vel.x = lerp(rig.vel.x, Input.move.x * maxSp, clamp(acc * dt / maxSp, 0, 1));
    rig.vel.z = lerp(rig.vel.z, -Input.move.y * maxSp, clamp(acc * dt / maxSp, 0, 1));
    rig.pos.addScaledVector(rig.vel, dt);
    rig.pos.x = clamp(rig.pos.x, -6.8, 6.8);
    rig.pos.z = clamp(rig.pos.z, 0.4, 14.2);
    // charge grows while held
    if (Game.charging) {
      Game.charge = Math.min(1, Game.charge + dt / 0.85);
      SFX.chargeSet(Game.charge);
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
  if (Game.mode !== 'menu') { footAudio(playerRig, false, dt); footAudio(rivalRig, true, dt); }

  // ball visuals
  ball.mesh.position.copy(ball.pos);
  ball.glow.position.copy(ball.pos);
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

  // camera stays locked to the plate; impact shake nudges the whole stage instead
  camShake = Math.max(0, camShake - dt * 2.2);
  if (camShake > 0.001) {
    const k = camShake * 6;
    stage.style.transform = `translate(${((Math.random() - 0.5) * k).toFixed(2)}px, ${((Math.random() - 0.5) * k * 0.7).toFixed(2)}px)`;
  } else if (stage.style.transform) stage.style.transform = '';
}

// ---------- main loop ----------
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (hitStop > 0) hitStop = Math.max(0, hitStop - dt);
  else if (!Game.paused) update(dt);
  else updateScenery(elapsed += dt);          // the sea keeps glittering while paused
  renderer.render(scene, camera);
}

// ---------- wire up UI ----------
$('playBtn').onclick = () => Game.startFromMenu();
$('againBtn').onclick = () => { SFX.click(); Game.startMatch(); };
$('resumeBtn').onclick = () => Game.togglePause();
$('quitBtn').onclick = () => { SFX.click(); Game.paused = false; $('pauseOv').classList.add('hidden'); Game.startMatch(); };
$('pauseBtn').onclick = () => Game.togglePause();
$('muteBtn').onclick = () => Game.toggleMute();
$('musicBtn').onclick = () => Game.toggleMusic();
$('muteBtn').textContent = SFX.muted ? '🔇' : '🔊';
$('musicBtn').classList.toggle('off', !SFX.musicOn);
$('helpBtn').onclick = () => { SFX.click(); $('helpOv').classList.remove('hidden'); };
$('helpClose').onclick = () => { SFX.click(); $('helpOv').classList.add('hidden'); };
Input.init();
Game.updateBoard();
const QS = new URLSearchParams(location.search);
if (QS.get('hud') === '0') document.body.classList.add('shot');
if (QS.get('play') === '1') Game.startFromMenu();
else document.body.classList.add('menu');
window.__gameBooted = true;
window.__seaside = { SFX, Game, ball, playerRig, rivalRig };   // debug handle for the console
$('loader').classList.add('hidden');
loop();
