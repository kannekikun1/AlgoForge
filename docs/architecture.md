# Architecture

AlgoForge is a static ES2022 application with no framework and no build step. Modules are
organised by responsibility; dependencies point inward (UI → experiments/rendering/editor →
core/algorithms/structures → utils), and `npm run check` rejects circular imports.

## Layers

| Layer | Directory | Responsibility | DOM? |
| --- | --- | --- | --- |
| Utilities | `js/utils` | Event emitter, statistics, validation, canonical ordering | no |
| Data structures | `js/structures` | Queue, MinHeap, PriorityQueue, DisjointSet | no |
| Core | `js/core` | Graph model & compiler, validator, algorithm registry/engine, event recorder, visual-state reducer, execution controller, state store, PRNG | no |
| Algorithms | `js/algorithms` | One module per algorithm; `custom/` for local extensions | no |
| Experiments | `js/experiments` | Generators, benchmark runner, race, discovery, complexity, serializer, worker client | no¹ |
| Workers | `js/workers` | Discovery and benchmark workers with a sliced run loop | no |
| Storage | `js/storage` | LocalStorage preferences, IndexedDB adapter, import/export | browser APIs only |
| Rendering | `js/rendering` | Canvas/DPR handling, viewport, graph drawing, redraw scheduling | canvas |
| Editor | `js/editor` | Editing model with undo, pointer input, selection | canvas events |
| UI | `js/ui` | Panels, views, charts, DOM helpers | yes |

¹ `WorkerClient` uses the `Worker` API but no DOM.

Everything except `rendering/`, `editor/InputController`, `ui/` and the browser-only helpers in
`storage/` runs unchanged in Node, which is how the test suite exercises it.

## Graph data model

The editing model (`Graph`) holds plain records exactly as exported:

```js
node = { id: 'node-001', label: 'A', x: 250, y: 180 }
edge = { id: 'edge-001', source: 'node-001', target: 'node-002', weight: 5, directed: true }
```

`compileGraph(data)` produces an immutable, index-based **CompiledGraph**: nodes and edges sorted
by `naturalCompare` of their ids (the *canonical order*), coordinates in typed arrays, and a
compressed-sparse-row adjacency (`adjStart`, `adjTo`, `adjW`, `adjE`) with each segment sorted by
(neighbour index, edge index). Every algorithm runs on a freshly compiled copy, so it cannot mutate
the editor's graph, and all tie-breaking derives from the canonical order.

Direction is graph-wide in v1; `edge.directed` is normalised to the graph mode. Undirected edges
appear in both endpoints' adjacency lists (self-loops once).

## Algorithm execution protocol

```
prepare(id, graphData, options) → validate structure → compile → algorithm.validate
execute(id, graphData, options, { trace, historyLimit }) → { result, events, ... }
```

An algorithm module exposes `validate`, `run(G, options, recorder|null)` and `inspect`. During
`run` it increments **operation counters** as part of its logic and, only if a recorder is
attached, emits **visualization events**:

```js
{ type: 'NODE_VISITED', step: 12, nodeId: 'node-004', edgeId: undefined,
  line: 6,                         // index into the module's explicit pseudocode
  metadata: { distance: 15 },
  counters: { nodesVisited: 5, … },  // copy at this moment
  state: { … } }                     // optional compact inspector snapshot
```

Core types: `ALGORITHM_STARTED`, `NODE_VISITED`, `NODE_DISCOVERED`, `EDGE_EXAMINED`,
`EDGE_RELAXED`, `DISTANCE_UPDATED`, `NODE_FINALIZED`, `PATH_FOUND`, `ALGORITHM_COMPLETED`,
`ALGORITHM_FAILED`; specialised: `EDGE_ACCEPTED`, `EDGE_REJECTED`, `ORDER_ASSIGNED`,
`ROUND_STARTED`, `NEGATIVE_CYCLE`.

The distinction between events and operations is enforced by tests: counters are identical with
and without tracing, and benchmarks never attach a recorder.

Inspector snapshots are O(V); the recorder captures one every ⌈V/100⌉ events (plus the first and
terminal events) to bound memory, and the history limit (Settings) caps the number of stored
events while always keeping the terminal events.

## Visualization and replay

`VisualState.applyEvent` is a pure reducer from events to drawable state (node/edge statuses,
annotations, current element, path, error highlights). `ExecutionController` stores a cloned
snapshot every 64 events; seeking to step *i* restores the nearest snapshot ≤ *i* and replays at
most 63 events, so backward stepping costs O(64) reducer steps regardless of trace length.
Tests verify that every seek equals a fresh replay from step 0.

Playback speed only changes how often the controller advances; it never touches algorithm code.

## Rendering

`GraphView` = `CanvasRenderer` (DPR, `ResizeObserver`) + `ViewportController` (pan/zoom
transform) + `GraphRenderer` (pure drawing) + `AnimationController` (at most one redraw per frame,
only when something is dirty). The renderer culls nodes and edges outside the visible world
rectangle, hides weight labels and node labels at low zoom, and caches parallel-edge/self-loop
layout (rebuilt only on structural changes, not during drags). A full redraw of 500 nodes and
2,000 edges takes ≈ 8 ms in headless Chromium.

States are encoded redundantly (shape/line style + colour) for accessibility; see the legend.

## Application state

`StateManager` holds plain values (view, algorithm, options, start/target, tool). The graph lives
in `GraphEditor`, which records undo snapshots before mutations and emits `change` events with a
kind (`structure`, `position`, `load`). `main.js` coordinates: structural changes rebuild the
renderer index, refresh panels and invalidate any trace.

## Workers

`DiscoveryEngine` and `ComplexityAnalyzer` are pure, resumable state machines exposing
`step(budgetMs)`. The workers call them in ~40 ms slices, yielding between slices so a `cancel`
message is handled promptly, and post progress at most every 200 ms. `WorkerClient` falls back to
`terminate()` if a worker does not respond within a grace period.

## Storage

- LocalStorage: preferences (`algoforge:prefs`) and the autosaved working graph.
- IndexedDB (`algoforge` database; `graphs`, `experiments` stores). If unavailable, an in-memory
  adapter is used and the UI says so.
- Files: versioned JSON envelopes (`schemaVersion: 1`, `application: "AlgoForge"`). See
  [algorithms.md](algorithms.md) for result fields and the README for the graph format.

## Extending

New algorithms: [contributing-algorithms.md](contributing-algorithms.md). New generator
families: add a case in `GraphGenerator.buildEdges`, list it in `FAMILIES`, and add determinism
and validity tests.
