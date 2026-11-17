/**
 * Left sidebar: algorithm selection, start/destination, algorithm options, graph tools,
 * graph generation and experiment shortcuts.
 */
import { h, replace, fillSelect, $$ } from './dom.js';
import { listAlgorithms, getAlgorithm } from '../core/AlgorithmEngine.js';
import { generatorFields } from './GeneratorForm.js';
import { naturalCompare } from '../utils/Validation.js';

export class Sidebar {
  constructor(app) {
    this.app = app;
    this.algoSelect = document.getElementById('algo-select');
    this.startSelect = document.getElementById('start-select');
    this.targetSelect = document.getElementById('target-select');
    this.optionsHost = document.getElementById('algo-options');
    fillSelect(this.algoSelect, listAlgorithms().map((a) => ({ value: a.id, label: a.name, group: a.category })), app.store.get('algorithmId'));
    this.algoSelect.addEventListener('change', () => app.actions.selectAlgorithm(this.algoSelect.value));
    this.startSelect.addEventListener('change', () => app.actions.setEndpoints({ start: this.startSelect.value || null }));
    this.targetSelect.addEventListener('change', () => app.actions.setEndpoints({ target: this.targetSelect.value || null }));
    document.getElementById('btn-run').addEventListener('click', () => app.actions.run({ play: true }));
    document.getElementById('btn-run-instant').addEventListener('click', () => app.actions.run({ toEnd: true }));

    // Tools
    for (const b of $$('#tool-group .tool')) b.addEventListener('click', () => app.actions.setTool(b.dataset.tool));
    document.getElementById('directed-toggle').addEventListener('change', (ev) => app.actions.setDirected(ev.target.checked));
    document.getElementById('btn-undo').addEventListener('click', () => app.actions.undo());
    document.getElementById('btn-redo').addEventListener('click', () => app.actions.redo());
    document.getElementById('btn-fit').addEventListener('click', () => app.actions.fit());
    document.getElementById('btn-reset-view').addEventListener('click', () => app.actions.resetView());
    document.getElementById('btn-clear').addEventListener('click', () => app.actions.clearGraph());

    // Generator
    const host = document.getElementById('gen-form-host');
    replace(host,
      generatorFields('gen', { family: 'random', nodes: 12, density: 0.25, weights: { distribution: 'uniform', min: 1, max: 20 }, connected: true }, { nodesMax: 2000 }),
      h('button', { class: 'btn btn-primary', type: 'button', id: 'btn-generate', onclick: () => app.actions.generate() }, 'Generate'));

    document.getElementById('btn-to-race').addEventListener('click', () => app.actions.goto('race'));
    document.getElementById('btn-to-discovery').addEventListener('click', () => app.actions.sendToDiscovery());
    document.getElementById('btn-to-complexity').addEventListener('click', () => app.actions.sendToComplexity());

    this.renderAlgorithm();
  }

  renderAlgorithm() {
    const { store } = this.app;
    const algo = getAlgorithm(store.get('algorithmId'));
    this.algoSelect.value = algo.id;
    document.getElementById('algo-desc').textContent = algo.description;
    const meta = document.getElementById('algo-meta');
    const needs = algo.needs;
    replace(meta,
      h('dt', {}, 'Time'), h('dd', {}, algo.complexity.time),
      h('dt', {}, 'Space'), h('dd', {}, algo.complexity.space),
      h('dt', {}, 'Weights'), h('dd', {}, needs.weights),
      h('dt', {}, 'Graph'), h('dd', {}, needs.direction === 'any' ? 'directed or undirected' : needs.direction));
    this.startSelect.disabled = needs.start === false;
    this.targetSelect.disabled = !needs.target;
    this.startSelect.closest('.field').querySelector('.field-label').textContent = needs.start === true ? 'Start *' : needs.start ? 'Start (optional)' : 'Start (n/a)';
    this.targetSelect.closest('.field').querySelector('.field-label').textContent = needs.target === 'required' ? 'Destination *' : needs.target ? 'Destination (optional)' : 'Destination (n/a)';

    const opts = store.get('algoOptions')[algo.id] ?? {};
    replace(this.optionsHost, (algo.options ?? []).map((o) => {
      const id = `opt-${algo.id}-${o.key}`;
      const sel = h('select', { id, onchange: (ev) => this.app.actions.setAlgoOption(algo.id, o.key, ev.target.value) });
      fillSelect(sel, Object.entries(o.choices).map(([value, label]) => ({ value, label })), opts[o.key] ?? o.default);
      return h('label', { class: 'field', for: id }, h('span', { class: 'field-label' }, o.label), sel);
    }));
  }

  renderNodes() {
    const { editor, store } = this.app;
    const nodes = [...editor.graph.nodes].sort((a, b) => naturalCompare(a.id, b.id));
    const opts = [{ value: '', label: '—' }, ...nodes.map((n) => ({ value: n.id, label: n.label === n.id ? n.id : `${n.label}` }))];
    fillSelect(this.startSelect, opts, store.get('start') ?? '');
    fillSelect(this.targetSelect, opts, store.get('target') ?? '');
    document.getElementById('directed-toggle').checked = editor.graph.directed;
  }

  renderTool(tool) {
    for (const b of $$('#tool-group .tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  }

  renderHistory() {
    const { history } = this.app.editor;
    const u = document.getElementById('btn-undo');
    const r = document.getElementById('btn-redo');
    u.disabled = !history.canUndo();
    r.disabled = !history.canRedo();
    u.title = history.canUndo() ? `Undo ${history.peekUndoLabel()} (Ctrl+Z)` : 'Nothing to undo';
    r.title = history.canRedo() ? `Redo ${history.peekRedoLabel()} (Ctrl+Shift+Z)` : 'Nothing to redo';
  }
}
