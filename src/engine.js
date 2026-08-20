// COUNTERMINE -- battle engine. Deterministic apart from damage rolls, and the
// dice are seeded so a balance sweep can pin them (same seed, same fight).
import { ABILITIES, CLASSES, ENEMIES, BOSSES } from './data.js';

export const GW = 16, GH = 11;
export const FLANK_BONUS = 3;

// --------------------------------------------------------------------- rng
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function makeRng(seed) {
  // State lives here, not inside a closure we can't reach: a saved run has to
  // serialize the RNG mid-stream or the dungeon re-rolls on every resume.
  let a = seed >>> 0;
  const r = function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  return {
    next: r,
    getState: () => a >>> 0,
    setState: (s) => { a = s >>> 0; },
    int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}

// ------------------------------------------------------------------- tiles
export const T = { FLOOR: 0, WALL: 1, MUD: 2, PIT: 3 };

export function inBounds(x, y) { return x >= 0 && y >= 0 && x < GW && y < GH; }
export function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

// ------------------------------------------------------------- battle setup
let UID = 1;

export function makeUnit(defId, side, x, y, opts = {}) {
  // opts.def lets the player's created captain supply its own stat block.
  const def = opts.def || (side === 'player' ? CLASSES[defId] : (ENEMIES[defId] || BOSSES[defId]));
  if (!def) throw new Error('unknown unit def: ' + defId);
  const u = {
    uid: UID++, defId, side, def,
    name: opts.name || def.name,
    x, y,
    maxHp: (opts.maxHp || def.hp) + (opts.hpBonus || 0),
    hp: (opts.maxHp || def.hp) + (opts.hpBonus || 0),
    mov: def.mov,
    armor: def.armor + (opts.armorBonus || 0),
    range: def.range, minRange: def.minRange || 1,
    atk: def.atk.slice(),
    abilities: def.abilities.slice(),
    cds: {}, statuses: [], charges: {},
    acted: false, moved: false, startX: x, startY: y,
    loaded: !!def.reload, usesLoad: !!def.reload,
    boss: !!def.boss, summoned: !!opts.summoned,
    custom: opts.custom || null, isCaptain: !!def.isCaptain,
    alive: true, kills: 0, dmgDealt: 0, dmgTaken: 0,
  };
  if (opts.hp != null) u.hp = Math.min(opts.hp, u.maxHp);
  for (const aid of u.abilities) {
    const ab = ABILITIES[aid];
    if (ab && ab.charges) u.charges[aid] = ab.charges + (opts.charBonus || 0);
  }
  return u;
}

export function newBattle(cfg) {
  // cfg: { seed, floor, party:[{defId,name,hp,...}], enemies:[defId], relics:[], kind }
  const rng = makeRng(cfg.seed);
  const st = {
    seed: cfg.seed, rng,
    floor: cfg.floor, kind: cfg.kind || 'fight',
    grid: null, units: [], bombs: [], fx: [],
    phase: 'deploy', round: 1, log: [],
    relics: new Set(cfg.relics || []),
    deployZone: [], selected: null, over: null,
    turnEvents: [],
  };
  st.grid = generateMap(rng, cfg.floor, st.kind);

  const hasSally = st.relics.has('sallyport');
  const zoneW = 2, zoneX0 = hasSally ? 1 : 0;
  for (let x = zoneX0; x < zoneX0 + zoneW; x++) {
    for (let y = 0; y < GH; y++) {
      if (st.grid[y][x].t === T.FLOOR && !st.grid[y][x].bar) st.deployZone.push({ x, y });
    }
  }

  // place party
  const spots = rng.shuffle(st.deployZone.slice()).sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const mid = Math.floor(GH / 2);
  const ordered = st.deployZone.slice().sort((a, b) =>
    (Math.abs(a.y - mid) - Math.abs(b.y - mid)) || (b.x - a.x));
  cfg.party.forEach((p, i) => {
    const s = ordered[i] || spots[i] || { x: 1, y: 1 + i };
    const u = makeUnit(p.defId, 'player', s.x, s.y, {
      name: p.name, def: p.def, custom: p.custom, maxHp: p.maxHp,
      hpBonus: (st.relics.has('rations') ? 5 : 0),
      armorBonus: (st.relics.has('scraps') ? 1 : 0),
      charBonus: (st.relics.has('tourniquet') ? 1 : 0),
    });
    u.hp = Math.min(u.maxHp, p.hp != null ? p.hp + (st.relics.has('rations') ? 5 : 0) : u.maxHp);
    u.persistId = p.id;
    if (st.relics.has('quarrels') && u.usesLoad) u.freeShot = true;
    st.units.push(u);
  });

  // Place enemies on the right side, but ONLY on tiles the party can walk to.
  // An enemy in a sealed pocket makes the battle unwinnable with no visible
  // cause -- the win check just never fires.
  const walkable = floodOpen(st.grid);
  const eSpots = [];
  for (let x = GW - 1; x >= Math.floor(GW * 0.55); x--) {
    for (let y = 0; y < GH; y++) {
      const t = st.grid[y][x];
      if (t.t !== T.WALL && t.t !== T.PIT && !t.bar && walkable[y][x]) eSpots.push({ x, y });
    }
  }
  if (!eSpots.length) {
    for (let y = 0; y < GH; y++) for (let x = GW - 1; x >= 2; x--) {
      if (walkable[y][x]) eSpots.push({ x, y });
    }
  }
  const shuffled = rng.shuffle(eSpots);
  cfg.enemies.forEach((eid, i) => {
    const s = shuffled[i % shuffled.length];
    const def = ENEMIES[eid] || BOSSES[eid];
    let sx = s.x, sy = s.y;
    if (def && def.boss) { sx = GW - 3; sy = Math.floor(GH / 2); }
    if (occupant(st, sx, sy)) {
      const free = shuffled.find(p => !occupant(st, p.x, p.y));
      if (free) { sx = free.x; sy = free.y; }
    }
    st.units.push(makeUnit(eid, 'enemy', sx, sy));
  });

  st.phase = 'deploy';
  return st;
}

// --------------------------------------------------------------- map making
function generateMap(rng, floor, kind) {
  const g = [];
  for (let y = 0; y < GH; y++) {
    const row = [];
    for (let x = 0; x < GW; x++) row.push({ t: T.FLOOR, bar: null, rubbleSeed: rng.int(0, 999) });
    g.push(row);
  }
  const put = (x, y, t) => { if (inBounds(x, y)) g[y][x].t = t; };

  // Walls: clumps of collapsed masonry, kept off the deploy columns and away
  // from the far column so nothing ever spawns sealed in.
  const clumps = kind === 'boss' ? 3 : rng.int(4, 7);
  for (let i = 0; i < clumps; i++) {
    const cx = rng.int(3, GW - 3), cy = rng.int(0, GH - 1);
    const w = rng.int(1, 2), h = rng.int(1, 3);
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) {
      if (rng.chance(0.82)) put(cx + dx, cy + dy, T.WALL);
    }
  }
  // Sump water / mud patches
  const pools = rng.int(2, 5);
  for (let i = 0; i < pools; i++) {
    const cx = rng.int(2, GW - 2), cy = rng.int(0, GH - 1);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (rng.chance(0.55) && inBounds(cx + dx, cy + dy) && g[cy + dy][cx + dx].t === T.FLOOR) {
        g[cy + dy][cx + dx].t = T.MUD;
      }
    }
  }
  // Shafts. Fatal to walk into, so they are never adjacent to a deploy column.
  if (kind !== 'boss') {
    const pits = rng.int(0, 3);
    for (let i = 0; i < pits; i++) {
      const cx = rng.int(4, GW - 3), cy = rng.int(0, GH - 1);
      if (g[cy][cx].t === T.FLOOR) g[cy][cx].t = T.PIT;
      if (rng.chance(0.5) && inBounds(cx, cy + 1) && g[cy + 1][cx].t === T.FLOOR) g[cy + 1][cx].t = T.PIT;
    }
  }
  // Set pieces: one landmark per map, flavoured to the floor. They are WALL
  // tiles with their own art -- they block like masonry, they just aren't.
  const placeProp = (kinds) => {
    for (let tries = 0; tries < 24; tries++) {
      const x = rng.int(4, GW - 2 - kinds.length), y = rng.int(1, GH - 2);
      let ok = true;
      for (let k = 0; k < kinds.length; k++) {
        if (g[y][x + k].t !== T.FLOOR || g[y][x + k].bar) ok = false;
      }
      if (!ok) continue;
      for (let k = 0; k < kinds.length; k++) {
        g[y][x + k].t = T.WALL;
        g[y][x + k].prop = kinds[k];
      }
      return true;
    }
    return false;
  };
  if (kind !== 'boss') {
    if (floor.n === 1) {
      if (rng.chance(0.65)) placeProp(['gateL', 'gateR']);
      if (rng.chance(0.5)) placeProp(['ram']);
    } else if (floor.n === 2) {
      if (rng.chance(0.7)) placeProp(['altar']);
    } else {
      if (rng.chance(0.6)) placeProp(['forge']);
      if (rng.chance(0.6)) placeProp(['column']);
      if (rng.chance(0.4)) placeProp(['column']);
    }
  }

  // Standing barricades from the old assault
  const bars = rng.int(2, 5);
  for (let i = 0; i < bars; i++) {
    const cx = rng.int(4, GW - 4), cy = rng.int(0, GH - 1);
    const vert = rng.chance(0.5);
    const len = rng.int(1, 3);
    for (let k = 0; k < len; k++) {
      const x = cx + (vert ? 0 : k), y = cy + (vert ? k : 0);
      if (inBounds(x, y) && g[y][x].t === T.FLOOR && !g[y][x].bar) g[y][x].bar = { hp: 8, maxHp: 8 };
    }
  }
  // Clear the deploy columns entirely.
  for (let x = 0; x < 2; x++) for (let y = 0; y < GH; y++) { g[y][x].t = T.FLOOR; g[y][x].bar = null; }
  ensureConnected(g);
  return g;
}

