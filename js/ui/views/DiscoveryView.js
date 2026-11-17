/**
 * Discovery Mode view: configure a seeded search, run it in a Web Worker with progress and
 * cancellation, then inspect, open, race, export or save the most interesting graph found.
 */
import { h, replace, fillSelect, dataTable, fmtNum, fmtMs, messageList, toast, announce, numberField, selectField } from '../dom.js';
import { generatorFields, readGenerator, writeGenerator } from '../GeneratorForm.js';
import { listAlgorithms, getAlgorithm, sharedProblems } from '../../core/AlgorithmEngine.js';
import { OBJECTIVES, DIRECTIONS, DEFAULT_DISCOVERY, validateDiscoveryConfig } from '../../experiments/DiscoveryEngine.js';
import { WorkerClient } from '../../experiments/WorkerClient.js';
import { GraphView } from '../../rendering/GraphView.js';
import { experimentEnvelope } from '../../experiments/ExperimentSerializer.js';
import { sparkline } from '../Chart.js';
import { HEURISTICS } from '../../algorithms/astar.js';
import { downloadText, safeFilename } from '../../storage/FileManager.js';
import { ExecutionController } from '../../core/ExecutionController.js';
import { execute } from '../../core/AlgorithmEngine.js';

export class DiscoveryView {
  constructor(app) {
    this.app = app;
    this.form = document.getElementById('discovery-form');
    this.progressHost = document.getElementById('discovery-progress');
    this.resultHost = document.getElementById('discovery-result');
    this.worker = new WorkerClient(new URL('../../workers/discovery.worker.js', import.meta.url));
    this.result = null;
    this.#buildForm();
    this.#idleProgress();
    document.getElementById('disc-open').addEventListener('click', () => this.#open());
    document.getElementById('disc-race').addEventListener('click', () => this.#race());
    document.getElementById('disc-export').addEventListener('click', () => this.#export());
    document.getElementById('disc-save').addEventListener('click', () => this.#save());
  }

  #buildForm() {
    const algos = listAlgorithms().map((a) => ({ value: a.id, label: a.shortName, group: a.category }));
    const d = DEFAULT_DISCOVERY;
    replace(this.form,
      h('fieldset', {}, h('legend', {}, 'Algorithms'),
        h('div', { class: 'field-grid' },
          selectField({ id: 'disc-a', label: 'Algorithm A', options: algos, value: d.algorithmA, onchange: () => this.#filterB() }),
          selectField({ id: 'disc-b', label: 'Algorithm B', options: algos, value: d.algorithmB, onchange: () => this.#renderAlgoOptions() }),
          h('div', { id: 'disc-algo-opts', class: 'span-2 field-grid' }))),
      h('fieldset', {}, h('legend', {}, 'Input graphs'), generatorFields('disc', { ...d.generator, seed: d.seed }, { showEndpoints: true, nodesMax: 1500 })),
      h('fieldset', {}, h('legend', {}, 'Search'),
        h('div', { class: 'field-grid' },
          selectField({ id: 'disc-objective', label: 'Objective', options: Object.entries(OBJECTIVES).map(([value, label]) => ({ value, label })), value: d.objective, cls: 'span-2' }),
          selectField({ id: 'disc-direction', label: 'Difference', options: Object.entries(DIRECTIONS).map(([value, label]) => ({ value, label })), value: d.direction, cls: 'span-2' }),
          numberField({ id: 'disc-experiments', label: 'Experiments', value: d.experiments, min: 1, max: 1000000 }),
          numberField({ id: 'disc-explore', label: 'Exploration fraction', value: d.explorationFraction, min: 0, max: 1, step: 0.05 }),
          numberField({ id: 'disc-stagnation', label: 'Stop after N without improvement (0 = off)', value: 0, min: 0, cls: 'span-2' }),
          numberField({ id: 'disc-timelimit', label: 'Time limit, s (0 = none)', value: 0, min: 0, step: 1, cls: 'span-2' }))),
      h('div', { class: 'msg', id: 'disc-errors', role: 'alert', hidden: true }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'submit', id: 'disc-start' }, 'Start search'),
        h('button', { class: 'btn', type: 'button', id: 'disc-cancel', disabled: true, onclick: () => this.cancel() }, 'Cancel')));
    this.form.addEventListener('submit', (ev) => { ev.preventDefault(); this.start(); });
    this.#filterB('astar');
  }

  #filterB(preferred) {
    const a = document.getElementById('disc-a').value;
    const sel = document.getElementById('disc-b');
    const cur = preferred ?? sel.value;
    const opts = listAlgorithms().filter((b) => sharedProblems(a, b.id).length && (b.id !== a || a === 'astar')).map((b) => ({ value: b.id, label: b.id === a ? `${b.shortName} (other options)` : b.shortName, group: b.category }));
    fillSelect(sel, opts, opts.some((o) => o.value === cur) ? cur : opts[0]?.value);
    this.#renderAlgoOptions();
  }

  #renderAlgoOptions() {
    const host = document.getElementById('disc-algo-opts');
    const out = [];
    for (const side of ['a', 'b']) {
      if (document.getElementById(`disc-${side}`).value === 'astar') {
        out.push(selectField({ id: `disc-${side}-heuristic`, label: `${side.toUpperCase()}: A* heuristic`, options: Object.entries(HEURISTICS).map(([value, label]) => ({ value, label })), value: side === 'b' && document.getElementById('disc-a').value === 'astar' ? 'euclidean' : 'calibrated', cls: 'span-2' }));
      }
    }
    replace(host, out);
  }

  /** Pre-fill generator settings from the workspace sidebar. */
  prefill(gen) {
    writeGenerator('disc', gen);
    const algo = this.app.store.get('algorithmId');
    const a = getAlgorithm(algo);
    if (a.problems.length) {
      document.getElementById('disc-a').value = algo;
      this.#filterB();
    }
  }

  config() {
    const gen = readGenerator('disc');
    const opt = (side) => {
      const el = document.getElementById(`disc-${side}-heuristic`);
      return el ? { heuristic: el.value } : {};
    };
    return {
      algorithmA: document.getElementById('disc-a').value,
      algorithmB: document.getElementById('disc-b').value,
      optionsA: opt('a'),
      optionsB: opt('b'),
      generator: { family: gen.family, nodes: gen.nodes, density: gen.density, directed: gen.directed, connected: gen.connected, weights: gen.weights, endpoints: gen.endpoints },
      experiments: Math.round(Number(document.getElementById('disc-experiments').value)),
      objective: document.getElementById('disc-objective').value,
      direction: document.getElementById('disc-direction').value,
      seed: gen.seed,
      explorationFraction: Math.min(1, Math.max(0, Number(document.getElementById('disc-explore').value) || 0)),
      stagnationLimit: Math.max(0, Math.round(Number(document.getElementById('disc-stagnation').value) || 0)),
      timeLimitMs: Math.max(0, Number(document.getElementById('disc-timelimit').value) || 0) * 1000,
    };
  }

  async start() {
    const cfg = this.config();
    const errors = validateDiscoveryConfig({ ...DEFAULT_DISCOVERY, ...cfg });
    messageList(document.getElementById('disc-errors'), errors);
    if (errors.length) return;
    document.getElementById('disc-start').disabled = true;
    document.getElementById('disc-cancel').disabled = false;
    this.#setResultButtons(false);
    replace(this.resultHost, h('p', { class: 'hint' }, 'Searching… the interface stays responsive; you can switch views.'));
    this.startedAt = performance.now();
    this.#renderProgress({ evaluated: 0, rejected: 0, total: cfg.experiments, bestScore: null, elapsedMs: 0, history: [] });
    try {
      const result = await this.worker.run({ cmd: 'start', config: cfg }, { onProgress: (p) => this.#renderProgress(p) });
      this.result = result;
      this.#renderResult(result);
      announce(`Search finished: ${result.terminatedBy}. Best score ${fmtNum(result.best?.score ?? 0)}.`);
    } catch (err) {
      if (err.cancelled) { toast('Search terminated.', 'warn'); this.#idleProgress('Search terminated before returning a result.'); } else messageList(document.getElementById('disc-errors'), [err.message]);
    } finally {
      document.getElementById('disc-start').disabled = false;
      document.getElementById('disc-cancel').disabled = true;
    }
  }

  cancel() { this.worker.cancel(); }

  #idleProgress(text = 'Not running.') {
    replace(this.progressHost, h('p', { class: 'hint' }, text));
  }

  #renderProgress(p) {
    const done = p.evaluated + p.rejected;
    const pct = p.total ? Math.min(100, (done / p.total) * 100) : 0;
    const bar = h('span', {});
    bar.style.width = `${pct.toFixed(1)}%`;
    replace(this.progressHost,
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': p.total, 'aria-valuenow': done, 'aria-label': 'Search progress' }, bar),
      h('div', { class: 'kpis' },
        kpi('Experiments', `${fmtNum(done)} / ${fmtNum(p.total)}`),
        kpi('Valid evaluated', fmtNum(p.evaluated)),
        kpi('Rejected inputs', fmtNum(p.rejected)),
        kpi('Best score', p.bestScore === null ? '—' : fmtNum(p.bestScore)),
        kpi('Elapsed', fmtMs(p.elapsedMs))),
      p.history?.length ? h('div', {}, h('div', { class: 'field-label' }, 'Best score so far (by experiment index)'),
        sparkline([...p.history.map((x) => ({ x: x.index, y: x.score })), { x: done, y: p.bestScore ?? 0 }], { color: 'var(--accent)', label: 'Best score over experiments' })) : null,
      p.terminatedBy ? h('p', { class: 'hint' }, `Stopped: ${p.terminatedBy}.`) : null);
  }

  #renderResult(r) {
    const best = r.best;
    if (!best) {
      replace(this.resultHost, h('div', { class: 'msg msg-warn' }, `No valid candidate was evaluated (${r.rejected} inputs rejected by the algorithms' validators). Adjust the generator settings.`));
      return;
    }
    const A = getAlgorithm(r.algorithms.A.id); const B = getAlgorithm(r.algorithms.B.id);
    const nameA = labelOf(A, r.algorithms.A.options); const nameB = labelOf(B, r.algorithms.B.options);
    const metricRows = [
      ['nodesVisited', 'Nodes visited'], ['edgesExamined', 'Edges examined'], ['relaxAttempts', 'Relaxation attempts'], ['relaxSuccess', 'Successful relaxations'],
      ['pqOps', 'Priority queue operations'], ['pathCost', 'Path cost / forest weight'], ['pathLength', 'Path length'], ['timeMs', 'Measured time'], ['status', 'Status'],
    ].map(([k, label]) => ({ label, a: best.metricsA[k], b: best.metricsB[k], key: k }));
    const fmtV = (r2, v) => (r2.key === 'timeMs' ? (v === null ? 'time objective only' : fmtMs(v)) : r2.key === 'status' ? v : fmtNum(v));
    const canvas = h('canvas', { role: 'img', 'aria-label': 'Winning graph' });
    const toggle = h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => this.#showRun('A') }, `Show ${nameA} final state`),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => this.#showRun('B') }, `Show ${nameB} final state`));
    replace(this.resultHost,
      h('div', { class: 'kpis' },
        kpi('Score', fmtNum(best.score)),
        kpi('Difference (A − B)', best.difference === null ? '—' : fmtNum(best.difference)),
        kpi('Found at experiment', `#${fmtNum(best.index + 1)} (${best.origin})`),
        kpi('Graph', `${best.graph.nodes.length} nodes · ${best.graph.edges.length} edges`),
        kpi('Seed', String(r.seed)),
        kpi('Search duration', fmtMs(r.searchDurationMs))),
      best.disagreement ? h('div', { class: 'msg msg-warn' }, `Disagreement: ${best.disagreement}`) : null,
      h('div', { class: 'table-scroll' }, dataTable([{ key: 'label', label: 'Metric' }, { key: 'a', label: `A · ${nameA}`, num: true, render: (x) => fmtV(x, x.a) }, { key: 'b', label: `B · ${nameB}`, num: true, render: (x) => fmtV(x, x.b) }], metricRows)),
      h('div', { class: 'mini-graph' }, h('div', { class: 'mini-head' }, h('span', { class: 'mini-title' }, 'Winning graph'), toggle), canvas),
      h('p', { class: 'hint' }, `${r.claim} ${fmtNum(r.experimentCount)} experiments (${fmtNum(r.evaluated)} evaluated, ${fmtNum(r.rejected)} rejected); terminated by ${r.terminatedBy}. Same seed, parameters and algorithm versions reproduce the same graphs and operation counts${r.objective === 'time' ? ' — except with the time objective, whose selection depends on noisy measurements' : ''}.`));
    this.miniView = new GraphView(canvas, { panZoom: true });
    this.miniView.setGraph(best.graph, { fit: true });
    this.miniView.setOverlay({ start: best.start, target: best.target });
    this.#showRun('B');
    this.#setResultButtons(true);
  }

  #showRun(side) {
    const r = this.result;
    if (!r?.best) return;
    const spec = side === 'A' ? r.algorithms.A : r.algorithms.B;
    const run = execute(spec.id, r.best.graph, { start: r.best.start, target: r.best.target, ...spec.options }, { trace: true, historyLimit: 200000 });
    if (!run.ok) return;
    const c = new ExecutionController();
    c.load(run.events);
    c.seek(run.events.length - 1);
    this.miniView.setVisual(c.state);
  }

  #setResultButtons(on) {
    for (const id of ['disc-open', 'disc-race', 'disc-export', 'disc-save']) document.getElementById(id).disabled = !on;
  }

  #envelope() {
    const r = this.result;
    return experimentEnvelope({
      kind: 'discovery',
      name: `Discovery ${getAlgorithm(r.algorithms.A.id).shortName} vs ${getAlgorithm(r.algorithms.B.id).shortName} (${r.objective}, seed ${r.seed})`,
      config: r.config,
      environment: r.environment,
      graph: r.best?.graph ?? null,
      result: r,
    });
  }

