/**
 * A* search (single pair).
 *
 * f(n) = g(n) + h(n). Binary heap with lazy deletion, ordered by (f, h, canonical index):
 * on equal f, the node closer to the goal (smaller h, i.e. larger g) is expanded first.
 *
 * Heuristics (option `heuristic`):
 *   - 'calibrated' (default): h(n) = k · euclid(n, t), where
 *         k = min over edges (u,v) with euclid(u,v) > 0 of  w(u,v) / euclid(u,v)  (clamped ≥ 0).
 *     Proof of consistency: for every edge, h(u) − h(v) ≤ k·euclid(u,v) ≤ w(u,v) by the triangle
 *     inequality and the definition of k (edges between coincident nodes have h(u) = h(v)).
 *     A consistent heuristic with h(t) = 0 is admissible, so A* returns optimal paths.
 *   - 'zero': h ≡ 0 (A* degenerates to Dijkstra with early exit; used in differential tests).
 *   - 'euclidean': raw Euclidean distance in canvas units. Admissible only if every weight is
 *     at least its edge's drawn length. Results are flagged `optimalityGuaranteed: false`.
 *
 * Consistency policy: a node in the closed set is reopened if a strictly better g is found.
 * With 'calibrated' or 'zero' this provably never happens; with 'euclidean' it may, and the
 * `reopened` counter reports it.
 *
 * Requirements: destination node, non-negative weights.
 */
import { PriorityQueue } from '../structures/PriorityQueue.js';
import { requirements } from '../core/GraphValidator.js';
import { COUNTER, counter, createCounters, reconstructPath, fmt, INSPECT_LIMIT } from './common.js';

const COUNTERS = [
  counter(COUNTER.nodesVisited, 'Nodes expanded (moved to the closed set).'),
  counter(COUNTER.edgesExamined, 'Adjacency entries inspected from expanded nodes.'),
  counter(COUNTER.relaxAttempts, 'Comparisons g[u] + w < g[v].'),
  counter(COUNTER.relaxSuccess, 'Comparisons that improved g[v].'),
  counter(COUNTER.pqPush, 'Open-set heap insertions.'),
  counter(COUNTER.pqPop, 'Open-set heap extractions (including stale entries).'),
  { key: 'heuristicEvals', label: 'Heuristic evaluations', description: 'Calls to h(n) (cached per node).' },
  { key: 'stalePops', label: 'Stale entries skipped', description: 'Popped entries superseded by a better g (lazy deletion).' },
  { key: 'reopened', label: 'Closed nodes reopened', description: 'Non-zero only for inconsistent heuristics.' },
];

const PSEUDOCODE = [
  'A*(G, s, t, h):',
  '  for each v: g[v] ← ∞; prev[v] ← nil',
  '  g[s] ← 0; OPEN.push(s, f = h(s))',
  '  while OPEN not empty:',
  '    u ← OPEN.popMin()   // lowest f, then lowest h',
  '    if u in CLOSED or stale: continue',
  '    CLOSED.add(u)        // expand u',
  '    if u = t: return path(t)',
  '    for each edge (u, v, w):',
  '      if g[u] + w < g[v]:',
  '        g[v] ← g[u] + w; prev[v] ← u',
  '        OPEN.push(v, f = g[v] + h(v))',
  '  return failure (t unreachable)',
];

export const HEURISTICS = Object.freeze({
  calibrated: 'Calibrated Euclidean (consistent)',
  zero: 'Zero (equivalent to Dijkstra)',
  euclidean: 'Raw Euclidean (may be inadmissible)',
});

function validate(G, opts) {
  const errs = [
    ...requirements.nonEmpty(G),
    ...requirements.start(G, opts, true),
    ...requirements.target(G, opts, true),
    ...requirements.nonNegative(G, 'A* search'),
  ];
  if (opts.heuristic && !(opts.heuristic in HEURISTICS)) {
    errs.push({ code: 'HEURISTIC_UNKNOWN', message: `Unknown heuristic "${opts.heuristic}".` });
  }
  return errs;
}

