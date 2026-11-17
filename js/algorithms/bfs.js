/**
 * Breadth-First Search.
 *
 * Explores nodes in order of hop distance from the start node using a FIFO queue.
 * Edge weights are ignored for the search; the reported path cost is the sum of the
 * weights along the BFS (fewest-hops) path so it can be compared with weighted algorithms.
 *
 * Tie-breaking: neighbours are examined in canonical adjacency order (neighbour index, then
 * edge index), so the discovery order and the BFS tree are fully deterministic.
 * Early exit: if a destination is selected, the search stops when it is dequeued.
 *
 * Complexity: O(V + E) time, O(V) extra space (adjacency list).
 */
import { Queue } from '../structures/Queue.js';
import { requirements } from '../core/GraphValidator.js';
import { COUNTER, counter, createCounters, reconstructPath, fmt, INSPECT_LIMIT } from './common.js';

const COUNTERS = [
  counter(COUNTER.nodesVisited, 'Nodes dequeued and expanded.'),
  counter(COUNTER.edgesExamined, 'Adjacency entries inspected (each undirected edge can be seen from both ends).'),
  { key: 'queueOps', label: 'Queue operations', description: 'Enqueue + dequeue operations on the FIFO queue.' },
];

const PSEUDOCODE = [
  'BFS(G, s, t):',
  '  for each v: dist[v] ← ∞; parent[v] ← nil',
  '  dist[s] ← 0; mark s discovered; Q.enqueue(s)',
  '  while Q not empty:',
  '    u ← Q.dequeue()            // visit u',
  '    if u = t: return path(t)',
  '    for each edge (u, v):',
  '      if v not discovered:',
  '        dist[v] ← dist[u] + 1; parent[v] ← u',
  '        mark v discovered; Q.enqueue(v)',
  '  return dist, parent',
];

function validate(G, opts) {
  return [...requirements.nonEmpty(G), ...requirements.start(G, opts, true), ...requirements.target(G, opts, false)];
}

function run(G, opts, T) {
  const c = createCounters(COUNTERS);
  T?.attach(c);
  const s = G.index.get(opts.start);
  const t = opts.target ? G.index.get(opts.target) : -1;
  const n = G.n;
  const dist = new Float64Array(n).fill(Infinity);
  const pred = new Int32Array(n).fill(-1);
  const predEdge = new Int32Array(n).fill(-1);
  const discovered = new Uint8Array(n);
  const visited = new Uint8Array(n);
  const order = [];
  const Q = new Queue();
  const snap = T ? () => ({ queue: Q.toArray(), dist: dist.slice(), pred: pred.slice(), visited: visited.slice(), discovered: discovered.slice() }) : null;

  T?.emit('ALGORITHM_STARTED', { nodeId: G.ids[s], line: 1, metadata: { start: G.ids[s], target: t >= 0 ? G.ids[t] : null } }, snap);
  dist[s] = 0;
  discovered[s] = 1;
  Q.enqueue(s); c.queueOps++;
  T?.emit('NODE_DISCOVERED', { nodeId: G.ids[s], line: 2, metadata: { distance: 0 } }, snap);
  T?.emit('DISTANCE_UPDATED', { nodeId: G.ids[s], line: 2, metadata: { distance: 0 } }, snap);

  let found = false;
  while (!Q.isEmpty()) {
    const u = Q.dequeue(); c.queueOps++;
    visited[u] = 1;
    order.push(u);
    c.nodesVisited++;
    T?.emit('NODE_VISITED', { nodeId: G.ids[u], line: 4, metadata: { distance: dist[u] } }, snap);
    if (u === t) { found = true; break; }
    for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) {
      const v = G.adjTo[k];
      c.edgesExamined++;
      T?.emit('EDGE_EXAMINED', { edgeId: G.edgeIds[G.adjE[k]], nodeId: G.ids[v], line: 6, metadata: { from: G.ids[u], to: G.ids[v] } }, snap);
      if (!discovered[v]) {
        discovered[v] = 1;
        dist[v] = dist[u] + 1;
        pred[v] = u;
        predEdge[v] = G.adjE[k];
        Q.enqueue(v); c.queueOps++;
        T?.emit('NODE_DISCOVERED', { nodeId: G.ids[v], edgeId: G.edgeIds[G.adjE[k]], line: 9, metadata: { distance: dist[v], parent: G.ids[u], treeEdge: G.edgeIds[G.adjE[k]] } }, snap);
        T?.emit('DISTANCE_UPDATED', { nodeId: G.ids[v], line: 8, metadata: { distance: dist[v] } }, snap);
      }
    }
    T?.emit('NODE_FINALIZED', { nodeId: G.ids[u], line: 3, metadata: {} }, snap);
  }

  const p = t >= 0 ? reconstructPath(G, pred, predEdge, s, t) : null;
  if (t >= 0) {
    if (p) T?.emit('PATH_FOUND', { nodeId: G.ids[t], line: 5, metadata: { path: p.path.map((i) => G.ids[i]), edges: p.pathEdges.map((e) => G.edgeIds[e]), cost: p.cost, hops: p.pathEdges.length } }, snap);
  }
  T?.emit('ALGORITHM_COMPLETED', { line: 10, metadata: { reached: discovered.reduce((a, b) => a + b, 0), found } }, snap);
  return {
    status: t >= 0 && !p ? 'no-path' : 'completed',
    s, t, dist, pred, predEdge, order, path: p, counters: c,
    distanceKind: 'hops',
  };
}

function inspect(state, G) {
  const lim = (arr) => arr.slice(0, INSPECT_LIMIT);
  const rows = [];
  for (let i = 0; i < state.dist.length && rows.length < INSPECT_LIMIT; i++) {
    if (state.discovered[i]) rows.push({ node: G.labels[i], value: fmt(state.dist[i]), parent: state.pred[i] >= 0 ? G.labels[state.pred[i]] : '—' });
  }
  const visited = [];
  for (let i = 0; i < state.visited.length; i++) if (state.visited[i]) visited.push(G.labels[i]);
  return [
    { title: 'Queue (front → back)', kind: 'list', items: lim(state.queue.map((i) => G.labels[i])), total: state.queue.length },
    { title: 'Visited set', kind: 'list', items: lim(visited), total: visited.length },
    { title: 'Hop distance & parent', kind: 'table', columns: ['Node', 'Hops', 'Parent'], rows: rows.map((r) => [r.node, r.value, r.parent]) },
  ];
}

export default {
  id: 'bfs',
  name: 'Breadth-First Search',
  shortName: 'BFS',
  version: '1.0.0',
  category: 'Graph Traversal',
  problems: ['traversal', 'shortest-path'],
  needs: { start: true, target: 'optional', weights: 'ignored', direction: 'any' },
  complexity: { time: 'O(V + E)', space: 'O(V)', fn: (V, E) => V + E },
  description: 'Explores the graph level by level from the start node. Finds fewest-hop paths; weights are ignored.',
  prerequisites: 'A start node. Works on directed and undirected graphs, any weights (ignored).',
  implementationNotes: 'FIFO queue with head index; neighbours in canonical order; stops early when the destination is dequeued.',
  counters: COUNTERS,
  pseudocode: PSEUDOCODE,
  limits: { traceNodes: 5000, benchmarkNodes: 5000 },
  validate,
  run,
  inspect,
};
