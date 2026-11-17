/**
 * Test helpers: small graph builders and trusted reference implementations.
 * Reference implementations are intentionally naive and independent of the production code.
 */
import { generateGraph } from '../js/experiments/GraphGenerator.js';
import { SeededRandom } from '../js/core/SeededRandom.js';

/**
 * Build graph data from a compact spec: edges like ['A','B',4].
 * Node ids equal labels; coordinates are on a circle.
 */
export function g(edges, { directed = false, nodes = null } = {}) {
  const ids = nodes ?? [...new Set(edges.flatMap(([a, b]) => [a, b]))];
  const N = ids.length;
  return {
    directed,
    nodes: ids.map((id, i) => ({ id, label: id, x: 300 + 200 * Math.cos((2 * Math.PI * i) / Math.max(1, N)), y: 300 + 200 * Math.sin((2 * Math.PI * i) / Math.max(1, N)) })),
    edges: edges.map(([s, t, w = 1], i) => ({ id: `e${i + 1}`, source: s, target: t, weight: w, directed })),
  };
}

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** Naive O(V^2 + VE) reference SSSP for non-negative weights (array scan Dijkstra). */
export function refDijkstra(data, start) {
  const ids = data.nodes.map((n) => n.id);
  const dist = Object.fromEntries(ids.map((i) => [i, Infinity]));
  const done = new Set();
  dist[start] = 0;
  const arcs = [];
  for (const e of data.edges) {
    arcs.push([e.source, e.target, e.weight]);
    if (!data.directed && e.source !== e.target) arcs.push([e.target, e.source, e.weight]);
  }
  for (;;) {
    let u = null;
    for (const id of ids) if (!done.has(id) && dist[id] < Infinity && (u === null || dist[id] < dist[u])) u = id;
    if (u === null) break;
    done.add(u);
    for (const [a, b, w] of arcs) if (a === u && dist[u] + w < dist[b]) dist[b] = dist[u] + w;
  }
  return dist;
}

/** Brute-force minimum spanning forest weight for tiny graphs (≤ ~14 edges). */
export function refMSFWeight(data) {
  const ids = data.nodes.map((n) => n.id);
  const comps = components(ids, data.edges);
  const need = ids.length - comps;
  const E = data.edges.filter((e) => e.source !== e.target);
  let best = Infinity;
  const choose = (start, picked, weight) => {
    if (picked.length === need) {
      if (components(ids, picked) === comps && weight < best) best = weight;
      return;
    }
    for (let i = start; i <= E.length - (need - picked.length); i++) {
      picked.push(E[i]);
      choose(i + 1, picked, weight + E[i].weight);
      picked.pop();
    }
  };
  choose(0, [], 0);
  return need === 0 ? 0 : best;
}

export function components(ids, edges) {
  const parent = new Map(ids.map((i) => [i, i]));
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  let c = ids.length;
  for (const e of edges) {
    const a = find(e.source); const b = find(e.target);
    if (a !== b) { parent.set(a, b); c--; }
  }
  return c;
}

export function reachable(data, start) {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const u = stack.pop();
    for (const e of data.edges) {
      const nbrs = [];
      if (e.source === u) nbrs.push(e.target);
      if (!data.directed && e.target === u) nbrs.push(e.source);
      for (const v of nbrs) if (!seen.has(v)) { seen.add(v); stack.push(v); }
    }
  }
  return seen;
}

/** Random small graphs for property tests. */
export function* randomGraphs(count, seed, overrides = {}) {
  const rng = new SeededRandom(seed);
  for (let i = 0; i < count; i++) {
    const params = {
      family: 'random',
      nodes: rng.int(1, 12),
      density: rng.float(0.05, 0.6),
      directed: rng.bool(),
      connected: rng.bool(0.6),
      weights: { distribution: 'uniform', min: 0, max: 9 },
      ...overrides,
    };
    yield generateGraph(params, rng.fork(i));
  }
}
