/**
 * Records structured execution events emitted by an algorithm.
 *
 * Visualization events vs. algorithmic operations:
 *   Events exist only to drive the visualization and debugger. Operation counters (nodes
 *   visited, edges examined, …) are incremented by the algorithm's own logic whether or not a
 *   recorder is attached; each recorded event carries a *copy* of the counters at that moment.
 *   Benchmarks run with no recorder, so event construction never contaminates timings, and
 *   tests assert that counters are identical with and without tracing.
 *
 * Event shape:
 *   { type, step, nodeId?, edgeId?, line, metadata, counters, state? }
 *   - `line` indexes the algorithm's explicit pseudocode array (-1 = no highlight).
 *   - `state` is a compact snapshot of algorithm data structures for the inspector, produced
 *     lazily (only when recording) by the algorithm.
 */
export const EVENT_TYPES = Object.freeze([
  'ALGORITHM_STARTED',
  'NODE_VISITED',
  'NODE_DISCOVERED',
  'EDGE_EXAMINED',
  'EDGE_RELAXED',
  'DISTANCE_UPDATED',
  'NODE_FINALIZED',
  'PATH_FOUND',
  'ALGORITHM_COMPLETED',
  'ALGORITHM_FAILED',
  // Specialised events
  'EDGE_ACCEPTED', // MST: edge added to the forest
  'EDGE_REJECTED', // MST: edge would create a cycle (or is a self-loop)
  'ORDER_ASSIGNED', // topological / DFS order position
  'ROUND_STARTED', // Bellman-Ford pass, Floyd-Warshall pivot
  'NEGATIVE_CYCLE', // Bellman-Ford / Floyd-Warshall
]);

export const DEFAULT_HISTORY_LIMIT = 20000;

export class EventRecorder {
  /**
   * @param {{limit?:number, stateStride?:number}} [opts]
   *   limit: maximum number of stored events (history limit).
   *   stateStride: capture an inspector snapshot every N events (plus the first and terminal
   *   events). Snapshots are O(V); the engine picks a stride from the graph size to bound memory.
   */
  constructor({ limit = DEFAULT_HISTORY_LIMIT, stateStride = 1 } = {}) {
    this.limit = Math.max(10, limit);
    this.stateStride = Math.max(1, Math.floor(stateStride));
    this.events = [];
    this.total = 0;
    this.truncated = false;
    this.counters = null;
  }

  /** Stride that bounds snapshot memory to roughly limit × 100 × (bytes per node entry). */
  static strideFor(nodeCount) {
    return Math.max(1, Math.ceil(nodeCount / 100));
  }

  /** Attach the algorithm's live counter object; each event stores a copy. */
  attach(counters) { this.counters = counters; }

  /**
   * @param {string} type
   * @param {{nodeId?:string,edgeId?:string,line?:number,metadata?:object}} fields
   * @param {(() => any)} [snapshot] lazily computes inspector state
   */
  emit(type, fields = {}, snapshot) {
    const step = this.total++;
    const terminal = type === 'ALGORITHM_COMPLETED' || type === 'ALGORITHM_FAILED' || type === 'PATH_FOUND';
    if (this.events.length >= this.limit && !terminal) {
      this.truncated = true;
      return;
    }
    const idx = this.events.length;
    const wantState = snapshot && (idx % this.stateStride === 0 || terminal || type === 'ALGORITHM_STARTED');
    this.events.push({
      type,
      step,
      nodeId: fields.nodeId,
      edgeId: fields.edgeId,
      line: fields.line ?? -1,
      metadata: fields.metadata ?? {},
      counters: this.counters ? { ...this.counters } : {},
      state: wantState ? snapshot() : undefined,
    });
  }
}
