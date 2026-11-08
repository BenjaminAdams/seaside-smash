/* =====================================================================
   audio.js — fully synthesized twilight soundscape (no audio files)
   - ambience: ocean swells + foam hiss, pine wind, crickets,
     far-off gulls, wind chimes
   - music: generative lo-fi (warm pad, FM electric piano, sub bass,
     soft swung drums with kick-pump, vinyl crackle)
   - sfx: racket thwock, hard-court bounce, net cord, swing whoosh,
     shoe squeaks, charge riser, garden-party applause, stingers
   Everything routes through a shared generated-impulse reverb.
   ===================================================================== */

const AC = window.AudioContext || window.webkitAudioContext;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const pick = a => a[(Math.random() * a.length) | 0];

function loadPref(k, d) {
  try { const v = localStorage.getItem('seaside.' + k); return v === null ? d : v === '1'; } catch (e) { return d; }
}
function savePref(k, v) {
  try { localStorage.setItem('seaside.' + k, v ? '1' : '0'); } catch (e) { /* storage blocked */ }
}

// chord book (MIDI). Two gentle progressions in D major, alternating every 4 bars.
const PROG = [
  [ // Gmaj9 → F#m7 → Em9 → A9sus
    { root: 43, notes: [59, 62, 66, 69] },
    { root: 42, notes: [57, 61, 64, 66] },
    { root: 40, notes: [55, 59, 62, 66] },
    { root: 45, notes: [55, 59, 62, 64] },
  ],
  [ // Dmaj9 → Bm9 → Gmaj7 → A13
    { root: 38, notes: [57, 61, 64, 66] },
    { root: 47, notes: [57, 61, 62, 66] },
    { root: 43, notes: [59, 62, 66, 69] },
    { root: 45, notes: [55, 59, 61, 66] },
  ],
];
const PENTA_HI = [74, 76, 78, 81, 83, 86];     // D major pentatonic, upper register
const COMP_PATTERNS = [
  [0, 3, 6, 10], [0, 6, 10, 14], [2, 6, 8, 12], [0, 4, 7, 12], [0, 3, 8, 11, 14], [0, 10]
];

