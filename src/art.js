// COUNTERMINE -- sprite baking. Every figure is drawn ONCE into an offscreen
// canvas and blitted thereafter; 40 units on screen costs nothing.
// Silhouette rule: one big mass (torso), one small mass (head), one long mass
// (the weapon) sticking out past both. Same-size lumps read as stacked balloons.

const cache = new Map();

function bake(key, w, h, draw) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  cache.set(key, c);
  return c;
}

// Returns hex, not rgb(), so shade(shade(c, 20), -10) composes.
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v) => Math.max(0, Math.min(255, v + amt));
  const r = cl(n >> 16), gg = cl((n >> 8) & 255), b = cl(n & 255);
  return '#' + ((1 << 24) + (r << 16) + (gg << 8) + b).toString(16).slice(1);
}

// --------------------------------------------------------------- the figure
// PIXEL-ART figures: everything is painted in whole cells on a coarse grid,
// which turns "procedural shapes" into a deliberate style. One cell = 4px.
// spec: { cloth, metal, bulk, tall, helm, weapon, beast, tabard, plume }
// pose: 'idle' | 'walkA' | 'walkB'
const CELL = 4;
const FIG_W = 26, FIG_H = 30;   // cells; sprite canvas = 104 x 120 px + pad

function drawFigure(g, spec, pose) {
  const cell = (spec.bulk || 1) > 1.3 ? 5 : CELL;   // bosses: bigger, still crisp
  const P = (x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(Math.round(x) * cell, Math.round(y) * cell, Math.round(w) * cell, Math.round(h) * cell);
  };
  const LIFT = 20;
  const cloth = shade(spec.cloth || '#4a4038', LIFT);
  const metal = shade(spec.metal || '#6e6a63', LIFT);
  const clothD = shade(cloth, -26), clothL = shade(cloth, 24);
  const metalD = shade(metal, -30), metalL = shade(metal, 14);

  if (spec.beast) return drawBeast(g, spec, pose);

  const bulk = spec.bulk || 1;
  const wide = bulk > 1.15 ? 1 : bulk < 1.0 ? -1 : 0;  // -1 lean, 0 standard, +1 broad
  const G = 29;                        // ground row (feet bottom)
  const step = pose === 'walkA' ? 1 : pose === 'walkB' ? -1 : 0;
  const thrust = pose === 'strike' ? 2 : 0;   // weapon punched forward
  const lean = pose === 'flinch' ? -1 : 0;    // body recoils off the blow
  const cx = 13 + lean;                // centre column (leans on flinch)

  // ---- legs + boots (scissor on walk frames)
  P(cx - 3 - step, G - 4, 2, 4, clothD);
  P(cx + 1 + step, G - 4, 2, 4, clothD);
  P(cx - 3 - step, G - 1, 2, 1, '#191410');
  P(cx + 1 + step, G - 1, 2, 1, '#191410');

  // ---- weapon behind the body
  drawWeapon(P, cx + thrust, G, spec, metal, metalL, true);

  // ---- torso rows 14..24: shoulders taper to waist
  const shW = 4 + wide;                // half-width at shoulders
  const waW = 3;                       // half-width at waist
  for (let r = 0; r < 11; r++) {
    const hw = Math.round(shW + (waW - shW) * (r / 10));
    P(cx - hw, 14 + r, hw * 2, 1, cloth);
  }
  // lit left edge + shaded right edge
  for (let r = 0; r < 11; r++) {
    const hw = Math.round(shW + (waW - shW) * (r / 10));
    P(cx - hw, 14 + r, 1, 1, clothL);
    P(cx + hw - 1, 14 + r, 1, 1, clothD);
  }
  // tabard
  if (spec.tabard) {
    P(cx - 1, 15, 2, 8, spec.tabard);
    P(cx - 1, 22, 2, 1, shade(spec.tabard, -30));
  }
  // belt + buckle
  P(cx - waW - 1, 22, waW * 2 + 2, 1, '#171310');
  P(cx - 1, 22, 2, 1, metalD);

  // ---- arms: weapon arm reaches the grip, off arm hangs
  const armC = shade(cloth, -10);
  if (spec.weapon === 'shield') {
    P(cx - shW - 2, 15, 2, 5, armC);              // left arm to shield
    P(cx + shW, 15, 2, 4, armC);                  // right hangs
  } else if (spec.weapon === 'knife') {
    P(cx - shW - 1, 15, 2, 4, armC);
    P(cx + shW - 1, 15, 2, 4, armC);
  } else if (spec.weapon === 'bow') {
    P(cx + shW - 1, 15, 3, 2, armC);              // drawn across
    P(cx - shW - 1, 16, 2, 3, armC);
  } else {
    P(cx + shW - 1 + thrust, 15 + (thrust ? 1 : 0), 2, 5 - (thrust ? 1 : 0), armC); // weapon arm
    P(cx - shW, 16, 1, 4, armC);                  // off arm
  }

  // ---- pauldrons (darker than cloth -- lit metal makes a pale blob)
  P(cx - shW - 1, 14, 3, 2, metalD);
  P(cx + shW - 2, 14, 3, 2, metalD);
  P(cx - shW - 1, 14, 1, 1, metalL);

  // ---- head rows 8..13 + helm
  const hd = shade(metal, -18);
  if (spec.helm === 'conical') {
    P(cx - 1, 6, 2, 1, hd);
    P(cx - 2, 7, 4, 2, hd);
    P(cx - 3, 9, 6, 4, hd);
    P(cx - 3, 9, 1, 3, metalL);
    P(cx - 1, 5, 1, 1, metalL);                    // tip glint
  } else if (spec.helm === 'bucket') {
    P(cx - 3, 7, 6, 6, hd);
    P(cx - 3, 7, 6, 1, metalL);
    P(cx - 3, 7, 1, 6, shade(hd, 12));
  } else if (spec.helm === 'hood') {
    P(cx - 2, 7, 4, 1, clothD);
    P(cx - 3, 8, 6, 5, clothD);
    P(cx - 3, 8, 1, 4, shade(clothD, 16));
    P(cx - 2, 10, 4, 2, '#0d0b0a');                // face in shadow
  } else { // kettle
    P(cx - 2, 7, 4, 3, hd);
    P(cx - 4, 10, 8, 1, hd);                       // brim
    P(cx - 2, 7, 4, 1, metalL);
    P(cx - 2, 11, 4, 2, shade(cloth, -14));        // face/coif
  }
  // visor slit
  if (spec.helm === 'conical' || spec.helm === 'bucket') P(cx - 2, 10, 4, 1, '#0d0b0a');

  // ---- plume
  if (spec.plume) {
    const pj = spec.helm === 'conical' ? 4 : 6;
    P(cx, pj, 1, 2, spec.plume);
    P(cx + 1, pj - 1, 2, 2, spec.plume);
    P(cx + 3, pj - 2, 1, 2, shade(spec.plume, -20));
  }

  // ---- weapon in front
  drawWeapon(P, cx + thrust, G, spec, metal, metalL, false);
}

