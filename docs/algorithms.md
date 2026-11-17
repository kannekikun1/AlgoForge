# Algorithms

All implementations are original, operate on the compiled graph (see
[architecture.md](architecture.md)), and are deterministic under the tie-breaking rules below.

## Shared conventions

**Canonical order.** Nodes and edges are ordered by a locale-independent natural comparison of
their ids (`node-2` < `node-10`; labels `A` < `Z` < `AA`). Adjacency lists are sorted by
(neighbour index, edge index). Every "first"/"smallest" choice below refers to this order.

**Self-loops and parallel edges.**

| Structure | Traversal / shortest paths | MST (Kruskal, Prim) | Kahn |
| --- | --- | --- | --- |
| Self-loop | examined like any edge; never improves a non-negative distance; a negative self-loop is a negative cycle | skipped (Kruskal records it as *rejected*) | a directed cycle → rejected |
| Parallel edges | each examined separately; the cheapest wins naturally | each considered; the cheapest is used | each counts toward in-degree |

**Invalid input** never throws: validators return `{ code, message }` errors (empty graph, missing
start/destination, negative weights where unsupported, wrong direction mode, size limits). In the
debugger this appears as a single `ALGORITHM_FAILED` event. Runtime-detected failures (negative
cycles, directed cycles) return `status: 'failed'` with an explanatory error and the offending
cycle highlighted.

**Results** (`materialize`): `status` (`completed`, `no-path`, `failed`), `counters`,
`distances`, `predecessors`, `order`, `path`, `pathEdges`, `pathCost`, `pathLength`,
`treeEdges`, `totalWeight`, `components`, `cycle`, `error` — whichever apply.

## Breadth-First Search — `bfs`

- **Purpose:** fewest-hop paths / level-order traversal. Weights are ignored for the search; the
  reported path cost sums the weights along the BFS path so it can be compared with weighted
  algorithms.
- **Prerequisites:** start; optional destination (search stops when it is dequeued).
- **Complexity:** O(V + E) time, O(V) space. FIFO queue with a head index.
- **Counters:** nodes visited (dequeued), edges examined (adjacency entries), queue operations.

## Depth-First Search — `dfs`

- **Purpose:** depth-first traversal with discovery/finish times and pre/post-order.
- **Implementation:** iterative stack of (node, adjacency cursor) frames that reproduces recursive
  visit order exactly without risking call-stack overflow (tested on a 4,000-node path).
- **Prerequisites:** start; optional destination (stops when first visited).
- **Complexity:** O(V + E) time, O(V) space.

## Dijkstra — `dijkstra`

- **Purpose:** single-source shortest paths, non-negative weights (negative weights rejected).
- **Implementation:** binary heap with lazy deletion — improved distances are pushed as new
  entries; stale entries are skipped. The heap holds at most E + 1 entries.
- **Tie-breaking:** equal keys popped by node index; distances replaced only by strictly smaller
  values (first predecessor wins).
- **Complexity:** O((V + E) log V) time, O(V + E) space.
- **Counters:** nodes finalised, edges examined, relaxation attempts (edges to non-finalised
  nodes), successful relaxations, heap pushes/pops, stale pops.

## A* — `astar`

- **Purpose:** single-pair shortest path guided by a heuristic.
- **Heuristics:**
  - `calibrated` (default): *h(n) = k · ‖n − t‖* with *k = min over edges of w(u,v) / ‖u − v‖*.
    For every edge, *h(u) − h(v) ≤ k‖u − v‖ ≤ w(u,v)*, so *h* is **consistent** (and therefore
    admissible) for any non-negative weights and any layout. A* is optimal and never reopens nodes.
  - `zero`: *h ≡ 0* (Dijkstra with early exit; used in differential tests).
  - `euclidean`: raw distance in canvas units — admissible only if every weight ≥ its drawn
    length. Results carry `optimalityGuaranteed: false`; Discovery Mode can find counterexamples.
- **Consistency policy:** a closed node is reopened if a strictly better *g* is found (only possible
  with an inconsistent heuristic; reported by the `reopened` counter).
- **Tie-breaking:** open set ordered by (f, h, node index).
- **Complexity:** O((V + E) log V) worst case.

## Bellman-Ford — `bellmanFord`

- **Purpose:** single-source shortest paths with negative weights; negative-cycle detection.
- **Implementation:** up to V − 1 passes over all arcs in canonical order with early termination
  after a pass without improvement; pass V relaxes once more and, if anything improves, walks V
  predecessor steps back to land on a cycle, which is extracted and reported with its weight.
- **Direction:** on undirected graphs a negative edge is itself a negative 2-cycle, so such inputs
  are rejected up front with an explanation.
- **Complexity:** O(V · E) time, O(V) space.

## Floyd-Warshall — `floydWarshall`

- **Purpose:** all-pairs shortest paths. If a start (and destination) is selected, that row (and
  path) is reported for comparison with single-source algorithms.
- **Implementation:** dense `Float64Array` distance matrix and next-hop matrix; parallel edges
  initialised to the cheapest; pivot loop in canonical order; a negative diagonal reports a
  negative cycle.
- **Limits:** 800 nodes (60 when stepping, because events scale with V³).
- **Complexity:** Θ(V³) time, Θ(V²) space.

## Kruskal — `kruskal`

- **Purpose:** minimum spanning forest (one tree per connected component).
- **Implementation:** edges sorted by (weight, edge index); disjoint-set union by rank with path
  halving; stops after V − (components) acceptances.
- **Prerequisites:** undirected graph; any weights.
- **Complexity:** O(E log V) time (sorting), O(V + E) space.

## Prim — `prim`

- **Purpose:** minimum spanning forest.
- **Implementation:** lazy binary heap of arcs ordered by (weight, edge index, neighbour index);
  starts from the selected start node (or the first node) and restarts at the lowest-index
  unvisited node when a component is exhausted.
- **Complexity:** O(E log V) time, O(V + E) space.
- Total weight always equals Kruskal's (differentially tested); the chosen edges may differ when
  weights tie.

## Kahn's topological sort — `topologicalSort`

- **Purpose:** order a DAG so every edge points forward.
- **Implementation:** FIFO ready queue seeded with sources in canonical order; newly freed nodes
  appended as their last incoming arc is processed.
- **Failure:** if fewer than V nodes are output, the graph has a directed cycle; one concrete
  cycle is extracted (iterative DFS) and reported.
- **Prerequisites:** directed graph (self-loops count as cycles).
- **Complexity:** O(V + E) time, O(V) space.

## Example module: Greedy Best-First Search — `greedyBestFirst`

Expands the node with the smallest straight-line distance to the destination; fast but not
optimal. It lives in `js/algorithms/custom/` as the reference template for contributors.

## Compatibility (Race / Discovery)

Algorithms are comparable when they share a problem tag: `traversal` (BFS, DFS),
`shortest-path` (BFS, Dijkstra, A*, Bellman-Ford, Floyd-Warshall, Greedy best-first), `mst`
(Kruskal, Prim), `topological` (Kahn). Operation counters are algorithm-specific — each
algorithm's definitions are shown as tooltips and must not be read as equivalent measures.
