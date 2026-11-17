/**
 * Experimental complexity analyzer.
 *
 * For each input size n in [minN, maxN] (step `stepN`) and each repetition r, a graph is
 * generated from the stream `SeededRandom(seed).fork("n:r")`, so every (n, r) input is
 * independently reproducible. Each input is benchmarked with warm-up, adaptive batching and
 * `timingRuns` samples (median kept). Operation counters are exact and reproducible.
 *
 * Single-source algorithms are run without a destination (no early exit); A* receives the
 * generator's destination.
 *
 * Density modes:
 *   - 'fraction': density is the fraction of possible edges (E grows ~ n²).
 *   - 'degree':   density is the target average degree (E grows ~ n).
 *
 * A theoretical reference curve c · f(V, E) is fitted with a single least-squares scale
 * constant per metric. It is a visual reference only — measurements are not a proof of
 * asymptotic complexity.
 */
import { SeededRandom } from '../core/SeededRandom.js';
import { getAlgorithm, prepare, now } from '../core/AlgorithmEngine.js';
import { benchmarkPrepared } from './BenchmarkRunner.js';
import { generateGraph, normalizeParams } from './GraphGenerator.js';
import { summarize, fitScale, rSquared, median } from '../utils/Statistics.js';

export const DEFAULT_COMPLEXITY = Object.freeze({
  algorithm: 'dijkstra',
  options: {},
  family: 'random',
  minN: 50,
  maxN: 500,
  stepN: 50,
  density: 4,
  densityMode: 'degree',
  repetitions: 5,
  seed: 2024,
  weights: { distribution: 'uniform', min: 1, max: 100 },
  warmup: 2,
  timingRuns: 5,
  minBatchMs: 2,
});

export function validateComplexityConfig(cfg) {
  const errors = [];
  let algo;
  try { algo = getAlgorithm(cfg.algorithm); } catch (e) { return [e.message]; }
  const int = (v) => Number.isInteger(v);
  if (!int(cfg.minN) || cfg.minN < 1) errors.push('Minimum size must be a positive integer.');
  if (!int(cfg.maxN) || cfg.maxN < cfg.minN) errors.push('Maximum size must be ≥ minimum size.');
  if (!int(cfg.stepN) || cfg.stepN < 1) errors.push('Increment must be a positive integer.');
  if (!int(cfg.repetitions) || cfg.repetitions < 1 || cfg.repetitions > 100) errors.push('Repetitions must be between 1 and 100.');
  const limit = algo.limits?.benchmarkNodes ?? 5000;
  if (cfg.maxN > limit) errors.push(`${algo.shortName} is limited to ${limit} nodes.`);
  if (cfg.family === 'geometric' && cfg.maxN > 1500) errors.push('Geometric graphs are limited to 1500 nodes.');
  const sizes = sizesFor(cfg);
  if (sizes.length > 200) errors.push('Too many sizes (max 200). Increase the increment.');
  if (sizes.length * cfg.repetitions > 5000) errors.push('Too many runs (sizes × repetitions ≤ 5000).');
  if (algo.id === 'topologicalSort' && !['dag', 'tree'].includes(cfg.family)) errors.push("Kahn's algorithm needs acyclic inputs: use the DAG or tree family.");
  if (algo.needs.weights === 'non-negative' && cfg.weights?.distribution === 'uniform' && cfg.weights.min < 0) errors.push(`${algo.shortName} requires non-negative weights.`);
  if (cfg.densityMode === 'fraction' && (cfg.density < 0 || cfg.density > 1)) errors.push('Fractional density must be in [0, 1].');
  if (cfg.densityMode === 'degree' && cfg.density < 0) errors.push('Average degree must be ≥ 0.');
  return errors;
}

export function sizesFor(cfg) {
  const out = [];
  for (let n = cfg.minN; n <= cfg.maxN && out.length <= 1000; n += cfg.stepN) out.push(n);
  return out;
}

function generatorParams(cfg, n, algo) {
  const directed = algo.needs.direction === 'directed' || cfg.family === 'dag' ? true : algo.needs.direction === 'undirected' ? false : Boolean(cfg.directed);
  const pairs = directed ? n * (n - 1) : (n * (n - 1)) / 2;
  const density = cfg.densityMode === 'degree'
    ? (pairs > 0 ? Math.min(1, ((cfg.density * n) / (directed ? 1 : 2)) / pairs) : 0)
    : cfg.density;
  return normalizeParams({ family: cfg.family, nodes: n, density, directed, connected: true, weights: cfg.weights, endpoints: 'spread' });
}