function drawWeapon(P, cx, G, spec, metal, metalL, behindPass) {
  const wood = '#4a3826', woodL = '#63492e';
  const behind = spec.weapon === 'pole' || spec.weapon === 'maul' || spec.weapon === 'staff';
  if (behind !== behindPass) return;
  switch (spec.weapon) {
    case 'sword':
      P(cx + 5, 20, 1, 3, wood);                    // grip
      P(cx + 3, 19, 5, 1, metal);                   // guard
      P(cx + 5, 9, 1, 10, metalL);                  // blade
      P(cx + 5, 8, 1, 1, '#f2ead2');                // point glint
      break;
    case 'shield':
      P(cx - 10, 13, 5, 9, shade(metal, -12));
      P(cx - 10, 13, 5, 1, metalL);
      P(cx - 10, 13, 1, 9, shade(metal, 4));
      P(cx - 9, 22, 3, 1, shade(metal, -24));       // bottom taper
      P(cx - 8, 16, 1, 1, '#2a1f1c');               // bolts
      P(cx - 7, 19, 1, 1, '#2a1f1c');
      break;
    case 'bow':
      P(cx + 7, 12, 1, 9, wood);
      P(cx + 6, 11, 1, 1, wood); P(cx + 6, 21, 1, 1, wood);
      P(cx + 6, 12, 1, 9, '#c9bfa8');               // string
      P(cx + 4, 16, 4, 1, woodL);                   // nocked bolt
      break;
    case 'pole':
      P(cx + 4, 4, 1, 21, wood);
      P(cx + 3, 3, 3, 3, metalL);                   // head
      P(cx + 3, 6, 2, 1, metal);                    // hook
      break;
    case 'maul':
      P(cx + 4, 7, 1, 17, wood);
      P(cx + 2, 4, 5, 4, shade(metal, -8));
      P(cx + 2, 4, 5, 1, metalL);
      break;
    case 'pick':
      P(cx + 5, 9, 1, 13, wood);
      P(cx + 2, 8, 7, 1, metalL);
      P(cx + 2, 9, 1, 2, metal); P(cx + 8, 9, 1, 2, metal);
      break;
    case 'knife':
      P(cx + 5, 15, 1, 4, '#e8e0cc');
      P(cx - 6, 15, 1, 4, '#e8e0cc');
      P(cx + 5, 19, 1, 1, wood); P(cx - 6, 19, 1, 1, wood);
      break;
    case 'staff':
      P(cx + 5, 4, 1, 21, wood);
      P(cx + 4, 2, 3, 3, '#a8452a');                // ember orb
      P(cx + 5, 3, 1, 1, '#ffb06a');
      break;
    case 'bell':
      P(cx + 4, 8, 4, 1, '#8a6f3a');
      P(cx + 4, 9, 4, 3, '#b09048');
      P(cx + 5, 12, 2, 1, '#6a531f');
      break;
    case 'satchel':
      P(cx + 4, 19, 4, 3, '#5a462e');
      P(cx + 4, 20, 4, 1, '#3a2c1a');
      P(cx + 5, 17, 1, 2, '#8a2a20');               // vial
      break;
  }
}

// low-slung quadruped, all cells
function drawBeast(g, spec, pose) {
  const cell = CELL;
  const P = (x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(Math.round(x) * cell, Math.round(y) * cell, Math.round(w) * cell, Math.round(h) * cell);
  };
  const cloth = shade(spec.cloth || '#6e5a4e', 20);
  const dark = shade(cloth, -28), lit = shade(cloth, 18);
  const G = 29, cx = 13;
  const step = pose === 'walkA' ? 1 : pose === 'walkB' ? -1 : 0;
  // legs
  P(cx - 6 - step, G - 4, 2, 4, dark);
  P(cx - 1 + step, G - 4, 2, 4, dark);
  P(cx + 3 - step, G - 4, 2, 4, dark);
  P(cx + 6 + step, G - 4, 2, 4, dark);
  // body low and long
  P(cx - 8, G - 9, 16, 5, cloth);
  P(cx - 8, G - 9, 16, 1, lit);
  P(cx - 8, G - 5, 16, 1, dark);
  // ribs
  for (let i = 0; i < 4; i++) P(cx - 5 + i * 3, G - 8, 1, 3, dark);
  // head slung forward
  P(cx + 8, G - 11, 5, 4, shade(cloth, -10));
  P(cx + 8, G - 11, 5, 1, lit);
  P(cx + 10, G - 10, 3, 1, '#0d0b0a');             // eye band
  P(cx + 11, G - 8, 1, 1, '#d8d2c2');              // teeth
  P(cx + 13, G - 8, 1, 1, '#d8d2c2');
  // tail
  P(cx - 10, G - 8, 2, 1, dark);
}

