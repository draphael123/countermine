// COUNTERMINE -- run structure, screens, input, and the balance harness.
import {
  CLASSES, ENEMIES, BOSSES, ABILITIES, RELICS, FLOORS, NAMES, DEATH_LINES,
  CAPTAIN_BASE, ALLOTMENT, STAT_LINES, SIGNATURES, ORIGINS,
} from './data.js';
import * as E from './engine.js';
import * as R from './render.js';
import { drawPortrait, CUSTOM_OPTIONS, FIGURES, portraitURL, PROP_NAMES, introScene, titleSkyline } from './art.js';
import { openCreator, closeCreator, makeCaptain, defaultCaptain, randomCaptain } from './creator.js';
import { startTutorial, tickTutorial, tutorialActive, endTutorial, hideCoach } from './tutorial.js';
import { play, unlockAudio, setSfxEnabled, startAmbience, stopAmbience, setMusicMode, setVolumes, setMusicFloor } from './sfx.js';

// =========================================================== persistent meta
const META_KEY = 'countermine_meta_v1';
const SET_KEY = 'countermine_settings_v1';

const DEFAULT_META = () => ({
  tallies: 0, runs: 0, wins: 0, deepest: 0,
  classes: Object.keys(CLASSES).filter(k => !CLASSES[k].locked),
  relics: RELICS.filter(r => !r.locked).map(r => r.id),
  seenIntro: false, seenTutorial: false, lastCaptain: null,
  seenFoes: [], foeKills: {}, history: [], tipsSeen: [], lossCoached: false,
});
const DEFAULT_SETTINGS = () => ({
  threatDefault: true, fastEnemy: false, confirmEnd: true, sound: true, autoEnd: true, duelAnims: true,
  volMaster: 0.7, volMusic: 0.7, volSfx: 0.9,
  fastAnim: false, cbThreat: false, dmgNumbers: true,
  reducedMotion: (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches),
  showForecast: true, screenShake: true, difficulty: 'regular',
});

let meta = load(META_KEY, DEFAULT_META());
let settings = load(SET_KEY, DEFAULT_SETTINGS());

function load(k, dflt) {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return dflt;
    return Object.assign(dflt, JSON.parse(raw));
  } catch (e) { return dflt; }
}
function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {} }
function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) {} }

const DIFF = {
  merciful: { enemyDmg: 0.8, budget: 0.85, label: 'Merciful', note: 'Fewer of them, and they hit softer. For learning the board.' },
  regular: { enemyDmg: 1.0, budget: 1.0, label: 'Regular', note: 'The siege as it was.' },
  bitter: { enemyDmg: 1.15, budget: 1.2, label: 'Bitter', note: 'More of them, hitting harder. Recruits die.' },
};

// ================================================================ run state
let run = null;
let st = null;              // current battle
let view = { hover: null, selected: null, moveTiles: null, targetTiles: null, path: null, threat: null, palette: null };
let mode = 'idle';          // idle | move | attack | ability | dir
let armedAbility = null;
let enemyTimer = 0;
let uidCounter = 1;
// the targeting reticle, inline so the cursor never waits on a fetch
const CROSSHAIR_SVG = "%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2226%22%20height%3D%2226%22%3E%3Cg%20stroke%3D%22%23d4823c%22%20stroke-width%3D%222%22%20fill%3D%22none%22%3E%3Ccircle%20cx%3D%2213%22%20cy%3D%2213%22%20r%3D%227%22%2F%3E%3Cpath%20d%3D%22M13%201v6M13%2019v6M1%2013h6M19%2013h6%22%2F%3E%3C%2Fg%3E%3Ccircle%20cx%3D%2213%22%20cy%3D%2213%22%20r%3D%221.6%22%20fill%3D%22%23f2dcbc%22%2F%3E%3C%2Fsvg%3E";
// Touch: hover does not exist, so a first tap PREVIEWS (inspect, forecast,
// threat) and a second tap on the same tile commits. Desktop is unchanged.
const touchMode = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || !!window.__forceTouch;
let pendingTap = null;

const $ = (id) => document.getElementById(id);
const cv = $('cv');
const ctx = cv.getContext('2d');
cv.width = R.CW; cv.height = R.CH;

// A fade that never blocks: screens swap synchronously underneath while a
// dark overlay softens the cut, then dissolves.
function fadeFlash() {
  const f = $('fader');
  if (!f) return;
  // No rAF: it pauses in background tabs and left the overlay stuck dark.
  // A forced reflow between the two writes starts the transition synchronously.
  f.style.transition = 'none';
  f.style.opacity = '0.9';
  void f.offsetWidth;
  f.style.transition = 'opacity .30s ease-out';
  f.style.opacity = '0';
  // Transitions freeze in non-composited tabs; a stuck overlay is a black
  // screen. The timeout is the guarantee, the transition is the garnish.
  clearTimeout(fadeFlash.tk);
  fadeFlash.tk = setTimeout(() => { f.style.transition = 'none'; f.style.opacity = '0'; }, 450);
}

// ================================================================== screens
const SCREENS = ['title', 'mapScreen', 'modal', 'creator'];
let currentScreen = 'title';
function showScreen(id) {
  if (currentScreen !== id) fadeFlash();
  currentScreen = id;
  if (settings.sound !== false && (id === 'battle' || id === 'mapScreen')) startAmbience();
  if (id === 'title') { stopAmbience(); setMusicMode('off'); }
  else if (settings.sound !== false && id !== 'battle') setMusicMode('map');
  $('mEyebrow').textContent = '';
  $('modal').classList.remove('intro');
  for (const s of SCREENS) $(s).classList.toggle('on', s === id);
  $('battle').classList.toggle('on', id === 'battle');
  if (id !== 'battle') hideCoach();
}

// =============================================================== the creator
function screenCreator() {
  showScreen('creator');
  openCreator(
    (cfg) => {
      meta.lastCaptain = cfg; saveMeta();
      newRun(null, makeCaptain(cfg));
    },
    goTitle,
    meta.lastCaptain
  );
}

// =============================================================== run set-up
function newRun(seed, captain) {
  const s = seed != null ? seed : (Math.floor(Math.random() * 1e9));
  const rng = E.makeRng(s);
  const cap = captain || makeCaptain(defaultCaptain());
  run = {
    seed: s, rng, floorIdx: 0, gold: 60, mana: 12, manaMax: 12, relics: [], party: [], nodeId: null,
    map: null, cleared: 0, fights: 0, kills: 0, losses: 0,
  };
  // You go down ALONE. Everyone else is found below.
  run.captain = cap;
  run.party.push({ id: uidCounter++, defId: 'captain', name: cap.name, hp: cap.def.hp,
    maxHp: cap.def.hp, kills: 0, def: cap.def, custom: cap.custom });
  // the origin's one small edge
  const origin = (cap.cfg && cap.cfg.origin) || 'deserter';
  if (origin === 'deserter') run.gold += 40;
  else if (origin === 'mason' && !run.relics.includes('scraps')) run.relics.push('scraps');
  else if (origin === 'gravedigger') {
    for (const id of FLOORS[0].pool.concat(FLOORS[0].elitePool, [FLOORS[0].boss])) {
      if (!meta.seenFoes.includes(id)) meta.seenFoes.push(id);
    }
    saveMeta();
  }
  run.map = buildFloorMap(rng, 0);
  run.tutorial = !meta.seenTutorial;
  meta.runs++; saveMeta();
  openMap();
}

// The captain has no CLASSES entry: it carries its own def. Every lookup on a
// PARTY MEMBER must go through this or it throws the moment a captain is shown.
function classOf(p) { return p.def || CLASSES[p.defId] || CAPTAIN_BASE; }

function mkMember(defId, rng) {
  const c = CLASSES[defId];
  return { id: uidCounter++, defId, name: rng.pick(NAMES), hp: c.hp, maxHp: c.hp, kills: 0 };
}

// ---------------------------------------------------------------- node map
function buildFloorMap(rng, floorIdx) {
  const COLS = 6;
  const nodes = [];
  const byCol = [];
  for (let c = 0; c < COLS; c++) {
    let count;
    if (c === 0) count = 1;
    else if (c === COLS - 1) count = 1;
    else if (c === COLS - 2) count = 2;
    else count = rng.int(2, 3);
    const col = [];
    for (let i = 0; i < count; i++) {
      const rowSpan = count === 1 ? [1] : count === 2 ? [0, 2] : [0, 1, 2];
      col.push({
        id: c + ':' + i, col: c, row: rowSpan[i],
        type: nodeType(rng, c, COLS), links: [], done: false,
      });
    }
    byCol.push(col);
    nodes.push(...col);
  }
  for (let c = 0; c < COLS - 1; c++) {
    for (const n of byCol[c]) {
      const next = byCol[c + 1];
      const sorted = next.slice().sort((a, b) => Math.abs(a.row - n.row) - Math.abs(b.row - n.row));
      const k = next.length === 1 ? 1 : (rng.chance(0.45) ? 2 : 1);
      n.links = sorted.slice(0, k).map(x => x.id);
    }
    // make sure nothing in the next column is orphaned
    for (const m of byCol[c + 1]) {
      if (!byCol[c].some(n => n.links.includes(m.id))) {
        const from = byCol[c].slice().sort((a, b) => Math.abs(a.row - m.row) - Math.abs(b.row - m.row))[0];
        from.links.push(m.id);
      }
    }
  }
  balanceFloor(byCol, COLS, rng);
  return { nodes, cols: COLS, floorIdx, at: null, reachable: byCol[0].map(n => n.id) };
}

// Raw random node types produced runs of three camps in a row and floors with
// almost no fighting in them. Cap the soft nodes and floor the hard ones.
function balanceFloor(byCol, COLS, rng) {
  const mid = [];
  for (let c = 1; c <= COLS - 3; c++) mid.push(...byCol[c]);
  const isCombat = (n) => n.type === 'fight' || n.type === 'elite';

  // no more than two camps on a floor, and never two in adjacent columns
  let camps = 0;
  for (let c = 1; c <= COLS - 3; c++) {
    for (const n of byCol[c]) {
      if (n.type !== 'camp') continue;
      const adjacentCamp = (byCol[c - 1] || []).some(p => p.type === 'camp');
      if (camps >= 2 || adjacentCamp) n.type = rng.chance(0.6) ? 'fight' : 'cache';
      else camps++;
    }
  }
  // prisoners: the ONLY way the company grows -- guarantee one early, cap two
  const pris = mid.filter(n => n.type === 'prisoner');
  if (pris.length === 0) {
    const early = byCol[1].concat(byCol[2]).filter(n => !isCombat(n));
    const pick2 = early[0] || byCol[1][0];
    if (pick2) pick2.type = 'prisoner';
  } else if (!pris.some(n => n.col <= 2)) {
    pris[0].type = rng.chance(0.5) ? 'cache' : 'fight';
    const early = byCol[1].concat(byCol[2]);
    (early.find(n => !isCombat(n)) || early[0]).type = 'prisoner';
  }
  let pcount = 0;
  for (const n of mid) if (n.type === 'prisoner' && ++pcount > 2) n.type = 'fight';

  // at least three things to fight before the boss
  let combat = mid.filter(isCombat).length;
  const soft = rng.shuffle(mid.filter(n => !isCombat(n)));
  for (const n of soft) {
    if (combat >= 3) break;
    n.type = 'fight'; combat++;
  }
  // and at least one relic on the floor, so builds actually happen
  if (!mid.some(n => n.type === 'cache' || n.type === 'vendor')) {
    const pick = rng.pick(mid.filter(isCombat).slice(1)) || mid[mid.length - 1];
    if (pick) pick.type = 'cache';
  }
}

function nodeType(rng, c, COLS) {
  if (c === 0) return 'fight';
  if (c === COLS - 1) return 'boss';
  if (c === COLS - 2) return rng.chance(0.5) ? 'camp' : 'vendor';
  const roll = rng.next();
  if (c >= 2 && roll < 0.16) return 'elite';
  if (roll < 0.40) return 'fight';
  if (roll < 0.54) return 'prisoner';
  if (roll < 0.68) return 'cache';
  if (roll < 0.80) return 'camp';
  if (roll < 0.9) return 'vendor';
  return 'fight';
}

const NODE_TIPS = {
  fight: 'A fight you can see coming. Gold from the bodies, and three survivors offer to join after.',
  elite: 'A harder fight for better gold. Bring everyone healthy.',
  camp: 'Rest. Choose ONE: heal everyone, drill one soldier (+6 max hp), or strip it for gold.',
  cache: 'A relic cache: take one of three, or the coin instead. You carry five at most.',
  vendor: 'The quartermaster sells relics, healing, and kit for gold. Gold dies with the run — spend it.',
  boss: 'The floor’s master. There is no way around, only through.',
  prisoner: 'Someone is chained down here. Free them and decide what they turn out to be — the company only grows this way.',
};

const NODE_ART = {
  fight: { label: 'Skirmish', glyph: '⚔', colour: '#a8998a' },
  elite: { label: 'Strongpoint', glyph: '☠', colour: '#c07050' },
  camp: { label: 'Camp', glyph: 'ᛡ', colour: '#8fa85c' },
  cache: { label: 'Spoil', glyph: '◆', colour: '#cbb27a' },
  vendor: { label: 'Quartermaster', glyph: '⚖', colour: '#7fa8c0' },
  boss: { label: 'The Deep End', glyph: '⚑', colour: '#c04a3a' },
  prisoner: { label: 'Prisoner', glyph: '⛓', colour: '#c9a86a' },
};

function openMap() {
  saveRun();
  if (settings.sound !== false && run) setMusicFloor(FLOORS[run.floorIdx].n);
  showScreen('mapScreen');
  const f = FLOORS[run.floorIdx];
  $('mapScreen').style.backgroundImage =
    'radial-gradient(ellipse 85% 55% at 50% 0%, ' + f.palette.accent + '22, transparent 62%),' +
    'linear-gradient(180deg, #0d0b09, #070605)';
  $('floorName').textContent = 'FLOOR ' + f.n + ' — ' + f.name;
  $('floorSub').textContent = f.sub;
  tweenNum($('goldNum'), run.gold);
  $('manaNum').textContent = run.mana + '/' + run.manaMax;
  tweenNum($('tallyNum'), meta.tallies);
  renderRoster();
  const strip = $('relicStrip');
  strip.innerHTML = '';
  for (const rid of run.relics) {
    const r = RELICS.find(x => x.id === rid);
    const d = document.createElement('div');
    d.className = 'relicChip';
    d.textContent = r.name;
    d.title = r.text;
    strip.appendChild(d);
  }
  drawMap();
}

