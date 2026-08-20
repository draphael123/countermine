// COUNTERMINE -- captain creator. Stats, one signature, and a bearing.
// Kept out of game.js: it owns its own screen and hands back a plain config.
import { CAPTAIN_BASE, ALLOTMENT, STAT_LINES, SIGNATURES, ABILITIES, NAMES } from './data.js';
import { drawPortrait, CUSTOM_OPTIONS, FIGURES } from './art.js';

const $ = (id) => document.getElementById(id);

export function defaultCaptain() {
  return {
    name: 'Vetch',
    stats: { vigour: 2, haste: 1, plate: 1, might: 2 },
    sig: 'sig_rally',
    look: { helm: 'conical', weapon: 'sword', cloth: '#5a4b3a', tabard: '#8c3a2e' },
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
    look: {
      helm: pick(CUSTOM_OPTIONS.helm).id,
      weapon: pick(CUSTOM_OPTIONS.weapon).id,
      cloth: pick(CUSTOM_OPTIONS.cloth),
      tabard: pick(CUSTOM_OPTIONS.tabard),
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

export function openCreator(accept, back, previous) {
  onAccept = accept; onBack = back;
  state = previous ? JSON.parse(JSON.stringify(previous)) : defaultCaptain();
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
  $('btnRandomCap').addEventListener('click', () => {
    const keep = $('capName').value;
    state = randomCaptain();
    if (keep.trim()) state.name = keep;
    render();
  });
  $('btnTakeStair').addEventListener('click', () => {
    if (left() > 0) return;
    closeCreator();
    onAccept(state);
  });
  $('btnCreatorBack').addEventListener('click', () => { closeCreator(); onBack(); });
}

function render() {
  $('capName').value = state.name;

  // ---- stats
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

  // ---- signature
  const sl = $('spellList');
  sl.innerHTML = '';
  for (const id of SIGNATURES) {
    const a = ABILITIES[id];
    const b = document.createElement('button');
    b.className = 'spellOpt' + (state.sig === id ? ' on' : '');
    b.innerHTML = '<b>' + a.name + '</b><span>' + a.desc + '</span>' +
      '<span style="color:var(--ink-far);font-style:italic">' + (a.long || '') + '</span>';
    b.addEventListener('click', () => { state.sig = id; render(); });
    sl.appendChild(b);
  }

  // ---- bearing
  optButtons('optHelm', CUSTOM_OPTIONS.helm, state.look.helm, (v) => { state.look.helm = v; render(); });
  optButtons('optWeapon', CUSTOM_OPTIONS.weapon, state.look.weapon, (v) => { state.look.weapon = v; render(); });
  swatches('optCloth', CUSTOM_OPTIONS.cloth, state.look.cloth, (v) => { state.look.cloth = v; render(); });
  swatches('optTabard', CUSTOM_OPTIONS.tabard, state.look.tabard, (v) => { state.look.tabard = v; render(); });

  summary();
  $('btnTakeStair').disabled = left() > 0;
  $('creatorHint').textContent = left() > 0
    ? left() + ' point' + (left() === 1 ? '' : 's') + ' still unspent.'
    : 'Recruits you meet below carry two abilities each. You carry one, and the allotment.';
}

function statValue(line) {
  const v = state.stats[line.id];
  const cap = makeCaptain(state).def;
  if (line.id === 'vigour') return cap.hp + ' hp';
  if (line.id === 'haste') return cap.mov + ' move';
  if (line.id === 'plate') return cap.armor + ' armour';
  return cap.atk[0] + '–' + cap.atk[1] + ' dmg';
}

function optButtons(id, opts, cur, fn) {
  const box = $(id);
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
  $('capSummary').innerHTML =
    '<div style="color:var(--bone);font-size:15px;letter-spacing:.06em">' + (state.name || 'Unnamed') + '</div>' +
    '<div style="font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--torch);margin:3px 0 9px">Captain</div>' +
    '<div class="mono" style="color:var(--ink)">' + cap.def.hp + ' hp · ' + cap.def.armor + ' armour · '
    + cap.def.mov + ' move</div>' +
    '<div class="mono" style="color:var(--ink)">hits ' + cap.def.atk[0] + '–' + cap.def.atk[1] + ' at range 1</div>' +
    '<div class="abLine" style="margin-top:11px"><b>' + a.name + '</b> — ' + a.desc + '</div>' +
    '<div style="margin-top:12px;font-style:italic;color:var(--ink-far);font-size:11.5px">'
    + 'Flanking adds +3: put an ally on the far side of whatever you are hitting.</div>';
}

function loop() {
  const cv = $('portrait');
  if (!cv) return;
  const g = cv.getContext('2d');
  const spec = Object.assign({}, FIGURES.captain, state.look);
  drawPortrait(g, cv.width, cv.height, spec, performance.now());
  raf = requestAnimationFrame(loop);
}
