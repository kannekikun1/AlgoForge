/**
 * Algorithm registry and execution entry points.
 *
 * Algorithm module interface (see docs/contributing-algorithms.md):
 *   {
 *     id, name, shortName, version, category,
 *     problems: string[]            // compatibility tags for Race / Discovery
 *     needs: { start, target, weights, direction },
 *     options?: [{ key, label, type:'select', choices, default }],
 *     complexity: { time, space, fn(V, E) },
 *     description, prerequisites, implementationNotes,
 *     counters: [{ key, label, description }],
 *     pseudocode: string[],
 *     limits: { traceNodes, benchmarkNodes },
 *     validate(G, options, ctx) → [{ code, message }],
 *     run(G, options, recorder | null) → raw result (index-based),
 *     inspect(state, G) → inspector sections,
 *   }
 *
 * Execution never mutates the caller's graph data: `prepare` compiles a private copy.
 */
import { compileGraph } from './Graph.js';
import { validateGraphData } from './GraphValidator.js';
import { EventRecorder, DEFAULT_HISTORY_LIMIT } from './EventRecorder.js';
import bfs from '../algorithms/bfs.js';
import dfs from '../algorithms/dfs.js';
import dijkstra from '../algorithms/dijkstra.js';
import astar from '../algorithms/astar.js';
import bellmanFord from '../algorithms/bellmanFord.js';
import floydWarshall from '../algorithms/floydWarshall.js';
import kruskal from '../algorithms/kruskal.js';
import prim from '../algorithms/prim.js';
import topologicalSort from '../algorithms/topologicalSort.js';
import customModules from '../algorithms/custom/index.js';

const REGISTRY = new Map();

export function registerAlgorithm(module) {
  const required = ['id', 'name', 'version', 'problems', 'counters', 'pseudocode', 'validate', 'run', 'inspect'];
  for (const k of required) {
    if (module[k] === undefined) throw new Error(`Algorithm module is missing "${k}".`);
  }
  if (REGISTRY.has(module.id)) throw new Error(`Algorithm "${module.id}" is already registered.`);
  REGISTRY.set(module.id, Object.freeze(module));
}

/** The nine required v1 algorithms. */
export const CORE_ALGORITHMS = Object.freeze(['bfs', 'dfs', 'dijkstra', 'astar', 'bellmanFord', 'floydWarshall', 'kruskal', 'prim', 'topologicalSort']);

[bfs, dfs, dijkstra, astar, bellmanFord, floydWarshall, kruskal, prim, topologicalSort].forEach(registerAlgorithm);
for (const m of customModules) {
  try { registerAlgorithm(m); } catch (err) { console.error(`[AlgoForge] custom algorithm rejected: ${err.message}`); }
}

export function getAlgorithm(id) {
  const a = REGISTRY.get(id);
  if (!a) throw new Error(`Unknown algorithm "${id}".`);
  return a;
}

export function listAlgorithms() { return [...REGISTRY.values()]; }

/** Two algorithms are race/discovery-compatible when they share a problem tag. */
export function sharedProblems(a, b) {
  const A = getAlgorithm(a); const B = getAlgorithm(b);
  return A.problems.filter((p) => B.problems.includes(p));
}

export function compatiblePairs() {
  const algos = listAlgorithms();
  const out = [];
  for (let i = 0; i < algos.length; i++) {
    for (let j = i + 1; j < algos.length; j++) {
      if (sharedProblems(algos[i].id, algos[j].id).length) out.push([algos[i].id, algos[j].id]);
    }
  }
  return out;
}

/** Fill in option defaults declared by the module. */
export function resolveOptions(algo, options = {}) {
  const out = { ...options };
  for (const o of algo.options ?? []) if (out[o.key] === undefined) out[o.key] = o.default;
  if (algo.needs.start === false) delete out.start;
  if (!algo.needs.target) delete out.target;
  return out;
}

/**
 * Validate and compile.
 * @returns {{ok:true, G, options, algo} | {ok:false, errors:Array, algo}}
 */
export function prepare(algoId, graphData, options = {}, ctx = {}) {
  const algo = getAlgorithm(algoId);
  const structural = validateGraphData(graphData, { allowEmpty: true });
  if (!structural.ok) return { ok: false, errors: structural.errors, algo };
  const G = compileGraph(graphData);
  const opts = resolveOptions(algo, options);
  const errors = algo.validate(G, opts, ctx);
  if (errors.length) return { ok: false, errors, algo, G };
  return { ok: true, G, options: opts, algo };
}

/**
 * Run an algorithm.
 * @param {string} algoId
 * @param {object} graphData plain graph data
 * @param {object} options start / target / algorithm options
 * @param {{trace?:boolean, historyLimit?:number}} [config]
 * @returns {{ok:boolean, errors?:Array, result?:object, raw?:object, events?:Array, truncated?:boolean, G?:object, algo:object}}
 */