  #open() {
    const b = this.result?.best;
    if (!b) return;
    this.app.actions.loadGraphData(b.graph, { label: 'Open discovered graph' });
    this.app.store.set({ start: b.start, target: b.target, algorithmId: this.result.algorithms.B.id });
    this.app.actions.selectAlgorithm(this.result.algorithms.B.id);
    if (this.result.algorithms.B.options?.heuristic) this.app.actions.setAlgoOption('astar', 'heuristic', this.result.algorithms.B.options.heuristic);
    this.app.actions.goto('editor');
    toast('Discovered graph opened in the editor.', 'ok');
  }

  #race() {
    const b = this.result?.best;
    if (!b) return;
    this.app.actions.loadGraphData(b.graph, { label: 'Open discovered graph' });
    this.app.store.set({ start: b.start, target: b.target });
    this.app.actions.goto('race');
    this.app.race.preset(this.result.algorithms.A, this.result.algorithms.B);
  }

  #export() {
    if (!this.result) return;
    const env = this.#envelope();
    downloadText(safeFilename(env.name, 'json'), JSON.stringify(env, null, 2));
  }

  async #save() {
    if (!this.result) return;
    await this.app.actions.saveExperiment(this.#envelope());
  }

  showSaved(env) {
    this.result = env.result;
    if (env.config) {
      document.getElementById('disc-a').value = env.config.algorithmA;
      this.#filterB(env.config.algorithmB);
      writeGenerator('disc', { ...env.config.generator, seed: env.config.seed });
      document.getElementById('disc-experiments').value = String(env.config.experiments);
      document.getElementById('disc-objective').value = env.config.objective;
      document.getElementById('disc-direction').value = env.config.direction;
    }
    this.#renderProgress({ evaluated: env.result.evaluated, rejected: env.result.rejected, total: env.result.experimentCount, bestScore: env.result.best?.score ?? null, elapsedMs: env.result.searchDurationMs, history: env.result.history ?? [], terminatedBy: env.result.terminatedBy });
    this.#renderResult(env.result);
  }

  onThemeChange() { this.miniView?.refreshColors(); }
}

function kpi(label, value) {
  return h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value));
}

function labelOf(algo, options) {
  if (algo.id === 'astar' && options?.heuristic && options.heuristic !== 'calibrated') return `A* (${options.heuristic})`;
  return algo.shortName;
}
