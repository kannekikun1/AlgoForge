/**
 * Graph data model.
 *
 * Two representations are used:
 *
 * 1. `Graph` — a mutable editing model holding plain node/edge records exactly as they are
 *    exported to JSON. Used by the editor and storage layers.
 *
 * 2. `CompiledGraph` (from `compileGraph`) — an immutable, index-based, compressed-sparse-row
 *    adjacency structure used by every algorithm. Compiling copies all data, so algorithms
 *    can never mutate the editing model.
 *
 * Canonical order (the basis of every deterministic tie-breaking rule):
 *   - Nodes are indexed by `naturalCompare` of their ids.
 *   - Edges are indexed by `naturalCompare` of their ids.
 *   - Each adjacency list is sorted by (neighbour index, edge index).
 *
 * Edge direction: v1 uses a single graph-wide mode. `edge.directed` is always normalised to
 * equal `graph.directed`. In undirected mode every edge appears in both endpoint lists,
 * except self-loops, which appear once.
 */
import { naturalCompare } from '../utils/Validation.js';

export const SCHEMA_VERSION = 1;

export class Graph {
  constructor({ directed = false, nodes = [], edges = [] } = {}) {
    this.directed = Boolean(directed);
    this.nodes = nodes.map((n) => ({ id: n.id, label: n.label ?? n.id, x: n.x, y: n.y }));
    this.edges = edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, weight: e.weight ?? 1, directed: this.directed,
    }));
    this.#reindex();
  }

  #nodeIndex = new Map();
  #edgeIndex = new Map();

  #reindex() {
    this.#nodeIndex = new Map(this.nodes.map((n) => [n.id, n]));
    this.#edgeIndex = new Map(this.edges.map((e) => [e.id, e]));
  }

  static fromJSON(obj) {
    return new Graph(obj);
  }

  toJSON() {
    return {
      directed: this.directed,
      nodes: this.nodes.map((n) => ({ ...n })),
      edges: this.edges.map((e) => ({ ...e })),
    };
  }

  clone() { return new Graph(this.toJSON()); }

  get nodeCount() { return this.nodes.length; }
  get edgeCount() { return this.edges.length; }
  isEmpty() { return this.nodes.length === 0; }

  getNode(id) { return this.#nodeIndex.get(id) ?? null; }
  getEdge(id) { return this.#edgeIndex.get(id) ?? null; }
  hasNode(id) { return this.#nodeIndex.has(id); }

  nextNodeId() { return nextId('node-', this.nodes); }
  nextEdgeId() { return nextId('edge-', this.edges); }

  /** Next spreadsheet-style label not already used: A … Z, AA, AB, … */
  nextLabel() {
    const used = new Set(this.nodes.map((n) => n.label));
    for (let i = 0; ; i++) {
      const label = indexToLabel(i);
      if (!used.has(label)) return label;
    }
  }

  addNode({ id, label, x = 0, y = 0 } = {}) {
    const nodeId = id ?? this.nextNodeId();
    if (this.#nodeIndex.has(nodeId)) throw new Error(`Duplicate node id "${nodeId}"`);
    const node = { id: nodeId, label: label ?? this.nextLabel(), x, y };
    this.nodes.push(node);
    this.#nodeIndex.set(nodeId, node);
    return node;
  }

  updateNode(id, patch) {
    const node = this.getNode(id);
    if (!node) throw new Error(`Unknown node "${id}"`);
    if (patch.label !== undefined) node.label = patch.label;
    if (patch.x !== undefined) node.x = patch.x;
    if (patch.y !== undefined) node.y = patch.y;
    return node;
  }

  /** Removes a node and every incident edge. Returns the removed edges. */
  removeNode(id) {
    if (!this.#nodeIndex.has(id)) return [];
    this.nodes = this.nodes.filter((n) => n.id !== id);
    const removed = this.edges.filter((e) => e.source === id || e.target === id);
    this.edges = this.edges.filter((e) => e.source !== id && e.target !== id);
    this.#reindex();
    return removed;
  }

  addEdge({ id, source, target, weight = 1 } = {}) {
    if (!this.#nodeIndex.has(source)) throw new Error(`Unknown source node "${source}"`);
    if (!this.#nodeIndex.has(target)) throw new Error(`Unknown target node "${target}"`);
    const edgeId = id ?? this.nextEdgeId();
    if (this.#edgeIndex.has(edgeId)) throw new Error(`Duplicate edge id "${edgeId}"`);
    const edge = { id: edgeId, source, target, weight, directed: this.directed };
    this.edges.push(edge);
    this.#edgeIndex.set(edgeId, edge);
    return edge;
  }

  updateEdge(id, patch) {
    const edge = this.getEdge(id);
    if (!edge) throw new Error(`Unknown edge "${id}"`);
    if (patch.weight !== undefined) edge.weight = patch.weight;
    return edge;
  }

  removeEdge(id) {
    if (!this.#edgeIndex.has(id)) return false;
    this.edges = this.edges.filter((e) => e.id !== id);
    this.#edgeIndex.delete(id);
    return true;
  }

  /** Existing edge between two nodes (respecting direction mode), or null. */
  findEdge(source, target) {
    return this.edges.find((e) => (e.source === source && e.target === target)
      || (!this.directed && e.source === target && e.target === source)) ?? null;
  }

  setDirected(directed) {
    this.directed = Boolean(directed);
    for (const e of this.edges) e.directed = this.directed;
  }

  clear() {
    this.nodes = [];
    this.edges = [];
    this.#reindex();
  }

  bounds() {
    if (!this.nodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const n of this.nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    return { minX, minY, maxX, maxY };
  }
}

export function indexToLabel(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function nextId(prefix, items) {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const it of items) {
    const m = re.exec(it.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const ids = new Set(items.map((i) => i.id));
  let k = max + 1;
  let id;
  do { id = `${prefix}${String(k++).padStart(3, '0')}`; } while (ids.has(id));
  return id;
}

/**
 * Compile plain graph data into an immutable, index-based structure.
 * Does not validate; callers should run GraphValidator first.
 *
 * @param {{directed:boolean,nodes:Array,edges:Array}} data
 */
export function compileGraph(data) {
  const directed = Boolean(data.directed);
  const nodes = [...data.nodes].sort((a, b) => naturalCompare(a.id, b.id));
  const n = nodes.length;
  const index = new Map();
  const ids = new Array(n);
  const labels = new Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  nodes.forEach((node, i) => {
    index.set(node.id, i);
    ids[i] = node.id;
    labels[i] = String(node.label ?? node.id);
    x[i] = node.x;
    y[i] = node.y;
  });

  const sortedEdges = [...data.edges].sort((a, b) => naturalCompare(a.id, b.id));
  const m = sortedEdges.length;
  const edgeIds = new Array(m);
  const edgeS = new Int32Array(m);
  const edgeT = new Int32Array(m);
  const edgeW = new Float64Array(m);
  sortedEdges.forEach((e, i) => {
    edgeIds[i] = e.id;
    edgeS[i] = index.get(e.source);
    edgeT[i] = index.get(e.target);
    edgeW[i] = Number(e.weight);
  });

  // Build arcs, then CSR arrays.
  const deg = new Int32Array(n);
  for (let i = 0; i < m; i++) {
    deg[edgeS[i]]++;
    if (!directed && edgeS[i] !== edgeT[i]) deg[edgeT[i]]++;
  }
  const adjStart = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) adjStart[i + 1] = adjStart[i] + deg[i];
  const arcs = adjStart[n];
  const adjTo = new Int32Array(arcs);
  const adjW = new Float64Array(arcs);
  const adjE = new Int32Array(arcs);
  const fill = adjStart.slice(0, n);
  const put = (u, v, w, e) => {
    const k = fill[u]++;
    adjTo[k] = v; adjW[k] = w; adjE[k] = e;
  };
  for (let i = 0; i < m; i++) {
    put(edgeS[i], edgeT[i], edgeW[i], i);
    if (!directed && edgeS[i] !== edgeT[i]) put(edgeT[i], edgeS[i], edgeW[i], i);
  }
  // Sort each adjacency segment by (to, edge index) — insertion sort is fine for typical degrees,
  // fall back to array sort for large segments.
  for (let u = 0; u < n; u++) {
    const a = adjStart[u];
    const b = adjStart[u + 1];
    if (b - a < 2) continue;
    const seg = [];
    for (let k = a; k < b; k++) seg.push([adjTo[k], adjE[k], adjW[k]]);
    seg.sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]));
    for (let k = a; k < b; k++) {
      const [to, e, w] = seg[k - a];
      adjTo[k] = to; adjE[k] = e; adjW[k] = w;
    }
  }

  return Object.freeze({
    directed, n, m, ids, labels, x, y, index,
    edgeIds, edgeS, edgeT, edgeW,
    adjStart, adjTo, adjW, adjE,
    arcCount: arcs,
  });
}

/** Resolve an optional node id to an index (or -1). */
export function resolveNode(G, id) {
  if (id === undefined || id === null || id === '') return -1;
  return G.index.has(id) ? G.index.get(id) : -2;
}

/** Wrap graph data in the portable export envelope. */
export function toExportEnvelope(graphData, extra = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    application: 'AlgoForge',
    ...extra,
    graph: {
      directed: Boolean(graphData.directed),
      nodes: graphData.nodes.map((n) => ({ id: n.id, label: n.label, x: n.x, y: n.y })),
      edges: graphData.edges.map((e) => ({
        id: e.id, source: e.source, target: e.target, weight: e.weight, directed: Boolean(graphData.directed),
      })),
    },
  };
}
