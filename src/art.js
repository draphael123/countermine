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
// spec: { cloth, metal, skin, bulk, tall, helm, weapon, beast, tabard }
function drawFigure(g, w, h, spec) {
  const cx = w / 2;
  const ground = h - 6;
  const bulk = spec.bulk || 1;
  const tall = spec.tall || 1;
  // One lift applied to every figure: the specs were picked against a lighter
  // mock-up and vanished on the real floor colours.
  const LIFT = 20;
  const cloth = shade(spec.cloth || '#4a4038', LIFT);
  const metal = shade(spec.metal || '#6e6a63', LIFT);
  const dark = shade(cloth, -26);

  if (spec.beast) return drawBeast(g, w, h, spec);

  const bodyH = 34 * tall;
  const shoulderW = 22 * bulk;
  const waistW = 14 * bulk;
  const topY = ground - bodyH;

  // legs, with boots a shade darker so the figure has feet on the floor
  g.fillStyle = shade(cloth, -34);
  g.fillRect(cx - 6.5 * bulk, ground - 13, 5.5 * bulk, 13);
  g.fillRect(cx + 1 * bulk, ground - 13, 5.5 * bulk, 13);
  g.fillStyle = '#191410';
  g.fillRect(cx - 7 * bulk, ground - 3.5, 6.5 * bulk, 3.5);
  g.fillRect(cx + 0.8 * bulk, ground - 3.5, 6.5 * bulk, 3.5);

  // weapon behind the body
  if (spec.weapon === 'pole' || spec.weapon === 'maul' || spec.weapon === 'staff') {
    drawWeapon(g, cx, ground, spec, true);
  }

  // torso: wide shoulders down to a narrow waist
  g.beginPath();
  g.moveTo(cx - shoulderW / 2, topY + 4);
  g.lineTo(cx + shoulderW / 2, topY + 4);
  g.lineTo(cx + waistW / 2, ground - 10);
  g.lineTo(cx - waistW / 2, ground - 10);
  g.closePath();
  g.fillStyle = cloth;
  g.fill();

  // tabard / surcoat stripe -- the only saturated colour on the figure
  if (spec.tabard) {
    g.fillStyle = spec.tabard;
    g.fillRect(cx - 4 * bulk, topY + 6, 8 * bulk, bodyH - 20);
  }

  // lit edge, top-left
  g.beginPath();
  g.moveTo(cx - shoulderW / 2, topY + 4);
  g.lineTo(cx - shoulderW / 2 + 4, topY + 4);
  g.lineTo(cx - waistW / 2 + 3, ground - 10);
  g.lineTo(cx - waistW / 2, ground - 10);
  g.closePath();
  g.fillStyle = shade(cloth, 22);
  g.fill();

  // belt -- one dark horizontal break stops the torso reading as a slab
  g.fillStyle = '#171310';
  g.fillRect(cx - waistW / 2 - 1.5, ground - 17, waistW + 3, 3);
  g.fillStyle = shade(metal, -6);
  g.fillRect(cx - 2, ground - 17, 4, 3);

  // Pauldrons: DARKER than the cloth, not lighter. Lit metal at the shoulders
  // out-shouts the whole figure and the silhouette reads as a pale blob.
  g.fillStyle = shade(metal, -30);
  g.beginPath();
  g.ellipse(cx - shoulderW / 2 + 1, topY + 6, 4.8 * bulk, 3.8, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(cx + shoulderW / 2 - 1, topY + 6, 4.8 * bulk, 3.8, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = shade(metal, 8);
  g.beginPath();
  g.ellipse(cx - shoulderW / 2 + 0.5, topY + 4.6, 3.4 * bulk, 1.5, 0, 0, Math.PI * 2);
  g.fill();

  // rim light down the left edge -- without it a dark figure on a dark floor
  // has no silhouette at all
  g.save();
  g.strokeStyle = 'rgba(255,214,170,0.30)';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(cx - shoulderW / 2 + 0.8, topY + 5);
  g.lineTo(cx - waistW / 2 + 0.8, ground - 10);
  g.stroke();
  g.restore();

  // head + helm, deliberately small against the torso
  const headR = 7.2;
  const headY = topY - headR + 3;
  g.fillStyle = shade(metal, -18);
  if (spec.helm === 'conical') {
    g.beginPath();
    g.moveTo(cx, headY - headR - 4);
    g.lineTo(cx + headR, headY + headR - 1);
    g.lineTo(cx - headR, headY + headR - 1);
    g.closePath(); g.fill();
  } else if (spec.helm === 'bucket') {
    g.fillRect(cx - headR, headY - headR, headR * 2, headR * 2 + 1);
  } else if (spec.helm === 'hood') {
    g.beginPath();
    g.moveTo(cx - headR - 1, headY + headR);
    g.quadraticCurveTo(cx, headY - headR - 5, cx + headR + 1, headY + headR);
    g.closePath();
    g.fillStyle = dark; g.fill();
  } else {
    g.beginPath(); g.arc(cx, headY, headR, 0, Math.PI * 2); g.fill();
  }
  // visor: a black slit is what makes it read as a helm and not a face
  g.fillStyle = '#0d0b0a';
  g.fillRect(cx - headR + 1.5, headY - 0.5, headR * 2 - 3, 2.6);

  if (spec.weapon !== 'pole' && spec.weapon !== 'maul' && spec.weapon !== 'staff') {
    drawWeapon(g, cx, ground, spec, false);
  }
}

function drawWeapon(g, cx, ground, spec, behind) {
  const metal = shade(spec.metal || '#6e6a63', 16);
  const wood = '#3b2f26';
  switch (spec.weapon) {
    case 'sword':
      g.fillStyle = wood; g.fillRect(cx + 12, ground - 26, 3, 8);
      g.fillStyle = shade(metal, 26);
      g.beginPath();
      g.moveTo(cx + 13.5, ground - 26);
      g.lineTo(cx + 16, ground - 52);
      g.lineTo(cx + 11, ground - 52);
      g.closePath(); g.fill();
      g.fillStyle = metal; g.fillRect(cx + 8, ground - 28, 11, 2.5);
      break;
    case 'shield':
      g.fillStyle = shade(metal, -14);
      g.beginPath();
      g.moveTo(cx - 22, ground - 44);
      g.lineTo(cx - 4, ground - 44);
      g.lineTo(cx - 4, ground - 12);
      g.lineTo(cx - 13, ground - 4);
      g.lineTo(cx - 22, ground - 12);
      g.closePath(); g.fill();
      g.strokeStyle = shade(metal, 26); g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#2a1f1c';
      g.fillRect(cx - 17, ground - 34, 3, 3);
      g.fillRect(cx - 12, ground - 27, 3, 3);
      break;
    case 'bow': {
      g.strokeStyle = wood; g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx + 6, ground - 42); g.lineTo(cx + 6, ground - 24);
      g.stroke();
      g.strokeStyle = shade(metal, 10); g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(cx - 2, ground - 36); g.lineTo(cx + 16, ground - 36);
      g.stroke();
      g.strokeStyle = '#171310'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx - 2, ground - 36); g.lineTo(cx + 6, ground - 33);
      g.lineTo(cx + 16, ground - 36); g.stroke();
      break;
    }
    case 'pole':
      g.fillStyle = wood; g.fillRect(cx + 11, ground - 58, 3, 54);
      g.fillStyle = shade(metal, 22);
      g.beginPath();
      g.moveTo(cx + 12.5, ground - 66);
      g.lineTo(cx + 18, ground - 52);
      g.lineTo(cx + 7, ground - 54);
      g.closePath(); g.fill();
      break;
    case 'maul':
      g.fillStyle = wood; g.fillRect(cx + 12, ground - 50, 4, 44);
      g.fillStyle = shade(metal, -8);
      g.fillRect(cx + 5, ground - 58, 18, 11);
      g.fillStyle = shade(metal, 20);
      g.fillRect(cx + 5, ground - 58, 18, 3);
      break;
    case 'pick':
      g.fillStyle = wood; g.fillRect(cx + 11, ground - 44, 3, 38);
      g.strokeStyle = shade(metal, 12); g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx + 3, ground - 46); g.quadraticCurveTo(cx + 12, ground - 52, cx + 20, ground - 42);
      g.stroke();
      break;
    case 'knife':
      g.fillStyle = shade(metal, 30);
      g.beginPath();
      g.moveTo(cx + 10, ground - 24); g.lineTo(cx + 17, ground - 36);
      g.lineTo(cx + 13, ground - 22); g.closePath(); g.fill();
      g.fillStyle = shade(metal, 30);
      g.beginPath();
      g.moveTo(cx - 10, ground - 24); g.lineTo(cx - 17, ground - 36);
      g.lineTo(cx - 13, ground - 22); g.closePath(); g.fill();
      break;
    case 'staff':
      g.fillStyle = wood; g.fillRect(cx + 12, ground - 62, 3, 58);
      g.strokeStyle = '#8a3a2a'; g.lineWidth = 2;
      g.beginPath(); g.arc(cx + 13.5, ground - 64, 5, 0, Math.PI * 2); g.stroke();
      break;
    case 'bell':
      g.fillStyle = shade('#9b8455', 10);
      g.beginPath();
      g.moveTo(cx + 8, ground - 52);
      g.lineTo(cx + 22, ground - 52);
      g.lineTo(cx + 25, ground - 36);
      g.lineTo(cx + 5, ground - 36);
      g.closePath(); g.fill();
      g.fillStyle = '#2a2018'; g.fillRect(cx + 13, ground - 36, 4, 5);
      break;
    case 'satchel':
      g.fillStyle = '#4a3a28';
      g.fillRect(cx + 9, ground - 24, 12, 10);
      g.fillStyle = '#2a2018'; g.fillRect(cx + 9, ground - 20, 12, 2);
      g.fillStyle = '#7a2a20';
      g.beginPath(); g.arc(cx + 15, ground - 28, 3.5, 0, Math.PI * 2); g.fill();
      break;
  }
}

