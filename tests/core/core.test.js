import { suite, test, assert } from '../harness.js';
import { Graph, compileGraph, indexToLabel, toExportEnvelope } from '../../js/core/Graph.js';
import { validateGraphData, findDirectedCycle } from '../../js/core/GraphValidator.js';
import { SeededRandom, fnv1a } from '../../js/core/SeededRandom.js';
import { naturalCompare } from '../../js/utils/Validation.js';
import { summarize, quantile, fitScale } from '../../js/utils/Statistics.js';
import { g } from '../helpers.js';

suite('Graph model', () => {
  test('add/remove nodes and edges with generated ids', () => {
    const G = new Graph();
    const a = G.addNode({ x: 0, y: 0 });
    const b = G.addNode({ x: 10, y: 0 });
    assert.equal(a.id, 'node-001');
    assert.equal(b.label, 'B');
    const e = G.addEdge({ source: a.id, target: b.id, weight: 3 });
    assert.equal(e.id, 'edge-001');
    assert.equal(G.findEdge(b.id, a.id)?.id, 'edge-001');
    const removed = G.removeNode(a.id);
    assert.equal(removed.length, 1);
    assert.equal(G.edgeCount, 0);
  });
  test('rejects duplicates and missing endpoints', () => {
    const G = new Graph();
    G.addNode({ id: 'A', x: 0, y: 0 });
    assert.throws(() => G.addNode({ id: 'A', x: 0, y: 0 }), /Duplicate/);
    assert.throws(() => G.addEdge({ source: 'A', target: 'Z' }), /Unknown target/);
  });
  test('setDirected normalises edge flags', () => {
    const G = new Graph(g([['A', 'B']]));
    G.setDirected(true);
    assert.ok(G.edges.every((e) => e.directed));
  });
  test('labels: A..Z, AA..', () => {
    assert.equal(indexToLabel(0), 'A');
    assert.equal(indexToLabel(25), 'Z');
    assert.equal(indexToLabel(26), 'AA');
    assert.equal(indexToLabel(701), 'ZZ');
    assert.equal(indexToLabel(702), 'AAA');
  });
  test('compile: canonical order and CSR adjacency', () => {
    const data = { directed: false, nodes: [{ id: 'node-10', x: 0, y: 0 }, { id: 'node-2', x: 0, y: 0 }, { id: 'node-1', x: 0, y: 0 }], edges: [{ id: 'e2', source: 'node-1', target: 'node-10', weight: 1 }, { id: 'e1', source: 'node-1', target: 'node-2', weight: 2 }] };
    const G = compileGraph(data);
    assert.deepEqual(G.ids, ['node-1', 'node-2', 'node-10']);
    assert.deepEqual(G.edgeIds, ['e1', 'e2']);
    assert.deepEqual(Array.from(G.adjTo.slice(G.adjStart[0], G.adjStart[1])), [1, 2]);
    assert.equal(G.arcCount, 4);
  });
  test('compile: undirected self-loop appears once', () => {
    const G = compileGraph(g([['A', 'A'], ['A', 'B']]));
    assert.equal(G.arcCount, 3);
  });
  test('export envelope', () => {
    const env = toExportEnvelope(g([['A', 'B', 4]], { directed: true }));
    assert.equal(env.schemaVersion, 1);
    assert.equal(env.application, 'AlgoForge');
    assert.equal(env.graph.edges[0].directed, true);
  });
});