export function floodOpen(g) {
  const seen = Array.from({ length: GH }, () => new Array(GW).fill(false));
  const q = [{ x: 0, y: 0 }];
  seen[0][0] = true;
  while (q.length) {
    const c = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy;
      if (!inBounds(nx, ny) || seen[ny][nx]) continue;
      const t = g[ny][nx];
      if (t.t === T.WALL || t.t === T.PIT || t.bar) continue;
      seen[ny][nx] = true; q.push({ x: nx, y: ny });
    }
  }
  return seen;
}

function ensureConnected(g) {
  // Dig a lane out of any OPEN pocket that the deploy column cannot reach.
  // Walls are unreachable by definition -- treating "not flooded" as "must be
  // dug out" deleted every wall on every map, and the game shipped with no
  // cover and no line-of-sight blocking at all.
  for (let pass = 0; pass < 4; pass++) {
    const seen = floodOpen(g);
    let stranded = null;
    for (let y = 0; y < GH && !stranded; y++) {
      for (let x = 0; x < GW; x++) {
        const t = g[y][x];
        const open = t.t !== T.WALL && t.t !== T.PIT && !t.bar;
        if (open && !seen[y][x]) { stranded = { x, y }; break; }
      }
    }
    if (!stranded) return;
    // walk left toward the deploy side, opening whatever is in the way
    for (let x = stranded.x; x >= 0; x--) {
      const t = g[stranded.y][x];
      if (t.t === T.WALL) { t.t = T.FLOOR; }
      t.bar = null;
      if (t.t === T.PIT) t.t = T.FLOOR;
      if (floodOpen(g)[stranded.y][x]) break;
    }
  }
}

// ------------------------------------------------------------------ queries
export function occupant(st, x, y) {
  return st.units.find(u => u.alive && u.x === x && u.y === y) || null;
}
export function tileAt(st, x, y) { return inBounds(x, y) ? st.grid[y][x] : null; }

export function passable(st, x, y, forUnit) {
  const t = tileAt(st, x, y);
  if (!t || t.t === T.WALL || t.t === T.PIT) return false;
  if (t.bar) return false;
  const o = occupant(st, x, y);
  if (o && forUnit && o.side !== forUnit.side) return false;
  return true;
}
export function stepCost(st, x, y) {
  const t = tileAt(st, x, y);
  return t && t.t === T.MUD ? 2 : 1;
}