// ------------------------------------------------------------------- specs
export const FIGURES = {
  // the player's officer -- every field here is overridden by the creator
  captain: { cloth: '#5a4b3a', metal: '#938c7e', helm: 'conical', weapon: 'sword', tabard: '#8c3a2e', bulk: 1.08, tall: 1.03 },

  // players -- warmer cloth, colours of a garrison that has been down here a while
  serjeant: { cloth: '#5a4b3a', metal: '#8a8478', helm: 'conical', weapon: 'sword', tabard: '#8c3a2e', bulk: 1.05 },
  pavisier: { cloth: '#4b4a44', metal: '#8f8b80', helm: 'bucket', weapon: 'shield', bulk: 1.25, tall: 1.02 },
  crossbow: { cloth: '#54463c', metal: '#8a8478', helm: 'round', weapon: 'bow', bulk: 0.92 },
  surgeon: { cloth: '#3f3a3a', metal: '#7c7870', helm: 'hood', weapon: 'satchel', bulk: 0.9 },
  sapper: { cloth: '#4e4335', metal: '#857f72', helm: 'round', weapon: 'pick', bulk: 0.98 },
  billman: { cloth: '#4a4f42', metal: '#8a8478', helm: 'conical', weapon: 'pole', bulk: 1.0, tall: 1.04 },
  cutthroat: { cloth: '#33302f', metal: '#9a958a', helm: 'hood', weapon: 'knife', bulk: 0.85, tall: 0.96 },
  flagellant: { cloth: '#584f45', metal: '#6f6a62', helm: 'hood', weapon: 'staff', bulk: 0.92, tabard: '#7a2a30' },

  // the other army -- colder, greyer, further gone
  starveling: { cloth: '#565845', metal: '#5f5c54', helm: 'round', weapon: 'knife', bulk: 0.8, tall: 0.9 },
  trencher: { cloth: '#414e58', metal: '#6b7480', helm: 'bucket', weapon: 'pole', bulk: 1.06 },
  arbalest: { cloth: '#5a4e42', metal: '#6f6a60', helm: 'round', weapon: 'bow', bulk: 0.9 },
  ironhusk: { cloth: '#4a4744', metal: '#57534e', helm: 'bucket', weapon: 'maul', bulk: 1.35, tall: 1.1 },
  hound: { cloth: '#6e5a4e', beast: true },
  bellman: { cloth: '#6b5c3d', metal: '#9b8455', helm: 'conical', weapon: 'bell', bulk: 0.95 },
  drowned: { cloth: '#3d5451', metal: '#4f6b6b', helm: 'hood', weapon: 'knife', bulk: 1.0 },

  breacher: { cloth: '#5a3a30', metal: '#7a4b3a', helm: 'bucket', weapon: 'maul', bulk: 1.7, tall: 1.3 },
  choirmaster: { cloth: '#5f4d2c', metal: '#9b7d3a', helm: 'conical', weapon: 'bell', bulk: 1.5, tall: 1.25, tabard: '#8a6a20' },
  undermaster: { cloth: '#4a2d36', metal: '#7a3a4b', helm: 'hood', weapon: 'pole', bulk: 1.6, tall: 1.35, tabard: '#5a1f2a' },
};

// sprites for a SPEC (the creator's live look) or a def id; both share bakes
function spriteForSpec(spec, pose, keyBase) {
  const key = 'u:' + keyBase + ':' + pose;
  const cell = (spec.bulk || 1) > 1.3 ? 5 : CELL;
  const W = FIG_W * cell + 4, H = FIG_H * cell + 4;
  return bake(key, W, H, (g, W2, H2) => {
    const tmp = document.createElement('canvas');
    tmp.width = W2; tmp.height = H2;
    const tg = tmp.getContext('2d');
    tg.translate(2, 2);
    drawFigure(tg, spec, pose);
    const sil = document.createElement('canvas');
    sil.width = W2; sil.height = H2;
    const sg = sil.getContext('2d');
    sg.drawImage(tmp, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = 'rgba(9,7,6,0.88)';
    sg.fillRect(0, 0, W2, H2);
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]]) {
      g.drawImage(sil, ox, oy);
    }
    g.drawImage(tmp, 0, 0);
  });
}

export function unitSprite(defId, custom, frame) {
  const base = FIGURES[defId] || FIGURES.starveling;
  const spec = custom ? Object.assign({}, base, custom) : base;
  const keyBase = defId + ':' +
    (custom ? [custom.cloth, custom.tabard, custom.helm, custom.weapon, custom.metal, custom.plume, custom.bulk].join('|') : '-');
  return spriteForSpec(spec, frame || 'idle', keyBase);
}

// Card portraits: the same figure staged on a lit pedestal of dark air.
const portraitCache = new Map();
export function portraitURL(defId, custom, w = 76, h = 92) {
  const key = 'pu:' + defId + ':' + w + 'x' + h + ':' +
    (custom ? [custom.cloth, custom.tabard, custom.helm, custom.weapon, custom.metal, custom.plume, custom.bulk].join('|') : '-');
  if (portraitCache.has(key)) return portraitCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(w / 2, h * 0.40, 4, w / 2, h * 0.40, h * 0.66);
  bg.addColorStop(0, '#332a20');
  bg.addColorStop(1, '#161210');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const gl = g.createRadialGradient(w / 2, h * 0.3, 2, w / 2, h * 0.3, w * 0.62);
  gl.addColorStop(0, 'rgba(212,140,70,0.22)');
  gl.addColorStop(1, 'rgba(212,140,70,0)');
  g.fillStyle = gl;
  g.fillRect(0, 0, w, h);
  const spr = unitSprite(defId, custom, 'idle');
  // Bust framing on the pixel grid: helm top sits near row 6 of 30, the belt
  // near row 22. Crop that band and scale with smoothing OFF for crisp cells.
  const sy = spr.height * 0.14;
  const srcH = spr.height * 0.62;
  const srcW = spr.width * 0.78;
  const sx = (spr.width - srcW) / 2;
  const s = Math.max((w - 4) / srcW, (h - 4) / srcH);
  const dw = srcW * s, dh = srcH * s;
  g.imageSmoothingEnabled = false;
  g.drawImage(spr, sx, sy, srcW, srcH, w / 2 - dw / 2, h / 2 - dh / 2 + 2, dw, dh);
  const url = c.toDataURL();
  portraitCache.set(key, url);
  return url;
}

