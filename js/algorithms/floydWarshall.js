/**
 * Floyd-Warshall all-pairs shortest paths.
 *
 * Dense V × V distance matrix (Float64Array) and next-hop matrix for path reconstruction.
 * Pivots k are processed in canonical node order; for each pivot, pairs (i, j) in row-major
 * order. Parallel edges are resolved to the cheapest during initialisation.
 *
 * Negative weights are supported on directed graphs; a negative diagonal entry after the
 * main loop reports a negative cycle. Undirected negative edges are rejected (see Bellman-Ford).
 *
 * If a start (and optional destination) is selected, the corresponding row/path is reported
 * so the result is comparable with single-source algorithms.
 *
 * Complexity: Θ(V³) time, Θ(V²) space.
 * Tracing emits one event per pivot and one per improvement; large graphs are restricted.
 */
import { requirements } from '../core/GraphValidator.js';
import { COUNTER, counter, createCounters, fmt } from './common.js';

const COUNTERS = [
  counter(COUNTER.nodesVisited, 'Pivots processed (one per node).'),
  counter(COUNTER.edgesExamined, 'Edges read while initialising the matrix.'),
  counter(COUNTER.relaxAttempts, 'Triple checks d[i][k] + d[k][j] < d[i][j] with finite d[i][k] and d[k][j].'),
  counter(COUNTER.relaxSuccess, 'Triple checks that improved d[i][j].'),
];

const PSEUDOCODE = [
  'FLOYD-WARSHALL(G):',
  '  d[i][j] ← 0 if i = j, w(i, j) if edge, ∞ otherwise',
  '  for k in V:                      // pivot',
  '    for i in V:',
  '      for j in V:',
  '        if d[i][k] + d[k][j] < d[i][j]:',
  '          d[i][j] ← d[i][k] + d[k][j]; next[i][j] ← next[i][k]',
  '  if any d[i][i] < 0: report negative cycle',
  '  return d, next',
];

const TRACE_LIMIT = 60;
const RUN_LIMIT = 800;

function validate(G, opts, ctx = {}) {
  return [
    ...requirements.nonEmpty(G),
    ...requirements.start(G, opts, false),
    ...requirements.target(G, opts, false),
    ...requirements.noUndirectedNegative(G, 'Floyd-Warshall'),
    ...requirements.maxNodes(G, 'Floyd-Warshall', ctx.trace ? TRACE_LIMIT : RUN_LIMIT),
    ...(opts.target && !opts.start ? [{ code: 'START_REQUIRED', message: 'Select a start node to report a path to the destination.' }] : []),
  ];
}

