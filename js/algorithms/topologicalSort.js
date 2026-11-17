/**
 * Kahn's topological sort.
 *
 * Repeatedly removes a node with in-degree 0. The ready queue is FIFO; it is seeded with all
 * initial sources in canonical order, and nodes whose in-degree drops to 0 are appended in
 * the order their last incoming arc is processed (canonical adjacency order). The output is
 * therefore fully deterministic.
 *
 * Rejects graphs containing directed cycles (including self-loops): if fewer than V nodes are
 * output, the remaining nodes all lie on or downstream of a cycle; one concrete cycle is
 * extracted and reported. Requires a directed graph. Weights are ignored.
 *
 * Complexity: O(V + E) time, O(V) extra space.
 */
import { Queue } from '../structures/Queue.js';
import { requirements, findDirectedCycle } from '../core/GraphValidator.js';
import { COUNTER, counter, createCounters, INSPECT_LIMIT } from './common.js';

const COUNTERS = [
  counter(COUNTER.nodesVisited, 'Nodes removed from the ready queue and output.'),
  counter(COUNTER.edgesExamined, 'Arcs processed (in-degree computation + decrements).'),
  { key: 'queueOps', label: 'Queue operations', description: 'Enqueue + dequeue on the ready queue.' },
];

const PSEUDOCODE = [
  'KAHN(G):',
  '  compute indeg[v] for every v',
  '  Q ← all v with indeg[v] = 0 (canonical order)',
  '  while Q not empty:',
  '    u ← Q.dequeue(); append u to order   // visit u',
  '    for each arc (u, v):',
  '      indeg[v] ← indeg[v] − 1',
  '      if indeg[v] = 0: Q.enqueue(v)',
  '  if |order| < V: reject — graph has a cycle',
  '  return order',
];

function validate(G) {
  return [...requirements.nonEmpty(G), ...requirements.directed(G, "Kahn's topological sort")];
}

function run(G, opts, T) {
  const c = createCounters(COUNTERS);
  T?.attach(c);
  const n = G.n;
  const indeg = new Int32Array(n);
  for (let u = 0; u < n; u++) {
    for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) { indeg[G.adjTo[k]]++; c.edgesExamined++; }
  }
  const Q = new Queue();
  const order = [];
  const position = new Int32Array(n).fill(-1);
  const snap = T ? () => ({ queue: Q.toArray(), indeg: indeg.slice(), order: order.slice() }) : null;
  T?.emit('ALGORITHM_STARTED', { line: 1, metadata: {} }, snap);
  for (let v = 0; v < n; v++) {
    if (indeg[v] === 0) {
      Q.enqueue(v); c.queueOps++;
      T?.emit('NODE_DISCOVERED', { nodeId: G.ids[v], line: 2, metadata: { indegree: 0 } }, snap);
    }
  }
  while (!Q.isEmpty()) {
    const u = Q.dequeue(); c.queueOps++;
    position[u] = order.length;
    order.push(u);
    c.nodesVisited++;
    T?.emit('NODE_VISITED', { nodeId: G.ids[u], line: 4, metadata: {} }, snap);
    T?.emit('ORDER_ASSIGNED', { nodeId: G.ids[u], line: 4, metadata: { order: order.length, label: `#${order.length}` } }, snap);
    for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) {
      const v = G.adjTo[k];
      c.edgesExamined++;
      indeg[v]--;
      T?.emit('EDGE_EXAMINED', { edgeId: G.edgeIds[G.adjE[k]], nodeId: G.ids[v], line: 6, metadata: { indegree: indeg[v] } }, snap);
      if (indeg[v] === 0) {
        Q.enqueue(v); c.queueOps++;
        T?.emit('NODE_DISCOVERED', { nodeId: G.ids[v], line: 7, metadata: { indegree: 0 } }, snap);
      }
    }
    T?.emit('NODE_FINALIZED', { nodeId: G.ids[u], line: 4, metadata: {} }, snap);
  }
  if (order.length < n) {
    const cycle = findDirectedCycle(G) ?? [];
    const error = {
      code: 'CYCLE_DETECTED',
      message: `Graph contains a directed cycle (${cycle.map((i) => G.labels[i]).join(' → ')}${cycle.length ? ` → ${G.labels[cycle[0]]}` : ''}); no topological order exists. ${n - order.length} node(s) could not be ordered.`,
    };
    T?.emit('ALGORITHM_FAILED', { line: 8, metadata: { error, cycle: cycle.map((i) => G.ids[i]) } }, snap);
    return { status: 'failed', error, order, cycle, counters: c, path: null };
  }
  T?.emit('ALGORITHM_COMPLETED', { line: 9, metadata: { order: order.map((i) => G.ids[i]) } }, snap);
  return { status: 'completed', order, position, counters: c, path: null };
}

function inspect(st, G) {
  const rows = [];
  for (let i = 0; i < st.indeg.length && rows.length < INSPECT_LIMIT; i++) rows.push([G.labels[i], String(st.indeg[i])]);
  return [
    { title: 'Ready queue', kind: 'list', items: st.queue.slice(0, INSPECT_LIMIT).map((i) => G.labels[i]), total: st.queue.length },
    { title: 'Order so far', kind: 'list', items: st.order.slice(0, INSPECT_LIMIT).map((i) => G.labels[i]), total: st.order.length },
    { title: 'Remaining in-degree', kind: 'table', columns: ['Node', 'indeg'], rows },
  ];
}

export default {
  id: 'topologicalSort',
  name: "Kahn's Topological Sort",
  shortName: 'Kahn',
  version: '1.0.0',
  category: 'Topological Processing',
  problems: ['topological'],
  needs: { start: false, target: false, weights: 'ignored', direction: 'directed' },
  complexity: { time: 'O(V + E)', space: 'O(V)', fn: (V, E) => V + E },
  description: 'Orders the nodes of a directed acyclic graph so that every edge points forward.',
  prerequisites: 'Directed graph without cycles (self-loops count as cycles).',
  implementationNotes: 'FIFO ready queue seeded in canonical order; on failure a concrete cycle is extracted with an iterative DFS.',
  counters: COUNTERS,
  pseudocode: PSEUDOCODE,
  limits: { traceNodes: 5000, benchmarkNodes: 5000 },
  validate,
  run,
  inspect,
};
