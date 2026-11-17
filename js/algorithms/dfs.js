/**
 * Depth-First Search (iterative, recursion-order faithful).
 *
 * Uses an explicit stack of (node, next-adjacency-position) frames, which reproduces exactly
 * the visit order of the classic recursive formulation without risking call-stack overflow.
 *
 * Tie-breaking: neighbours are explored in canonical adjacency order.
 * Early exit: if a destination is selected, the search stops when it is first visited.
 * Records discovery/finish times and preorder/postorder.
 *
 * Complexity: O(V + E) time, O(V) extra space.
 */
import { requirements } from '../core/GraphValidator.js';
import { COUNTER, counter, createCounters, reconstructPath, INSPECT_LIMIT } from './common.js';

const COUNTERS = [
  counter(COUNTER.nodesVisited, 'Nodes entered (preorder visits).'),
  counter(COUNTER.edgesExamined, 'Adjacency entries inspected.'),
  { key: 'stackOps', label: 'Stack operations', description: 'Push + pop operations on the explicit DFS stack.' },
  { key: 'maxDepth', label: 'Maximum stack depth', description: 'Deepest recursion level reached.' },
];

const PSEUDOCODE = [
  'DFS(G, s, t):',
  '  for each v: state[v] ← unvisited',
  '  VISIT(s)',
  'VISIT(u):',
  '  state[u] ← active; disc[u] ← time++   // visit u',
  '  if u = t: stop and return path(t)',
  '  for each edge (u, v):',
  '    if state[v] = unvisited:',
  '      parent[v] ← u; VISIT(v)',
  '  state[u] ← done; fin[u] ← time++     // finalize u',
];

function validate(G, opts) {
  return [...requirements.nonEmpty(G), ...requirements.start(G, opts, true), ...requirements.target(G, opts, false)];
}

function run(G, opts, T) {
  const c = createCounters(COUNTERS);
  T?.attach(c);
  const n = G.n;
  const s = G.index.get(opts.start);
  const t = opts.target ? G.index.get(opts.target) : -1;
  const state = new Uint8Array(n); // 0 unvisited, 1 active, 2 done
  const pred = new Int32Array(n).fill(-1);
  const predEdge = new Int32Array(n).fill(-1);
  const disc = new Float64Array(n).fill(Infinity);
  const fin = new Float64Array(n).fill(Infinity);
  const depth = new Float64Array(n).fill(Infinity);
  const nodeStack = [];
  const posStack = [];
  const order = [];
  const post = [];
  let time = 0;
  const snap = T ? () => ({ stack: nodeStack.slice(), state: state.slice(), pred: pred.slice(), disc: disc.slice(), fin: fin.slice() }) : null;

  T?.emit('ALGORITHM_STARTED', { nodeId: G.ids[s], line: 1, metadata: { start: G.ids[s], target: t >= 0 ? G.ids[t] : null } }, snap);

  let found = false;
  const enter = (u) => {
    state[u] = 1;
    disc[u] = time++;
    depth[u] = nodeStack.length;
    nodeStack.push(u);
    posStack.push(G.adjStart[u]);
    c.stackOps++;
    c.nodesVisited++;
    if (nodeStack.length > c.maxDepth) c.maxDepth = nodeStack.length;
    order.push(u);
    T?.emit('NODE_VISITED', { nodeId: G.ids[u], line: 4, metadata: { discovery: disc[u], depth: depth[u] } }, snap);
    T?.emit('ORDER_ASSIGNED', { nodeId: G.ids[u], line: 4, metadata: { order: order.length, label: `#${order.length}` } }, snap);
    if (u === t) found = true;
  };

  enter(s);
  while (nodeStack.length && !found) {
    const top = nodeStack.length - 1;
    const u = nodeStack[top];
    const k = posStack[top];
    if (k < G.adjStart[u + 1]) {
      posStack[top] = k + 1;
      const v = G.adjTo[k];
      c.edgesExamined++;
      T?.emit('EDGE_EXAMINED', { edgeId: G.edgeIds[G.adjE[k]], nodeId: G.ids[v], line: 6, metadata: { from: G.ids[u], to: G.ids[v] } }, snap);
      if (state[v] === 0) {
        pred[v] = u;
        predEdge[v] = G.adjE[k];
        T?.emit('NODE_DISCOVERED', { nodeId: G.ids[v], edgeId: G.edgeIds[G.adjE[k]], line: 8, metadata: { parent: G.ids[u], treeEdge: G.edgeIds[G.adjE[k]] } }, snap);
        enter(v);
      }
    } else {
      nodeStack.pop();
      posStack.pop();
      c.stackOps++;
      state[u] = 2;
      fin[u] = time++;
      post.push(u);
      T?.emit('NODE_FINALIZED', { nodeId: G.ids[u], line: 9, metadata: { finish: fin[u] } }, snap);
    }
  }

  const p = t >= 0 ? reconstructPath(G, pred, predEdge, s, t) : null;
  if (p) T?.emit('PATH_FOUND', { nodeId: G.ids[t], line: 5, metadata: { path: p.path.map((i) => G.ids[i]), edges: p.pathEdges.map((e) => G.edgeIds[e]), cost: p.cost, hops: p.pathEdges.length } }, snap);
  T?.emit('ALGORITHM_COMPLETED', { line: 2, metadata: { visited: order.length, found } }, snap);
  return {
    status: t >= 0 && !p ? 'no-path' : 'completed',
    s, t, pred, predEdge, order, postorder: post, discovery: disc, finish: fin, dist: depth, path: p, counters: c,
    distanceKind: 'depth',
  };
}

function inspect(st, G) {
  const visited = [];
  const active = [];
  for (let i = 0; i < st.state.length; i++) {
    if (st.state[i]) visited.push(G.labels[i]);
    if (st.state[i] === 1) active.push(G.labels[i]);
  }
  const rows = [];
  for (let i = 0; i < st.state.length && rows.length < INSPECT_LIMIT; i++) {
    if (!st.state[i]) continue;
    rows.push([G.labels[i], String(st.disc[i]), st.fin[i] === Infinity ? '—' : String(st.fin[i]), st.pred[i] >= 0 ? G.labels[st.pred[i]] : '—']);
  }
  return [
    { title: 'Stack (bottom → top)', kind: 'list', items: st.stack.slice(-INSPECT_LIMIT).map((i) => G.labels[i]), total: st.stack.length },
    { title: 'Visited set', kind: 'list', items: visited.slice(0, INSPECT_LIMIT), total: visited.length },
    { title: 'Discovery / finish times', kind: 'table', columns: ['Node', 'Disc', 'Fin', 'Parent'], rows },
  ];
}

export default {
  id: 'dfs',
  name: 'Depth-First Search',
  shortName: 'DFS',
  version: '1.0.0',
  category: 'Graph Traversal',
  problems: ['traversal'],
  needs: { start: true, target: 'optional', weights: 'ignored', direction: 'any' },
  complexity: { time: 'O(V + E)', space: 'O(V)', fn: (V, E) => V + E },
  description: 'Explores as deep as possible along each branch before backtracking. Records discovery and finish times.',
  prerequisites: 'A start node. Works on directed and undirected graphs, any weights (ignored).',
  implementationNotes: 'Iterative with an explicit (node, adjacency cursor) stack, matching recursive visit order; stops when the destination is first visited.',
  counters: COUNTERS,
  pseudocode: PSEUDOCODE,
  limits: { traceNodes: 5000, benchmarkNodes: 5000 },
  validate,
  run,
  inspect,
};
