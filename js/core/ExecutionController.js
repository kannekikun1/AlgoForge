/**
 * Playback controller for a recorded execution trace.
 *
 * Supports start/play, pause, resume, stop, step forward, step backward, restart, seeking and
 * adjustable speed. Backward stepping restores state by replaying events from the nearest
 * periodic snapshot (every SNAPSHOT_INTERVAL events), so the cost of any seek is bounded by
 * SNAPSHOT_INTERVAL reducer applications plus one clone.
 *
 * Playback timing is driven by an injectable scheduler (requestAnimationFrame in the browser,
 * manual ticks in tests). Playback speed only affects presentation — never measurement.
 */
import { EventEmitter } from '../utils/EventEmitter.js';
import { createVisualState, cloneVisualState, applyEvent } from './VisualState.js';

export const SNAPSHOT_INTERVAL = 64;

const defaultScheduler = {
  request: (fn) => (globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(fn) : setTimeout(() => fn(Date.now()), 16)),
  cancel: (h) => (globalThis.cancelAnimationFrame ? globalThis.cancelAnimationFrame(h) : clearTimeout(h)),
};

export class ExecutionController extends EventEmitter {
  constructor({ scheduler = defaultScheduler, speed = 8 } = {}) {
    super();
    this.scheduler = scheduler;
    this.events = [];
    this.index = -1; // index of the last applied event; -1 = before start
    this.state = createVisualState();
    this.snapshots = new Map();
    this.playing = false;
    this.speed = speed; // events per second
    this.handle = null;
    this.lastTime = null;
    this.acc = 0;
  }

  get length() { return this.events.length; }
  get atEnd() { return this.index >= this.events.length - 1; }
  get currentEvent() { return this.index >= 0 ? this.events[this.index] : null; }

  load(events) {
    this.pause();
    this.events = events ?? [];
    this.snapshots = new Map();
    this.index = -1;
    this.state = createVisualState();
    this.#emit();
  }

  clear() { this.load([]); }

  setSpeed(eventsPerSecond) {
    this.speed = Math.max(0.25, Math.min(2000, eventsPerSecond));
    this.emit('speed', this.speed);
  }

  /** Move to an absolute event index (−1 … length−1). */
  seek(target) {
    const i = Math.max(-1, Math.min(this.events.length - 1, Math.floor(target)));
    if (i === this.index) return;
    if (i > this.index && i - this.index <= SNAPSHOT_INTERVAL) {
      while (this.index < i) this.#applyNext();
    } else {
      // Find nearest snapshot at or before i.
      let base = -1;
      for (const k of this.snapshots.keys()) if (k <= i && k > base) base = k;
      this.state = base >= 0 ? cloneVisualState(this.snapshots.get(base)) : createVisualState();
      this.index = base;
      while (this.index < i) this.#applyNext();
    }
    this.#emit();
  }

  #applyNext() {
    this.index++;
    applyEvent(this.state, this.events[this.index]);
    if ((this.index + 1) % SNAPSHOT_INTERVAL === 0 && !this.snapshots.has(this.index)) {
      this.snapshots.set(this.index, cloneVisualState(this.state));
    }
  }

  stepForward() { this.pause(); this.seek(this.index + 1); }
  stepBackward() { this.pause(); this.seek(this.index - 1); }
  toEnd() { this.pause(); this.seek(this.events.length - 1); }

  play() {
    if (!this.events.length) return;
    if (this.atEnd) this.seek(-1);
    if (this.playing) return;
    this.playing = true;
    this.lastTime = null;
    this.acc = 0;
    this.emit('play', true);
    this.handle = this.scheduler.request((t) => this.#frame(t));
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
    this.emit('play', false);
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  stop() { this.pause(); this.seek(-1); }

  restart() { this.pause(); this.seek(-1); this.play(); }

  /** Advance playback by `dt` milliseconds (also used directly in tests). */
  tick(dt) {
    this.acc += (dt / 1000) * this.speed;
    const steps = Math.floor(this.acc);
    if (steps > 0) {
      this.acc -= steps;
      this.seek(Math.min(this.events.length - 1, this.index + steps));
    }
    if (this.atEnd) {
      this.pause();
      this.emit('end');
    }
  }

  #frame(t) {
    if (!this.playing) return;
    const dt = this.lastTime === null ? 0 : Math.min(250, t - this.lastTime);
    this.lastTime = t;
    this.tick(dt);
    if (this.playing) this.handle = this.scheduler.request((tt) => this.#frame(tt));
  }

  /** Most recent inspector state at or before the current index (snapshots are strided). */
  inspectorState() {
    for (let i = this.index; i >= 0; i--) {
      if (this.events[i].state !== undefined) return { state: this.events[i].state, at: i };
    }
    return null;
  }

  #emit() {
    this.emit('change', { index: this.index, event: this.currentEvent, state: this.state, length: this.events.length });
  }
}