// The party used to exist only as a number on the map screen, so nobody could
// see who they had or how hurt they were between fights.
// numbers roll to their new value; snapping is for spreadsheets
function tweenNum(el, target) {
  const from = parseInt(el.textContent, 10);
  if (isNaN(from) || from === target || settings.reducedMotion) { el.textContent = target; return; }
  const t0 = performance.now(), dur = Math.min(700, 180 + Math.abs(target - from) * 6);
  clearInterval(el.__tween);
  el.__tween = setInterval(() => {
    const p = Math.min(1, (performance.now() - t0) / dur);
    el.textContent = Math.round(from + (target - from) * (1 - (1 - p) * (1 - p)));
    if (p >= 1) clearInterval(el.__tween);
  }, 40);
}

function renderRoster() {
  const box = $('roster');
  box.innerHTML = '';
  for (const p of run.party) {
    const c = classOf(p);
    const d = document.createElement('div');
    d.className = 'rosterCard';
    const frac = Math.max(0, p.hp / p.maxHp);
    d.innerHTML = '<img class="pimg rosterP' + (p.hp / p.maxHp < 0.35 ? ' hurt' : '') + '" src="' + portraitURL(p.defId, p.custom, 52, 62) + '" alt="">'
      + '<div class="nm">' + p.name + '</div>'
      + '<div class="cls" style="color:' + (c.colour || 'var(--torch)') + '">' + c.name + (p.defId === 'captain' ? ' · you' : '') + '</div>'
      + '<div class="hpbar' + (frac <= .34 ? ' low' : '') + '"><i style="width:' + (frac*100) + '%"></i></div>'
      + '<div class="mono" style="font-size:10.5px;color:var(--ink-far);margin-top:4px">'
      + p.hp + '/' + p.maxHp + ' hp · ' + c.armor + ' arm · ' + c.mov + ' mv</div>';
    d.title = c.abilities.map(a => ABILITIES[a].name + ' — ' + ABILITIES[a].desc).join('\n');
    box.appendChild(d);
  }
  for (let i = run.party.length; i < 4; i++) {
    const d = document.createElement('div');
    d.className = 'rosterCard empty';
    d.textContent = 'empty billet';
    box.appendChild(d);
  }
}

function drawMap() {
  const svg = $('mapSvg');
  const W = 1200, H = 400;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const m = run.map;
  const accent = FLOORS[run.floorIdx].palette.accent;
  const colX = (c) => 70 + c * ((W - 150) / (m.cols - 1));
  const rowY = (r) => 80 + r * 120;

  let s = '<defs>'
    + '<filter id="nglow" x="-80%" y="-80%" width="260%" height="260%">'
    + '<feGaussianBlur stdDeviation="5" result="b"/>'
    + '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>'
    + '</filter>'
    + '<radialGradient id="nbg"><stop offset="0%" stop-color="#211a13"/><stop offset="100%" stop-color="#130f0c"/></radialGradient>'
    + '</defs>';

  // Edges in three states: the roads you MAY take now burn; the roads you
  // took are worn; everything else is barely there.
  for (const n of m.nodes) {
    for (const lid of n.links) {
      const t = m.nodes.find(x => x.id === lid);
      const active = (m.at === n.id || (!m.at && n.col === 0 && m.reachable.includes(n.id)))
        && m.reachable.includes(lid);
      const walked = n.done && t.done;
      const stroke = active ? '#c2703a' : walked ? '#5b4a3a' : '#2c251f';
      const wdt = active ? 2.5 : 1.5;
      s += '<line' + (active ? ' class="march"' : '') + ' x1="' + colX(n.col) + '" y1="' + rowY(n.row) + '" x2="' + colX(t.col) + '" y2="' + rowY(t.row)
        + '" stroke="' + stroke + '" stroke-width="' + wdt + '" stroke-dasharray="5 6"'
        + (active ? ' filter="url(#nglow)"' : '') + '/>';
    }
  }

  for (const n of m.nodes) {
    const art = NODE_ART[n.type];
    const can = m.reachable.includes(n.id);
    const here = m.at === n.id;
    const x = colX(n.col), y = rowY(n.row);
    const op = n.done ? 0.34 : (can ? 1 : 0.42);
    s += '<g class="mapNode' + (can ? '' : ' dis') + '" data-id="' + n.id + '" opacity="' + op + '">';
    s += '<title>' + art.label + ' — ' + (NODE_TIPS[n.type] || '') + '</title>';
    if (can) s += '<circle cx="' + x + '" cy="' + y + '" r="30" fill="none" stroke="' + art.colour + '" stroke-width="1" opacity="0.35" filter="url(#nglow)"/>';
    s += '<circle cx="' + x + '" cy="' + y + '" r="26" fill="url(#nbg)" stroke="' + (can ? art.colour : '#3a2f26') + '" stroke-width="' + (can ? 2.5 : 1.5) + '"/>';
    s += '<text x="' + x + '" y="' + (y + 7) + '" text-anchor="middle" font-size="21" fill="' + art.colour + '">' + art.glyph + '</text>';
    if (n.done) {
      // scratched out in the ledger
      s += '<line x1="' + (x - 19) + '" y1="' + (y - 19) + '" x2="' + (x + 19) + '" y2="' + (y + 19) + '" stroke="#6d6154" stroke-width="2.5"/>';
      s += '<line x1="' + (x - 19) + '" y1="' + (y + 19) + '" x2="' + (x + 19) + '" y2="' + (y - 19) + '" stroke="#6d6154" stroke-width="1.5"/>';
    }
    s += '<text x="' + x + '" y="' + (y + 45) + '" text-anchor="middle" font-size="12" fill="#8b8072" letter-spacing="1">' + art.label + '</text>';
    if (here) {
      s += '<circle cx="' + x + '" cy="' + (y - 33) + '" r="4" fill="#e0a050" filter="url(#nglow)"/>';
      s += '<text x="' + x + '" y="' + (y - 41) + '" text-anchor="middle" font-size="10" fill="#c2703a" letter-spacing="2">HERE</text>';
    }
    s += '</g>';
  }
  // the way down, drawn at the far edge in the floor's own colour
  s += '<text x="' + (W - 18) + '" y="' + (H / 2 + 4) + '" text-anchor="middle" font-size="11" fill="' + accent
    + '" letter-spacing="3" transform="rotate(90 ' + (W - 18) + ' ' + (H / 2) + ')">DEEPER</text>';
  svg.innerHTML = s;
  svg.querySelectorAll('.mapNode').forEach(g => {
    g.addEventListener('click', () => {
      const id = g.getAttribute('data-id');
      if (!run.map.reachable.includes(id)) return;
      enterNode(run.map.nodes.find(n => n.id === id));
    });
  });
}

// ============================================================ run persistence
// Saved at every return to the map and at every battle start. The RNG state is
// serialized too, so a resumed dungeon deals the same cards it was going to.
// Known edge: closing during the post-fight recruit screen replays that fight.
const RUN_KEY = 'countermine_run_v1';

function saveRun(pendingNodeId) {
  if (!run) return;
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify({
      v: 1, seed: run.seed, rngState: run.rng.getState(),
      floorIdx: run.floorIdx, gold: run.gold, mana: run.mana, manaMax: run.manaMax, relics: run.relics,
      party: run.party.map(p => ({
        id: p.id, defId: p.defId, name: p.name, hp: p.hp, maxHp: p.maxHp, kills: p.kills,
      })),
      captainCfg: run.captain ? run.captain.cfg : null,
      map: run.map, fights: run.fights, kills: run.kills, losses: run.losses,
      fallen: run.fallen || [],
      pendingNodeId: pendingNodeId || null,
      uidCounter,
    }));
  } catch (e) { /* storage full or blocked -- play on without saves */ }
}

function clearRun() { try { localStorage.removeItem(RUN_KEY); } catch (e) {} }
function savedRun() {
  try { return JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); } catch (e) { return null; }
}

function resumeRun() {
  const d = savedRun();
  if (!d) return false;
  try {
    const rng = E.makeRng(d.seed);
    rng.setState(d.rngState);
    const cap = makeCaptain(d.captainCfg || defaultCaptain());
    run = {
      seed: d.seed, rng, floorIdx: d.floorIdx, gold: d.gold, mana: d.mana != null ? d.mana : 12, manaMax: d.manaMax || 12, relics: d.relics || [],
      party: d.party.map(p => p.defId === 'captain'
        ? Object.assign({}, p, { def: cap.def, custom: cap.custom }) : p),
      captain: cap, map: d.map,
      fights: d.fights, kills: d.kills, losses: d.losses,
      fallen: d.fallen || [],
      cleared: 0, tutorial: false, nodeId: null,
    };
    uidCounter = Math.max(uidCounter, d.uidCounter || 1);
    if (d.pendingNodeId) {
      const n = run.map.nodes.find(x => x.id === d.pendingNodeId);
      if (n && !n.done) { enterNode(n); return true; }
    }
    openMap();
    return true;
  } catch (e) { clearRun(); return false; }
}

function advanceFrom(node) {
  aftermath = null;
  node.done = true;
  run.map.at = node.id;
  run.map.reachable = node.links.slice();
  // This function OWNS the screen transition. Call sites must not follow it
  // with openMap(): past the last boss there is no next floor to open, and
  // doing so threw inside a click handler and silently wedged the win screen.
  if (!run.map.reachable.length) nextFloor(); else openMap();
}

function nextFloor() {
  if (settings.sound !== false) play('descend');
  run.floorIdx++;
  run.mana = Math.min(run.manaMax, run.mana + 4);
  if (run.floorIdx >= FLOORS.length) { runWon(); return; }
  run.map = buildFloorMap(run.rng, run.floorIdx);
  openMap();
}

// =============================================================== node entry
let pendingNode = null;

function enterNode(node) {
  pendingNode = node;
  if (node.type === 'boss') tip('boss');
  if (node.type === 'prisoner') tip('prisoner');
  if (node.type === 'cache') tip('cache');
  else if (node.type === 'camp') tip('camp');
  else if (node.type === 'vendor') tip('vendor');
  if (node.type === 'fight' || node.type === 'elite' || node.type === 'boss') startBattle(node);
  else if (node.type === 'prisoner') screenPrisoner();
  else if (node.type === 'camp') screenCamp();
  else if (node.type === 'cache') screenCache();
  else if (node.type === 'vendor') screenVendor();
}

// ---------------------------------------------------------------- battles
// Encounters scale to how many soldiers you actually have. Losing someone must
// make the next fight harder to WIN, not mathematically unwinnable -- otherwise
// one bad round spirals the whole run and permadeath stops being a decision.
const PARTY_SCALE = { 1: 0.3, 2: 0.58, 3: 0.8, 4: 1.0 };

function rollEnemies(rng, floor, kind, partySize) {
  const d = DIFF[settings.difficulty] || DIFF.regular;
  const ps = PARTY_SCALE[Math.max(1, Math.min(4, partySize || 4))];
  if (kind === 'boss') {
    const out = [floor.boss];
    const extras = Math.max(1, Math.round(2 * d.budget * ps));
    for (let i = 0; i < extras; i++) out.push(rng.pick(floor.pool));
    return out;
  }
  let budget = kind === 'elite'
    ? Math.round(floor.eliteBudget * d.budget * ps)
    : Math.round(rng.int(floor.budget[0], floor.budget[1]) * d.budget * ps);
  const pool = kind === 'elite' ? floor.elitePool.concat(floor.pool) : floor.pool;
  const out = [];
  let guard = 0;
  while (budget > 0 && out.length < 9 && guard++ < 60) {
    const pick = rng.pick(pool);
    const cost = ENEMIES[pick].threat;
    if (cost > budget && out.length) break;
    out.push(pick);
    budget -= cost;
  }
  return out.length ? out : ['starveling', 'starveling'];
}

function startBattle(node) {
  saveRun(node.id);
  const floor = FLOORS[run.floorIdx];
  const kind = node.type === 'boss' ? 'boss' : node.type === 'elite' ? 'elite' : 'fight';
  const tutorialFight = run.tutorial && run.fights === 0 && kind === 'fight';
  st = E.newBattle({
    seed: run.rng.int(1, 1e9),
    floor, kind,
    party: run.party.map(p => ({
      defId: p.defId, name: p.name, hp: p.hp, id: p.id,
      def: p.def, custom: p.custom, maxHp: p.maxHp,
    })),
    enemies: tutorialFight ? ['starveling', 'starveling'] : rollEnemies(run.rng, floor, kind, run.party.length),
    relics: run.relics,
    mana: run.mana, manaMax: run.manaMax,
  });
  st.difficulty = settings.difficulty;
  if (settings.sound !== false) { setMusicFloor(floor.n); setMusicMode(kind === 'boss' ? 'boss' : 'battle'); }
  view.palette = floor.palette;
  view.floorN = floor.n;
  view.threat = settings.threatDefault ? E.threatMap(st) : null;
  view.selected = null; view.moveTiles = null; view.targetTiles = null; view.path = null;
  mode = 'idle';
  $('floorTag').textContent = 'Floor ' + floor.n + ' · ' + floor.name + ' · ' + NODE_ART[node.type].label;
  showScreen('battle');
  if (!tutorialFight) setTimeout(() => tip('mana'), 900);
  if (kind === 'boss') {
    banner(BOSSES[floor.boss].name, 1900, 'boss');
    const bossU = st.units.find(u => u.boss);
    if (bossU && !settings.reducedMotion) {
      E.animWalk(bossU, [{ x: bossU.x + 5, y: bossU.y }, { x: bossU.x, y: bossU.y }]);
      bossU.anim.start = performance.now() + 250;
      bossU.anim.dur = 1300;
    }
  }
  else banner(NODE_ART[node.type].label.toUpperCase(), 1100);
  // the company files in from the stair on the left
  if (!settings.reducedMotion) st.units.filter(u => u.side === 'player').forEach((u, i) => {
    E.animWalk(u, [{ x: -2 - i, y: u.y }, { x: u.x, y: u.y }]);
    u.anim.start = performance.now() + i * 150;
    u.anim.dur = 430 + i * 40;
  });
  E.logLine(st, 'Place the company, then begin.');
  syncUI();
  if (tutorialFight) {
    // Mark it seen the moment it STARTS. Marking it on completion means anyone
    // who dies or quits mid-lesson gets the whole thing again next run.
    meta.seenTutorial = true; saveMeta();
    startTutorial(
      { state: () => st, view: () => view, screen: () => currentScreen },
      (completed) => { if (completed) { banner('THE DIG BEGINS', 1400); setTimeout(() => tip('recap'), 1600); } }
    );
  }
}

