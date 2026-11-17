import { suite, test, assert } from '../harness.js';
import { randomGraphs, refDijkstra, refMSFWeight, reachable } from '../helpers.js';
import { execute } from '../../js/core/AlgorithmEngine.js';
import { generateGraph } from '../../js/experiments/GraphGenerator.js';

const undirected = (data) => ({ ...data, directed: false, edges: data.edges.map((e) => ({ ...e, directed: false })) });

suite('Property-based invariants', () => {
  test('BFS: every discovered node is reachable; hop distances are minimal', () => {
    for (const { graph, start } of randomGraphs(150, 1001)) {
      const r = execute('bfs', graph, { start });
      const reach = reachable(graph, start);
      for (const [id, d] of Object.entries(r.result.distances)) {
        assert.equal(d !== Infinity, reach.has(id), `node ${id} reachability mismatch`);
      }
      // Hop-distance optimality: unit-weight reference.
      const unit = { ...graph, edges: graph.edges.map((e) => ({ ...e, weight: 1 })) };
      const ref = refDijkstra(unit, start);
      for (const id of Object.keys(ref)) assert.equal(r.result.distances[id], ref[id]);
    }
  });

  test('DFS: visits exactly the reachable set; parent edges exist', () => {
    for (const { graph, start } of randomGraphs(150, 1002)) {
      const r = execute('dfs', graph, { start });
      const reach = reachable(graph, start);
      assert.equal(r.result.order.length, reach.size);
      for (const [v, p] of Object.entries(r.result.predecessors)) {
        if (p === null) continue;
        const ok = graph.edges.some((e) => (e.source === p && e.target === v) || (!graph.directed && e.source === v && e.target === p));
        assert.ok(ok, `no edge ${p}→${v}`);
      }
    }
  });

  test('Dijkstra agrees with naive reference on non-negative graphs', () => {
    for (const { graph, start } of randomGraphs(200, 1003)) {
      const r = execute('dijkstra', graph, { start });
      const ref = refDijkstra(graph, start);
      for (const id of Object.keys(ref)) assert.equal(r.result.distances[id], ref[id], `dist ${id}`);
    }
  });

  test('Shortest-path predecessor trees are consistent with distances', () => {
    for (const { graph, start } of randomGraphs(100, 1004)) {
      for (const id of ['dijkstra', 'bellmanFord']) {
        const r = execute(id, graph, { start });
        const D = r.result.distances;
        for (const [v, p] of Object.entries(r.result.predecessors)) {
          if (p === null) continue;
          const best = Math.min(...graph.edges
            .filter((e) => (e.source === p && e.target === v) || (!graph.directed && e.source === v && e.target === p))
            .map((e) => e.weight));
          assert.equal(D[p] + best, D[v], `${id}: d[${p}] + w ≠ d[${v}]`);
        }
      }
    }
  });

  test('MST: acyclic, spans each component, minimum weight (brute force)', () => {
    let checked = 0;
    for (const { graph } of randomGraphs(400, 1005, { directed: false, nodes: 7 })) {
      if (graph.edges.length > 13) continue;
      checked++;
      const ref = refMSFWeight(graph);
      for (const id of ['kruskal', 'prim']) {
        const r = execute(id, graph, {});
        assert.equal(r.result.totalWeight, ref, `${id} weight`);
        const comps = new Map(graph.nodes.map((n) => [n.id, n.id]));
        const find = (x) => { while (comps.get(x) !== x) x = comps.get(x); return x; };
        for (const eid of r.result.treeEdges) {
          const e = graph.edges.find((x) => x.id === eid);
          const a = find(e.source); const b = find(e.target);
          assert.notEqual(a, b, `${id}: cycle in forest`);
          comps.set(a, b);
        }
        const roots = new Set(graph.nodes.map((n) => find(n.id)));
        assert.equal(roots.size, r.result.components, `${id}: components`);
      }
    }
    assert.ok(checked > 50, `only ${checked} graphs checked`);
  });

  test('Topological sort: every edge (u, v) has u before v', () => {
    for (let i = 0; i < 150; i++) {
      const { graph } = generateGraph({ family: 'dag', nodes: 2 + (i % 20), density: 0.3 }, 2000 + i);
      const r = execute('topologicalSort', graph, {});
      assert.equal(r.result.status, 'completed');
      const pos = new Map(r.result.order.map((id, k) => [id, k]));
      assert.equal(pos.size, graph.nodes.length);
      for (const e of graph.edges) assert.ok(pos.get(e.source) < pos.get(e.target), `${e.source} !< ${e.target}`);
    }
  });

  test('Topological sort rejects every graph with a directed cycle', () => {
    for (const { graph } of randomGraphs(200, 1006, { directed: true })) {
      const r = execute('topologicalSort', graph, {});
      // Independent cycle check: DFS colouring over edge list.
      const adj = new Map(graph.nodes.map((n) => [n.id, []]));
      for (const e of graph.edges) adj.get(e.source).push(e.target);
      const color = new Map();
      let cyclic = false;
      const visit = (u) => {
        color.set(u, 1);
        for (const v of adj.get(u)) {
          if (color.get(v) === 1) cyclic = true;
          else if (!color.get(v)) visit(v);
        }
        color.set(u, 2);
      };
      for (const n of graph.nodes) if (!color.get(n.id)) visit(n.id);
      assert.equal(r.result.status === 'failed', cyclic);
    }
  });

  test('A* (calibrated) is optimal on random geometric graphs', () => {
    for (let i = 0; i < 60; i++) {
      const { graph, start, target } = generateGraph({ family: 'geometric', nodes: 10 + (i % 40), density: 0.08, weights: { distribution: i % 2 ? 'uniform' : 'euclidean', min: 1, max: 30 } }, 3000 + i);
      const a = execute('astar', graph, { start, target });
      const ref = refDijkstra(graph, start)[target];
      assert.equal(a.result.pathCost ?? Infinity, ref);
      assert.equal(a.result.counters.reopened, 0);
    }
  });

  test('Undirected MST helper sanity', () => {
    const { graph } = generateGraph({ family: 'random', nodes: 6, density: 0.5 }, 5);
    assert.ok(refMSFWeight(undirected(graph)) < Infinity);
  });
});