// Dijkstra over small ints. Returns {cost, prev} maps keyed y*GW+x.
export function distanceField(st, unit, maxCost = Infinity, opts = {}) {
  const cost = new Float64Array(GW * GH).fill(Infinity);
  const prev = new Int32Array(GW * GH).fill(-1);
  const s = unit.y * GW + unit.x;
  cost[s] = 0;
  const frontier = [s];
  while (frontier.length) {
    let bi = 0;
    for (let i = 1; i < frontier.length; i++) if (cost[frontier[i]] < cost[frontier[bi]]) bi = i;
    const cur = frontier.splice(bi, 1)[0];
    const cx = cur % GW, cy = (cur / GW) | 0;
    if (cost[cur] > maxCost) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const t = st.grid[ny][nx];
      if (t.t === T.WALL || t.t === T.PIT || t.bar) continue;
      const o = occupant(st, nx, ny);
      if (o && o.side !== unit.side && !opts.ignoreUnits) continue;
      const nc = cost[cur] + stepCost(st, nx, ny);
      const ni = ny * GW + nx;
      if (nc < cost[ni] && nc <= maxCost) { cost[ni] = nc; prev[ni] = cur; frontier.push(ni); }
    }
  }
  return { cost, prev };
}

export function reachableTiles(st, unit) {
  if (hasStatus(unit, 'pinned')) return [];
  const mv = unit.mov + (hasStatus(unit, 'hasted') ? 2 : 0) + (unit.movBonus || 0);
  const { cost } = distanceField(st, unit, mv);
  const out = [];
  for (let i = 0; i < cost.length; i++) {
    if (!isFinite(cost[i])) continue;
    const x = i % GW, y = (i / GW) | 0;
    if (x === unit.x && y === unit.y) continue;
    if (occupant(st, x, y)) continue;
    out.push({ x, y, cost: cost[i] });
  }
  return out;
}

export function pathTo(st, unit, tx, ty) {
  const mv = unit.mov + (hasStatus(unit, 'hasted') ? 2 : 0) + (unit.movBonus || 0);
  const { cost, prev } = distanceField(st, unit, mv);
  const goal = ty * GW + tx;
  if (!isFinite(cost[goal])) return null;
  const path = [];
  let c = goal;
  while (c !== -1) { path.push({ x: c % GW, y: (c / GW) | 0 }); c = prev[c]; }
  return path.reverse();
}

export function hasLOS(st, ax, ay, bx, by) {
  if (ax === bx && ay === by) return true;
  let x0 = ax, y0 = ay;
  const dx = Math.abs(bx - ax), dy = Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
  let err = dx - dy;
  let guard = 0;
  while (guard++ < 200) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    else if (e2 < dx) { err += dx; y0 += sy; }
    if (x0 === bx && y0 === by) return true;
    const t = tileAt(st, x0, y0);
    if (!t) return false;
    if (t.t === T.WALL || t.bar) return false;
  }
  return false;
}

export function inAttackRange(st, u, tx, ty, range, minRange) {
  const d = Math.abs(u.x - tx) + Math.abs(u.y - ty);
  if (d < (minRange || 1) || d > range) return false;
  if (range > 1 && !hasLOS(st, u.x, u.y, tx, ty)) return false;
  return true;
}

export function attackTargets(st, u, opts = {}) {
  const range = opts.range != null ? opts.range : u.range;
  const minR = opts.minRange != null ? opts.minRange : u.minRange;
  const out = [];
  for (const t of st.units) {
    if (!t.alive || t.side === u.side) continue;
    if (inAttackRange(st, u, t.x, t.y, range, minR)) out.push(t);
  }
  // barricades are legal melee targets
  if (!opts.noStructures) {
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const t = st.grid[y][x];
      if (t.bar && inAttackRange(st, u, x, y, range, minR)) out.push({ structure: true, x, y, bar: t.bar });
    }
  }
  return out;
}

// ------------------------------------------------------------------ statuses
export function hasStatus(u, id) { return u.statuses.some(s => s.id === id); }
export function getStatus(u, id) { return u.statuses.find(s => s.id === id); }
export function addStatus(u, id, dur, val, extra) {
  const ex = getStatus(u, id);
  if (ex) { ex.dur = Math.max(ex.dur, dur); ex.val = Math.max(ex.val || 0, val || 0); if (extra) Object.assign(ex, extra); return; }
  u.statuses.push(Object.assign({ id, dur, val: val || 0 }, extra || {}));
}
export function clearStatus(u, id) { u.statuses = u.statuses.filter(s => s.id !== id); }

// ------------------------------------------------------------------- combat
export function flankTile(attacker, target) {
  const dx = target.x - attacker.x, dy = target.y - attacker.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  return { x: target.x + dx, y: target.y + dy };
}

export function isFlanking(st, attacker, target, dist) {
  if (dist !== 1) return false;
  const ft = flankTile(attacker, target);
  if (!ft) return false;
  const o = occupant(st, ft.x, ft.y);
  return !!(o && o.side === attacker.side);
}

// Returns {min,max} shown in the UI, and roll() used by resolution.
export function damageProfile(st, attacker, target, opts = {}) {
  const base = opts.dmg || attacker.atk;
  const dist = Math.abs(attacker.x - target.x) + Math.abs(attacker.y - target.y);
  let flat = 0;
  if (hasStatus(attacker, 'rallied')) flat += 3;
  if (isFlanking(st, attacker, target, dist)) {
    flat += (st.relics.has('flensing') ? FLANK_BONUS * 2 : FLANK_BONUS)
      + (attacker.def.flankBonus || 0);
  }
  if (attacker.side === 'player') {
    if (st.relics.has('wedge') && (target.armor || 0) > 0) flat += 3;
    if (st.relics.has('grudge') && dist >= 2) flat += 3;
  }
  const guard = target.statuses ? (getStatus(target, 'guarded')?.val || 0) : 0;
  const armor = opts.pierce ? 0 : (target.armor || 0);
  const min = Math.max(1, base[0] + flat - armor - guard);
  const max = Math.max(1, base[1] + flat - armor - guard);
  return { min, max, flat, armor, guard, flanking: isFlanking(st, attacker, target, dist) };
}