export function execute(algoId, graphData, options = {}, config = {}) {
  const prep = prepare(algoId, graphData, options, { trace: Boolean(config.trace) });
  if (!prep.ok) {
    const events = config.trace ? [failureEvent(prep.errors)] : [];
    return { ok: false, errors: prep.errors, algo: prep.algo, events, G: prep.G };
  }
  const { G, algo } = prep;
  const recorder = config.trace
    ? new EventRecorder({ limit: config.historyLimit ?? DEFAULT_HISTORY_LIMIT, stateStride: EventRecorder.strideFor(G.n) })
    : null;
  const t0 = now();
  const raw = algo.run(G, prep.options, recorder);
  const elapsed = now() - t0;
  const result = materialize(raw, G, algo);
  result.elapsedMs = elapsed;
  result.elapsedIncludesTracing = Boolean(recorder);
  return {
    ok: true, algo, G, raw, result, options: prep.options,
    events: recorder?.events ?? [], truncated: recorder?.truncated ?? false, totalEvents: recorder?.total ?? 0,
  };
}

function failureEvent(errors) {
  return {
    type: 'ALGORITHM_FAILED', step: 0, line: -1, counters: {},
    metadata: { error: { code: errors[0]?.code ?? 'INVALID', message: errors.map((e) => e.message).join(' ') } },
  };
}

export function now() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

/** Convert an index-based raw result to an id-based, JSON-friendly result. */
export function materialize(raw, G, algo) {
  const id = (i) => (i >= 0 ? G.ids[i] : null);
  const out = {
    algorithm: algo.id,
    algorithmVersion: algo.version,
    status: raw.status,
    error: raw.error ?? null,
    counters: { ...raw.counters },
    distanceKind: raw.distanceKind ?? null,
  };
  if (raw.dist) {
    out.distances = {};
    raw.dist.forEach((d, i) => { out.distances[G.ids[i]] = d; });
  }
  if (raw.pred) {
    out.predecessors = {};
    raw.pred.forEach((p, i) => { out.predecessors[G.ids[i]] = id(p); });
  }
  if (raw.order) out.order = raw.order.map(id);
  if (raw.postorder) out.postorder = raw.postorder.map(id);
  if (raw.path) {
    out.path = raw.path.path.map(id);
    out.pathEdges = raw.path.pathEdges.map((e) => G.edgeIds[e]);
    out.pathCost = raw.path.cost;
    out.pathLength = raw.path.pathEdges.length;
  } else {
    out.path = null;
  }
  if (raw.treeEdges) {
    out.treeEdges = raw.treeEdges.map((e) => G.edgeIds[e]);
    out.totalWeight = raw.totalWeight;
    out.components = raw.components;
  }
  if (raw.cycle) out.cycle = raw.cycle.map(id);
  if (raw.cycleEdges) out.cycleEdges = raw.cycleEdges.map((e) => G.edgeIds[e]);
  if (raw.heuristic) out.heuristic = { ...raw.heuristic };
  if (raw.matrix && G.n <= 60) {
    out.matrix = { ids: [...G.ids], values: Array.from(raw.matrix) };
  }
  return out;
}

/** Summary metrics used by Race / Discovery (null = not applicable). */
export function summaryMetrics(result) {
  const c = result.counters ?? {};
  const pq = c.pqPush !== undefined || c.pqPop !== undefined ? (c.pqPush ?? 0) + (c.pqPop ?? 0) : null;
  return {
    status: result.status,
    nodesVisited: c.nodesVisited ?? null,
    edgesExamined: c.edgesExamined ?? null,
    relaxAttempts: c.relaxAttempts ?? null,
    relaxSuccess: c.relaxSuccess ?? null,
    pqOps: pq,
    pathCost: result.pathCost ?? (result.totalWeight ?? null),
    pathLength: result.pathLength ?? (result.treeEdges ? result.treeEdges.length : null),
  };
}

/** Raw-result variant of summaryMetrics that avoids materialisation (used in hot loops). */
export function rawMetrics(raw) {
  const c = raw.counters ?? {};
  const pq = c.pqPush !== undefined || c.pqPop !== undefined ? (c.pqPush ?? 0) + (c.pqPop ?? 0) : null;
  return {
    status: raw.status,
    nodesVisited: c.nodesVisited ?? null,
    edgesExamined: c.edgesExamined ?? null,
    relaxAttempts: c.relaxAttempts ?? null,
    relaxSuccess: c.relaxSuccess ?? null,
    pqOps: pq,
    pathCost: raw.path ? raw.path.cost : (raw.totalWeight ?? null),
    pathLength: raw.path ? raw.path.pathEdges.length : (raw.treeEdges ? raw.treeEdges.length : null),
  };
}
