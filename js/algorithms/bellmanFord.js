/**
 * Bellman-Ford single-source shortest paths.
 *
 * Performs up to V − 1 passes over all arcs in canonical order (nodes by index, each node's
 * adjacency in canonical order; undirected edges contribute an arc in each direction).
 * Stops early after a pass with no successful relaxation. A final pass detects negative
 * cycles reachable from the source; the cycle is extracted and reported.
 *
 * Supports negative weights on directed graphs. On undirected graphs a negative edge is itself
 * a negative cycle (u → v → u), so such inputs are rejected with an explanatory error.
 *
 * Complexity: O(V · E) time worst case, O(V) extra space.
 */
import { requirements } from '../core/GraphValidator.js';
import { COUNTER, counter, createCounters, reconstructPath, fmt, INSPECT_LIMIT } from './common.js';

const COUNTERS = [
  counter(COUNTER.nodesVisited, 'Distinct nodes whose distance became finite (reached).'),
  counter(COUNTER.edgesExamined, 'Arc inspections across all passes (including the detection pass).'),
  counter(COUNTER.relaxAttempts, 'Arc inspections whose tail had a finite distance.'),
  counter(COUNTER.relaxSuccess, 'Relaxations that improved a distance.'),
  { key: 'passes', label: 'Passes', description: 'Relaxation passes performed (early termination included).' },
];

const PSEUDOCODE = [
  'BELLMAN-FORD(G, s):',
  '  for each v: dist[v] ← ∞; prev[v] ← nil',
  '  dist[s] ← 0',
  '  repeat V − 1 times:',
  '    changed ← false',
  '    for each arc (u, v, w):',
  '      if dist[u] + w < dist[v]:',
  '        dist[v] ← dist[u] + w; prev[v] ← u; changed ← true',
  '    if not changed: break',
  '  for each arc (u, v, w):            // detection pass',
  '    if dist[u] + w < dist[v]: report negative cycle',
  '  return dist, prev',
];

