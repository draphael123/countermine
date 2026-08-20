// COUNTERMINE -- procedural sound. Everything is synthesized in WebAudio at
// call time: no asset files, no loading, and the palette stays coherent
// because every sound comes out of the same handful of generators.
//
// The engine never calls this module -- game.js watches the battle's fx queue
// and translates events to sounds, so headless sims stay silent and free.

let ctx = null;
let master = null;
let enabled = true;
let ambienceNodes = null;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function sfxEnabled() { return enabled; }
export function setSfxEnabled(on) {
  enabled = on;
  if (!on) stopAmbience();
}

// Must be called from a user gesture once; browsers refuse audio before that.
export function unlockAudio() { try { ac(); } catch (e) {} }

// ------------------------------------------------------------ building blocks
function envGain(t0, a, peak, dur) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(master);
  return g;
}

function noiseBuffer(seconds) {
  const len = Math.max(1, (seconds * ctx.sampleRate) | 0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function noise(t0, dur, peak, type, freq, q) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur + 0.05);
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q || 0.8;
  const g = envGain(t0, 0.004, peak, dur);
  src.connect(f); f.connect(g);
  src.start(t0); src.stop(t0 + dur + 0.05);
  return f;
}

function tone(t0, dur, peak, type, f0, f1, aTime) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = envGain(t0, aTime || 0.005, peak, dur);
  o.connect(g);
  o.start(t0); o.stop(t0 + dur + 0.05);
  return o;
}

const jitter = (v, amt) => v * (1 + (Math.random() * 2 - 1) * amt);

