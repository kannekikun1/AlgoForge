/**
 * Helpers shared by algorithm implementations. Everything here works on compiled graphs
 * (index-based) and is free of DOM or rendering concerns.
 */

/** Create a counter object with the given keys initialised to 0. */
export function createCounters(defs) {
  const c = {};
  for (const d of defs) c[d.key] = 0;
  return c;
}

/** Standard counter definitions. Algorithms pick the subset that is meaningful for them. */
export const COUNTER = Object.freeze({
  nodesVisited: { key: 'nodesVisited', label: 'Nodes visited' },
  edgesExamined: { key: 'edgesExamined', label: 'Edges examined' },
  relaxAttempts: { key: 'relaxAttempts', label: 'Relaxation attempts' },
  relaxSuccess: { key: 'relaxSuccess', label: 'Successful relaxations' },
  pqPush: { key: 'pqPush', label: 'Priority queue pushes' },
  pqPop: { key: 'pqPop', label: 'Priority queue pops' },
});

/** Merge a standard definition with an algorithm-specific description. */
export function counter(base, description) {
  return { ...base, description };
}

/**
 * Reconstruct a path s → t from predecessor arrays.
 * @returns {{path:number[], pathEdges:number[], cost:number}|null}
 */
export function reconstructPath(G, pred, predEdge, s, t) {
  if (t < 0) return null;
  if (s === t) return { path: [s], pathEdges: [], cost: 0 };
  if (pred[t] === -1) return null;
  const path = [t];
  const pathEdges = [];
  let cost = 0;
  let v = t;
  let guard = 0;
  while (v !== s) {
    const e = predEdge[v];
    pathEdges.push(e);
    cost += G.edgeW[e];
    v = pred[v];
    if (v === -1 || ++guard > G.n) return null; // defensive: broken predecessor chain
    path.push(v);
  }
  path.reverse();
  pathEdges.reverse();
  return { path, pathEdges, cost };
}

export function labelOf(G, i) { return i >= 0 ? G.labels[i] : '—'; }

/** Format a distance for display. */
export function fmt(d) {
  if (d === Infinity) return '∞';
  if (d === -Infinity) return '−∞';
  if (Number.isInteger(d)) return String(d);
  return String(Math.round(d * 1000) / 1000);
}

/** Inspector helper: distance-like typed array → [{node, value}] rows for discovered nodes only. */
export function rowsFrom(G, arr, include = () => true, format = fmt) {
  const rows = [];
  for (let i = 0; i < arr.length; i++) if (include(i)) rows.push({ node: G.labels[i], value: format(arr[i]) });
  return rows;
}

export function predRows(G, pred) {
  const rows = [];
  for (let i = 0; i < pred.length; i++) if (pred[i] >= 0) rows.push({ node: G.labels[i], value: G.labels[pred[i]] });
  return rows;
}

export function setList(G, flags) {
  const out = [];
  for (let i = 0; i < flags.length; i++) if (flags[i]) out.push(G.labels[i]);
  return out;
}

/** Inspector rendering truncates huge collections. */
export const INSPECT_LIMIT = 200;
