import { suite, test, assert } from '../harness.js';
import { g, deepFreeze } from '../helpers.js';
import { execute, listAlgorithms } from '../../js/core/AlgorithmEngine.js';
import { generateGraph } from '../../js/experiments/GraphGenerator.js';

const run = (id, data, opts = {}, cfg = {}) => execute(id, data, opts, cfg);
const empty = { directed: false, nodes: [], edges: [] };
const single = (directed = false) => ({ directed, nodes: [{ id: 'A', label: 'A', x: 0, y: 0 }], edges: [] });

suite('All algorithms — common contract', () => {
  for (const algo of listAlgorithms()) {
    test(`${algo.id}: rejects empty graph`, () => {
      const r = run(algo.id, empty, { start: 'A', target: 'A' });
      assert.equal(r.ok, false);
      assert.equal(r.errors[0].code, 'EMPTY_GRAPH');
    });

    test(`${algo.id}: handles single-node graph`, () => {
      const data = single(algo.needs.direction === 'directed');
      const r = run(algo.id, data, { start: 'A', target: 'A' });
      assert.ok(r.ok, JSON.stringify(r.errors));
      assert.equal(r.result.status, 'completed');
    });

    test(`${algo.id}: does not mutate input graph`, () => {
      const base = generateGraph({ family: algo.id === 'topologicalSort' ? 'dag' : 'random', nodes: 15, density: 0.3, directed: algo.needs.direction === 'directed', weights: { distribution: 'uniform', min: 1, max: 9 } }, 7);
      const data = algo.needs.direction === 'undirected' ? { ...base.graph, directed: false, edges: base.graph.edges.map((e) => ({ ...e, directed: false })) } : base.graph;
      const before = JSON.stringify(data);
      deepFreeze(data);
      const r = run(algo.id, data, { start: base.start, target: base.target });
      assert.ok(r.ok, JSON.stringify(r.errors));
      assert.equal(JSON.stringify(data), before);
    });

    test(`${algo.id}: counters identical with and without tracing`, () => {
      const directed = algo.needs.direction === 'directed';
      const base = generateGraph({ family: directed ? 'dag' : 'random', nodes: 25, density: 0.25, directed, weights: { distribution: 'uniform', min: 1, max: 9 } }, 99);
      const a = run(algo.id, base.graph, { start: base.start, target: base.target });
      const b = run(algo.id, base.graph, { start: base.start, target: base.target }, { trace: true });
      assert.deepEqual(a.result.counters, b.result.counters);
      assert.ok(b.events.length > 0);
      assert.equal(b.events[0].type, 'ALGORITHM_STARTED');
      const last = b.events[b.events.length - 1].type;
      assert.ok(last === 'ALGORITHM_COMPLETED' || last === 'ALGORITHM_FAILED');
    });

    test(`${algo.id}: deterministic across runs`, () => {
      const directed = algo.needs.direction === 'directed';
      const base = generateGraph({ family: directed ? 'dag' : 'random', nodes: 30, density: 0.2, directed, weights: { distribution: 'uniform', min: 1, max: 3 } }, 5);
      const a = run(algo.id, base.graph, { start: base.start, target: base.target }, { trace: true });
      const b = run(algo.id, base.graph, { start: base.start, target: base.target }, { trace: true });
      assert.equal(JSON.stringify(a.events.map((e) => [e.type, e.nodeId, e.edgeId])), JSON.stringify(b.events.map((e) => [e.type, e.nodeId, e.edgeId])));
      assert.deepEqual(a.result.counters, b.result.counters);
    });

    test(`${algo.id}: event lines are within pseudocode`, () => {
      const directed = algo.needs.direction === 'directed';
      const base = generateGraph({ family: directed ? 'dag' : 'random', nodes: 10, density: 0.3, directed }, 3);
      const r = run(algo.id, base.graph, { start: base.start, target: base.target }, { trace: true });
      for (const e of r.events) assert.ok(e.line >= -1 && e.line < algo.pseudocode.length, `line ${e.line} out of range for ${e.type}`);
    });

    test(`${algo.id}: handles large graph`, () => {
      const directed = algo.needs.direction === 'directed';
      const nodes = algo.id === 'floydWarshall' ? 120 : algo.id === 'bellmanFord' ? 400 : 1500;
      const base = generateGraph({ family: directed ? 'dag' : 'random', nodes, density: 6 / nodes, directed, weights: { distribution: 'uniform', min: 1, max: 50 } }, 11);
      const r = run(algo.id, base.graph, { start: base.start, target: base.target });
      assert.ok(r.ok, JSON.stringify(r.errors));
      assert.ok(['completed', 'no-path'].includes(r.result.status));
    });
  }
});