// Live portrait for the creator -- staged, swingable, pixel-crisp.
export function drawPortrait(g, W, H, spec, t, swing) {
  g.clearRect(0, 0, W, H);
  const gr = g.createRadialGradient(W / 2, H - 26, 4, W / 2, H - 26, W * 0.46);
  gr.addColorStop(0, 'rgba(212,130,60,0.20)');
  gr.addColorStop(1, 'rgba(212,130,60,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.save();
  g.globalAlpha = 0.45;
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(W / 2, H - 24, 34, 9, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  const spr = spriteForSpec(spec, 'idle',
    'live:' + [spec.cloth, spec.tabard, spec.helm, spec.weapon, spec.metal, spec.plume, spec.bulk].join('|'));
  const sw = swing || 0;
  const lungeX = Math.sin(sw * Math.PI) * 14;
  const s = Math.min((W - 20) / spr.width, (H - 34) / spr.height) * 1.55;
  g.save();
  g.imageSmoothingEnabled = false;
  g.translate(W / 2 + lungeX, H - 18);
  g.rotate(Math.sin(sw * Math.PI) * 0.10);
  g.drawImage(spr, -spr.width * s / 2, -spr.height * s, spr.width * s, spr.height * s);
  g.restore();
}

export const CUSTOM_OPTIONS = {
  helm: [
    { id: 'conical', label: 'Conical' },
    { id: 'bucket', label: 'Great helm' },
    { id: 'round', label: 'Kettle' },
    { id: 'hood', label: 'Hooded' },
  ],
  weapon: [
    { id: 'sword', label: 'Sword' },
    { id: 'pole', label: 'Bill' },
    { id: 'maul', label: 'Maul' },
    { id: 'shield', label: 'Shield' },
    { id: 'knife', label: 'Knives' },
    { id: 'staff', label: 'Staff' },
  ],
  cloth: ['#5a4b3a', '#4b4a44', '#3f4a44', '#4a3f4a', '#54463c', '#33302f', '#3d5451', '#5f4d3c',
    '#6b4a2f', '#2f3a4a', '#5a3232', '#46523a'],
  tabard: ['#8c3a2e', '#7a2a30', '#8a6a20', '#3f6360', '#5a4a7a', '#6b7c4a', '#a8998a', '',
    '#b8862e', '#2e6b8c', '#7a4a8c', '#3a7a52'],
  metal: ['#938c7e', '#7d848c', '#8c7d6a', '#6a7d7a', '#a89468', '#70707a'],
  plume: [{ id: '', label: 'None' }, { id: '#a8412f', label: 'Red' }, { id: '#d8c9a3', label: 'White' },
    { id: '#22201e', label: 'Black' }, { id: '#3f6360', label: 'Teal' }],
  build: [{ id: 0.95, label: 'Lean' }, { id: 1.08, label: 'Standard' }, { id: 1.24, label: 'Broad' }],
};

// ------------------------------------------------------------------- tiles
// Baked at tile size, high-frequency noise only -- low-frequency blotches make
// the tiling obvious the moment you look at a floor.
// The single biggest "prototype" tell was the tile lattice: every tile
// identically outlined reads as a debug grid. Real flagstones vary in VALUE
// tile to tile, and their seams are broken lines that only sometimes show.
export function floorTile(size, colour, seed) {
  return bake('f:' + size + colour + seed, size, size, (g, W, H) => {
    let s = seed;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    // per-slab value shift: adjacent tiles differ, so the floor reads as laid
    // stone instead of a printed grid
    const lift = ((seed % 7) - 3) * 3;
    const base = shade(colour, lift);
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    // one soft diagonal value sweep per slab -- stone is never one flat value
    const gr = g.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, 'rgba(255,240,220,0.030)');
    gr.addColorStop(1, 'rgba(0,0,0,0.050)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    // high-frequency grain only
    for (let i = 0; i < 70; i++) {
      const v = rnd();
      g.fillStyle = 'rgba(' + (v > 0.5 ? '255,255,255,0.030' : '0,0,0,0.055') + ')';
      g.fillRect(rnd() * W | 0, rnd() * H | 0, 1 + (rnd() * 2 | 0), 1);
    }
    // seams: broken, unequal, and absent on some edges entirely
    g.strokeStyle = 'rgba(0,0,0,0.30)';
    g.lineWidth = 1;
    const edge = (x1, y1, x2, y2, show) => {
      if (!show) return;
      g.beginPath();
      let n = 3 + (rnd() * 2 | 0);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = x1 + (x2 - x1) * t + (rnd() - 0.5) * 1.6;
        const py = y1 + (y2 - y1) * t + (rnd() - 0.5) * 1.6;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
    };
    edge(0.5, 0.5, W - 0.5, 0.5, rnd() > 0.35);
    edge(0.5, 0.5, 0.5, H - 0.5, rnd() > 0.35);
    // a corner chip on some slabs
    if (rnd() > 0.72) {
      g.fillStyle = 'rgba(0,0,0,0.18)';
      const cw = 4 + rnd() * 6;
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(cw, 0); g.lineTo(0, cw);
      g.closePath(); g.fill();
    }
  });
}

// Walls are drawn as MASONRY WITH A TOP: a lit cap face (the surface you look
// down on) over a dark front face with stone courses. That one division is
// what makes a square read as three-dimensional on a top-down camera.
export function wallTile(size, colour, seed) {
  return bake('w:' + size + colour + seed, size, size, (g, W, H) => {
    let s = seed + 7;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const capH = Math.round(H * 0.42);

    // front face: dark courses of stone under the cap
    const front = shade(colour, -34);
    g.fillStyle = front;
    g.fillRect(0, capH, W, H - capH);
    let y = capH + 2;
    let row = 0;
    while (y < H - 2) {
      const rh = 6 + (rnd() * 4 | 0);
      let x = row % 2 ? -4 : 0;
      while (x < W) {
        const bw = 9 + (rnd() * 8 | 0);
        g.fillStyle = shade(front, (rnd() * 16 - 8) | 0);
        g.fillRect(x + 1, y, Math.min(bw, W - x - 1), Math.min(rh, H - y - 1));
        x += bw + 1;
      }
      y += rh + 1; row++;
    }
    // mortar shadow between cap and face
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, capH, W, 2);

    // cap: the lit top surface, cracked into a few big irregular stones
    const cap = shade(colour, 10);
    g.fillStyle = cap;
    g.fillRect(0, 0, W, capH);
    const capGr = g.createLinearGradient(0, 0, 0, capH);
    capGr.addColorStop(0, 'rgba(255,236,205,0.14)');
    capGr.addColorStop(1, 'rgba(0,0,0,0.10)');
    g.fillStyle = capGr;
    g.fillRect(0, 0, W, capH);
    g.strokeStyle = 'rgba(0,0,0,0.30)';
    g.lineWidth = 1;
    const cuts = 1 + (rnd() * 2 | 0);
    for (let i = 0; i < cuts; i++) {
      const cx = 8 + rnd() * (W - 16);
      g.beginPath();
      g.moveTo(cx + (rnd() - 0.5) * 4, 0);
      g.lineTo(cx + (rnd() - 0.5) * 8, capH);
      g.stroke();
    }
    // rubble spill at the foot -- these walls FELL, they were not built here
    g.fillStyle = shade(colour, -18);
    for (let i = 0; i < 4; i++) {
      const rx = rnd() * W, rr = 2 + rnd() * 3.5;
      g.beginPath();
      g.moveTo(rx, H - 1); g.lineTo(rx + rr, H - 1 - rr * 0.8); g.lineTo(rx + rr * 2, H - 1);
      g.closePath(); g.fill();
    }
    // silhouette
    g.fillStyle = 'rgba(255,236,205,0.10)';
    g.fillRect(0, 0, W, 2);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0, H - 2, W, 2);
  });
}

