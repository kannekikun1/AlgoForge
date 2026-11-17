/**
 * Low-level canvas management: device-pixel-ratio scaling and resize observation.
 */
export class CanvasRenderer {
  /** @param {HTMLCanvasElement} canvas @param {() => void} onResize */
  constructor(canvas, onResize = () => {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.onResize = onResize;
    this.observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.observer?.observe(canvas);
    this.resize(false);
  }

  resize(notify = true) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    if (notify) this.onResize(w, h);
  }

  /** Clear and return the context with a CSS-pixel transform applied. */
  begin() {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return ctx;
  }

  destroy() { this.observer?.disconnect(); }
}
