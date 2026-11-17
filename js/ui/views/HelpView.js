/**
 * In-app documentation, generated partly from the algorithm registry so it never drifts from
 * the implementations.
 */
import { h, replace } from '../dom.js';
import { listAlgorithms } from '../../core/AlgorithmEngine.js';

export class HelpView {
  constructor() { this.host = document.getElementById('help-body'); this.rendered = false; }

  render() {
    if (this.rendered) return;
    this.rendered = true;
    const k = (...keys) => keys.map((x, i) => [i ? ' / ' : '', h('kbd', {}, x)]);
    const shortcuts = [
      [k('V'), 'Select / move tool'], [k('N'), 'Add-node tool'], [k('E'), 'Add-edge tool'], [k('D'), 'Delete tool'],
      [k('Delete', 'Backspace'), 'Delete selection'], [k('Alt+Arrows'), 'Move selected node (Shift: 1 px)'],
      [k('S'), 'Set selected node as start'], [k('T'), 'Set selected node as destination'],
      [k('Ctrl+Z'), 'Undo'], [k('Ctrl+Shift+Z', 'Ctrl+Y'), 'Redo'],
      [k('F'), 'Fit graph to view'], [k('0'), 'Reset viewport'], [k('+', '−'), 'Zoom'],
      [k('R'), 'Run & visualize'], [k('Space'), 'Play / pause'], [k('←', '→'), 'Step backward / forward'], [k('Home', 'End'), 'First / last step'],
      [k('Esc'), 'Cancel pending edge, clear selection'],
    ];
    const card = (title, ...body) => h('section', { class: 'card' }, h('h2', { class: 'card-title' }, title), ...body);
    replace(this.host,
      card('Getting started',
        h('ul', {},
          h('li', {}, 'Build a graph in the Editor: pick the Node tool and click the canvas, or generate one from the sidebar. Use the Edge tool to connect nodes (click source, then target).'),
          h('li', {}, 'Choose an algorithm, a start and (if needed) a destination, then press Run & visualize. The Debugger shows the current step, data structures, statistics and highlighted pseudocode.'),
          h('li', {}, 'Step backward and forward at any time; playback speed never affects measurements.'),
          h('li', {}, 'Race compares two compatible algorithms on identical copies of the graph. Discovery searches for graphs that maximise a difference. Complexity measures scaling.'),
          h('li', {}, 'Everything runs locally. Save to this browser or export JSON to share reproducible experiments.'))),
      card('Keyboard shortcuts',
        h('table', { class: 'data-table' }, h('tbody', {}, shortcuts.map(([keys, what]) => h('tr', {}, h('td', {}, keys), h('td', {}, what))))),
        h('p', {}, 'Every editing operation is also available without a mouse in the Structure panel (Editor view, right sidebar).')),
      card('Visual encoding',
        h('ul', {},
          h('li', {}, 'Dashed ring: discovered / in the frontier. Solid ring: visited. Filled: finalized.'),
          h('li', {}, 'Double outer ring: current node. Thick double green stroke: final path.'),
          h('li', {}, 'Dashed edge: examined. Thick edge: tree / predecessor edge. Dotted edge: rejected (MST).'),
          h('li', {}, '“S” and “T” badges: start and destination. Small labels above nodes: distances or order.'),
          h('li', {}, 'States are distinguished by shape and line style as well as colour.'))),
      card('Methodology',
        h('h3', {}, 'Determinism'),
        h('p', {}, 'Nodes and edges have a canonical order (numeric-aware sort of ids). All tie-breaking follows it, so the same graph always yields the same trace. Generators use a documented seeded PRNG (Mulberry32).'),
        h('h3', {}, 'Benchmarks'),
        h('p', {}, 'Only the algorithm is timed (no rendering, no event recording), with warm-up, adaptive batching against timer coarsening, repeated samples and medians. Results are experimental browser measurements and vary across devices.'),
        h('h3', {}, 'Discovery'),
        h('p', {}, 'Random exploration followed by mutation of an elite pool. The best case found is reported — never claimed to be globally optimal. The same seed and settings reproduce the same graphs and operation counts.'),
        h('h3', {}, 'Complexity'),
        h('p', {}, 'Fitted reference curves are visual guides; measurements are not proof of asymptotic complexity.')),
      card('Privacy & security',
        h('ul', {},
          h('li', {}, 'No backend, accounts, analytics or network requests. Data stays on this device unless you export it.'),
          h('li', {}, 'Imported files are parsed as data only, validated against the schema and resource limits; nothing in them is executed.'),
          h('li', {}, 'A restrictive Content Security Policy blocks inline and remote scripts.'))),
      card('Algorithms', ...listAlgorithms().map((a) => h('div', { class: 'algo-doc' },
        h('h3', {}, `${a.name} `, h('span', { class: 'badge' }, a.complexity.time)),
        h('p', {}, a.description),
        h('p', {}, h('strong', {}, 'Prerequisites: '), a.prerequisites),
        h('p', {}, h('strong', {}, 'Implementation: '), a.implementationNotes),
        a.complexity.note ? h('p', {}, a.complexity.note) : null))),
      card('More documentation',
        h('ul', {},
          ['architecture', 'algorithms', 'benchmarking', 'discovery-mode', 'testing', 'contributing-algorithms'].map((d) => h('li', {}, h('a', { href: `docs/${d}.md`, target: '_blank', rel: 'noopener' }, `docs/${d}.md`))))));
  }
}