export function mudTile(size, colour, seed) {
  return bake('m:' + size + colour + seed, size, size, (g, W, H) => {
    g.fillStyle = colour;
    g.fillRect(0, 0, W, H);
    let s = seed + 31;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    g.fillStyle = 'rgba(120,160,160,0.10)';
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.ellipse(rnd() * W, rnd() * H, 3 + rnd() * 8, 1.5 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
  });
}

// ------------------------------------------------------------------ decals
// Scatter detail stamped over floor tiles. Baked once per (kind, seed) and
// deliberately low-contrast: decals are texture, not information, and must
// never read as an item or a threat.
export function decalTile(size, kind, seed) {
  return bake('d:' + kind + size + seed, size, size, (g, W, H) => {
    let s = seed + 101;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    if (kind === 'bones') {
      g.strokeStyle = 'rgba(206,195,170,0.30)';
      g.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const x = 8 + rnd() * (W - 16), y = 8 + rnd() * (H - 16), a = rnd() * Math.PI;
        const l = 5 + rnd() * 8;
        g.beginPath();
        g.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
      g.fillStyle = 'rgba(206,195,170,0.24)';
      g.beginPath();
      g.arc(10 + rnd() * (W - 20), 10 + rnd() * (H - 20), 3.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(12 + rnd() * (W - 24), 12 + rnd() * (H - 24), 2, 2);
    } else if (kind === 'rubble') {
      for (let i = 0; i < 6; i++) {
        const v = rnd();
        g.fillStyle = v > 0.5 ? 'rgba(255,240,220,0.07)' : 'rgba(0,0,0,0.22)';
        const x = rnd() * W, y = rnd() * H, r = 2 + rnd() * 4;
        g.beginPath();
        g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.7, y + r * 0.3);
        g.closePath(); g.fill();
      }
    } else if (kind === 'crack') {
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = 1.4;
      let x = rnd() * W * 0.4, y = rnd() * H;
      g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < 5; i++) {
        x += 4 + rnd() * 9; y += (rnd() - 0.5) * 14;
        g.lineTo(x, y);
        if (rnd() > 0.6) { g.moveTo(x, y); g.lineTo(x + 3 + rnd() * 5, y + (rnd() - 0.5) * 10); g.moveTo(x, y); }
      }
      g.stroke();
    } else if (kind === 'moss') {
      g.fillStyle = 'rgba(96,120,70,0.16)';
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.ellipse(rnd() * W, rnd() * H, 3 + rnd() * 6, 2 + rnd() * 4, rnd() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(140,170,100,0.10)';
      g.beginPath();
      g.ellipse(rnd() * W, rnd() * H, 2 + rnd() * 3, 1.5 + rnd() * 2, 0, 0, Math.PI * 2);
      g.fill();
    } else if (kind === 'puddle') {
      const x = W / 2 + (rnd() - 0.5) * 10, y = H / 2 + (rnd() - 0.5) * 10;
      const rx = 8 + rnd() * 8, ry = 4 + rnd() * 4;
      g.fillStyle = 'rgba(20,34,36,0.55)';
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(140,180,180,0.14)';
      g.lineWidth = 1;
      g.beginPath(); g.ellipse(x, y - 1, rx * 0.7, ry * 0.6, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    } else if (kind === 'ember') {
      for (let i = 0; i < 4; i++) {
        const x = rnd() * W, y = rnd() * H;
        const gr = g.createRadialGradient(x, y, 0, x, y, 5);
        gr.addColorStop(0, 'rgba(230,120,50,0.30)');
        gr.addColorStop(1, 'rgba(230,120,50,0)');
        g.fillStyle = gr;
        g.fillRect(x - 5, y - 5, 10, 10);
        g.fillStyle = 'rgba(255,170,90,0.5)';
        g.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
      }
    } else if (kind === 'blood') {
      g.fillStyle = 'rgba(96,26,20,0.28)';
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.ellipse(rnd() * W, rnd() * H, 2 + rnd() * 5, 1.5 + rnd() * 3.5, rnd() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

// ----------------------------------------------------------- intro scenes
// Painted title cards for the three intro pages: a cross-section of the
// siege, the stair down, and the company at its fire. Procedural, but
// composed like illustrations -- big shapes, one light source each.
export function introScene(idx, w, h) {
  return bake('intro:' + idx + ':' + w + 'x' + h, w, h, (g, W, H) => {
    if (idx === 0) {
      // THE SIEGE, in section: sky, wall, earth, and two tunnels meeting
      const sky = g.createLinearGradient(0, 0, 0, H * 0.34);
      sky.addColorStop(0, '#2b2233');
      sky.addColorStop(1, '#4a2e26');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H * 0.34);
      // the fortress on its ground line
      g.fillStyle = '#171310';
      g.fillRect(0, H * 0.30, W, H * 0.06);
      g.fillStyle = '#241d18';
      g.fillRect(W * 0.36, H * 0.06, W * 0.16, H * 0.28);            // keep
      g.fillRect(W * 0.32, H * 0.16, W * 0.24, H * 0.18);            // walls
      for (let i = 0; i < 6; i++) g.fillRect(W * (0.33 + i * 0.037), H * 0.13, W * 0.018, H * 0.04); // crenels
      // the breach: a bite out of the wall, glowing
      g.fillStyle = '#4a2e26';
      g.beginPath();
      g.moveTo(W * 0.52, H * 0.16);
      g.lineTo(W * 0.60, H * 0.34);
      g.lineTo(W * 0.48, H * 0.34);
      g.closePath(); g.fill();
      const bg2 = g.createRadialGradient(W * 0.53, H * 0.30, 2, W * 0.53, H * 0.30, W * 0.09);
      bg2.addColorStop(0, 'rgba(255,140,60,0.6)');
      bg2.addColorStop(1, 'rgba(255,140,60,0)');
      g.fillStyle = bg2;
      g.fillRect(W * 0.4, H * 0.16, W * 0.26, H * 0.22);
      // the earth
      const earth = g.createLinearGradient(0, H * 0.34, 0, H);
      earth.addColorStop(0, '#231a13');
      earth.addColorStop(1, '#0d0a08');
      g.fillStyle = earth;
      g.fillRect(0, H * 0.34, W, H * 0.66);
      // strata lines
      g.strokeStyle = 'rgba(122,94,66,0.16)';
      g.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.moveTo(0, H * (0.45 + i * 0.13) + Math.sin(i * 2) * 5);
        g.bezierCurveTo(W * 0.3, H * (0.44 + i * 0.13), W * 0.6, H * (0.47 + i * 0.13), W, H * (0.45 + i * 0.13));
        g.stroke();
      }
      // two tunnels, converging under the breach
      g.strokeStyle = '#0a0806';
      g.lineWidth = 15;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(W * 0.05, H * 0.55); g.quadraticCurveTo(W * 0.32, H * 0.62, W * 0.51, H * 0.76);
      g.stroke();
      g.beginPath();
      g.moveTo(W * 0.95, H * 0.5); g.quadraticCurveTo(W * 0.7, H * 0.6, W * 0.53, H * 0.76);
      g.stroke();
      // torch points along each tunnel, opposing colours
      for (const [tx2, ty2, c2] of [[0.14, 0.565, '#e0a050'], [0.28, 0.60, '#e0a050'], [0.42, 0.675, '#e0a050'],
        [0.86, 0.515, '#7da0c4'], [0.72, 0.575, '#7da0c4'], [0.60, 0.65, '#7da0c4']]) {
        const gl2 = g.createRadialGradient(W * tx2, H * ty2, 1, W * tx2, H * ty2, 16);
        gl2.addColorStop(0, c2);
        gl2.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = 0.8;
        g.fillStyle = gl2;
        g.fillRect(W * tx2 - 16, H * ty2 - 16, 32, 32);
        g.globalAlpha = 1;
      }
      // the meeting point burns red
      const meet = g.createRadialGradient(W * 0.52, H * 0.76, 2, W * 0.52, H * 0.76, 34);
      meet.addColorStop(0, '#ff5a3a');
      meet.addColorStop(0.5, 'rgba(200,60,40,0.5)');
      meet.addColorStop(1, 'rgba(200,60,40,0)');
      g.fillStyle = meet;
      g.fillRect(W * 0.52 - 34, H * 0.76 - 34, 68, 68);
    } else if (idx === 1) {
      // THE STAIR: darkness, steps descending, one doorway of light
      g.fillStyle = '#0b0908';
      g.fillRect(0, 0, W, H);
      const door = g.createRadialGradient(W * 0.5, H * 0.32, 4, W * 0.5, H * 0.32, W * 0.3);
      door.addColorStop(0, 'rgba(224,160,80,0.5)');
      door.addColorStop(1, 'rgba(224,160,80,0)');
      g.fillStyle = door;
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#e8c088';
      g.globalAlpha = 0.85;
      g.fillRect(W * 0.47, H * 0.14, W * 0.06, H * 0.34);            // the lit doorway
      g.globalAlpha = 1;
      // steps spilling down and toward us
      g.fillStyle = '#1a1510';
      for (let i = 0; i < 8; i++) {
        const sy2 = H * 0.48 + i * H * 0.062;
        const grow = i * W * 0.045;
        g.fillRect(W * 0.40 - grow, sy2, W * 0.20 + grow * 2, H * 0.05);
        g.fillStyle = i % 2 ? '#171310' : '#1d1712';
      }
      // a figure on the stair, tiny against it
      g.fillStyle = '#060504';
      g.fillRect(W * 0.485, H * 0.34, W * 0.028, H * 0.10);
      g.beginPath();
      g.arc(W * 0.499, H * 0.325, W * 0.013, 0, Math.PI * 2);
      g.fill();
    } else {
      // THE COMPANY: four silhouettes at a fire in a cave mouth
      const cave = g.createRadialGradient(W * 0.5, H * 0.66, 10, W * 0.5, H * 0.66, W * 0.55);
      cave.addColorStop(0, '#3a2213');
      cave.addColorStop(0.55, '#191008');
      cave.addColorStop(1, '#070605');
      g.fillStyle = cave;
      g.fillRect(0, 0, W, H);
      // the fire
      const fire = g.createRadialGradient(W * 0.5, H * 0.78, 2, W * 0.5, H * 0.78, 40);
      fire.addColorStop(0, '#ffd080');
      fire.addColorStop(0.4, '#e07030');
      fire.addColorStop(1, 'rgba(224,112,48,0)');
      g.fillStyle = fire;
      g.fillRect(W * 0.5 - 40, H * 0.78 - 40, 80, 80);
      g.fillStyle = '#ffe0a0';
      g.beginPath();
      g.ellipse(W * 0.5, H * 0.78, 7, 11, 0, 0, Math.PI * 2);
      g.fill();
      // four figures as backlit silhouettes, drawn from the real sprites
      const ids = ['serjeant', 'pavisier', 'crossbow', 'surgeon'];
      ids.forEach((id, i) => {
        const spr = unitSprite(id, null, 'idle');
        const fx2 = W * (0.26 + i * 0.16);
        const s2 = (H * 0.42) / spr.height;
        g.save();
        g.filter = 'brightness(0.32) saturate(0.7)';
        if (i > 1) { g.translate(fx2 + spr.width * s2 / 2, 0); g.scale(-1, 1); g.translate(-(fx2 + spr.width * s2 / 2), 0); }
        g.drawImage(spr, fx2 - spr.width * s2 / 2, H * 0.86 - spr.height * s2, spr.width * s2, spr.height * s2);
        g.restore();
      });
    }
    // shared frame treatment
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  });
}

// A fortress skyline for the title screen: ridge, keep, and the breach glow.
export function titleSkyline(w, h) {
  return bake('skyline:' + w + 'x' + h, w, h, (g, W, H) => {
    const ridge = H * 0.55;
    g.fillStyle = '#0d0a08';
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, ridge + 26);
    g.quadraticCurveTo(W * 0.2, ridge + 6, W * 0.34, ridge + 18);
    g.lineTo(W * 0.40, ridge - 8);
    g.lineTo(W * 0.43, ridge - 8);
    g.lineTo(W * 0.43, ridge - 30);   // the keep
    g.lineTo(W * 0.50, ridge - 30);
    g.lineTo(W * 0.50, ridge - 12);
    g.lineTo(W * 0.56, ridge - 12);
    g.lineTo(W * 0.60, ridge + 10);   // the breach notch
    g.lineTo(W * 0.66, ridge + 22);
    g.quadraticCurveTo(W * 0.85, ridge + 8, W, ridge + 24);
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    // the breach still glows faintly
    const gl = g.createRadialGradient(W * 0.62, ridge + 14, 2, W * 0.62, ridge + 14, 60);
    gl.addColorStop(0, 'rgba(224,120,50,0.35)');
    gl.addColorStop(1, 'rgba(224,120,50,0)');
    g.fillStyle = gl;
    g.fillRect(W * 0.62 - 60, ridge - 46, 120, 120);
    g.fillStyle = 'rgba(255,170,90,0.65)';
    g.fillRect(W * 0.615, ridge + 8, 3, 3);
  });
}

// -------------------------------------------------------------- set pieces
// Landmark obstacles, one flavour per floor, so the levels stop being the
// same architecture in three palettes. They occupy WALL tiles: they block
// movement and sight like any masonry, they just aren't masonry.
export function propTile(size, kind, floorCol, seed) {
  return bake('prop:' + kind + size + floorCol + seed, size, size, (g, W, H) => {
    let s = seed + 401;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    // sits ON the floor, so start from the floor itself
    g.drawImage(floorTile(size, floorCol, seed), 0, 0);
    const wood = '#39291c';
    const woodLit = '#57402a';
    const iron = '#4c4a48';

    if (kind === 'gateL' || kind === 'gateR') {
      // one jamb of a broken gatehouse; mirrored for the other half
      const flip = kind === 'gateR';
      g.save();
      if (flip) { g.translate(W, 0); g.scale(-1, 1); }
      g.fillStyle = 'rgba(0,0,0,0.55)';                    // the dark beyond
      g.fillRect(W * 0.45, 4, W * 0.55, H - 8);
      g.fillStyle = '#57504a';                              // jamb stones
      const courses = [0, 0.24, 0.5, 0.74];
      courses.forEach((cy, i) => {
        g.fillStyle = shade('#57504a', (i % 2 ? -10 : 6));
        g.fillRect(2, H * cy + 2, W * 0.42, H * 0.22);
      });
      // broken lintel: a squared stone jutting from the jamb, snapped short
      g.fillStyle = shade('#57504a', 10);
      g.beginPath();
      g.moveTo(2, 2); g.lineTo(W * 0.78, 2); g.lineTo(W * 0.70, 12); g.lineTo(2, 12);
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(2, 10, W * 0.72, 2);
      // portcullis remnant: iron bars hanging into the dark, snapped unevenly
      g.strokeStyle = '#3a3835';
      g.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) {
        const gx = W * (0.55 + i * 0.13);
        const len = 16 + rnd() * H * 0.45;
        g.beginPath(); g.moveTo(gx, 12); g.lineTo(gx, 12 + len); g.stroke();
        g.fillStyle = '#55524e';
        g.fillRect(gx - 1.2, 12 + len - 2.5, 2.4, 2.5); // lit broken tip
        g.strokeStyle = '#3a3835';
      }
      g.restore();
    } else if (kind === 'ram') {
      // the siege ram they abandoned: a capped beam on trestles
      g.fillStyle = 'rgba(0,0,0,0.30)';
      g.beginPath(); g.ellipse(W / 2, H - 8, W * 0.42, 5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = wood;
      g.fillRect(4, H * 0.28, 8, H * 0.55);                 // trestle
      g.fillRect(W - 12, H * 0.34, 8, H * 0.5);
      g.fillStyle = woodLit;
      g.save();
      g.translate(W / 2, H * 0.42); g.rotate(-0.08);
      g.fillRect(-W * 0.46, -5, W * 0.92, 11);              // the beam
      g.fillStyle = shade(woodLit, 16);
      g.fillRect(-W * 0.46, -5, W * 0.92, 3);
      g.fillStyle = iron;                                    // iron head
      g.beginPath();
      g.moveTo(W * 0.46, -7); g.lineTo(W * 0.56, 0); g.lineTo(W * 0.46, 8);
      g.closePath(); g.fill();
      g.restore();
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1;   // lashings
      for (let i = 0; i < 3; i++) {
        const lx = W * (0.25 + i * 0.22);
        g.beginPath(); g.moveTo(lx, H * 0.30); g.lineTo(lx + 3, H * 0.55); g.stroke();
      }
    } else if (kind === 'altar') {
      // a drowned shrine: pale figure over dark water
      g.fillStyle = 'rgba(16,30,32,0.75)';
      g.beginPath(); g.ellipse(W / 2, H - 10, W * 0.44, 8, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(140,180,180,0.20)'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(W / 2, H - 10, W * 0.34, 5.5, 0, 0, Math.PI * 2); g.stroke();
      const stone = '#8d8877';
      g.fillStyle = shade(stone, -22);
      g.fillRect(W * 0.30, H * 0.52, W * 0.40, H * 0.30);   // pedestal
      g.fillStyle = stone;                                   // robed torso
      g.beginPath();
      g.moveTo(W * 0.36, H * 0.54);
      g.quadraticCurveTo(W * 0.5, H * 0.10, W * 0.64, H * 0.54);
      g.closePath(); g.fill();
      g.beginPath(); g.arc(W * 0.5, H * 0.16, 4.5, 0, Math.PI * 2); g.fill(); // bowed head
      g.fillStyle = shade(stone, 18);
      g.fillRect(W * 0.36, H * 0.52, 3, H * 0.3);
      g.fillStyle = 'rgba(96,120,70,0.35)';                  // moss streaks
      g.fillRect(W * 0.40, H * 0.30, 2.5, H * 0.42);
      g.fillRect(W * 0.56, H * 0.42, 2, H * 0.3);
    } else if (kind === 'forge') {
      // the furnace that started all of it, still warm
      const stone = '#4e453f';
      g.fillStyle = shade(stone, -10);
      g.fillRect(4, 8, W - 8, H - 14);
      g.fillStyle = shade(stone, 8);
      g.fillRect(4, 8, W - 8, 5);
      g.fillRect(8, 2, W * 0.3, 8);                          // chimney stub
      const mouth = g.createRadialGradient(W / 2, H - 16, 1, W / 2, H - 16, 13);
      mouth.addColorStop(0, '#ffb35c');
      mouth.addColorStop(0.5, '#c2571f');
      mouth.addColorStop(1, '#3a1508');
      g.fillStyle = mouth;
      g.beginPath();
      g.moveTo(W * 0.32, H - 6);
      g.quadraticCurveTo(W * 0.5, H - 30, W * 0.68, H - 6);
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,190,110,0.5)';
      for (let i = 0; i < 3; i++) g.fillRect(W * (0.42 + rnd() * 0.2), H - 14 - rnd() * 8, 1.5, 1.5);
      const glow = g.createRadialGradient(W / 2, H - 10, 2, W / 2, H - 10, W * 0.8);
      glow.addColorStop(0, 'rgba(230,120,50,0.20)');
      glow.addColorStop(1, 'rgba(230,120,50,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
    } else if (kind === 'column') {
      // mine props: timber posts and an X-brace holding the roof
      g.fillStyle = 'rgba(0,0,0,0.30)';
      g.beginPath(); g.ellipse(W / 2, H - 6, W * 0.34, 4, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = wood;
      g.fillRect(8, 2, 7, H - 6);
      g.fillRect(W - 15, 2, 7, H - 6);
      g.fillStyle = woodLit;
      g.fillRect(8, 2, 2.5, H - 6);
      g.fillRect(W - 15, 2, 2.5, H - 6);
      g.strokeStyle = woodLit; g.lineWidth = 5;
      g.beginPath(); g.moveTo(10, 8); g.lineTo(W - 10, H - 12); g.stroke();
      g.beginPath(); g.moveTo(W - 10, 8); g.lineTo(10, H - 12); g.stroke();
      g.fillStyle = wood;
      g.fillRect(4, 0, W - 8, 5);                            // header beam
    }
  });
}

export const PROP_NAMES = {
  gateL: { name: 'The old gatehouse', blurb: 'The wall came down; the gate, stubbornly, did not.' },
  gateR: { name: 'The old gatehouse', blurb: 'The wall came down; the gate, stubbornly, did not.' },
  ram: { name: 'An abandoned ram', blurb: 'They got it down the stair. Nobody remembers how, or why.' },
  altar: { name: 'A drowned altar', blurb: 'Someone still leaves offerings. The water takes them.' },
  forge: { name: 'The deep forge', blurb: 'Cold for eleven years everywhere but here.' },
  column: { name: 'Mine props', blurb: 'Timber holding up a hundred tons of fortress. Do not test it.' },
};

// What grows on each floor's stones.
export const FLOOR_DECALS = {
  1: ['bones', 'rubble', 'crack', 'blood'],
  2: ['puddle', 'moss', 'crack', 'puddle'],
  3: ['ember', 'rubble', 'bones', 'crack'],
};

export { shade };
