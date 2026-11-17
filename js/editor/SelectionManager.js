/**
 * Single-element selection ({type:'node'|'edge', id} or null) with change notifications.
 * Selections that refer to deleted elements are dropped by `prune`.
 */
import { EventEmitter } from '../utils/EventEmitter.js';

export class SelectionManager extends EventEmitter {
  constructor() { super(); this.current = null; }

  set(sel) {
    const next = sel ? { type: sel.type, id: sel.id } : null;
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    this.emit('change', this.current);
  }

  clear() { this.set(null); }

  is(type, id) { return this.current?.type === type && this.current.id === id; }

  prune(graph) {
    if (!this.current) return;
    const ok = this.current.type === 'node' ? graph.hasNode(this.current.id) : Boolean(graph.getEdge(this.current.id));
    if (!ok) this.clear();
  }
}