// a light phase announcement that never blocks input
function phaseSweep(text) {
  const el = $('phaseSweep');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('go');
  void el.offsetWidth;   // restart the animation
  if (settings.reducedMotion) { el.classList.add('still'); } else { el.classList.remove('still'); }
  el.classList.add('go');
}

function banner(text, ms, style) {
  if (settings.sound !== false) play(style === 'boss' ? 'bossSting' : 'drum');
  const b = $('banner');
  b.firstElementChild.textContent = text;
  b.classList.toggle('boss', style === 'boss');
  b.classList.add('on');
  if (style === 'boss' && st) st.fx.push({ kind: 'shake', mag: 6, t: 0 });
  setTimeout(() => b.classList.remove('on'), ms);
}

// ============================================================== battle input
function canvasTile(ev) {
  const r = cv.getBoundingClientRect();
  const sx = cv.width / r.width, sy = cv.height / r.height;
  return R.pxToTile((ev.clientX - r.left) * sx, (ev.clientY - r.top) * sy);
}

cv.addEventListener('mousemove', (ev) => {
  if (!st) return;
  const t = canvasTile(ev);
  view.hover = t;
  updateHoverPath(t);
  updateInspect(t);
  // Hovering one enemy shows only THAT enemy's reach. The all-enemies overlay
  // covers most of the board once anything with a bow is alive, which tells
  // you nothing about which threat is the one to answer.
  const o = E.occupant(st, t.x, t.y);
  view.threatFocus = (o && o.side === 'enemy' && o.alive) ? E.threatMap(st, o) : null;
  // the number moves to where your eyes are: a chip over the hovered target
  view.forecast = null;
  const sel = view.selected ? unitByUid(view.selected) : null;
  if (sel && o && o.side === 'enemy' && o.alive && (mode === 'attack' || mode === 'ability')) {
    const legal = (view.targetTiles || []).some(p => p.x === t.x && p.y === t.y);
    if (legal) {
      const ab = mode === 'ability' ? ABILITIES[armedAbility] : null;
      if (!ab || ab.dmg) {
        const prof = E.damageProfile(st, sel, o, ab ? { dmg: ab.dmg, pierce: ab.pierce } : {});
        view.forecast = { x: t.x, y: t.y, min: prof.min, max: prof.max,
          kill: prof.max >= o.hp, flank: prof.flanking };
      }
    }
  }
});
cv.addEventListener('mouseleave', () => { view.hover = null; view.path = null; view.forecast = null; view.threatFocus = null; });
cv.addEventListener('click', (ev) => { if (st) onBoardClick(canvasTile(ev)); });
cv.addEventListener('contextmenu', (ev) => { ev.preventDefault(); cancelMode(); });

function updateHoverPath(t) {
  view.path = null;
  view.pathDanger = false;
  if (mode !== 'move' || !view.selected) return;
  const u = unitByUid(view.selected);
  if (!u || !view.moveTiles) return;
  if (!view.moveTiles.some(m => m.x === t.x && m.y === t.y)) return;
  view.path = E.pathTo(st, u, t.x, t.y);
  // the verdict: can anything reach that tile next turn?
  const threat = view.threat || threatCache();
  view.pathDanger = threat ? threat.has(t.y * 16 + t.x) : false;
}

// threat is cheap but not free; cache it per round when the overlay is off
let tCache = null, tCacheKey = '';
function threatCache() {
  if (!st) return null;
  const key = st.round + ':' + st.phase + ':' + st.units.filter(u => u.alive).length;
  if (tCacheKey !== key) { tCache = E.threatMap(st); tCacheKey = key; }
  return tCache;
}

function unitByUid(uid) { return st.units.find(u => u.uid === uid && u.alive); }

function onBoardClick(t) {
  if (!E.inBounds(t.x, t.y)) return;
  const clicked = E.occupant(st, t.x, t.y);

  if (st.phase === 'deploy') {
    if (clicked && clicked.side === 'player') { view.selected = clicked.uid; syncUI(); return; }
    if (view.selected && st.deployZone.some(d => d.x === t.x && d.y === t.y)) {
      const u = unitByUid(view.selected);
      const other = E.occupant(st, t.x, t.y);
      if (other) { other.x = u.x; other.y = u.y; }
      u.x = t.x; u.y = t.y;
      syncUI();
    }
    return;
  }
  if (st.phase !== 'player') return;

  if (mode === 'ability' && armedAbility) {
    const legal = view.targetTiles || [];
    if (legal.some(p => p.x === t.x && p.y === t.y)) {
      if (touchMode && !(pendingTap && pendingTap.x === t.x && pendingTap.y === t.y && pendingTap.mode === 'ability')) {
        pendingTap = { x: t.x, y: t.y, mode: 'ability' };
        touchPreview(t);
        return;
      }
      pendingTap = null;
      const u = unitByUid(view.selected);
      const pick = legal.find(p => p.x === t.x && p.y === t.y);
      E.useAbility(st, u, armedAbility, t.x, t.y, pick.dir);
      afterAction(u);
      return;
    }
    cancelMode(); return;
  }
  if (mode === 'attack') {
    const legal = view.targetTiles || [];
    if (legal.some(p => p.x === t.x && p.y === t.y)) {
      if (touchMode && !(pendingTap && pendingTap.x === t.x && pendingTap.y === t.y && pendingTap.mode === 'attack')) {
        pendingTap = { x: t.x, y: t.y, mode: 'attack' };
        touchPreview(t);
        return;
      }
      pendingTap = null;
      const u = unitByUid(view.selected);
      const target = E.occupant(st, t.x, t.y)
        || { structure: true, x: t.x, y: t.y };
      E.basicAttack(st, u, target);
      afterAction(u);
      return;
    }
    cancelMode(); return;
  }

  if (touchMode && clicked && clicked.side === 'enemy') { touchPreview(t); return; }
  if (clicked && clicked.side === 'player' && !clicked.acted) { select(clicked.uid); return; }
  if (clicked && clicked.side === 'player') { view.selected = clicked.uid; mode = 'idle'; view.moveTiles = null; syncUI(); return; }

  if (mode === 'move' && view.selected) {
    const u = unitByUid(view.selected);
    if (view.moveTiles && view.moveTiles.some(m => m.x === t.x && m.y === t.y)) {
      E.moveUnit(st, u, t.x, t.y);
      view.moveTiles = null;
      mode = 'idle';
      syncUI();
      return;
    }
  }
}

function select(uid) {
  pendingTap = null;
  if (settings.sound !== false) play('select');
  view.selected = uid;
  const u = unitByUid(uid);
  mode = 'idle';
  view.targetTiles = null; armedAbility = null;
  if (u && !u.acted && !u.moved && st.phase === 'player') {
    mode = 'move';
    view.moveTiles = E.reachableTiles(st, u);
  } else {
    view.moveTiles = null;
  }
  syncUI();
}

function touchPreview(t) {
  view.hover = t;
  updateInspect(t);
  const o = E.occupant(st, t.x, t.y);
  view.threatFocus = (o && o.side === 'enemy' && o.alive) ? E.threatMap(st, o) : null;
  view.forecast = null;
  const sel = view.selected ? unitByUid(view.selected) : null;
  if (sel && o && o.side === 'enemy' && o.alive) {
    const ab = mode === 'ability' ? ABILITIES[armedAbility] : null;
    if (!ab || ab.dmg) {
      const prof = E.damageProfile(st, sel, o, ab ? { dmg: ab.dmg, pierce: ab.pierce } : {});
      view.forecast = { x: t.x, y: t.y, min: prof.min, max: prof.max,
        kill: prof.max >= o.hp, flank: prof.flanking, confirm: true };
    }
  }
  E.logLine(st, 'Tap again to confirm.');
  syncUI();
}

function cancelMode() {
  pendingTap = null;
  armedAbility = null;
  view.targetTiles = null;
  const u = view.selected ? unitByUid(view.selected) : null;
  if (u && !u.acted && !u.moved && st.phase === 'player') {
    mode = 'move';
    view.moveTiles = E.reachableTiles(st, u);
  } else { mode = 'idle'; view.moveTiles = null; }
  syncUI();
}

function afterAction(u) {
  view.targetTiles = null; armedAbility = null; view.moveTiles = null; mode = 'idle';
  if (u && !u.acted) { select(u.uid); return; }
  if (st.phase === 'won' || st.phase === 'lost') { endBattle(); return; }
  const next = st.units.find(x => x.alive && x.side === 'player' && !x.acted);
  if (next) select(next.uid);
  else {
    view.selected = null; syncUI();
    if (settings.autoEnd !== false && !tutorialActive()) {
      clearTimeout(afterAction.tk);
      afterAction.tk = setTimeout(() => {
        if (st && st.phase === 'player' &&
          st.units.filter(x => x.alive && x.side === 'player').every(x => x.acted)) endTurn();
      }, 550);
    }
  }
  if (settings.threatDefault) view.threat = E.threatMap(st);
}

function armAttack() {
  if (!st || st.phase !== 'player') return;
  const u = unitByUid(view.selected);
  if (!u || u.acted) return;
  if (u.usesLoad && !u.loaded && !u.freeShot) return;
  mode = 'attack';
  view.moveTiles = null;
  view.targetTiles = E.attackTargets(st, u).map(t => ({ x: t.x, y: t.y }));
  view.targetColour = '#c25a3e';
  syncUI();
}

function armAbility(aid) {
  if (!aid || !st || st.phase !== 'player') return;
  const u = unitByUid(view.selected);
  if (!u || u.acted || !E.abilityReady(u, aid, st)) return;
  const ab = ABILITIES[aid];
  if (ab.target === 'self') {
    E.useAbility(st, u, aid, u.x, u.y, null);
    afterAction(u);
    return;
  }
  mode = 'ability';
  armedAbility = aid;
  view.moveTiles = null;
  view.targetTiles = E.abilityTargets(st, u, aid);
  view.targetColour = ab.kind === 'heal' || ab.kind === 'buff' || ab.kind === 'cleanse' || ab.kind === 'martyr'
    ? '#6d9ec0' : '#e08a3c';
  syncUI();
}

function endTurn() {
  if (!st) return;
  if (st.phase === 'deploy') {
    E.startPlayerPhase(st);
    if (settings.threatDefault) view.threat = E.threatMap(st);
    const first = st.units.find(u => u.alive && u.side === 'player');
    if (first) select(first.uid);
    syncUI();
    return;
  }
  if (st.phase !== 'player') return;
  view.selected = null; view.moveTiles = null; view.targetTiles = null; mode = 'idle';
  E.endPlayerPhase(st);
  view.threat = null;
  enemyTimer = 0;
  phaseSweep('ROUND ' + st.round + ' — THEIRS');
  syncUI();
}

// ================================================================ battle UI
function syncUI() {
  if (!st) return;
  // party list
  const box = $('party');
  box.innerHTML = '';
  for (const u of st.units.filter(x => x.side === 'player')) {
    const row = document.createElement('div');
    row.className = 'unitRow' + (view.selected === u.uid ? ' sel' : '') + ((u.acted || !u.alive) ? ' done' : '');
    const frac = Math.max(0, u.hp / u.maxHp);
    row.innerHTML =
      '<img class="pimg' + (u.alive && u.hp / u.maxHp < 0.35 ? ' hurt' : '') + '" src="' + portraitURL(u.defId, u.custom, 40, 48) + '" alt="">' +
      '<div style="flex:1 1 auto;min-width:0">' +
      '<div class="nm">' + (u.alive ? u.name : '<s>' + u.name + '</s>') + '</div>' +
      '<div class="cls" style="color:' + (u.def.colour || 'var(--ink-far)') + '">' + u.def.name + (u.usesLoad ? (u.loaded || u.freeShot ? ' · loaded' : ' · empty') : '') + '</div>' +
      '</div>' +
      '<div class="hpbar' + (frac <= 0.34 ? ' low' : '') + '"><i style="width:' + (frac * 100) + '%"></i></div>' +
      '<div class="hpnum mono">' + Math.max(0, u.hp) + '/' + u.maxHp + '</div>';
    if (u.alive) row.addEventListener('click', () => select(u.uid));
    box.appendChild(row);
  }

  // the company's shared mana pool
  if (st.manaMax && st.manaMax < 90) {
    const mrow = document.createElement('div');
    mrow.className = 'abLine mono';
    mrow.style.cssText = 'padding:4px 6px;color:#8fb4d8;letter-spacing:.4px';
    mrow.textContent = 'Mana ' + st.mana + ' / ' + st.manaMax;
    mrow.title = 'Shared by the whole company. Abilities spend it; camps, the quartermaster, and each new floor restore it.';
    box.appendChild(mrow);
  }

  // ability panel
  const u = view.selected ? st.units.find(x => x.uid === view.selected) : null;
  $('selName').textContent = u ? (u.name + ' — ' + u.def.name) : 'Nobody selected';
  const ab = $('abilities');
  ab.innerHTML = '';
  if (st.phase === 'deploy') {
    const b = document.createElement('button');
    b.textContent = 'Begin the assault';
    b.addEventListener('click', endTurn);
    ab.appendChild(b);
    const hint = document.createElement('div');
    hint.className = 'abLine';
    hint.textContent = 'Click a soldier, then a lit tile, to set the line.';
    ab.appendChild(hint);
  } else if (u && u.alive && u.side === 'player') {
    const KIND_GLYPH = { attack: '⚔', pull: '⥉', cone: '⚔', bomb: '◉',
      heal: '✚', cleanse: '✚', buff: '✦', aura_buff: '✦', aura_guard: '⛨',
      oath: '⛨', martyr: '❤', blink: '↯', place_barricade: '⛨' };
    const KIND_COL = { attack: '#c25a3e', pull: '#c25a3e', cone: '#c25a3e', bomb: '#e0894a',
      heal: '#7f9b52', cleanse: '#7f9b52', buff: '#cbab63', aura_buff: '#cbab63', aura_guard: '#7d9ec4',
      oath: '#7d9ec4', martyr: '#d06a5a', blink: '#b08ad0', place_barricade: '#7d9ec4' };
    const mk = (label, sub, on, armed, fn, preview, kindCol) => {
      const b = document.createElement('button');
      b.className = 'abBtn' + (armed ? ' armed' : '');
      b.style.borderLeft = '3px solid ' + (kindCol || '#4a3d31');
      const glyph = arguments.length > 7 && arguments[7] ? '<span style="color:' + (kindCol || '#8a7d6a') + ';margin-right:6px">' + arguments[7] + '</span>' : '';
      b.innerHTML = '<b>' + glyph + label + '</b>' + (sub ? '<span class="sub">' + sub + '</span>' : '');
      b.disabled = !on;
      if (on) b.addEventListener('click', fn);
      if (preview) {
        b.addEventListener('mouseenter', () => { view.hoverPreview = preview(); });
        b.addEventListener('mouseleave', () => { view.hoverPreview = null; });
      }
      ab.appendChild(b);
    };
    const acted = u.acted || st.phase !== 'player';
    const loadOk = !u.usesLoad || u.loaded || u.freeShot;
    mk('Attack [A]',
      'Range ' + (u.minRange > 1 ? u.minRange + '–' : '') + u.range + ' · ' + u.atk[0] + '–' + u.atk[1] + ' damage' + (loadOk ? '' : ' · NEEDS RELOADING'),
      !acted && loadOk, mode === 'attack', armAttack,
      () => E.attackTargets(st, u).map(x => ({ x: x.x, y: x.y })), '#c25a3e', '⚔');
    u.abilities.forEach((aid, i) => {
      const a = ABILITIES[aid];
      const cd = u.cds[aid] || 0;
      const ch = a.charges ? (u.charges[aid] || 0) : null;
      const short = a.mana ? st.mana < a.mana : false;
      const sub = kw(a.desc) + (a.mana ? ' · ' + a.mana + ' mana' + (short ? ' — NOT ENOUGH' : '') : '') + (cd > 0 ? ' · ready in ' + cd : '') + (ch != null ? ' · ' + ch + ' left' : '');
      mk(a.name + ' [' + (i + 1) + ']', sub, !acted && E.abilityReady(u, aid, st),
        armedAbility === aid, () => armAbility(aid),
        () => E.abilityTargets(st, u, aid), KIND_COL[a.kind], KIND_GLYPH[a.kind]);
    });
    if (u.usesLoad) mk('Reload [R]', 'Spend the action winding the bow.', !acted && !u.loaded, false, () => { E.reload(st, u); afterAction(u); });
    if (u.moved && !u.acted) mk('Take it back [U]', 'Undo the move.', true, false, () => {
      u.x = u.startX; u.y = u.startY; u.moved = false; u.anim = null; u.lunge = null; select(u.uid);
    });
    mk('Hold [W]', 'End this soldier’s turn.', !acted, false, () => { E.wait(st, u); afterAction(u); });
  }

  // log
  const lg = $('log');
  lg.innerHTML = st.log.slice(-6).map(l => '<div>' + l + '</div>').join('');
  lg.scrollTop = lg.scrollHeight;

  $('phaseTag').textContent = st.phase === 'deploy' ? 'Set the line'
    : st.phase === 'player' ? 'Round ' + st.round + ' · your move'
      : st.phase === 'enemy' ? 'Round ' + st.round + ' · they move' : '';
  $('phaseTag').style.color = st.phase === 'enemy' ? '#b8483a' : '#8b8072';
  cv.style.cursor = (mode === 'attack' || mode === 'ability')
    ? 'url("data:image/svg+xml,' + CROSSHAIR_SVG + '") 13 13, crosshair' : '';
  $('endBtn').textContent = st.phase === 'deploy' ? 'Begin' : 'End Turn';
  $('endBtn').disabled = st.phase === 'enemy';
  $('threatBtn').style.borderColor = view.threat ? '#c2703a' : '';
}