export function applyDamage(st, target, amount, source, opts = {}) {
  if (target.structure) {
    const t = st.grid[target.y][target.x];
    if (!t.bar) return 0;
    t.bar.hp -= opts.pierce ? t.bar.hp : amount;
    st.fx.push({ kind: 'hit', x: target.x, y: target.y, t: 0, amount });
    if (t.bar.hp <= 0) { t.bar = null; logLine(st, 'The barricade comes apart.'); }
    return amount;
  }
  // Martyr redirect. noRedirect breaks the cycle when two units protect each
  // other -- without it any damage to either is infinite recursion.
  const m = opts.noRedirect ? null : getStatus(target, 'martyred');
  if (m && m.protector) {
    const p = st.units.find(u => u.uid === m.protector && u.alive);
    if (p && p !== target) {
      logLine(st, p.name + ' takes it instead.');
      return applyDamage(st, p, amount, source, Object.assign({}, opts, { noRedirect: true }));
    }
  }
  target.hp -= amount;
  target.dmgTaken += amount;
  if (amount >= 6) st.fx.push({ kind: 'shake', mag: Math.min(7, 1 + amount * 0.4), t: 0 });
  if (source) source.dmgDealt += amount;
  st.fx.push({ kind: 'hit', x: target.x, y: target.y, t: 0, amount, side: target.side });
  if (target.hp <= 0) killUnit(st, target, source);
  return amount;
}

export function killUnit(st, target, source) {
  if (!target.alive) return;
  target.alive = false;
  target.hp = 0;
  const gt = tileAt(st, target.x, target.y);
  if (gt && gt.t === T.FLOOR) gt.stain = (target.uid * 37 + 11) % 997;
  st.fx.push({ kind: 'death', x: target.x, y: target.y, t: 0, side: target.side });
  st.fx.push({ kind: 'fall', x: target.x, y: target.y, defId: target.defId, custom: target.custom,
    face: target.face || (target.side === 'enemy' ? -1 : 1), t: 0 });
  st.fx.push({ kind: 'shake', mag: 5, t: 0 });
  logLine(st, target.name + ' falls.');
  if (source && source.side !== target.side) {
    source.kills++;
    if (st.relics.has('whistle') && source.side === 'player') addStatus(source, 'hasted', 2, 0);
  }
  if (target.side === 'player' && st.relics.has('reliquary') && !st.reliquaryUsed) {
    st.reliquaryUsed = true;
    logLine(st, 'The reliquary cracks open.');
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const o = occupant(st, target.x + dx, target.y + dy);
      if (o && o.alive && o.side === 'enemy') applyDamage(st, o, 10, null, { pierce: true });
    }
  }
  checkOver(st);
}

export function logLine(st, s) {
  st.log.push(s);
  if (st.log.length > 60) st.log.shift();
}

export function checkOver(st) {
  const pAlive = st.units.some(u => u.alive && u.side === 'player');
  const eAlive = st.units.some(u => u.alive && u.side === 'enemy');
  if (!eAlive) { st.phase = 'won'; st.over = 'won'; }
  else if (!pAlive) { st.phase = 'lost'; st.over = 'lost'; }
}

// --------------------------------------------------------------- unit acting
// --------------------------------------------------------------- animation
let ANIM_SCALE = 1;
export function setAnimScale(v) { ANIM_SCALE = v; }
// Purely visual: logic teleports as before, the renderer eases toward it.
export function animWalk(u, path) {
  if (!path || path.length < 2) return;
  u.face = Math.sign(path[path.length - 1].x - path[0].x) || u.face || 1;
  u.anim = { kind: 'walk', path, start: performance.now(),
    dur: Math.min(430, 130 * (path.length - 1)) * ANIM_SCALE };
}
export function animHop(u, fx, fy) {
  u.face = Math.sign(u.x - fx) || u.face || 1;
  u.anim = { kind: 'hop', fx, fy, start: performance.now(), dur: 200 * ANIM_SCALE };
}
export function animLunge(u, tx, ty) {
  const d = Math.hypot(tx - u.x, ty - u.y) || 1;
  if (tx !== u.x) u.face = Math.sign(tx - u.x);
  u.lunge = { dx: (tx - u.x) / d, dy: (ty - u.y) / d, start: performance.now(), dur: 240 * ANIM_SCALE };
}

export function moveUnit(st, u, tx, ty) {
  const path = pathTo(st, u, tx, ty);
  if (!path) return false;
  u.path = path;
  animWalk(u, path);
  u.x = tx; u.y = ty;
  u.moved = true;
  return true;
}

export function basicAttack(st, u, target) {
  if (u.usesLoad && !u.loaded) return { ok: false, why: 'not loaded' };
  if (u.usesLoad) st.fx.push({ kind: 'snd', s: 'bow' });
  if (u.isCaptain && u.custom && u.custom.weapon) {
    const ws = { maul: 'heavy', knife: 'pierce', staff: 'fire', shield: 'thunk', pole: 'sweep' }[u.custom.weapon];
    if (ws) st.fx.push({ kind: 'snd', s: ws });
  }
  if (u.range > 1 && Math.abs(u.x - target.x) + Math.abs(u.y - target.y) > 1) {
    st.fx.push({ kind: 'trace', x1: u.x, y1: u.y, x2: target.x, y2: target.y, col: '#d8c9a3', t: 0 });
  } else {
    st.fx.push({ kind: 'slash', x: target.x, y: target.y, dx: Math.sign(target.x - u.x), dy: Math.sign(target.y - u.y), t: 0 });
  }
  animLunge(u, target.x, target.y);
  const prof = damageProfile(st, u, target, {});
  const roll = st.rng.int(prof.min, prof.max);
  applyDamage(st, target, roll, u, {});
  if (st.relics.has('oil') && u.side === 'player' && !target.structure && target.alive) {
    addStatus(target, 'burning', 2, 3);
  }
  logLine(st, u.name + ' hits ' + (target.structure ? 'the barricade' : target.name)
    + ' for ' + roll + (prof.flanking ? ' (flanked)' : '') + '.');
  if (u.usesLoad) {
    if (u.freeShot) { u.freeShot = false; } else { u.loaded = false; }
  }
  finishAction(st, u);
  return { ok: true, roll };
}

export function reload(st, u) {
  u.loaded = true;
  st.fx.push({ kind: 'snd', s: 'reload' });
  logLine(st, u.name + ' winds the bow.');
  finishAction(st, u);
}

export function wait(st, u) { finishAction(st, u); }

export function finishAction(st, u) {
  u.acted = true;
  u.movBonus = 0;
  checkOver(st);
}

export function abilityReady(u, aid) {
  const ab = ABILITIES[aid];
  if (!ab) return false; // the captain has one ability; hotkey [2] asks for a second
  if ((u.cds[aid] || 0) > 0) return false;
  if (ab.charges && (u.charges[aid] || 0) <= 0) return false;
  if (ab.needsLoad && u.usesLoad && !u.loaded && !u.freeShot) return false;
  return true;
}

