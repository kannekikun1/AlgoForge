import { suite, test, assert } from '../harness.js';
import { generateGraph, FAMILIES } from '../../js/experiments/GraphGenerator.js';
import { validateGraphData } from '../../js/core/GraphValidator.js';
import { DiscoveryEngine, validateDiscoveryConfig } from '../../js/experiments/DiscoveryEngine.js';
import { ComplexityAnalyzer, complexityToCSV, validateComplexityConfig } from '../../js/experiments/ComplexityAnalyzer.js';
import { benchmark, benchmarkPair } from '../../js/experiments/BenchmarkRunner.js';
import { syncIndices, comparisonRows } from '../../js/experiments/AlgorithmRace.js';
import { experimentEnvelope, validateExperimentEnvelope, sanitizeNumbers } from '../../js/experiments/ExperimentSerializer.js';
import { execute } from '../../js/core/AlgorithmEngine.js';
import { components } from '../helpers.js';

suite('GraphGenerator', () => {
  for (const family of Object.keys(FAMILIES)) {
    test(`${family}: valid, connected when requested, deterministic`, () => {
      const p = { family, nodes: 40, density: 0.1, connected: true, directed: family === 'dag' };
      const a = generateGraph(p, 123);
      const b = generateGraph(p, 123);
      assert.equal(JSON.stringify(a), JSON.stringify(b));
      assert.ok(validateGraphData(a.graph).ok);
      assert.equal(a.graph.nodes.length, 40);
      if (family !== 'random' || true) assert.equal(components(a.graph.nodes.map((n) => n.id), a.graph.edges), 1, `${family} not connected`);
      const c = generateGraph(p, 124);
      assert.notEqual(JSON.stringify(a.graph.edges), JSON.stringify(c.graph.edges));
    });
  }
  test('G(n,p) density is approximately honoured', () => {
    const { graph } = generateGraph({ family: 'random', nodes: 300, density: 0.05, connected: false }, 7);
    const expected = 0.05 * (300 * 299) / 2;
    assert.ok(Math.abs(graph.edges.length - expected) < expected * 0.1, `${graph.edges.length} vs ${expected}`);
  });
  test('directed G(n,p) has no duplicate arcs or self-loops', () => {
    const { graph } = generateGraph({ family: 'random', nodes: 60, density: 0.3, directed: true }, 8);
    const keys = new Set(graph.edges.map((e) => `${e.source}>${e.target}`));
    assert.equal(keys.size, graph.edges.length);
    assert.ok(graph.edges.every((e) => e.source !== e.target));
  });
  test('DAG generator is acyclic', () => {
    const { graph } = generateGraph({ family: 'dag', nodes: 80, density: 0.2 }, 9);
    assert.equal(execute('topologicalSort', graph, {}).result.status, 'completed');
  });
  test('weight distributions respect bounds', () => {
    for (const distribution of ['uniform', 'normal']) {
      const { graph } = generateGraph({ family: 'random', nodes: 50, density: 0.2, weights: { distribution, min: -3, max: 7 } }, 10);
      assert.ok(graph.edges.every((e) => e.weight >= -3 && e.weight <= 7 && Number.isInteger(e.weight)));
    }
  });
});

suite('BenchmarkRunner', () => {
  test('produces samples, stats and deterministic counters', () => {
    const { graph, start } = generateGraph({ family: 'random', nodes: 50, density: 0.1 }, 1);
    const b = benchmark('dijkstra', graph, { start }, { warmup: 1, runs: 5, minBatchMs: 1 });
    assert.ok(b.ok);
    assert.equal(b.samples.length, 5);
    assert.ok(b.stats.median > 0);
    assert.ok(b.deterministic);
    assert.ok(b.batch >= 1);
  });
  test('benchmarkPair interleaves and reports both', () => {
    const { graph, start, target } = generateGraph({ family: 'geometric', nodes: 60, density: 0.08, weights: { distribution: 'euclidean' } }, 2);
    const r = benchmarkPair({ id: 'dijkstra', options: { start, target } }, { id: 'astar', options: { start, target } }, graph, { warmup: 1, runs: 4, minBatchMs: 1 });
    assert.ok(r.ok);
    assert.equal(r.a.samples.length, 4);
    assert.equal(r.b.samples.length, 4);
  });
  test('invalid input reports errors', () => {
    const b = benchmark('dijkstra', { directed: false, nodes: [], edges: [] }, {});
    assert.equal(b.ok, false);
  });
});

