/**
 * Application state store.
 *
 * A single plain-object state with shallow `set(patch)` updates. Subscribers are notified with
 * the set of changed keys so UI components can re-render only what they depend on. Application
 * state never references DOM elements.
 */
import { EventEmitter } from '../utils/EventEmitter.js';

export class StateManager extends EventEmitter {
  #state;

  constructor(initial = {}) {
    super();
    this.#state = { ...initial };
  }

  get state() { return this.#state; }

  get(key) { return this.#state[key]; }

  /** @param {object} patch */
  set(patch) {
    const changed = [];
    for (const [k, v] of Object.entries(patch)) {
      if (this.#state[k] !== v) changed.push(k);
    }
    if (!changed.length) return;
    this.#state = { ...this.#state, ...patch };
    this.emit('change', { changed, state: this.#state });
    for (const k of changed) this.emit(`change:${k}`, this.#state[k]);
  }

  /** Notify subscribers that a mutable value (e.g. the graph) changed in place. */
  touch(key) {
    this.emit('change', { changed: [key], state: this.#state });
    this.emit(`change:${key}`, this.#state[key]);
  }

  /**
   * Subscribe to changes of specific keys.
   * @param {string[]} keys
   * @param {(state:object, changed:string[]) => void} fn
   */
  watch(keys, fn) {
    return this.on('change', ({ changed, state }) => {
      if (changed.some((k) => keys.includes(k))) fn(state, changed);
    });
  }
}
