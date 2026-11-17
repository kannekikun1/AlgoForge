/**
 * Graph validation.
 *
 * `validateGraphData` checks structural integrity of plain graph data (as produced by the
 * editor or by import). It returns errors (which make the graph unusable) and warnings
 * (properties some algorithms reject, such as disconnection, self-loops or parallel edges).
 *
 * Algorithm-specific requirements are checked by each algorithm's `validate` function using
 * the analysis helpers below (`analyzeGraph`, `findDirectedCycle`, …).
 *
 * Support rules for special structures (documented in docs/algorithms.md):
 *   - Self-loops are allowed in the data model. Traversal and shortest-path algorithms examine
 *     them like any edge (a non-negative self-loop never improves a distance; a negative one is a
 *     negative cycle). MST algorithms skip them (they can never be in a spanning forest).
 *     Kahn's algorithm treats them as directed cycles and rejects the graph.
 *   - Parallel edges are allowed. Every algorithm examines each parallel edge separately;
 *     shortest-path and MST algorithms naturally use the cheapest one.
 */
import { LIMITS, isFiniteNumber, isNonEmptyString, isPlainObject } from '../utils/Validation.js';

export class ValidationResult {
  constructor() { this.errors = []; this.warnings = []; }
  error(code, message, ref) { this.errors.push({ code, message, ref }); return this; }
  warn(code, message, ref) { this.warnings.push({ code, message, ref }); return this; }
  get ok() { return this.errors.length === 0; }
}

/**
 * @param {any} data
 * @param {{allowEmpty?: boolean, limits?: typeof LIMITS}} [opts]
 */