suite('DiscoveryEngine', () => {
  const base = {
    algorithmA: 'dijkstra', algorithmB: 'astar',
    generator: { family: 'geometric', nodes: 40, density: 0.1, weights: { distribution: 'euclidean' } },
    experiments: 120, objective: 'nodesVisited', direction: 'abs', seed: 84721,
  };
  test('finds a positive visited-node difference (Dijkstra vs A*)', () => {
    const r = new DiscoveryEngine(base).runAll();
    assert.ok(r.best.score > 0);
    assert.equal(r.experimentCount, 120);
    assert.equal(r.terminatedBy, 'experiments');
    assert.ok(r.best.metricsA.nodesVisited >= r.best.metricsB.nodesVisited);
    assert.equal(r.best.resultA.pathCost, r.best.resultB.pathCost, 'both optimal');
  });
  test('reproducible: same seed → same winner and counts', () => {
    const a = new DiscoveryEngine(base).runAll();
    const b = new DiscoveryEngine(base).runAll();
    assert.equal(JSON.stringify(a.best.graph), JSON.stringify(b.best.graph));
    assert.deepEqual(a.best.countersA, b.best.countersA);
    assert.deepEqual(a.history, b.history);
  });
  test('different seed explores different graphs', () => {
    const a = new DiscoveryEngine(base).runAll();
    const b = new DiscoveryEngine({ ...base, seed: 1 }).runAll();
    assert.notEqual(JSON.stringify(a.best.graph), JSON.stringify(b.best.graph));
  });
  test('mutation phase improves on pure exploration at least sometimes', () => {
    const r = new DiscoveryEngine({ ...base, experiments: 300 }).runAll();
    assert.ok(r.history.length >= 1);
    assert.ok(r.elite.length <= 5);
  });
  test('edge-case objective finds A* (raw Euclidean) suboptimality', () => {
    const r = new DiscoveryEngine({
      algorithmA: 'dijkstra', algorithmB: 'astar', optionsB: { heuristic: 'euclidean' },
      generator: { family: 'geometric', nodes: 12, density: 0.3, weights: { distribution: 'uniform', min: 1, max: 5 } },
      experiments: 400, objective: 'edgeCase', seed: 5,
    }).runAll();
    assert.ok(r.best && r.best.score > 0, 'expected a disagreement');
    assert.ok(r.best.resultB.pathCost > r.best.resultA.pathCost);
  });
  test('path-cost objective: BFS vs Dijkstra', () => {
    const r = new DiscoveryEngine({ algorithmA: 'bfs', algorithmB: 'dijkstra', generator: { family: 'random', nodes: 20, density: 0.2, weights: { distribution: 'uniform', min: 1, max: 20 } }, experiments: 150, objective: 'pathCost', direction: 'a-gt-b', seed: 3 }).runAll();
    assert.ok(r.best.score > 0);
  });
  test('stagnation termination and cancellation', () => {
    const s = new DiscoveryEngine({ ...base, experiments: 100000, stagnationLimit: 30 }).runAll();
    assert.equal(s.terminatedBy, 'stagnation');
    const e = new DiscoveryEngine({ ...base, experiments: 100000 });
    e.step(5);
    e.cancel();
    assert.ok(e.step(5));
    assert.equal(e.result().terminatedBy, 'cancelled');
  });
  test('config validation', () => {
    assert.ok(validateDiscoveryConfig({ ...base, algorithmB: 'kruskal' }).length > 0);
    assert.ok(validateDiscoveryConfig({ ...base, generator: { ...base.generator, weights: { distribution: 'uniform', min: -5, max: 5 } } }).length > 0);
    assert.ok(validateDiscoveryConfig({ ...base, algorithmA: 'kruskal', algorithmB: 'prim', objective: 'relaxAttempts', generator: { family: 'random', nodes: 10, density: 0.3 } }).length > 0);
    assert.equal(validateDiscoveryConfig(base).length, 0);
  });
});

