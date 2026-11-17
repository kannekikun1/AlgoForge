/**
 * Visualization state derived purely from execution events (a reducer).
 *
 * The renderer draws a graph plus a VisualState; the ExecutionController produces the
 * VisualState for any step by replaying events from the nearest snapshot. Because the reducer
 * is pure with respect to the event list, replay is deterministic.
 */
import { fmt } from '../algorithms/common.js';

export const NODE_RANK = Object.freeze({ discovered: 1, visited: 2, finalized: 3 });
export const EDGE_RANK = Object.freeze({ examined: 1, rejected: 2, tree: 3 });

export function createVisualState() {
  return {
    nodes: new Map(), // id → 'discovered' | 'visited' | 'finalized'
    edges: new Map(), // id → 'examined' | 'tree' | 'rejected'
    labels: new Map(), // id → short annotation (distance, order)
    current: null,
    currentEdge: null,
    pathNodes: new Set(),
    pathEdges: new Set(),
    errorNodes: new Set(),
    errorEdges: new Set(),
    labelRow: undefined,
    round: null,
    status: 'idle',
    message: '',
  };
}

export function cloneVisualState(s) {
  return {
    ...s,
    nodes: new Map(s.nodes),
    edges: new Map(s.edges),
    labels: new Map(s.labels),
    pathNodes: new Set(s.pathNodes),
    pathEdges: new Set(s.pathEdges),
    errorNodes: new Set(s.errorNodes),
    errorEdges: new Set(s.errorEdges),
  };
}

function raiseNode(s, id, status) {
  if (!id) return;
  const cur = s.nodes.get(id);
  if (!cur || NODE_RANK[status] > NODE_RANK[cur]) s.nodes.set(id, status);
}

function raiseEdge(s, id, status) {
  if (!id) return;
  const cur = s.edges.get(id);
  if (!cur || EDGE_RANK[status] > EDGE_RANK[cur]) s.edges.set(id, status);
}

/** Apply one event to the state (mutating). */
export function applyEvent(s, ev) {
  const m = ev.metadata ?? {};
  switch (ev.type) {
    case 'ALGORITHM_STARTED':
      s.status = 'running';
      s.labelRow = m.start ?? null;
      s.current = ev.nodeId ?? null;
      s.message = 'Algorithm started.';
      break;
    case 'NODE_DISCOVERED':
      raiseNode(s, ev.nodeId, 'discovered');
      if (m.treeEdge) s.edges.set(m.treeEdge, 'tree');
      break;
    case 'NODE_VISITED':
      raiseNode(s, ev.nodeId, 'visited');
      s.current = ev.nodeId;
      s.currentEdge = null;
      break;
    case 'NODE_FINALIZED':
      raiseNode(s, ev.nodeId, 'finalized');
      break;
    case 'EDGE_EXAMINED':
      raiseEdge(s, ev.edgeId, 'examined');
      s.currentEdge = ev.edgeId;
      break;
    case 'EDGE_RELAXED':
      if (m.replacedEdge && m.replacedEdge !== m.treeEdge) s.edges.set(m.replacedEdge, 'examined');
      s.edges.set(ev.edgeId, 'tree');
      s.currentEdge = ev.edgeId;
      break;
    case 'EDGE_ACCEPTED':
      s.edges.set(ev.edgeId, 'tree');
      s.currentEdge = ev.edgeId;
      if (m.total !== undefined) s.message = `Forest weight: ${fmt(m.total)}`;
      break;
    case 'EDGE_REJECTED':
      s.edges.set(ev.edgeId, 'rejected');
      s.currentEdge = ev.edgeId;
      break;
    case 'DISTANCE_UPDATED':
      if (m.row !== undefined && m.row !== s.labelRow) break;
      if (m.distance !== undefined) s.labels.set(ev.nodeId, fmt(m.distance));
      break;
    case 'ORDER_ASSIGNED':
      s.labels.set(ev.nodeId, m.label ?? `#${m.order}`);
      break;
    case 'ROUND_STARTED':
      s.round = m.label ?? null;
      if (ev.nodeId) s.current = ev.nodeId;
      break;
    case 'PATH_FOUND':
      s.pathNodes = new Set(m.path ?? []);
      s.pathEdges = new Set(m.edges ?? []);
      s.message = `Path found: cost ${fmt(m.cost)}, ${m.hops} edge(s).`;
      break;
    case 'NEGATIVE_CYCLE':
      s.errorNodes = new Set(m.cycle ?? m.nodes ?? []);
      s.errorEdges = new Set(m.edges ?? []);
      break;
    case 'ALGORITHM_FAILED':
      s.status = 'failed';
      s.current = null;
      s.currentEdge = null;
      s.message = m.error?.message ?? 'Algorithm failed.';
      if (m.cycle) s.errorNodes = new Set(m.cycle);
      break;
    case 'ALGORITHM_COMPLETED':
      s.status = 'completed';
      s.current = null;
      s.currentEdge = null;
      if (!s.pathNodes.size && !s.message.startsWith('Forest')) s.message = 'Algorithm completed.';
      else if (s.message.startsWith('Forest')) s.message = `Completed. ${s.message}`;
      break;
    default:
      break;
  }
  return s;
}

