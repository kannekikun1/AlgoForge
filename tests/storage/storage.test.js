import { suite, test, assert } from '../harness.js';
import { parseImport, graphToJSONText } from '../../js/storage/FileManager.js';
import { StorageManager } from '../../js/storage/StorageManager.js';
import { MemoryAdapter } from '../../js/storage/IndexedDBAdapter.js';
import { experimentEnvelope } from '../../js/experiments/ExperimentSerializer.js';
import { g } from '../helpers.js';

const envelope = (graph, extra = {}) => JSON.stringify({ schemaVersion: 1, application: 'AlgoForge', graph, ...extra });

suite('Import validation', () => {
  test('valid graph import', () => {
    const r = parseImport(envelope(g([['A', 'B', 4]], { directed: true })));
    assert.ok(r.ok);
    assert.equal(r.kind, 'graph');
    assert.equal(r.graph.edges[0].weight, 4);
  });
  test('export → import round trip', () => {
    const data = g([['A', 'B', 4], ['B', 'C', -1]], { directed: true });
    const r = parseImport(graphToJSONText(data));
    assert.deepEqual(r.graph, { ...data, nodes: data.nodes.map((n) => ({ ...n })), edges: data.edges.map((e) => ({ ...e })) });
  });
  const bad = {
    'invalid JSON': '{"schemaVersion": 1, ',
    'array top-level': '[]',
    'missing schemaVersion': JSON.stringify({ graph: {} }),
    'unsupported schema': JSON.stringify({ schemaVersion: 99, graph: {} }),
    'foreign application': JSON.stringify({ schemaVersion: 1, application: 'Other', graph: {} }),
    'missing graph': JSON.stringify({ schemaVersion: 1 }),
    'nodes not array': envelope({ nodes: 'x', edges: [] }),
    'missing endpoint': envelope({ directed: false, nodes: [{ id: 'A', x: 0, y: 0 }], edges: [{ id: 'e', source: 'A', target: 'B', weight: 1 }] }),
    'string weight': envelope({ directed: false, nodes: [{ id: 'A', x: 0, y: 0 }], edges: [{ id: 'e', source: 'A', target: 'A', weight: '1' }] }),
    'huge coordinate': envelope({ directed: false, nodes: [{ id: 'A', x: 1e12, y: 0 }], edges: [] }),
    'non-string id': envelope({ directed: false, nodes: [{ id: 5, x: 0, y: 0 }], edges: [] }),
  };
  for (const [name, text] of Object.entries(bad)) {
    test(`rejects: ${name}`, () => {
      const r = parseImport(text);
      assert.equal(r.ok, false);
      assert.ok(r.errors.length > 0 && typeof r.errors[0] === 'string');
    });
  }
  test('rejects oversize files', () => {
    assert.equal(parseImport('x'.repeat(100), { maxBytes: 10 }).ok, false);
  });
  test('drops unknown fields and prototype keys; never evaluates code', () => {
    const text = '{"schemaVersion":1,"graph":{"directed":false,"__proto__":{"polluted":true},"nodes":[{"id":"A","x":0,"y":0,"onclick":"alert(1)","label":"<img src=x onerror=alert(1)>"}],"edges":[]}}';
    const r = parseImport(text);
    assert.ok(r.ok);
    assert.equal(Object.keys(r.graph.nodes[0]).join(','), 'id,label,x,y');
    assert.equal(({}).polluted, undefined);
    assert.equal(r.graph.nodes[0].label, '<img src=x onerror=alert(1)>', 'kept as inert text (rendered via textContent)');
  });
  test('experiment import', () => {
    const env = experimentEnvelope({ kind: 'race', name: 'r', result: { rows: [] } });
    const r = parseImport(JSON.stringify(env));
    assert.ok(r.ok);
    assert.equal(r.kind, 'experiment');
  });
});

suite('StorageManager (memory adapter)', () => {
  test('save/list/delete graphs and experiments', async () => {
    const mem = new Map();
    const ls = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    const s = await new StorageManager({ adapter: new MemoryAdapter(), localStorage: ls }).init();
    const rec = await s.saveGraph({ name: 'g1', graph: g([['A', 'B']]) });
    assert.equal((await s.listGraphs()).length, 1);
    assert.equal((await s.getGraph(rec.id)).name, 'g1');
    await s.deleteGraph(rec.id);
    assert.equal((await s.listGraphs()).length, 0);
    const exp = await s.saveExperiment(experimentEnvelope({ kind: 'race', name: 'r', result: {} }));
    assert.equal((await s.listExperiments())[0].id, exp.id);
    s.savePrefs({ theme: 'light', speed: 'bad' });
    const prefs = s.loadPrefs();
    assert.equal(prefs.theme, 'light');
    assert.equal(prefs.speed, 8, 'invalid types fall back to defaults');
  });
});
