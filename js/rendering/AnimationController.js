/**
 * Coalesces redraw requests into at most one render per animation frame. Nothing is drawn
 * unless something marked the scene dirty, so an idle canvas costs no CPU.
 */
export class AnimationController {
  constructor(render) {
    this.render = render;
    this.pending = false;
    this.frames = 0;
  }

  request() {
    if (this.pending) return;
    this.pending = true;
    const raf = globalThis.requestAnimationFrame ?? ((fn) => setTimeout(() => fn(performance.now()), 16));
    raf(() => {
      this.pending = false;
      this.frames++;
      this.render();
    });
  }
}