// Legal target tiles for an ability, as {x,y} list.
export function abilityTargets(st, u, aid) {
  const ab = ABILITIES[aid];
  const out = [];
  const R = ab.range || 0;
  if (ab.target === 'self') return [{ x: u.x, y: u.y }];
  if (ab.target === 'dir') {
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: u.x + dx, y: u.y + dy, dir: [dx, dy] }))
      .filter(p => inBounds(p.x, p.y));
  }
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const d = Math.abs(u.x - x) + Math.abs(u.y - y);
    if (d > R || d < (ab.minRange || 0)) continue;
    if (ab.target !== 'tile' && d > 1 && !hasLOS(st, u.x, u.y, x, y)) continue;
    const o = occupant(st, x, y);
    if (ab.target === 'enemy' && !(o && o.side !== u.side)) continue;
    if (ab.target === 'ally' && !(o && o.side === u.side && o !== u)) continue;
    if (ab.target === 'tile') {
      const t = tileAt(st, x, y);
      if (!t) continue;
      if (ab.kind === 'blink') { if (!passable(st, x, y, u) || o) continue; }
      else if (ab.kind === 'place_barricade') { if (t.t !== T.FLOOR || t.bar || o) continue; }
      else if (ab.kind === 'bomb') { if (t.t === T.WALL) continue; }
    }
    out.push({ x, y });
  }
  return out;
}

export function useAbility(st, u, aid, tx, ty, dir) {
  const ab = ABILITIES[aid];
  if (!ab) return { ok: false };
  const res = resolveAbility(st, u, aid, ab, tx, ty, dir);
  u.cds[aid] = ab.cd;
  if (ab.charges) u.charges[aid] = (u.charges[aid] || 0) - 1;
  if (ab.needsLoad && u.usesLoad) {
    if (u.freeShot) u.freeShot = false; else u.loaded = false;
  }
  if (!res || res.endsTurn !== false) finishAction(st, u);
  return { ok: true };
}

function coneTiles(u, dir) {
  const [dx, dy] = dir;
  const px = dy, py = dx; // perpendicular
  return [
    { x: u.x + dx, y: u.y + dy },
    { x: u.x + dx * 2, y: u.y + dy * 2 },
    { x: u.x + dx * 2 + px, y: u.y + dy * 2 + py },
    { x: u.x + dx * 2 - px, y: u.y + dy * 2 - py },
  ].filter(p => inBounds(p.x, p.y));
}