function updateInspect(t) {
  const el = $('inspect');
  if (!st || !E.inBounds(t.x, t.y)) { el.textContent = 'Hover a tile.'; return; }
  const o = E.occupant(st, t.x, t.y);
  const tile = st.grid[t.y][t.x];
  if (o) {
    let s = '<b>' + o.name + '</b> — ' + o.def.name + '<br>';
    s += '<span class="mono">' + Math.max(0, o.hp) + '/' + o.maxHp + ' hp · ' + o.armor + ' armour · '
      + o.mov + ' move · hits ' + o.atk[0] + '–' + o.atk[1] + '</span><br>';
    if (o.windup) s += '<span class="warn">Winding up: ' + o.windup.ab.name + ' — the marked tiles get hit next turn.</span><br>';
    const sel = view.selected ? unitByUid(view.selected) : null;
    if (settings.showForecast && sel && sel.side === 'player' && o.side === 'enemy' && !sel.acted) {
      const d = Math.abs(sel.x - o.x) + Math.abs(sel.y - o.y);
      if (d >= sel.minRange && d <= sel.range) {
        const p = E.damageProfile(st, sel, o, {});
        s += '<span style="color:#cbb27a">Your attack: ' + p.min + '–' + p.max + (p.flanking ? ' (FLANKED)' : '')
          + (p.max >= o.hp ? ' — could finish it' : '') + '</span><br>';
      }
    }
    if (o.statuses.length) s += '<span class="mono" style="color:#8b8072">' + o.statuses.map(x => '<u class="kw" title="' + (KEYWORDS[x.id] || '') + '">' + x.id + '</u>').join(', ') + '</span><br>';
    s += '<i style="color:#7d7264">' + o.def.blurb + '</i>';
    if (o.side === 'enemy') s += '<br><button class="ledgerBtn" style="margin-top:6px;padding:4px 10px;font-size:11px">Read the Ledger</button>';
    el.innerHTML = s;
    const lb = el.querySelector('.ledgerBtn');
    if (lb) lb.addEventListener('click', (ev) => { ev.stopPropagation(); screenGlossary(() => showScreen('battle')); });
    return;
  }
  if (tile.bar) { el.innerHTML = '<b>Barricade</b><br><span class="mono">' + tile.bar.hp + '/' + tile.bar.maxHp + '</span><br><i style="color:#7d7264">Blocks movement and line of sight. Break it or go around.</i>'; return; }
  if (tile.t === E.T.WALL) {
    const pn = tile.prop && PROP_NAMES[tile.prop];
    if (pn) { el.innerHTML = '<b>' + pn.name + '</b><br><i style="color:#7d7264">' + pn.blurb + ' Blocks movement and sight.</i>'; return; }
    el.innerHTML = '<b>Fallen masonry</b><br><i style="color:#7d7264">Blocks movement and sight. A charge will open it.</i>'; return;
  }
  if (tile.t === E.T.PIT) { el.innerHTML = '<b>Shaft</b><br><i style="color:#7d7264">Nothing crosses it. Anything pulled in does not come back.</i>'; return; }
  if (tile.t === E.T.MUD) { el.innerHTML = '<b>Sump water</b><br><i style="color:#7d7264">Costs two movement to wade.</i>'; return; }
  el.innerHTML = '<b>Flagstone</b><br><i style="color:#7d7264">Cold, and someone died on it.</i>';
}

// ============================================================ battle result
function endBattle() {
  const won = st.phase === 'won';
  // the Ledger of Foes: every foe that took the field is now a known quantity,
  // and every one that fell is another mark against its kind
  for (const u of st.units.filter(x => x.side === 'enemy')) {
    if (!meta.seenFoes.includes(u.defId)) meta.seenFoes.push(u.defId);
    if (!u.alive) meta.foeKills[u.defId] = (meta.foeKills[u.defId] || 0) + 1;
  }
  saveMeta();
  // per-soldier numbers for the battle report, captured before st is dropped
  const report = {
    rounds: st.round,
    kind: pendingNode ? pendingNode.type : 'fight',
    soldiers: st.units.filter(x => x.side === 'player').map(u => ({
      name: u.name, defId: u.defId, custom: u.custom, alive: u.alive,
      dealt: u.dmgDealt, taken: u.dmgTaken, kills: u.kills,
    })),
  };
  // write survivors back to the run
  const dead = [];
  for (const u of st.units.filter(x => x.side === 'player')) {
    const m = run.party.find(p => p.id === u.persistId);
    if (!m) continue;
    if (!u.alive) { dead.push(m); continue; }
    m.hp = Math.max(1, u.hp);
    m.kills += u.kills;
  }
  run.party = run.party.filter(p => !dead.includes(p));
  run.mana = Math.min(run.manaMax, st.mana != null ? st.mana : run.mana);
  // the epitaph needs the whole company, not just who is left
  for (const d of dead) {
    run.fallen = run.fallen || [];
    run.fallen.push({ name: d.name, defId: d.defId, custom: d.custom, floor: run.floorIdx + 1 });
    recordFate(d, 'fell', run.floorIdx + 1);
  }
  if (dead.length) tip('death');
  run.losses += dead.length;
  run.kills += st.units.filter(u => u.side === 'enemy' && !u.alive).length;

  if (!won || !run.party.length) { runLost(dead); return; }

  const floor = FLOORS[run.floorIdx];
  let gold = run.rng.int(floor.gold[0], floor.gold[1]);
  if (pendingNode.type === 'elite') gold = Math.round(gold * 1.6);
  if (pendingNode.type === 'boss') gold = Math.round(gold * 2.2);
  if (run.relics.includes('coin')) gold += 30;
  run.gold += gold;
  if (run.relics.includes('ironrations')) for (const p of run.party) p.hp = Math.min(p.maxHp, p.hp + 6);
  if (run.captain && run.captain.cfg && run.captain.cfg.origin === 'bonesetter') {
    const capM = run.party.find(p => p.defId === 'captain');
    if (capM) capM.hp = Math.min(capM.maxHp, capM.hp + 4);
  }
  run.fights++;

  screenBattleReport(report, gold, dead);
}

// A run should end with a RECORD: the company, its fates, what it carried.
function renderEpitaph(banked, won) {
  const box = $('mChoices');
  box.innerHTML = '';
  const roll = [];
  for (const p of run.party) roll.push({ name: p.name, defId: p.defId, custom: p.custom, alive: won || false, kills: p.kills, note: won ? 'Walked back up' : 'Lost in the dark' });
  for (const f of (run.fallen || [])) roll.push({ name: f.name, defId: f.defId, custom: f.custom, alive: false, kills: null, note: 'Fell on floor ' + f.floor });
  for (const m2 of roll) {
    const d = document.createElement('div');
    d.className = 'choice locked';
    d.style.opacity = m2.alive ? '1' : '.5';
    d.innerHTML =
      '<img class="cardP" src="' + portraitURL(m2.defId, m2.custom, 84, 100) + '" alt="">' +
      '<h3>' + (m2.alive ? m2.name : '<s>' + m2.name + '</s>') + '</h3>' +
      '<div class="role">' + m2.note + '</div>' +
      (m2.kills != null ? '<div class="stats mono">' + m2.kills + ' kills</div>' : '');
    box.appendChild(d);
  }
  const tal = document.createElement('div');
  tal.className = 'choice locked';
  tal.style.position = 'relative';
  tal.innerHTML = '<div class="stamp ' + (won ? 'won' : 'lost') + '">' + (won ? 'RETURNED' : 'LOST') + '</div>' +
    '<h3>+' + banked + ' tallies</h3><div class="role">Banked</div>' +
    '<div class="stats mono">' + run.fights + ' battles · ' + run.kills + ' slain</div>' +
    (run.relics.length ? '<div class="blurb">Carried: ' + run.relics.map(rid => (RELICS.find(x => x.id === rid) || {}).name).join(', ') + '</div>' : '<div class="blurb">Carried nothing but orders.</div>');
  box.appendChild(tal);
}

// ------------------------------------------------------------- the prisoner
function screenPrisoner() {
  showScreen('modal');
  const full = run.party.length >= 4;
  if (full) tip('fullparty');
  let pname, roles, hpFrac;
  if (aftermath && aftermath.node === pendingNode && aftermath.pname) {
    ({ pname, roles, hpFrac } = aftermath);
  } else {
    pname = run.rng.pick(NAMES);
    const pool = run.rng.shuffle(meta.classes.slice());
    roles = [];
    for (let i = 0; i < 3 && i < pool.length; i++) roles.push(pool[i]);
    while (roles.length < 3) roles.push(pool[0]);
    hpFrac = run.rng.int(55, 95) / 100;
    aftermath = { node: pendingNode, pname, roles, hpFrac };
  }
  $('mEyebrow').textContent = full ? 'A prisoner — the company is full at four' : 'A prisoner — choose what they were';
  $('mTitle').textContent = 'CHAINED IN THE DARK';
  $('mLede').innerHTML = 'Someone is shackled to the wall, half-starved but breathing. They say their name is <b>' + pname + '</b>. '
    + 'They do not say what they were before the siege — <b>you decide what to believe.</b>';
  const box = $('mChoices');
  box.innerHTML = '';
  for (const defId of roles) {
    const c = CLASSES[defId];
    const hp = Math.max(4, Math.round(c.hp * hpFrac));
    const d = document.createElement('div');
    d.className = 'choice';
    d.innerHTML =
      '<img class="cardP" src="' + portraitURL(defId, null, 84, 100) + '" alt="">' +
      '<h3>“I was a ' + c.name.toLowerCase() + '.”</h3>' +
      '<div class="role" style="color:' + (c.colour || 'var(--torch)') + '">' + c.name + ' · ' + c.role + '</div>' +
      '<div class="stats mono">' + hp + '/' + c.hp + ' hp · ' + c.armor + ' armour · ' + c.mov + ' move</div>' +
      c.abilities.map(a => '<div class="abLine"><b>' + ABILITIES[a].name + '</b> — ' + kw(ABILITIES[a].desc) + '</div>').join('') +
      '<div class="blurb" style="margin-top:8px">' + c.blurb + '</div>';
    d.addEventListener('click', () => {
      const member = { id: uidCounter++, defId, name: pname, hp, maxHp: c.hp, kills: 0 };
      if (full) { chooseWhoToLeave({ defId, name: pname, hp }); return; }
      run.party.push(member);
      if (c.reload) tip('reloadR');
      if (settings.sound !== false) play('recruit');
      advanceFrom(pendingNode);
    });
    box.appendChild(d);
  }
  $('mFoot').innerHTML = '';
  const skip = document.createElement('button');
  skip.textContent = 'Leave them chained (+30 gold from their effects)';
  skip.addEventListener('click', () => { run.gold += 30; play('coin'); advanceFrom(pendingNode); });
  $('mFoot').appendChild(skip);
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = full
    ? 'Taking them means leaving one of yours. That is a death, not a transfer.'
    : 'Battles pay gold. Prisoners are the only way the company grows.';
  $('mFoot').appendChild(hint);
}

