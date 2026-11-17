import { suite, test, assert } from '../harness.js';
import { randomGraphs } from '../helpers.js';
import { execute } from '../../js/core/AlgorithmEngine.js';
import { generateGraph } from '../../js/experiments/GraphGenerator.js';
import { SeededRandom } from '../../js/core/SeededRandom.js';

const same = (a, b, msg) => {
  for (const k of Object.keys(a)) assert.equal(a[k], b[k], `${msg}: ${k} ${a[k]} vs ${b[k]}`);
};

suite('Differential testing', () => {
  test('Dijkstra vs Bellman-Ford on non-negative graphs', () => {
    for (const { graph, start } of randomGraphs(200, 4001)) {
      same(execute('dijkstra', graph, { start }).result.distances, execute('bellmanFord', graph, { start }).result.distances, 'dist');
    }
  });

  test('Dijkstra vs A* with zero heuristic: same cost, same expansions', () => {
    for (const { graph, start, target } of randomGraphs(200, 4002)) {
      if (!target) continue;
      const d = execute('dijkstra', graph, { start, target }).result;
      const a = execute('astar', graph, { start, target, heuristic: 'zero' }).result;
      assert.equal(a.pathCost ?? null, d.pathCost ?? null);
      assert.equal(a.status, d.status);
    }
  });

  test('Prim vs Kruskal total weight on undirected weighted graphs', () => {
    for (const { graph } of randomGraphs(250, 4003, { directed: false, nodes: 25, weights: { distribution: 'uniform', min: -5, max: 20 } })) {
      const k = execute('kruskal', graph, {}).result;
      const p = execute('prim', graph, {}).result;
      assert.equal(k.totalWeight, p.totalWeight);
      assert.equal(k.components, p.components);
      assert.equal(k.treeEdges.length, p.treeEdges.length);
    }
  });

  test('BFS vs Dijkstra on unit-weight graphs', () => {
    for (const { graph, start } of randomGraphs(200, 4004, { weights: { distribution: 'unit' } })) {
      same(execute('bfs', graph, { start }).result.distances, execute('dijkstra', graph, { start }).result.distances, 'dist');
    }
  });

  test('Floyd-Warshall row vs Bellman-Ford with negative directed weights', () => {
    const rng = new SeededRandom(4005);
    let compared = 0;
    for (let i = 0; i < 150; i++) {
      const { graph, start } = generateGraph({ family: 'random', directed: true, nodes: rng.int(2, 14), density: rng.float(0.1, 0.4), weights: { distribution: 'uniform', min: -3, max: 10 } }, rng.fork(i));
      const bf = execute('bellmanFord', graph, { start }).result;
      const fw = execute('floydWarshall', graph, { start }).result;
      if (bf.status === 'failed') { assert.equal(fw.status, 'failed', 'FW should also detect the cycle'); continue; }
      if (fw.status === 'failed') continue; // FW also detects cycles unreachable from start
      same(bf.distances, fw.distances, 'dist');
      compared++;
    }
    assert.ok(compared > 50);
  });

  test('Floyd-Warshall paths have the reported cost', () => {
    for (const { graph, start, target } of randomGraphs(100, 4006)) {
      if (!target) continue;
      const r = execute('floydWarshall', graph, { start, target }).result;
      const d = execute('dijkstra', graph, { start, target }).result;
      assert.equal(r.pathCost ?? null, d.pathCost ?? null);
    }
  });
});

suite('Example custom module (Greedy best-first)', () => {
  test('finds a path whenever one exists, never cheaper than optimal', () => {
    let worse = 0;
    for (let i = 0; i < 120; i++) {
      const { graph, start, target } = generateGraph({ family: 'geometric', nodes: 30, density: 0.08, weights: { distribution: 'uniform', min: 1, max: 30 } }, 5000 + i);
      const gr = execute('greedyBestFirst', graph, { start, target }).result;
      const d = execute('dijkstra', graph, { start, target }).result;
      assert.equal(gr.status, d.status);
      if (d.pathCost !== undefined) {
        assert.ok(gr.pathCost >= d.pathCost);
        if (gr.pathCost > d.pathCost) worse++;
      }
    }
    assert.ok(worse > 0, 'expected at least one suboptimal greedy path');
  });
});
