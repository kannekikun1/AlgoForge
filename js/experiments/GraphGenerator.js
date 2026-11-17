/**
 * Seeded graph generators.
 *
 * Every generator draws exclusively from the supplied SeededRandom, so identical parameters
 * and seed produce identical graphs (node ids, coordinates, edges and weights) on every engine.
 *
 * Edge density is the fraction of possible edges: n(n−1)/2 for undirected graphs, n(n−1) for
 * directed graphs. Families interpret it as documented in docs/discovery-mode.md.
 */
import { SeededRandom } from '../core/SeededRandom.js';
import { indexToLabel } from '../core/Graph.js';

export const FAMILIES = Object.freeze({
  random: 'Random (Erdős–Rényi G(n, p))',
  geometric: 'Random geometric (nearest pairs)',
  grid: 'Grid lattice',
  dag: 'Random DAG',
  tree: 'Random tree',
  complete: 'Complete graph',
});

export const WEIGHT_DISTRIBUTIONS = Object.freeze({
  uniform: 'Uniform integers [min, max]',
  unit: 'Unit (all 1)',
  euclidean: 'Euclidean length (+ up to 50% noise)',
  normal: 'Normal (clamped to [min, max])',
});

export const ENDPOINT_POLICIES = Object.freeze({
  spread: 'Leftmost → rightmost node',
  'first-last': 'First → last node',
  random: 'Random pair (seeded)',
});

export const DEFAULT_PARAMS = Object.freeze({
  family: 'random',
  nodes: 20,
  density: 0.15,
  directed: false,
  connected: true,
  weights: { distribution: 'uniform', min: 1, max: 20 },
  width: 1000,
  height: 640,
  endpoints: 'spread',
});

const MAX_GEOMETRIC = 1500;

export function normalizeParams(p = {}) {
  const out = { ...DEFAULT_PARAMS, ...p, weights: { ...DEFAULT_PARAMS.weights, ...(p.weights ?? {}) } };
  out.nodes = Math.max(1, Math.min(5000, Math.floor(out.nodes)));
  out.density = Math.max(0, Math.min(1, Number(out.density) || 0));
  if (out.family === 'dag') out.directed = true;
  if (!(out.family in FAMILIES)) throw new Error(`Unknown graph family "${out.family}".`);
  if (!(out.weights.distribution in WEIGHT_DISTRIBUTIONS)) throw new Error(`Unknown weight distribution "${out.weights.distribution}".`);
  if (out.weights.min > out.weights.max) [out.weights.min, out.weights.max] = [out.weights.max, out.weights.min];
  return out;
}

export function nodeId(i, n) {
  return `node-${String(i + 1).padStart(Math.max(3, String(n).length), '0')}`;
}

/**
 * Generate a graph.
 * @param {object} params see DEFAULT_PARAMS
 * @param {SeededRandom|number|string} rngOrSeed
 * @returns {{graph:{directed:boolean,nodes:Array,edges:Array}, start:string|null, target:string|null, params:object}}
 */
export function generateGraph(params, rngOrSeed = 1) {
  const p = normalizeParams(params);
  const rng = rngOrSeed instanceof SeededRandom ? rngOrSeed : new SeededRandom(rngOrSeed);
  const n = p.nodes;
  const pos = layout(p, rng);
  const pairs = buildEdges(p, rng, pos);
  const nodes = pos.map(([x, y], i) => ({ id: nodeId(i, n), label: indexToLabel(i), x: round1(x), y: round1(y) }));
  const edges = pairs.map(([a, b], i) => ({
    id: `edge-${String(i + 1).padStart(Math.max(3, String(pairs.length).length), '0')}`,
    source: nodes[a].id,
    target: nodes[b].id,
    weight: weightFor(p, rng, pos[a], pos[b]),
    directed: p.directed,
  }));
  const graph = { directed: p.directed, nodes, edges };
  const [s, t] = endpoints(p, rng, nodes);
  return { graph, start: s, target: t, params: p };
}

