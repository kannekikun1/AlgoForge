/**
 * Small dependency-free SVG chart: scatter points + lines + dashed reference curves,
 * linear or log Y axis, keyboard-focusable points with tooltips and click callbacks.
 */
import { h, clear, fmtNum } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    // CSS custom properties are not valid in SVG presentation attributes; use inline style.
    if ((k === 'fill' || k === 'stroke') && String(v).startsWith('var(')) el.style[k] = String(v);
    else el.setAttribute(k, String(v));
  }
  return el;
};

export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const out = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/**
 * @param {HTMLElement} host
 * @param {{series:Array<{name:string,color:string,points:Array<{x:number,y:number,meta?:any}>,kind:'scatter'|'line'|'ref'}>,
 *   xLabel:string, yLabel:string, logY?:boolean, formatY?:(v:number)=>string, onPoint?:(p, s)=>void, height?:number}} spec
 */
export function renderChart(host, spec) {
  clear(host);
  const W = Math.max(320, host.clientWidth || 640);
  const H = spec.height ?? 340;
  const M = { l: 64, r: 18, t: 14, b: 44 };
  const all = spec.series.flatMap((s) => s.points).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!all.length) { host.append(h('p', { class: 'hint' }, 'No data yet.')); return; }
  const logY = Boolean(spec.logY);
  const ys = all.map((p) => p.y).filter((y) => !logY || y > 0);
  const xMin = Math.min(...all.map((p) => p.x));
  const xMax = Math.max(...all.map((p) => p.x));
  let yMin = logY ? Math.min(...ys) : Math.min(0, ...ys);
  let yMax = Math.max(...ys);
  if (logY) { yMin = 10 ** Math.floor(Math.log10(yMin || 1e-6)); yMax = 10 ** Math.ceil(Math.log10(yMax || 1)); }
  const xTicks = niceTicks(xMin, xMax, 6);
  const yTicks = logY ? logTicks(yMin, yMax) : niceTicks(yMin, yMax, 5);
  const X0 = Math.min(xMin, xTicks[0]); const X1 = Math.max(xMax, xTicks[xTicks.length - 1]);
  const Y0 = logY ? yMin : Math.min(yMin, yTicks[0]); const Y1 = logY ? yMax : Math.max(yMax, yTicks[yTicks.length - 1]);
  const sx = (x) => M.l + ((x - X0) / (X1 - X0 || 1)) * (W - M.l - M.r);
  const sy = (y) => {
    if (logY) {
      const v = Math.log10(Math.max(y, Y0));
      return H - M.b - ((v - Math.log10(Y0)) / (Math.log10(Y1) - Math.log10(Y0) || 1)) * (H - M.t - M.b);
    }
    return H - M.b - ((y - Y0) / (Y1 - Y0 || 1)) * (H - M.t - M.b);
  };
  const fy = spec.formatY ?? ((v) => fmtNum(v));
  const root = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${spec.yLabel} versus ${spec.xLabel}` });

  const grid = svg('g', { class: 'axis' });
  for (const t of yTicks) {
    if (t < Y0 || t > Y1) continue;
    const y = sy(t);
    grid.append(svg('line', { class: 'gridline', x1: M.l, x2: W - M.r, y1: y, y2: y }));
    const tx = svg('text', { x: M.l - 8, y: y + 4, 'text-anchor': 'end' });
    tx.textContent = fy(t);
    grid.append(tx);
  }
  for (const t of xTicks) {
    if (t < X0 || t > X1) continue;
    const x = sx(t);
    grid.append(svg('line', { x1: x, x2: x, y1: H - M.b, y2: H - M.b + 5 }));
    const tx = svg('text', { x, y: H - M.b + 18, 'text-anchor': 'middle' });
    tx.textContent = fmtNum(t);
    grid.append(tx);
  }
  grid.append(svg('line', { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b }));
  grid.append(svg('line', { x1: M.l, x2: M.l, y1: M.t, y2: H - M.b }));
  const xl = svg('text', { x: (M.l + W - M.r) / 2, y: H - 6, 'text-anchor': 'middle' });
  xl.textContent = spec.xLabel;
  const yl = svg('text', { x: -(M.t + H - M.b) / 2, y: 14, transform: 'rotate(-90)', 'text-anchor': 'middle' });
  yl.textContent = spec.yLabel + (logY ? ' (log)' : '');
  grid.append(xl, yl);
  root.append(grid);

  const tooltip = h('div', { class: 'chart-tooltip', hidden: true });
  const show = (p, s, cx, cy) => {
    tooltip.hidden = false;
    tooltip.textContent = `${s.name}\nn = ${fmtNum(p.x)}\n${spec.yLabel}: ${fy(p.y)}${p.meta?.extra ? `\n${p.meta.extra}` : ''}`;
    const left = Math.min(W - 160, cx + 12);
    tooltip.style.left = `${(left / W) * 100}%`;
    tooltip.style.top = `${Math.max(0, cy - 20)}px`;
  };
  const hide = () => { tooltip.hidden = true; };

  for (const s of spec.series) {
    const pts = s.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && (!logY || p.y > 0)).sort((a, b) => a.x - b.x);
    if (s.kind === 'line' || s.kind === 'ref') {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
      root.append(svg('path', { d, class: s.kind === 'ref' ? 'ref-line' : 'series-line', stroke: s.color }));
      if (s.kind === 'line') {
        for (const p of pts) root.append(svg('circle', { cx: sx(p.x), cy: sy(p.y), r: 3.5, fill: s.color }));
      }
    } else {
      const g = svg('g');
      for (const p of pts) {
        const c = svg('circle', { class: 'pt', cx: sx(p.x), cy: sy(p.y), r: 4, fill: s.color, 'fill-opacity': 0.55, stroke: s.color, tabindex: 0, role: 'button', 'aria-label': `${s.name}: n ${p.x}, ${fy(p.y)}` });
        const cx = sx(p.x); const cy = sy(p.y);
        c.addEventListener('mouseenter', () => show(p, s, cx, cy));
        c.addEventListener('focus', () => show(p, s, cx, cy));
        c.addEventListener('mouseleave', hide);
        c.addEventListener('blur', hide);
        c.addEventListener('click', () => spec.onPoint?.(p, s));
        c.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); spec.onPoint?.(p, s); } });
        g.append(c);
      }
      root.append(g);
    }
  }
  host.append(root, tooltip);
  host.append(h('div', { class: 'chart-legend' }, spec.series.map((s) => h('span', {},
    h('span', { class: `swatch ${s.kind === 'scatter' ? 'dot' : s.kind === 'ref' ? 'dash' : ''}`, style: s.kind === 'ref' ? { color: s.color } : { background: s.color } }), s.name))));
}

function logTicks(min, max) {
  const out = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) out.push(10 ** e);
  return out;
}

/** Tiny sparkline (best score over experiments). */
export function sparkline(points, { width = 320, height = 60, color = 'currentColor', label = '' } = {}) {
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img', 'aria-label': label, class: 'sparkline' });
  if (points.length < 1) return root;
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs, x0 + 1);
  const y0 = Math.min(0, ...ys); const y1 = Math.max(...ys, y0 + 1);
  const sx = (x) => 4 + ((x - x0) / (x1 - x0)) * (width - 8);
  const sy = (y) => height - 4 - ((y - y0) / (y1 - y0)) * (height - 8);
  // Step chart (best-so-far is a step function).
  let d = `M${sx(points[0].x)},${sy(points[0].y)}`;
  for (let i = 1; i < points.length; i++) d += `H${sx(points[i].x)}V${sy(points[i].y)}`;
  root.append(svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 2 }));
  return root;
}
