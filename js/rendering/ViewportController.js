/**
 * Pan/zoom transform between world (graph) coordinates and screen (CSS pixel) coordinates:
 *   screen = world · scale + translate
 */
export class ViewportController {
  constructor({ minScale = 0.05, maxScale = 6 } = {}) {
    this.minScale = minScale;
    this.maxScale = maxScale;
    this.reset();
  }

  reset() { this.scale = 1; this.tx = 0; this.ty = 0; }

  toScreen(x, y) { return [x * this.scale + this.tx, y * this.scale + this.ty]; }
  toWorld(sx, sy) { return [(sx - this.tx) / this.scale, (sy - this.ty) / this.scale]; }

  panBy(dx, dy) { this.tx += dx; this.ty += dy; }

  /** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
  zoomAt(sx, sy, factor) {
    const next = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    const f = next / this.scale;
    this.tx = sx - (sx - this.tx) * f;
    this.ty = sy - (sy - this.ty) * f;
    this.scale = next;
  }

  /** Fit world bounds into a viewport of w × h CSS pixels. */
  fit(bounds, w, h, pad = 56) {
    const bw = Math.max(1, bounds.maxX - bounds.minX);
    const bh = Math.max(1, bounds.maxY - bounds.minY);
    const s = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
    this.scale = Math.min(2, Math.max(this.minScale, Number.isFinite(s) && s > 0 ? s : 1));
    this.tx = w / 2 - ((bounds.minX + bounds.maxX) / 2) * this.scale;
    this.ty = h / 2 - ((bounds.minY + bounds.maxY) / 2) * this.scale;
  }

  visibleWorld(w, h, margin = 0) {
    const [x0, y0] = this.toWorld(0, 0);
    const [x1, y1] = this.toWorld(w, h);
    return { minX: x0 - margin, minY: y0 - margin, maxX: x1 + margin, maxY: y1 + margin };
  }
}
