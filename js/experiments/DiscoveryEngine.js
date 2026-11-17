/**
 * Algorithm Discovery Mode engine.
 *
 * Searches for input graphs that maximise a chosen difference between two algorithms.
 *
 * Search strategy (v1):
 *   1. Exploration: the first ⌈explorationFraction · experiments⌉ candidates are fresh,
 *      uniformly random graphs from the selected generator.
 *   2. Exploitation: remaining candidates are mutations (1–3 operators) of a parent drawn
 *      uniformly from an elite pool holding the best `eliteSize` candidates seen so far.
 *   3. Best-candidate retention: the best-scoring candidate is always kept.
 *   4. Termination: experiment budget, optional wall-clock limit, optional stagnation limit
 *      (no improvement for N consecutive candidates), or cancellation.
 *
 * Determinism: all randomness comes from one SeededRandom seeded by `config.seed`. For every
 * objective except measured time, the same configuration reproduces the same sequence of
 * candidates, scores and winner. With the time objective, selection depends on noisy
 * measurements, so only the initial exploration graphs are reproducible.
 *
 * The engine is pure computation, executed in slices (`step(budgetMs)`) so a Web Worker can
 * stay responsive to cancellation and report progress at a bounded rate.
 *
 * The result is the best case *found* — never claimed to be globally optimal.
 */
import { SeededRandom } from '../core/SeededRandom.js';
import { prepare, rawMetrics, getAlgorithm, sharedProblems, now, materialize } from '../core/AlgorithmEngine.js';
import { generateGraph, normalizeParams } from './GraphGenerator.js';
import { median } from '../utils/Statistics.js';

export const OBJECTIVES = Object.freeze({
  nodesVisited: 'Maximise difference in visited nodes',
  edgesExamined: 'Maximise difference in edges examined',
  relaxAttempts: 'Maximise difference in relaxation attempts',
  time: 'Maximise difference in measured execution time',
  pathCost: 'Maximise difference in path cost',
  edgeCase: 'Find a disagreement (smallest edge case)',
});

export const DIRECTIONS = Object.freeze({
  abs: '|A − B|',
  'a-gt-b': 'A − B (A worse)',
  'b-gt-a': 'B − A (B worse)',
});

export const DEFAULT_DISCOVERY = Object.freeze({
  algorithmA: 'dijkstra',
  algorithmB: 'astar',
  optionsA: {},
  optionsB: {},
  generator: { family: 'geometric', nodes: 100, density: 0.15, directed: false, connected: true, weights: { distribution: 'euclidean', min: 1, max: 20 }, endpoints: 'spread' },
  experiments: 5000,
  objective: 'nodesVisited',
  direction: 'abs',
  seed: 84721,
  explorationFraction: 0.3,
  eliteSize: 5,
  stagnationLimit: 0,
  timeLimitMs: 0,
  timingRepeats: 3,
});

export function validateDiscoveryConfig(config) {
  const errors = [];
  let A; let B;
  try { A = getAlgorithm(config.algorithmA); } catch (e) { errors.push(e.message); }
  try { B = getAlgorithm(config.algorithmB); } catch (e) { errors.push(e.message); }
  if (!A || !B) return errors;
  if (config.algorithmA === config.algorithmB && JSON.stringify(config.optionsA ?? {}) === JSON.stringify(config.optionsB ?? {})) {
    errors.push('Choose two different algorithms (or different options).');
  }
  if (!sharedProblems(A.id, B.id).length) errors.push(`${A.shortName} and ${B.shortName} do not solve a common problem.`);
  if (!(config.objective in OBJECTIVES)) errors.push(`Unknown objective "${config.objective}".`);
  if (!(config.direction in DIRECTIONS)) errors.push(`Unknown direction "${config.direction}".`);
  const metricKey = config.objective;
  if (['nodesVisited', 'edgesExamined', 'relaxAttempts'].includes(metricKey)) {
    for (const X of [A, B]) {
      if (!X.counters.some((c) => c.key === metricKey)) errors.push(`${X.shortName} does not report "${metricKey}".`);
    }
  }
  if (metricKey === 'pathCost' && !(A.problems.includes('shortest-path') || A.problems.includes('mst'))) {
    errors.push('Path cost is only meaningful for shortest-path and MST algorithms.');
  }
  if (!Number.isInteger(config.experiments) || config.experiments < 1 || config.experiments > 1_000_000) errors.push('Experiments must be an integer between 1 and 1,000,000.');
  try {
    const g = normalizeParams(config.generator);
    for (const X of [A, B]) {
      if (X.needs.direction === 'directed' && !g.directed) errors.push(`${X.shortName} requires a directed graph.`);
      if (X.needs.direction === 'undirected' && g.directed) errors.push(`${X.shortName} requires an undirected graph.`);
      if (X.needs.weights === 'non-negative' && g.weights.distribution !== 'unit' && g.weights.distribution !== 'euclidean' && g.weights.min < 0) {
        errors.push(`${X.shortName} requires non-negative weights (set the minimum weight ≥ 0).`);
      }
      if (X.limits?.benchmarkNodes && g.nodes > X.limits.benchmarkNodes) errors.push(`${X.shortName} is limited to ${X.limits.benchmarkNodes} nodes.`);
    }
    if (g.family === 'geometric' && g.nodes > 1500) errors.push('Geometric graphs are limited to 1500 nodes.');
  } catch (e) { errors.push(e.message); }
  return errors;
}

