# Discovery Mode

Discovery Mode automatically generates input graphs and searches for those that expose the
largest difference between two compatible algorithms.

## Configuration

| Setting | Meaning |
| --- | --- |
| Algorithm A / B | Must share a problem tag. A* may be paired with itself using different heuristics. |
| Graph family | `random` G(n, p), `geometric` (nearest pairs), `grid`, `dag`, `tree`, `complete` |
| Nodes, edge density | Density is the fraction of possible edges: n(n−1)/2 undirected, n(n−1) directed. Geometric graphs connect the nearest pairs until that many are chosen; grids keep each lattice edge with that probability; trees ignore density. |
| Weight distribution | `uniform` integers in [min, max], `unit`, `euclidean` (length / 10 × (1 + up to 50 % noise), never below 1), `normal` (clamped to [min, max]) |
| Start / destination | `spread` (leftmost → rightmost node), `first-last`, `random` (seeded). DAGs and trees use first → last. |
| Connected | Builds a random spanning tree first (Euclidean MST for geometric graphs). |
| Experiments | Total candidate budget. |
| Objective | visited nodes, edges examined, relaxation attempts, measured time, path cost, or *find a disagreement* |
| Difference | \|A − B\|, A − B, or B − A |
| Exploration fraction | Share of the budget spent on fresh random graphs (default 0.3). |
| Stagnation limit, time limit | Optional early termination. |
| Seed | Seeds the single PRNG stream for the whole search. |

## Search strategy (v1)

1. **Uniform random exploration.** Candidate *i* is generated from
   `SeededRandom(seed).fork("candidate:i")` with the selected generator.
2. **Candidate mutation.** After exploration, each candidate is produced by applying 1–3 random
   operators to a parent drawn uniformly from an **elite pool** (the best 5 so far):
   re-weight an edge, add an edge (respecting DAG order), remove an edge, move a node by up to 40
   units (Euclidean weights are recomputed for its incident edges), or pick a new destination.
3. **Evaluation.** Both algorithms are prepared on the candidate and run without tracing. The
   candidate counts as *rejected* if either algorithm's validator refuses it (for example
   negative weights for Dijkstra) or if the objective is undefined for it (for example no path
   exists, so there is no path cost to compare). Otherwise the objective is computed.
4. **Best-candidate retention.** The best-scoring candidate is always kept; ties keep the earlier
   one.
5. **Termination.** Budget exhausted, time limit, stagnation limit or user cancellation (the
   partial best is returned).

The *disagreement* objective scores a candidate 0 unless the algorithms' answers differ (status,
path cost, forest weight, or reached-set size); disagreeing candidates score
1000 − (V + E), so the search drifts toward **small** counterexamples. Typical uses: Dijkstra vs
A* with the raw Euclidean heuristic (inadmissible), or BFS vs Dijkstra on weighted graphs.

## Reproducibility

All randomness comes from the documented Mulberry32 generator (`js/core/SeededRandom.js`).
Given the same seed, parameters, algorithm versions and generator version, the search produces
the same sequence of candidates, scores, operation counts and winner — on any browser or in Node.
The test suite checks this.

Exception: with the **measured time** objective, selection depends on noisy timings, so only the
initial exploration graphs are reproducible. Timings themselves are never expected to repeat
exactly.

Exports include the full configuration, normalised generator parameters, seed, algorithm ids,
versions and options, every metric of the winning candidate, both full results, the improvement
history, the experiment count, the search duration and environment metadata — plus the winning
graph itself, so a result can be re-examined even if generators change in a later version.

## Claims

The interface reports *the most interesting case found*. It never claims global optimality: the
search space is astronomically large, and no exhaustive or exact method is used.

## Performance

The search runs in a Web Worker in ~40 ms slices, posting progress at most every 200 ms; the
main thread stays responsive and the search can be cancelled at any time.
