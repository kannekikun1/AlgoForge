/**
 * Benchmark runner.
 *
 * Methodology (docs/benchmarking.md):
 *   - Graph compilation and validation happen before timing; only `algorithm.run` is timed.
 *   - No event recorder is attached, so no visualization work is timed.
 *   - Adaptive batching: browsers coarsen performance.now() (often 0.1 ms or worse), so a
 *     batch of k identical runs is timed and divided by k, with k doubled until one batch
 *     takes at least `minBatchMs`.
 *   - Warm-up batches (JIT compilation, cache warm-up) are discarded.
 *   - Repeated samples are summarised by median and dispersion (IQR, MAD, stdev).
 *   - Operation counters are captured from a single run and verified to be identical on every
 *     run (they are deterministic); a mismatch is reported as a determinism violation.
 *   - Results are experimental browser measurements, not hardware-independent truths.
 */
import { prepare, rawMetrics, materialize, now } from '../core/AlgorithmEngine.js';
import { summarize } from '../utils/Statistics.js';

export const DEFAULT_BENCH = Object.freeze({ warmup: 3, runs: 15, minBatchMs: 5, maxBatch: 4096 });

function timeBatch(algo, G, opts, k) {
  const t0 = now();
  let raw;
  for (let i = 0; i < k; i++) raw = algo.run(G, opts, null);
  return { ms: now() - t0, raw };
}

function calibrate(algo, G, opts, cfg) {
  let k = 1;
  let { ms, raw } = timeBatch(algo, G, opts, k);
  while (ms < cfg.minBatchMs && k < cfg.maxBatch) {
    k = Math.min(cfg.maxBatch, k * 2);
    ({ ms, raw } = timeBatch(algo, G, opts, k));
  }
  return { batch: k, raw };
}

/**
 * Benchmark one algorithm on one graph.
 * @returns {{ok:boolean, errors?:Array, samples?:number[], stats?:object, batch?:number, metrics?:object, counters?:object, result?:object, deterministic?:boolean}}
 */
export function benchmark(algoId, graphData, options = {}, config = {}) {
  const cfg = { ...DEFAULT_BENCH, ...config };
  const prep = prepare(algoId, graphData, options);
  if (!prep.ok) return { ok: false, errors: prep.errors };
  return benchmarkPrepared(prep, cfg);
}

export function benchmarkPrepared(prep, config = {}) {
  const cfg = { ...DEFAULT_BENCH, ...config };
  const { algo, G, options: opts } = prep;
  const { batch, raw } = calibrate(algo, G, opts, cfg);
  const reference = JSON.stringify(raw.counters);
  let deterministic = true;
  for (let i = 0; i < cfg.warmup; i++) timeBatch(algo, G, opts, batch);
  const samples = [];
  for (let i = 0; i < cfg.runs; i++) {
    const { ms, raw: r } = timeBatch(algo, G, opts, batch);
    samples.push(ms / batch);
    if (JSON.stringify(r.counters) !== reference) deterministic = false;
  }
  return {
    ok: true,
    algorithm: algo.id,
    algorithmVersion: algo.version,
    samples,
    stats: summarize(samples),
    batch,
    warmup: cfg.warmup,
    runs: cfg.runs,
    counters: { ...raw.counters },
    metrics: rawMetrics(raw),
    result: materialize(raw, G, algo),
    deterministic,
  };
}

/**
 * Benchmark two algorithms on the same graph with interleaved samples (A, B, A, B, …) so that
 * slow drift (thermal throttling, background load) affects both equally.
 */
export function benchmarkPair(a, b, graphData, config = {}) {
  const cfg = { ...DEFAULT_BENCH, ...config };
  const pa = prepare(a.id, graphData, a.options ?? {});
  const pb = prepare(b.id, graphData, b.options ?? {});
  if (!pa.ok || !pb.ok) return { ok: false, errorsA: pa.errors ?? [], errorsB: pb.errors ?? [] };
  const ca = calibrate(pa.algo, pa.G, pa.options, cfg);
  const cb = calibrate(pb.algo, pb.G, pb.options, cfg);
  for (let i = 0; i < cfg.warmup; i++) {
    timeBatch(pa.algo, pa.G, pa.options, ca.batch);
    timeBatch(pb.algo, pb.G, pb.options, cb.batch);
  }
  const sa = [];
  const sb = [];
  for (let i = 0; i < cfg.runs; i++) {
    const first = i % 2 === 0;
    const run = (p, c, out) => out.push(timeBatch(p.algo, p.G, p.options, c.batch).ms / c.batch);
    if (first) { run(pa, ca, sa); run(pb, cb, sb); } else { run(pb, cb, sb); run(pa, ca, sa); }
  }
  const pack = (p, c, samples) => ({
    algorithm: p.algo.id,
    algorithmVersion: p.algo.version,
    samples,
    stats: summarize(samples),
    batch: c.batch,
    counters: { ...c.raw.counters },
    metrics: rawMetrics(c.raw),
    result: materialize(c.raw, p.G, p.algo),
  });
  return { ok: true, warmup: cfg.warmup, runs: cfg.runs, a: pack(pa, ca, sa), b: pack(pb, cb, sb), environment: environmentInfo() };
}

/** Estimate the effective resolution of performance.now() in ms. */
export function timerResolution() {
  let best = Infinity;
  for (let i = 0; i < 50; i++) {
    const t0 = now();
    let t1 = now();
    let guard = 0;
    while (t1 === t0 && guard++ < 1e6) t1 = now();
    if (t1 > t0) best = Math.min(best, t1 - t0);
  }
  return best;
}

export function environmentInfo() {
  const nav = globalThis.navigator ?? {};
  return {
    userAgent: nav.userAgent ?? (globalThis.process ? `Node ${globalThis.process.version}` : 'unknown'),
    platform: nav.userAgentData?.platform ?? nav.platform ?? (globalThis.process?.platform ?? 'unknown'),
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemoryGB: nav.deviceMemory ?? null,
    crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
    timerResolutionMs: timerResolution(),
    timestamp: new Date().toISOString(),
  };
}
