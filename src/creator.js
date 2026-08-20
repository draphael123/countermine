// COUNTERMINE -- captain creator. A past, an allotment, one signature, and a
// bearing. Kept out of game.js: it owns its own screen and hands back a config.
import { CAPTAIN_BASE, ALLOTMENT, STAT_LINES, SIGNATURES, ORIGINS, ABILITIES, NAMES } from './data.js';
import { drawPortrait, CUSTOM_OPTIONS, FIGURES } from './art.js';
import { play } from './sfx.js';

const $ = (id) => document.getElementById(id);

// one-click allotments for players who don't want to do arithmetic
const PRESETS = [
  { id: 'wall', name: 'The Wall', stats: { vigour: 3, haste: 0, plate: 3, might: 0 } },
  { id: 'blade', name: 'The Blade', stats: { vigour: 0, haste: 1, plate: 0, might: 3 } },
  { id: 'runner', name: 'The Runner', stats: { vigour: 1, haste: 3, plate: 0, might: 2 } },
  { id: 'even', name: 'The Even Hand', stats: { vigour: 2, haste: 1, plate: 1, might: 2 } },
];

const WEAPON_SOUND = {
  sword: 'hit', maul: 'heavy', knife: 'pierce', shield: 'thunk', pole: 'sweep', staff: 'fire', bow: 'bow',
};

export function defaultCaptain() {
  return {
    name: 'Vetch',
    stats: { vigour: 2, haste: 1, plate: 1, might: 2 },
    sig: 'sig_hold',   // self-cast: never a dead button on a solo start
    origin: 'deserter',
    look: { helm: 'conical', weapon: 'sword', cloth: '#5a4b3a', tabard: '#8c3a2e', metal: '#938c7e', plume: '', bulk: 1.08 },
  };
}

export function randomCaptain(rand = Math.random) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const stats = { vigour: 0, haste: 0, plate: 0, might: 0 };
  const keys = STAT_LINES.map(s => s.id);
  let left = ALLOTMENT, guard = 0;
  while (left > 0 && guard++ < 60) {
    const k = pick(keys);
    const line = STAT_LINES.find(s => s.id === k);
    if (stats[k] < line.max) { stats[k]++; left--; }
  }
  return {
    name: pick(NAMES),
    stats,
    sig: pick(SIGNATURES),
    origin: pick(ORIGINS).id,
    look: {
      helm: pick(CUSTOM_OPTIONS.helm).id,
      weapon: pick(CUSTOM_OPTIONS.weapon).id,
      cloth: pick(CUSTOM_OPTIONS.cloth),
      tabard: pick(CUSTOM_OPTIONS.tabard),
      metal: pick(CUSTOM_OPTIONS.metal),
      plume: pick(CUSTOM_OPTIONS.plume).id,
      bulk: pick(CUSTOM_OPTIONS.build).id,
    },
  };
}

// A config becomes a real class definition. Every stat point is a visible
// number on the unit, never a hidden multiplier.
export function makeCaptain(cfg) {
  const s = cfg.stats;
  const def = Object.assign({}, CAPTAIN_BASE, {
    hp: CAPTAIN_BASE.hp + s.vigour * 4,
    mov: CAPTAIN_BASE.mov + s.haste,
    armor: CAPTAIN_BASE.armor + s.plate,
    atk: [CAPTAIN_BASE.atk[0] + s.might * 2, CAPTAIN_BASE.atk[1] + s.might * 2],
    abilities: [cfg.sig],
    blurb: CAPTAIN_BASE.blurb,
  });
  return { name: cfg.name || 'Captain', def, custom: cfg.look, cfg };
}

let state = null;
let onAccept = null, onBack = null;
let raf = 0;
let swingStart = 0;

export function openCreator(accept, back, previous) {
  onAccept = accept; onBack = back;
  state = previous ? JSON.parse(JSON.stringify(previous)) : defaultCaptain();
  if (!state.origin) state.origin = 'deserter';
  if (state.look.metal == null) state.look.metal = '#938c7e';
  if (state.look.plume == null) state.look.plume = '';
  if (state.look.bulk == null) state.look.bulk = 1.08;
  bindOnce();
  render();
  loop();
}

export function closeCreator() { cancelAnimationFrame(raf); raf = 0; }

function spent() { return STAT_LINES.reduce((a, l) => a + state.stats[l.id], 0); }
function left() { return ALLOTMENT - spent(); }