suite('BFS', () => {
  test('hop distances on undirected graph ignore weights', () => {
    const data = g([['A', 'B', 10], ['B', 'C', 10], ['A', 'C', 100]]);
    const r = run('bfs', data, { start: 'A' });
    assert.deepEqual(r.result.distances, { A: 0, B: 1, C: 1 });
  });
  test('respects direction', () => {
    const data = g([['A', 'B'], ['C', 'B']], { directed: true });
    const r = run('bfs', data, { start: 'A' });
    assert.equal(r.result.distances.C, Infinity);
  });
  test('disconnected target → no-path', () => {
    const data = g([['A', 'B'], ['C', 'D']]);
    const r = run('bfs', data, { start: 'A', target: 'D' });
    assert.equal(r.result.status, 'no-path');
    assert.equal(r.result.path, null);
  });
  test('tie-breaking: canonical neighbour order', () => {
    const data = g([['A', 'C'], ['A', 'B'], ['B', 'D'], ['C', 'D']]);
    const r = run('bfs', data, { start: 'A', target: 'D' });
    assert.deepEqual(r.result.order, ['A', 'B', 'C', 'D']);
    assert.deepEqual(r.result.path, ['A', 'B', 'D']);
  });
  test('cyclic graph terminates', () => {
    const data = g([['A', 'B'], ['B', 'C'], ['C', 'A']], { directed: true });
    const r = run('bfs', data, { start: 'A' });
    assert.equal(r.result.counters.nodesVisited, 3);
  });
  test('invalid start rejected', () => {
    const r = run('bfs', g([['A', 'B']]), { start: 'Z' });
    assert.equal(r.errors[0].code, 'START_UNKNOWN');
  });
  test('missing start rejected', () => {
    const r = run('bfs', g([['A', 'B']]), {});
    assert.equal(r.errors[0].code, 'START_REQUIRED');
  });
});

suite('DFS', () => {
  test('recursive visit order', () => {
    const data = g([['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D']]);
    const r = run('dfs', data, { start: 'A' });
    assert.deepEqual(r.result.order, ['A', 'B', 'D', 'C']);
    assert.deepEqual(r.result.postorder, ['C', 'D', 'B', 'A']);
  });
  test('stops at target', () => {
    const data = g([['A', 'B'], ['B', 'C'], ['A', 'D']]);
    const r = run('dfs', data, { start: 'A', target: 'C' });
    assert.deepEqual(r.result.path, ['A', 'B', 'C']);
    assert.ok(!r.result.order.includes('D'));
  });
  test('deep path does not overflow stack', () => {
    const edges = [];
    for (let i = 0; i < 4000; i++) edges.push([`n${i}`, `n${i + 1}`]);
    const r = run('dfs', g(edges, { directed: true }), { start: 'n0' });
    assert.equal(r.result.counters.maxDepth, 4001);
  });
  test('self-loop handled', () => {
    const r = run('dfs', g([['A', 'A'], ['A', 'B']], { directed: true }), { start: 'A' });
    assert.deepEqual(r.result.order, ['A', 'B']);
  });
});

suite('Dijkstra', () => {
  const data = g([['A', 'B', 4], ['A', 'C', 1], ['C', 'B', 2], ['B', 'D', 1], ['C', 'D', 5]]);
  test('shortest distances', () => {
    const r = run('dijkstra', data, { start: 'A' });
    assert.deepEqual(r.result.distances, { A: 0, B: 3, C: 1, D: 4 });
  });
  test('path and cost', () => {
    const r = run('dijkstra', data, { start: 'A', target: 'D' });
    assert.deepEqual(r.result.path, ['A', 'C', 'B', 'D']);
    assert.equal(r.result.pathCost, 4);
    assert.equal(r.result.pathLength, 3);
  });
  test('rejects negative weights', () => {
    const r = run('dijkstra', g([['A', 'B', -1]], { directed: true }), { start: 'A' });
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].code, 'NEGATIVE_WEIGHT');
  });
  test('zero-weight edges', () => {
    const r = run('dijkstra', g([['A', 'B', 0], ['B', 'C', 0], ['A', 'C', 1]]), { start: 'A', target: 'C' });
    assert.equal(r.result.pathCost, 0);
  });
  test('equal-weight paths: deterministic tie-break', () => {
    const d = g([['A', 'B', 1], ['A', 'C', 1], ['B', 'D', 1], ['C', 'D', 1]]);
    const r1 = run('dijkstra', d, { start: 'A', target: 'D' });
    assert.deepEqual(r1.result.path, ['A', 'B', 'D']);
    assert.deepEqual(r1.result.order, ['A', 'B', 'C', 'D']);
  });
  test('parallel edges use cheapest', () => {
    const d = g([['A', 'B', 5], ['A', 'B', 2]]);
    const r = run('dijkstra', d, { start: 'A', target: 'B' });
    assert.equal(r.result.pathCost, 2);
    assert.deepEqual(r.result.pathEdges, ['e2']);
  });
  test('directed vs undirected', () => {
    const d = g([['B', 'A', 1]], { directed: true });
    assert.equal(run('dijkstra', d, { start: 'A' }).result.distances.B, Infinity);
    assert.equal(run('dijkstra', { ...d, directed: false }, { start: 'A' }).result.distances.B, 1);
  });
});

