/**
 * Undo/redo history of graph snapshots.
 *
 * Snapshots are serialized graph JSON strings — simple, robust against aliasing bugs and cheap
 * for the supported graph sizes. Consecutive identical snapshots are coalesced, so a drag that
 * calls `record()` once before moving produces exactly one undo step.
 */
export class HistoryManager {
  constructor({ limit = 200 } = {}) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }

  /** Record the state *before* a mutation. */
  record(graphJSON, label = '') {
    const snap = typeof graphJSON === 'string' ? graphJSON : JSON.stringify(graphJSON);
    const top = this.past[this.past.length - 1];
    if (top && top.snap === snap) return;
    this.past.push({ snap, label });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }

  /** @param {object} currentJSON the current graph @returns {object|null} graph data to restore */
  undo(currentJSON) {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push({ snap: JSON.stringify(currentJSON), label: prev.label });
    return JSON.parse(prev.snap);
  }

  redo(currentJSON) {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push({ snap: JSON.stringify(currentJSON), label: next.label });
    return JSON.parse(next.snap);
  }

  peekUndoLabel() { return this.past[this.past.length - 1]?.label ?? ''; }
  peekRedoLabel() { return this.future[this.future.length - 1]?.label ?? ''; }

  clear() { this.past = []; this.future = []; }
}