export function validateGraphData(data, opts = {}) {
  const limits = opts.limits ?? LIMITS;
  const r = new ValidationResult();
  if (!isPlainObject(data)) return r.error('NOT_OBJECT', 'Graph must be an object.');
  if (!Array.isArray(data.nodes)) r.error('NODES_MISSING', 'Graph "nodes" must be an array.');
  if (!Array.isArray(data.edges)) r.error('EDGES_MISSING', 'Graph "edges" must be an array.');
  if (data.directed !== undefined && typeof data.directed !== 'boolean') {
    r.error('DIRECTED_INVALID', 'Graph "directed" must be a boolean.');
  }
  if (!r.ok) return r;

  if (data.nodes.length > limits.maxNodes) {
    r.error('TOO_MANY_NODES', `Graph has ${data.nodes.length} nodes; the limit is ${limits.maxNodes}.`);
  }
  if (data.edges.length > limits.maxEdges) {
    r.error('TOO_MANY_EDGES', `Graph has ${data.edges.length} edges; the limit is ${limits.maxEdges}.`);
  }
  if (!r.ok) return r;

  if (data.nodes.length === 0 && !opts.allowEmpty) r.error('EMPTY_GRAPH', 'Graph has no nodes.');

  const nodeIds = new Set();
  data.nodes.forEach((n, i) => {
    if (!isPlainObject(n)) { r.error('NODE_INVALID', `Node #${i + 1} is not an object.`); return; }
    if (!isNonEmptyString(n.id, limits.maxIdLength)) {
      r.error('NODE_ID_INVALID', `Node #${i + 1} has a missing or invalid id (1–${limits.maxIdLength} characters).`);
      return;
    }
    if (nodeIds.has(n.id)) r.error('DUPLICATE_NODE_ID', `Duplicate node id "${n.id}".`, n.id);
    nodeIds.add(n.id);
    if (n.label !== undefined && (typeof n.label !== 'string' || n.label.length > limits.maxLabelLength)) {
      r.error('NODE_LABEL_INVALID', `Node "${n.id}" has an invalid label (string up to ${limits.maxLabelLength} characters).`, n.id);
    }
    for (const axis of ['x', 'y']) {
      if (!isFiniteNumber(n[axis]) || Math.abs(n[axis]) > limits.maxCoordinate) {
        r.error('COORDINATE_INVALID', `Node "${n.id}" has an invalid ${axis} coordinate.`, n.id);
      }
    }
  });

  const edgeIds = new Set();
  const pairs = new Set();
  let selfLoops = 0;
  let parallel = 0;
  data.edges.forEach((e, i) => {
    if (!isPlainObject(e)) { r.error('EDGE_INVALID', `Edge #${i + 1} is not an object.`); return; }
    if (!isNonEmptyString(e.id, limits.maxIdLength)) {
      r.error('EDGE_ID_INVALID', `Edge #${i + 1} has a missing or invalid id.`);
      return;
    }
    if (edgeIds.has(e.id)) r.error('DUPLICATE_EDGE_ID', `Duplicate edge id "${e.id}".`, e.id);
    edgeIds.add(e.id);
    if (!nodeIds.has(e.source)) r.error('MISSING_ENDPOINT', `Edge "${e.id}" references missing source "${String(e.source)}".`, e.id);
    if (!nodeIds.has(e.target)) r.error('MISSING_ENDPOINT', `Edge "${e.id}" references missing target "${String(e.target)}".`, e.id);
    if (!isFiniteNumber(e.weight) || Math.abs(e.weight) > limits.maxAbsWeight) {
      r.error('WEIGHT_INVALID', `Edge "${e.id}" has an invalid weight (finite number with |w| ≤ ${limits.maxAbsWeight}).`, e.id);
    }
    if (e.directed !== undefined && typeof e.directed !== 'boolean') {
      r.error('EDGE_DIRECTED_INVALID', `Edge "${e.id}" has a non-boolean "directed" flag.`, e.id);
    } else if (e.directed !== undefined && data.directed !== undefined && e.directed !== data.directed) {
      r.warn('MIXED_DIRECTION', `Edge "${e.id}" direction differs from the graph mode; it will be normalised to the graph mode.`, e.id);
    }
    if (e.source === e.target) selfLoops++;
    const key = data.directed ? `${e.source}\u0000${e.target}` : [e.source, e.target].sort().join('\u0000');
    if (pairs.has(key)) parallel++;
    pairs.add(key);
  });

  if (selfLoops) r.warn('SELF_LOOPS', `Graph contains ${selfLoops} self-loop(s).`);
  if (parallel) r.warn('PARALLEL_EDGES', `Graph contains ${parallel} parallel edge(s).`);
  if (r.ok && data.nodes.length > 1) {
    const comps = countWeakComponents(data);
    if (comps > 1) r.warn('DISCONNECTED', `Graph is disconnected (${comps} weakly connected components).`);
  }
  return r;
}

function countWeakComponents(data) {
  const parent = new Map(data.nodes.map((n) => [n.id, n.id]));
  const find = (a) => {
    while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); }
    return a;
  };
  let comps = data.nodes.length;
  for (const e of data.edges) {
    const a = find(e.source); const b = find(e.target);
    if (a !== b) { parent.set(a, b); comps--; }
  }
  return comps;
}

/** Structural facts about a compiled graph that algorithm validators rely on. */
export function analyzeGraph(G) {
  let negative = 0;
  let selfLoops = 0;
  let minW = Infinity;
  for (let i = 0; i < G.m; i++) {
    if (G.edgeW[i] < 0) negative++;
    if (G.edgeS[i] === G.edgeT[i]) selfLoops++;
    if (G.edgeW[i] < minW) minW = G.edgeW[i];
  }
  return { negativeEdges: negative, selfLoops, minWeight: minW, components: weakComponents(G).count };
}

/** Weakly connected components of a compiled graph (component id per node). */
export function weakComponents(G) {
  const comp = new Int32Array(G.n).fill(-1);
  // Build undirected neighbour lists from edges, works for both modes.
  const nbr = Array.from({ length: G.n }, () => []);
  for (let i = 0; i < G.m; i++) { nbr[G.edgeS[i]].push(G.edgeT[i]); nbr[G.edgeT[i]].push(G.edgeS[i]); }
  let count = 0;
  for (let s = 0; s < G.n; s++) {
    if (comp[s] !== -1) continue;
    const stack = [s];
    comp[s] = count;
    while (stack.length) {
      const u = stack.pop();
      for (const v of nbr[u]) if (comp[v] === -1) { comp[v] = count; stack.push(v); }
    }
    count++;
  }
  return { comp, count };
}