export const SFX = {
  ctx: null,
  muted: loadPref('muted', false),
  musicOn: loadPref('music', true),
  intensity: 0,          // 0 menu (pad + keys), 1 match (bass + drums)
  paused: false,
  _charge: null,

  // ------------------------------------------------------------------ setup
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume(); return; }
    if (!AC) return;
    try { this._build(); } catch (e) { this.ctx = null; }
  },

  _build() {
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    const now = ctx.currentTime;

    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3;
    comp.attack.value = 0.004; comp.release.value = 0.25;
    const makeup = this._gain(1.3);
    this.out.connect(comp); comp.connect(makeup); makeup.connect(ctx.destination);

    // shared reverb — a warm, long garden/terrace tail
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(3.4, 2.4);
    const verbOut = this._gain(0.6);
    const verbTone = ctx.createBiquadFilter(); verbTone.type = 'lowpass'; verbTone.frequency.value = 5200;
    this.verb.connect(verbTone); verbTone.connect(verbOut); verbOut.connect(this.out);

    this.sfxBus = this._gain(0.95); this.sfxBus.connect(this.out);
    this.ambBus = this._gain(0); this.ambBus.connect(this.out);
    this.ambBus.gain.setTargetAtTime(0.72, now, 1.2);           // ambience fades in

    this.musFilter = ctx.createBiquadFilter();
    this.nyq = Math.min(18000, ctx.sampleRate / 2 - 200);
    this.musFilter.type = 'lowpass'; this.musFilter.frequency.value = this.nyq; this.musFilter.Q.value = 0.4;
    this.musBus = this._gain(0);
    this.musBus.connect(this.musFilter); this.musFilter.connect(this.out);
    if (this.musicOn) this.musBus.gain.setTargetAtTime(0.5, now + 0.3, 1.6);

    this.padBus = this._gain(1); this.padBus.connect(this.musBus); this._send(this.padBus, 0.45);
    this.drumBus = this._gain(0);
    const drumTone = ctx.createBiquadFilter(); drumTone.type = 'lowpass'; drumTone.frequency.value = 6500;
    this.drumBus.connect(drumTone); drumTone.connect(this.musBus);
    this.bassBus = this._gain(0); this.bassBus.connect(this.musBus);

    // noise sources
    this.white = this._noise(2, 'white');
    this.pink = this._noise(4, 'pink');
    this.brownA = this._noise(6, 'brown');
    this.brownB = this._noise(7, 'brown');

    this._ambience();
    this._crackle();
    this.setIntensity(this.intensity, true);

    // music clock
    this.bpm = 74;
    this.stepDur = 60 / this.bpm / 4;
    this.stepIdx = 0; this.bar = 0;
    this.nextStep = ctx.currentTime + 0.4;
    this.crickets = [
      { f: 4650, pan: -0.65, vol: 0.010, next: now + rnd(1, 3), rest: 0 },
      { f: 4380, pan: 0.55, vol: 0.008, next: now + rnd(2, 4), rest: 0 },
      { f: 4920, pan: 0.15, vol: 0.006, next: now + rnd(3, 6), rest: 0 },
    ];
    this.nextChime = now + rnd(14, 26);
    this.nextGull = now + rnd(9, 20);
    this._timer = setInterval(() => this._tick(), 30);

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  },

  _gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; },
  _send(node, amt) { const g = this._gain(amt); node.connect(g); g.connect(this.verb); return g; },
  _pan(p) {
    if (this.ctx.createStereoPanner) { const s = this.ctx.createStereoPanner(); s.pan.value = clamp(p, -1, 1); return s; }
    return this._gain(1);
  },
  // node -> (panner) -> bus, plus reverb send. returns the panner (entry point after node)
  _route(node, bus, pan = 0, verb = 0) {
    const p = this._pan(pan);
    node.connect(p); p.connect(bus);
    if (verb > 0) this._send(p, verb);
    return p;
  },
  _noise(sec, kind) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    // crossfade the loop seam
    const fade = Math.min(2000, len >> 3);
    for (let i = 0; i < fade; i++) { const t = i / fade; d[i] = d[i] * t + d[len - fade + i] * (1 - t); }
    return buf;
  },
  _impulse(sec, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // gets darker as it decays (one-pole lowpass with rising smoothing)
        const k = 0.15 + t * 0.8;
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        const early = i < ctx.sampleRate * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
        d[i] = (lp * 1.6 + early) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  },
  _src(buf, loop = false) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop;
    if (loop) s.loopStart = 0;
    return s;
  },
  _osc(type, f) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; },
  _filt(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; },
  _env(param, t, a, peak, d, from = 0.0001) {
    param.setValueAtTime(from, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.00011), t + a);
    param.exponentialRampToValueAtTime(0.0001, t + a + d);
  },
  _live() { return this.ctx && this.ctx.state === 'running' && !this.muted; },

  // short burst of filtered white noise
  _burst(t, dur, ftype, f, q, peak, bus, pan = 0, verb = 0, attack = 0.002) {
    const s = this._src(this.white);
    const fl = this._filt(ftype, f, q);
    const g = this._gain(0);
    s.connect(fl); fl.connect(g);
    this._route(g, bus, pan, verb);
    this._env(g.gain, t, attack, peak, dur);
    s.start(t, Math.random() * 1.5); s.stop(t + attack + dur + 0.05);
    return fl;
  },
  // decaying sine/tri with pitch drop
  _thump(t, f0, f1, dur, peak, bus, pan = 0, verb = 0, type = 'sine') {
    const o = this._osc(type, f0), g = this._gain(0);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    o.connect(g); this._route(g, bus, pan, verb);
    this._env(g.gain, t, 0.003, peak, dur);
    o.start(t); o.stop(t + dur + 0.05);
  },

  // ------------------------------------------------------------------ ambience
  _ambience() {
    const ctx = this.ctx;
    // ocean: two brown-noise surf layers + a foam hiss, each swelling on its own cycle
    this.surf = [this.brownA, this.brownB].map((buf, i) => {
      const s = this._src(buf, true);
      const lp = this._filt('lowpass', 380, 0.5);
      const g = this._gain(0.04);
      s.connect(lp); lp.connect(g);
      this._route(g, this.ambBus, i ? 0.4 : -0.4, 0.15);
      const hs = this._src(this.white, true);
      const hp = this._filt('bandpass', 3800, 0.5);
      const hg = this._gain(0.0);
      hs.connect(hp); hp.connect(hg);
      this._route(hg, this.ambBus, i ? 0.55 : -0.55, 0.35);
      s.start(0, Math.random() * 3); hs.start(0, Math.random());
      const layer = { lp, g, hg };
      setTimeout(() => this._swell(layer), 600 + i * 3700);
      return layer;
    });
    // wind moving through the pines
    {
      const s = this._src(this.pink, true);
      const bp = this._filt('bandpass', 480, 0.6);
      const g = this._gain(0.022);
      s.connect(bp); bp.connect(g); this._route(g, this.ambBus, 0, 0.25);
      const l1 = this._osc('sine', 0.071), l1g = this._gain(0.014);
      l1.connect(l1g); l1g.connect(g.gain);
      const l2 = this._osc('sine', 0.043), l2g = this._gain(260);
      l2.connect(l2g); l2g.connect(bp.frequency);
      s.start(); l1.start(); l2.start();
    }
    // very faint distant tree-cricket trill bed
    {
      const o = this._osc('sine', 2950), am = this._osc('sine', 46), amg = this._gain(0.5);
      const g = this._gain(0.0);
      const depth = this._gain(1); am.connect(amg); amg.connect(depth.gain);
      o.connect(depth); depth.connect(g); this._route(g, this.ambBus, 0.3, 0.6);
      const slow = this._osc('sine', 0.031), sg = this._gain(0.0016);
      slow.connect(sg); sg.connect(g.gain);
      g.gain.value = 0.0018;
      o.start(); am.start(); slow.start();
    }
  },
  _swell(layer) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    const dur = rnd(6.5, 10.5), peak = rnd(0.10, 0.17);
    layer.g.gain.cancelScheduledValues(t);
    layer.g.gain.setTargetAtTime(peak, t, dur * 0.16);
    layer.g.gain.setTargetAtTime(0.035, t + dur * 0.42, dur * 0.2);
    layer.lp.frequency.cancelScheduledValues(t);
    layer.lp.frequency.setTargetAtTime(rnd(950, 1300), t, dur * 0.17);
    layer.lp.frequency.setTargetAtTime(360, t + dur * 0.42, dur * 0.22);
    layer.hg.gain.cancelScheduledValues(t);
    layer.hg.gain.setTargetAtTime(peak * 0.11, t + dur * 0.33, 0.5);
    layer.hg.gain.setTargetAtTime(0.0, t + dur * 0.55, 1.1);
    setTimeout(() => this._swell(layer), dur * 1000 * rnd(0.8, 1.0));
  },
  _chirp(c, t) {
    const n = Math.random() < 0.7 ? 3 : 4;
    const o = this._osc('sine', c.f), g = this._gain(0);
    o.connect(g); this._route(g, this.ambBus, c.pan, 0.4);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const p = t + i * 0.046;
      g.gain.setValueAtTime(0, p);
      g.gain.linearRampToValueAtTime(c.vol, p + 0.005);
      g.gain.setValueAtTime(c.vol, p + 0.02);
      g.gain.linearRampToValueAtTime(0, p + 0.03);
      o.frequency.setValueAtTime(c.f * 1.01, p);
      o.frequency.linearRampToValueAtTime(c.f * 0.975, p + 0.03);
    }
    o.start(t); o.stop(t + n * 0.046 + 0.05);
  },
  _bell(midi, t, vol, pan = 0, verb = 0.6, bus) {
    const f = mtof(midi);
    const car = this._osc('sine', f), mod = this._osc('sine', f * 3.5), mg = this._gain(f * 2.2);
    mod.connect(mg); mg.connect(car.frequency);
    mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.4);
    const g = this._gain(0); car.connect(g);
    this._route(g, bus || this.ambBus, pan, verb);
    this._env(g.gain, t, 0.004, vol, 3.2);
    car.start(t); mod.start(t); car.stop(t + 3.4); mod.stop(t + 3.4);
  },
  _windChimes(t) {
    const n = (rnd(3, 7)) | 0, pan = rnd(-0.7, 0.7);
    let tt = t;
    for (let i = 0; i < n; i++) {
      this._bell(pick([86, 88, 90, 93, 95, 98]), tt, rnd(0.007, 0.016), pan + rnd(-0.15, 0.15), 0.8);
      tt += rnd(0.14, 0.6);
    }
  },
  _gullCall(t) {
    const pan = rnd(-0.8, 0.8), calls = (rnd(2, 4)) | 0;
    for (let i = 0; i < calls; i++) {
      const tt = t + i * rnd(0.32, 0.42);
      const o = this._osc('sawtooth', 1350), bp = this._filt('bandpass', 1900, 5), g = this._gain(0);
      const vib = this._osc('sine', 22), vg = this._gain(28);
      vib.connect(vg); vg.connect(o.frequency);
      o.frequency.setValueAtTime(rnd(1250, 1450), tt);
      o.frequency.exponentialRampToValueAtTime(rnd(880, 980), tt + 0.26);
      o.connect(bp); bp.connect(g); this._route(g, this.ambBus, pan, 0.9);
      this._env(g.gain, tt, 0.03, 0.007, 0.24);
      o.start(tt); vib.start(tt); o.stop(tt + 0.35); vib.stop(tt + 0.35);
    }
  },
  _crackle() {
    const ctx = this.ctx, len = ctx.sampleRate * 5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.012;                 // hiss floor
      if (Math.random() < 0.00055) {                          // dust pops
        const amp = rnd(0.2, 0.9) * (Math.random() < 0.5 ? -1 : 1);
        for (let k = 0; k < 18 && i + k < len; k++) d[i + k] += amp * Math.exp(-k / 3);
      }
    }
    const s = this._src(buf, true), hp = this._filt('highpass', 900, 0.5), g = this._gain(0.13);
    s.connect(hp); hp.connect(g); g.connect(this.musBus); s.start();
  },

  // ------------------------------------------------------------------ music
  _tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime, ahead = now + 0.25;
    if (this.nextStep < now - 0.2) this.nextStep = now + 0.05;   // resumed after a stall
    while (this.nextStep < ahead) {
      this._scheduleStep(this.stepIdx, this.nextStep);
      this.nextStep += this.stepDur;
      this.stepIdx = (this.stepIdx + 1) % 16;
      if (this.stepIdx === 0) this.bar++;
    }
    for (const c of this.crickets) {
      if (c.next < now - 1) c.next = now + rnd(0.2, 1);
      while (c.next < ahead) {
        this._chirp(c, c.next);
        c.next += rnd(0.85, 1.35);
        if (Math.random() < 0.06) c.next += rnd(3, 9);         // rest
      }
    }
    if (now > this.nextChime) { this._windChimes(now + 0.1); this.nextChime = now + rnd(28, 55); }
    if (now > this.nextGull) { this._gullCall(now + 0.1); this.nextGull = now + rnd(38, 80); }
  },
  _chord() {
    const prog = PROG[Math.floor(this.bar / 4) % 2];
    return prog[this.bar % 4];
  },
  _scheduleStep(s, t0) {
    if (!this.musicOn) return;
    const swing = (s % 4 === 2) ? this.stepDur * 0.34 : 0;
    const t = t0 + swing;
    const ch = this._chord();
    const barLen = this.stepDur * 16;
    const hz = () => rnd(-0.008, 0.008);

    if (s === 0) {
      this._pad(ch, t0, barLen);
      this.comp = pick(COMP_PATTERNS);
    }
    // electric piano comping
    if (this.comp && this.comp.includes(s) && Math.random() < 0.88) {
      const notes = ch.notes;
      if (s === 0 || Math.random() < 0.35) {
        notes.forEach((n, i) => this._ep(n, t + i * 0.012 + hz(), rnd(0.45, 0.65)));   // gentle strum
      } else {
        this._ep(pick(notes), t + hz(), rnd(0.35, 0.6));
        if (Math.random() < 0.5) this._ep(pick(notes) + 12, t + 0.01 + hz(), rnd(0.2, 0.35));
      }
    }
    // sparse melodic lick on top
    if (this.intensity > 0 && (s === 6 || s === 14) && Math.random() < 0.22) {
      this._ep(pick(PENTA_HI), t + hz(), rnd(0.25, 0.4), 0.35);
    }
    // bass
    if (s === 0) this._bass(ch.root, t0, this.stepDur * 6);
    else if (s === 10 && Math.random() < 0.7) this._bass(ch.root + (Math.random() < 0.5 ? 7 : 12), t, this.stepDur * 3);
    else if (s === 14 && Math.random() < 0.3) this._bass(ch.root + pick([-1, 2, 5]), t, this.stepDur * 1.5);
    // drums (bus gain decides audibility; skip scheduling entirely in menu)
    if (this.intensity > 0) {
      if (s === 0 || (s === 10 && Math.random() < 0.8) || (s === 7 && Math.random() < 0.25)) this._kick(t + hz() * 0.5);
      if (s === 4 || s === 12) this._snare(t + hz() * 0.5, 1);
      else if (s === 15 && Math.random() < 0.25) this._snare(t, 0.3);
      if (s % 2 === 0) this._hat(t + hz() * 0.5, s % 4 === 0 ? rnd(0.7, 1) : rnd(0.4, 0.7), s === 14 && Math.random() < 0.3);
    }
  },
  _pad(ch, t, len) {
    const ctx = this.ctx;
    const lp = this._filt('lowpass', 520, 0.4);
    lp.frequency.setValueAtTime(480, t);
    lp.frequency.linearRampToValueAtTime(1050, t + len * 0.55);
    lp.frequency.linearRampToValueAtTime(700, t + len + 1.2);
    const g = this._gain(0);
    lp.connect(g); g.connect(this.padBus);
    const vol = 0.034;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 1.1);
    g.gain.setValueAtTime(vol, t + len - 0.1);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 1.4);
    const end = t + len + 1.5;
    for (const n of ch.notes) {
      for (const det of [-7, 6]) {
        const o = this._osc('sawtooth', mtof(n));
        o.detune.value = det + rnd(-2, 2);
        o.connect(lp); o.start(t); o.stop(end);
      }
    }
    const sub = this._osc('triangle', mtof(ch.notes[0] - 12)); const sg = this._gain(0.5);
    sub.connect(sg); sg.connect(lp); sub.start(t); sub.stop(end);
  },
  _ep(midi, t, vel, verb = 0.28) {
    const f = mtof(midi);
    const car = this._osc('sine', f), mod = this._osc('sine', f), mg = this._gain(0);
    mod.connect(mg); mg.connect(car.frequency);
    mg.gain.setValueAtTime(f * 1.9 * vel, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.12, t + 0.7);
    const tine = this._osc('sine', f * 7.02), tg = this._gain(0);
    tine.connect(tg);
    this._env(tg.gain, t, 0.002, 0.012 * vel, 0.07);
    const lp = this._filt('lowpass', 3200, 0.3);
    const g = this._gain(0);
    car.connect(lp); tg.connect(lp); lp.connect(g);
    this._route(g, this.musBus, rnd(-0.3, 0.3), verb);
    this._env(g.gain, t, 0.004, 0.11 * vel, 2.4);
    car.start(t); mod.start(t); tine.start(t);
    car.stop(t + 2.6); mod.stop(t + 2.6); tine.stop(t + 0.2);
  },
  _bass(midi, t, len) {
    const f = mtof(midi);
    const o = this._osc('sine', f), o2 = this._osc('triangle', f * 2), g2 = this._gain(0.12);
    const lp = this._filt('lowpass', 320, 0.6), g = this._gain(0);
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(this.bassBus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.26, t + 0.02);
    g.gain.setTargetAtTime(0.16, t + 0.05, 0.25);
    g.gain.setTargetAtTime(0.0001, t + len, 0.08);
    o.start(t); o2.start(t); o.stop(t + len + 0.5); o2.stop(t + len + 0.5);
  },
  _kick(t) {
    this._thump(t, 105, 42, 0.32, 0.55, this.drumBus);
    this._burst(t, 0.012, 'lowpass', 2500, 0.5, 0.05, this.drumBus);
    // lo-fi pump: duck the pad under each kick
    const p = this.padBus.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(0.5, t + 0.02);
    p.linearRampToValueAtTime(1, t + 0.38);
  },
  _snare(t, v) {
    const fl = this._burst(t, 0.17 * v + 0.04, 'bandpass', 2100, 0.7, 0.16 * v, this.drumBus, 0.08, 0.18);
    this._thump(t, 200, 150, 0.07, 0.08 * v, this.drumBus);
    return fl;
  },
  _hat(t, v, open) {
    this._burst(t, open ? 0.2 : 0.035, 'highpass', 7200, 0.6, 0.045 * v, this.drumBus, 0.22, 0.05);
  },

  // ------------------------------------------------------------------ public controls
  setMuted(m) {
    this.muted = m; savePref('muted', m);
    if (this.out) this.out.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
    if (m) this.chargeStop();
  },
  setMusic(on) {
    this.musicOn = on; savePref('music', on);
    if (this.musBus) this.musBus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, on ? 0.8 : 0.3);
  },
  setIntensity(level, instant) {
    this.intensity = level;
    if (!this.ctx) return;
    const t = this.ctx.currentTime, tau = instant ? 0.01 : 1.2;
    this.drumBus.gain.setTargetAtTime(level > 0 ? 0.9 : 0, t, tau);
    this.bassBus.gain.setTargetAtTime(level > 0 ? 1 : 0.45, t, tau);
  },
  setPaused(p) {
    this.paused = p;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musFilter.frequency.setTargetAtTime(p ? 520 : this.nyq, t, p ? 0.12 : 0.35);
    this.sfxBus.gain.setTargetAtTime(p ? 0.4 : 0.95, t, 0.1);
    if (p) this.chargeStop();
  },

  // ------------------------------------------------------------------ sfx
  // racket strike: thwock + body + string ping; "perfect" adds a sparkle in key
  pop(power = 0.5, perfect = false, pan = 0, far = false) {
    if (!this._live()) return;
    const t = this.ctx.currentTime + 0.005, b = this.sfxBus;
    const v = (far ? 0.5 : 1) * (0.65 + power * 0.45);
    const vb = far ? 0.35 : 0.12;
    this._burst(t, 0.055, 'bandpass', 1250 + power * 950, 1.1, 0.55 * v, b, pan, vb, 0.001);
    this._thump(t, 320, 150, 0.075, 0.42 * v, b, pan, vb);
    this._thump(t, 1180 + power * 160, 1050, 0.05, 0.06 * v, b, pan, vb, 'triangle');
    if (power > 0.7) this._thump(t, 85, 45, 0.16, 0.22 * v, b, pan, 0);
    if (perfect) {
      this._bell(86, t + 0.02, 0.05, pan, 0.7, b);
      this._bell(93, t + 0.09, 0.035, -pan * 0.5, 0.8, b);
      this._burst(t + 0.01, 0.35, 'highpass', 6000, 0.5, 0.025, b, pan, 0.6, 0.06);
    }
  },
  // hard-court bounce
  bounce(impact = 8, pan = 0, far = false) {
    if (!this._live()) return;
    const t = this.ctx.currentTime + 0.003, b = this.sfxBus;
    const v = clamp(impact / 12, 0.25, 1) * (far ? 0.48 : 1);
    this._burst(t, 0.028, 'lowpass', 1500, 0.6, 0.32 * v, b, pan, far ? 0.3 : 0.1, 0.001);
    this._thump(t, 215, 92, 0.065, 0.34 * v, b, pan, far ? 0.25 : 0.08);
  },
  net() {
    if (!this._live()) return;
    const t = this.ctx.currentTime + 0.003, b = this.sfxBus;
    this._thump(t, 98, 58, 0.22, 0.38, b, 0, 0.15);
    // mesh rattle: bandpassed noise chopped by a fast LFO
    const s = this._src(this.white), bp = this._filt('bandpass', 720, 2), g = this._gain(0);
    const chop = this._gain(0), lfo = this._osc('square', 27), lg = this._gain(0.5);
    lfo.connect(lg); lg.connect(chop.gain); chop.gain.value = 0.5;
    s.connect(bp); bp.connect(chop); chop.connect(g); this._route(g, b, 0, 0.3);
    this._env(g.gain, t, 0.004, 0.3, 0.42);
    s.start(t); lfo.start(t); s.stop(t + 0.5); lfo.stop(t + 0.5);
  },
  swing(power = 0.5, pan = 0, far = false) {
    if (!this._live()) return;
    const t = this.ctx.currentTime, b = this.sfxBus;
    const s = this._src(this.white), bp = this._filt('bandpass', 500, 1.4), g = this._gain(0);
    bp.frequency.setValueAtTime(450, t);
    bp.frequency.exponentialRampToValueAtTime(2400 + power * 900, t + 0.11);
    bp.frequency.exponentialRampToValueAtTime(800, t + 0.24);
    s.connect(bp); bp.connect(g); this._route(g, b, pan, 0.1);
    const v = (far ? 0.35 : 1) * (0.09 + power * 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    s.start(t, Math.random()); s.stop(t + 0.3);
  },
  toss(far = false) {
    if (!this._live()) return;
    const t = this.ctx.currentTime, b = this.sfxBus;
    const s = this._src(this.white), bp = this._filt('bandpass', 900, 2), g = this._gain(0);
    bp.frequency.setValueAtTime(800, t); bp.frequency.exponentialRampToValueAtTime(1700, t + 0.14);
    s.connect(bp); bp.connect(g); this._route(g, b, 0, 0.1);
    this._env(g.gain, t, 0.04, far ? 0.02 : 0.045, 0.12);
    s.start(t, Math.random()); s.stop(t + 0.25);
  },
  squeak(pan = 0, far = false) {
    if (!this._live()) return;
    const t = this.ctx.currentTime, b = this.sfxBus;
    const o = this._osc('sine', 2300), vib = this._osc('sine', 31), vg = this._gain(130), g = this._gain(0);
    vib.connect(vg); vg.connect(o.frequency);
    const f0 = rnd(2100, 2600);
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * rnd(1.15, 1.3), t + 0.09);
    o.connect(g); this._route(g, b, pan, 0.2);
    this._env(g.gain, t, 0.008, far ? 0.012 : 0.03, 0.09);
    o.start(t); vib.start(t); o.stop(t + 0.15); vib.stop(t + 0.15);
    this._burst(t, 0.05, 'bandpass', 1800, 0.8, far ? 0.01 : 0.025, b, pan, 0.05);
  },
  step(pan = 0, far = false) {
    if (!this._live()) return;
    this._burst(this.ctx.currentTime, 0.035, 'lowpass', 1100, 0.6, far ? 0.012 : 0.03, this.sfxBus, pan, 0.05);
  },
  // rising tone while a shot is being charged
  chargeStart() {
    if (!this._live() || this._charge) return;
    const t = this.ctx.currentTime;
    const o = this._osc('triangle', 196), o2 = this._osc('sine', 294);
    const lp = this._filt('lowpass', 900, 2), g = this._gain(0);
    o.connect(lp); o2.connect(lp); lp.connect(g); this._route(g, this.sfxBus, 0, 0.3);
    g.gain.setTargetAtTime(0.028, t, 0.05);
    o.start(t); o2.start(t);
    this._charge = { o, o2, lp, g };
  },
  chargeSet(c) {
    const ch = this._charge; if (!ch) return;
    const t = this.ctx.currentTime, f = 196 * Math.pow(2, c * 1.25);
    ch.o.frequency.setTargetAtTime(f, t, 0.03);
    ch.o2.frequency.setTargetAtTime(f * 1.5, t, 0.03);
    ch.lp.frequency.setTargetAtTime(900 + c * 2600, t, 0.03);
    ch.g.gain.setTargetAtTime(0.028 + c * 0.03, t, 0.05);
  },
  chargeStop() {
    const ch = this._charge; if (!ch) return;
    this._charge = null;
    const t = this.ctx.currentTime;
    ch.g.gain.cancelScheduledValues(t);
    ch.g.gain.setTargetAtTime(0, t, 0.03);
    ch.o.stop(t + 0.2); ch.o2.stop(t + 0.2);
  },
  // a small garden-party crowd
  applause(strength = 1, dur = 2.5) {
    if (!this._live()) return;
    const t0 = this.ctx.currentTime + 0.05, n = Math.floor(strength * dur * 26);
    for (let i = 0; i < n; i++) {
      const tt = t0 + dur * Math.pow(Math.random(), 1.7);
      this._burst(tt, rnd(0.008, 0.02), 'bandpass', rnd(1000, 2600), 1.3, rnd(0.015, 0.05) * strength,
        this.sfxBus, rnd(-0.8, 0.8), 0.5, 0.001);
    }
  },
  click() {
    if (!this._live()) return;
    const t = this.ctx.currentTime;
    this._thump(t, 1500, 700, 0.03, 0.07, this.sfxBus, 0, 0.15);
    this._bell(93, t + 0.01, 0.012, 0, 0.5, this.sfxBus);
  },
  fault() {
    if (!this._live()) return;
    const t = this.ctx.currentTime + 0.02;
    this._ep(57, t, 0.7, 0.4); this._ep(52, t + 0.18, 0.7, 0.4);
    this._thump(t, 120, 70, 0.3, 0.12, this.sfxBus, 0, 0.3);
  },
  // point / game / match stingers, all in the music's key
  point(won) {
    if (!this._live()) return;
    const t = this.ctx.currentTime + 0.03;
    if (won) {
      [74, 78, 81, 86].forEach((m, i) => this._ep(m, t + i * 0.075, 0.55, 0.5));
      this._bell(93, t + 0.32, 0.025, 0.2, 0.8, this.sfxBus);
      this.applause(0.55, 2.0);
    } else {
      this._ep(69, t, 0.45, 0.5); this._ep(66, t + 0.22, 0.4, 0.5); this._ep(62, t + 0.44, 0.35, 0.6);
    }
  },
  game(won) {
    if (!this._live()) return;
    const t = this.ctx.currentTime + 0.03;
    if (won) {
      [62, 66, 69, 73, 76].forEach((m, i) => this._ep(m, t + i * 0.03, 0.6, 0.6));
      [81, 86, 90, 93].forEach((m, i) => this._bell(m, t + 0.25 + i * 0.12, 0.03, (i - 1.5) * 0.3, 0.8, this.sfxBus));
      this.applause(1, 3.2);
    } else {
      [64, 67, 71, 74].forEach((m, i) => this._ep(m, t + i * 0.04, 0.4, 0.6));
      this._ep(59, t + 0.5, 0.4, 0.7);
      this.applause(0.35, 1.6);
    }
  },
  match(won) {
    if (!this._live()) return;
    const t = this.ctx.currentTime + 0.03;
    if (won) {
      [62, 66, 69, 74, 78, 81, 86, 90].forEach((m, i) => this._ep(m, t + i * 0.09, 0.6, 0.6));
      [93, 98, 102].forEach((m, i) => this._bell(m, t + 0.8 + i * 0.18, 0.03, 0, 0.9, this.sfxBus));
      this.applause(1.5, 5);
    } else {
      [71, 69, 66, 62, 59].forEach((m, i) => this._ep(m, t + i * 0.2, 0.45, 0.7));
      this.applause(0.6, 2.5);
    }
  },
  rallyCheer(n) {
    if (!this._live()) return;
    this.applause(clamp(n / 20, 0.3, 0.9), 1.4);
    this._bell(pick([86, 88, 90]), this.ctx.currentTime + 0.02, 0.02, 0, 0.8, this.sfxBus);
  },
};