function round1(v) { return Math.round(v * 10) / 10; }

function layout(p, rng) {
  const n = p.nodes;
  const m = 40;
  const W = p.width - 2 * m;
  const H = p.height - 2 * m;
  const pts = new Array(n);
  if (p.family === 'grid') {
    const cols = Math.ceil(Math.sqrt(n * (W / H)));
    const rows = Math.ceil(n / cols);
    const dx = cols > 1 ? W / (cols - 1) : 0;
    const dy = rows > 1 ? H / (rows - 1) : 0;
    for (let i = 0; i < n; i++) pts[i] = [m + (i % cols) * dx, m + Math.floor(i / cols) * dy];
    pts.cols = cols;
    return pts;
  }
  if (p.family === 'dag') {
    for (let i = 0; i < n; i++) pts[i] = [m + (n > 1 ? (i / (n - 1)) * W : W / 2), m + rng.next() * H];
    return pts;
  }
  for (let i = 0; i < n; i++) pts[i] = [m + rng.next() * W, m + rng.next() * H];
  return pts;
}

function buildEdges(p, rng, pos) {
  const n = p.nodes;
  const out = [];
  const seen = new Set();
  const key = (a, b) => (p.directed ? a * n + b : Math.min(a, b) * n + Math.max(a, b));
  const add = (a, b) => {
    if (a === b) return false;
    const k = key(a, b);
    if (seen.has(k)) return false;
    seen.add(k);
    out.push([a, b]);
    return true;
  };

  switch (p.family) {
    case 'tree': {
      for (let i = 1; i < n; i++) add(rng.int(0, i - 1), i);
      return out;
    }
    case 'complete': {
      for (let a = 0; a < n; a++) {
        for (let b = p.directed ? 0 : a + 1; b < n; b++) if (a !== b) add(a, b);
      }
      return out;
    }
    case 'grid': {
      const cols = pos.cols;
      const lattice = [];
      for (let i = 0; i < n; i++) {
        if ((i % cols) + 1 < cols && i + 1 < n) lattice.push([i, i + 1]);
        if (i + cols < n) lattice.push([i, i + cols]);
      }
      if (p.connected) {
        rng.shuffle(lattice);
        const parent = Array.from({ length: n }, (_, i) => i);
        const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
        const rest = [];
        for (const [a, b] of lattice) {
          const ra = find(a); const rb = find(b);
          if (ra !== rb) { parent[ra] = rb; add(a, b); } else rest.push([a, b]);
        }
        for (const [a, b] of rest) if (rng.next() < p.density) add(a, b);
        out.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));
      } else {
        for (const [a, b] of lattice) if (rng.next() < p.density) add(a, b);
      }
      return out;
    }
    case 'geometric': {
      if (n > MAX_GEOMETRIC) throw new Error(`Geometric graphs are limited to ${MAX_GEOMETRIC} nodes.`);
      const maxPairs = (n * (n - 1)) / 2;
      const targetPairs = Math.round(p.density * (p.directed ? n * (n - 1) : maxPairs) / (p.directed ? 2 : 1));
      const d2 = (a, b) => (pos[a][0] - pos[b][0]) ** 2 + (pos[a][1] - pos[b][1]) ** 2;
      const addPair = (a, b) => {
        if (p.directed) { add(a, b); add(b, a); } else add(a, b);
      };
      let count = 0;
      if (p.connected && n > 1) {
        // Euclidean MST (Prim, O(n²)) guarantees connectivity with short edges.
        const inT = new Uint8Array(n);
        const best = new Float64Array(n).fill(Infinity);
        const from = new Int32Array(n).fill(-1);
        best[0] = 0;
        for (let it = 0; it < n; it++) {
          let u = -1;
          for (let v = 0; v < n; v++) if (!inT[v] && (u < 0 || best[v] < best[u])) u = v;
          inT[u] = 1;
          if (from[u] >= 0) { addPair(from[u], u); count++; }
          for (let v = 0; v < n; v++) {
            if (!inT[v]) { const dv = d2(u, v); if (dv < best[v]) { best[v] = dv; from[v] = u; } }
          }
        }
      }
      if (count < targetPairs) {
        const cand = [];
        for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) cand.push([d2(a, b), a, b]);
        cand.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]));
        for (const [, a, b] of cand) {
          if (count >= targetPairs) break;
          if (seen.has(key(a, b))) continue;
          addPair(a, b);
          count++;
        }
      }
      return out;
    }
    case 'dag': {
      if (p.connected) for (let j = 1; j < n; j++) add(rng.int(0, j - 1), j);
      sampleBernoulliPairs(n, p.density, rng, (a, b) => add(a, b), false);
      return out;
    }
    case 'random':
    default: {
      if (p.connected && n > 1) {
        const perm = rng.shuffle(Array.from({ length: n }, (_, i) => i));
        for (let i = 1; i < n; i++) {
          const a = perm[rng.int(0, i - 1)];
          const b = perm[i];
          if (p.directed && rng.bool()) add(b, a); else add(a, b);
        }
      }
      sampleBernoulliPairs(n, p.density, rng, (a, b) => add(a, b), p.directed);
      return out;
    }
  }
}