export class DiscoveryEngine {
  constructor(config) {
    this.config = { ...DEFAULT_DISCOVERY, ...config, generator: { ...DEFAULT_DISCOVERY.generator, ...(config.generator ?? {}) } };
    this.errors = validateDiscoveryConfig(this.config);
    this.genParams = this.errors.length ? null : normalizeParams(this.config.generator);
    this.rng = new SeededRandom(this.config.seed);
    this.evaluated = 0;
    this.rejected = 0;
    this.elite = [];
    this.best = null;
    this.history = [];
    this.sinceImprovement = 0;
    this.elapsedMs = 0;
    this.terminatedBy = null;
    this.cancelled = false;
    this.edgeCounter = 0;
  }

  get done() { return this.terminatedBy !== null; }

  cancel() { if (!this.done) this.terminatedBy = 'cancelled'; }

  /** Run candidates until `budgetMs` of wall time has elapsed. */
  step(budgetMs = 50) {
    if (this.errors.length) { this.terminatedBy = 'invalid'; return true; }
    const t0 = now();
    while (!this.done && now() - t0 < budgetMs) this.#iterate();
    this.elapsedMs += now() - t0;
    if (!this.done && this.config.timeLimitMs > 0 && this.elapsedMs >= this.config.timeLimitMs) this.terminatedBy = 'time';
    return this.done;
  }

  /** Run to completion synchronously (tests / small searches). */
  runAll() {
    while (!this.step(1000));
    return this.result();
  }

