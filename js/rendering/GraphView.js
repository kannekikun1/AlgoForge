/**
 * A self-contained graph view: canvas + viewport + renderer + redraw scheduling.
 * Used by the main workspace (with an InputController attached) and by the Race and
 * Discovery mini views (with basic pan/zoom only).
 */
import { CanvasRenderer } from './CanvasRenderer.js';
import { ViewportController } from './ViewportController.js';
import { AnimationController } from './AnimationController.js';
import { drawGraph, buildIndex, readColors, hitTest, NODE_R } from './GraphRenderer.js';

const EMPTY_GRAPH = { directed: false, nodes: [], edges: [] };

export class GraphView {
  constructor(canvas, { panZoom = false, onViewportChange = () => {} } = {}) {
    this.canvas = canvas;
    this.viewport = new ViewportController();
    this.graph = EMPTY_GRAPH;
    this.index = buildIndex(EMPTY_GRAPH);
    this.visual = null;
    this.overlay = {};
    this.options = { showWeights: true, showLabels: true };
    this.colors = readColors();
    this.onViewportChange = onViewportChange;
    this.autoFit = true;
    this.anim = new AnimationController(() => this.draw());
    this.renderer = new CanvasRenderer(canvas, () => {
      if (this.autoFit) this.fit(); else this.anim.request();
    });
    if (panZoom) this.#attachPanZoom();
  }

  setGraph(graph, { fit = false } = {}) {
    this.graph = graph ?? EMPTY_GRAPH;
    this.index = buildIndex(this.graph);
    if (fit) this.fit();
    this.anim.request();
  }

  /** Call after structural edits to the current graph object. */
  invalidate() {
    this.index = buildIndex(this.graph);
    this.anim.request();
  }

  setVisual(visual) { this.visual = visual; this.anim.request(); }
  setOverlay(patch) { this.overlay = { ...this.overlay, ...patch }; this.anim.request(); }
  setOptions(patch) { this.options = { ...this.options, ...patch }; this.anim.request(); }
  refreshColors() { this.colors = readColors(); this.anim.request(); }
  requestRender() { this.anim.request(); }

  bounds() {
    const ns = this.graph.nodes;
    if (!ns.length) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const n of ns) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
    }
    return { minX: minX - NODE_R * 2, minY: minY - NODE_R * 2, maxX: maxX + NODE_R * 2, maxY: maxY + NODE_R * 2 };
  }

  fit() {
    const { width, height } = this.renderer;
    if (width < 10 || height < 10) return;
    this.viewport.fit(this.bounds(), width, height, 36);
    this.onViewportChange(this.viewport);
    this.anim.request();
  }

  resetView() {
    this.viewport.reset();
    this.autoFit = false;
    this.onViewportChange(this.viewport);
    this.anim.request();
  }

  zoomBy(factor) {
    this.autoFit = false;
    this.viewport.zoomAt(this.renderer.width / 2, this.renderer.height / 2, factor);
    this.onViewportChange(this.viewport);
    this.anim.request();
  }

  hit(sx, sy) {
    const [wx, wy] = this.viewport.toWorld(sx, sy);
    return hitTest(this.graph, this.index, wx, wy, this.viewport.scale);
  }

  draw() {
    this.renderer.resize();
    const ctx = this.renderer.begin();
    drawGraph(ctx, {
      graph: this.graph,
      index: this.index,
      viewport: this.viewport,
      width: this.renderer.width,
      height: this.renderer.height,
      colors: this.colors,
      visual: this.visual,
      overlay: this.overlay,
      options: this.options,
    });
  }

  #attachPanZoom() {
    const c = this.canvas;
    const pointers = new Map();
    let pinch = null;
    c.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.autoFit = false;
      const r = c.getBoundingClientRect();
      this.viewport.zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0015));
      this.anim.request();
    }, { passive: false });
    c.addEventListener('pointerdown', (ev) => {
      c.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (pointers.size === 2) pinch = pinchState(pointers);
    });
    c.addEventListener('pointermove', (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      const prev = pointers.get(ev.pointerId);
      pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      this.autoFit = false;
      if (pointers.size === 2 && pinch) {
        const next = pinchState(pointers);
        const r = c.getBoundingClientRect();
        this.viewport.zoomAt(next.cx - r.left, next.cy - r.top, next.d / pinch.d);
        this.viewport.panBy(next.cx - pinch.cx, next.cy - pinch.cy);
        pinch = next;
      } else if (pointers.size === 1) {
        this.viewport.panBy(ev.clientX - prev[0], ev.clientY - prev[1]);
      }
      this.anim.request();
    });
    const up = (ev) => { pointers.delete(ev.pointerId); if (pointers.size < 2) pinch = null; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', () => { this.autoFit = true; this.fit(); });
  }
}

export function pinchState(pointers) {
  const [a, b] = [...pointers.values()];
  return { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, d: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])) };
}
