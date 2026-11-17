/**
 * Prim's minimum spanning forest.
 *
 * Lazy Prim with a binary heap of candidate edges ordered by (weight, canonical edge index,
 * neighbour index). Grows a tree from the selected start node (or the first node in canonical
 * order); when the heap empties and nodes remain, a new tree is started from the lowest-index
 * unvisited node, producing a minimum spanning forest for disconnected graphs.
 *
 * Self-loops are skipped. Negative and zero weights are allowed. Requires an undirected graph.
 *
 * Complexity: O(E log V) time (heap holds ≤ 2E entries), O(V + E) space.
 */
import { PriorityQueue } from '../structures/PriorityQueue.js';
import { requirements } from '../core/GraphValidator.js';
import { COUNTER, counter, createCounters, fmt, INSPECT_LIMIT } from './common.js';

const COUNTERS = [
  counter(COUNTER.nodesVisited, 'Nodes added to the forest.'),
  counter(COUNTER.edgesExamined, 'Adjacency entries inspected from newly added nodes.'),
  counter(COUNTER.pqPush, 'Candidate edges pushed.'),
  counter(COUNTER.pqPop, 'Candidate edges popped (including stale ones).'),
  { key: 'trees', label: 'Trees started', description: 'Number of trees in the forest (= connected components).' },
];

const PSEUDOCODE = [
  'PRIM(G, r):',
  '  for each root r (start, then unvisited nodes in order):',
  '    add r to tree',
  '    push every edge (r, v) into PQ',
  '    while PQ not empty:',
  '      (u, v, w) ← PQ.popMin()',
  '      if v already in tree: continue      // stale',
  '      accept (u, v); add v to tree',
  '      for each edge (v, x): if x not in tree: PQ.push',
  '  return forest',
];

function validate(G, opts) {
  return [...requirements.nonEmpty(G), ...requirements.undirected(G, "Prim's algorithm"), ...requirements.start(G, opts, false)];
}

function run(G, opts, T) {
  const c = createCounters(COUNTERS);
  T?.attach(c);
  const n = G.n;
  const inTree = new Uint8Array(n);
  const parent = new Int32Array(n).fill(-1);
  const tree = [];
  let total = 0;
  const pq = new PriorityQueue(c);
  const snap = T ? () => ({ pq: pq.heap.map((e) => [e.value, e.priority, e.tie, e.tie2]), inTree: inTree.slice(), parent: parent.slice(), total }) : null;

  const addNode = (u) => {
    inTree[u] = 1;
    c.nodesVisited++;
    T?.emit('NODE_VISITED', { nodeId: G.ids[u], line: 2, metadata: {} }, snap);
    for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) {
      const x = G.adjTo[k];
      c.edgesExamined++;
      T?.emit('EDGE_EXAMINED', { edgeId: G.edgeIds[G.adjE[k]], nodeId: G.ids[x], line: 8, metadata: { weight: G.adjW[k] } }, snap);
      if (!inTree[x]) {
        // value encodes the arc; tie = edge index, tie2 = neighbour index.
        pq.push(k, G.adjW[k], G.adjE[k], x);
        if (T) T.emit('NODE_DISCOVERED', { nodeId: G.ids[x], line: 8, metadata: {} }, snap);
      }
    }
  };

  T?.emit('ALGORITHM_STARTED', { line: 0, metadata: {} }, snap);
  const first = opts.start && G.index.has(opts.start) ? G.index.get(opts.start) : 0;
  const roots = [first, ...Array.from({ length: n }, (_, i) => i).filter((i) => i !== first)];
  for (const r of roots) {
    if (inTree[r]) continue;
    c.trees++;
    T?.emit('ROUND_STARTED', { nodeId: G.ids[r], line: 1, metadata: { label: `Tree ${c.trees} from ${G.labels[r]}` } }, snap);
    addNode(r);
    while (!pq.isEmpty()) {
      const { value: k } = pq.pop();
      const v = G.adjTo[k];
      if (inTree[v]) continue;
      const e = G.adjE[k];
      const u = G.edgeS[e] === v ? G.edgeT[e] : G.edgeS[e];
      parent[v] = u;
      tree.push(e);
      total += G.edgeW[e];
      T?.emit('EDGE_ACCEPTED', { edgeId: G.edgeIds[e], nodeId: G.ids[v], line: 7, metadata: { weight: G.edgeW[e], total } }, snap);
      addNode(v);
      T?.emit('NODE_FINALIZED', { nodeId: G.ids[v], line: 7, metadata: {} }, snap);
    }
    T?.emit('NODE_FINALIZED', { nodeId: G.ids[r], line: 2, metadata: {} }, snap);
  }
  T?.emit('ALGORITHM_COMPLETED', { line: 9, metadata: { totalWeight: total, edges: tree.length, components: c.trees } }, snap);
  return { status: 'completed', treeEdges: tree, totalWeight: total, components: c.trees, parent, counters: c, path: null };
}

function inspect(st, G) {
  const sorted = [...st.pq].sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]) || (a[3] - b[3]));
  const items = sorted.slice(0, INSPECT_LIMIT).map((e) => {
    const edge = G.adjE[e[0]];
    return `${G.labels[G.edgeS[edge]]}–${G.labels[G.edgeT[edge]]}:${fmt(e[1])}${st.inTree[G.adjTo[e[0]]] ? ' (stale)' : ''}`;
  });
  const inTree = [];
  for (let i = 0; i < st.inTree.length; i++) if (st.inTree[i]) inTree.push(G.labels[i]);
  return [
    { title: 'Forest weight', kind: 'text', text: fmt(st.total) },
    { title: 'Candidate edges (pop order)', kind: 'list', items, total: sorted.length },
    { title: 'Nodes in forest', kind: 'list', items: inTree.slice(0, INSPECT_LIMIT), total: inTree.length },
  ];
}

export default {
  id: 'prim',
  name: "Prim's Algorithm",
  shortName: 'Prim',
  version: '1.0.0',
  category: 'Minimum Spanning Tree',
  problems: ['mst'],
  needs: { start: 'optional', target: false, weights: 'any', direction: 'undirected' },
  complexity: { time: 'O(E log V)', space: 'O(V + E)', fn: (V, E) => E * Math.log2(Math.max(2, V)) },
  description: 'Grows a minimum spanning tree from a root by repeatedly taking the cheapest edge leaving the tree.',
  prerequisites: 'Undirected graph. Any weights. Optional start node chooses the first root.',
  implementationNotes: 'Lazy binary heap of arcs ordered by (weight, edge index, neighbour index); restarts at the lowest-index unvisited node to build a forest.',
  counters: COUNTERS,
  pseudocode: PSEUDOCODE,
  limits: { traceNodes: 5000, benchmarkNodes: 5000 },
  validate,
  run,
  inspect,
};