function run(G, opts, T) {
  const c = createCounters(COUNTERS);
  T?.attach(c);
  const n = G.n;
  const s = opts.start ? G.index.get(opts.start) : -1;
  const t = opts.target ? G.index.get(opts.target) : -1;
  const d = new Float64Array(n * n).fill(Infinity);
  const next = new Int32Array(n * n).fill(-1);
  const nextEdge = new Int32Array(n * n).fill(-1);
  for (let i = 0; i < n; i++) { d[i * n + i] = 0; next[i * n + i] = i; }
  let pivot = -1;
  const snap = T ? () => ({ pivot, row: s >= 0 ? d.slice(s * n, s * n + n) : null, matrix: n <= 12 ? d.slice() : null, n }) : null;

  T?.emit('ALGORITHM_STARTED', { line: 1, metadata: { start: s >= 0 ? G.ids[s] : null } }, snap);
  for (let i = 0; i < G.m; i++) {
    c.edgesExamined++;
    const a = G.edgeS[i]; const b = G.edgeT[i]; const w = G.edgeW[i];
    const pairs = G.directed || a === b ? [[a, b]] : [[a, b], [b, a]];
    for (const [u, v] of pairs) {
      const idx = u * n + v;
      if (u === v) {
        if (w < d[idx]) { d[idx] = w; nextEdge[idx] = i; }
        continue;
      }
      if (w < d[idx] || (w === d[idx] && next[idx] === -1)) {
        d[idx] = w; next[idx] = v; nextEdge[idx] = i;
      }
    }
    T?.emit('EDGE_EXAMINED', { edgeId: G.edgeIds[i], line: 1, metadata: { weight: w } }, snap);
  }

  for (let k = 0; k < n; k++) {
    pivot = k;
    c.nodesVisited++;
    T?.emit('ROUND_STARTED', { nodeId: G.ids[k], line: 2, metadata: { pivot: G.ids[k], label: `Pivot ${G.labels[k]}` } }, snap);
    T?.emit('NODE_VISITED', { nodeId: G.ids[k], line: 2, metadata: {} }, snap);
    const kn = k * n;
    for (let i = 0; i < n; i++) {
      const dik = d[i * n + k];
      if (dik === Infinity) continue;
      const in_ = i * n;
      for (let j = 0; j < n; j++) {
        const dkj = d[kn + j];
        if (dkj === Infinity) continue;
        c.relaxAttempts++;
        const nd = dik + dkj;
        if (nd < d[in_ + j]) {
          d[in_ + j] = nd;
          next[in_ + j] = next[in_ + k];
          c.relaxSuccess++;
          if (T && (i === s || s < 0)) {
            T.emit('DISTANCE_UPDATED', { nodeId: G.ids[j], line: 6, metadata: { from: G.ids[i], to: G.ids[j], via: G.ids[k], distance: nd, row: G.ids[i] } }, snap);
          }
        }
      }
    }
    T?.emit('NODE_FINALIZED', { nodeId: G.ids[k], line: 2, metadata: {} }, snap);
  }

  const negative = [];
  for (let i = 0; i < n; i++) if (d[i * n + i] < 0) negative.push(i);
  if (negative.length) {
    const error = { code: 'NEGATIVE_CYCLE', message: `Negative cycle detected through ${negative.slice(0, 8).map((i) => G.labels[i]).join(', ')}${negative.length > 8 ? '…' : ''}. Shortest paths are undefined.` };
    T?.emit('NEGATIVE_CYCLE', { line: 7, metadata: { nodes: negative.map((i) => G.ids[i]) } }, snap);
    T?.emit('ALGORITHM_FAILED', { line: 7, metadata: { error } }, snap);
    return { status: 'failed', error, s, t, matrix: d, cycle: negative, path: null, counters: c, distanceKind: 'weighted' };
  }

  // Path reconstruction via next-hop matrix (choose cheapest edge between consecutive nodes).
  let p = null;
  if (s >= 0 && t >= 0) {
    if (s === t) p = { path: [s], pathEdges: [], cost: 0 };
    else if (next[s * n + t] !== -1) {
      const path = [s];
      const pathEdges = [];
      let u = s;
      let cost = 0;
      let guard = 0;
      while (u !== t && guard++ <= n) {
        const v = next[u * n + t];
        const e = nextEdge[u * n + v];
        path.push(v);
        pathEdges.push(e);
        cost += G.edgeW[e];
        u = v;
      }
      p = { path, pathEdges, cost };
    }
  }
  const dist = s >= 0 ? d.slice(s * n, s * n + n) : null;
  const predOut = new Int32Array(n).fill(-1);
  const predEdgeOut = new Int32Array(n).fill(-1);
  if (s >= 0) {
    // Derive a shortest-path tree from the source row: pred[v] = the node before v on the s→v path.
    for (let v = 0; v < n; v++) {
      if (v === s || next[s * n + v] === -1) continue;
      let u = s;
      let guard = 0;
      while (guard++ <= n) {
        const w = next[u * n + v];
        if (w === v) { predOut[v] = u; predEdgeOut[v] = nextEdge[u * n + v]; break; }
        u = w;
      }
    }
  }
  if (p) T?.emit('PATH_FOUND', { nodeId: G.ids[t], line: 8, metadata: { path: p.path.map((i) => G.ids[i]), edges: p.pathEdges.map((e) => G.edgeIds[e]), cost: p.cost, hops: p.pathEdges.length } }, snap);
  T?.emit('ALGORITHM_COMPLETED', { line: 8, metadata: {} }, snap);
  return {
    status: s >= 0 && t >= 0 && !p ? 'no-path' : 'completed',
    s, t, matrix: d, dist, pred: s >= 0 ? predOut : null, predEdge: s >= 0 ? predEdgeOut : null, path: p, counters: c, distanceKind: 'weighted',
  };
}

function inspect(st, G) {
  const sections = [{ title: 'Current pivot k', kind: 'text', text: st.pivot >= 0 ? G.labels[st.pivot] : '—' }];
  if (st.row) {
    sections.push({ title: 'Row of start node', kind: 'table', columns: ['To', 'dist'], rows: Array.from(st.row, (v, i) => [G.labels[i], fmt(v)]) });
  }
  if (st.matrix) {
    const n = st.n;
    const rows = [];
    for (let i = 0; i < n; i++) rows.push([G.labels[i], ...Array.from({ length: n }, (_, j) => fmt(st.matrix[i * n + j]))]);
    sections.push({ title: 'Distance matrix', kind: 'table', columns: ['', ...G.labels.slice(0, n)], rows });
  } else {
    sections.push({ title: 'Distance matrix', kind: 'text', text: 'Shown for graphs with ≤ 12 nodes.' });
  }
  return sections;
}

export default {
  id: 'floydWarshall',
  name: 'Floyd-Warshall Algorithm',
  shortName: 'Floyd-Warshall',
  version: '1.0.0',
  category: 'Shortest Path',
  problems: ['shortest-path'],
  needs: { start: 'optional', target: 'optional', weights: 'any (directed)', direction: 'any' },
  complexity: { time: 'Θ(V³)', space: 'Θ(V²)', fn: (V) => V ** 3 },
  description: 'All-pairs shortest paths by dynamic programming over intermediate vertices.',
  prerequisites: 'No start required (a start/destination selects the reported row and path). Negative weights only on directed graphs.',
  implementationNotes: `Dense typed-array matrices with next-hop reconstruction. Limited to ${TRACE_LIMIT} nodes when stepping and ${RUN_LIMIT} nodes otherwise.`,
  counters: COUNTERS,
  pseudocode: PSEUDOCODE,
  limits: { traceNodes: TRACE_LIMIT, benchmarkNodes: RUN_LIMIT },
  validate,
  run,
  inspect,
};