export class ComplexityAnalyzer {
  constructor(config) {
    this.config = { ...DEFAULT_COMPLEXITY, ...config, weights: { ...DEFAULT_COMPLEXITY.weights, ...(config.weights ?? {}) } };
    this.errors = validateComplexityConfig(this.config);
    this.algo = this.errors.length ? null : getAlgorithm(this.config.algorithm);
    this.tasks = [];
    if (!this.errors.length) {
      for (const n of sizesFor(this.config)) for (let r = 0; r < this.config.repetitions; r++) this.tasks.push([n, r]);
    }
    this.cursor = 0;
    this.samples = [];
    this.failures = [];
    this.elapsedMs = 0;
    this.terminatedBy = this.errors.length ? 'invalid' : null;
    this.root = new SeededRandom(this.config.seed);
  }

  get done() { return this.terminatedBy !== null; }
  cancel() { if (!this.done) this.terminatedBy = 'cancelled'; }

  step(budgetMs = 50) {
    const t0 = now();
    while (!this.done && now() - t0 < budgetMs) {
      if (this.cursor >= this.tasks.length) { this.terminatedBy = 'completed'; break; }
      const [n, r] = this.tasks[this.cursor++];
      this.#measure(n, r);
    }
    this.elapsedMs += now() - t0;
    return this.done;
  }

  runAll() { while (!this.step(1000)); return this.result(); }

  #measure(n, rep) {
    const cfg = this.config;
    const params = generatorParams(cfg, n, this.algo);
    const gen = generateGraph(params, this.root.fork(`${n}:${rep}`));
    // Single-source algorithms run to completion (no early exit) so scaling reflects the full
    // search; a destination is only passed to algorithms that require one (A*).
    const target = this.algo.needs.target === 'required' ? gen.target : undefined;
    const prep = prepare(cfg.algorithm, gen.graph, { start: gen.start, target, ...cfg.options });
    if (!prep.ok) { this.failures.push({ n, rep, error: prep.errors[0]?.message }); return; }
    const b = benchmarkPrepared(prep, { warmup: cfg.warmup, runs: cfg.timingRuns, minBatchMs: cfg.minBatchMs });
    this.samples.push({
      n,
      edges: gen.graph.edges.length,
      rep,
      timeMs: b.stats.median,
      timeSamples: b.samples,
      batch: b.batch,
      status: b.metrics.status,
      ops: { ...b.counters },
    });
  }

  progress() {
    return { done: this.cursor, total: this.tasks.length, elapsedMs: this.elapsedMs, finished: this.done, terminatedBy: this.terminatedBy, last: this.samples[this.samples.length - 1] ?? null };
  }

  result() {
    return analyzeSamples(this.samples, this.algo, {
      config: this.config,
      failures: this.failures,
      elapsedMs: this.elapsedMs,
      terminatedBy: this.terminatedBy,
      errors: this.errors,
    });
  }
}

/** Group samples by n and compute summaries and reference-curve fits. */
export function analyzeSamples(samples, algo, extra = {}) {
  const byN = new Map();
  for (const s of samples) {
    if (!byN.has(s.n)) byN.set(s.n, []);
    byN.get(s.n).push(s);
  }
  const counterKeys = algo ? algo.counters.map((c) => c.key) : [];
  const summary = [...byN.entries()].sort((a, b) => a[0] - b[0]).map(([n, list]) => {
    const t = summarize(list.map((s) => s.timeMs));
    const ops = {};
    for (const k of counterKeys) ops[k] = median(list.map((s) => s.ops[k] ?? NaN));
    return {
      n,
      edges: median(list.map((s) => s.edges)),
      count: list.length,
      medianTimeMs: t.median,
      iqrMs: t.iqr,
      madMs: t.mad,
      minMs: t.min,
      maxMs: t.max,
      ops,
    };
  });
  const fits = {};
  if (algo?.complexity?.fn && summary.length) {
    const fx = summary.map((r) => algo.complexity.fn(r.n, r.edges));
    const metrics = { time: summary.map((r) => r.medianTimeMs) };
    for (const k of counterKeys) metrics[k] = summary.map((r) => r.ops[k]);
    for (const [k, ys] of Object.entries(metrics)) {
      const c = fitScale(fx, ys);
      fits[k] = { scale: c, r2: rSquared(ys, fx.map((f) => c * f)), expression: algo.complexity.time };
    }
  }
  return {
    algorithm: algo?.id ?? null,
    algorithmVersion: algo?.version ?? null,
    theoretical: algo?.complexity?.time ?? null,
    samples,
    summary,
    fits,
    disclaimer: 'Experimental browser measurements; a fitted reference curve is not a proof of asymptotic complexity.',
    ...extra,
  };
}

export function complexityToCSV(result) {
  const keys = result.samples.length ? Object.keys(result.samples[0].ops) : [];
  const header = ['n', 'edges', 'repetition', 'median_time_ms', 'batch', 'status', ...keys];
  const lines = [header.join(',')];
  for (const s of result.samples) {
    lines.push([s.n, s.edges, s.rep, s.timeMs.toPrecision(6), s.batch, s.status, ...keys.map((k) => s.ops[k] ?? '')].join(','));
  }
  return `${lines.join('\n')}\n`;
}
