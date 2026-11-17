/**
 * Min-priority queue of (priority, tie, value) entries backed by a binary heap.
 *
 * Deterministic ordering: lower `priority` first, then lower `tie` (typically a node's
 * canonical index), then lower `tie2`, then lower insertion sequence number. This makes every algorithm
 * built on it reproducible regardless of engine.
 *
 * The queue uses lazy deletion — callers re-insert with a better priority instead of
 * calling decrease-key and skip stale entries on pop. `pushes` and `pops` count operations
 * for the statistics panel.
 */
export class PriorityQueue {
  /** @param {{pqPush:number,pqPop:number}|null} [counters] live counter object updated on each operation */
  constructor(counters = null) {
    this.counters = counters;
    this.heap = [];
    this.seq = 0;
    this.pushes = 0;
    this.pops = 0;
  }

  get size() { return this.heap.length; }
  isEmpty() { return this.heap.length === 0; }

  static less(a, b) {
    if (a.priority !== b.priority) return a.priority < b.priority;
    if (a.tie !== b.tie) return a.tie < b.tie;
    if (a.tie2 !== b.tie2) return a.tie2 < b.tie2;
    return a.seq < b.seq;
  }

  push(value, priority, tie = 0, tie2 = 0) {
    const entry = { value, priority, tie, tie2, seq: this.seq++ };
    const h = this.heap;
    h.push(entry);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!PriorityQueue.less(h[i], h[p])) break;
      const t = h[i]; h[i] = h[p]; h[p] = t;
      i = p;
    }
    this.pushes++;
    if (this.counters) this.counters.pqPush++;
    return entry;
  }

  /** @returns {{value:any,priority:number,tie:number,tie2:number,seq:number}|undefined} */
  pop() {
    const h = this.heap;
    if (!h.length) return undefined;
    this.pops++;
    if (this.counters) this.counters.pqPop++;
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      h[0] = last;
      const n = h.length;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < n && PriorityQueue.less(h[l], h[s])) s = l;
        if (r < n && PriorityQueue.less(h[r], h[s])) s = r;
        if (s === i) break;
        const t = h[i]; h[i] = h[s]; h[s] = t;
        i = s;
      }
    }
    return top;
  }

  peek() { return this.heap[0]; }

  get operations() { return this.pushes + this.pops; }

  /** Entries in pop order (O(n log n); for the state inspector only). */
  snapshot() {
    return [...this.heap].sort((a, b) => (PriorityQueue.less(a, b) ? -1 : 1));
  }
}