suite('A*', () => {
  test('requires destination', () => {
    const r = run('astar', g([['A', 'B']]), { start: 'A' });
    assert.equal(r.errors[0].code, 'TARGET_REQUIRED');
  });
  test('rejects negative weights', () => {
    const r = run('astar', g([['A', 'B', -2]], { directed: true }), { start: 'A', target: 'B' });
    assert.equal(r.errors[0].code, 'NEGATIVE_WEIGHT');
  });
  test('optimal with calibrated heuristic on geometric graph', () => {
    const base = generateGraph({ family: 'geometric', nodes: 80, density: 0.06, weights: { distribution: 'euclidean' } }, 21);
    const a = run('astar', base.graph, { start: base.start, target: base.target });
    const d = run('dijkstra', base.graph, { start: base.start, target: base.target });
    assert.equal(a.result.pathCost, d.result.pathCost);
    assert.ok(a.result.counters.nodesVisited <= d.result.counters.nodesVisited);
    assert.equal(a.result.counters.reopened, 0);
  });
  test('unreachable destination → no-path', () => {
    const r = run('astar', g([['A', 'B'], ['C', 'D']]), { start: 'A', target: 'D' });
    assert.equal(r.result.status, 'no-path');
  });
  test('raw euclidean heuristic flagged as not guaranteed', () => {
    const r = run('astar', g([['A', 'B', 1]]), { start: 'A', target: 'B', heuristic: 'euclidean' });
    assert.equal(r.result.heuristic.optimalityGuaranteed, false);
  });
  test('unknown heuristic rejected', () => {
    const r = run('astar', g([['A', 'B', 1]]), { start: 'A', target: 'B', heuristic: 'magic' });
    assert.equal(r.errors[0].code, 'HEURISTIC_UNKNOWN');
  });
});

suite('Bellman-Ford', () => {
  test('negative weights on directed graph', () => {
    const d = g([['A', 'B', 4], ['A', 'C', 2], ['C', 'B', -3], ['B', 'D', 1]], { directed: true });
    const r = run('bellmanFord', d, { start: 'A', target: 'D' });
    assert.deepEqual(r.result.distances, { A: 0, B: -1, C: 2, D: 0 });
    assert.deepEqual(r.result.path, ['A', 'C', 'B', 'D']);
  });
  test('detects negative cycle and reports it', () => {
    const d = g([['A', 'B', 1], ['B', 'C', -2], ['C', 'B', 1], ['C', 'D', 1]], { directed: true });
    const r = run('bellmanFord', d, { start: 'A' });
    assert.equal(r.result.status, 'failed');
    assert.equal(r.result.error.code, 'NEGATIVE_CYCLE');
    assert.deepEqual([...r.result.cycle].sort(), ['B', 'C']);
  });
  test('negative self-loop is a negative cycle', () => {
    const r = run('bellmanFord', g([['A', 'A', -1]], { directed: true }), { start: 'A' });
    assert.equal(r.result.error.code, 'NEGATIVE_CYCLE');
  });
  test('unreachable negative cycle is ignored', () => {
    const d = g([['A', 'B', 1], ['C', 'D', -5], ['D', 'C', 1]], { directed: true });
    const r = run('bellmanFord', d, { start: 'A' });
    assert.equal(r.result.status, 'completed');
  });
  test('rejects undirected negative edge', () => {
    const r = run('bellmanFord', g([['A', 'B', -1]]), { start: 'A' });
    assert.equal(r.errors[0].code, 'UNDIRECTED_NEGATIVE');
  });
  test('early termination', () => {
    const d = g([['A', 'B', 1], ['B', 'C', 1], ['C', 'D', 1]], { directed: true });
    const r = run('bellmanFord', d, { start: 'A' });
    assert.ok(r.result.counters.passes <= 2, `passes=${r.result.counters.passes}`);
  });
});

