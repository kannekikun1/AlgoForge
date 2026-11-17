/**
 * Saved graphs and experiments (IndexedDB): open, export, delete.
 */
import { h, replace, dataTable, confirmAction, toast } from '../dom.js';
import { downloadText, safeFilename, graphToJSONText } from '../../storage/FileManager.js';

export class SavedView {
  constructor(app) {
    this.app = app;
    this.graphsHost = document.getElementById('saved-graphs');
    this.expHost = document.getElementById('saved-experiments');
  }

  async render() {
    const { storage } = this.app;
    document.getElementById('saved-sub').textContent = storage.persistent
      ? 'Graphs and experiments stored locally in this browser (IndexedDB). Nothing leaves your device.'
      : 'IndexedDB is unavailable in this browser context; items are kept in memory for this session only. Export to keep them.';
    let graphs = []; let exps = [];
    try {
      [graphs, exps] = await Promise.all([storage.listGraphs(), storage.listExperiments()]);
    } catch (err) {
      toast(`Could not read saved data: ${err.message}`, 'error');
    }
    const when = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };
    const btn = (label, fn, aria, cls = '') => h('button', { class: `btn btn-sm ${cls}`, type: 'button', onclick: fn, 'aria-label': aria }, label);

    replace(this.graphsHost, graphs.length ? dataTable([
      { key: 'name', label: 'Name' },
      { key: 'nodes', label: 'Nodes', num: true },
      { key: 'edges', label: 'Edges', num: true },
      { key: 'savedAt', label: 'Saved', render: (r) => when(r.savedAt) },
      { key: 'actions', label: 'Actions', render: (r) => h('div', { class: 'row-actions' },
        btn('Open', () => this.app.actions.openSavedGraph(r), `Open graph ${r.name}`),
        btn('Export', () => downloadText(safeFilename(r.name, 'json'), graphToJSONText(r.graph, { name: r.name, start: r.start, target: r.target })), `Export graph ${r.name}`),
        btn('Delete', async () => { if (confirmAction(`Delete saved graph “${r.name}”? This cannot be undone.`)) { await storage.deleteGraph(r.id); this.render(); } }, `Delete graph ${r.name}`, 'btn-danger')) },
    ], graphs) : h('p', { class: 'hint' }, 'No saved graphs yet. Use “Save” in the top bar.'));

    replace(this.expHost, exps.length ? dataTable([
      { key: 'name', label: 'Name' },
      { key: 'kind', label: 'Type', render: (r) => h('span', { class: 'badge' }, r.kind) },
      { key: 'savedAt', label: 'Saved', render: (r) => when(r.savedAt) },
      { key: 'actions', label: 'Actions', render: (r) => h('div', { class: 'row-actions' },
        btn('Open', () => this.app.actions.openExperiment(r), `Open experiment ${r.name}`),
        btn('Export', () => downloadText(safeFilename(r.name, 'json'), JSON.stringify(r, null, 2)), `Export experiment ${r.name}`),
        btn('Delete', async () => { if (confirmAction(`Delete experiment “${r.name}”? This cannot be undone.`)) { await storage.deleteExperiment(r.id); this.render(); } }, `Delete experiment ${r.name}`, 'btn-danger')) },
    ], exps) : h('p', { class: 'hint' }, 'No saved experiments. Save results from Race, Discovery or Complexity.'));
  }
}