// ---------------------------------------------------------- the battle report
function screenBattleReport(report, gold, dead) {
  showScreen('modal');
  $('mEyebrow').textContent = 'After action — ' + report.rounds + ' round' + (report.rounds === 1 ? '' : 's');
  $('mTitle').textContent = 'THE DUST SETTLES';
  const mvp = report.soldiers.slice().sort((a, b) => b.dealt - a.dealt)[0];
  $('mLede').textContent = mvp && mvp.dealt > 0
    ? mvp.name + ' did the worst of it.'
    : 'Nobody will sing about this one.';
  const box = $('mChoices');
  box.innerHTML = '';
  for (const sRow of report.soldiers) {
    const d = document.createElement('div');
    d.className = 'choice locked';
    d.style.opacity = sRow.alive ? '1' : '.45';
    d.innerHTML =
      '<img class="cardP" src="' + portraitURL(sRow.defId, sRow.custom, 84, 100) + '" alt="">' +
      '<h3>' + (sRow.alive ? sRow.name : '<s>' + sRow.name + '</s>') + (mvp === sRow && sRow.dealt > 0 ? '<span class="costTag">⚔ most damage</span>' : '') + '</h3>' +
      '<div class="role" style="color:' + ((classOf(sRow).colour) || 'var(--torch)') + '">' + (sRow.alive ? 'Stood their ground' : 'Fell here') + '</div>' +
      '<div class="stats mono">dealt ' + sRow.dealt + ' · took ' + sRow.taken + ' · slew ' + sRow.kills + '</div>';
    box.appendChild(d);
  }
  $('mFoot').innerHTML = '';
  const go = document.createElement('button');
  go.className = 'primary';
  go.textContent = 'Take the gold (+' + gold + ') and move on';
  go.addEventListener('click', () => { tip('gold'); advanceFrom(pendingNode); });
  $('mFoot').appendChild(go);
  const gh = document.createElement('div');
  gh.className = 'hint';
  gh.textContent = 'Gold buys relics, healing, and plate at the quartermaster — and dies with the run.';
  $('mFoot').appendChild(gh);
}

let aftermath = null; // survives Never Mind round-trips

// (post-battle recruit offers removed: prisoners are the only source)


function chooseWhoToLeave(offer) {
  const c = CLASSES[offer.defId];
  $('mEyebrow').textContent = 'Recruit — the company is full';
  $('mTitle').textContent = 'SOMEONE HAS TO STAY';
  $('mLede').textContent = 'Four is all the rations stretch to. Who do you leave in the dark?';
  const box = $('mChoices');
  box.innerHTML = '';
  for (const p of run.party) {
    const pc = classOf(p);
    const isCap = p.defId === 'captain';
    const d = document.createElement('div');
    d.className = 'choice' + (isCap ? ' locked' : '');
    d.innerHTML = '<img class="cardP" src="' + portraitURL(p.defId, p.custom, 84, 100) + '" alt="">' +
      '<h3>' + p.name + '</h3><div class="role">' + pc.name + (isCap ? ' · you' : '') + '</div>' +
      '<div class="stats mono">' + p.hp + '/' + p.maxHp + ' hp · ' + p.kills + ' kills</div>' +
      '<div class="blurb">' + (isCap ? 'You signed for the company. You do not get to stay behind.' : 'Leaving them here ends them as surely as a blade.') + '</div>';
    if (isCap) { box.appendChild(d); continue; }
    d.addEventListener('click', () => {
      recordFate(p, 'left', run.floorIdx + 1);
      run.party = run.party.filter(x => x !== p);
      run.party.push({ id: uidCounter++, defId: offer.defId, name: offer.name, hp: offer.hp, maxHp: c.hp, kills: 0 });
      advanceFrom(pendingNode);
    });
    box.appendChild(d);
  }
  const foot = $('mFoot');
  foot.innerHTML = '';
  const back = document.createElement('button');
  back.textContent = 'Never mind';
  back.addEventListener('click', () => screenPrisoner());
  foot.appendChild(back);
}

// ================================================================== camps
function screenCamp() {
  showScreen('modal');
  $('mEyebrow').textContent = 'Rest — one choice only';
  $('mTitle').textContent = 'A CAMP';
  $('mLede').textContent = 'Someone kept a fire going here. Sit down. Not for long.';
  const box = $('mChoices');
  box.innerHTML = '';
  const heal = run.relics.includes('charts') ? 0.6 : 0.45;
  const opt = (title, sub, blurb, fn) => {
    const d = document.createElement('div');
    d.className = 'choice';
    d.innerHTML = '<h3>' + title + '</h3><div class="role">' + sub + '</div><div class="blurb">' + blurb + '</div>';
    d.addEventListener('click', fn);
    box.appendChild(d);
  };
  opt('Sleep', 'Heal everyone, +5 mana', 'Every soldier recovers ' + Math.round(heal * 100) + '% of their maximum, and the company recovers 5 mana.', () => {
    for (const p of run.party) p.hp = Math.min(p.maxHp, Math.round(p.hp + p.maxHp * heal));
    run.mana = Math.min(run.manaMax, run.mana + 5);
    advanceFrom(pendingNode);
  });
  opt('Drill', 'One soldier, +6 maximum health', 'Permanent for the rest of the dig. Pick the one who keeps surviving.', () => {
    $('mEyebrow').textContent = 'Rest — pick a soldier';
  $('mTitle').textContent = 'WHO DRILLS';
    $('mLede').textContent = '';
    box.innerHTML = '';
    for (const p of run.party) {
      const pc = classOf(p);
      const d = document.createElement('div');
      d.className = 'choice';
      d.innerHTML = '<h3>' + p.name + '</h3><div class="role">' + pc.name + '</div><div class="stats mono">' + p.hp + '/' + p.maxHp + ' hp</div>';
      d.addEventListener('click', () => {
        p.maxHp += 6; p.hp += 6;
        advanceFrom(pendingNode);
      });
      box.appendChild(d);
    }
  });
  opt('Strip the camp', '+70 gold', 'There is nothing here worth sentiment. Take the metal and move on.', () => {
    run.gold += 70;
    advanceFrom(pendingNode);
  });
  $('mFoot').innerHTML = '<div class="hint">Camps do not come round often.</div>';
}

// ================================================================== spoils
function screenCache() {
  showScreen('modal');
  $('mEyebrow').textContent = 'Relic — you carry five at most';
  $('mTitle').textContent = 'SPOIL';
  $('mLede').textContent = 'Someone cached this and never came back for it.';
  const have = new Set(run.relics);
  const avail = RELICS.filter(r => meta.relics.includes(r.id) && !have.has(r.id));
  const offers = run.rng.shuffle(avail).slice(0, 3);
  const box = $('mChoices');
  box.innerHTML = '';
  if (!offers.length) {
    box.innerHTML = '<div class="choice locked"><h3>Empty</h3><div class="blurb">Picked clean years ago.</div></div>';
  }
  for (const r of offers) {
    const d = document.createElement('div');
    d.className = 'choice';
    d.innerHTML = '<h3>' + r.name + '</h3><div class="role">Relic</div><div class="blurb">' + r.text + '</div>';
    d.addEventListener('click', () => takeRelic(r.id));
    box.appendChild(d);
  }
  $('mFoot').innerHTML = '';
  const skip = document.createElement('button');
  skip.textContent = 'Take the coin instead (+80 gold)';
  skip.addEventListener('click', () => { run.gold += 80; advanceFrom(pendingNode); });
  $('mFoot').appendChild(skip);
}

function takeRelic(rid) {
  if (run.relics.length >= 5) {
    $('mEyebrow').textContent = 'Relic — swap or walk away';
  $('mTitle').textContent = 'FIVE IS ALL YOU CAN CARRY';
    $('mLede').textContent = 'Something has to go back on the floor.';
    const box = $('mChoices');
    box.innerHTML = '';
    for (const oldId of run.relics) {
      const o = RELICS.find(x => x.id === oldId);
      const d = document.createElement('div');
      d.className = 'choice';
      d.innerHTML = '<h3>' + o.name + '</h3><div class="role">Drop this</div><div class="blurb">' + o.text + '</div>';
      d.addEventListener('click', () => {
        run.relics = run.relics.filter(x => x !== oldId);
        run.relics.push(rid);
        advanceFrom(pendingNode);
      });
      box.appendChild(d);
    }
    return;
  }
  run.relics.push(rid);
  advanceFrom(pendingNode);
}

// ============================================================ quartermaster
function screenVendor() {
  showScreen('modal');
  $('mEyebrow').textContent = 'Spend gold — it does not carry between runs';
  $('mTitle').textContent = 'THE QUARTERMASTER';
  $('mLede').textContent = 'Still keeping the books. Still charging.';
  const disc = run.relics.includes('charts') ? 0.8 : 1;
  const have = new Set(run.relics);
  const avail = RELICS.filter(r => meta.relics.includes(r.id) && !have.has(r.id));
  const offers = run.rng.shuffle(avail).slice(0, 2);
  const bought = new Set(); // never mark the shared data objects
  const render = () => {
    const box = $('mChoices');
    box.innerHTML = '';
    for (const r of offers) {
      if (bought.has(r.id)) continue;
      const price = Math.round(r.cost * disc);
      const d = document.createElement('div');
      const can = run.gold >= price;
      d.className = 'choice' + (can ? '' : ' locked');
      d.innerHTML = '<h3>' + r.name + '<span class="costTag">' + price + 'g</span></h3><div class="role">Relic</div><div class="blurb">' + r.text + '</div>';
      if (can) d.addEventListener('click', () => { run.gold -= price; bought.add(r.id); takeRelicVendor(r.id, render); });
      box.appendChild(d);
    }
    const priceHeal = Math.round(60 * disc);
    const d2 = document.createElement('div');
    d2.className = 'choice' + (run.gold >= priceHeal ? '' : ' locked');
    d2.innerHTML = '<h3>Surgery<span class="costTag">' + priceHeal + 'g</span></h3><div class="role">Service</div><div class="blurb">Everyone back to full. He does not ask what happened.</div>';
    if (run.gold >= priceHeal) d2.addEventListener('click', () => {
      run.gold -= priceHeal;
      for (const p of run.party) p.hp = p.maxHp;
      render();
    });
    box.appendChild(d2);

    const priceDrill = Math.round(90 * disc);
    const d3 = document.createElement('div');
    d3.className = 'choice' + (run.gold >= priceDrill ? '' : ' locked');
    d3.innerHTML = '<h3>Requisition<span class="costTag">' + priceDrill + 'g</span></h3><div class="role">Service</div><div class="blurb">Plate and padding for the whole company: +4 maximum health each.</div>';
    if (run.gold >= priceDrill) d3.addEventListener('click', () => {
      run.gold -= priceDrill;
      for (const p of run.party) { p.maxHp += 4; p.hp += 4; }
      render();
    });
    box.appendChild(d3);

    const priceMana = Math.round(45 * disc);
    const d4 = document.createElement('div');
    const manaFull = run.mana >= run.manaMax;
    d4.className = 'choice' + (run.gold >= priceMana && !manaFull ? '' : ' locked');
    d4.innerHTML = '<h3>Powder &amp; Incense<span class="costTag">' + priceMana + 'g</span></h3><div class="role">Service</div><div class="blurb">' + (manaFull ? 'The company is at full mana already.' : 'Restore 6 mana. He keeps the good stuff under the counter.') + '</div>';
    if (run.gold >= priceMana && !manaFull) d4.addEventListener('click', () => {
      run.gold -= priceMana;
      run.mana = Math.min(run.manaMax, run.mana + 6);
      render();
    });
    box.appendChild(d4);

    $('mFoot').innerHTML = '<div class="hint">Gold: <span class="tally">' + run.gold + '</span> · Mana: <span class="tally">' + run.mana + '/' + run.manaMax + '</span></div>';
    const go = document.createElement('button');
    go.textContent = 'Move on';
    go.addEventListener('click', () => { advanceFrom(pendingNode); });
    $('mFoot').prepend(go);
  };
  render();
}

function takeRelicVendor(rid, render) {
  if (run.relics.length >= 5) { takeRelic(rid); return; }
  run.relics.push(rid);
  render();
}

// ============================================================== run ending
function runLost(dead) {
  clearRun();
  for (const p of run.party) recordFate(p, 'lost', run.floorIdx + 1);
  const banked = Math.round(run.gold * 0.35) + run.kills * 3 + run.floorIdx * 40 + run.fights * 8;
  meta.tallies += banked;
  meta.deepest = Math.max(meta.deepest, run.floorIdx + 1);
  saveMeta();
  showScreen('modal');
  tip('tallies');
  $('mEyebrow').textContent = 'The run is over';
  if (!meta.lossCoached) {
    meta.lossCoached = true; saveMeta();
    setTimeout(() => {
      const foot = $('mFoot');
      const adv = document.createElement('div');
      adv.className = 'hint';
      adv.style.cssText = 'flex-basis:100%;color:var(--ink-dim)';
      adv.textContent = 'Most companies die standing on orange tiles, or trading hits they could have walked away from. The Ledger of Foes reads free.';
      foot.appendChild(adv);
      if (settings.difficulty === 'regular') {
        const soft = document.createElement('button');
        soft.textContent = 'Try Merciful (fewer foes, softer hits)';
        soft.addEventListener('click', () => { settings.difficulty = 'merciful'; saveSettings(); soft.textContent = 'Merciful set for the next dig'; soft.disabled = true; });
        foot.appendChild(soft);
      }
    }, 50);
  }
  $('mTitle').textContent = 'THE COMPANY IS GONE';
  $('mLede').textContent = 'Floor ' + (run.floorIdx + 1) + '. ' + run.kills + ' of theirs, ' + run.losses + ' of yours. '
    + 'Somebody will scratch the tally on the wall by the stair.';
  renderEpitaph(banked, false);
  $('mFoot').innerHTML = '';
  const again = document.createElement('button');
  again.textContent = 'Send another company';
  again.addEventListener('click', screenCreator);
  const muster = document.createElement('button');
  muster.textContent = 'Unlocks';
  muster.addEventListener('click', screenUnlocks);
  const home = document.createElement('button');
  home.textContent = 'Back to the surface';
  home.addEventListener('click', goTitle);
  $('mFoot').append(again, muster, home);
}

function runWon() {
  clearRun();
  for (const p of run.party) recordFate(p, 'returned', 3);
  if (settings.sound !== false) play('bell');
  const banked = Math.round(run.gold * 0.5) + run.kills * 4 + 200;
  meta.tallies += banked; meta.wins++; meta.deepest = 3;
  saveMeta();
  showScreen('modal');
  $('mEyebrow').textContent = 'You got out';
  $('mTitle').textContent = 'THE COUNTERMINE ENDS';
  $('mLede').textContent = 'It ends in a room neither army dug, and the digging stops. '
    + run.party.map(p => p.name).join(', ') + ' walk back up.';
  renderEpitaph(banked, true);
  $('mFoot').innerHTML = '';
  const again = document.createElement('button');
  again.textContent = 'Go down again';
  again.addEventListener('click', screenCreator);
  const home = document.createElement('button');
  home.textContent = 'The surface';
  home.addEventListener('click', goTitle);
  $('mFoot').append(again, home);
}