/** Compute the calibration constant k (see module docs). */
export function calibrationFactor(G) {
  let k = Infinity;
  for (let i = 0; i < G.m; i++) {
    const a = G.edgeS[i]; const b = G.edgeT[i];
    const len = Math.hypot(G.x[a] - G.x[b], G.y[a] - G.y[b]);
    if (len > 0) k = Math.min(k, G.edgeW[i] / len);
  }
  if (!Number.isFinite(k) || k < 0) k = 0;
  return k;
}

function run(G, opts, T) {
  const c = createCounters(COUNTERS);
  T?.attach(c);
  const n = G.n;
  const s = G.index.get(opts.start);
  const t = G.index.get(opts.target);
  const kind = opts.heuristic ?? 'calibrated';
  const scale = kind === 'calibrated' ? calibrationFactor(G) : kind === 'zero' ? 0 : 1;
  const tx = G.x[t]; const ty = G.y[t];
  const hCache = new Float64Array(n).fill(NaN);
  const h = (v) => {
    if (Number.isNaN(hCache[v])) {
      c.heuristicEvals++;
      hCache[v] = scale === 0 ? 0 : scale * Math.hypot(G.x[v] - tx, G.y[v] - ty);
    }
    return hCache[v];
  };
  const g = new Float64Array(n).fill(Infinity);
  const pred = new Int32Array(n).fill(-1);
  const predEdge = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const order = [];
  const open = new PriorityQueue(c);
  const closedG = new Float64Array(n).fill(Infinity);
  // Open-set order: f, then h (closer to goal first), then canonical node index.
  const pushOrdered = (v) => { const hv = h(v); open.push(v, g[v] + hv, hv, v); };
  const snap = T ? () => ({ open: open.heap.map((e) => [e.value, e.priority, e.tie, e.tie2, e.seq]), g: g.slice(), h: hCache.slice(), pred: pred.slice(), closed: closed.slice() }) : null;

  T?.emit('ALGORITHM_STARTED', { nodeId: G.ids[s], line: 1, metadata: { start: G.ids[s], target: G.ids[t], heuristic: kind, scale } }, snap);
  g[s] = 0;
  pushOrdered(s);
  T?.emit('NODE_DISCOVERED', { nodeId: G.ids[s], line: 2, metadata: { distance: 0, h: h(s), f: h(s) } }, snap);
  T?.emit('DISTANCE_UPDATED', { nodeId: G.ids[s], line: 2, metadata: { distance: 0 } }, snap);

  let found = false;
  while (!open.isEmpty()) {
    const { value: u, priority: f } = open.pop();
    if (f > g[u] + h(u) || (closed[u] && g[u] >= closedG[u])) { c.stalePops++; continue; }
    if (closed[u]) c.reopened++;
    closed[u] = 1;
    closedG[u] = g[u];
    order.push(u);
    c.nodesVisited++;
    T?.emit('NODE_VISITED', { nodeId: G.ids[u], line: 6, metadata: { distance: g[u], g: g[u], h: h(u), f: g[u] + h(u) } }, snap);
    if (u === t) {
      found = true;
      T?.emit('NODE_FINALIZED', { nodeId: G.ids[u], line: 7, metadata: { distance: g[u] } }, snap);
      break;
    }
    for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) {
      const v = G.adjTo[k];
      const w = G.adjW[k];
      const e = G.adjE[k];
      c.edgesExamined++;
      T?.emit('EDGE_EXAMINED', { edgeId: G.edgeIds[e], nodeId: G.ids[v], line: 8, metadata: { from: G.ids[u], to: G.ids[v], weight: w } }, snap);
      c.relaxAttempts++;
      const ng = g[u] + w;
      if (ng < g[v]) {
        const prevEdge = predEdge[v];
        const firstTime = g[v] === Infinity;
        g[v] = ng;
        pred[v] = u;
        predEdge[v] = e;
        c.relaxSuccess++;
        pushOrdered(v);
        if (firstTime) T?.emit('NODE_DISCOVERED', { nodeId: G.ids[v], line: 11, metadata: { distance: ng, h: h(v), f: ng + h(v) } }, snap);
        T?.emit('EDGE_RELAXED', { edgeId: G.edgeIds[e], nodeId: G.ids[v], line: 10, metadata: { from: G.ids[u], to: G.ids[v], distance: ng, treeEdge: G.edgeIds[e], replacedEdge: prevEdge >= 0 ? G.edgeIds[prevEdge] : null } }, snap);
        T?.emit('DISTANCE_UPDATED', { nodeId: G.ids[v], line: 10, metadata: { distance: ng, f: ng + h(v) } }, snap);
      }
    }
    T?.emit('NODE_FINALIZED', { nodeId: G.ids[u], line: 6, metadata: { distance: g[u] } }, snap);
  }

  const p = found ? reconstructPath(G, pred, predEdge, s, t) : null;
  if (p) T?.emit('PATH_FOUND', { nodeId: G.ids[t], line: 7, metadata: { path: p.path.map((i) => G.ids[i]), edges: p.pathEdges.map((e) => G.edgeIds[e]), cost: p.cost, hops: p.pathEdges.length } }, snap);
  T?.emit('ALGORITHM_COMPLETED', { line: p ? 7 : 12, metadata: { expanded: order.length, found } }, snap);
  return {
    status: p ? 'completed' : 'no-path',
    s, t, dist: g, pred, predEdge, order, path: p, counters: c,
    distanceKind: 'weighted',
    heuristic: { kind, scale, optimalityGuaranteed: kind !== 'euclidean' },
  };
}

