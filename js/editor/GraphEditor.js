/**
 * Graph editing model: wraps a Graph with undoable operations and change notifications.
 *
 * Every structural mutation records an undo snapshot first. Node drags record a single
 * snapshot when the drag begins (`beginMove`). Emits:
 *   'change' { kind: 'structure' | 'position' | 'load' | 'mode', label }
 */
import { Graph } from '../core/Graph.js';
import { HistoryManager } from './HistoryManager.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { LIMITS } from '../utils/Validation.js';

export class GraphEditor extends EventEmitter {
  constructor(graph = new Graph()) {
    super();
    this.graph = graph;
    this.history = new HistoryManager({ limit: 200 });
  }

  #record(label) { this.history.record(this.graph.toJSON(), label); }

  #changed(kind, label) { this.emit('change', { kind, label }); }

  /** Apply a structural mutation with undo support. */
  mutate(label, fn) {
    this.#record(label);
    const out = fn(this.graph);
    this.#changed('structure', label);
    return out;
  }

  addNode(x, y, props = {}) {
    if (this.graph.nodeCount >= LIMITS.maxNodes) throw new Error(`Node limit reached (${LIMITS.maxNodes}).`);
    return this.mutate('Add node', (g) => g.addNode({ x: round(x), y: round(y), ...props }));
  }

  removeNode(id) { return this.mutate('Delete node', (g) => g.removeNode(id)); }

  updateNode(id, patch) {
    return this.mutate('Edit node', (g) => g.updateNode(id, patch));
  }

  addEdge(source, target, weight = 1) {
    if (this.graph.edgeCount >= LIMITS.maxEdges) throw new Error(`Edge limit reached (${LIMITS.maxEdges}).`);
    return this.mutate('Add edge', (g) => g.addEdge({ source, target, weight }));
  }

  removeEdge(id) { return this.mutate('Delete edge', (g) => g.removeEdge(id)); }

  updateEdge(id, patch) { return this.mutate('Edit edge', (g) => g.updateEdge(id, patch)); }

  setDirected(directed) {
    if (this.graph.directed === directed) return;
    this.#record(directed ? 'Make directed' : 'Make undirected');
    this.graph.setDirected(directed);
    this.#changed('structure', 'mode');
  }

  clear() { this.mutate('Clear graph', (g) => g.clear()); }

  /** Begin a drag: records one undo step for the whole move. */
  beginMove() { this.#record('Move node'); }

  moveNode(id, x, y) {
    const n = this.graph.getNode(id);
    if (!n) return;
    n.x = round(x);
    n.y = round(y);
    this.#changed('position', 'Move node');
  }

  /** Replace the whole graph (generation, import, load). Undoable unless resetHistory. */
  load(data, { label = 'Load graph', resetHistory = false } = {}) {
    if (resetHistory) this.history.clear(); else this.#record(label);
    this.graph = new Graph(data);
    this.#changed('load', label);
  }

  undo() {
    const prev = this.history.undo(this.graph.toJSON());
    if (!prev) return false;
    this.graph = new Graph(prev);
    this.#changed('load', 'Undo');
    return true;
  }

  redo() {
    const next = this.history.redo(this.graph.toJSON());
    if (!next) return false;
    this.graph = new Graph(next);
    this.#changed('load', 'Redo');
    return true;
  }
}

function round(v) { return Math.round(v * 10) / 10; }