function validate(G, opts) {
  return [
    ...requirements.nonEmpty(G),
    ...requirements.start(G, opts, true),
    ...requirements.target(G, opts, false),
    ...requirements.noUndirectedNegative(G, 'Bellman-Ford'),
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
  let pass = 0;
  const snap = T ? () => ({ dist: dist.slice(), pred: pred.slice(), pass }) : null;

  T?.emit('ALGORITHM_STARTED', { nodeId: G.ids[s], line: 1, metadata: { start: G.ids[s], target: t >= 0 ? G.ids[t] : null } }, snap);
  dist[s] = 0;
  c.nodesVisited = 1;
  T?.emit('DISTANCE_UPDATED', { nodeId: G.ids[s], line: 2, metadata: { distance: 0 } }, snap);
  T?.emit('NODE_DISCOVERED', { nodeId: G.ids[s], line: 2, metadata: { distance: 0 } }, snap);

  for (pass = 1; pass <= Math.max(0, n - 1); pass++) {
    c.passes++;
    let changed = false;
    T?.emit('ROUND_STARTED', { line: 3, metadata: { pass, label: `Pass ${pass}` } }, snap);
    for (let u = 0; u < n; u++) {
      for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) {
        c.edgesExamined++;
        const v = G.adjTo[k];
        const e = G.adjE[k];
        if (T && dist[u] !== Infinity) T.emit('EDGE_EXAMINED', { edgeId: G.edgeIds[e], nodeId: G.ids[v], line: 5, metadata: { from: G.ids[u], to: G.ids[v], weight: G.adjW[k] } }, snap);
        if (dist[u] === Infinity) continue;
        c.relaxAttempts++;
        const nd = dist[u] + G.adjW[k];
        if (nd < dist[v]) {
          if (dist[v] === Infinity) {
            c.nodesVisited++;
            T?.emit('NODE_DISCOVERED', { nodeId: G.ids[v], line: 7, metadata: { distance: nd } }, snap);
          }
          const prevEdge = predEdge[v];
          dist[v] = nd;
          pred[v] = u;
          predEdge[v] = e;
          c.relaxSuccess++;
          changed = true;
          T?.emit('EDGE_RELAXED', { edgeId: G.edgeIds[e], nodeId: G.ids[v], line: 7, metadata: { from: G.ids[u], to: G.ids[v], distance: nd, treeEdge: G.edgeIds[e], replacedEdge: prevEdge >= 0 ? G.edgeIds[prevEdge] : null } }, snap);
          T?.emit('DISTANCE_UPDATED', { nodeId: G.ids[v], line: 7, metadata: { distance: nd } }, snap);
        }
      }
    }
    if (!changed) { T?.emit('ROUND_STARTED', { line: 8, metadata: { pass, label: `Pass ${pass}: no change — stop`, final: true } }, snap); break; }
  }

  // Detection pass.
  T?.emit('ROUND_STARTED', { line: 9, metadata: { pass: 'check', label: 'Negative-cycle check' } }, snap);
  // Pass V relaxes once more (updating predecessors); any success proves a reachable negative
  // cycle, and walking V predecessor steps back from the last relaxed node lands on it.
  let witness = -1;
  for (let u = 0; u < n; u++) {
    for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) {
      c.edgesExamined++;
      if (dist[u] === Infinity) continue;
      const v = G.adjTo[k];
      const nd = dist[u] + G.adjW[k];
      if (nd < dist[v]) {
        dist[v] = nd;
        pred[v] = u;
        predEdge[v] = G.adjE[k];
        witness = v;
      }
    }
  }

  if (witness >= 0) {
    // Walk back n steps to land inside the cycle, then collect it.
    let x = witness;
    for (let i = 0; i < n && pred[x] >= 0; i++) x = pred[x];
    const cycle = [x];
    const cycleEdges = [predEdge[x]];
    for (let y = pred[x], guard = 0; y !== x && y >= 0 && guard <= n; y = pred[y], guard++) { cycle.push(y); cycleEdges.push(predEdge[y]); }
    cycle.reverse();
    cycleEdges.reverse();
    let w = 0;
    for (const e of cycleEdges) w += G.edgeW[e];
    const error = { code: 'NEGATIVE_CYCLE', message: `Negative cycle detected (${cycle.map((i) => G.labels[i]).join(' → ')} → ${G.labels[cycle[0]]}, total weight ${fmt(w)}). Shortest paths are undefined.` };
    T?.emit('NEGATIVE_CYCLE', { line: 10, metadata: { cycle: cycle.map((i) => G.ids[i]), edges: cycleEdges.map((e) => G.edgeIds[e]), weight: w } }, snap);
    T?.emit('ALGORITHM_FAILED', { line: 10, metadata: { error } }, snap);
    return { status: 'failed', error, s, t, dist, pred, predEdge, cycle, cycleEdges, cycleWeight: w, path: null, counters: c, distanceKind: 'weighted' };
  }

  const p = t >= 0 ? reconstructPath(G, pred, predEdge, s, t) : null;
  if (p) T?.emit('PATH_FOUND', { nodeId: G.ids[t], line: 11, metadata: { path: p.path.map((i) => G.ids[i]), edges: p.pathEdges.map((e) => G.edgeIds[e]), cost: p.cost, hops: p.pathEdges.length } }, snap);
  T?.emit('ALGORITHM_COMPLETED', { line: 11, metadata: { passes: c.passes } }, snap);
  return { status: t >= 0 && !p ? 'no-path' : 'completed', s, t, dist, pred, predEdge, path: p, counters: c, distanceKind: 'weighted' };
}

function inspect(st, G) {
  const rows = [];
  for (let i = 0; i < st.dist.length && rows.length < INSPECT_LIMIT; i++) {
    if (st.dist[i] !== Infinity) rows.push([G.labels[i], fmt(st.dist[i]), st.pred[i] >= 0 ? G.labels[st.pred[i]] : '—']);
  }
  return [
    { title: 'Current pass', kind: 'text', text: String(st.pass) },
    { title: 'Distances & predecessors', kind: 'table', columns: ['Node', 'dist', 'prev'], rows },
  ];
}

export default {
  id: 'bellmanFord',
  name: 'Bellman-Ford Algorithm',
  shortName: 'Bellman-Ford',
  version: '1.0.0',
  category: 'Shortest Path',
  problems: ['shortest-path'],
  needs: { start: true, target: 'optional', weights: 'any (directed)', direction: 'any' },
  complexity: { time: 'O(V · E)', space: 'O(V)', fn: (V, E) => V * E },
  description: 'Single-source shortest paths that tolerates negative weights and detects negative cycles.',
  prerequisites: 'A start node. Negative weights only on directed graphs.',
  implementationNotes: 'Up to V − 1 passes in canonical arc order with early termination; a detection pass extracts any reachable negative cycle.',
  counters: COUNTERS,
  pseudocode: PSEUDOCODE,
  limits: { traceNodes: 2000, benchmarkNodes: 3000 },
  validate,
  run,
  inspect,
};