/** Returns an array of node indices forming a directed cycle, or null. Iterative DFS. */
export function findDirectedCycle(G) {
  const WHITE = 0; const GREY = 1; const BLACK = 2;
  const color = new Uint8Array(G.n);
  const parent = new Int32Array(G.n).fill(-1);
  const iter = new Int32Array(G.n);
  for (let s = 0; s < G.n; s++) {
    if (color[s] !== WHITE) continue;
    const stack = [s];
    color[s] = GREY;
    iter[s] = G.adjStart[s];
    while (stack.length) {
      const u = stack[stack.length - 1];
      if (iter[u] < G.adjStart[u + 1]) {
        const v = G.adjTo[iter[u]++];
        if (color[v] === WHITE) {
          color[v] = GREY; parent[v] = u; iter[v] = G.adjStart[v]; stack.push(v);
        } else if (color[v] === GREY) {
          const cycle = [v];
          for (let w = u; w !== v && w !== -1; w = parent[w]) cycle.push(w);
          return cycle.reverse();
        }
      } else {
        color[u] = BLACK;
        stack.pop();
      }
    }
  }
  return null;
}

/** Error thrown by algorithms for invalid input. */
export class AlgorithmInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AlgorithmInputError';
    this.code = code;
  }
}

/** Common requirement checks shared by algorithm validators. Returns an array of {code,message}. */
export const requirements = {
  nonEmpty(G) {
    return G.n === 0 ? [{ code: 'EMPTY_GRAPH', message: 'The graph is empty. Add at least one node.' }] : [];
  },
  start(G, opts, required = true) {
    if (opts.start === undefined || opts.start === null || opts.start === '') {
      return required ? [{ code: 'START_REQUIRED', message: 'Select a start node.' }] : [];
    }
    return G.index.has(opts.start) ? [] : [{ code: 'START_UNKNOWN', message: `Start node "${opts.start}" does not exist.` }];
  },
  target(G, opts, required = false) {
    if (opts.target === undefined || opts.target === null || opts.target === '') {
      return required ? [{ code: 'TARGET_REQUIRED', message: 'Select a destination node.' }] : [];
    }
    return G.index.has(opts.target) ? [] : [{ code: 'TARGET_UNKNOWN', message: `Destination node "${opts.target}" does not exist.` }];
  },
  nonNegative(G, name) {
    for (let i = 0; i < G.m; i++) {
      if (G.edgeW[i] < 0) {
        return [{ code: 'NEGATIVE_WEIGHT', message: `${name} does not support negative edge weights (edge "${G.edgeIds[i]}" has weight ${G.edgeW[i]}). Use Bellman-Ford instead.` }];
      }
    }
    return [];
  },
  undirected(G, name) {
    return G.directed ? [{ code: 'REQUIRES_UNDIRECTED', message: `${name} requires an undirected graph. Switch the graph mode to undirected.` }] : [];
  },
  directed(G, name) {
    return G.directed ? [] : [{ code: 'REQUIRES_DIRECTED', message: `${name} requires a directed graph. Switch the graph mode to directed.` }];
  },
  noUndirectedNegative(G, name) {
    if (G.directed) return [];
    for (let i = 0; i < G.m; i++) {
      if (G.edgeW[i] < 0) {
        return [{ code: 'UNDIRECTED_NEGATIVE', message: `${name}: undirected edge "${G.edgeIds[i]}" has negative weight; traversing it back and forth is a negative cycle, so shortest paths are undefined. Use a directed graph.` }];
      }
    }
    return [];
  },
  maxNodes(G, name, limit) {
    return G.n > limit ? [{ code: 'TOO_LARGE', message: `${name} is limited to ${limit} nodes in this mode (graph has ${G.n}).` }] : [];
  },
};
