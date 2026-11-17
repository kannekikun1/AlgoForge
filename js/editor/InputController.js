/**
 * Pointer input for the main graph canvas (mouse, pen and touch via Pointer Events).
 *
 * Tools:
 *   select  drag node to move · drag empty space to pan · double-click empty space adds a node
 *   node    click empty space to add a node (click a node to select/drag it)
 *   edge    click source node, then target node; click empty space to cancel
 *   delete  click a node or edge to delete it
 * Always: wheel / pinch zoom; middle-button drag pans.
 */
import { pinchState } from '../rendering/GraphView.js';

const DRAG_THRESHOLD = 3;

export class InputController {
  /**
   * @param {{view:import('../rendering/GraphView.js').GraphView, editor:any, selection:any,
   *   getTool:()=>string, getDefaultWeight:()=>number, onError:(msg:string)=>void,
   *   onEditEdge?:(id:string)=>void, onViewport?:()=>void, isLocked?:()=>boolean}} deps
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.canvas = deps.view.canvas;
    this.pointers = new Map();
    this.drag = null;
    this.pan = null;
    this.pinch = null;
    this.pendingSource = null;
    this.#bind();
  }

  cancelPending() {
    this.pendingSource = null;
    this.view.setOverlay({ pendingSource: null, pointer: null });
  }

  #local(ev) {
    const r = this.canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  #bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (ev) => this.#down(ev));
    c.addEventListener('pointermove', (ev) => this.#move(ev));
    c.addEventListener('pointerup', (ev) => this.#up(ev));
    c.addEventListener('pointercancel', (ev) => this.#up(ev, true));
    c.addEventListener('pointerleave', () => { if (!this.pointers.size) this.view.setOverlay({ hover: null }); });
    c.addEventListener('dblclick', (ev) => this.#dbl(ev));
    c.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const [sx, sy] = this.#local(ev);
      const factor = Math.exp(-(ev.ctrlKey ? ev.deltaY * 3 : ev.deltaY) * 0.0015);
      this.view.autoFit = false;
      this.view.viewport.zoomAt(sx, sy, factor);
      this.view.requestRender();
      this.onViewport?.();
    }, { passive: false });
    c.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  #down(ev) {
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture?.(ev.pointerId);
    const pos = this.#local(ev);
    this.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (this.pointers.size === 2) {
      // Second finger: switch to pinch, abandon any drag (already-moved drags stay recorded).
      this.drag = null;
      this.pan = null;
      this.pinch = pinchState(this.pointers);
      return;
    }
    if (ev.button === 1 || ev.button === 2) { this.pan = { last: pos, moved: false }; this.canvas.classList.add('is-panning'); return; }
    if (ev.button !== 0) return;

    const tool = this.getTool();
    const hit = this.view.hit(pos[0], pos[1]);
    const locked = this.isLocked?.() ?? false;
    const [wx, wy] = this.view.viewport.toWorld(pos[0], pos[1]);

    if (tool === 'delete' && !locked) {
      if (hit?.type === 'node') this.#safe(() => this.editor.removeNode(hit.id));
      else if (hit?.type === 'edge') this.#safe(() => this.editor.removeEdge(hit.id));
      else this.pan = { last: pos, moved: false };
      return;
    }

    if (tool === 'edge' && !locked) {
      if (hit?.type === 'node') {
        if (!this.pendingSource) {
          this.pendingSource = hit.id;
          this.selection.set(hit);
          this.view.setOverlay({ pendingSource: hit.id, pointer: [wx, wy] });
        } else if (this.pendingSource !== hit.id || ev.shiftKey) {
          const src = this.pendingSource;
          this.cancelPending();
          this.#safe(() => {
            const e = this.editor.addEdge(src, hit.id, this.getDefaultWeight());
            this.selection.set({ type: 'edge', id: e.id });
          });
        } else {
          this.cancelPending();
        }
        return;
      }
      this.cancelPending();
      this.pan = { last: pos, moved: false, clearOnClick: true };
      return;
    }

    if (hit?.type === 'node') {
      this.selection.set(hit);
      const n = this.editor.graph.getNode(hit.id);
      this.drag = { id: hit.id, start: pos, dx: wx - n.x, dy: wy - n.y, moved: false, locked };
      return;
    }
    if (hit?.type === 'edge') {
      this.selection.set(hit);
      return;
    }
    if (tool === 'node' && !locked) {
      this.#safe(() => {
        const n = this.editor.addNode(wx, wy);
        this.selection.set({ type: 'node', id: n.id });
      });
      return;
    }
    this.pan = { last: pos, moved: false, clearOnClick: true };
  }

  #move(ev) {
    const pos = this.#local(ev);
    if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);

    if (this.pinch && this.pointers.size === 2) {
      const next = pinchState(this.pointers);
      const r = this.canvas.getBoundingClientRect();
      this.view.autoFit = false;
      this.view.viewport.zoomAt(next.cx - r.left, next.cy - r.top, next.d / this.pinch.d);
      this.view.viewport.panBy(next.cx - this.pinch.cx, next.cy - this.pinch.cy);
      this.pinch = next;
      this.view.requestRender();
      this.onViewport?.();
      return;
    }
    const [wx, wy] = this.view.viewport.toWorld(pos[0], pos[1]);
    if (this.drag) {
      if (!this.drag.moved && Math.hypot(pos[0] - this.drag.start[0], pos[1] - this.drag.start[1]) < DRAG_THRESHOLD) return;
      if (this.drag.locked) return;
      if (!this.drag.moved) { this.editor.beginMove(); this.drag.moved = true; this.canvas.classList.add('is-dragging'); }
      this.editor.moveNode(this.drag.id, wx - this.drag.dx, wy - this.drag.dy);
      return;
    }
    if (this.pan) {
      const dx = pos[0] - this.pan.last[0]; const dy = pos[1] - this.pan.last[1];
      if (!this.pan.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      this.pan.moved = true;
      this.canvas.classList.add('is-panning');
      this.view.autoFit = false;
      this.view.viewport.panBy(dx, dy);
      this.pan.last = pos;
      this.view.requestRender();
      this.onViewport?.();
      return;
    }
    if (this.pendingSource) this.view.setOverlay({ pointer: [wx, wy] });
    if (ev.pointerType === 'mouse') {
      const hit = this.view.hit(pos[0], pos[1]);
      const prev = this.view.overlay.hover;
      if (JSON.stringify(prev ?? null) !== JSON.stringify(hit ?? null)) this.view.setOverlay({ hover: hit });
      this.canvas.classList.toggle('is-hover-node', Boolean(hit));
    }
  }

  #up(ev, cancelled = false) {
    this.pointers.delete(ev.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pan && !this.pan.moved && this.pan.clearOnClick && !cancelled) this.selection.clear();
    this.drag = null;
    this.pan = null;
    this.canvas.classList.remove('is-panning', 'is-dragging');
  }

  #dbl(ev) {
    if (this.isLocked?.()) return;
    const pos = this.#local(ev);
    const hit = this.view.hit(pos[0], pos[1]);
    if (hit?.type === 'edge') { this.onEditEdge?.(hit.id); return; }
    if (!hit && this.getTool() === 'select') {
      const [wx, wy] = this.view.viewport.toWorld(pos[0], pos[1]);
      this.#safe(() => {
        const n = this.editor.addNode(wx, wy);
        this.selection.set({ type: 'node', id: n.id });
      });
    }
  }

  #safe(fn) {
    try { fn(); } catch (err) { this.onError(err.message); }
  }
}