export function resolveAbility(st, u, aid, ab, tx, ty, dir) {
  const target = occupant(st, tx, ty);
  switch (ab.kind) {
    case 'attack': {
      const tgt = target || (tileAt(st, tx, ty)?.bar ? { structure: true, x: tx, y: ty } : null);
      if (!tgt) return;
      if ((ab.range || 1) > 1 && Math.abs(u.x - tx) + Math.abs(u.y - ty) > 1) {
        st.fx.push({ kind: 'trace', x1: u.x, y1: u.y, x2: tx, y2: ty,
          col: ab.status === 'burning' ? '#e08a3c' : '#d8c9a3', t: 0 });
      }
      animLunge(u, tx, ty);
      const prof = damageProfile(st, u, tgt, { dmg: ab.dmg, pierce: ab.pierce });
      const roll = st.rng.int(prof.min, prof.max);
      applyDamage(st, tgt, roll, u, { pierce: ab.pierce });
      if (ab.status && tgt.alive) addStatus(tgt, ab.status, ab.dur, ab.val);
      logLine(st, u.name + ' uses ' + ab.name + ' for ' + roll + '.');
      return;
    }
    case 'buff': {
      if (!target) return;
      st.fx.push({ kind: 'snd', s: 'buff' });
      addStatus(target, ab.status, ab.dur, ab.val);
      logLine(st, u.name + ' rallies ' + target.name + '.');
      return;
    }
    case 'aura_buff': {
      st.fx.push({ kind: 'snd', s: 'buff' });
      if (ab.selfDmg) applyDamage(st, u, ab.selfDmg, null, { pierce: true, self: true });
      for (const o of st.units) {
        if (!o.alive || o.side !== u.side) continue;
        if (Math.abs(o.x - u.x) + Math.abs(o.y - u.y) <= ab.radius) addStatus(o, ab.status, ab.dur, ab.val);
      }
      logLine(st, u.name + ' uses ' + ab.name + '.');
      return;
    }
    case 'aura_guard': {
      st.fx.push({ kind: 'snd', s: 'buff' });
      const val = aid === 'shield_wall' ? 4 : 3;
      for (const o of st.units) {
        if (!o.alive || o.side !== u.side) continue;
        if (Math.abs(o.x - u.x) + Math.abs(o.y - u.y) <= ab.radius) addStatus(o, 'guarded', ab.dur + 1, val);
      }
      logLine(st, u.name + ' braces the line.');
      return;
    }
    case 'heal': {
      if (!target) return;
      const bonus = st.relics.has('tourniquet') ? 4 : 0;
      const amt = st.rng.int(ab.amount[0], ab.amount[1]) + bonus;
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + amt);
      st.fx.push({ kind: 'heal', x: target.x, y: target.y, t: 0, amount: target.hp - before });
      logLine(st, u.name + ' stitches ' + target.name + ' for ' + (target.hp - before) + '.');
      return;
    }
    case 'cleanse': {
      if (!target) return;
      st.fx.push({ kind: 'snd', s: 'buff' });
      clearStatus(target, 'bleed'); clearStatus(target, 'pinned'); clearStatus(target, 'burning');
      addStatus(target, 'hasted', 2, 0);
      logLine(st, target.name + ' drinks and steadies.');
      return;
    }
    case 'place_barricade': {
      st.fx.push({ kind: 'snd', s: 'thunk' });
      st.grid[ty][tx].bar = { hp: ab.hp, maxHp: ab.hp, planted: true };
      logLine(st, u.name + ' plants the pavise.');
      return;
    }
    case 'bomb': {
      st.fx.push({ kind: 'snd', s: 'thunk' });
      st.bombs.push({ x: tx, y: ty, fuse: ab.fuse + 1, radius: ab.radius, dmg: ab.dmg, owner: u.uid });
      logLine(st, u.name + ' sets a charge.');
      return;
    }
    case 'pull': {
      if (!target) return;
      st.fx.push({ kind: 'snd', s: 'thunk' });
      animLunge(u, tx, ty);
      const prof = damageProfile(st, u, target, { dmg: ab.dmg });
      const roll = st.rng.int(prof.min, prof.max);
      applyDamage(st, target, roll, u, {});
      if (target.alive) {
        const dx = Math.sign(u.x - target.x), dy = Math.sign(u.y - target.y);
        const nx = target.x + (Math.abs(u.x - target.x) >= Math.abs(u.y - target.y) ? dx : 0);
        const ny = target.y + (Math.abs(u.x - target.x) >= Math.abs(u.y - target.y) ? 0 : dy);
        const t = tileAt(st, nx, ny);
        if (t && t.t === T.PIT) { logLine(st, target.name + ' goes into the shaft.'); killUnit(st, target, u); }
        else if (t && t.t !== T.WALL && !t.bar && !occupant(st, nx, ny)) { const ofx = target.x, ofy = target.y; target.x = nx; target.y = ny; animHop(target, ofx, ofy); }
      }
      logLine(st, u.name + ' hooks ' + target.name + ' for ' + roll + '.');
      return;
    }
    case 'cone': {
      animLunge(u, u.x + (dir ? dir[0] : 1), u.y + (dir ? dir[1] : 0));
      const tiles = coneTiles(u, dir || [1, 0]);
      let any = false;
      for (const p of tiles) {
        const o = occupant(st, p.x, p.y);
        const bar = tileAt(st, p.x, p.y)?.bar;
        const tgt = (o && o.side !== u.side) ? o : (bar ? { structure: true, x: p.x, y: p.y } : null);
        if (!tgt) continue;
        const prof = damageProfile(st, u, tgt, { dmg: ab.dmg });
        applyDamage(st, tgt, st.rng.int(prof.min, prof.max), u, {});
        any = true;
      }
      st.fx.push({ kind: 'sweep', tiles, t: 0 });
      logLine(st, u.name + ' sweeps the lane' + (any ? '.' : ' and hits nothing.'));
      return;
    }
    case 'blink': {
      const bfx = u.x, bfy = u.y;
      u.x = tx; u.y = ty;
      animHop(u, bfx, bfy);
      logLine(st, u.name + ' slips through.');
      return { endsTurn: false };
    }
    case 'oath': {
      st.fx.push({ kind: 'snd', s: 'buff' });
      addStatus(u, 'guarded', ab.dur + 1, ab.guard);
      addStatus(u, 'taunting', ab.dur + 1, 0);
      logLine(st, u.name + ' swears the iron oath. Everything nearby wants them now.');
      return;
    }
    case 'martyr': {
      if (!target) return;
      addStatus(target, 'martyred', ab.dur + 1, 0, { protector: u.uid });
      logLine(st, u.name + ' takes ' + target.name + "'s wounds.");
      return;
    }
    case 'leap': {
      if (!target) return;
      const spots = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy }))
        .filter(p => passable(st, p.x, p.y, u) && !occupant(st, p.x, p.y));
      if (!spots.length) return;
      const s = spots[0];
      const lfx = u.x, lfy = u.y;
      u.x = s.x; u.y = s.y;
      animHop(u, lfx, lfy);
      const prof = damageProfile(st, u, target, { dmg: ab.dmg });
      const roll = st.rng.int(prof.min, prof.max);
      applyDamage(st, target, roll, u, {});
      logLine(st, u.name + ' leaps onto ' + target.name + ' for ' + roll + '.');
      return;
    }
    case 'summon': {
      let made = 0;
      const spots = [];
      for (let r = 1; r <= 3 && spots.length < ab.count; r++) {
        for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) + Math.abs(dy) !== r) continue;
          const x = u.x + dx, y = u.y + dy;
          if (passable(st, x, y, u) && !occupant(st, x, y)) spots.push({ x, y });
        }
      }
      for (const s of spots.slice(0, ab.count)) {
        st.units.push(makeUnit(ab.unit, 'enemy', s.x, s.y, { summoned: true }));
        made++;
      }
      logLine(st, u.name + ' calls up ' + made + ' more.');
      return;
    }
    case 'windup': {
      // handled by AI: sets u.windup instead of resolving now
      return;
    }
  }
}

// ------------------------------------------------------------ phase plumbing
export function startPlayerPhase(st) {
  st.phase = 'player';
  st.actingUid = null;
  for (const u of st.units) {
    if (!u.alive || u.side !== 'player') continue;
    u.acted = false; u.moved = false; u.startX = u.x; u.startY = u.y;
    tickUnitStart(st, u);
  }
  checkOver(st);
}

export function endPlayerPhase(st) {
  if (st.phase !== 'player') return;
  st.phase = 'enemy';
  for (const u of st.units) {
    if (u.alive && u.side === 'enemy') { u.acted = false; u.moved = false; tickUnitStart(st, u); }
  }
  st.enemyQueue = st.units.filter(u => u.alive && u.side === 'enemy')
    .sort((a, b) => (b.def.threat || 0) - (a.def.threat || 0)).map(u => u.uid);
  checkOver(st);
}

function tickUnitStart(st, u) {
  u.movBonus = u.movBonus || 0;
  for (const aid of Object.keys(u.cds)) if (u.cds[aid] > 0) u.cds[aid]--;
  const bleed = getStatus(u, 'bleed');
  if (bleed) applyDamage(st, u, bleed.val, null, { pierce: true });
  const burn = getStatus(u, 'burning');
  if (burn && u.alive) applyDamage(st, u, burn.val, null, { pierce: true });
  u.statuses = u.statuses.map(s => Object.assign(s, { dur: s.dur - 1 })).filter(s => s.dur > 0);
}

// Steps one enemy. Returns false when the enemy phase is finished.
export function enemyActOne(st) {
  if (st.phase !== 'enemy') return false;
  if (!st.enemyQueue) st.enemyQueue = [];
  while (st.enemyQueue.length) {
    const uid = st.enemyQueue.shift();
    const u = st.units.find(x => x.uid === uid);
    if (!u || !u.alive) continue;
    st.actingUid = u.uid;
    aiTakeTurn(st, u);
    checkOver(st);
    return true;
  }
  // end of enemy phase: bombs tick
  tickBombs(st);
  checkOver(st);
  if (st.phase === 'enemy') { st.round++; startPlayerPhase(st); }
  return false;
}