function drawBeast(g, w, h, spec) {
  const cx = w / 2, ground = h - 6;
  const cloth = shade(spec.cloth || '#6e5a4e', 20);
  // low, long body -- reads instantly as "not a man" on a top-down grid
  g.fillStyle = shade(cloth, -30);
  g.fillRect(cx - 14, ground - 12, 4, 12);
  g.fillRect(cx - 4, ground - 11, 4, 11);
  g.fillRect(cx + 5, ground - 12, 4, 12);
  g.fillRect(cx + 13, ground - 11, 4, 11);
  g.fillStyle = cloth;
  g.beginPath();
  g.ellipse(cx, ground - 18, 19, 9, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = shade(cloth, 18);
  g.beginPath();
  g.ellipse(cx - 4, ground - 21, 12, 4.5, 0, 0, Math.PI * 2);
  g.fill();
  // ribs
  g.strokeStyle = shade(cloth, -34); g.lineWidth = 1.2;
  for (let i = -2; i <= 2; i++) {
    g.beginPath(); g.moveTo(cx + i * 6, ground - 25); g.lineTo(cx + i * 6, ground - 12); g.stroke();
  }
  // head slung low and forward
  g.fillStyle = shade(cloth, -12);
  g.beginPath();
  g.ellipse(cx + 20, ground - 16, 8.5, 6, -0.25, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0d0b0a';
  g.fillRect(cx + 20, ground - 18, 8, 2.4);
  g.fillStyle = '#c8c2b2';
  for (let i = 0; i < 4; i++) g.fillRect(cx + 22 + i * 2, ground - 14, 1.2, 3);
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

// Figures were drawn for a smaller tile and read as dark specks on a 52px
// board. Everything is baked through one scale factor rather than by
// re-tuning thirty hand-placed coordinates.
const FIGSCALE = 1.34;

// `custom` lets the player's captain override cloth/tabard/helm/weapon. The
// cache key has to include it or every captain shares the first one baked.
export function unitSprite(defId, custom) {
  const base = FIGURES[defId] || FIGURES.starveling;
  const spec = custom ? Object.assign({}, base, custom) : base;
  const key = 'u:' + defId + ':' + FIGSCALE + ':' +
    (custom ? [custom.cloth, custom.tabard, custom.helm, custom.weapon, custom.metal].join('|') : '-');
  const big = (spec.bulk || 1) > 1.3;
  const w = big ? 92 : 68, h = big ? 108 : 84;
  return bake(key, Math.round(w * FIGSCALE), Math.round(h * FIGSCALE), (g, W, H) => {
    g.scale(FIGSCALE, FIGSCALE);
    drawFigure(g, W / FIGSCALE, H / FIGSCALE, spec);
  });
}

// Live portrait for the creator -- not cached, it changes on every click.
export function drawPortrait(g, W, H, spec, t) {
  g.clearRect(0, 0, W, H);
  // The figure is 78px tall as drawn; size it to the box rather than guessing.
  const s = Math.min(W / 96, (H - 46) / 84);
  // torch pool on the ground so the figure is standing somewhere, not floating
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
  g.save();
  g.translate(W / 2, H - 20);
  g.scale(s, s);
  g.translate(-34, -78);
  drawFigure(g, 68, 84, spec);
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
  cloth: ['#5a4b3a', '#4b4a44', '#3f4a44', '#4a3f4a', '#54463c', '#33302f', '#3d5451', '#5f4d3c'],
  tabard: ['#8c3a2e', '#7a2a30', '#8a6a20', '#3f6360', '#5a4a7a', '#6b7c4a', '#a8998a', ''],
};

// ------------------------------------------------------------------- tiles
// Baked at tile size, high-frequency noise only -- low-frequency blotches make
// the tiling obvious the moment you look at a floor.
export function floorTile(size, colour, seed) {
  return bake('f:' + size + colour + seed, size, size, (g, W, H) => {
    g.fillStyle = colour;
    g.fillRect(0, 0, W, H);
    let s = seed;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < 90; i++) {
      const v = rnd();
      g.fillStyle = 'rgba(' + (v > 0.5 ? '255,255,255,0.035' : '0,0,0,0.06') + ')';
      g.fillRect(rnd() * W | 0, rnd() * H | 0, 1 + (rnd() * 2 | 0), 1);
    }
    // flagstone seam
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
  });
}

export function wallTile(size, colour, seed) {
  return bake('w:' + size + colour + seed, size, size, (g, W, H) => {
    g.fillStyle = colour;
    g.fillRect(0, 0, W, H);
    let s = seed + 7;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    // broken masonry: chunks, not noise
    for (let i = 0; i < 7; i++) {
      const x = rnd() * W * 0.8, y = rnd() * H * 0.8;
      const w2 = 5 + rnd() * (W * 0.4), h2 = 4 + rnd() * (H * 0.3);
      g.fillStyle = rnd() > 0.5 ? shade(colour, 14) : shade(colour, -14);
      g.fillRect(x | 0, y | 0, w2 | 0, h2 | 0);
    }
    // Bevel: blocking terrain has to read as RAISED at a glance, or players
    // path into it and only find out from the move overlay.
    g.fillStyle = 'rgba(255,232,200,0.10)';
    g.fillRect(0, 0, W, 3);
    g.fillRect(0, 0, 3, H);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, H - 5, W, 5);
    g.fillRect(W - 4, 0, 4, H);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
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

export { shade };
