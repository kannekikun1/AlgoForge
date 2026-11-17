/**
 * Dijkstra's single-source shortest paths.
 *
 * Binary-heap priority queue with lazy deletion: instead of decrease-key, an improved
 * distance is pushed as a new entry and stale entries are skipped when popped.
 * Heap size is bounded by E + 1, so time is O((V + E) log V) (log E ≤ 2 log V).
 *
 * Requirements: all edge weights ≥ 0 (negative weights are rejected — use Bellman-Ford).
 * Tie-breaking: equal tentative distances are popped in canonical node order; a distance is
 * only replaced by a strictly smaller one, so the first-found predecessor wins on ties.
 * Early exit: with a destination selected, stops when the destination is finalised.
 */
import { PriorityQueue } from '../structures/PriorityQueue.js';
import { requirements } from '../core/GraphValidator.js';
import { COUNTER, counter, createCounters, reconstructPath, fmt, INSPECT_LIMIT } from './common.js';

const COUNTERS = [
  counter(COUNTER.nodesVisited, 'Nodes popped from the queue and finalised (stale entries excluded).'),
  counter(COUNTER.edgesExamined, 'Adjacency entries inspected from finalised nodes.'),
  counter(COUNTER.relaxAttempts, 'Comparisons dist[u] + w < dist[v] for non-finalised neighbours.'),
  counter(COUNTER.relaxSuccess, 'Relaxations that improved a tentative distance.'),
  counter(COUNTER.pqPush, 'Heap insertions.'),
  counter(COUNTER.pqPop, 'Heap extractions (including stale entries).'),
  { key: 'stalePops', label: 'Stale entries skipped', description: 'Popped entries superseded by a better distance (lazy deletion).' },
];

const PSEUDOCODE = [
  'DIJKSTRA(G, s, t):',
  '  for each v: dist[v] ← ∞; prev[v] ← nil',
  '  dist[s] ← 0; PQ.push(s, 0)',
  '  while PQ not empty:',
  '    (u, d) ← PQ.popMin()',
  '    if u finalized: continue     // stale entry',
  '    finalize u                    // visit u',
  '    if u = t: break',
  '    for each edge (u, v, w):',
  '      if v not finalized and dist[u] + w < dist[v]:',
  '        dist[v] ← dist[u] + w; prev[v] ← u',
  '        PQ.push(v, dist[v])',
  '  return dist, prev',
];

function validate(G, opts) {
  return [
    ...requirements.nonEmpty(G),
    ...requirements.start(G, opts, true),
    ...requirements.target(G, opts, false),
    ...requirements.nonNegative(G, "Dijkstra's algorithm"),
  ];
}

