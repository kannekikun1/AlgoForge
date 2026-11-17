# Benchmark methodology

AlgoForge reports **experimental browser measurements**. They are useful for comparing
algorithms on the same machine and input, not as hardware-independent truths.

## What is timed

Only `algorithm.run(compiledGraph, options, null)`:

- graph validation and compilation happen before timing;
- no event recorder is attached (no visualization work);
- no DOM access, rendering or animation is involved — benchmark and complexity runs execute in
  a Web Worker;
- result materialisation (id maps) happens after timing.

## Procedure (`BenchmarkRunner`)

1. **Calibration / adaptive batching.** Browsers coarsen `performance.now()` (typically 0.1 ms,
   sometimes 1 ms or more, unless the page is cross-origin isolated). The runner times a batch of
   *k* identical runs and doubles *k* until one batch takes at least `minBatchMs` (default 5 ms;
   2 ms in the Complexity Analyzer). The per-run time is batch time ÷ *k*.
2. **Warm-up.** `warmup` batches (default 3) are executed and discarded so JIT compilation and
   cache effects settle.
3. **Samples.** `runs` batches (default 15; configurable in Race) are timed.
4. **Summary.** Median (primary statistic), min/max, mean, sample standard deviation, quartiles,
   IQR and MAD.
5. **Determinism check.** Operation counters are captured from a run and compared with every
   measured run; any difference is flagged as a determinism violation.
6. **Environment metadata.** User agent, platform, logical cores, device memory (if exposed),
   cross-origin isolation and the measured timer resolution are recorded with every exported
   result.

## Race benchmark mode

Both algorithms are calibrated independently, warmed up, and then sampled **interleaved**
(A, B, B, A, A, B, …) so slow drift — thermal throttling, background tabs, garbage collection —
affects both sides equally. The comparison table marks the lower median as better and shows IQR
and min/max beside it.

## Complexity Analyzer

For each size *n* and repetition *r*, an independent graph is generated from
`SeededRandom(seed).fork("n:r")`, then benchmarked with warm-up and adaptive batching; the median
of the timed batches is stored per input. Single-source algorithms run without a destination (no
early exit) so measurements reflect the full search; A* receives the generator's destination.

A reference curve *c · f(V, E)* is fitted with one least-squares constant per metric, using the
implementation's theoretical expression (for example *(V + E) log₂ V* for Dijkstra). R² is shown
as a goodness-of-fit indicator. **A good fit is not a proof of asymptotic complexity**; constant
factors, caches and JIT tiers dominate at small sizes.

## Interpreting results

- Compare medians, and check that IQRs do not overlap before calling a difference real.
- Prefer operation counters for reasoning about algorithmic behaviour; they are exact and
  reproducible, whereas times vary between runs, browsers and devices.
- Never conclude universal superiority from one graph or one run.
