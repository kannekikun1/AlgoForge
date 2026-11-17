/**
 * Draws a graph and its visualization state onto a 2D canvas context.
 *
 * Geometry (curved parallel edges, self-loops, arrowheads) is computed from a cached layout
 * index built by `buildIndex`, which only needs rebuilding when the graph's structure changes
 * (node positions are read live, so dragging does not require a rebuild).
 *
 * State is never conveyed by colour alone: discovered nodes use a dashed ring, visited a solid
 * ring, finalized a filled body, the current node a double outer ring, path elements a thick
 * double stroke, examined edges are dashed, rejected edges dotted, start/destination carry
 * "S"/"T" badges.
 */
export const NODE_R = 15;

const COLOR_KEYS = ['g-canvas', 'g-node', 'g-node-stroke', 'g-node-text', 'g-edge', 'g-edge-text', 'g-label-bg', 'g-discovered', 'g-visited', 'g-finalized', 'g-current', 'g-examined', 'g-tree', 'g-rejected', 'g-path', 'g-error', 'g-select', 'g-start', 'g-target', 'accent'];

export function readColors(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const out = {};
  for (const k of COLOR_KEYS) out[k] = cs.getPropertyValue(`--${k}`).trim() || '#888';
  return out;
}

/** Build lookup structures for drawing and hit testing. */
export function buildIndex(graph) {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const groups = new Map();
  for (const e of graph.edges) {
    if (e.source === e.target) continue;
    const key = e.source < e.target ? `${e.source}\u0000${e.target}` : `${e.target}\u0000${e.source}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const offset = new Map();
  for (const list of groups.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : 1));
    const k = list.length;
    list.forEach((e, i) => {
      let o = (i - (k - 1) / 2) * 26;
      // Keep curvature orientation stable regardless of edge direction.
      if (e.source > e.target) o = -o;
      offset.set(e.id, o);
    });
  }
  const loopCount = new Map();
  const loopIndex = new Map();
  for (const e of graph.edges) {
    if (e.source !== e.target) continue;
    const i = loopCount.get(e.source) ?? 0;
    loopIndex.set(e.id, i);
    loopCount.set(e.source, i + 1);
  }
  return { nodeById, offset, loopIndex };
}

/** Geometry of an edge: {kind:'line'|'curve'|'loop', ...}. */
export function edgeGeometry(e, index) {
  const a = index.nodeById.get(e.source);
  const b = index.nodeById.get(e.target);
  if (!a || !b) return null;
  if (a === b) {
    const i = index.loopIndex.get(e.id) ?? 0;
    const r = NODE_R * (0.75 + i * 0.35);
    const ang = -Math.PI / 2 + i * 0.9;
    const cx = a.x + Math.cos(ang) * (NODE_R + r * 0.7);
    const cy = a.y + Math.sin(ang) * (NODE_R + r * 0.7);
    return { kind: 'loop', cx, cy, r, ax: a.x, ay: a.y, lx: a.x + Math.cos(ang) * (NODE_R + r * 1.9), ly: a.y + Math.sin(ang) * (NODE_R + r * 1.9) };
  }
  const off = index.offset.get(e.id) ?? 0;
  const dx = b.x - a.x; const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; const ny = dx / len;
  const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
  if (Math.abs(off) < 0.01) {
    const ux = dx / len; const uy = dy / len;
    return {
      kind: 'line',
      x1: a.x + ux * NODE_R, y1: a.y + uy * NODE_R,
      x2: b.x - ux * NODE_R, y2: b.y - uy * NODE_R,
      lx: mx, ly: my, tx: ux, ty: uy,
    };
  }
  const cx = mx + nx * off * 2; const cy = my + ny * off * 2;
  const s = unit(cx - a.x, cy - a.y);
  const t = unit(b.x - cx, b.y - cy);
  return {
    kind: 'curve',
    x1: a.x + s[0] * NODE_R, y1: a.y + s[1] * NODE_R,
    x2: b.x - t[0] * NODE_R, y2: b.y - t[1] * NODE_R,
    cx, cy,
    lx: 0.25 * a.x + 0.5 * cx + 0.25 * b.x, ly: 0.25 * a.y + 0.5 * cy + 0.25 * b.y,
    tx: t[0], ty: t[1],
  };
}

function unit(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

function edgeBox(g) {
  if (g.kind === 'loop') return [g.cx - g.r, g.cy - g.r, g.cx + g.r, g.cy + g.r];
  const xs = [g.x1, g.x2, g.cx ?? g.x1]; const ys = [g.y1, g.y2, g.cy ?? g.y1];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Distance from a point to an edge's drawn geometry (world units). */
export function distanceToEdge(g, px, py) {
  if (g.kind === 'loop') return Math.abs(Math.hypot(px - g.cx, py - g.cy) - g.r);
  if (g.kind === 'line') return segDist(px, py, g.x1, g.y1, g.x2, g.y2);
  let best = Infinity;
  let prev = [g.x1, g.y1];
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    const x = (1 - t) ** 2 * g.x1 + 2 * (1 - t) * t * g.cx + t * t * g.x2;
    const y = (1 - t) ** 2 * g.y1 + 2 * (1 - t) * t * g.cy + t * t * g.y2;
    best = Math.min(best, segDist(px, py, prev[0], prev[1], x, y));
    prev = [x, y];
  }
  return best;
}

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1; const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * @param {CanvasRenderingContext2D} ctx (CSS pixel transform already applied)
 * @param {object} p
 */
export function drawGraph(ctx, p) {
  const { graph, index, viewport: vp, width, height, colors: C, visual, overlay = {}, options = {} } = p;
  const s = vp.scale;
  const px = (v) => v / s;
  ctx.save();
  ctx.translate(vp.tx, vp.ty);
  ctx.scale(s, s);
  const view = vp.visibleWorld(width, height, NODE_R * 3);
  const directed = graph.directed;
  const showWeights = options.showWeights !== false && s > 0.42;
  const showLabels = options.showLabels !== false && s > 0.28;
  const vs = visual;

  // ---- Edges ----
  const labelQueue = [];
  for (const e of graph.edges) {
    const g = edgeGeometry(e, index);
    if (!g) continue;
    const [x0, y0, x1, y1] = edgeBox(g);
    if (x1 < view.minX || x0 > view.maxX || y1 < view.minY || y0 > view.maxY) continue;

    let color = C['g-edge'];
    let width = 1.5;
    let dash = null;
    const st = vs?.edges.get(e.id);
    if (st === 'examined') { color = C['g-examined']; width = 2; dash = [6, 4]; }
    else if (st === 'tree') { color = C['g-tree']; width = 3; }
    else if (st === 'rejected') { color = C['g-rejected']; width = 1.5; dash = [1.5, 4]; }
    const onPath = vs?.pathEdges.has(e.id);
    const isError = vs?.errorEdges.has(e.id);
    if (onPath) { color = C['g-path']; width = 4.5; dash = null; }
    if (isError) { color = C['g-error']; width = 3.5; dash = null; }
    const isCurrent = vs?.currentEdge === e.id;
    const selected = overlay.selection?.type === 'edge' && overlay.selection.id === e.id;
    const hovered = overlay.hover?.type === 'edge' && overlay.hover.id === e.id;

    if (isCurrent || selected || hovered) {
      ctx.save();
      ctx.globalAlpha = selected ? 0.55 : 0.35;
      strokeEdge(ctx, g, selected ? C['g-select'] : isCurrent ? C['g-current'] : C['g-node-stroke'], px(width + 7), null);
      ctx.restore();
    }
    if (onPath) {
      // Double stroke for path (non-colour cue).
      strokeEdge(ctx, g, color, px(width + 3), null);
      strokeEdge(ctx, g, C['g-canvas'], px(1.5), null);
    } else {
      strokeEdge(ctx, g, color, px(width), dash ? dash.map(px) : null);
    }
    if (directed) drawArrow(ctx, g, color, px, width);
    if (showWeights) labelQueue.push([g, e.weight, color]);
  }

  // Weight labels on top of edges.
  if (showWeights) {
    ctx.font = `600 ${px(11)}px ${getFont()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [g, w, color] of labelQueue) {
      const text = fmtWeight(w);
      const tw = ctx.measureText(text).width;
      const pad = px(4);
      ctx.fillStyle = C['g-label-bg'];
      roundRect(ctx, g.lx - tw / 2 - pad, g.ly - px(8), tw + 2 * pad, px(16), px(4));
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = px(1);
      ctx.stroke();
      ctx.fillStyle = C['g-edge-text'];
      ctx.fillText(text, g.lx, g.ly + px(0.5));
    }
  }

  // Pending edge from the edge tool.
  if (overlay.pendingSource && overlay.pointer) {
    const a = index.nodeById.get(overlay.pendingSource);
    if (a) {
      ctx.save();
      ctx.setLineDash([px(6), px(5)]);
      ctx.strokeStyle = C['g-select'];
      ctx.lineWidth = px(2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(overlay.pointer[0], overlay.pointer[1]);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- Nodes ----
  const R = NODE_R;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const n of graph.nodes) {
    if (n.x < view.minX || n.x > view.maxX || n.y < view.minY || n.y > view.maxY) continue;
    const st = vs?.nodes.get(n.id);
    const onPath = vs?.pathNodes.has(n.id);
    const isErr = vs?.errorNodes.has(n.id);
    const isCur = vs?.current === n.id;
    const selected = overlay.selection?.type === 'node' && overlay.selection.id === n.id;
    const hovered = overlay.hover?.type === 'node' && overlay.hover.id === n.id;
    const pending = overlay.pendingSource === n.id;

    let fill = C['g-node'];
    let stroke = C['g-node-stroke'];
    let lw = 1.5;
    let dash = null;
    let text = C['g-node-text'];
    if (st === 'discovered') { stroke = C['g-discovered']; lw = 2.5; dash = [4, 3]; }
    else if (st === 'visited') { stroke = C['g-visited']; lw = 3; }
    else if (st === 'finalized') { fill = C['g-finalized']; stroke = C['g-visited']; lw = 2; text = '#ffffff'; }
    if (onPath) { stroke = C['g-path']; lw = 3.5; dash = null; }
    if (isErr) { stroke = C['g-error']; lw = 3.5; dash = null; }

    if (isCur) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, R + 7, 0, Math.PI * 2);
      ctx.strokeStyle = C['g-current'];
      ctx.lineWidth = px(2.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(n.x, n.y, R + 3.5, 0, Math.PI * 2);
      ctx.lineWidth = px(1.5);
      ctx.stroke();
    }
    if (selected || pending || hovered) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(n.x, n.y, R + (isCur ? 11 : 6), 0, Math.PI * 2);
      ctx.setLineDash(selected || pending ? [px(4), px(3)] : []);
      ctx.strokeStyle = selected || pending ? C['g-select'] : C['g-node-stroke'];
      ctx.globalAlpha = selected || pending ? 1 : 0.5;
      ctx.lineWidth = px(2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(n.x, n.y, R, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.save();
    if (dash) ctx.setLineDash(dash.map(px));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = px(lw);
    ctx.stroke();
    ctx.restore();
    if (onPath) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, R - 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = C['g-path'];
      ctx.lineWidth = px(1.2);
      ctx.stroke();
    }

    if (showLabels) {
      const label = String(n.label ?? n.id);
      const fs = label.length > 3 ? 9 : 12;
      ctx.font = `650 ${fs}px ${getFont()}`;
      ctx.fillStyle = text;
      ctx.fillText(label.length > 6 ? `${label.slice(0, 5)}…` : label, n.x, n.y + 0.5);
    }

    // Start / destination badges (letters, not just colour).
    const badge = (letter, color, dx) => {
      const bx = n.x + dx; const by = n.y + R * 0.95;
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = C['g-canvas'];
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = `700 9px ${getFont()}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(letter, bx, by + 0.5);
    };
    const isStart = overlay.start === n.id;
    const isTarget = overlay.target === n.id;
    if (isStart) badge('S', C['g-start'], isTarget ? -8 : 0);
    if (isTarget) badge('T', C['g-target'], isStart ? 8 : 0);

    // Annotation (distance / order) pill.
    const ann = vs?.labels.get(n.id);
    if (ann !== undefined && showLabels) {
      ctx.font = `600 10px ${getMono()}`;
      const tw = ctx.measureText(ann).width;
      const ax = n.x + R * 0.9; const ay = n.y - R * 1.15;
      ctx.fillStyle = C['g-label-bg'];
      roundRect(ctx, ax - 3, ay - 7, tw + 6, 14, 3);
      ctx.fill();
      ctx.strokeStyle = st === 'finalized' ? C['g-visited'] : C['g-discovered'];
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = C['g-node-text'];
      ctx.textAlign = 'left';
      ctx.fillText(ann, ax, ay + 0.5);
      ctx.textAlign = 'center';
    }
  }
  ctx.restore();
}

function strokeEdge(ctx, g, color, width, dash) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  if (g.kind === 'loop') ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
  else {
    ctx.moveTo(g.x1, g.y1);
    if (g.kind === 'curve') ctx.quadraticCurveTo(g.cx, g.cy, g.x2, g.y2);
    else ctx.lineTo(g.x2, g.y2);
  }
  ctx.stroke();
  ctx.restore();
}

function drawArrow(ctx, g, color, px, width) {
  if (g.kind === 'loop') {
    // Small arrowhead where the loop re-enters the node.
    const ang = Math.atan2(g.ay - g.cy, g.ax - g.cx) + 0.55;
    const x = g.cx + Math.cos(ang) * g.r; const y = g.cy + Math.sin(ang) * g.r;
    const t = [-Math.sin(ang), Math.cos(ang)];
    arrowHead(ctx, x, y, t[0], t[1], color, px, width);
    return;
  }
  arrowHead(ctx, g.x2, g.y2, g.tx, g.ty, color, px, width);
}

function arrowHead(ctx, x, y, ux, uy, color, px, width) {
  const L = px(9 + width);
  const W = px(4 + width * 0.6);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - ux * L - uy * W, y - uy * L + ux * W);
  ctx.lineTo(x - ux * L + uy * W, y - uy * L - ux * W);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fmtWeight(w) {
  if (Number.isInteger(w)) return String(w);
  return String(Math.round(w * 100) / 100);
}

let fontCache = null;
function getFont() {
  if (!fontCache) fontCache = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  return fontCache;
}
function getMono() { return 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; }

/** Hit testing in world coordinates. */
export function hitTest(graph, index, wx, wy, scale) {
  for (let i = graph.nodes.length - 1; i >= 0; i--) {
    const n = graph.nodes[i];
    if (Math.hypot(n.x - wx, n.y - wy) <= NODE_R + 2) return { type: 'node', id: n.id };
  }
  const tol = Math.max(5, 7 / scale);
  let best = null;
  let bestD = Infinity;
  for (const e of graph.edges) {
    const g = edgeGeometry(e, index);
    if (!g) continue;
    const d = distanceToEdge(g, wx, wy);
    if (d < tol && d < bestD) { best = { type: 'edge', id: e.id }; bestD = d; }
  }
  return best;
}