function tickBombs(st) {
  const left = [];
  for (const b of st.bombs) {
    b.fuse--;
    if (b.fuse > 0) { left.push(b); continue; }
    logLine(st, 'The charge goes off.');
    st.fx.push({ kind: 'boom', x: b.x, y: b.y, r: b.radius, t: 0 });
    st.fx.push({ kind: 'shake', mag: 9, t: 0 });
    for (let dx = -b.radius; dx <= b.radius; dx++) {
      for (let dy = -b.radius; dy <= b.radius; dy++) {
        const x = b.x + dx, y = b.y + dy;
        if (!inBounds(x, y)) continue;
        const o = occupant(st, x, y);
        const roll = st.rng.int(b.dmg[0], b.dmg[1]);
        if (o) applyDamage(st, o, roll, null, { pierce: true });
        const t = st.grid[y][x];
        if (t.bar) t.bar = null;
        if (t.t === T.WALL && Math.abs(dx) + Math.abs(dy) <= 1) t.t = T.FLOOR;
      }
    }
  }
  st.bombs = left;
}

// ----------------------------------------------------------------------- AI
function playerUnits(st) { return st.units.filter(u => u.alive && u.side === 'player'); }

function aiTakeTurn(st, u) {
  // 1. A wind-up that was telegraphed last turn fires now, wherever you moved to.
  if (u.windup) {
    fireWindup(st, u);
    u.acted = true;
    return;
  }
  const foes = playerUnits(st);
  if (!foes.length) return;

  // 2. Abilities, best-first.
  for (const aid of u.abilities) {
    if ((u.cds[aid] || 0) > 0) continue;
    const ab = ABILITIES[aid];
    if (tryAbility(st, u, aid, ab, foes)) { u.acted = true; return; }
  }

  // 3. Move-and-attack: score every reachable tile.
  const spots = reachableTiles(st, u).concat([{ x: u.x, y: u.y, cost: 0 }]);
  let best = null;
  for (const s of spots) {
    const probe = { x: s.x, y: s.y, side: u.side, atk: u.atk, def: u.def, statuses: u.statuses };
    for (const f of foes) {
      const d = Math.abs(s.x - f.x) + Math.abs(s.y - f.y);
      if (d < u.minRange || d > u.range) continue;
      if (u.range > 1 && !hasLOS(st, s.x, s.y, f.x, f.y)) continue;
      const prof = damageProfile(st, Object.assign({}, u, { x: s.x, y: s.y }), f, {});
      const avg = (prof.min + prof.max) / 2;
      let score = avg * 10;
      if (avg >= f.hp) score += 400;                      // finish them
      score += (100 - (f.hp / f.maxHp) * 100) * 0.6;      // prefer wounded
      score -= s.cost * 0.5;
      // Iron Oath has to actually pull aggro or it is a worse Hold the Line.
      if (hasStatus(f, 'taunting')) score += 260;
      else if (st.units.some(o => o.alive && o.side === 'player' && hasStatus(o, 'taunting')
        && Math.abs(o.x - f.x) + Math.abs(o.y - f.y) <= 3)) score -= 220;
      if (u.defId === 'hound') score += (30 - f.maxHp) * 1.5; // hounds want the soft ones
      if (!best || score > best.score) best = { score, s, f };
    }
  }
  if (best) {
    if (best.s.x !== u.x || best.s.y !== u.y) moveUnit(st, u, best.s.x, best.s.y);
    const target = st.units.find(t => t.uid === best.f.uid);
    if (target && target.alive) {
      const prof = damageProfile(st, u, target, {});
      const roll = st.rng.int(prof.min, prof.max);
      applyDamage(st, target, roll, u, {});
      logLine(st, u.name + ' hits ' + target.name + ' for ' + roll + '.');
    }
    u.acted = true;
    return;
  }

  // 4. Nothing in reach: advance on the nearest one.
  advanceToward(st, u, foes);
  u.acted = true;
}

function advanceToward(st, u, foes) {
  let target = null, bestD = Infinity;
  for (const f of foes) {
    const d = Math.abs(u.x - f.x) + Math.abs(u.y - f.y);
    if (d < bestD) { bestD = d; target = f; }
  }
  if (!target) return;
  const { cost, prev } = distanceField(st, u, Infinity, { ignoreUnits: false });
  // walk toward the best adjacent-to-target tile we can path to
  const goals = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy }))
    .filter(p => inBounds(p.x, p.y) && isFinite(cost[p.y * GW + p.x]));
  if (!goals.length) {
    // shove toward it one axis at a time
    const dx = Math.sign(target.x - u.x), dy = Math.sign(target.y - u.y);
    for (const [ax, ay] of [[dx, 0], [0, dy]]) {
      if ((ax || ay) && passable(st, u.x + ax, u.y + ay, u) && !occupant(st, u.x + ax, u.y + ay)) {
        const nfx = u.x, nfy = u.y;
        u.x += ax; u.y += ay;
        animHop(u, nfx, nfy);
        return;
      }
    }
    return;
  }
  goals.sort((a, b) => cost[a.y * GW + a.x] - cost[b.y * GW + b.x]);
  const goal = goals[0];
  // reconstruct and walk as far as movement allows
  const path = [];
  let c = goal.y * GW + goal.x;
  while (c !== -1) { path.push(c); c = prev[c]; }
  path.reverse();
  const mv = u.mov + (hasStatus(u, 'hasted') ? 2 : 0);
  let spent = 0, last = null;
  for (let i = 1; i < path.length; i++) {
    const x = path[i] % GW, y = (path[i] / GW) | 0;
    const c2 = stepCost(st, x, y);
    if (spent + c2 > mv) break;
    if (occupant(st, x, y)) break;
    spent += c2; last = { x, y };
  }
  if (last) {
    // reconstruct the walked prefix so the AI slides instead of teleporting
    const wp = [{ x: u.x, y: u.y }];
    for (let i = 1; i < path.length; i++) {
      const x = path[i] % GW, y = (path[i] / GW) | 0;
      wp.push({ x, y });
      if (x === last.x && y === last.y) break;
    }
    u.x = last.x; u.y = last.y;
    animWalk(u, wp);
  }
}

