/**
 * Editor right sidebar: selection properties, graph summary/validation and an accessible,
 * keyboard-operable node-and-edge list (the non-visual alternative to canvas editing).
 */
import { h, replace, fillSelect, fmtNum } from './dom.js';
import { validateGraphData } from '../core/GraphValidator.js';
import { LIMITS, naturalCompare, sanitizeText } from '../utils/Validation.js';

const PAGE = 100;

export class StructurePanel {
  constructor(app) {
    this.app = app;
    this.props = document.getElementById('props-body');
    this.info = document.getElementById('graph-info');
    this.structure = document.getElementById('structure-body');
    this.showAll = { nodes: false, edges: false };
  }

  renderAll() {
    this.renderProps();
    this.renderInfo();
    this.renderStructure();
  }

  renderProps() {
    const { editor, selection, store, actions } = this.app;
    const sel = selection.current;
    const g = editor.graph;
    if (!sel) {
      replace(this.props, h('p', { class: 'hint' }, 'Select a node or edge on the canvas or in the structure list to edit it.'));
      return;
    }
    if (sel.type === 'node') {
      const n = g.getNode(sel.id);
      if (!n) return;
      const label = h('input', { type: 'text', id: 'prop-label', value: n.label, maxlength: LIMITS.maxLabelLength });
      const x = h('input', { type: 'number', id: 'prop-x', value: n.x, step: 'any' });
      const y = h('input', { type: 'number', id: 'prop-y', value: n.y, step: 'any' });
      const commit = () => actions.updateNode(n.id, {
        label: sanitizeText(label.value, LIMITS.maxLabelLength) || n.id,
        x: Number.isFinite(+x.value) ? +x.value : n.x,
        y: Number.isFinite(+y.value) ? +y.value : n.y,
      });
      for (const el of [label, x, y]) el.addEventListener('change', commit);
      replace(this.props,
        h('div', { class: 'step-head' }, h('strong', {}, `Node ${n.label}`), h('span', { class: 'badge' }, n.id)),
        h('label', { class: 'field', for: 'prop-label' }, h('span', { class: 'field-label' }, 'Label'), label),
        h('div', { class: 'field-row' },
          h('label', { class: 'field', for: 'prop-x' }, h('span', { class: 'field-label' }, 'x'), x),
          h('label', { class: 'field', for: 'prop-y' }, h('span', { class: 'field-label' }, 'y'), y)),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => actions.setEndpoints({ start: n.id }), 'aria-pressed': String(store.get('start') === n.id) }, 'Set as start (S)'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => actions.setEndpoints({ target: n.id }), 'aria-pressed': String(store.get('target') === n.id) }, 'Set as destination (T)'),
          h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => actions.deleteSelection() }, 'Delete')));
      return;
    }
    const e = g.getEdge(sel.id);
    if (!e) return;
    const w = h('input', { type: 'number', id: 'prop-weight', value: e.weight, step: 'any' });
    w.addEventListener('change', () => {
      const v = Number.parseFloat(w.value);
      if (!Number.isFinite(v) || Math.abs(v) > LIMITS.maxAbsWeight) { w.setAttribute('aria-invalid', 'true'); this.app.ui.error('Weight must be a finite number.'); return; }
      w.removeAttribute('aria-invalid');
      actions.updateEdge(e.id, { weight: v });
    });
    const s = g.getNode(e.source); const t = g.getNode(e.target);
    replace(this.props,
      h('div', { class: 'step-head' }, h('strong', {}, `Edge ${s?.label} ${g.directed ? '→' : '—'} ${t?.label}`), h('span', { class: 'badge' }, e.id)),
      h('label', { class: 'field', for: 'prop-weight' }, h('span', { class: 'field-label' }, 'Weight'), w),
      e.source === e.target ? h('p', { class: 'hint' }, 'Self-loop: ignored by MST algorithms; a cycle for topological sort.') : null,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => actions.deleteSelection() }, 'Delete edge')));
  }

  focusWeight() {
    const el = document.getElementById('prop-weight');
    el?.focus();
    el?.select();
  }

  updateNodePosition(id) {
    if (this.app.selection.current?.id !== id) return;
    const n = this.app.editor.graph.getNode(id);
    const x = document.getElementById('prop-x');
    const y = document.getElementById('prop-y');
    if (n && x && y && document.activeElement !== x && document.activeElement !== y) { x.value = String(n.x); y.value = String(n.y); }
  }

  renderInfo() {
    const g = this.app.editor.graph;
    const v = validateGraphData(g.toJSON(), { allowEmpty: true });
    const neg = g.edges.filter((e) => e.weight < 0).length;
    replace(this.info,
      h('dl', { class: 'meta-list' },
        h('dt', {}, 'Mode'), h('dd', {}, g.directed ? 'directed' : 'undirected'),
        h('dt', {}, 'Nodes'), h('dd', {}, fmtNum(g.nodeCount)),
        h('dt', {}, 'Edges'), h('dd', {}, fmtNum(g.edgeCount)),
        h('dt', {}, 'Negative weights'), h('dd', {}, String(neg))),
      [...v.errors.map((e) => h('div', { class: 'msg msg-error' }, e.message)), ...v.warnings.map((w) => h('div', { class: 'msg msg-warn' }, w.message))]);
  }

  renderStructure() {
    const { editor, selection, actions } = this.app;
    const g = editor.graph;
    const nodes = [...g.nodes].sort((a, b) => naturalCompare(a.id, b.id));
    const edges = [...g.edges].sort((a, b) => naturalCompare(a.id, b.id));
    const labelOf = (id) => g.getNode(id)?.label ?? id;

    const nodeRows = (this.showAll.nodes ? nodes : nodes.slice(0, PAGE)).map((n) => h('tr', { 'aria-selected': String(selection.is('node', n.id)) },
      h('td', {}, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => actions.select({ type: 'node', id: n.id }), 'aria-label': `Select node ${n.label}` }, n.label)),
      h('td', { class: 'num' }, fmtNum(n.x)),
      h('td', { class: 'num' }, fmtNum(n.y)),
      h('td', {}, h('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', 'aria-label': `Delete node ${n.label}`, onclick: () => actions.removeNode(n.id) }, '✕'))));

    const edgeRows = (this.showAll.edges ? edges : edges.slice(0, PAGE)).map((e) => {
      const w = h('input', { type: 'number', value: e.weight, step: 'any', 'aria-label': `Weight of edge ${labelOf(e.source)} to ${labelOf(e.target)}` });
      w.addEventListener('change', () => {
        const v = Number.parseFloat(w.value);
        if (Number.isFinite(v)) actions.updateEdge(e.id, { weight: v }); else w.value = String(e.weight);
      });
      return h('tr', { 'aria-selected': String(selection.is('edge', e.id)) },
        h('td', {}, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => actions.select({ type: 'edge', id: e.id }), 'aria-label': `Select edge ${labelOf(e.source)} to ${labelOf(e.target)}` }, `${labelOf(e.source)} ${g.directed ? '→' : '—'} ${labelOf(e.target)}`)),
        h('td', {}, w),
        h('td', {}, h('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', 'aria-label': `Delete edge ${labelOf(e.source)} to ${labelOf(e.target)}`, onclick: () => actions.removeEdge(e.id) }, '✕')));
    });

    // Add-node form
    const nl = h('input', { type: 'text', id: 'add-node-label', placeholder: g.nextLabel(), maxlength: LIMITS.maxLabelLength, 'aria-label': 'New node label' });
    const addNode = h('form', { class: 'field-row', onsubmit: (ev) => { ev.preventDefault(); actions.addNodeAuto(sanitizeText(nl.value, LIMITS.maxLabelLength) || undefined); } },
      h('label', { class: 'field', for: 'add-node-label' }, h('span', { class: 'field-label' }, 'Add node (label)'), nl),
      h('button', { class: 'btn btn-sm', type: 'submit' }, 'Add'));

    // Add-edge form
    const opts = nodes.map((n) => ({ value: n.id, label: n.label }));
    const src = fillSelect(h('select', { id: 'add-edge-src', 'aria-label': 'Edge source' }), opts);
    const dst = fillSelect(h('select', { id: 'add-edge-dst', 'aria-label': 'Edge target' }), opts, nodes[1]?.id);
    const wt = h('input', { type: 'number', id: 'add-edge-w', value: '1', step: 'any', 'aria-label': 'Edge weight' });
    const addEdge = h('form', { class: 'field-row', onsubmit: (ev) => {
      ev.preventDefault();
      const v = Number.parseFloat(wt.value);
      if (!src.value || !dst.value) return;
      actions.addEdgeDirect(src.value, dst.value, Number.isFinite(v) ? v : 1);
    } },
      h('label', { class: 'field', for: 'add-edge-src' }, h('span', { class: 'field-label' }, 'From'), src),
      h('label', { class: 'field', for: 'add-edge-dst' }, h('span', { class: 'field-label' }, 'To'), dst),
      h('label', { class: 'field', for: 'add-edge-w' }, h('span', { class: 'field-label' }, 'w'), wt),
      h('button', { class: 'btn btn-sm', type: 'submit', disabled: !nodes.length }, 'Add'));

    const more = (kind, total) => (total > PAGE && !this.showAll[kind]
      ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { this.showAll[kind] = true; this.renderStructure(); } }, `Show all ${total}`)
      : null);

    replace(this.structure,
      addNode,
      h('div', { class: 'inspect-table-wrap' }, h('table', { class: 'data-table compact-table' },
        h('caption', {}, `Nodes (${nodes.length})`),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Label'), h('th', { scope: 'col', class: 'num' }, 'x'), h('th', { scope: 'col', class: 'num' }, 'y'), h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Actions')))),
        h('tbody', {}, nodeRows))),
      more('nodes', nodes.length),
      addEdge,
      h('div', { class: 'inspect-table-wrap' }, h('table', { class: 'data-table compact-table' },
        h('caption', {}, `Edges (${edges.length})`),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Edge'), h('th', { scope: 'col' }, 'Weight'), h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Actions')))),
        h('tbody', {}, edgeRows))),
      more('edges', edges.length));
  }
}