let bound = false;
function bindOnce() {
  if (bound) return;
  bound = true;
  $('capName').addEventListener('input', (e) => {
    state.name = e.target.value.replace(/[^A-Za-z '\-]/g, '').slice(0, 14);
    summary();
  });
  $('nameDie').addEventListener('click', () => {
    // re-roll ONLY the name; the rest of the captain is yours
    const pool = NAMES.filter(n => n !== state.name);
    state.name = pool[(Math.random() * pool.length) | 0];
    $('capName').value = state.name;
    play('ui');
    summary();
  });
  $('btnRandomCap').addEventListener('click', () => {
    state = randomCaptain();
    play('coin');
    render();
  });
  $('btnTakeStair').addEventListener('click', () => {
    if (left() > 0) return;
    closeCreator();
    onAccept(state);
  });
  $('btnCreatorBack').addEventListener('click', () => { closeCreator(); onBack(); });
  // test your arm: the portrait swings and you hear the strike
  $('portraitBox').addEventListener('click', () => {
    swingStart = performance.now();
    play(WEAPON_SOUND[state.look.weapon] || 'hit');
  });
}

function render() {
  $('capName').value = state.name;

  // ---- origins: the past you carry down
  const ob = $('originList');
  ob.innerHTML = '';
  for (const o of ORIGINS) {
    const d = document.createElement('button');
    d.className = 'originOpt' + (state.origin === o.id ? ' on' : '');
    d.innerHTML = '<b>' + o.name + '</b><span>' + o.boon + '</span>';
    d.title = o.past;
    d.addEventListener('click', () => { state.origin = o.id; render(); });
    ob.appendChild(d);
  }

  // ---- presets, then stats
  const pr = $('presetRow');
  pr.innerHTML = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    const isNow = STAT_LINES.every(l => state.stats[l.id] === p.stats[l.id]);
    b.textContent = p.name;
    b.className = isNow ? 'on' : '';
    b.addEventListener('click', () => { state.stats = Object.assign({}, p.stats); render(); });
    pr.appendChild(b);
  }

  const box = $('statList');
  box.innerHTML = '';
  for (const line of STAT_LINES) {
    const v = state.stats[line.id];
    const row = document.createElement('div');
    row.className = 'statRow';
    const track = Array.from({ length: line.max }, (_, i) =>
      '<i class="' + (i < v ? 'f' : '') + '"></i>').join('');
    row.innerHTML =
      '<span class="nm">' + line.name + '</span>' +
      '<span class="track">' + track + '</span>' +
      '<span class="val mono">' + statValue(line) + '</span>';
    const minus = document.createElement('button');
    minus.textContent = '−';
    minus.disabled = v <= 0;
    minus.addEventListener('click', () => { state.stats[line.id]--; render(); });
    const plus = document.createElement('button');
    plus.textContent = '+';
    plus.disabled = v >= line.max || left() <= 0;
    plus.addEventListener('click', () => { state.stats[line.id]++; render(); });
    row.append(minus, plus);
    row.addEventListener('mouseenter', () => { $('statHint').textContent = line.text; });
    box.appendChild(row);
  }
  $('pointsLeft').textContent = left() + ' left';
  $('statHint').textContent = left() > 0
    ? 'Spend every point before you go down. Hover a line to see what it buys.'
    : 'All allotted. Hover a line to see what it buys.';

  // ---- signatures, grouped by school
  const sl = $('spellList');
  sl.innerHTML = '';
  const groups = [
    { label: 'Martial', ids: ['sig_rally', 'sig_hold', 'sig_hew'], col: '#c9803c' },
    { label: 'Arcane', ids: ['sig_ember', 'sig_grave', 'sig_oath'], col: '#8a7fd0' },
  ];
  for (const grp of groups) {
    const h = document.createElement('div');
    h.className = 'spellGroup';
    h.style.color = grp.col;
    h.textContent = grp.label;
    sl.appendChild(h);
    for (const id of grp.ids) {
      const a = ABILITIES[id];
      const b = document.createElement('button');
      b.className = 'spellOpt' + (state.sig === id ? ' on' : '');
      b.style.borderLeft = '3px solid ' + (state.sig === id ? grp.col : '#3c3128');
      const needsAlly = a.target === 'ally' ? ' <em style="color:var(--ink-far)">(needs an ally — you start alone)</em>' : '';
      b.innerHTML = '<b>' + a.name + '</b><span>' + a.desc + needsAlly + '</span>';
      b.addEventListener('click', () => { state.sig = id; render(); });
      sl.appendChild(b);
    }
  }

  // ---- bearing
  optButtons('optHelm', CUSTOM_OPTIONS.helm, state.look.helm, (v) => { state.look.helm = v; render(); });
  optButtons('optWeapon', CUSTOM_OPTIONS.weapon, state.look.weapon, (v) => {
    state.look.weapon = v;
    swingStart = performance.now();
    play(WEAPON_SOUND[v] || 'hit');
    render();
  });
  optButtons('optPlume', CUSTOM_OPTIONS.plume, state.look.plume, (v) => { state.look.plume = v; render(); });
  optButtons('optBuild', CUSTOM_OPTIONS.build, state.look.bulk, (v) => { state.look.bulk = v; render(); });
  swatches('optCloth', CUSTOM_OPTIONS.cloth, state.look.cloth, (v) => { state.look.cloth = v; render(); });
  swatches('optTabard', CUSTOM_OPTIONS.tabard, state.look.tabard, (v) => { state.look.tabard = v; render(); });
  swatches('optMetal', CUSTOM_OPTIONS.metal, state.look.metal, (v) => { state.look.metal = v; render(); });

  summary();
  $('btnTakeStair').disabled = left() > 0;
  $('creatorHint').textContent = left() > 0
    ? left() + ' point' + (left() === 1 ? '' : 's') + ' still unspent.'
    : 'You go down ALONE. Everyone else is found below — recruits carry two abilities, you carry your signature and the allotment.';
}

function statValue(line) {
  const cap = makeCaptain(state).def;
  if (line.id === 'vigour') return cap.hp + ' hp';
  if (line.id === 'haste') return cap.mov + ' move';
  if (line.id === 'plate') return cap.armor + ' armour';
  return cap.atk[0] + '–' + cap.atk[1] + ' dmg';
}

function optButtons(id, opts, cur, fn) {
  const box = $(id);
  if (!box) return;
  box.innerHTML = '';
  for (const o of opts) {
    const b = document.createElement('button');
    b.textContent = o.label;
    b.className = cur === o.id ? 'on' : '';
    b.addEventListener('click', () => fn(o.id));
    box.appendChild(b);
  }
}

function swatches(id, colours, cur, fn) {
  const box = $(id);
  if (!box) return;
  box.innerHTML = '';
  for (const c of colours) {
    const b = document.createElement('button');
    b.className = 'swatch' + (cur === c ? ' on' : '');
    b.style.background = c || 'transparent';
    if (!c) {
      b.style.backgroundImage = 'linear-gradient(45deg, transparent 44%, #6a5a4a 44%, #6a5a4a 56%, transparent 56%)';
      b.title = 'No colours';
    }
    b.addEventListener('click', () => fn(c));
    box.appendChild(b);
  }
}

function summary() {
  const cap = makeCaptain(state);
  const a = ABILITIES[state.sig];
  const o = ORIGINS.find(x => x.id === state.origin) || ORIGINS[0];
  $('capSummary').innerHTML =
    '<div style="color:var(--bone);font-size:15px;letter-spacing:.06em">' + (state.name || 'Unnamed') + '</div>' +
    '<div style="font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--torch);margin:3px 0 9px">'
    + o.name.replace(/^The /, '') + ' · Captain</div>' +
    '<div class="mono" style="color:var(--ink)">' + cap.def.hp + ' hp · ' + cap.def.armor + ' armour · '
    + cap.def.mov + ' move</div>' +
    '<div class="mono" style="color:var(--ink)">hits ' + cap.def.atk[0] + '–' + cap.def.atk[1] + ' at range 1</div>' +
    '<div class="abLine" style="margin-top:10px"><b>' + a.name + '</b> — ' + a.desc + '</div>' +
    '<div class="abLine" style="margin-top:6px;border-left-color:var(--gold)"><b>' + o.boon + '</b></div>' +
    '<div style="margin-top:11px;font-style:italic;color:var(--ink-far);font-size:11.5px;line-height:1.5">' + o.past + '</div>';
}

function loop() {
  const cv = $('portrait');
  if (!cv) return;
  const g = cv.getContext('2d');
  const spec = Object.assign({}, FIGURES.captain, state.look);
  const swing = swingStart ? Math.min(1, (performance.now() - swingStart) / 320) : 1;
  drawPortrait(g, cv.width, cv.height, spec, performance.now(), swing < 1 ? swing : 0);
  raf = requestAnimationFrame(loop);
}