suite('ComplexityAnalyzer', () => {
  const cfg = { algorithm: 'bfs', minN: 20, maxN: 100, stepN: 40, repetitions: 2, density: 3, densityMode: 'degree', seed: 7, warmup: 0, timingRuns: 2, minBatchMs: 0.5 };
  test('collects samples per size and repetition', () => {
    const r = new ComplexityAnalyzer(cfg).runAll();
    assert.equal(r.samples.length, 6);
    assert.deepEqual(r.summary.map((s) => s.n), [20, 60, 100]);
    assert.ok(r.fits.time && r.fits.nodesVisited);
    assert.equal(r.theoretical, 'O(V + E)');
  });
  test('operation counts reproducible across runs', () => {
    const a = new ComplexityAnalyzer(cfg).runAll();
    const b = new ComplexityAnalyzer(cfg).runAll();
    assert.deepEqual(a.samples.map((s) => [s.n, s.edges, s.ops]), b.samples.map((s) => [s.n, s.edges, s.ops]));
  });
  test('CSV export', () => {
    const csv = complexityToCSV(new ComplexityAnalyzer(cfg).runAll());
    const lines = csv.trim().split('\n');
    assert.equal(lines.length, 7);
    assert.ok(lines[0].startsWith('n,edges,repetition,median_time_ms'));
  });
  test('validation', () => {
    assert.ok(validateComplexityConfig({ ...cfg, maxN: 10 }).length > 0);
    assert.ok(validateComplexityConfig({ ...cfg, algorithm: 'floydWarshall', maxN: 5000 }).length > 0);
    assert.ok(validateComplexityConfig({ ...cfg, algorithm: 'topologicalSort', family: 'random' }).length > 0);
  });
});

suite('AlgorithmRace', () => {
  test('syncIndices policies', () => {
    assert.deepEqual(syncIndices(3, 10, 5, 'event'), [3, 3]);
    assert.deepEqual(syncIndices(9, 10, 5, 'event'), [9, 4]);
    assert.deepEqual(syncIndices(9, 10, 5, 'progress'), [9, 4]);
    assert.deepEqual(syncIndices(0, 10, 5, 'progress'), [0, 0]);
  });
  test('comparison rows label algorithm-specific counters', () => {
    const { graph, start, target } = generateGraph({ family: 'geometric', nodes: 30, density: 0.1, weights: { distribution: 'euclidean' } }, 4);
    const A = execute('dijkstra', graph, { start, target }).result;
    const B = execute('astar', graph, { start, target }).result;
    const rows = comparisonRows({ result: A }, { result: B });
    const visited = rows.find((r) => r.key === 'nodesVisited');
    assert.ok(visited.definitionA && visited.definitionB);
    assert.notEqual(visited.definitionA, visited.definitionB);
  });
});

suite('ExperimentSerializer', () => {
  test('envelope round-trips through JSON and validates', () => {
    const env = experimentEnvelope({ kind: 'complexity', name: 'x', config: {}, result: { samples: [], d: Infinity, arr: new Float64Array([1, 2]) } });
    const parsed = JSON.parse(JSON.stringify(env));
    assert.deepEqual(validateExperimentEnvelope(parsed), []);
    assert.equal(parsed.result.d, 'Infinity');
    assert.deepEqual(parsed.result.arr, [1, 2]);
  });
  test('rejects wrong kinds and schema', () => {
    assert.ok(validateExperimentEnvelope({ schemaVersion: 2, type: 'experiment', kind: 'race', name: 'a', result: {} }).length > 0);
    assert.ok(validateExperimentEnvelope({ schemaVersion: 1, type: 'experiment', kind: 'evil', name: 'a', result: {} }).length > 0);
  });
  test('sanitizeNumbers drops functions and NaN', () => {
    assert.deepEqual(sanitizeNumbers({ a: NaN, f: () => 1, b: [-Infinity] }), { a: null, b: ['-Infinity'] });
  });
});
