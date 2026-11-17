# Adding an algorithm

Algorithms are ordinary ES modules bundled with the app. Start from the annotated template
[`js/algorithms/custom/greedyBestFirst.js`](../js/algorithms/custom/greedyBestFirst.js).

## 1. Create the module

Put it in `js/algorithms/custom/` (or `js/algorithms/` for core algorithms) and export a
descriptor:

```js
export default {
  id: 'myAlgo',                 // unique, stable — appears in exports
  name: 'My Algorithm',
  shortName: 'MyAlgo',
  version: '1.0.0',             // bump when behaviour or counters change
  category: 'Shortest Path',    // groups the algorithm selector
  problems: ['shortest-path'],  // compatibility tags for Race / Discovery
  needs: { start: true, target: 'optional', weights: 'non-negative', direction: 'any' },
  options: [],                  // optional: [{ key, label, type: 'select', choices, default }]
  complexity: { time: 'O(V + E)', space: 'O(V)', fn: (V, E) => V + E },
  description: '…', prerequisites: '…', implementationNotes: '…',
  counters: COUNTERS,           // [{ key, label, description }]
  pseudocode: PSEUDOCODE,       // string[]; events reference lines by index
  limits: { traceNodes: 5000, benchmarkNodes: 5000 },
  validate, run, inspect,
};
```

`complexity.time` must describe *your implementation* (its data structures), and `complexity.fn`
must compute the same expression — the Complexity Analyzer fits it to measurements.

## 2. `validate(G, options, ctx)`

Return `[{ code, message }]` (empty when valid). Reuse `requirements.*` from
`js/core/GraphValidator.js` (`nonEmpty`, `start`, `target`, `nonNegative`, `directed`,
`undirected`, `noUndirectedNegative`, `maxNodes`). Never throw for bad input, and never silently
accept unsupported structures.

## 3. `run(G, options, T)`

- `G` is a frozen `CompiledGraph`: iterate neighbours with
  `for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) { G.adjTo[k]; G.adjW[k]; G.adjE[k]; }`.
- Create counters with `createCounters(COUNTERS)` and call `T?.attach(c)`. Increment counters in
  the algorithm logic, **independently of `T`**.
- Emit events only through `T?.emit(type, { nodeId, edgeId, line, metadata }, snapshot)`, using
  ids (`G.ids[i]`, `G.edgeIds[e]`). Pass a lazily evaluated `snapshot` function returning compact
  copies (typed-array `slice()`s) for the inspector. Always emit `ALGORITHM_STARTED` first and
  `ALGORITHM_COMPLETED` or `ALGORITHM_FAILED` last.
- Break ties by canonical index; use `PriorityQueue(c)` (ordered by priority, tie, tie2, insertion)
  so pushes/pops are counted live.
- Return an index-based raw result: `{ status, counters: c, dist?, pred?, predEdge?, order?, path?,
  treeEdges?, totalWeight?, components?, cycle?, error? }`. Use `reconstructPath` for paths.

## 4. `inspect(state, G)`

Convert a snapshot into display sections: `{ title, kind: 'list', items, total }`,
`{ title, kind: 'table', columns, rows }` or `{ title, kind: 'text', text }`. Keep at most
`INSPECT_LIMIT` items.

## 5. Register

Import the module in `js/algorithms/custom/index.js` and add it to the exported array (core
algorithms are listed in `js/core/AlgorithmEngine.js`). Invalid modules are rejected at
registration with a console error.

## 6. Test

The common-contract suite in `tests/algorithms/algorithms.test.js` automatically covers your
module (empty/single-node graphs, immutability, counters with and without tracing, determinism,
pseudocode lines, large graphs). Add hand-checked cases, the relevant edge cases from
[testing.md](testing.md), a property-based invariant and a differential test. Then run
`npm test` and `npm run check`.

## 7. Document

Add a section to [algorithms.md](algorithms.md) covering purpose, prerequisites, theoretical
complexity of your implementation, tie-breaking and support rules for self-loops and parallel
edges, and update `CHANGELOG.md`.

## Security note

AlgoForge does not load or execute algorithm code from user input or imported files. A future
in-browser editor would need a separate security model (Web Workers alone are not a sufficient
sandbox for untrusted code).