function tryAbility(st, u, aid, ab, foes) {
  switch (aid) {
    case 'e_smash': {
      // step next to the densest cluster, then telegraph a 3x3
      const spots = reachableTiles(st, u).concat([{ x: u.x, y: u.y, cost: 0 }]);
      let best = null;
      for (const s of spots) {
        for (const f of foes) {
          if (Math.abs(s.x - f.x) + Math.abs(s.y - f.y) !== 1) continue;
          let n = 0;
          for (const g of foes) if (Math.abs(g.x - f.x) <= 1 && Math.abs(g.y - f.y) <= 1) n++;
          const score = n * 100 - s.cost;
          if (!best || score > best.score) best = { score, s, f };
        }
      }
      if (!best) return false;
      if (best.s.x !== u.x || best.s.y !== u.y) moveUnit(st, u, best.s.x, best.s.y);
      const tiles = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (inBounds(best.f.x + dx, best.f.y + dy)) tiles.push({ x: best.f.x + dx, y: best.f.y + dy });
      }
      u.windup = { aid, ab, tiles };
      st.fx.push({ kind: 'snd', s: 'warn' });
      u.cds[aid] = ab.cd;
      logLine(st, u.name + ' raises the maul.');
      return true;
    }
    case 'e_volley': {
      // pick the axis lane with the most bodies in it
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      let best = null;
      for (const [dx, dy] of dirs) {
        const tiles = [];
        let hits = 0;
        for (let k = 1; k <= ab.range; k++) {
          const x = u.x + dx * k, y = u.y + dy * k;
          if (!inBounds(x, y)) break;
          const t = st.grid[y][x];
          if (t.t === T.WALL || t.bar) break;
          tiles.push({ x, y });
          const o = occupant(st, x, y);
          if (o && o.side === 'player') hits++;
        }
        if (hits && (!best || hits > best.hits)) best = { hits, tiles };
      }
      if (!best) return false;
      u.windup = { aid, ab, tiles: best.tiles };
      st.fx.push({ kind: 'snd', s: 'warn' });
      u.cds[aid] = ab.cd;
      logLine(st, u.name + ' sights down the lane.');
      return true;
    }
    case 'e_collapse': {
      let best = null;
      for (let x = 0; x < GW; x++) {
        let hits = 0;
        for (const f of foes) if (f.x === x) hits++;
        if (hits && (!best || hits > best.hits)) best = { hits, x };
      }
      if (!best) return false;
      const tiles = [];
      for (let y = 0; y < GH; y++) tiles.push({ x: best.x, y });
      u.windup = { aid, ab, tiles };
      st.fx.push({ kind: 'snd', s: 'warn' });
      u.cds[aid] = ab.cd;
      logLine(st, u.name + ' sets its hands against the props.');
      return true;
    }
    case 'e_leap': {
      const cands = foes.filter(f => {
        const d = Math.abs(u.x - f.x) + Math.abs(u.y - f.y);
        return d >= 2 && d <= ab.range;
      }).sort((a, b) => (a.maxHp - b.maxHp) || (a.hp - b.hp));
      for (const f of cands) {
        const spots = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .map(([dx, dy]) => ({ x: f.x + dx, y: f.y + dy }))
          .filter(p => passable(st, p.x, p.y, u) && !occupant(st, p.x, p.y));
        if (spots.length) { useAbilityAI(st, u, aid, ab, f.x, f.y); return true; }
      }
      return false;
    }
    case 'e_goad': {
      let n = 0;
      for (const o of st.units) {
        if (o.alive && o.side === 'enemy' && o !== u
          && Math.abs(o.x - u.x) + Math.abs(o.y - u.y) <= ab.radius) n++;
      }
      if (n < 2) return false;
      useAbilityAI(st, u, aid, ab, u.x, u.y);
      return true;
    }
    case 'e_summon': {
      const live = st.units.filter(x => x.alive && x.side === 'enemy').length;
      if (live > 5) return false;
      useAbilityAI(st, u, aid, ab, u.x, u.y);
      return true;
    }
    case 'e_drag': {
      const cands = foes.filter(f => {
        const d = Math.abs(u.x - f.x) + Math.abs(u.y - f.y);
        return d >= (ab.minRange || 2) && d <= ab.range && hasLOS(st, u.x, u.y, f.x, f.y);
      }).sort((a, b) => a.hp - b.hp);
      if (!cands.length) return false;
      useAbilityAI(st, u, aid, ab, cands[0].x, cands[0].y);
      return true;
    }
  }
  return false;
}

function useAbilityAI(st, u, aid, ab, tx, ty) {
  resolveAbility(st, u, aid, ab, tx, ty, null);
  u.cds[aid] = ab.cd;
}

function fireWindup(st, u) {
  const { ab, tiles, aid } = u.windup;
  u.windup = null;
  st.fx.push({ kind: 'boom', tiles, t: 0 });
  logLine(st, u.name + ' brings it down.');
  for (const p of tiles) {
    const o = occupant(st, p.x, p.y);
    if (o) {
      const prof = damageProfile(st, u, o, { dmg: ab.dmg });
      applyDamage(st, o, st.rng.int(prof.min, prof.max), u, {});
    }
    const t = tileAt(st, p.x, p.y);
    if (t && t.bar) t.bar = null;
    if (aid === 'e_collapse' && t && t.t === T.FLOOR && !occupant(st, p.x, p.y) && st.rng.chance(0.25)) {
      t.t = T.WALL;
      const reach = floodOpen(st.grid);
      const stranded = st.units.some(x => x.alive && !reach[x.y][x.x]);
      if (stranded) t.t = T.FLOOR; // the roof holds rather than sealing anyone in
    }
  }
}

// Tiles the enemy side threatens next turn, for the player's overlay.
// Pass `only` to get a single enemy's reach instead of the whole side's.
export function threatMap(st, only) {
  const set = new Set();
  for (const u of (only ? [only] : st.units)) {
    if (!u.alive || u.side !== 'enemy') continue;
    if (u.windup) { for (const p of u.windup.tiles) set.add(p.y * GW + p.x); continue; }
    const spots = reachableTiles(st, u).concat([{ x: u.x, y: u.y }]);
    for (const s of spots) {
      for (let dx = -u.range; dx <= u.range; dx++) {
        for (let dy = -u.range; dy <= u.range; dy++) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < u.minRange || d > u.range) continue;
          const x = s.x + dx, y = s.y + dy;
          if (!inBounds(x, y)) continue;
          if (u.range > 1 && !hasLOS(st, s.x, s.y, x, y)) continue;
          set.add(y * GW + x);
        }
      }
    }
  }
  return set;
}
