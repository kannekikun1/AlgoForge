/**
 * Kruskal's minimum spanning forest.
 *
 * Sorts edges by (weight, canonical edge index) and adds each edge whose endpoints are in
 * different components of a disjoint-set structure. On a disconnected graph the result is a
 * minimum spanning forest (one tree per connected component, isolated nodes included).
 *
 * Self-loops are examined and rejected (they can never be part of a forest).
 * Negative and zero weights are allowed. Requires an undirected graph.
 *
 * Complexity: O(E log E) = O(E log V) for the sort, plus O(E α(V)) for union–find.
 */
import { DisjointSet } from '../structures/DisjointSet.js';
import { requirements } from '../core/GraphValidator.js';
import { COUNTER, counter, createCounters, fmt, INSPECT_LIMIT } from './common.js';

const COUNTERS = [
  counter(COUNTER.nodesVisited, 'Nodes joined to another tree by an accepted edge (endpoints newly covered).'),
  counter(COUNTER.edgesExamined, 'Edges considered in sorted order (stops once the forest is complete).'),
  { key: 'comparisons', label: 'Sort comparisons', description: 'Comparator calls while sorting edges.' },
  { key: 'finds', label: 'Union–find finds', description: 'Calls to find() (path halving).' },
  { key: 'unions', label: 'Unions', description: 'Successful merges (= accepted edges).' },
];

const PSEUDOCODE = [
  'KRUSKAL(G):',
  '  sort edges by (weight, index)',
  '  make-set(v) for each v; F ← ∅',
  '  for each edge (u, v, w) in sorted order:',
  '    if find(u) ≠ find(v):',
  '      F ← F ∪ {(u, v)}; union(u, v)      // accept',
  '    else: reject (would form a cycle)',
  '    if |F| = V − components: stop',
  '  return F',
];

function validate(G) {
  return [...requirements.nonEmpty(G), ...requirements.undirected(G, "Kruskal's algorithm")];
}

function run(G, opts, T) {
  const c = createCounters(COUNTERS);
  T?.attach(c);
  const n = G.n;
  const order = Array.from({ length: G.m }, (_, i) => i);
  order.sort((a, b) => { c.comparisons++; return (G.edgeW[a] - G.edgeW[b]) || (a - b); });
  const ds = new DisjointSet(n, c);
  const covered = new Uint8Array(n);
  const tree = [];
  const status = new Int8Array(G.m); // 0 pending, 1 accepted, -1 rejected
  let total = 0;
  let pos = -1;
  // Number of edges in a spanning forest = V − (number of connected components).
  const target = n - countComponents(G);
  const snap = T ? () => ({ pos, sorted: order, status: status.slice(), parent: ds.parent.slice(), total }) : null;

  T?.emit('ALGORITHM_STARTED', { line: 1, metadata: { edges: G.m } }, snap);
  for (pos = 0; pos < order.length && tree.length < target; pos++) {
    const e = order[pos];
    const u = G.edgeS[e]; const v = G.edgeT[e];
    c.edgesExamined++;
    T?.emit('EDGE_EXAMINED', { edgeId: G.edgeIds[e], line: 3, metadata: { weight: G.edgeW[e], from: G.ids[u], to: G.ids[v] } }, snap);
    if (u !== v && ds.union(u, v)) {
      status[e] = 1;
      tree.push(e);
      total += G.edgeW[e];
      for (const x of [u, v]) {
        if (!covered[x]) { covered[x] = 1; c.nodesVisited++; T?.emit('NODE_VISITED', { nodeId: G.ids[x], line: 5, metadata: {} }, snap); }
      }
      T?.emit('EDGE_ACCEPTED', { edgeId: G.edgeIds[e], line: 5, metadata: { weight: G.edgeW[e], total } }, snap);
    } else {
      status[e] = -1;
      T?.emit('EDGE_REJECTED', { edgeId: G.edgeIds[e], line: 6, metadata: { reason: u === v ? 'self-loop' : 'cycle' } }, snap);
    }
  }
  const components = ds.count;
  T?.emit('ALGORITHM_COMPLETED', { line: 8, metadata: { totalWeight: total, edges: tree.length, components } }, snap);
  return { status: 'completed', treeEdges: tree, totalWeight: total, components, counters: c, path: null };
}

function countComponents(G) {
  const ds = new DisjointSet(G.n);
  for (let i = 0; i < G.m; i++) ds.union(G.edgeS[i], G.edgeT[i]);
  return ds.count;
}

function inspect(st, G) {
  const rows = [];
  for (let i = 0; i < st.sorted.length && rows.length < INSPECT_LIMIT; i++) {
    const e = st.sorted[i];
    const mark = st.status[e] === 1 ? 'accepted' : st.status[e] === -1 ? 'rejected' : i === st.pos ? 'current' : '';
    rows.push([String(i + 1), `${G.labels[G.edgeS[e]]}–${G.labels[G.edgeT[e]]}`, fmt(G.edgeW[e]), mark]);
  }
  const groups = new Map();
  const find = (x) => { while (st.parent[x] !== x) x = st.parent[x]; return x; };
  for (let i = 0; i < st.parent.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(G.labels[i]);
  }
  const comps = [...groups.values()].filter((g) => g.length > 1).map((g) => `{${g.slice(0, 12).join(', ')}${g.length > 12 ? ', …' : ''}}`);
  return [
    { title: 'Forest weight', kind: 'text', text: fmt(st.total) },
    { title: 'Sorted edges', kind: 'table', columns: ['#', 'Edge', 'w', 'Status'], rows },
    { title: 'Union–find components (size > 1)', kind: 'list', items: comps.slice(0, INSPECT_LIMIT), total: comps.length },
  ];
}

export default {
  id: 'kruskal',
  name: "Kruskal's Algorithm",
  shortName: 'Kruskal',
  version: '1.0.0',
  category: 'Minimum Spanning Tree',
  problems: ['mst'],
  needs: { start: false, target: false, weights: 'any', direction: 'undirected' },
  complexity: { time: 'O(E log V)', space: 'O(V + E)', fn: (V, E) => E * Math.log2(Math.max(2, V)) },
  description: 'Builds a minimum spanning forest by adding the cheapest edges that do not form cycles.',
  prerequisites: 'Undirected graph. Any weights. Disconnected graphs yield a spanning forest.',
  implementationNotes: 'Edges sorted by (weight, canonical index); union by rank with path halving; stops once V − components edges are accepted.',
  counters: COUNTERS,
  pseudocode: PSEUDOCODE,
  limits: { traceNodes: 5000, benchmarkNodes: 5000 },
  validate,
  run,
  inspect,
};
