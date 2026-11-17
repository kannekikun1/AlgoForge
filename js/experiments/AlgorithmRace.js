/**
 * Algorithm Race: comparison logic independent of the DOM.
 *
 * - `prepareRace` executes both algorithms with tracing on identical, independently compiled
 *   copies of the same graph (each compile is a deep copy, so neither run can affect the other).
 * - `syncIndices` maps a synchronized tick to an event index for each side under a step policy.
 * - `comparisonRows` builds the labelled metric table. Algorithm-specific counters are labelled
 *   with each algorithm's own definition; they are not presented as equivalent measures.
 */
import { execute, getAlgorithm, sharedProblems, summaryMetrics } from '../core/AlgorithmEngine.js';

export const STEP_POLICIES = Object.freeze({
  event: 'One event per tick on each side',
  progress: 'Proportional progress (both finish together)',
});

export const RACE_MODES = Object.freeze({
  synchronized: 'Synchronized',
  independent: 'Independent',
  benchmark: 'Benchmark (no animation)',
});

export function validateRace(aId, bId, graphData) {
  const errors = [];
  if (!aId || !bId) errors.push('Select two algorithms.');
  else if (!sharedProblems(aId, bId).length) errors.push(`${getAlgorithm(aId).shortName} and ${getAlgorithm(bId).shortName} are not comparable (no shared problem).`);
  if (!graphData?.nodes?.length) errors.push('The graph is empty.');
  return errors;
}

export function prepareRace(a, b, graphData, { historyLimit } = {}) {
  const frozen = JSON.parse(JSON.stringify(graphData));
  const runA = execute(a.id, frozen, a.options ?? {}, { trace: true, historyLimit });
  const runB = execute(b.id, frozen, b.options ?? {}, { trace: true, historyLimit });
  return { runA, runB };
}

/**
 * @param {number} tick 0-based synchronized tick
 * @param {number} lenA event count of A
 * @param {number} lenB event count of B
 * @param {'event'|'progress'} policy
 */
export function syncIndices(tick, lenA, lenB, policy) {
  if (policy === 'progress') {
    const T = Math.max(lenA, lenB) - 1;
    if (T <= 0) return [lenA - 1, lenB - 1];
    const f = Math.min(1, tick / T);
    return [Math.round(f * (lenA - 1)), Math.round(f * (lenB - 1))];
  }
  return [Math.min(lenA - 1, tick), Math.min(lenB - 1, tick)];
}

export function syncLength(lenA, lenB) {
  return Math.max(lenA, lenB);
}

const METRIC_ROWS = [
  { key: 'timeMs', label: 'Execution time (median)', unit: 'ms', lowerIsBetter: true },
  { key: 'nodesVisited', label: 'Nodes visited', counter: true, lowerIsBetter: true },
  { key: 'edgesExamined', label: 'Edges examined', counter: true, lowerIsBetter: true },
  { key: 'relaxAttempts', label: 'Relaxation attempts', counter: true, lowerIsBetter: true },
  { key: 'relaxSuccess', label: 'Successful relaxations', counter: true, lowerIsBetter: true },
  { key: 'pqOps', label: 'Priority queue operations', lowerIsBetter: true },
  { key: 'pathCost', label: 'Path cost / forest weight', lowerIsBetter: true },
  { key: 'pathLength', label: 'Path length (edges)' },
  { key: 'status', label: 'Completion status' },
];

/**
 * @param {{result:object, timeMs?:number|null}} A
 * @param {{result:object, timeMs?:number|null}} B
 */
export function comparisonRows(A, B) {
  const algoA = getAlgorithm(A.result.algorithm);
  const algoB = getAlgorithm(B.result.algorithm);
  const ma = { ...summaryMetrics(A.result), timeMs: A.timeMs ?? null };
  const mb = { ...summaryMetrics(B.result), timeMs: B.timeMs ?? null };
  return METRIC_ROWS.map((row) => {
    const da = row.counter ? algoA.counters.find((c) => c.key === row.key)?.description : null;
    const db = row.counter ? algoB.counters.find((c) => c.key === row.key)?.description : null;
    let winner = null;
    const va = ma[row.key]; const vb = mb[row.key];
    if (row.lowerIsBetter && typeof va === 'number' && typeof vb === 'number' && va !== vb) winner = va < vb ? 'A' : 'B';
    return { ...row, a: va, b: vb, definitionA: da ?? null, definitionB: db ?? null, winner };
  });
}

export function raceRecord({ a, b, graph, mode, policy, benchmark, resultA, resultB }) {
  return {
    algorithms: { A: { id: a.id, options: a.options ?? {}, version: getAlgorithm(a.id).version }, B: { id: b.id, options: b.options ?? {}, version: getAlgorithm(b.id).version } },
    mode,
    policy,
    graph,
    resultA,
    resultB,
    benchmark: benchmark ?? null,
    rows: comparisonRows({ result: resultA, timeMs: benchmark?.a?.stats?.median ?? null }, { result: resultB, timeMs: benchmark?.b?.stats?.median ?? null }),
    note: 'Timings are experimental browser measurements (median of repeated runs, rendering excluded). Operation counts follow each algorithm\'s own definitions.',
  };
}
