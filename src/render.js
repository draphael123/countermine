// COUNTERMINE -- board rendering. Canvas draws the battlefield only; every
// panel, menu and button is DOM, which is far easier to keep looking good.
import { GW, GH, T, tileAt, occupant, hasStatus, getStatus } from './engine.js';
import { unitSprite, floorTile, wallTile, mudTile, shade, decalTile, FLOOR_DECALS, propTile } from './art.js';

export const TILE = 52;
export const PAD_TOP = 34;
export const CW = GW * TILE;
export const CH = GH * TILE + PAD_TOP;

export function tileToPx(x, y) { return { px: x * TILE, py: y * TILE + PAD_TOP }; }
export function pxToTile(px, py) {
  return { x: Math.floor(px / TILE), y: Math.floor((py - PAD_TOP) / TILE) };
}

const now = () => performance.now();

// per-floor atmosphere particles: drips (floor 2), rising embers (floor 3)
const parts = [];
function drawFloorParticles(ctx, floorN, t) {
  if (floorN === 2) {
    if (parts.length < 5 && Math.random() < 0.02) {
      parts.push({ kind: 'drip', x: 40 + Math.random() * (CW - 80), y: 0, v: 5 + Math.random() * 3, t: 0 });
    }
  } else if (floorN === 3) {
    if (parts.length < 22 && Math.random() < 0.25) {
      parts.push({ kind: 'ember', x: 20 + Math.random() * (CW - 40), y: CH + 4,
        v: 0.5 + Math.random() * 0.9, drift: Math.random() * 6.28, t: 0, dur: 260 + Math.random() * 200 });
    }
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t++;
    if (p.kind === 'drip') {
      p.y += p.v * 3;
      if (p.y >= CH - 30) {
        // splash ring, then gone
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#9cc4c0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(p.x, CH - 28, (p.y - (CH - 30)) + 3, 2.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        if (p.y > CH - 12) parts.splice(i, 1);
      } else {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#bcd8d4';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 7);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
      }
    } else {
      p.y -= p.v;
      p.x += Math.sin(p.t / 40 + p.drift) * 0.4;
      const life = p.t / p.dur;
      if (life >= 1 || p.y < -4) { parts.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = 0.55 * (life < 0.1 ? life * 10 : 1 - life);
      ctx.fillStyle = life > 0.55 ? '#8a4f22' : '#e0904a';
      ctx.fillRect(p.x, p.y, 1.8, 1.8);
      ctx.restore();
    }
  }
}

// one soft blob sheet, tiled and scrolled two ways for depth
let hazeCv = null;
function hazeSheet() {
  if (hazeCv) return hazeCv;
  hazeCv = document.createElement('canvas');
  hazeCv.width = 420; hazeCv.height = 260;
  const g = hazeCv.getContext('2d');
  let s = 977;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < 9; i++) {
    const x = rnd() * 420, y = rnd() * 260, rr = 45 + rnd() * 80;
    const gr = g.createRadialGradient(x, y, 4, x, y, rr);
    gr.addColorStop(0, 'rgba(196,186,168,0.55)');
    gr.addColorStop(1, 'rgba(196,186,168,0)');
    g.fillStyle = gr;
    g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  return hazeCv;
}

// Where a unit is DRAWN this frame -- its logical tile eased through any
// pending walk/hop. Everything that draws at a unit (shadows, bars, torch
// pools) uses this, or the sprite slides while its chrome teleports.
function drawPos(u, t) {
  const base = tileToPx(u.x, u.y);
  let px = base.px, py = base.py;
  if (u.anim) {
    // Clamp at BOTH ends: staggered entrance marches start in the future, and
    // a negative progress indexed path[-1] and crashed the frame loop.
    const p = Math.max(0, (t - u.anim.start) / u.anim.dur);
    if (p >= 1) { u.anim = null; }
    else if (u.anim.kind === 'walk') {
      const path = u.anim.path;
      const f = p * (path.length - 1);
      const i = Math.max(0, Math.min(path.length - 2, Math.floor(f)));
      const k = f - i;
      const ax = path[i].x + (path[i + 1].x - path[i].x) * k;
      const ay = path[i].y + (path[i + 1].y - path[i].y) * k;
      const q = tileToPx(ax, ay);
      px = q.px; py = q.py;
      // step bounce
      py -= Math.abs(Math.sin(f * Math.PI)) * 3;
    } else if (u.anim.kind === 'hop') {
      const e = 1 - (1 - p) * (1 - p); // ease-out
      const q0 = tileToPx(u.anim.fx, u.anim.fy);
      px = q0.px + (base.px - q0.px) * e;
      py = q0.py + (base.py - q0.py) * e - Math.sin(p * Math.PI) * 14;
    }
  }
  if (u.lunge) {
    const p = (t - u.lunge.start) / u.lunge.dur;
    if (p >= 1) { u.lunge = null; }
    else {
      const amp = Math.sin(p * Math.PI) * 13;
      px += u.lunge.dx * amp;
      py += u.lunge.dy * amp;
    }
  }
  return { px, py };
}

export function draw(ctx, st, view) {
  const pal = view.palette || { floor: '#2b2724', wall: '#43392f', accent: '#6a4a2f' };
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = '#0b0908';
  ctx.fillRect(0, 0, CW, CH);

  const t = now();

  // ---- screen shake: consume shake fx into a decaying offset
  ctx.save();
  if (view.shakeEnabled !== false) {
    let mag = 0;
    for (const f of st.fx) {
      if (f.kind !== 'shake') continue;
      f.t = (f.t || 0) + 1;
      const life = 1 - f.t / 14;
      if (life > 0) mag = Math.max(mag, f.mag * life);
    }
    st.fx = st.fx.filter(f => f.kind !== 'shake' || f.t < 14);
    if (mag > 0.2) {
      ctx.translate((Math.random() - 0.5) * 2 * mag, (Math.random() - 0.5) * 2 * mag);
    }
  } else {
    st.fx = st.fx.filter(f => f.kind !== 'shake');
  }

  // ---- tiles
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const tile = st.grid[y][x];
      const { px, py } = tileToPx(x, y);
      if (tile.t === T.WALL) {
        if (tile.prop) ctx.drawImage(propTile(TILE, tile.prop, pal.floor, tile.rubbleSeed), px, py);
        else ctx.drawImage(wallTile(TILE, pal.wall, tile.rubbleSeed), px, py);
      } else if (tile.t === T.PIT) {
        // the shaft: floor-coloured rim collapsing into black, far lip lit
        ctx.drawImage(floorTile(TILE, pal.floor, tile.rubbleSeed), px, py);
        const cx2 = px + TILE / 2, cy2 = py + TILE / 2;
        const gr = ctx.createRadialGradient(cx2, cy2 + 3, 2, cx2, cy2, TILE * 0.62);
        gr.addColorStop(0, '#000');
        gr.addColorStop(0.72, 'rgba(4,3,3,0.96)');
        gr.addColorStop(1, 'rgba(4,3,3,0)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.ellipse(cx2, cy2, TILE * 0.46, TILE * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,236,205,0.10)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(cx2, cy2 + 1.5, TILE * 0.44, TILE * 0.40, 0, Math.PI * 0.08, Math.PI * 0.92);
        ctx.stroke();
        ctx.fillStyle = shade(pal.floor, -10);
        const rs = tile.rubbleSeed;
        for (let k = 0; k < 4; k++) {
          const a = (rs * 0.37 + k * 1.7) % 6.28;
          const rx2 = cx2 + Math.cos(a) * TILE * 0.44, ry2 = cy2 + Math.sin(a) * TILE * 0.40;
          ctx.fillRect(rx2 - 2, ry2 - 1.5, 4, 3);
        }
      } else if (tile.t === T.MUD) {
        ctx.drawImage(mudTile(TILE, shade(pal.floor, -6), tile.rubbleSeed), px, py);
        // standing water moves, barely: one travelling glint per tile
        const wph = (t / 900 + tile.rubbleSeed * 0.13) % 1;
        ctx.save();
        ctx.globalAlpha = 0.10 * Math.sin(wph * Math.PI);
        ctx.strokeStyle = '#bcd8d4';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        const wy = py + 8 + wph * (TILE - 16);
        ctx.moveTo(px + 7 + Math.sin(t / 700 + tile.rubbleSeed) * 3, wy);
        ctx.lineTo(px + TILE - 9, wy + 1.5);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.drawImage(floorTile(TILE, pal.floor, tile.rubbleSeed), px, py);
      }
    }
  }

  // ---- decals: quiet per-floor scatter (bones, rubble, moss, embers)
  const decals = FLOOR_DECALS[view.floorN] || FLOOR_DECALS[1];
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const tile = st.grid[y][x];
      const { px, py } = tileToPx(x, y);
      if (tile.t === T.FLOOR && tile.stain != null) {
        ctx.drawImage(decalTile(TILE, 'blood', tile.stain), px, py);
      }
      if (tile.t !== T.FLOOR || tile.rubbleSeed % 6 !== 0) continue;
      const kind = decals[(tile.rubbleSeed / 6 | 0) % decals.length];
      ctx.drawImage(decalTile(TILE, kind, tile.rubbleSeed), px, py);
    }
  }

  // ---- contact shadows: every open tile touching masonry darkens toward it.
  // This one pass is most of what makes the board read as a SPACE.
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (st.grid[y][x].t !== T.WALL) continue;
      const sides = [
        { dx: 0, dy: 1, w: TILE, h: 13, gx: 0, gy: 1, a: 0.40 },   // below: strongest
        { dx: 0, dy: -1, w: TILE, h: 8, gx: 0, gy: -1, a: 0.22 },
        { dx: -1, dy: 0, w: 9, h: TILE, gx: -1, gy: 0, a: 0.25 },
        { dx: 1, dy: 0, w: 9, h: TILE, gx: 1, gy: 0, a: 0.25 },
      ];
      for (const sd of sides) {
        const nb = tileAt(st, x + sd.dx, y + sd.dy);
        if (!nb || nb.t === T.WALL) continue;
        const { px, py } = tileToPx(x + sd.dx, y + sd.dy);
        let x0 = px, y0 = py, x1, y1;
        if (sd.dy === 1) { x1 = px; y1 = py + sd.h; }
        else if (sd.dy === -1) { y0 = py + TILE; x1 = px; y1 = py + TILE - sd.h; }
        else if (sd.dx === -1) { x0 = px + TILE; x1 = px + TILE - sd.w; y1 = py; }
        else { x1 = px + sd.w; y1 = py; }
        const sh = ctx.createLinearGradient(x0, y0, x1, y1);
        sh.addColorStop(0, 'rgba(0,0,0,' + sd.a + ')');
        sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sh;
        const rx = Math.min(x0, x1 === undefined ? x0 : x1), ry = Math.min(y0, y1 === undefined ? y0 : y1);
        if (sd.dy !== 0) ctx.fillRect(px, sd.dy === 1 ? py : py + TILE - sd.h, TILE, sd.h);
        else ctx.fillRect(sd.dx === -1 ? px + TILE - sd.w : px, py, sd.w, TILE);
      }
    }
  }

  // ---- wall torches. Deterministic from the tile seed so they never flicker
  // between frames or move when the board redraws.
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const tile = st.grid[y][x];
      if (tile.t !== T.WALL || tile.rubbleSeed % 7 !== 0) continue;
      const below = tileAt(st, x, y + 1);
      if (!below || below.t === T.WALL) continue;
      const { px, py } = tileToPx(x, y);
      const fx = px + TILE / 2, fy = py + TILE - 12;
      const flick = 0.82 + Math.sin(t / 90 + tile.rubbleSeed) * 0.1 + Math.sin(t / 37 + x) * 0.06;
      const gl = ctx.createRadialGradient(fx, fy, 3, fx, fy, TILE * 2.1 * flick);
      gl.addColorStop(0, 'rgba(255,176,86,0.30)');
      gl.addColorStop(0.45, 'rgba(230,130,50,0.10)');
      gl.addColorStop(1, 'rgba(230,130,50,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(px - TILE * 2, py - TILE * 2, TILE * 5, TILE * 5);
      ctx.fillStyle = '#241a12';
      ctx.fillRect(fx - 2, fy - 2, 4, 12);
      ctx.fillStyle = 'rgba(255,190,110,' + (0.75 * flick).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(fx, fy - 5, 3.4 * flick, 6 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,190,' + (0.85 * flick).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(fx, fy - 4, 1.6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- deploy zone
  if (st.phase === 'deploy') {
    ctx.save();
    ctx.globalAlpha = 0.22 + Math.sin(t / 400) * 0.05;
    ctx.fillStyle = '#7fd0c0';
    for (const d of st.deployZone) {
      const { px, py } = tileToPx(d.x, d.y);
      ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    }
    ctx.restore();
  }

  // ---- threat overlay. The hatch MUST be clipped to the threatened tiles:
  // unclipped diagonals run a full tile past their own square and the whole
  // board floods red.
  drawHatch(ctx, view.threat, '#a33b32', 0.20, 9);
  drawHatch(ctx, view.threatFocus, '#e8452f', 0.62, 6);

  // ---- move / target overlays
  if (view.moveTiles) {
    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = '#4d86a8';
    for (const m of view.moveTiles) {
      const { px, py } = tileToPx(m.x, m.y);
      ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(140,200,230,0.5)';
    ctx.lineWidth = 1;
    for (const m of view.moveTiles) {
      const { px, py } = tileToPx(m.x, m.y);
      ctx.strokeRect(px + 1.5, py + 1.5, TILE - 3, TILE - 3);
    }
    ctx.restore();
  }
  if (view.hoverPreview) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#c9a86a';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    for (const m of view.hoverPreview) {
      const { px, py } = tileToPx(m.x, m.y);
      ctx.strokeRect(px + 3, py + 3, TILE - 6, TILE - 6);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
  if (view.targetTiles) {
    const pulse = 0.30 + Math.sin(t / 260) * 0.09;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = view.targetColour || '#c25a3e';
    for (const m of view.targetTiles) {
      const { px, py } = tileToPx(m.x, m.y);
      ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
    }
    ctx.restore();
  }
  if (view.aoePreview) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#e08a3c';
    for (const m of view.aoePreview) {
      const { px, py } = tileToPx(m.x, m.y);
      ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
    }
    ctx.restore();
  }

  // ---- wind-up telegraphs. Colour, not alpha: a dimmer red on top of a red
  // threat hatch is invisible, a different hue is not.
  const pulse = 0.35 + Math.sin(t / 180) * 0.18;
  for (const u of st.units) {
    if (!u.alive || !u.windup) continue;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#e8452f';
    for (const p of u.windup.tiles) {
      const { px, py } = tileToPx(p.x, p.y);
      ctx.fillRect(px, py, TILE, TILE);
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = '#ffb08a';
    ctx.lineWidth = 2;
    for (const p of u.windup.tiles) {
      const { px, py } = tileToPx(p.x, p.y);
      ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
    }
    ctx.restore();
  }

  // ---- path preview
  if (view.path && view.path.length > 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(190,230,255,0.85)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    view.path.forEach((p, i) => {
      const { px, py } = tileToPx(p.x, p.y);
      const cx = px + TILE / 2, cy = py + TILE / 2;
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
    ctx.restore();
  }

  // ---- barricades
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const tile = st.grid[y][x];
      if (!tile.bar) continue;
      const { px, py } = tileToPx(x, y);
      const frac = tile.bar.hp / tile.bar.maxHp;
      ctx.fillStyle = tile.bar.planted ? '#6a5a3e' : '#453425';
      ctx.fillRect(px + 5, py + 14, TILE - 10, TILE - 24);
      ctx.fillStyle = tile.bar.planted ? '#867349' : '#57422e';
      ctx.fillRect(px + 5, py + 14, TILE - 10, 5);
      ctx.fillStyle = '#211a14';
      for (let i = 0; i < 3; i++) ctx.fillRect(px + 8 + i * 12, py + 14, 2, TILE - 24);
      ctx.fillStyle = '#0f0d0c';
      ctx.fillRect(px + 6, py + TILE - 12, TILE - 12, 3);
      ctx.fillStyle = frac > 0.5 ? '#8a9a5a' : '#a8613a';
      ctx.fillRect(px + 6, py + TILE - 12, (TILE - 12) * frac, 3);
    }
  }

  // ---- bombs
  for (const b of st.bombs) {
    const { px, py } = tileToPx(b.x, b.y);
    ctx.save();
    ctx.globalAlpha = 0.4 + Math.sin(t / 120) * 0.25;
    ctx.fillStyle = '#e0632a';
    ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.restore();
    ctx.fillStyle = '#2a1a12';
    ctx.beginPath();
    ctx.arc(px + TILE / 2, py + TILE / 2 + 4, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffca6a';
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(b.fuse), px + TILE / 2, py + TILE / 2 + 9);
  }

  // ---- units, back to front
  const order = st.units.filter(u => u.alive).slice().sort((a, b) => a.y - b.y);
  for (const u of order) drawUnit(ctx, st, u, view, t);

  // ---- fx
  drawFx(ctx, st);

  // ---- the Breach is open to the sky somewhere: one shaft of day, floor 1 only
  if (view.floorN === 1 && !view.reducedMotion) {
    const sx0 = CW * 0.60, wTop = 54, lean = 90;
    ctx.save();
    const lg = ctx.createLinearGradient(sx0 + lean * 0.5, 0, sx0 + lean * 0.5 + 40, CH);
    lg.addColorStop(0, 'rgba(255,244,214,0.10)');
    lg.addColorStop(0.75, 'rgba(255,244,214,0.035)');
    lg.addColorStop(1, 'rgba(255,244,214,0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(sx0, 0);
    ctx.lineTo(sx0 + wTop, 0);
    ctx.lineTo(sx0 + wTop + lean + 26, CH);
    ctx.lineTo(sx0 + lean - 26, CH);
    ctx.closePath();
    ctx.fill();
    // dust motes drifting down the beam
    ctx.fillStyle = '#fff2d8';
    for (let i = 0; i < 12; i++) {
      const ph = (t / (2600 + i * 173) + i * 0.37) % 1;
      const mx = sx0 + 10 + ((i * 37) % (wTop + 10)) + ph * lean;
      const my = ph * CH;
      ctx.globalAlpha = 0.28 * Math.sin(ph * Math.PI) * (0.6 + Math.sin(t / 460 + i * 1.9) * 0.4);
      ctx.fillRect(mx, my, 1.6, 1.6);
    }
    ctx.restore();
  }

  // ---- underground air: two sheets of haze drifting at different speeds
  if (!view.reducedMotion) {
  const hz = hazeSheet();
  ctx.save();
  ctx.globalAlpha = 0.05;
  const off1 = (t / 210) % hz.width, off2 = (t / 350) % hz.width;
  for (let hx = -1; hx < CW / hz.width + 1; hx++) {
    ctx.drawImage(hz, hx * hz.width + off1 - hz.width, 20);
    ctx.drawImage(hz, hx * hz.width - off2, CH * 0.4);
  }
  ctx.restore();
  }

  // ---- floor atmospheres: drips in the Sump, rising embers in the Countermine
  if (!view.reducedMotion) drawFloorParticles(ctx, view.floorN, t);

  // ---- vignette. It is a dungeon; the edges should not be as lit as the
  // middle -- but the corners still have to be legible tiles, not mud.
  const vg = ctx.createRadialGradient(CW / 2, CH / 2, CH * 0.5, CW / 2, CH / 2, CH * 1.15);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, CW, CH);

  // ---- boss bar: the floor's master gets a real bar with a name
  const boss = st.units.find(u => u.alive && u.boss);
  if (boss) {
    const bw = CW * 0.44, bx = CW / 2 - bw / 2, by = 10;
    if (boss.hpShown == null) boss.hpShown = boss.hp;
    ctx.save();
    ctx.font = '11px "Iowan Old Style", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c8a898';
    ctx.fillText(boss.name.toUpperCase(), CW / 2, by - 1);
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(bx - 1, by + 2, bw + 2, 9);
    const bfrac = Math.max(0, boss.hp / boss.maxHp);
    const bghost = Math.max(0, boss.hpShown / boss.maxHp);
    if (bghost > bfrac) {
      ctx.fillStyle = 'rgba(232,164,140,0.8)';
      ctx.fillRect(bx + bw * bfrac, by + 3, bw * (bghost - bfrac), 7);
    }
    const bg2 = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    bg2.addColorStop(0, '#7a2f24');
    bg2.addColorStop(1, '#a8412f');
    ctx.fillStyle = bg2;
    ctx.fillRect(bx, by + 3, bw * bfrac, 7);
    ctx.strokeStyle = '#3a2a22';
    ctx.strokeRect(bx - 1.5, by + 1.5, bw + 3, 10);
    ctx.restore();
  }

  // ---- the enemy currently taking its turn
  if (st.phase === 'enemy' && st.actingUid) {
    const au = st.units.find(u => u.uid === st.actingUid && u.alive);
    if (au) {
      const { px, py } = drawPos(au, t);
      const bob = Math.sin(t / 130) * 3;
      ctx.save();
      ctx.fillStyle = '#e8b5a0';
      ctx.beginPath();
      ctx.moveTo(px + TILE / 2 - 7, py - (au.boss ? 52 : 36) + bob);
      ctx.lineTo(px + TILE / 2 + 7, py - (au.boss ? 52 : 36) + bob);
      ctx.lineTo(px + TILE / 2, py - (au.boss ? 44 : 28) + bob);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ---- damage forecast chip over the hovered target
  if (view.forecast) {
    const fc = view.forecast;
    const { px, py } = tileToPx(fc.x, fc.y);
    const label = fc.min + '–' + fc.max + (fc.flank ? ' +flank' : '');
    ctx.save();
    ctx.font = 'bold 12px "Courier New", monospace';
    const wLabel = ctx.measureText(label).width + (fc.kill ? 26 : 14);
    const chipX = Math.max(2, Math.min(CW - wLabel - 2, px + TILE / 2 - wLabel / 2));
    const chipY = Math.max(2, py - 26);
    ctx.fillStyle = 'rgba(12,9,7,0.92)';
    ctx.fillRect(chipX, chipY, wLabel, 18);
    ctx.strokeStyle = fc.kill ? '#a8412f' : '#6b5741';
    ctx.strokeRect(chipX + 0.5, chipY + 0.5, wLabel - 1, 17);
    ctx.fillStyle = fc.kill ? '#e8a08a' : '#e8d9bc';
    ctx.textAlign = 'left';
    ctx.fillText(label, chipX + 7, chipY + 13);
    if (fc.kill) {
      // a small skull: circle + jaw + eyes
      const sx2 = chipX + wLabel - 13, sy2 = chipY + 8;
      ctx.fillStyle = '#e8d9bc';
      ctx.beginPath(); ctx.arc(sx2, sy2, 4.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(sx2 - 3, sy2 + 2, 6, 3);
      ctx.fillStyle = '#12100c';
      ctx.fillRect(sx2 - 2.6, sy2 - 1.4, 1.8, 2);
      ctx.fillRect(sx2 + 0.8, sy2 - 1.4, 1.8, 2);
    }
    ctx.restore();
  }

  // ---- hover cursor
  if (view.hover && view.hover.x >= 0 && view.hover.y >= 0 && view.hover.x < GW && view.hover.y < GH) {
    const { px, py } = tileToPx(view.hover.x, view.hover.y);
    ctx.strokeStyle = 'rgba(230,225,210,0.75)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
  }

  ctx.restore(); // shake translate
}

function drawHatch(ctx, set, colour, alpha, spacing) {
  if (!set || !set.size) return;
  ctx.save();
  ctx.beginPath();
  for (const key of set) {
    const x = key % GW, y = (key / GW) | 0;
    const { px, py } = tileToPx(x, y);
    ctx.rect(px, py, TILE, TILE);
  }
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = -CH; i < CW + CH; i += spacing) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + CH, CH);
  }
  ctx.stroke();
  ctx.restore();

  // an outline on the boundary makes the shape of the danger readable
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha + 0.25);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  for (const key of set) {
    const x = key % GW, y = (key / GW) | 0;
    const { px, py } = tileToPx(x, y);
    ctx.beginPath();
    if (!set.has(key - GW)) { ctx.moveTo(px, py + 0.5); ctx.lineTo(px + TILE, py + 0.5); }
    if (!set.has(key + GW)) { ctx.moveTo(px, py + TILE - 0.5); ctx.lineTo(px + TILE, py + TILE - 0.5); }
    if (x === 0 || !set.has(key - 1)) { ctx.moveTo(px + 0.5, py); ctx.lineTo(px + 0.5, py + TILE); }
    if (x === GW - 1 || !set.has(key + 1)) { ctx.moveTo(px + TILE - 0.5, py); ctx.lineTo(px + TILE - 0.5, py + TILE); }
    ctx.stroke();
  }
  ctx.restore();
}

function drawUnit(ctx, st, u, view, t) {
  const { px, py } = drawPos(u, t);
  const cx = px + TILE / 2;
  // idle bob: barely-there breathing so a still board is not a dead board
  const cy = py + TILE + Math.sin(t / 520 + u.uid * 1.7) * 1.2;
  const selected = view.selected === u.uid;
  const spent = u.side === 'player' && u.acted && st.phase === 'player';

  if (u.boss) {
    const br = ctx.createRadialGradient(cx, cy - 8, 4, cx, cy - 8, TILE * 1.3);
    br.addColorStop(0, 'rgba(200,60,40,0.16)');
    br.addColorStop(1, 'rgba(200,60,40,0)');
    ctx.fillStyle = br;
    ctx.fillRect(cx - TILE * 1.4, cy - TILE * 1.6, TILE * 2.8, TILE * 2.8);
  }

  // torch pool under friendly units so the party reads as the lit thing
  if (u.side === 'player') {
    const gr = ctx.createRadialGradient(cx, cy - 8, 2, cx, cy - 8, TILE * 1.15);
    gr.addColorStop(0, 'rgba(255,178,96,0.16)');
    gr.addColorStop(1, 'rgba(255,178,96,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(cx - TILE * 1.2, cy - TILE * 1.4, TILE * 2.4, TILE * 2.4);
  }

  // ground shadow
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 5, 15, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // selection ring
  if (selected) {
    ctx.save();
    ctx.strokeStyle = '#ffd9a0';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -t / 28;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 5, 19, 8.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  let frame = 'idle';
  if (u.anim && u.anim.kind === 'walk') frame = (((t - u.anim.start) / 110) | 0) % 2 ? 'walkA' : 'walkB';
  const spr = unitSprite(u.defId, u.custom, frame);
  const face = u.face || (u.side === 'enemy' ? -1 : 1);
  ctx.save();
  if (spent) ctx.globalAlpha = 0.45;
  const flash = st.fx.find(f => f.kind === 'hit' && f.x === u.x && f.y === u.y && f.t < 6);
  ctx.translate(cx, cy);
  ctx.scale(face, 1);
  ctx.drawImage(spr, -spr.width / 2, -spr.height + 4);
  if (flash) {
    // Tint via a re-draw in lighter mode, NOT source-atop on the whole
    // canvas -- source-atop paints the bounding rectangle.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5;
    ctx.drawImage(spr, -spr.width / 2, -spr.height + 4);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();

  // ---- status effects ON the body -- pips tell you, these make you feel it
  if (hasStatus(u, 'burning')) {
    for (let i = 0; i < 3; i++) {
      const ph = t / 90 + u.uid * 2.1 + i * 2.3;
      const fx2 = cx - 8 + i * 8 + Math.sin(ph) * 2;
      const fy2 = cy - 26 - ((t / 14 + i * 37 + u.uid * 13) % 26);
      const fl = 0.5 + Math.sin(ph * 3) * 0.3;
      ctx.save();
      ctx.globalAlpha = fl * (1 - ((t / 14 + i * 37 + u.uid * 13) % 26) / 26);
      ctx.fillStyle = i % 2 ? '#ffb35c' : '#e06a20';
      ctx.beginPath();
      ctx.ellipse(fx2, fy2, 2.2, 3.6, Math.sin(ph) * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = 0.16 + Math.sin(t / 80 + u.uid) * 0.05;
    const bg2 = ctx.createRadialGradient(cx, cy - 22, 2, cx, cy - 22, 22);
    bg2.addColorStop(0, 'rgba(255,150,60,0.8)');
    bg2.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = bg2;
    ctx.fillRect(cx - 24, cy - 46, 48, 48);
    ctx.restore();
  }
  if (hasStatus(u, 'bleed')) {
    for (let i = 0; i < 2; i++) {
      const cyc = (t / 9 + i * 53 + u.uid * 29) % 34;
      ctx.save();
      ctx.globalAlpha = 0.7 * (1 - cyc / 34);
      ctx.fillStyle = '#8f1f16';
      ctx.fillRect(cx - 6 + i * 10, cy - 34 + cyc, 2, 4);
      ctx.restore();
    }
  }
  if (hasStatus(u, 'rallied')) {
    for (let i = 0; i < 3; i++) {
      const cyc = (t / 16 + i * 41 + u.uid * 17) % 30;
      ctx.save();
      ctx.globalAlpha = 0.6 * (1 - cyc / 30);
      ctx.fillStyle = '#e8c268';
      ctx.fillRect(cx - 10 + i * 9 + Math.sin(t / 300 + i) * 2, cy - 16 - cyc, 2, 2);
      ctx.restore();
    }
  }
  if (hasStatus(u, 'guarded')) {
    ctx.save();
    ctx.globalAlpha = 0.22 + Math.sin(t / 260 + u.uid) * 0.08;
    ctx.strokeStyle = '#8fc0e0';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 22, 19, 26, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha *= 0.4;
    ctx.fillStyle = '#8fc0e0';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 22, 19, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // health bar with damage ghosting: the pale chunk is what the last hit took.
  // Bosses use the big named bar at the canvas top instead.
  if (u.boss) { drawStatusPips(ctx, st, u, cx - 22, cy - 74); return; }
  const barW = 30;
  const bx = cx - barW / 2, by = cy - (u.boss ? 78 : 60);
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(bx - 1, by - 1, barW + 2, 6);
  if (u.hpShown == null) u.hpShown = u.hp;
  if (u.hpShown < u.hp) u.hpShown = u.hp;               // heals snap up
  else if (u.hpShown > u.hp) u.hpShown += (u.hp - u.hpShown) * 0.10; // damage drains
  if (u.hpShown - u.hp < 0.3) u.hpShown = u.hp;
  const frac = Math.max(0, u.hp / u.maxHp);
  const ghost = Math.max(0, u.hpShown / u.maxHp);
  if (ghost > frac) {
    ctx.fillStyle = 'rgba(232,164,140,0.85)';
    ctx.fillRect(bx + barW * frac, by, barW * (ghost - frac), 4);
  }
  ctx.fillStyle = u.side === 'player'
    ? (frac > 0.5 ? '#7f9b52' : frac > 0.25 ? '#c99a3e' : '#b8483a')
    : (frac > 0.5 ? '#9a4a42' : '#c0603a');
  ctx.fillRect(bx, by, barW * frac, 4);
  if (u.armor > 0) {
    ctx.fillStyle = '#8fa4b8';
    ctx.fillRect(bx + barW + 2, by, 3, 4);
  }

  drawStatusPips(ctx, st, u, bx, by - 6);
}

function drawStatusPips(ctx, st, u, bx, byTop) {
  const pips = [];
  if (hasStatus(u, 'rallied')) pips.push('#e0a83c');
  if (hasStatus(u, 'guarded')) pips.push('#7fb0d0');
  if (hasStatus(u, 'bleed')) pips.push('#b03030');
  if (hasStatus(u, 'burning')) pips.push('#e06a20');
  if (hasStatus(u, 'pinned')) pips.push('#9a7fd0');
  if (hasStatus(u, 'hasted')) pips.push('#7fd0a0');
  if (hasStatus(u, 'martyred')) pips.push('#d07fa0');
  if (hasStatus(u, 'taunting')) pips.push('#d4823c');
  pips.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(bx + i * 5, byTop, 4, 4);
  });

  // wind-up marker over the caster
  if (u.windup) {
    ctx.save();
    ctx.globalAlpha = 0.7 + Math.sin(performance.now() / 150) * 0.3;
    ctx.fillStyle = '#e8452f';
    ctx.font = 'bold 15px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('!', bx + 15, byTop - 5);
    ctx.restore();
  }

  // crossbow load state
  if (u.usesLoad) {
    ctx.fillStyle = (u.loaded || u.freeShot) ? '#cbb27a' : '#4a4038';
    ctx.fillRect(bx + 24, byTop, 8, 3);
  }
}

function drawFx(ctx, st) {
  const keep = [];
  for (const f of st.fx) {
    f.t = (f.t || 0) + 1;
    if (f.kind === 'hit' && f.amount != null) {
      const { px, py } = tileToPx(f.x, f.y);
      const life = f.t / 40;
      if (life < 1) {
        ctx.save();
        ctx.globalAlpha = 1 - life;
        const big = f.amount >= 10;
        ctx.font = 'bold ' + (big ? 22 : 16) + 'px "Courier New", monospace';
        if (f.t < 5) { // impact chips on the first frames
          ctx.fillStyle = f.side === 'player' ? 'rgba(200,80,60,0.8)' : 'rgba(220,200,170,0.8)';
          for (let ci = 0; ci < 4; ci++) {
            const a = ci * 1.57 + f.x * 0.7;
            const rr = 6 + f.t * 2.6;
            ctx.fillRect(px + TILE / 2 + Math.cos(a) * rr, py + TILE / 2 - 6 + Math.sin(a) * rr, 2.5, 2.5);
          }
        }
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        const s = '-' + f.amount;
        ctx.strokeText(s, px + TILE / 2, py + 22 - life * 26);
        ctx.fillStyle = f.side === 'player' ? '#ff8a7a' : '#ffe0a0';
        ctx.fillText(s, px + TILE / 2, py + 22 - life * 26);
        ctx.restore();
        keep.push(f);
      }
    } else if (f.kind === 'slash') {
      const life = f.t / 11;
      if (life < 1) {
        const { px, py } = tileToPx(f.x, f.y);
        const cx2 = px + TILE / 2, cy2 = py + TILE / 2 - 8;
        const baseA = Math.atan2(f.dy, f.dx);
        ctx.save();
        ctx.translate(cx2, cy2);
        ctx.rotate(baseA);
        ctx.globalAlpha = (1 - life) * 0.9;
        ctx.strokeStyle = '#f2e6cc';
        ctx.lineWidth = 3.2 * (1 - life * 0.5);
        ctx.beginPath();
        // a crescent swept across the target as the swing lands
        ctx.arc(-10, 0, 17, -1.15 + life * 1.9, -0.25 + life * 1.9);
        ctx.stroke();
        ctx.globalAlpha = (1 - life) * 0.35;
        ctx.lineWidth = 7 * (1 - life * 0.5);
        ctx.beginPath();
        ctx.arc(-10, 0, 15, -1.0 + life * 1.9, -0.35 + life * 1.9);
        ctx.stroke();
        ctx.restore();
        keep.push(f);
      }
    } else if (f.kind === 'fall') {
      const life = f.t / 30;
      if (life < 1) {
        const { px, py } = tileToPx(f.x, f.y);
        const spr2 = unitSprite(f.defId, f.custom, 'idle');
        ctx.save();
        ctx.globalAlpha = 0.9 * (1 - life * life);
        ctx.translate(px + TILE / 2, py + TILE);
        ctx.scale(f.face || 1, 1);
        ctx.rotate(Math.min(1, life * 1.6) * Math.PI / 2);
        ctx.drawImage(spr2, -spr2.width / 2, -spr2.height + 4);
        ctx.restore();
        keep.push(f);
      }
    } else if (f.kind === 'trace') {
      const life = f.t / 13;
      if (life < 1) {
        const a = tileToPx(f.x1, f.y1), b = tileToPx(f.x2, f.y2);
        ctx.save();
        ctx.globalAlpha = (1 - life) * 0.9;
        ctx.strokeStyle = f.col || '#d8c9a3';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const head = Math.min(1, life * 2.4);
        ctx.moveTo(a.px + TILE / 2 + (b.px - a.px) * Math.max(0, head - 0.35), a.py + TILE / 2 - 14 + (b.py - a.py) * Math.max(0, head - 0.35));
        ctx.lineTo(a.px + TILE / 2 + (b.px - a.px) * head, a.py + TILE / 2 - 14 + (b.py - a.py) * head);
        ctx.stroke();
        ctx.restore();
        keep.push(f);
      }
    } else if (f.kind === 'heal') {
      const { px, py } = tileToPx(f.x, f.y);
      const life = f.t / 40;
      if (life < 1) {
        ctx.save();
        ctx.globalAlpha = 1 - life;
        ctx.font = 'bold 17px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
        ctx.strokeText('+' + f.amount, px + TILE / 2, py + 22 - life * 26);
        ctx.fillStyle = '#9fe08a';
        ctx.fillText('+' + f.amount, px + TILE / 2, py + 22 - life * 26);
        ctx.restore();
        keep.push(f);
      }
    } else if (f.kind === 'boom' || f.kind === 'sweep') {
      const life = f.t / 18;
      if (life < 1) {
        ctx.save();
        ctx.globalAlpha = (1 - life) * 0.8;
        ctx.fillStyle = f.kind === 'boom' ? '#ffb45a' : '#dcdcd0';
        const tiles = f.tiles || [{ x: f.x, y: f.y }];
        for (const p of tiles) {
          const { px, py } = tileToPx(p.x, p.y);
          ctx.fillRect(px, py, TILE, TILE);
        }
        ctx.restore();
        keep.push(f);
      }
    } else if (f.kind === 'death') {
      const life = f.t / 30;
      if (life < 1) {
        const { px, py } = tileToPx(f.x, f.y);
        ctx.save();
        ctx.globalAlpha = (1 - life) * 0.9;
        ctx.fillStyle = f.side === 'player' ? '#b8483a' : '#5a4038';
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const r = life * 26;
          ctx.fillRect(px + TILE / 2 + Math.cos(a) * r, py + TILE / 2 + Math.sin(a) * r, 4, 4);
        }
        ctx.restore();
        keep.push(f);
      }
    }
  }
  st.fx = keep;
}
