/**
 * EXAMPLE CUSTOM ALGORITHM MODULE — Greedy Best-First Search.
 *
 * This file is the reference template for contributors (see docs/contributing-algorithms.md).
 * It is a complete, tested algorithm, registered through js/algorithms/custom/index.js.
 *
 * Greedy best-first expands the open node with the smallest heuristic h(n) (straight-line
 * distance to the destination), ignoring the cost already paid. It is often fast but NOT
 * optimal, which makes it a useful foil for A* and Dijkstra in Race and Discovery Mode.
 *
 * Tie-breaking: (h, canonical index). Each node is expanded at most once.
 * Complexity: O((V + E) log V) time, O(V) space.
 */
import { PriorityQueue } from '../../structures/PriorityQueue.js';
import { requirements } from '../../core/GraphValidator.js';
import { COUNTER, counter, createCounters, reconstructPath, fmt, INSPECT_LIMIT } from '../common.js';

// 1. Declare the operation counters your algorithm reports, with precise definitions.
const COUNTERS = [
  counter(COUNTER.nodesVisited, 'Nodes expanded (each at most once).'),
  counter(COUNTER.edgesExamined, 'Adjacency entries inspected from expanded nodes.'),
  counter(COUNTER.pqPush, 'Open-set insertions.'),
  counter(COUNTER.pqPop, 'Open-set extractions.'),
];

// 2. Explicit pseudocode. Events reference these lines by index.
const PSEUDOCODE = [
  'GREEDY-BEST-FIRST(G, s, t, h):',
  '  OPEN.push(s, h(s)); mark s discovered',
  '  while OPEN not empty:',
  '    u ← OPEN.popMin()           // smallest h',
  '    if u expanded: continue',
  '    expand u                    // visit u',
  '    if u = t: return path(t)',
  '    for each edge (u, v):',
  '      if v not discovered:',
  '        prev[v] ← u; OPEN.push(v, h(v))',
  '  return failure',
];

// 3. Validation: return [{code, message}] — never throw for bad input.
function validate(G, opts) {
  return [
    ...requirements.nonEmpty(G),
    ...requirements.start(G, opts, true),
    ...requirements.target(G, opts, true),
    ...requirements.nonNegative(G, 'Greedy best-first search'),
  ];
}

// 4. run(G, options, T): pure computation on the compiled graph. T is an EventRecorder or null.
//    Always update counters; only build events/snapshots when T is non-null.
function run(G, opts, T) {
  const c = createCounters(COUNTERS);
  T?.attach(c);
  const n = G.n;
  const s = G.index.get(opts.start);
  const t = G.index.get(opts.target);
  const h = (v) => Math.hypot(G.x[v] - G.x[t], G.y[v] - G.y[t]);
  const pred = new Int32Array(n).fill(-1);
  const predEdge = new Int32Array(n).fill(-1);
  const discovered = new Uint8Array(n);
  const expanded = new Uint8Array(n);
  const open = new PriorityQueue(c);
  const order = [];
  const snap = T ? () => ({ open: open.heap.map((e) => [e.value, e.priority, e.tie, e.seq]), expanded: expanded.slice(), pred: pred.slice() }) : null;

  T?.emit('ALGORITHM_STARTED', { nodeId: G.ids[s], line: 0, metadata: { start: G.ids[s], target: G.ids[t] } }, snap);
  open.push(s, h(s), s);
  discovered[s] = 1;
  T?.emit('NODE_DISCOVERED', { nodeId: G.ids[s], line: 1, metadata: { h: h(s) } }, snap);
  let found = false;
  while (!open.isEmpty()) {
    const { value: u } = open.pop();
    if (expanded[u]) continue;
    expanded[u] = 1;
    order.push(u);
    c.nodesVisited++;
    T?.emit('NODE_VISITED', { nodeId: G.ids[u], line: 5, metadata: { h: h(u) } }, snap);
    if (u === t) { found = true; break; }
    for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) {
      const v = G.adjTo[k];
      c.edgesExamined++;
      T?.emit('EDGE_EXAMINED', { edgeId: G.edgeIds[G.adjE[k]], nodeId: G.ids[v], line: 7, metadata: { from: G.ids[u], to: G.ids[v], weight: G.adjW[k] } }, snap);
      if (!discovered[v]) {
        discovered[v] = 1;
        pred[v] = u;
        predEdge[v] = G.adjE[k];
        open.push(v, h(v), v);
        T?.emit('NODE_DISCOVERED', { nodeId: G.ids[v], line: 9, metadata: { h: h(v), parent: G.ids[u], treeEdge: G.edgeIds[G.adjE[k]] } }, snap);
      }
    }
    T?.emit('NODE_FINALIZED', { nodeId: G.ids[u], line: 5, metadata: {} }, snap);
  }
  const p = found ? reconstructPath(G, pred, predEdge, s, t) : null;
  if (p) T?.emit('PATH_FOUND', { nodeId: G.ids[t], line: 6, metadata: { path: p.path.map((i) => G.ids[i]), edges: p.pathEdges.map((e) => G.edgeIds[e]), cost: p.cost, hops: p.pathEdges.length } }, snap);
  T?.emit('ALGORITHM_COMPLETED', { line: p ? 6 : 10, metadata: { found } }, snap);
  // 5. Return an index-based raw result; the engine materialises ids outside timed regions.
  return { status: p ? 'completed' : 'no-path', s, t, pred, predEdge, order, path: p, counters: c, distanceKind: 'weighted' };
}

// 6. inspect(state, G): turn a snapshot into display sections (list | table | text).
function inspect(st, G) {
  const sorted = [...st.open].sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]) || (a[3] - b[3]));
  const exp = [];
  for (let i = 0; i < st.expanded.length; i++) if (st.expanded[i]) exp.push(G.labels[i]);
  return [
    { title: 'Open set (node:h, pop order)', kind: 'list', items: sorted.slice(0, INSPECT_LIMIT).map((e) => `${G.labels[e[0]]}:${fmt(e[1])}`), total: sorted.length },
    { title: 'Expanded', kind: 'list', items: exp.slice(0, INSPECT_LIMIT), total: exp.length },
  ];
}

// 7. Export the module descriptor.
export default {
  id: 'greedyBestFirst',
  name: 'Greedy Best-First Search (example module)',
  shortName: 'Greedy BFS',
  version: '1.0.0',
  category: 'Custom (example modules)',
  problems: ['shortest-path'],
  needs: { start: true, target: 'required', weights: 'non-negative', direction: 'any' },
  complexity: { time: 'O((V + E) log V)', space: 'O(V)', fn: (V, E) => (V + E) * Math.log2(Math.max(2, V)) },
  description: 'Expands the node that looks closest to the destination. Fast but not optimal — a contrast to A*.',
  prerequisites: 'Start and destination nodes; weights ≥ 0 (weights are ignored by the search itself).',
  implementationNotes: 'Example of the custom algorithm module interface. Heuristic: Euclidean distance; ties by canonical index.',
  counters: COUNTERS,
  pseudocode: PSEUDOCODE,
  limits: { traceNodes: 5000, benchmarkNodes: 5000 },
  validate,
  run,
  inspect,
};