suite('Floyd-Warshall', () => {
  test('all pairs and path', () => {
    const d = g([['A', 'B', 3], ['B', 'C', 4], ['A', 'C', 10]], { directed: true });
    const r = run('floydWarshall', d, { start: 'A', target: 'C' });
    assert.equal(r.result.pathCost, 7);
    assert.deepEqual(r.result.path, ['A', 'B', 'C']);
    const { ids, values } = r.result.matrix;
    const at = (i, j) => values[ids.indexOf(i) * ids.length + ids.indexOf(j)];
    assert.equal(at('B', 'A'), Infinity);
    assert.equal(at('A', 'C'), 7);
  });
  test('negative cycle detected', () => {
    const r = run('floydWarshall', g([['A', 'B', 1], ['B', 'A', -2]], { directed: true }), {});
    assert.equal(r.result.error.code, 'NEGATIVE_CYCLE');
  });
  test('negative weights (no cycle)', () => {
    const r = run('floydWarshall', g([['A', 'B', 2], ['B', 'C', -1]], { directed: true }), { start: 'A', target: 'C' });
    assert.equal(r.result.pathCost, 1);
  });
  test('trace limit enforced', () => {
    const base = generateGraph({ family: 'random', nodes: 70, density: 0.1 }, 1);
    const r = run('floydWarshall', base.graph, {}, { trace: true });
    assert.equal(r.errors[0].code, 'TOO_LARGE');
  });
  test('target without start rejected', () => {
    const r = run('floydWarshall', g([['A', 'B', 1]]), { target: 'B' });
    assert.equal(r.errors[0].code, 'START_REQUIRED');
  });
});

suite('Kruskal & Prim', () => {
  const d = g([['A', 'B', 1], ['B', 'C', 2], ['A', 'C', 3], ['C', 'D', 4], ['B', 'D', 5]]);
  for (const id of ['kruskal', 'prim']) {
    test(`${id}: minimum spanning tree weight`, () => {
      const r = run(id, d, {});
      assert.equal(r.result.totalWeight, 7);
      assert.equal(r.result.treeEdges.length, 3);
    });
    test(`${id}: requires undirected`, () => {
      const r = run(id, { ...d, directed: true }, {});
      assert.equal(r.errors[0].code, 'REQUIRES_UNDIRECTED');
    });
    test(`${id}: spanning forest for disconnected graph`, () => {
      const r = run(id, g([['A', 'B', 1], ['C', 'D', 2]], { nodes: ['A', 'B', 'C', 'D', 'E'] }), {});
      assert.equal(r.result.components, 3);
      assert.equal(r.result.treeEdges.length, 2);
      assert.equal(r.result.totalWeight, 3);
    });
    test(`${id}: negative and zero weights`, () => {
      const r = run(id, g([['A', 'B', -3], ['B', 'C', 0], ['A', 'C', -1]]), {});
      assert.equal(r.result.totalWeight, -4);
    });
    test(`${id}: self-loops skipped`, () => {
      const r = run(id, g([['A', 'A', -10], ['A', 'B', 2]]), {});
      assert.equal(r.result.totalWeight, 2);
    });
  }
  test('kruskal: equal weights deterministic by edge index', () => {
    const r = run('kruskal', g([['A', 'B', 1], ['B', 'C', 1], ['A', 'C', 1]]), {});
    assert.deepEqual(r.result.treeEdges, ['e1', 'e2']);
  });
});

suite("Kahn's topological sort", () => {
  test('valid order', () => {
    const d = g([['A', 'C'], ['B', 'C'], ['C', 'D']], { directed: true });
    const r = run('topologicalSort', d, {});
    assert.deepEqual(r.result.order, ['A', 'B', 'C', 'D']);
  });
  test('rejects cycle with explanation', () => {
    const d = g([['A', 'B'], ['B', 'C'], ['C', 'A'], ['C', 'D']], { directed: true });
    const r = run('topologicalSort', d, {});
    assert.equal(r.result.status, 'failed');
    assert.equal(r.result.error.code, 'CYCLE_DETECTED');
    assert.equal(r.result.cycle.length, 3);
  });
  test('self-loop is a cycle', () => {
    const r = run('topologicalSort', g([['A', 'A']], { directed: true }), {});
    assert.equal(r.result.status, 'failed');
  });
  test('requires directed graph', () => {
    const r = run('topologicalSort', g([['A', 'B']]), {});
    assert.equal(r.errors[0].code, 'REQUIRES_DIRECTED');
  });
  test('disconnected DAG', () => {
    const r = run('topologicalSort', g([['B', 'A'], ['D', 'C']], { directed: true }), {});
    assert.deepEqual(r.result.order, ['B', 'D', 'A', 'C']);
  });
});