/** Human-readable description of an event for the step information panel. */
export function describeEvent(ev, labelOf = (id) => id) {
  const m = ev.metadata ?? {};
  const L = (id) => (id ? labelOf(id) : '—');
  switch (ev.type) {
    case 'ALGORITHM_STARTED': return `Start${m.start ? ` at ${L(m.start)}` : ''}${m.target ? `, destination ${L(m.target)}` : ''}.`;
    case 'NODE_DISCOVERED': return `Discovered ${L(ev.nodeId)}${m.distance !== undefined ? ` (d = ${fmt(m.distance)})` : ''}${m.parent ? ` from ${L(m.parent)}` : ''}.`;
    case 'NODE_VISITED': return `Visit ${L(ev.nodeId)}${m.distance !== undefined ? ` (d = ${fmt(m.distance)})` : ''}${m.f !== undefined ? `, f = ${fmt(m.f)}` : ''}.`;
    case 'NODE_FINALIZED': return `Finalized ${L(ev.nodeId)}.`;
    case 'EDGE_EXAMINED': return m.from ? `Examine edge ${L(m.from)} → ${L(m.to)}${m.weight !== undefined ? ` (w = ${fmt(m.weight)})` : ''}.` : `Examine edge ${ev.edgeId}.`;
    case 'EDGE_RELAXED': return `Relax ${L(m.from)} → ${L(m.to)}: distance now ${fmt(m.distance)}.`;
    case 'DISTANCE_UPDATED': return m.via ? `d[${L(m.from)}][${L(m.to)}] ← ${fmt(m.distance)} via ${L(m.via)}.` : `Distance of ${L(ev.nodeId)} = ${fmt(m.distance)}.`;
    case 'EDGE_ACCEPTED': return `Accept edge (w = ${fmt(m.weight)}); forest weight ${fmt(m.total)}.`;
    case 'EDGE_REJECTED': return `Reject edge (${m.reason === 'self-loop' ? 'self-loop' : 'would create a cycle'}).`;
    case 'ORDER_ASSIGNED': return `${L(ev.nodeId)} is #${m.order} in the order.`;
    case 'ROUND_STARTED': return `${m.label ?? 'Next round'}.`;
    case 'PATH_FOUND': return `Path found with cost ${fmt(m.cost)} (${m.hops} edge(s)).`;
    case 'NEGATIVE_CYCLE': return 'Negative cycle detected.';
    case 'ALGORITHM_FAILED': return m.error?.message ?? 'Algorithm failed.';
    case 'ALGORITHM_COMPLETED': return 'Algorithm completed.';
    default: return ev.type;
  }
}
