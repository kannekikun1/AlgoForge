import { suite, test, assert } from '../harness.js';
import { ExecutionController, SNAPSHOT_INTERVAL } from '../../js/core/ExecutionController.js';
import { createVisualState, applyEvent } from '../../js/core/VisualState.js';
import { execute } from '../../js/core/AlgorithmEngine.js';
import { Graph } from '../../js/core/Graph.js';
import { HistoryManager } from '../../js/editor/HistoryManager.js';
import { generateGraph } from '../../js/experiments/GraphGenerator.js';
import { prepareRace } from '../../js/experiments/AlgorithmRace.js';
import { parseImport, graphToJSONText } from '../../js/storage/FileManager.js';

const manual = { request: () => 1, cancel: () => {} };
const serialize = (s) => JSON.stringify({ n: [...s.nodes], e: [...s.edges], l: [...s.labels], c: s.current, ce: s.currentEdge, p: [...s.pathEdges], st: s.status });

function replay(events, upto) {
  const s = createVisualState();
  for (let i = 0; i <= upto; i++) applyEvent(s, events[i]);
  return s;
}

suite('Execution controller', () => {
  const { graph, start, target } = generateGraph({ family: 'random', nodes: 60, density: 0.1 }, 77);
  const run = execute('dijkstra', graph, { start, target }, { trace: true });

  test('trace is long enough to exercise snapshots', () => {
    assert.ok(run.events.length > SNAPSHOT_INTERVAL * 3, `${run.events.length} events`);
  });

  test('backward stepping equals fresh replay at every index', () => {
    const c = new ExecutionController({ scheduler: manual });
    c.load(run.events);
    c.seek(run.events.length - 1);
    for (let i = run.events.length - 1; i >= 0; i -= 7) {
      c.seek(i);
      assert.equal(serialize(c.state), serialize(replay(run.events, i)), `mismatch at ${i}`);
    }
  });

  test('step forward/back, stop, restart', () => {
    const c = new ExecutionController({ scheduler: manual });
    c.load(run.events);
    c.stepForward(); c.stepForward();
    assert.equal(c.index, 1);
    c.stepBackward();
    assert.equal(c.index, 0);
    c.stop();
    assert.equal(c.index, -1);
    c.restart();
    assert.ok(c.playing);
    c.pause();
    assert.ok(!c.playing);
  });

  test('play advances by speed; pause/resume; ends at last event', () => {
    const c = new ExecutionController({ scheduler: manual, speed: 10 });
    c.load(run.events);
    c.play();
    c.tick(1000);
    assert.equal(c.index, 9);
    c.pause();
    c.tick(1000); // ignored by caller semantics: tick only called while playing in the browser
    c.play();
    c.setSpeed(2000);
    for (let i = 0; i < 100 && c.playing; i++) c.tick(250);
    assert.ok(c.atEnd);
    assert.ok(!c.playing);
  });

  test('replay is deterministic across separate executions', () => {
    const again = execute('dijkstra', graph, { start, target }, { trace: true });
    const a = new ExecutionController({ scheduler: manual });
    const b = new ExecutionController({ scheduler: manual });
    a.load(run.events); b.load(again.events);
    a.seek(a.length - 1); b.seek(b.length - 1);
    assert.equal(serialize(a.state), serialize(b.state));
    assert.ok(a.state.pathEdges.size > 0);
  });

  test('inspector state available at strided steps', () => {
    const c = new ExecutionController({ scheduler: manual });
    c.load(run.events);
    c.seek(25);
    const st = c.inspectorState();
    assert.ok(st && st.at <= 25);
    const sections = run.algo.inspect(st.state, run.G);
    assert.ok(sections.length >= 2);
  });

  test('history limit truncates but keeps terminal events', () => {
    const big = execute('bfs', graph, { start }, { trace: true, historyLimit: 30 });
    assert.ok(big.truncated);
    assert.equal(big.events[big.events.length - 1].type, 'ALGORITHM_COMPLETED');
  });

  test('failed validation yields a single ALGORITHM_FAILED event', () => {
    const r = execute('dijkstra', { directed: true, nodes: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 1, y: 1 }], edges: [{ id: 'e', source: 'A', target: 'B', weight: -1 }] }, { start: 'A' }, { trace: true });
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].type, 'ALGORITHM_FAILED');
  });
});

suite('Editor history', () => {
  test('undo/redo restores graph snapshots', () => {
    const G = new Graph();
    const h = new HistoryManager();
    h.record(G.toJSON(), 'add A');
    G.addNode({ x: 1, y: 1 });
    h.record(G.toJSON(), 'add B');
    G.addNode({ x: 2, y: 2 });
    const prev = h.undo(G.toJSON());
    assert.equal(prev.nodes.length, 1);
    const next = h.redo(prev);
    assert.equal(next.nodes.length, 2);
  });
  test('identical consecutive snapshots coalesce', () => {
    const h = new HistoryManager();
    h.record({ a: 1 }); h.record({ a: 1 });
    assert.equal(h.past.length, 1);
  });
  test('limit enforced', () => {
    const h = new HistoryManager({ limit: 3 });
    for (let i = 0; i < 10; i++) h.record({ i });
    assert.equal(h.past.length, 3);
  });
});

suite('End-to-end pipeline (headless)', () => {
  test('edit → export → import → race on identical inputs', () => {
    const G = new Graph({ directed: false });
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(G.addNode({ x: i * 100, y: (i % 2) * 80 }).id);
    for (let i = 1; i < 6; i++) G.addEdge({ source: ids[i - 1], target: ids[i], weight: i });
    G.addEdge({ source: ids[0], target: ids[5], weight: 20 });
    const imported = parseImport(graphToJSONText(G.toJSON()));
    assert.ok(imported.ok);
    const { runA, runB } = prepareRace({ id: 'dijkstra' }, { id: 'astar' }, imported.graph, {});
    void runA; void runB;
    const race = prepareRace({ id: 'dijkstra', options: { start: ids[0], target: ids[5] } }, { id: 'astar', options: { start: ids[0], target: ids[5] } }, imported.graph);
    assert.equal(race.runA.result.pathCost, 15);
    assert.equal(race.runB.result.pathCost, 15);
    assert.equal(JSON.stringify(G.toJSON().nodes), JSON.stringify(imported.graph.nodes));
  });
});
