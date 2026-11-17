/**
 * Debugger right sidebar: current step, state inspector and pseudocode highlighting.
 */
import { h, replace, clear } from './dom.js';
import { describeEvent } from '../core/VisualState.js';
import { StatisticsPanel } from './StatisticsPanel.js';

const TYPE_BADGE = {
  ALGORITHM_STARTED: 'badge-accent', ALGORITHM_COMPLETED: 'badge-ok', PATH_FOUND: 'badge-ok',
  ALGORITHM_FAILED: 'badge-err', NEGATIVE_CYCLE: 'badge-err', EDGE_REJECTED: 'badge-warn',
};

export class DebuggerPanel {
  constructor(app) {
    this.app = app;
    this.step = document.getElementById('step-info');
    this.inspector = document.getElementById('inspector-body');
    this.pseudo = document.getElementById('pseudocode');
    this.stats = new StatisticsPanel(document.getElementById('stats-body'));
    this.algoId = null;
    this.lastLine = -2;
  }

  setAlgorithm(algo) {
    if (this.algoId === algo.id) return;
    this.algoId = algo.id;
    replace(this.pseudo, algo.pseudocode.map((line, i) => h('li', { 'data-line': i }, line)));
    this.lastLine = -2;
  }

  render() {
    const { app } = this;
    const run = app.execution;
    const algo = run?.algo ?? null;
    if (algo) this.setAlgorithm(algo);
    const ctl = app.controller;
    const ev = ctl.currentEvent;
    const labelOf = (id) => app.editor.graph.getNode(id)?.label ?? id;

    if (!run) {
      replace(this.step, h('p', { class: 'hint' }, 'No execution yet. Choose an algorithm and press “Run & visualize”.'));
      replace(this.inspector, h('p', { class: 'hint' }, 'Data structures appear here while stepping.'));
      this.stats.render(null, null, null);
      this.#highlight(-1);
      return;
    }
    if (!run.ok) {
      replace(this.step, h('div', { class: 'msg msg-error' }, run.errors.map((e) => e.message).join(' ')));
      clear(this.inspector);
      this.stats.render(null, null, null);
      this.#highlight(-1);
      return;
    }

    const total = ctl.length;
    replace(this.step,
      h('div', { class: 'step-head' },
        h('span', { class: 'mono' }, `Step ${ctl.index + 1} / ${total}`),
        ev ? h('span', { class: `badge ${TYPE_BADGE[ev.type] ?? ''}` }, ev.type) : h('span', { class: 'badge' }, 'READY')),
      h('p', { class: 'step-desc' }, ev ? describeEvent(ev, labelOf) : 'Press play or step forward to begin.'),
      ctl.state.round ? h('p', { class: 'hint' }, ctl.state.round) : null,
      ctl.state.current ? h('p', { class: 'hint' }, `Current node: ${labelOf(ctl.state.current)}`) : null);

    this.stats.render(algo, ev, run);

    const snap = ctl.inspectorState();
    if (!snap) {
      replace(this.inspector, h('p', { class: 'hint' }, 'Step forward to inspect algorithm state.'));
    } else {
      const sections = algo.inspect(snap.state, run.G);
      replace(this.inspector,
        snap.at !== ctl.index ? h('p', { class: 'hint' }, `State as of step ${snap.at + 1} (snapshots are strided on large graphs to bound memory).`) : null,
        sections.map((s) => this.#section(s)));
    }
    this.#highlight(ev?.line ?? -1);
  }

  #section(s) {
    const head = h('div', { class: 'inspect-title' }, h('span', {}, s.title), s.total !== undefined ? h('span', { class: 'mono' }, String(s.total)) : null);
    let body;
    if (s.kind === 'list') {
      body = s.items.length
        ? h('div', { class: 'chips' }, s.items.map((t, i) => h('span', { class: `chip${i === 0 ? ' chip-head' : ''}` }, t)), s.total > s.items.length ? h('span', { class: 'empty' }, `+${s.total - s.items.length} more`) : null)
        : h('span', { class: 'empty' }, 'empty');
    } else if (s.kind === 'table') {
      body = s.rows.length
        ? h('div', { class: 'inspect-table-wrap' }, h('table', { class: 'data-table compact-table' },
          h('thead', {}, h('tr', {}, s.columns.map((c) => h('th', { scope: 'col' }, c)))),
          h('tbody', {}, s.rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))))
        : h('span', { class: 'empty' }, 'empty');
    } else {
      body = h('div', { class: 'mono' }, s.text);
    }
    return h('section', { class: 'inspect-section' }, head, body);
  }

  #highlight(line) {
    if (line === this.lastLine) return;
    this.lastLine = line;
    for (const li of this.pseudo.children) {
      if (Number(li.dataset.line) === line) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    }
  }
}