suite('GraphValidator', () => {
  test('valid graph passes', () => assert.ok(validateGraphData(g([['A', 'B']])).ok));
  test('empty graph error', () => assert.equal(validateGraphData({ nodes: [], edges: [] }).errors[0].code, 'EMPTY_GRAPH'));
  test('duplicate ids', () => {
    const d = g([['A', 'B']]);
    d.nodes.push({ ...d.nodes[0] });
    assert.ok(validateGraphData(d).errors.some((e) => e.code === 'DUPLICATE_NODE_ID'));
  });
  test('missing endpoint', () => {
    const d = g([['A', 'B']]);
    d.edges.push({ id: 'x', source: 'A', target: 'Q', weight: 1 });
    assert.ok(validateGraphData(d).errors.some((e) => e.code === 'MISSING_ENDPOINT'));
  });
  test('invalid weight / coordinates', () => {
    const d = g([['A', 'B', NaN]]);
    d.nodes[0].x = Infinity;
    const codes = validateGraphData(d).errors.map((e) => e.code);
    assert.ok(codes.includes('WEIGHT_INVALID'));
    assert.ok(codes.includes('COORDINATE_INVALID'));
  });
  test('warnings: disconnected, self-loop, parallel', () => {
    const d = g([['A', 'B'], ['A', 'B'], ['C', 'C']]);
    const codes = validateGraphData(d).warnings.map((w) => w.code);
    assert.ok(codes.includes('DISCONNECTED'));
    assert.ok(codes.includes('SELF_LOOPS'));
    assert.ok(codes.includes('PARALLEL_EDGES'));
  });
  test('resource limits', () => {
    const d = { nodes: Array.from({ length: 6000 }, (_, i) => ({ id: `n${i}`, x: 0, y: 0 })), edges: [] };
    assert.equal(validateGraphData(d).errors[0].code, 'TOO_MANY_NODES');
  });
  test('findDirectedCycle', () => {
    assert.equal(findDirectedCycle(compileGraph(g([['A', 'B'], ['B', 'C']], { directed: true }))), null);
    const c = findDirectedCycle(compileGraph(g([['A', 'B'], ['B', 'C'], ['C', 'A']], { directed: true })));
    assert.equal(c.length, 3);
  });
});

suite('SeededRandom', () => {
  test('reproducible sequence (golden values)', () => {
    const r = new SeededRandom(84721);
    const seq = Array.from({ length: 5 }, () => r.int(0, 1_000_000));
    const r2 = new SeededRandom(84721);
    assert.deepEqual(Array.from({ length: 5 }, () => r2.int(0, 1_000_000)), seq);
    // Golden values guard against accidental algorithm changes (these must never change).
    const g0 = new SeededRandom(1);
    assert.equal(Math.floor(g0.next() * 1e9), 627073940); // Mulberry32(1) = 0.62707394…
  });
  test('string seeds hash deterministically', () => {
    assert.equal(new SeededRandom('abc').seed, fnv1a('abc'));
  });
  test('fork does not consume parent state', () => {
    const r = new SeededRandom(5);
    const s = r.getState();
    r.fork('x').next();
    assert.equal(r.getState(), s);
  });
  test('uniformity smoke test', () => {
    const r = new SeededRandom(9);
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 100000; i++) bins[Math.floor(r.next() * 10)]++;
    for (const b of bins) assert.ok(Math.abs(b - 10000) < 500, `bin ${b}`);
  });
});

suite('naturalCompare', () => {
  test('numeric-aware ordering', () => {
    const ids = ['node-10', 'node-2', 'node-001', 'B', 'AA', 'A', 'Z'];
    assert.deepEqual([...ids].sort(naturalCompare), ['A', 'B', 'Z', 'AA', 'node-001', 'node-2', 'node-10']);
  });
  test('total order (antisymmetric, transitive on random strings)', () => {
    const r = new SeededRandom(3);
    const alphabet = 'ab01-';
    const words = Array.from({ length: 60 }, () => Array.from({ length: r.int(1, 5) }, () => alphabet[r.int(0, 4)]).join(''));
    for (const a of words) for (const b of words) {
      assert.equal(Math.sign(naturalCompare(a, b)), -Math.sign(naturalCompare(b, a)));
      for (const c of words.slice(0, 15)) {
        if (naturalCompare(a, b) < 0 && naturalCompare(b, c) < 0) assert.ok(naturalCompare(a, c) < 0, `${a} ${b} ${c}`);
      }
    }
  });
});

suite('Statistics', () => {
  test('summary values', () => {
    const s = summarize([1, 2, 3, 4, 100]);
    assert.equal(s.median, 3);
    assert.equal(s.min, 1);
    assert.equal(s.q1, 2);
    assert.equal(s.mad, 1);
  });
  test('quantile interpolation', () => assert.close(quantile([0, 10], 0.25), 2.5));
  test('fitScale', () => assert.close(fitScale([1, 2, 3], [2, 4, 6]), 2));
});

suite('Algorithm registry', () => {
  test('all nine required algorithms are registered with complete modules', async () => {
    const { CORE_ALGORITHMS, getAlgorithm, compatiblePairs } = await import('../../js/core/AlgorithmEngine.js');
    assert.equal(CORE_ALGORITHMS.length, 9);
    for (const id of CORE_ALGORITHMS) {
      const a = getAlgorithm(id);
      assert.ok(a.pseudocode.length > 3 && a.counters.length >= 2 && a.complexity.time && a.description, id);
    }
    assert.ok(compatiblePairs().some(([x, y]) => x === 'dijkstra' && y === 'astar'));
  });
});