function run(G, opts, T) {
  const c = createCounters(COUNTERS);
  T?.attach(c);
  const n = G.n;
  const s = G.index.get(opts.start);
  const t = opts.target ? G.index.get(opts.target) : -1;
  const dist = new Float64Array(n).fill(Infinity);
  const pred = new Int32Array(n).fill(-1);
  const predEdge = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const order = [];
  const pq = new PriorityQueue(c);
  const snap = T ? () => ({ pq: pq.heap.map((e) => [e.value, e.priority, e.tie, e.seq]), dist: dist.slice(), pred: pred.slice(), done: done.slice() }) : null;

  T?.emit('ALGORITHM_STARTED', { nodeId: G.ids[s], line: 1, metadata: { start: G.ids[s], target: t >= 0 ? G.ids[t] : null } }, snap);
  dist[s] = 0;
  pq.push(s, 0, s);
  T?.emit('NODE_DISCOVERED', { nodeId: G.ids[s], line: 2, metadata: { distance: 0 } }, snap);
  T?.emit('DISTANCE_UPDATED', { nodeId: G.ids[s], line: 2, metadata: { distance: 0 } }, snap);

  while (!pq.isEmpty()) {
    const { value: u, priority: d } = pq.pop();
    if (done[u] || d > dist[u]) { c.stalePops++; continue; }
    done[u] = 1;
    order.push(u);
    c.nodesVisited++;
    T?.emit('NODE_VISITED', { nodeId: G.ids[u], line: 6, metadata: { distance: d } }, snap);
    if (u === t) {
      T?.emit('NODE_FINALIZED', { nodeId: G.ids[u], line: 7, metadata: { distance: d } }, snap);
      break;
    }
    for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) {
      const v = G.adjTo[k];
      const w = G.adjW[k];
      const e = G.adjE[k];
      c.edgesExamined++;
      T?.emit('EDGE_EXAMINED', { edgeId: G.edgeIds[e], nodeId: G.ids[v], line: 8, metadata: { from: G.ids[u], to: G.ids[v], weight: w } }, snap);
      if (done[v]) continue;
      c.relaxAttempts++;
      const nd = d + w;
      if (nd < dist[v]) {
        const prevEdge = predEdge[v];
        const firstTime = dist[v] === Infinity;
        dist[v] = nd;
        pred[v] = u;
        predEdge[v] = e;
        c.relaxSuccess++;
        pq.push(v, nd, v);
        if (firstTime) T?.emit('NODE_DISCOVERED', { nodeId: G.ids[v], line: 11, metadata: { distance: nd } }, snap);
        T?.emit('EDGE_RELAXED', { edgeId: G.edgeIds[e], nodeId: G.ids[v], line: 10, metadata: { from: G.ids[u], to: G.ids[v], distance: nd, treeEdge: G.edgeIds[e], replacedEdge: prevEdge >= 0 ? G.edgeIds[prevEdge] : null } }, snap);
        T?.emit('DISTANCE_UPDATED', { nodeId: G.ids[v], line: 10, metadata: { distance: nd } }, snap);
      }
    }
    T?.emit('NODE_FINALIZED', { nodeId: G.ids[u], line: 6, metadata: { distance: d } }, snap);
  }

  const p = t >= 0 ? reconstructPath(G, pred, predEdge, s, t) : null;
  if (p) T?.emit('PATH_FOUND', { nodeId: G.ids[t], line: 7, metadata: { path: p.path.map((i) => G.ids[i]), edges: p.pathEdges.map((e) => G.edgeIds[e]), cost: p.cost, hops: p.pathEdges.length } }, snap);
  T?.emit('ALGORITHM_COMPLETED', { line: 12, metadata: { finalized: order.length } }, snap);
  return { status: t >= 0 && !p ? 'no-path' : 'completed', s, t, dist, pred, predEdge, order, path: p, counters: c, distanceKind: 'weighted' };
}

/** Shared inspector for priority-queue snapshots: [[node, key, tie, seq], …] → sorted labels. */
export function pqItems(G, heap, format = (e) => `${G.labels[e[0]]}:${fmt(e[1])}`) {
  const sorted = [...heap].sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]) || (a[3] - b[3]));
  return sorted.slice(0, INSPECT_LIMIT).map(format);
}

function inspect(st, G) {
  const rows = [];
  const fin = [];
  for (let i = 0; i < st.dist.length; i++) {
    if (st.done[i]) fin.push(G.labels[i]);
    if (st.dist[i] !== Infinity && rows.length < INSPECT_LIMIT) {
      rows.push([G.labels[i], fmt(st.dist[i]), st.pred[i] >= 0 ? G.labels[st.pred[i]] : '—', st.done[i] ? '✓' : '']);
    }
  }
  return [
    { title: 'Priority queue (node:key, pop order)', kind: 'list', items: pqItems(G, st.pq), total: st.pq.length },
    { title: 'Tentative distances & predecessors', kind: 'table', columns: ['Node', 'dist', 'prev', 'final'], rows },
    { title: 'Finalized nodes', kind: 'list', items: fin.slice(0, INSPECT_LIMIT), total: fin.length },
  ];
}

export default {
  id: 'dijkstra',
  name: "Dijkstra's Algorithm",
  shortName: 'Dijkstra',
  version: '1.0.0',
  category: 'Shortest Path',
  problems: ['shortest-path'],
  needs: { start: true, target: 'optional', weights: 'non-negative', direction: 'any' },
  complexity: { time: 'O((V + E) log V)', space: 'O(V + E)', fn: (V, E) => (V + E) * Math.log2(Math.max(2, V)) },
  description: 'Single-source shortest paths on graphs with non-negative weights, expanding the closest unfinalised node first.',
  prerequisites: 'A start node; all edge weights ≥ 0.',
  implementationNotes: 'Binary heap with lazy deletion (heap holds ≤ E + 1 entries). Ties popped by canonical node index. Early exit at the destination.',
  counters: COUNTERS,
  pseudocode: PSEUDOCODE,
  limits: { traceNodes: 5000, benchmarkNodes: 5000 },
  validate,
  run,
  inspect,
};
