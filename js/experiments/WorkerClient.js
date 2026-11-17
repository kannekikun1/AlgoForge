/**
 * Main-thread client for worker jobs. Wraps a module worker with a promise-based API,
 * progress callbacks and cancellation (graceful message first; hard terminate as fallback).
 */
export class WorkerClient {
  /** @param {URL|string} url module worker URL */
  constructor(url) {
    this.url = url;
    this.worker = null;
    this.pending = null;
  }

  #ensure() {
    if (!this.worker) {
      this.worker = new Worker(this.url, { type: 'module' });
      this.worker.onmessage = (ev) => this.#onMessage(ev.data);
      this.worker.onerror = (ev) => {
        ev.preventDefault?.();
        this.#settle('reject', new Error(ev.message || 'Worker failed to load. Serve the app over http(s) — see README.'));
      };
    }
    return this.worker;
  }

  #onMessage(msg) {
    if (!this.pending) return;
    if (msg.type === 'progress') this.pending.onProgress?.(msg.progress);
    else if (msg.type === 'done') this.#settle('resolve', msg.result);
    else if (msg.type === 'error') this.#settle('reject', new Error(msg.message));
  }

  #settle(kind, value) {
    const p = this.pending;
    this.pending = null;
    if (p) { clearTimeout(p.killTimer); p[kind](value); }
  }

  get busy() { return Boolean(this.pending); }

  /** Start a job. Only one job runs per client at a time. */
  run(message, { onProgress } = {}) {
    if (this.pending) return Promise.reject(new Error('A job is already running.'));
    const w = this.#ensure();
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, onProgress, killTimer: null };
      w.postMessage(message);
    });
  }

  /**
   * Request cancellation. The worker finishes its current slice and returns a partial result
   * (`terminatedBy: 'cancelled'`). If it does not respond within `graceMs`, it is terminated.
   */
  cancel(graceMs = 1500) {
    if (!this.pending || !this.worker) return;
    this.worker.postMessage({ cmd: 'cancel' });
    this.pending.killTimer = setTimeout(() => this.terminate(), graceMs);
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.#settle('reject', Object.assign(new Error('Cancelled.'), { cancelled: true }));
  }
}