// ------------------------------------------------------------------- library
const LIB = {
  // melee connect: low thump + a bite of mid noise
  hit(t) {
    tone(t, 0.11, 0.5, 'sine', jitter(150, 0.15), 55);
    noise(t, 0.09, 0.30, 'bandpass', jitter(900, 0.2), 1.2);
  },
  heavy(t) {
    tone(t, 0.22, 0.65, 'sine', jitter(110, 0.1), 38);
    noise(t, 0.16, 0.35, 'lowpass', 500, 0.7);
    noise(t + 0.01, 0.07, 0.2, 'bandpass', 1600, 2);
  },
  pierce(t) { // armour-ignoring: sharper, more metal
    noise(t, 0.07, 0.34, 'highpass', jitter(2400, 0.2), 1.5);
    tone(t, 0.09, 0.4, 'sine', jitter(220, 0.1), 70);
  },
  death(t) {
    tone(t, 0.5, 0.4, 'sawtooth', jitter(160, 0.15), 40, 0.02);
    noise(t + 0.03, 0.4, 0.24, 'lowpass', 350, 0.6);
  },
  step(t) {
    noise(t, 0.05, jitter(0.10, 0.4), 'bandpass', jitter(700, 0.35), 1.0);
  },
  bow(t) { // release snap + short flight hiss
    tone(t, 0.05, 0.4, 'square', 90, 60);
    noise(t + 0.015, 0.13, 0.22, 'highpass', 3200, 1.2);
  },
  reload(t) { // three cranks of a windlass
    for (let i = 0; i < 3; i++) {
      noise(t + i * 0.11, 0.045, 0.22, 'bandpass', 1300 + i * 300, 3);
      tone(t + i * 0.11, 0.04, 0.12, 'square', 180 + i * 40, 160);
    }
  },
  boom(t) {
    tone(t, 0.6, 0.8, 'sine', 120, 26, 0.008);
    noise(t, 0.45, 0.5, 'lowpass', 900, 0.5);
    noise(t + 0.02, 0.2, 0.28, 'bandpass', 2400, 1.5);
  },
  fire(t) { // whoosh up
    const f = noise(t, 0.35, 0.3, 'bandpass', 500, 1.4);
    f.frequency.linearRampToValueAtTime(2600, ctx.currentTime + 0.3);
  },
  heal(t) { // two dark bells
    tone(t, 0.5, 0.16, 'sine', 392, 392, 0.02);
    tone(t + 0.12, 0.6, 0.16, 'sine', 523, 523, 0.02);
    tone(t, 0.5, 0.05, 'sine', 787, 784, 0.02);
  },
  buff(t) {
    tone(t, 0.3, 0.14, 'triangle', 300, 450, 0.02);
    tone(t + 0.08, 0.3, 0.12, 'triangle', 450, 600, 0.02);
  },
  warn(t) { // the wind-up horn: means MOVE
    tone(t, 0.55, 0.28, 'sawtooth', 92, 98, 0.10);
    tone(t, 0.55, 0.18, 'sawtooth', 138, 148, 0.10);
  },
  sweep(t) {
    const f = noise(t, 0.22, 0.3, 'bandpass', 1800, 1.2);
    f.frequency.linearRampToValueAtTime(400, ctx.currentTime + 0.2);
  },
  thunk(t) { // pulls, pins, barricade planting
    tone(t, 0.12, 0.45, 'sine', 170, 60);
    noise(t, 0.08, 0.2, 'lowpass', 700, 1);
  },
  coin(t) {
    tone(t, 0.15, 0.13, 'square', jitter(2100, 0.05), 2000, 0.003);
    tone(t + 0.07, 0.2, 0.11, 'square', jitter(2700, 0.05), 2600, 0.003);
  },
  ui(t) {
    noise(t, 0.03, 0.10, 'bandpass', 1800, 2);
  },
  select(t) {
    tone(t, 0.05, 0.08, 'triangle', 500, 620);
  },
  drum(t) { // battle start
    tone(t, 0.4, 0.7, 'sine', 95, 34, 0.005);
    noise(t, 0.25, 0.3, 'lowpass', 400, 0.6);
    tone(t + 0.22, 0.4, 0.5, 'sine', 80, 30, 0.005);
  },
  bell(t) { // victory / floor change
    tone(t, 1.1, 0.2, 'sine', 330, 328, 0.005);
    tone(t, 1.1, 0.08, 'sine', 660, 655, 0.005);
    tone(t + 0.02, 1.0, 0.05, 'sine', 995, 990, 0.005);
  },
  dirge(t) { // a soldier of yours falls
    tone(t, 0.9, 0.22, 'triangle', 220, 110, 0.05);
    tone(t + 0.25, 0.9, 0.18, 'triangle', 165, 82, 0.05);
  },
};

let last = {};
export function play(name) {
  if (!enabled) return;
  try {
    ac();
    // debounce identical sounds inside one frame burst
    const now = performance.now();
    if (last[name] && now - last[name] < 45) return;
    last[name] = now;
    (LIB[name] || LIB.ui)(ctx.currentTime);
  } catch (e) { /* audio unavailable -- play silent */ }
}

// ---------------------------------------------------------------- ambience
// Cave air: heavily lowpassed noise that slowly breathes, plus scheduled
// drips. Cheap, endless, and never loops audibly because nothing repeats.
export function startAmbience() {
  if (!enabled || ambienceNodes) return;
  try {
    ac();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(4);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    g.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 2);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.03;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(); lfo.start();
    const dripTimer = setInterval(() => {
      if (!enabled || !ambienceNodes) return;
      if (Math.random() < 0.4) {
        const t = ctx.currentTime + Math.random() * 0.5;
        tone(t, 0.09, 0.05, 'sine', jitter(1200, 0.4), 500, 0.002);
      }
    }, 2500);
    ambienceNodes = { src, lfo, g, dripTimer };
  } catch (e) { /* no audio */ }
}

export function stopAmbience() {
  if (!ambienceNodes) return;
  try {
    const { src, lfo, g, dripTimer } = ambienceNodes;
    clearInterval(dripTimer);
    g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    setTimeout(() => { try { src.stop(); lfo.stop(); } catch (e) {} }, 700);
  } catch (e) {}
  ambienceNodes = null;
}