// ================================================================ the roster
function screenUnlocks() {
  showScreen('modal');
  const render = () => {
    $('mEyebrow').textContent = 'Spend tallies — permanent, between runs';
    $('mTitle').textContent = 'UNLOCKS';
    $('mLede').innerHTML = 'You bank <b>tallies</b> when a run ends. Spending them here adds classes and relics '
      + 'to what future runs can find — more OPTIONS in the dark, never raw power. '
      + 'You have <span class="tally">' + meta.tallies + '</span>.';
    const box = $('mChoices');
    box.innerHTML = '';

    const section = (label) => {
      const h = document.createElement('div');
      h.className = 'rosterSection';
      h.innerHTML = '<span>' + label + '</span>';
      box.appendChild(h);
    };

    // ---- classes: who can be found down there
    section('Classes of the Company');
    for (const key of Object.keys(CLASSES)) {
      const c = CLASSES[key];
      const owned = meta.classes.includes(key);
      const can = !owned && c.locked && meta.tallies >= c.cost;
      const d = document.createElement('div');
      d.className = 'choice' + (owned || !can ? ' locked' : '');
      if (!owned && c.locked) d.style.opacity = can ? '1' : '.55';
      d.innerHTML =
        '<img class="cardP" style="border-color:' + (c.colour || '#3c3128') + '" src="' + portraitURL(key, null, 84, 100) + '" alt="">' +
        '<h3>' + c.name + (owned || !c.locked ? '' : '<span class="costTag">' + c.cost + ' tallies</span>') + '</h3>' +
        '<div class="role" style="color:' + (c.colour || 'var(--torch)') + '">' + c.role + ' · ' +
        (owned ? 'in the recruit pool' : 'click to unlock') + '</div>' +
        '<div class="stats mono">' + c.hp + ' hp · ' + c.armor + ' armour · ' + c.mov + ' move · hits ' + c.atk[0] + '–' + c.atk[1] + '</div>' +
        c.abilities.map(a => '<div class="abLine"><b>' + ABILITIES[a].name + '</b> — ' + kw(ABILITIES[a].desc) + '</div>').join('') +
        '<div class="blurb" style="margin-top:8px">' + c.blurb + '</div>';
      if (can) d.addEventListener('click', () => {
        meta.tallies -= c.cost; meta.classes.push(key); saveMeta(); play('recruit'); render();
      });
      box.appendChild(d);
    }

    // ---- relics: what can be found down there
    section('Relics of the Siege');
    for (const rl of RELICS) {
      const owned = meta.relics.includes(rl.id);
      const can = !owned && rl.locked && meta.tallies >= rl.cost;
      if (!rl.locked && owned) continue; // base relics need no card
      const d = document.createElement('div');
      d.className = 'choice' + (owned || !can ? ' locked' : '');
      if (!owned) d.style.opacity = can ? '1' : '.55';
      d.innerHTML =
        '<h3>' + rl.name + (owned ? '' : '<span class="costTag">' + rl.cost + ' tallies</span>') + '</h3>' +
        '<div class="role" style="color:var(--gold)">' + (owned ? 'In the relic pool' : 'Click to unlock') + '</div>' +
        '<div class="blurb">' + rl.text + '</div>';
      if (can) d.addEventListener('click', () => {
        meta.tallies -= rl.cost; meta.relics.push(rl.id); saveMeta(); play('coin'); render();
      });
      box.appendChild(d);
    }

    $('mFoot').innerHTML = '';
    const back = document.createElement('button');
    back.textContent = 'Back';
    back.addEventListener('click', goTitle);
    $('mFoot').appendChild(back);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Unlocks add options to the pool, never raw power. A run is still a run.';
    $('mFoot').appendChild(hint);
  };
  render();
}

// every soldier's story ends somewhere; the Roster remembers
function recordFate(soldier, fate, floor) {
  meta.history = meta.history || [];
  meta.history.push({
    name: soldier.name, defId: soldier.defId, custom: soldier.custom || null,
    kills: soldier.kills || 0, fate, floor,
  });
  if (meta.history.length > 60) meta.history = meta.history.slice(-60);
  saveMeta();
}

// ------------------------------------------------------------ status keywords
const KEYWORDS = {
  bleed: 'Bleed: 3 damage at the start of each of its turns, for 3 turns. Armour does not help.',
  bleeding: 'Bleed: 3 damage at the start of each of its turns, for 3 turns. Armour does not help.',
  burning: 'Burning: 3 damage at the start of each of its turns, for 2 turns. Armour does not help.',
  pinned: 'Pinned: cannot move on its next turn. It can still act.',
  hasted: 'Hasted: +2 movement on its next turn.',
  guarded: 'Guarded: incoming hits are reduced while this holds.',
  rallied: 'Rallied: +3 damage on every attack while this holds.',
  'off-balance': 'Off-balance: the next hit is worse.',
};
function kw(text) {
  if (!text) return text;
  return text.replace(/(bleeding|bleed|burning|pinned|hasted|guarded|rallied)/gi,
    (m) => '<u class="kw" title="' + (KEYWORDS[m.toLowerCase()] || '') + '">' + m + '</u>');
}

// ============================================================ first-time tips
// One card the FIRST time a concept appears, then never again. This is the
// onboarding that the tutorial cannot do: teaching things when they happen.
const TIPS = {
  cache: ['Relics', 'A relic is a permanent boost for this run. You can carry FIVE; a sixth means dropping one. Taking the gold instead is never wrong.'],
  camp: ['Camps', 'One choice only: heal everyone, drill one soldier permanently, or strip it for gold. Camps are rare — spend them on whatever is scarcest.'],
  vendor: ['The quartermaster', 'Gold dies with the run. There is no reason to hoard it — leave with empty pockets and full plate.'],
  windup: ['Wind-ups', 'The bright orange tiles WILL be hit at the start of their next turn. Standing in them is always a mistake. This rule never bends.'],
  reloadR: ['The crossbow', 'Crossbows hit hardest in the company, but every shot costs a turn of winding. Shoot, reload, shoot — plan the rhythm.'],
  fullparty: ['Four is the cap', 'Taking a fifth means leaving one of yours in the dark — and that is a death, not a bench. Gold is the safe answer.'],
  death: ['Nobody comes back', 'That soldier is gone for the run, and the next fights scale to the company you still have. Retreat is a real option — a hurt soldier pulled back is a soldier kept.'],
  tallies: ['Tallies', 'The one thing that survives a run. Spend them on THE ROSTER to add classes and relics to what future runs can find.'],
  boss: ['The floor’s master', 'Bosses hit harder, call for help, and hold the only stair down. Spend your cooldowns — there is nothing after this worth saving them for.'],
  prisoner: ['Prisoners', 'This is how the company grows — battles pay gold, prisoners pay PEOPLE. You cannot pick who they are, only what they turn out to be.'],
  mana: ['Mana', 'Abilities cost MANA from one pool the whole company shares — the number under the party list. It does not come back on its own: sleep at camps, buy incense from the quartermaster, or descend a floor.'],
  gold: ['Gold', 'Gold is this run’s money and it DIES with the run. Spend it at the quartermaster on relics, healing, and plate — leaving with full pockets is leaving it in the dirt.'],
  recap: ['The three laws', 'Orange tiles WILL be hit — never stand in them. A flanked foe takes +3 from behind. And nobody you lose comes back.'],
};

function tip(id) {
  if (!TIPS[id] || meta.tipsSeen.includes(id)) return;
  meta.tipsSeen.push(id); saveMeta();
  const el = $('tipCard');
  if (!el) return;
  $('tipTitle').textContent = TIPS[id][0];
  $('tipText').textContent = TIPS[id][1];
  el.classList.add('on');
  if (settings.sound !== false) play('select');
  clearTimeout(tip.tk);
  tip.tk = setTimeout(() => el.classList.remove('on'), 9000);
}

// ============================================================ ledger of foes
// Only the foes you have MET are legible; the rest are shapes in the dark.
function screenGlossary(backTo) {
  showScreen('modal');
  $('mEyebrow').textContent = 'What the dark has shown you so far';
  $('mTitle').textContent = 'THE LEDGER OF FOES';
  const seen = meta.seenFoes || [];
  const all = Object.keys(ENEMIES).concat(Object.keys(BOSSES));
  $('mLede').textContent = seen.length + ' of ' + all.length + ' catalogued. Meet the rest to read them.';
  const box = $('mChoices');
  box.innerHTML = '';
  for (const id of all) {
    const def = ENEMIES[id] || BOSSES[id];
    const met = seen.includes(id);
    const d = document.createElement('div');
    d.className = 'choice locked';
    if (!met) {
      d.style.opacity = '.38';
      d.innerHTML = '<h3>???</h3><div class="role">' + (def.boss ? 'Something larger' : 'Not yet met') + '</div>'
        + '<div class="blurb">The survivors who described it did not describe it well.</div>';
    } else {
      const kills = (meta.foeKills || {})[id] || 0;
      d.innerHTML =
        '<img class="cardP" src="' + portraitURL(id, null, 84, 100) + '" alt="">' +
        '<h3>' + def.name + '</h3>' +
        '<div class="role">' + (def.boss ? 'Master of a floor' : 'Threat ' + def.threat) + (kills ? ' · slain ×' + kills : '') + '</div>' +
        '<div class="stats mono">' + def.hp + ' hp · ' + def.armor + ' armour · ' + def.mov + ' move · hits ' + def.atk[0] + '–' + def.atk[1]
        + ' at range ' + (def.minRange > 1 ? def.minRange + '–' : '') + def.range + '</div>' +
        def.abilities.map(a => '<div class="abLine"><b>' + ABILITIES[a].name + '</b> — ' + ABILITIES[a].desc + '</div>').join('') +
        '<div class="blurb" style="margin-top:8px">' + def.blurb + '</div>';
    }
    box.appendChild(d);
  }
  $('mFoot').innerHTML = '';
  const back = document.createElement('button');
  back.textContent = 'Back';
  back.addEventListener('click', backTo || goTitle);
  $('mFoot').appendChild(back);
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Wind-up attacks always mark their tiles a turn ahead. The ledger does not lie; neither do they.';
  $('mFoot').appendChild(hint);
}

