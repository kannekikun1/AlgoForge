/**
 * Minimal synchronous event emitter.
 * Listeners are invoked in registration order; errors in one listener do not
 * prevent others from running (they are reported via console.error).
 */
export class EventEmitter {
  #listeners = new Map();

  /**
   * @param {string} type
   * @param {(payload:any)=>void} fn
   * @returns {() => void} unsubscribe function
   */
  on(type, fn) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (p) => { off(); fn(p); });
    return off;
  }

  off(type, fn) {
    this.#listeners.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this.#listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (err) { console.error(`[EventEmitter] listener for "${type}" failed`, err); }
    }
  }

  clear() { this.#listeners.clear(); }
}