/**
 * Visit each candidate pair independently with probability `prob` using geometric skipping
 * (Batagelj & Brandes, 2005): O(n + m) expected time instead of O(n²).
 * Undirected / DAG: pairs (a, b) with a < b in row-major order. Directed: ordered pairs a ≠ b.
 */
function sampleBernoulliPairs(n, prob, rng, visit, directed = false) {
  if (prob <= 0 || n < 2) return;
  const total = directed ? n * (n - 1) : (n * (n - 1)) / 2;
  const lq = prob < 1 ? Math.log(1 - prob) : 0;
  const rowLen = (row) => (directed ? n - 1 : n - 1 - row);
  let idx = -1;
  let a = 0;
  let rowStart = 0;
  for (;;) {
    idx += prob >= 1 ? 1 : 1 + Math.floor(Math.log(1 - rng.next()) / lq);
    if (idx >= total) return;
    while (idx >= rowStart + rowLen(a)) { rowStart += rowLen(a); a++; }
    const off = idx - rowStart;
    let b;
    if (directed) { b = off; if (b >= a) b++; } else b = a + 1 + off;
    visit(a, b);
  }
}

function weightFor(p, rng, a, b) {
  const { distribution, min, max } = p.weights;
  switch (distribution) {
    case 'unit': return 1;
    case 'euclidean': {
      const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
      return Math.max(1, Math.round((len / 10) * (1 + 0.5 * rng.next())));
    }
    case 'normal': {
      const mean = (min + max) / 2;
      const sd = Math.max(1e-9, (max - min) / 6);
      return Math.min(max, Math.max(min, Math.round(rng.normal(mean, sd))));
    }
    case 'uniform':
    default:
      return rng.int(min, max);
  }
}

function endpoints(p, rng, nodes) {
  if (!nodes.length) return [null, null];
  if (nodes.length === 1) return [nodes[0].id, nodes[0].id];
  if (p.endpoints === 'first-last' || p.family === 'dag' || p.family === 'tree') {
    return [nodes[0].id, nodes[nodes.length - 1].id];
  }
  if (p.endpoints === 'random') {
    const a = rng.int(0, nodes.length - 1);
    let b = rng.int(0, nodes.length - 2);
    if (b >= a) b++;
    return [nodes[a].id, nodes[b].id];
  }
  let lo = 0; let hi = 0;
  nodes.forEach((nd, i) => {
    if (nd.x < nodes[lo].x) lo = i;
    if (nd.x > nodes[hi].x) hi = i;
  });
  if (lo === hi) hi = lo === 0 ? 1 : 0;
  return [nodes[lo].id, nodes[hi].id];
}