// ================================================================== settings
function screenSettings() {
  showScreen('modal');
  const render = () => {
    $('mEyebrow').textContent = '';
  $('mTitle').textContent = 'SETTINGS';
    $('mLede').textContent = 'Nothing here is judged. Difficulty applies from the next run down.';
    const box = $('mChoices');
    box.innerHTML = '';
    const card = (title, sub, blurb, on, fn) => {
      const d = document.createElement('div');
      d.className = 'choice';
      d.innerHTML = '<h3>' + title + '<span class="costTag">' + (on ? 'ON' : 'OFF') + '</span></h3>'
        + '<div class="role">' + sub + '</div><div class="blurb">' + blurb + '</div>';
      d.style.borderColor = on ? '#6b5741' : '';
      d.addEventListener('click', () => { fn(); saveSettings(); render(); });
      box.appendChild(d);
    };
    // difficulty
    const d = document.createElement('div');
    d.className = 'choice';
    d.innerHTML = '<h3>Difficulty<span class="costTag">' + DIFF[settings.difficulty].label + '</span></h3>'
      + '<div class="role">Click to cycle</div><div class="blurb">' + DIFF[settings.difficulty].note + '</div>';
    d.addEventListener('click', () => {
      const keys = Object.keys(DIFF);
      settings.difficulty = keys[(keys.indexOf(settings.difficulty) + 1) % keys.length];
      saveSettings(); render();
    });
    box.appendChild(d);

    card('Threat overlay', 'On by default', 'Show the tiles the other side can reach and hit next turn, without pressing T every round.',
      settings.threatDefault, () => settings.threatDefault = !settings.threatDefault);
    card('Damage forecast', 'Numbers before you commit', 'Hovering a foe with a soldier selected shows the exact damage range you would do.',
      settings.showForecast, () => settings.showForecast = !settings.showForecast);
    card('Quick enemy turn', 'Half the pause between their moves', 'Faster once you know what everything does. Harder to follow the first few runs.',
      settings.fastEnemy, () => settings.fastEnemy = !settings.fastEnemy);
    card('Sound', 'Synthesized, no downloads', 'Hits, bows, powder, the wind-up horn, and the cave air. All generated live.',
      settings.sound !== false, () => {
        settings.sound = settings.sound === false;
        setSfxEnabled(settings.sound !== false);
E.setAnimScale(settings.fastAnim ? 0.55 : 1);
document.addEventListener('pointerdown', () => setVolumes(settings.volMaster, settings.volMusic, settings.volSfx), { once: true });
        if (settings.sound === false) stopAmbience();
      });
    // volume sliders live in their own card; sliders don't cycle like toggles
    {
      const d = document.createElement('div');
      d.className = 'choice locked';
      d.style.cursor = 'default';
      d.innerHTML = '<h3>Volume</h3><div class="role">Master · Music · Effects</div>';
      const mkSlider = (label, key) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:9px;margin-top:8px';
        row.innerHTML = '<span style="width:58px;font-size:11px;color:var(--ink-dim)">' + label + '</span>';
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = 0; inp.max = 100; inp.value = Math.round((settings[key] != null ? settings[key] : 0.8) * 100);
        inp.style.cssText = 'flex:1 1 auto;accent-color:#c2703a';
        inp.addEventListener('input', () => {
          settings[key] = inp.value / 100;
          setVolumes(settings.volMaster, settings.volMusic, settings.volSfx);
          saveSettings();
        });
        row.appendChild(inp);
        d.appendChild(row);
      };
      mkSlider('Master', 'volMaster');
      mkSlider('Music', 'volMusic');
      mkSlider('Effects', 'volSfx');
      box.appendChild(d);
    }
    card('Fast animations', 'Everything moves quicker', 'Walks, hops, and lunges at roughly double speed. For when you know the game.',
      !!settings.fastAnim, () => { settings.fastAnim = !settings.fastAnim; E.setAnimScale(settings.fastAnim ? 0.55 : 1); });
    card('Colourblind threat', 'Blue danger instead of red', 'The threat overlay and single-foe focus draw in blues. Wind-ups stay bright orange.',
      !!settings.cbThreat, () => settings.cbThreat = !settings.cbThreat);
    card('Damage numbers', 'Floating numbers on hits', 'Turn them off and the health bars alone tell the story.',
      settings.dmgNumbers !== false, () => settings.dmgNumbers = settings.dmgNumbers === false);
    {
      const d = document.createElement('div');
      d.className = 'choice';
      d.innerHTML = '<h3>Fullscreen<span class="costTag">' + (document.fullscreenElement ? 'ON' : 'OFF') + '</span></h3>'
        + '<div class="role">Click to toggle</div><div class="blurb">The dig, wall to wall.</div>';
      d.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
        setTimeout(render, 300);
      });
      box.appendChild(d);
    }
    {
      const d = document.createElement('div');
      d.className = 'choice';
      d.innerHTML = '<h3>Replay the lesson</h3><div class="role">Click to reset it</div>'
        + '<div class="blurb">The guided first fight runs again at the start of your next new run.</div>';
      d.addEventListener('click', () => { meta.seenTutorial = false; saveMeta(); d.querySelector('.role').textContent = 'It will run next dig'; });
      box.appendChild(d);
    }
    {
      const d = document.createElement('div');
      d.className = 'choice';
      d.style.borderColor = '#5a2a22';
      d.innerHTML = '<h3 style="color:var(--blood)">Erase everything</h3><div class="role">Unlocks, tallies, history, saves</div>'
        + '<div class="blurb">Back to the first company. There is no undo.</div>';
      d.addEventListener('click', () => { if (confirm('Erase ALL progress? There is no undo.')) { wipeAll(); } });
      box.appendChild(d);
    }
    {
      const list = crashes();
      const d = document.createElement('div');
      d.className = 'choice';
      d.innerHTML = '<h3>Crash journal<span class="costTag">' + list.length + '</span></h3>'
        + '<div class="role">' + (list.length ? 'Click to view' : 'Empty — good') + '</div>'
        + '<div class="blurb">Uncaught errors are recorded here. If something breaks, this is the report.</div>';
      if (list.length) d.addEventListener('click', () => {
        $('mEyebrow').textContent = 'What went wrong, and when';
        $('mTitle').textContent = 'CRASH JOURNAL';
        $('mLede').textContent = '';
        const box2 = $('mChoices');
        box2.innerHTML = '';
        for (const c2 of list.slice().reverse()) {
          const e2 = document.createElement('div');
          e2.className = 'choice locked';
          e2.innerHTML = '<h3 style="font-size:13px">' + c2.t + '</h3>'
            + '<div class="role">' + c2.kind + ' · ' + (c2.screen || '?') + (c2.floor ? ' · floor ' + c2.floor : '') + '</div>'
            + '<div class="blurb mono" style="font-size:10.5px;word-break:break-all">' + c2.msg + '<br>' + c2.stack + '</div>';
          box2.appendChild(e2);
        }
        $('mFoot').innerHTML = '';
        const clr = document.createElement('button');
        clr.textContent = 'Clear the journal';
        clr.addEventListener('click', () => { localStorage.removeItem(CRASH_KEY); screenSettings(); });
        const back2 = document.createElement('button');
        back2.textContent = 'Back';
        back2.addEventListener('click', screenSettings);
        $('mFoot').append(back2, clr);
      });
      box.appendChild(d);
    }
    card('Reduced motion', 'Stillness where possible', 'Stops the screen shake, haze, embers, entrance marches, and the moving map routes. The game plays identically.',
      !!settings.reducedMotion, () => { settings.reducedMotion = !settings.reducedMotion; applyMotionClass(); });
    card('Screen shake', 'Hits rattle the board', 'A slap of movement on big hits, deaths, and powder. Turn it off if it bothers your eyes.',
      settings.screenShake !== false, () => settings.screenShake = settings.screenShake === false);
    card('Confirm end of turn', 'Ask if someone has not moved', 'Stops you ending the round with a soldier still standing there doing nothing.',
      settings.confirmEnd, () => settings.confirmEnd = !settings.confirmEnd);
    card('Auto end turn', 'No dead air', 'When every soldier has acted, the round ends on its own instead of waiting for Space.',
      settings.autoEnd !== false, () => settings.autoEnd = settings.autoEnd === false);
    card('Battle animations', 'The blow, writ large', 'Big cut-in duels on every hit, the way the old war games did it. Off skips straight to the numbers.',
      settings.duelAnims !== false, () => settings.duelAnims = settings.duelAnims === false);

    $('mFoot').innerHTML = '';
    const back = document.createElement('button');
    back.textContent = 'Back';
    back.addEventListener('click', () => { if (run && st) { showScreen('battle'); } else goTitle(); });
    $('mFoot').appendChild(back);
    const keys = document.createElement('div');
    keys.className = 'hint';
    keys.innerHTML = 'Keys: [1][2] abilities · [A] attack · [R] reload · [W] hold · [U] undo move · [Tab] next soldier · [T] threat · [Space] end turn · [Esc] cancel';
    $('mFoot').appendChild(keys);
  };
  render();
}

// =================================================================== intro
const INTRO = [
  {
    h: 'ELEVEN YEARS AGO',
    p: 'The besiegers dug a mine under the east wall. The garrison dug a countermine to meet it. '
      + 'Both tunnels broke into something older, and the fighting went down into it, and the fighting never stopped.',
  },
  {
    h: 'WHAT COMES UP',
    p: 'Nothing comes up. Sometimes there is a sound from the stair, and once a man in the wrong colours, '
      + 'who could not say which year he thought it was.',
  },
  {
    h: 'YOUR COMPANY',
    p: 'You go down alone. Everyone you will fight beside is chained down there already — both armies took '
      + 'prisoners for eleven years and forgot to stop. Free them, decide what they were, and they are yours. '
      + 'Four is all the rations stretch to, and nobody you lose comes back.',
  },
];

function screenIntro(idx) {
  showScreen('modal');
  $('modal').classList.add('intro');
  const page = INTRO[idx];
  $('mTitle').textContent = page.h;
  $('mLede').textContent = '';
  const wrap = document.createElement('div');
  wrap.className = 'choice locked';
  wrap.style.cssText = 'grid-column:1/-1;max-width:820px;border:none;background:none;padding:0';
  const scene = introScene(idx, 800, 260);
  scene.className = 'scene';
  wrap.appendChild(scene);
  const txt = document.createElement('div');
  txt.className = 'blurb';
  txt.style.cssText = 'font-size:15.5px;line-height:1.8;font-style:normal;color:#c8bba4;padding-left:26px;border-left:2px solid var(--torch-d)';
  txt.textContent = page.p;
  wrap.appendChild(txt);
  $('mChoices').innerHTML = '';
  $('mChoices').appendChild(wrap);
  $('mFoot').innerHTML = '';
  const next = document.createElement('button');
  next.textContent = idx < INTRO.length - 1 ? 'Go on' : 'Take the stair';
  next.addEventListener('click', () => {
    if (idx < INTRO.length - 1) screenIntro(idx + 1);
    else { meta.seenIntro = true; saveMeta(); screenCreator(); }
  });
  const skip = document.createElement('button');
  skip.textContent = 'Skip';
  skip.addEventListener('click', () => { meta.seenIntro = true; saveMeta(); screenCreator(); });
  $('mFoot').append(next, skip);
  const dots = document.createElement('div');
  dots.className = 'hint';
  dots.textContent = INTRO.map((_, i) => i === idx ? '◆' : '◇').join(' ');
  $('mFoot').appendChild(dots);
}

function wipeAll() {
  meta = DEFAULT_META();
  saveMeta();
  clearRun();
  goTitle();
}

function goTitle() {
  st = null; run = null;
  showScreen('title');
  $('titleStats').innerHTML = meta.runs
    ? 'Companies sent down: <span class="tally">' + meta.runs + '</span> · deepest floor: <span class="tally">'
    + meta.deepest + '</span> · tallies: <span class="tally">' + meta.tallies + '</span>'
    : 'No company has gone down yet.';
  // Continue button appears only while a dig is actually saved.
  const old = $('btnContinue');
  if (old) old.remove();
  const d = savedRun();
  if (d) {
    const b = document.createElement('button');
    b.id = 'btnContinue';
    b.className = 'primary';
    b.textContent = 'Continue — Floor ' + (d.floorIdx + 1) + ', ' + d.party.length
      + (d.party.length === 1 ? ' soldier' : ' soldiers');
    b.addEventListener('click', () => { if (!resumeRun()) goTitle(); });
    $('btnStart').before(b);
    $('btnStart').classList.remove('primary');
  } else {
    $('btnStart').classList.add('primary');
  }
}

// ============================================================ crash journal
// Uncaught errors land in a localStorage ring so a playtest crash is a
// report, not a shrug. Read + clear from Settings.
const CRASH_KEY = 'countermine_crashes_v1';
function crashes() { try { return JSON.parse(localStorage.getItem(CRASH_KEY) || '[]'); } catch (e) { return []; } }
function logCrash(kind, msg, stack) {
  try {
    const list = crashes();
    list.push({ t: new Date().toISOString(), kind, msg: String(msg).slice(0, 300),
      stack: String(stack || '').split('\n').slice(0, 4).join(' | ').slice(0, 400),
      screen: currentScreen, floor: run ? run.floorIdx + 1 : null });
    localStorage.setItem(CRASH_KEY, JSON.stringify(list.slice(-20)));
  } catch (e) {}
}
window.addEventListener('error', (ev) => logCrash('error', ev.message, ev.error && ev.error.stack));
window.addEventListener('unhandledrejection', (ev) => logCrash('rejection', ev.reason && ev.reason.message || ev.reason, ev.reason && ev.reason.stack));

// ================================================================== audio
document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('click', (ev) => {
  if (settings.sound === false) return;
  if (ev.target.closest && ev.target.closest('button')) play('ui');
});
setSfxEnabled(settings.sound !== false);

// =================================================================== keys
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if ($('battle').classList.contains('on')) { cancelMode(); }
    return;
  }
  if (!st || !$('battle').classList.contains('on')) return;
  const u = view.selected ? unitByUid(view.selected) : null;
  switch (ev.key.toLowerCase()) {
    case ' ':
      ev.preventDefault();
      if (settings.confirmEnd && st.phase === 'player') {
        const idle = st.units.filter(x => x.alive && x.side === 'player' && !x.acted);
        if (idle.length && !confirm(idle.length + ' still have not moved. End the round anyway?')) return;
      }
      endTurn(); break;
    case 'tab': {
      ev.preventDefault();
      const list = st.units.filter(x => x.alive && x.side === 'player' && !x.acted);
      if (!list.length) break;
      const i = list.findIndex(x => x.uid === view.selected);
      select(list[(i + 1) % list.length].uid);
      break;
    }
    case 'a': armAttack(); break;
    case 'r': if (u && u.usesLoad && !u.acted && !u.loaded) { E.reload(st, u); afterAction(u); } break;
    case 'w': if (u && !u.acted) { E.wait(st, u); afterAction(u); } break;
    case 'u': if (u && u.moved && !u.acted) { u.x = u.startX; u.y = u.startY; u.moved = false; u.anim = null; u.lunge = null; select(u.uid); } break;
    case 't': toggleThreat(); break;
    case '1': if (u) armAbility(u.abilities[0]); break;
    case '2': if (u) armAbility(u.abilities[1]); break;
  }
});

function toggleThreat() {
  view.threat = view.threat ? null : E.threatMap(st);
  syncUI();
}

// ================================================================== buttons
$('btnStart').addEventListener('click', () => { if (meta.seenIntro) screenCreator(); else screenIntro(0); });
$('btnSettings').addEventListener('click', screenSettings);
(function addGlossaryButtons() {
  const t = document.createElement('button');
  t.textContent = 'Ledger of Foes';
  t.addEventListener('click', () => screenGlossary(goTitle));
  $('btnSettings').before(t);
  const m = document.createElement('button');
  m.textContent = 'Foes';
  m.addEventListener('click', () => screenGlossary(openMap));
  $('btnAbandon').before(m);
})();
$('menuBtn').addEventListener('click', screenSettings);
$('btnMuster').addEventListener('click', screenUnlocks);
$('threatBtn').addEventListener('click', toggleThreat);
$('endBtn').addEventListener('click', () => {
  if (settings.confirmEnd && st && st.phase === 'player') {
    const idle = st.units.filter(x => x.alive && x.side === 'player' && !x.acted);
    if (idle.length && !confirm(idle.length + ' still have not moved. End the round anyway?')) return;
  }
  endTurn();
});
$('btnAbandon').addEventListener('click', () => {
  if (!confirm('Abandon the dig? The company is written off.')) return;
  runLost([]);
});


// The stage is a fixed 1290x620 so the board never reflows mid-battle; scale
// the whole thing to whatever window it lands in.
function applyMotionClass() { document.body.classList.toggle('reduced-motion', !!settings.reducedMotion); }
applyMotionClass();

function fitStage() {
  const s = Math.min(1, (window.innerWidth - 24) / 1290, (window.innerHeight - 24) / 620);
  $('stage').style.transform = 'scale(' + s.toFixed(4) + ')';
}
window.addEventListener('resize', fitStage);
fitStage();

// ============================================================ title embers
// Sparks drifting up from an unseen fire below the frame. Runs only while
// the title is showing; costs nothing anywhere else.
const embers = [];
function drawTitleFx(dt) {
  const cvx = $('titleFx');
  if (!cvx) return;
  const g2 = cvx.getContext('2d');
  g2.clearRect(0, 0, cvx.width, cvx.height);
  // the fortress on its ridge, breach still glowing -- drawn even in reduced motion
  const sk = titleSkyline(cvx.width, 200);
  g2.globalAlpha = 0.9;
  g2.drawImage(sk, 0, cvx.height - 200);
  g2.globalAlpha = 1;
  if (settings.reducedMotion) return;
  if (embers.length < 46 && Math.random() < 0.3) {
    embers.push({
      x: 120 + Math.random() * (cvx.width - 240), y: cvx.height + 6,
      vy: 14 + Math.random() * 22, drift: Math.random() * 6.28,
      r: 0.8 + Math.random() * 1.7, life: 0, dur: 7000 + Math.random() * 6000,
    });
  }
  for (let i = embers.length - 1; i >= 0; i--) {
    const e = embers[i];
    e.life += dt;
    e.y -= e.vy * dt / 1000;
    e.x += Math.sin(e.life / 900 + e.drift) * 0.25;
    const p = e.life / e.dur;
    if (p >= 1 || e.y < -8) { embers.splice(i, 1); continue; }
    const a = p < 0.1 ? p * 10 : (1 - p);
    g2.globalAlpha = a * 0.7;
    g2.fillStyle = p > 0.6 ? '#8a4f22' : '#e0904a';
    g2.beginPath();
    g2.arc(e.x, e.y, e.r * (1 - p * 0.4), 0, 6.29);
    g2.fill();
  }
  g2.globalAlpha = 1;
}

