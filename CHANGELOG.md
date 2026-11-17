# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-11-16

### Added
- Graph editor: node/edge creation, dragging, weights (including negative), directed/undirected
  mode, zoom/pan with wheel and pinch, undo/redo, seeded generators (random, geometric, grid,
  DAG, tree, complete), accessible structure list, drag-and-drop import.
- Algorithm engine with nine implementations: BFS, DFS, Dijkstra, A*, Bellman-Ford,
  Floyd-Warshall, Kruskal, Prim and Kahn's topological sort; deterministic tie-breaking;
  structured execution events; operation counters.
- Example custom module: Greedy Best-First Search.
- Step-by-step debugger with backward stepping (periodic snapshots + replay), state inspector,
  pseudocode highlighting and adjustable speed.
- Algorithm Race (synchronized, independent and benchmark modes).
- Discovery Mode (seeded exploration + elite mutation, Web Worker, progress, cancellation,
  reproducible exports).
- Complexity Analyzer (interactive SVG chart, fitted reference curves, CSV/JSON export).
- Local persistence (LocalStorage preferences, IndexedDB graphs/experiments) and versioned
  JSON import/export with validation.
- Dark and light themes, reduced-motion support, keyboard shortcuts, responsive layout.
- Unit, property-based, differential, integration and end-to-end tests; CI checks.