function inspect(st, G) {
  const fmtE = (e) => `${G.labels[e[0]]}:f=${fmt(e[1])}`;
  const sorted = [...st.open].sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]) || (a[3] - b[3]) || (a[4] - b[4]));
  const closed = [];
  const rows = [];
  for (let i = 0; i < st.g.length; i++) {
    if (st.closed[i]) closed.push(G.labels[i]);
    if (st.g[i] !== Infinity && rows.length < INSPECT_LIMIT) {
      const hv = Number.isNaN(st.h[i]) ? NaN : st.h[i];
      rows.push([G.labels[i], fmt(st.g[i]), Number.isNaN(hv) ? '—' : fmt(hv), Number.isNaN(hv) ? '—' : fmt(st.g[i] + hv), st.pred[i] >= 0 ? G.labels[st.pred[i]] : '—']);
    }
  }
  return [
    { title: 'Open set (pop order)', kind: 'list', items: sorted.slice(0, INSPECT_LIMIT).map(fmtE), total: sorted.length },
    { title: 'Closed set', kind: 'list', items: closed.slice(0, INSPECT_LIMIT), total: closed.length },
    { title: 'Scores', kind: 'table', columns: ['Node', 'g', 'h', 'f', 'prev'], rows },
  ];
}

export default {
  id: 'astar',
  name: 'A* Search',
  shortName: 'A*',
  version: '1.0.0',
  category: 'Shortest Path',
  problems: ['shortest-path'],
  needs: { start: true, target: 'required', weights: 'non-negative', direction: 'any' },
  options: [{ key: 'heuristic', label: 'Heuristic', type: 'select', choices: HEURISTICS, default: 'calibrated' }],
  complexity: { time: 'O((V + E) log V)', space: 'O(V + E)', fn: (V, E) => (V + E) * Math.log2(Math.max(2, V)), note: 'Worst case with a consistent heuristic; a good heuristic expands far fewer nodes.' },
  description: 'Goal-directed shortest path search guided by a heuristic estimate of the remaining distance.',
  prerequisites: 'Start and destination nodes; all edge weights ≥ 0. Node coordinates are used by the heuristic.',
  implementationNotes: 'Default heuristic is Euclidean distance scaled by the minimum weight-to-length ratio over all edges, which is provably consistent for any weights. Open set ordered by (f, h, index).',
  counters: COUNTERS,
  pseudocode: PSEUDOCODE,
  limits: { traceNodes: 5000, benchmarkNodes: 5000 },
  validate,
  run,
  inspect,
};