// ================================================================= main loop
let lastFrame = 0;
function frame(ts) {
  const dt = lastFrame ? Math.min(80, ts - lastFrame) : 16;
  lastFrame = ts;
  step(dt);
  requestAnimationFrame(frame);
}
function step(dt) {
  if ($('title').classList.contains('on')) { drawTitleFx(dt); return; }
  if (!st || !$('battle').classList.contains('on')) return;
  if (view.duel && performance.now() - view.duel.t0 > view.duel.dur) view.duel = null;
  if (st.phase === 'enemy') {
    if (view.duel) { R.draw(ctx, st, view); tickTutorial(); return; }
    enemyTimer -= dt;
    if (enemyTimer <= 0) {
      const more = E.enemyActOne(st);
      enemyTimer = settings.fastEnemy ? 210 : 430;
      if (!more) {
        if (settings.threatDefault) view.threat = E.threatMap(st);
        const first = st.units.find(u => u.alive && u.side === 'player');
        if (first && st.phase === 'player') { select(first.uid); phaseSweep('ROUND ' + st.round + ' — YOURS'); }
      }
      syncUI();
      if (st.phase === 'won' || st.phase === 'lost') {
        setTimeout(endBattle, 900);
        st.phase = 'ending';
      }
    }
  }
  if ((st.phase === 'won' || st.phase === 'lost') && !st.endingQueued) {
    st.endingQueued = true;
    setTimeout(endBattle, 700);
  }
  // translate battle events to audio here, never in the engine: headless
  // sims share these code paths and must stay silent
  if (settings.sound !== false) {
    const panOf = (x) => x == null ? 0 : ((x / 15) * 2 - 1) * 0.65;
    for (const f of st.fx) {
      if (f.heard || f.kind === 'shake') continue;
      f.heard = true;
      const o = { pan: panOf(f.x != null ? f.x : f.x2) };
      if (f.kind === 'hit' && f.amount != null) {
        play(f.amount >= 10 ? 'heavy' : 'hit', o);
        if (f.amount >= 10 && !settings.reducedMotion) { view.freezeUntil = performance.now() + 70; }
      }
      else if (f.kind === 'death') { play(f.side === 'player' ? 'dirge' : 'death', o); if (!settings.reducedMotion) view.freezeUntil = performance.now() + 90; }
      else if (f.kind === 'boom') { play('boom', o); if (!settings.reducedMotion) view.freezeUntil = performance.now() + 100; }
      else if (f.kind === 'sweep') play('sweep', o);
      else if (f.kind === 'heal') play('heal', o);
      else if (f.kind === 'snd') { play(f.s, o); if (f.s === 'warn') tip('windup'); }
      else if (f.kind === 'duel') {
        if (settings.duelAnims !== false && !settings.reducedMotion && !view.duel) {
          view.duel = Object.assign({}, f, { t0: performance.now(), dur: 1150 });
        }
      }
    }
    st.fx = st.fx.filter(f => f.kind !== 'snd' && f.kind !== 'duel');
    const walker = st.units.find(u => u.alive && u.anim && u.anim.kind === 'walk');
    if (walker) {
      if (!step.lastStepSnd || performance.now() - step.lastStepSnd > 130) {
        step.lastStepSnd = performance.now();
        const tile = st.grid[walker.y] && st.grid[walker.y][walker.x];
        play('step', { pan: panOf(walker.x), surface: tile && tile.t === 2 ? 'mud' : 'stone' });
      }
    }
    // the captain, nearly done: a heartbeat you feel before you see it
    const cap = st.units.find(u => u.isCaptain);
    if (cap && cap.alive && cap.hp / cap.maxHp < 0.3 && st.phase !== 'deploy') {
      if (!step.lastBeat || performance.now() - step.lastBeat > 1400) {
        step.lastBeat = performance.now();
        play('heartbeat');
      }
    }
  }
  if (settings.sound === false) {
    for (const f of st.fx) {
      if (f.kind === 'duel' && !f.heard) {
        f.heard = true;
        if (settings.duelAnims !== false && !settings.reducedMotion && !view.duel) {
          view.duel = Object.assign({}, f, { t0: performance.now(), dur: 1150 });
        }
      }
    }
    st.fx = st.fx.filter(f => f.kind !== 'duel' && f.kind !== 'snd');
  }
  view.shakeEnabled = settings.screenShake !== false && !settings.reducedMotion;
  view.reducedMotion = !!settings.reducedMotion;
  view.cbThreat = !!settings.cbThreat;
  view.hideNumbers = settings.dmgNumbers === false;
  R.draw(ctx, st, view);
  tickTutorial();
}
requestAnimationFrame(frame);
// Watchdog: a hidden preview panel stops firing rAF entirely, and the canvas
// then never composites when it comes back.
setInterval(() => {
  if (performance.now() - lastFrame > 500 && st && $('battle').classList.contains('on')) {
    step(16);
  }
}, 250);

// ---- PWA: production only; the dev server must stay uncached
if (location.protocol === 'https:' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// =================================================================== boot
goTitle();

// ============================================================ debug harness
// Everything below exists so balance can be measured instead of guessed.
window.CM = {
  get run() { return run; },
  get st() { return st; },
  // getters, not snapshots: wipeMeta() rebinds these, and a captured reference
  // reports the pre-wipe object forever
  get meta() { return meta; },
  get settings() { return settings; },
  get view() { return view; },
  newRun, goTitle,
  wipeMeta() { meta = DEFAULT_META(); saveMeta(); clearRun(); goTitle(); },
  sim, simOne, makeCaptain, randomCaptain, defaultCaptain,
  // Hooks used to drive the real UI in a test, so a broken screen transition
  // shows up as a failed assertion instead of as a silent dead click.
  dbg: {
    click: (x, y) => onBoardClick({ x, y }),
    select, endTurn, armAttack, armAbility,
    node: (i) => { const n = run.map.nodes.filter(x => run.map.reachable.includes(x.id)); enterNode(n[i || 0]); },
    nodeTypes: () => run.map.nodes.map(n => n.col + n.type[0]).join(' '),
    reachable: () => run.map.reachable.slice(),
    screen: () => ['title', 'mapScreen', 'modal', 'creator', 'battle'].find(s => $(s).classList.contains('on')),
    modal: () => ({ title: $('mTitle').textContent, lede: $('mLede').textContent, choices: $('mChoices').children.length }),
    clickChoice: (i) => $('mChoices').children[i].click(),
    clickFoot: (i) => $('mFoot').querySelectorAll('button')[i || 0].click(),
    view: () => ({ mode, selected: view.selected, moves: view.moveTiles ? view.moveTiles.length : 0, targets: view.targetTiles ? view.targetTiles.length : 0 }),
    party: () => run.party.map(p => p.defId + ':' + p.name + ':' + p.hp),
    forceWin: () => { st.units.filter(u => u.side === 'enemy').forEach(u => { u.alive = false; u.hp = 0; }); E.checkOver(st); },
    forceLoss: () => { st.units.filter(u => u.side === 'player').forEach(u => { u.alive = false; u.hp = 0; }); E.checkOver(st); },
    finishBattle: () => endBattle(),
    runEnemyPhase: () => { let g = 0; while (E.enemyActOne(st) && g++ < 80); },
  },
};

// A greedy but honest bot: it uses abilities, flanks when it can, and retreats
// nobody. It is a floor on player skill, not a ceiling.
function botTurn(bst) {
  let guard = 0;
  while (bst.phase === 'player' && guard++ < 40) {
    const u = bst.units.find(x => x.alive && x.side === 'player' && !x.acted);
    if (!u) break;
    botAct(bst, u);
  }
}

function botAct(bst, u) {
  const foes = bst.units.filter(x => x.alive && x.side === 'enemy');
  if (!foes.length) { E.wait(bst, u); return; }

  // healer first: patch anyone under half
  if (u.abilities.includes('stitch') && E.abilityReady(u, 'stitch', st)) {
    const hurt = bst.units.filter(x => x.alive && x.side === 'player' && x.hp < x.maxHp * 0.55)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (hurt) {
      const spots = E.reachableTiles(bst, u).concat([{ x: u.x, y: u.y }]);
      const good = spots.find(s => Math.abs(s.x - hurt.x) + Math.abs(s.y - hurt.y) <= 2);
      if (good) {
        if (good.x !== u.x || good.y !== u.y) E.moveUnit(bst, u, good.x, good.y);
        E.useAbility(bst, u, 'stitch', hurt.x, hurt.y, null);
        return;
      }
    }
  }
  if (u.usesLoad && !u.loaded && !u.freeShot) { E.reload(bst, u); return; }

  // damage abilities and the basic attack, scored the same way
  const options = [];
  const spots = E.reachableTiles(bst, u).concat([{ x: u.x, y: u.y, cost: 0 }]);
  for (const s of spots) {
    const ghost = Object.assign(Object.create(Object.getPrototypeOf(u)), u, { x: s.x, y: s.y });
    for (const f of foes) {
      const d = Math.abs(s.x - f.x) + Math.abs(s.y - f.y);
      if (d >= u.minRange && d <= u.range && (u.range === 1 || E.hasLOS(bst, s.x, s.y, f.x, f.y))) {
        const p = E.damageProfile(bst, ghost, f, {});
        const avg = (p.min + p.max) / 2;
        options.push({ score: avg * 10 + (avg >= f.hp ? 500 : 0) - s.cost, s, f, kind: 'atk' });
      }
      for (const aid of u.abilities) {
        const ab = ABILITIES[aid];
        if (!E.abilityReady(u, aid, st)) continue;
        if (!ab.dmg || ab.target !== 'enemy') continue;
        const R2 = ab.range || 1, m2 = ab.minRange || 1;
        if (d < m2 || d > R2) continue;
        if (R2 > 1 && !E.hasLOS(bst, s.x, s.y, f.x, f.y)) continue;
        const p = E.damageProfile(bst, ghost, f, { dmg: ab.dmg, pierce: ab.pierce });
        const avg = (p.min + p.max) / 2;
        options.push({ score: avg * 11 + (avg >= f.hp ? 500 : 0) - s.cost, s, f, kind: 'ab', aid });
      }
    }
  }
  options.sort((a, b) => b.score - a.score);
  const best = options[0];
  if (best) {
    if (best.s.x !== u.x || best.s.y !== u.y) E.moveUnit(bst, u, best.s.x, best.s.y);
    if (best.kind === 'atk') E.basicAttack(bst, u, best.f);
    else E.useAbility(bst, u, best.aid, best.f.x, best.f.y, null);
    if (!u.acted) E.wait(bst, u);
    return;
  }
  // advance
  let target = null, bd = Infinity;
  for (const f of foes) {
    const d = Math.abs(u.x - f.x) + Math.abs(u.y - f.y);
    if (d < bd) { bd = d; target = f; }
  }
  if (target) {
    const spots2 = E.reachableTiles(bst, u);
    spots2.sort((a, b) =>
      (Math.abs(a.x - target.x) + Math.abs(a.y - target.y)) - (Math.abs(b.x - target.x) + Math.abs(b.y - target.y)));
    if (spots2.length) E.moveUnit(bst, u, spots2[0].x, spots2[0].y);
  }
  E.wait(bst, u);
}

// One battle, headless. Returns a record that also proves the fight happened.
function simOne(opts) {
  const floor = FLOORS[opts.floorIdx || 0];
  const rng = E.makeRng(opts.seed);
  const bst = E.newBattle({
    seed: opts.seed, floor, kind: opts.kind || 'fight',
    party: opts.party, enemies: opts.enemies || rollEnemies(rng, floor, opts.kind || 'fight', opts.party.length),
    relics: opts.relics || [],
  });
  E.startPlayerPhase(bst);
  let rounds = 0;
  while (bst.phase !== 'won' && bst.phase !== 'lost' && rounds < 40) {
    botTurn(bst);
    if (bst.phase === 'won' || bst.phase === 'lost') break;
    E.endPlayerPhase(bst);
    let guard = 0;
    while (E.enemyActOne(bst) && guard++ < 60) { /* step */ }
    rounds++;
  }
  const pDmg = bst.units.filter(u => u.side === 'player').reduce((a, u) => a + u.dmgDealt, 0);
  const eDmg = bst.units.filter(u => u.side === 'enemy').reduce((a, u) => a + u.dmgDealt, 0);
  return {
    won: bst.phase === 'won', rounds,
    survivors: bst.units.filter(u => u.side === 'player' && u.alive).length,
    partySize: opts.party.length,
    hpLeft: bst.units.filter(u => u.side === 'player' && u.alive).reduce((a, u) => a + u.hp, 0),
    hpMax: bst.units.filter(u => u.side === 'player').reduce((a, u) => a + u.maxHp, 0),
    playerDamage: pDmg, enemyDamage: eDmg,
    timedOut: rounds >= 40,
    enemies: bst.units.filter(u => u.side === 'enemy').length,
  };
}

// n battles per (floor, party-size) cell. 21+ because 13 has lied before.
function sim(n = 25, opts = {}) {
  const t0 = performance.now();
  const rows = [];
  const partyFor = (size, ids) => {
    const list = ids || ['serjeant', 'pavisier', 'crossbow', 'surgeon'];
    return list.slice(0, size).map((defId, i) => ({
      defId, name: 'S' + i, hp: CLASSES[defId].hp, id: i + 1,
    }));
  };
  for (let f = 0; f < FLOORS.length; f++) {
    for (const kind of ['fight', 'elite', 'boss']) {
      for (const size of (opts.sizes || [2, 3, 4])) {
        let wins = 0, rounds = 0, surv = 0, hpFrac = 0, noFight = 0, timeouts = 0;
        for (let i = 0; i < n; i++) {
          // seed varies per battle -- a fixed seed is one run reported n times
          const r = simOne({
            seed: (opts.seed || 1234) + i * 7919 + f * 104729 + size * 1299709 + kind.length * 31,
            floorIdx: f, kind, party: partyFor(size, opts.classes), relics: opts.relics || [],
          });
          if (r.won) wins++;
          rounds += r.rounds; surv += r.survivors;
          hpFrac += r.hpMax ? r.hpLeft / r.hpMax : 0;
          if (r.playerDamage === 0 || r.enemyDamage === 0) noFight++;
          if (r.timedOut) timeouts++;
        }
        rows.push({
          floor: f + 1, kind, party: size,
          winPct: Math.round(wins / n * 100),
          avgRounds: +(rounds / n).toFixed(1),
          avgSurvivors: +(surv / n).toFixed(2),
          hpLeftPct: Math.round(hpFrac / n * 100),
          SUSPECT_noContact: noFight, timeouts,
        });
      }
    }
  }
  const out = { runsPerCell: n, cells: rows.length, ms: Math.round(performance.now() - t0), rows };
  console.table(rows);
  return out;
}
