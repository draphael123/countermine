// COUNTERMINE -- procedural sound. Everything is synthesized in WebAudio at
// call time: no asset files, no loading, one coherent palette.
//
// Architecture: three buses into the master --
//   sfxIn   -> dry + cave-reverb convolver (hits echo like they're underground)
//   ambBus  -> the cave air (ducked briefly under heavy sounds)
//   musicBus-> the adaptive score (also ducked)
// play(name, {pan}) routes one sound through its own stereo panner, so hits on
// the left of the board sound from the left.
//
// The engine never calls this module -- game.js watches the battle's fx queue
// and translates events to sounds, so headless sims stay silent and free.

let ctx = null;
let master = null, sfxIn = null, ambBus = null, musicBus = null;
let enabled = true;
let ambienceNodes = null;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    // sfx: dry path + generated cave reverb
    sfxIn = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.85;
    sfxIn.connect(dry); dry.connect(master);
    const conv = ctx.createConvolver();
    conv.buffer = impulse(1.7, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    sfxIn.connect(conv); conv.connect(wet); wet.connect(master);

    ambBus = ctx.createGain(); ambBus.gain.value = 1; ambBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 1; musicBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// a decaying stereo noise burst = a stone room, for free
function impulse(seconds, decay) {
  const len = (seconds * ctx.sampleRate) | 0;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

export function sfxEnabled() { return enabled; }
export function setSfxEnabled(on) {
  enabled = on;
  if (!on) { stopAmbience(); setMusicMode('off'); }
}

// Must be called from a user gesture once; browsers refuse audio before that.
export function unlockAudio() { try { ac(); } catch (e) {} }

// ------------------------------------------------------------ building blocks
// Library generators connect into currentOut (a per-play() panner chain).
let currentOut = null;
function busOut() { return currentOut || sfxIn; }

function envGain(t0, a, peak, dur) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(busOut());
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
  hit(t) {
    tone(t, 0.11, 0.5, 'sine', jitter(150, 0.15), 55);
    noise(t, 0.09, 0.30, 'bandpass', jitter(900, 0.2), 1.2);
  },
  heavy(t) {
    tone(t, 0.22, 0.65, 'sine', jitter(110, 0.1), 38);
    noise(t, 0.16, 0.35, 'lowpass', 500, 0.7);
    noise(t + 0.01, 0.07, 0.2, 'bandpass', 1600, 2);
  },
  pierce(t) {
    noise(t, 0.07, 0.34, 'highpass', jitter(2400, 0.2), 1.5);
    tone(t, 0.09, 0.4, 'sine', jitter(220, 0.1), 70);
  },
  death(t) {
    tone(t, 0.5, 0.4, 'sawtooth', jitter(160, 0.15), 40, 0.02);
    noise(t + 0.03, 0.4, 0.24, 'lowpass', 350, 0.6);
  },
  step(t, o) {
    if (o && o.surface === 'mud') {
      noise(t, 0.09, jitter(0.13, 0.3), 'lowpass', jitter(420, 0.3), 1.2);
      tone(t + 0.01, 0.06, 0.06, 'sine', jitter(260, 0.3), 90);
    } else {
      noise(t, 0.05, jitter(0.10, 0.4), 'bandpass', jitter(700, 0.35), 1.0);
    }
  },
  bow(t) {
    tone(t, 0.05, 0.4, 'square', 90, 60);
    noise(t + 0.015, 0.13, 0.22, 'highpass', 3200, 1.2);
  },
  reload(t) {
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
  fire(t) {
    const f = noise(t, 0.35, 0.3, 'bandpass', 500, 1.4);
    f.frequency.linearRampToValueAtTime(2600, ctx.currentTime + 0.3);
  },
  heal(t) {
    tone(t, 0.5, 0.16, 'sine', 392, 392, 0.02);
    tone(t + 0.12, 0.6, 0.16, 'sine', 523, 523, 0.02);
    tone(t, 0.5, 0.05, 'sine', 787, 784, 0.02);
  },
  buff(t) {
    tone(t, 0.3, 0.14, 'triangle', 300, 450, 0.02);
    tone(t + 0.08, 0.3, 0.12, 'triangle', 450, 600, 0.02);
  },
  warn(t) {
    tone(t, 0.55, 0.28, 'sawtooth', 92, 98, 0.10);
    tone(t, 0.55, 0.18, 'sawtooth', 138, 148, 0.10);
  },
  sweep(t) {
    const f = noise(t, 0.22, 0.3, 'bandpass', 1800, 1.2);
    f.frequency.linearRampToValueAtTime(400, ctx.currentTime + 0.2);
  },
  thunk(t) {
    tone(t, 0.12, 0.45, 'sine', 170, 60);
    noise(t, 0.08, 0.2, 'lowpass', 700, 1);
  },
  coin(t) {
    tone(t, 0.15, 0.13, 'square', jitter(2100, 0.05), 2000, 0.003);
    tone(t + 0.07, 0.2, 0.11, 'square', jitter(2700, 0.05), 2600, 0.003);
  },
  ui(t) { noise(t, 0.03, 0.10, 'bandpass', 1800, 2); },
  select(t) { tone(t, 0.05, 0.08, 'triangle', 500, 620); },
  drum(t) {
    tone(t, 0.4, 0.7, 'sine', 95, 34, 0.005);
    noise(t, 0.25, 0.3, 'lowpass', 400, 0.6);
    tone(t + 0.22, 0.4, 0.5, 'sine', 80, 30, 0.005);
  },
  bell(t) {
    tone(t, 1.1, 0.2, 'sine', 330, 328, 0.005);
    tone(t, 1.1, 0.08, 'sine', 660, 655, 0.005);
    tone(t + 0.02, 1.0, 0.05, 'sine', 995, 990, 0.005);
  },
  dirge(t) {
    tone(t, 0.9, 0.22, 'triangle', 220, 110, 0.05);
    tone(t + 0.25, 0.9, 0.18, 'triangle', 165, 82, 0.05);
  },
  // ---- stingers
  recruit(t) { // someone signs on: a small rising resolve
    tone(t, 0.25, 0.14, 'triangle', 262, 262, 0.01);
    tone(t + 0.16, 0.35, 0.16, 'triangle', 330, 330, 0.01);
    tone(t + 0.34, 0.5, 0.14, 'triangle', 392, 392, 0.01);
  },
  descend(t) { // a floor deeper: gong over a rumble
    tone(t, 2.0, 0.30, 'sine', 98, 96, 0.01);
    tone(t, 2.0, 0.12, 'sine', 147, 145, 0.01);
    tone(t, 2.0, 0.07, 'sine', 208, 205, 0.01);
    noise(t, 1.6, 0.14, 'lowpass', 90, 0.5);
  },
  bossSting(t) { // something larger is in the room
    tone(t, 1.2, 0.20, 'sawtooth', 55, 54, 0.04);
    tone(t, 1.2, 0.16, 'sawtooth', 58.5, 58, 0.04);   // a rubbing semitone
    tone(t + 0.5, 1.0, 0.14, 'sawtooth', 82, 80, 0.05);
    noise(t, 0.5, 0.3, 'lowpass', 300, 0.6);
    tone(t + 0.02, 0.5, 0.5, 'sine', 90, 30, 0.005);
  },
  heartbeat(t) { // the captain is nearly done
    tone(t, 0.12, 0.4, 'sine', 62, 40, 0.008);
    tone(t + 0.22, 0.10, 0.28, 'sine', 58, 40, 0.008);
  },
};

// heavy sounds shoulder the ambience and music aside for a beat
const DUCK = { boom: 0.5, heavy: 0.75, death: 0.75, dirge: 0.7, bossSting: 0.5, drum: 0.7 };

let last = {};
export function play(name, opts) {
  if (!enabled) return;
  try {
    ac();
    const now = performance.now();
    if (last[name] && now - last[name] < 45) return;
    last[name] = now;
    // per-sound pan chain
    const g = ctx.createGain();
    if (opts && typeof opts.pan === 'number' && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      g.connect(p); p.connect(sfxIn);
    } else {
      g.connect(sfxIn);
    }
    currentOut = g;
    (LIB[name] || LIB.ui)(ctx.currentTime, opts);
    currentOut = null;
    const duckTo = DUCK[name];
    if (duckTo != null) {
      for (const bus of [ambBus, musicBus]) {
        bus.gain.cancelScheduledValues(ctx.currentTime);
        bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
        bus.gain.linearRampToValueAtTime(duckTo, ctx.currentTime + 0.03);
        bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.9);
      }
    }
  } catch (e) { currentOut = null; /* audio unavailable -- play silent */ }
}

// ---------------------------------------------------------------- ambience
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
    src.connect(lp); lp.connect(g); g.connect(ambBus);
    src.start(); lfo.start();
    const dripTimer = setInterval(() => {
      if (!enabled || !ambienceNodes) return;
      if (Math.random() < 0.4) {
        const t = ctx.currentTime + Math.random() * 0.5;
        currentOut = null;
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

// ------------------------------------------------------------------- music
// An adaptive dark-ambient score, fully synthesized. Three layers on separate
// gains: the pad drone (always, outside the title), a battle layer (sub pulse
// and a cold high bell), and a boss layer (a slow percussion heartbeat).
// Mode changes crossfade the layer gains; the scheduler only writes notes for
// layers that are audible.
let music = null;
let musicMode = 'off';

const BAR = 3.8;                       // seconds per bar
const ROOTS = [55, 41.2, 65.4, 49];    // A1, E1, C2, G1 -- a slow minor wander

function ensureMusic() {
  ac();
  if (music) return;
  const padG = ctx.createGain(); padG.gain.value = 0; padG.connect(musicBus);
  const btlG = ctx.createGain(); btlG.gain.value = 0; btlG.connect(musicBus);
  const bosG = ctx.createGain(); bosG.gain.value = 0; bosG.connect(musicBus);
  music = { padG, btlG, bosG, bar: 0, timer: null };
  music.timer = setInterval(scheduleBar, BAR * 1000);
  scheduleBar();
}

function padTone(t, dur, peak, f, detune, dest) {
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = f * (1 + detune);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + dur * 0.4);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(lp); lp.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.1);
}

function scheduleBar() {
  if (!music || musicMode === 'off' || !enabled) return;
  try {
    const t0 = ctx.currentTime + 0.05;
    const root = ROOTS[music.bar % ROOTS.length];
    // the drone: root + fifth, two detuned voices each, overlapping the bar
    padTone(t0, BAR * 1.25, 0.10, root * 2, 0.004, music.padG);
    padTone(t0, BAR * 1.25, 0.10, root * 2, -0.004, music.padG);
    padTone(t0, BAR * 1.25, 0.06, root * 3, 0.003, music.padG);
    if (music.bar % 2 === 1) padTone(t0, BAR, 0.045, root * 4.76, 0.002, music.padG); // dark minor sixth
    // battle layer: a sub pulse marching under the fight
    if (musicMode === 'battle' || musicMode === 'boss') {
      for (let k = 0; k < 8; k++) {
        const t = t0 + k * (BAR / 8);
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = root;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(k % 2 ? 0.05 : 0.11, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g); g.connect(music.btlG);
        o.start(t); o.stop(t + 0.2);
      }
      if (music.bar % 2 === 0) { // one cold bell, high and far away
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = root * 8;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0 + BAR * 0.6);
        g.gain.linearRampToValueAtTime(0.035, t0 + BAR * 0.6 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + BAR * 0.6 + 1.4);
        o.connect(g); g.connect(music.btlG);
        o.start(t0 + BAR * 0.6); o.stop(t0 + BAR * 0.6 + 1.5);
      }
    }
    // boss layer: a great slow drum, twice a bar
    if (musicMode === 'boss') {
      for (const off of [0, BAR / 2]) {
        const t = t0 + off;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(70, t);
        o.frequency.exponentialRampToValueAtTime(30, t + 0.3);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.22, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g); g.connect(music.bosG);
        o.start(t); o.stop(t + 0.6);
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(0.3);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 220;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.0001, t);
        ng.gain.linearRampToValueAtTime(0.10, t + 0.01);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        src.connect(lp); lp.connect(ng); ng.connect(music.bosG);
        src.start(t); src.stop(t + 0.35);
      }
    }
    music.bar++;
  } catch (e) { /* keep silent */ }
}

export function setMusicMode(mode) {
  if (!enabled && mode !== 'off') return;
  if (mode === musicMode) return;
  musicMode = mode;
  if (mode === 'off') {
    if (music) {
      for (const gname of ['padG', 'btlG', 'bosG']) {
        try {
          music[gname].gain.cancelScheduledValues(ctx.currentTime);
          music[gname].gain.setValueAtTime(music[gname].gain.value, ctx.currentTime);
          music[gname].gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
        } catch (e) {}
      }
    }
    return;
  }
  try {
    ensureMusic();
    const target = {
      map: { padG: 1.0, btlG: 0.0, bosG: 0.0 },
      battle: { padG: 0.85, btlG: 1.0, bosG: 0.0 },
      boss: { padG: 0.85, btlG: 1.0, bosG: 1.0 },
    }[mode] || { padG: 0, btlG: 0, bosG: 0 };
    for (const gname of ['padG', 'btlG', 'bosG']) {
      const g = music[gname].gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(g.value, ctx.currentTime);
      g.linearRampToValueAtTime(target[gname], ctx.currentTime + 1.6);
    }
  } catch (e) {}
}
