// COUNTERMINE -- board rendering. Canvas draws the battlefield only; every
// panel, menu and button is DOM, which is far easier to keep looking good.
import { GW, GH, T, tileAt, occupant, hasStatus, getStatus } from './engine.js';
import { unitSprite, floorTile, wallTile, mudTile, shade } from './art.js';

export const TILE = 52;
export const PAD_TOP = 34;
export const CW = GW * TILE;
export const CH = GH * TILE + PAD_TOP;

export function tileToPx(x, y) { return { px: x * TILE, py: y * TILE + PAD_TOP }; }
export function pxToTile(px, py) {
  return { x: Math.floor(px / TILE), y: Math.floor((py - PAD_TOP) / TILE) };
}

const now = () => performance.now();

export function draw(ctx, st, view) {
  const pal = view.palette || { floor: '#2b2724', wall: '#43392f', accent: '#6a4a2f' };
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = '#0b0908';
  ctx.fillRect(0, 0, CW, CH);

  const t = now();

  // ---- tiles
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const tile = st.grid[y][x];
      const { px, py } = tileToPx(x, y);
      if (tile.t === T.WALL) {
        ctx.drawImage(wallTile(TILE, pal.wall, tile.rubbleSeed), px, py);
      } else if (tile.t === T.PIT) {
        ctx.fillStyle = '#050404';
        ctx.fillRect(px, py, TILE, TILE);
        const gr = ctx.createRadialGradient(px + TILE / 2, py + TILE / 2, 2, px + TILE / 2, py + TILE / 2, TILE * 0.7);
        gr.addColorStop(0, '#000');
        gr.addColorStop(1, shade(pal.floor, -14));
        ctx.fillStyle = gr;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
      } else if (tile.t === T.MUD) {
        ctx.drawImage(mudTile(TILE, shade(pal.floor, -6), tile.rubbleSeed), px, py);
      } else {
        ctx.drawImage(floorTile(TILE, pal.floor, tile.rubbleSeed), px, py);
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
  drawHatch(ctx, view.threat, '#a33b32', 0.30, 8);
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

  // ---- vignette. It is a dungeon; the edges should not be as lit as the
  // middle -- but the corners still have to be legible tiles, not mud.
  const vg = ctx.createRadialGradient(CW / 2, CH / 2, CH * 0.5, CW / 2, CH / 2, CH * 1.15);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, CW, CH);

  // ---- hover cursor
  if (view.hover && view.hover.x >= 0 && view.hover.y >= 0 && view.hover.x < GW && view.hover.y < GH) {
    const { px, py } = tileToPx(view.hover.x, view.hover.y);
    ctx.strokeStyle = 'rgba(230,225,210,0.75)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
  }
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
  const { px, py } = tileToPx(u.x, u.y);
  const cx = px + TILE / 2, cy = py + TILE;
  const selected = view.selected === u.uid;
  const spent = u.side === 'player' && u.acted && st.phase === 'player';

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
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.6 + Math.sin(t / 200) * 0.3;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 5, 19, 8.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const spr = unitSprite(u.defId, u.custom);
  ctx.save();
  if (spent) ctx.globalAlpha = 0.45;
  const flash = st.fx.find(f => f.kind === 'hit' && f.x === u.x && f.y === u.y && f.t < 6);
  ctx.drawImage(spr, cx - spr.width / 2, cy - spr.height + 4);
  if (flash) {
    // Tint via a clipped re-draw of the sprite, NOT source-atop on the whole
    // canvas -- source-atop paints the bounding rectangle.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5;
    ctx.drawImage(spr, cx - spr.width / 2, cy - spr.height + 4);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();

  // health bar
  const barW = u.boss ? 44 : 30;
  const bx = cx - barW / 2, by = cy - (u.boss ? 78 : 60);
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(bx - 1, by - 1, barW + 2, 6);
  const frac = Math.max(0, u.hp / u.maxHp);
  ctx.fillStyle = u.side === 'player'
    ? (frac > 0.5 ? '#7f9b52' : frac > 0.25 ? '#c99a3e' : '#b8483a')
    : (frac > 0.5 ? '#9a4a42' : '#c0603a');
  ctx.fillRect(bx, by, barW * frac, 4);
  if (u.armor > 0) {
    ctx.fillStyle = '#8fa4b8';
    ctx.fillRect(bx + barW + 2, by, 3, 4);
  }

  // status pips
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
    ctx.fillRect(bx + i * 5, by - 6, 4, 4);
  });

  // wind-up marker over the caster
  if (u.windup) {
    ctx.save();
    ctx.globalAlpha = 0.7 + Math.sin(t / 150) * 0.3;
    ctx.fillStyle = '#e8452f';
    ctx.font = 'bold 15px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('!', cx, by - 9);
    ctx.restore();
  }

  // crossbow load state
  if (u.usesLoad) {
    ctx.fillStyle = (u.loaded || u.freeShot) ? '#cbb27a' : '#4a4038';
    ctx.fillRect(bx + barW - 8, by - 6, 8, 3);
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
        ctx.font = 'bold 17px "Courier New", monospace';
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