  #iterate() {
    const cfg = this.config;
    if (this.evaluated + this.rejected >= cfg.experiments) { this.terminatedBy = 'experiments'; return; }
    if (cfg.stagnationLimit > 0 && this.sinceImprovement >= cfg.stagnationLimit) { this.terminatedBy = 'stagnation'; return; }
    const index = this.evaluated + this.rejected;
    const explore = index < Math.ceil(cfg.explorationFraction * cfg.experiments) || this.elite.length === 0;
    const cand = explore ? this.#randomCandidate(index) : this.#mutantCandidate(index);
    const ev = this.#evaluate(cand);
    if (!ev) { this.rejected++; this.sinceImprovement++; return; }
    this.evaluated++;
    this.#retain(ev);
  }

  #randomCandidate(index) {
    const r = generateGraph(this.genParams, this.rng.fork(`candidate:${index}`));
    return { graph: r.graph, start: r.start, target: r.target, origin: 'random', index, parent: null, mutations: [] };
  }

  #mutantCandidate(index) {
    const parent = this.rng.pick(this.elite);
    const graph = {
      directed: parent.graph.directed,
      nodes: parent.graph.nodes.map((n) => ({ ...n })),
      edges: parent.graph.edges.map((e) => ({ ...e })),
    };
    const cand = { graph, start: parent.start, target: parent.target, origin: 'mutation', index, parent: parent.index, mutations: [] };
    const count = this.rng.int(1, 3);
    for (let i = 0; i < count; i++) this.#mutate(cand);
    return cand;
  }

  #mutate(cand) {
    const { graph } = cand;
    const rng = this.rng;
    const p = this.genParams;
    const r = rng.next();
    const n = graph.nodes.length;
    const idx = new Map(graph.nodes.map((nd, i) => [nd.id, i]));
    const resample = (e) => {
      const a = graph.nodes[idx.get(e.source)]; const b = graph.nodes[idx.get(e.target)];
      const { distribution, min, max } = p.weights;
      if (distribution === 'unit') return 1;
      if (distribution === 'euclidean') return Math.max(1, Math.round((Math.hypot(a.x - b.x, a.y - b.y) / 10) * (1 + 0.5 * rng.next())));
      if (distribution === 'normal') return Math.min(max, Math.max(min, Math.round(rng.normal((min + max) / 2, Math.max(1e-9, (max - min) / 6)))));
      return rng.int(min, max);
    };
    if (r < 0.35 && graph.edges.length) {
      const e = rng.pick(graph.edges);
      e.weight = resample(e);
      cand.mutations.push('reweight');
    } else if (r < 0.55 && n > 1) {
      for (let tries = 0; tries < 10; tries++) {
        let a = rng.int(0, n - 1);
        let b = rng.int(0, n - 1);
        if (a === b) continue;
        if (p.family === 'dag' && a > b) [a, b] = [b, a];
        const sa = graph.nodes[a].id; const sb = graph.nodes[b].id;
        const exists = graph.edges.some((e) => (e.source === sa && e.target === sb) || (!graph.directed && e.source === sb && e.target === sa));
        if (exists) continue;
        const e = { id: `edge-m${++this.edgeCounter}`, source: sa, target: sb, weight: 1, directed: graph.directed };
        e.weight = resample(e);
        graph.edges.push(e);
        cand.mutations.push('add-edge');
        break;
      }
    } else if (r < 0.75 && graph.edges.length > 1) {
      const k = rng.int(0, graph.edges.length - 1);
      graph.edges.splice(k, 1);
      cand.mutations.push('remove-edge');
    } else if (r < 0.9 && n > 0 && p.family !== 'grid' && p.family !== 'dag') {
      const nd = rng.pick(graph.nodes);
      nd.x = Math.round(Math.min(p.width - 20, Math.max(20, nd.x + rng.float(-40, 40))) * 10) / 10;
      nd.y = Math.round(Math.min(p.height - 20, Math.max(20, nd.y + rng.float(-40, 40))) * 10) / 10;
      if (p.weights.distribution === 'euclidean') {
        for (const e of graph.edges) if (e.source === nd.id || e.target === nd.id) e.weight = resample(e);
      }
      cand.mutations.push('move-node');
    } else if (n > 1) {
      let t = rng.int(0, n - 1);
      if (graph.nodes[t].id === cand.start) t = (t + 1) % n;
      cand.target = graph.nodes[t].id;
      cand.mutations.push('retarget');
    }
  }

  #metricValue(raw, key, timeMs) {
    if (key === 'time') return timeMs;
    const m = rawMetrics(raw);
    if (key === 'pathCost') return m.pathCost;
    return m[key];
  }

  #evaluate(cand) {
    const cfg = this.config;
    const optsBase = { start: cand.start, target: cand.target };
    const pa = prepare(cfg.algorithmA, cand.graph, { ...optsBase, ...cfg.optionsA });
    const pb = prepare(cfg.algorithmB, cand.graph, { ...optsBase, ...cfg.optionsB });
    if (!pa.ok || !pb.ok) return null;
    const timed = (p) => {
      const reps = cfg.objective === 'time' ? Math.max(1, cfg.timingRepeats) : 1;
      const times = [];
      let raw;
      for (let i = 0; i < reps; i++) {
        const t0 = now();
        raw = p.algo.run(p.G, p.options, null);
        times.push(now() - t0);
      }
      return { raw, timeMs: median(times) };
    };
    const ra = timed(pa);
    const rb = timed(pb);
    let score;
    let valueA = null;
    let valueB = null;
    if (cfg.objective === 'edgeCase') {
      const dis = disagreement(pa, ra.raw, pb, rb.raw);
      score = dis ? 1000 - Math.min(999, cand.graph.edges.length + cand.graph.nodes.length) : 0;
      valueA = dis ? 1 : 0; valueB = 0;
      cand.disagreement = dis;
    } else {
      valueA = this.#metricValue(ra.raw, cfg.objective, ra.timeMs);
      valueB = this.#metricValue(rb.raw, cfg.objective, rb.timeMs);
      if (valueA === null || valueB === null || !Number.isFinite(valueA) || !Number.isFinite(valueB)) return null;
      const diff = valueA - valueB;
      score = cfg.direction === 'abs' ? Math.abs(diff) : cfg.direction === 'a-gt-b' ? diff : -diff;
    }
    return {
      ...cand,
      score,
      valueA,
      valueB,
      // Single-shot timings are below timer resolution; only report them for the time objective.
      metricsA: { ...rawMetrics(ra.raw), timeMs: cfg.objective === 'time' ? ra.timeMs : null },
      metricsB: { ...rawMetrics(rb.raw), timeMs: cfg.objective === 'time' ? rb.timeMs : null },
      countersA: { ...ra.raw.counters },
      countersB: { ...rb.raw.counters },
    };
  }

  #retain(ev) {
    const cfg = this.config;
    const improved = !this.best || ev.score > this.best.score;
    if (improved) {
      this.best = ev;
      this.sinceImprovement = 0;
      this.history.push({ index: ev.index, score: ev.score, origin: ev.origin });
    } else {
      this.sinceImprovement++;
    }
    // Elite pool: keep the top `eliteSize` by score (ties: earlier index first).
    this.elite.push(ev);
    this.elite.sort((a, b) => (b.score - a.score) || (a.index - b.index));
    if (this.elite.length > cfg.eliteSize) this.elite.length = cfg.eliteSize;
  }

  progress() {
    return {
      evaluated: this.evaluated,
      rejected: this.rejected,
      total: this.config.experiments,
      bestScore: this.best?.score ?? null,
      bestIndex: this.best?.index ?? null,
      elapsedMs: this.elapsedMs,
      history: this.history.slice(-500),
      done: this.done,
      terminatedBy: this.terminatedBy,
    };
  }

  result() {
    const cfg = this.config;
    const best = this.best;
    let resultA = null;
    let resultB = null;
    if (best) {
      const pa = prepare(cfg.algorithmA, best.graph, { start: best.start, target: best.target, ...cfg.optionsA });
      const pb = prepare(cfg.algorithmB, best.graph, { start: best.start, target: best.target, ...cfg.optionsB });
      if (pa.ok) resultA = materialize(pa.algo.run(pa.G, pa.options, null), pa.G, pa.algo);
      if (pb.ok) resultB = materialize(pb.algo.run(pb.G, pb.options, null), pb.G, pb.algo);
    }
    return {
      config: cfg,
      generator: this.genParams,
      seed: cfg.seed,
      algorithms: {
        A: { id: cfg.algorithmA, version: safeVersion(cfg.algorithmA), options: cfg.optionsA },
        B: { id: cfg.algorithmB, version: safeVersion(cfg.algorithmB), options: cfg.optionsB },
      },
      objective: cfg.objective,
      direction: cfg.direction,
      evaluated: this.evaluated,
      rejected: this.rejected,
      experimentCount: this.evaluated + this.rejected,
      searchDurationMs: this.elapsedMs,
      terminatedBy: this.terminatedBy,
      history: this.history,
      errors: this.errors,
      best: best ? {
        index: best.index,
        origin: best.origin,
        parent: best.parent,
        mutations: best.mutations,
        score: best.score,
        valueA: best.valueA,
        valueB: best.valueB,
        difference: best.valueA !== null && best.valueB !== null ? best.valueA - best.valueB : null,
        disagreement: best.disagreement ?? null,
        metricsA: best.metricsA,
        metricsB: best.metricsB,
        countersA: best.countersA,
        countersB: best.countersB,
        graph: best.graph,
        start: best.start,
        target: best.target,
        resultA,
        resultB,
      } : null,
      elite: this.elite.map((e) => ({ index: e.index, score: e.score, origin: e.origin, nodes: e.graph.nodes.length, edges: e.graph.edges.length })),
      claim: 'Best case found by a randomised search; not proven to be globally optimal.',
    };
  }
}

function safeVersion(id) { try { return getAlgorithm(id).version; } catch { return null; } }

/** Describe how two algorithms' answers disagree on the same input, or return null. */
export function disagreement(pa, ra, pb, rb) {
  const problems = sharedProblems(pa.algo.id, pb.algo.id);
  const ma = rawMetrics(ra); const mb = rawMetrics(rb);
  if (ra.status !== rb.status) return `Status differs: ${ra.status} vs ${rb.status}`;
  if (problems.includes('shortest-path')) {
    // BFS is a fewest-hops algorithm; only cost agreement is checked when both claim optimality.
    if (ma.pathCost !== mb.pathCost) return `Path cost differs: ${ma.pathCost} vs ${mb.pathCost}`;
  }
  if (problems.includes('mst') && ma.pathCost !== mb.pathCost) return `Forest weight differs: ${ma.pathCost} vs ${mb.pathCost}`;
  if (problems.includes('traversal') && ra.order && rb.order && ra.order.length !== rb.order.length) {
    return `Reached ${ra.order.length} vs ${rb.order.length} nodes`;
  }
  return null;
}
