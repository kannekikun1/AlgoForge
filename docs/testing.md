# Testing

## Commands

```bash
npm test                  # node tests/run-node.mjs  — all *.test.js suites
npm test -- Dijkstra      # filter by test-name substring
npm run check             # node scripts/check.mjs   — static repository checks
```

Browser: start the dev server and open `http://localhost:8080/tests/` — the same suites run
through `tests/run-browser.js` (the check script fails if a suite is missing from it).

End-to-end (development only):

```bash
npm i --no-save playwright && npx playwright install chromium
node scripts/serve.mjs 8080 &
node tests/e2e/e2e.mjs              # add --screenshots to refresh assets/screenshots
```

## Harness

`tests/harness.js` is a ~90-line dependency-free harness (`suite`, `test`, `assert.*`) that runs
unchanged in Node and browsers. Everything outside `rendering/`, `ui/` and the DOM helpers is
importable in Node.

## Suites

| Suite | Contents |
| --- | --- |
| `core/` | Graph model and compiler, validator (duplicates, endpoints, weights, coordinates, limits, warnings), PRNG golden values and uniformity, natural-order total-order property, statistics, registry completeness |
| `structures/` | Queue, MinHeap (vs Array.sort), PriorityQueue ordering and stress, DisjointSet |
| `algorithms/algorithms.test.js` | For **every** registered algorithm: empty and single-node graphs, input immutability (deep-frozen input), counters identical with/without tracing, deterministic traces, pseudocode line ranges, large graphs. Per algorithm: disconnected, cyclic, directed vs undirected, equal-weight ties, zero weights, negative weights where supported, negative cycles, invalid inputs, self-loops, parallel edges. |
| `algorithms/property.test.js` | Randomised invariants on hundreds of seeded graphs: BFS reachability and hop-optimality; DFS visits exactly the reachable set; Dijkstra vs a naive reference; predecessor trees consistent with distances; MST acyclic, spanning each component and minimum (brute force); topological order respects every edge; Kahn rejects exactly the cyclic graphs; calibrated A* optimal. |
| `algorithms/differential.test.js` | Dijkstra vs Bellman-Ford; Dijkstra vs A* (zero heuristic); Prim vs Kruskal; BFS vs Dijkstra on unit weights; Floyd-Warshall vs Bellman-Ford with negative weights; Floyd-Warshall path costs; greedy best-first never beats the optimum. |
| `experiments/` | Generator validity/connectivity/determinism per family, density, weight bounds; benchmark runner; discovery (positive differences, reproducibility, edge-case search, stagnation, cancellation, config validation); complexity (sizes, reproducible counts, CSV, validation); race helpers; serializer round trips. |
| `storage/` | Import validation against malformed and hostile files (invalid JSON, wrong schema, foreign application, missing fields, wrong types, oversize, prototype keys, HTML in labels), round trips, storage manager with a memory adapter. |
| `integration/` | Backward stepping equals fresh replay at every index; play/pause/stop/restart; speed; deterministic replay; strided inspector state; history truncation; undo/redo; edit → export → import → race pipeline. |
| `e2e/` (Playwright) | Editing with mouse and keyboard, undo/redo, structure panel, every algorithm in the debugger, reproducible generation, race (synchronized + worker benchmark), discovery (worker, responsiveness, reproducibility, cancellation, save/open), complexity (chart, detail, CSV), saving/listing/export/import, malformed import, theme persistence, help, mobile layout, 500-node render performance. |

## Writing tests for a new algorithm

The common-contract tests run automatically for every registered module. Add at least:
hand-checked small cases, the edge cases above that apply, one property-based invariant, and a
differential test against an existing algorithm that must agree (see
[contributing-algorithms.md](contributing-algorithms.md)).

## Browser matrix

CI runs Chromium end-to-end. Before a release, run the browser unit-test page and a manual smoke
test (edit, run, step back, race, discovery, complexity, import/export) in current Chrome,
Firefox, Edge and Safari.
