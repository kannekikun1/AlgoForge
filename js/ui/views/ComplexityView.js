/**
 * Complexity Analyzer view: scaling experiments in a Web Worker, interactive SVG chart
 * (time or any operation counter, linear/log, optional fitted reference curve), per-size
 * summary table, CSV/JSON export and local saving.
 */
import { h, replace, fillSelect, dataTable, fmtNum, fmtMs, messageList, toast, announce, numberField, selectField, checkboxField } from '../dom.js';
import { listAlgorithms, getAlgorithm } from '../../core/AlgorithmEngine.js';
import { FAMILIES, WEIGHT_DISTRIBUTIONS } from '../../experiments/GraphGenerator.js';
import { DEFAULT_COMPLEXITY, validateComplexityConfig, complexityToCSV, analyzeSamples } from '../../experiments/ComplexityAnalyzer.js';
import { WorkerClient } from '../../experiments/WorkerClient.js';
import { renderChart } from '../Chart.js';
import { experimentEnvelope } from '../../experiments/ExperimentSerializer.js';
import { downloadText, safeFilename } from '../../storage/FileManager.js';
import { freshSeed } from '../../core/SeededRandom.js';
import { HEURISTICS } from '../../algorithms/astar.js';

const opts = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));

export class ComplexityView {
  constructor(app) {
    this.app = app;
    this.form = document.getElementById('complexity-form');
    this.chartHost = document.getElementById('complexity-chart');
    this.progressHost = document.getElementById('complexity-progress');
    this.tableHost = document.getElementById('complexity-table');
    this.detail = document.getElementById('complexity-detail');
    this.note = document.getElementById('complexity-note');
    this.worker = new WorkerClient(new URL('../../workers/benchmark.worker.js', import.meta.url));
    this.result = null;
    this.metric = 'time';
    this.#buildForm();
    this.#buildControls();
    replace(this.chartHost, h('p', { class: 'hint' }, 'Configure an experiment and press Run.'));
    document.getElementById('cx-export-csv').addEventListener('click', () => this.#exportCSV());
    document.getElementById('cx-export-json').addEventListener('click', () => this.#exportJSON());
    document.getElementById('cx-save').addEventListener('click', () => this.#save());
    window.addEventListener('resize', () => { if (this.result && !document.getElementById('view-complexity').hidden) this.#renderChart(); });
  }

  #buildForm() {
    const d = DEFAULT_COMPLEXITY;
    const algos = listAlgorithms().map((a) => ({ value: a.id, label: a.shortName, group: a.category }));
    const seed = h('input', { type: 'number', id: 'cx-seed', value: d.seed, min: 0, step: 1 });
    replace(this.form,
      h('fieldset', {}, h('legend', {}, 'Algorithm'),
        selectField({ id: 'cx-algo', label: 'Algorithm', options: algos, value: d.algorithm, onchange: () => this.#algoChanged() }),
        h('div', { id: 'cx-algo-opts' }),
        h('p', { class: 'hint', id: 'cx-theory' })),
      h('fieldset', {}, h('legend', {}, 'Input sizes'),
        h('div', { class: 'field-grid' },
          numberField({ id: 'cx-min', label: 'Minimum nodes', value: d.minN, min: 1 }),
          numberField({ id: 'cx-max', label: 'Maximum nodes', value: d.maxN, min: 1 }),
          numberField({ id: 'cx-step', label: 'Increment', value: d.stepN, min: 1 }),
          numberField({ id: 'cx-reps', label: 'Repetitions per size', value: d.repetitions, min: 1, max: 100 }))),
      h('fieldset', {}, h('legend', {}, 'Graphs'),
        h('div', { class: 'field-grid' },
          selectField({ id: 'cx-family', label: 'Graph family', options: opts(FAMILIES), value: d.family, cls: 'span-2' }),
          selectField({ id: 'cx-dmode', label: 'Density mode', options: [{ value: 'degree', label: 'Average degree (E ∝ V)' }, { value: 'fraction', label: 'Edge fraction (E ∝ V²)' }], value: d.densityMode, cls: 'span-2' }),
          numberField({ id: 'cx-density', label: 'Density value', value: d.density, min: 0, step: 0.01, cls: 'span-2' }),
          selectField({ id: 'cx-dist', label: 'Weights', options: opts(WEIGHT_DISTRIBUTIONS), value: d.weights.distribution, cls: 'span-2' }),
          numberField({ id: 'cx-wmin', label: 'Min weight', value: d.weights.min }),
          numberField({ id: 'cx-wmax', label: 'Max weight', value: d.weights.max }),
          h('label', { class: 'field span-2', for: 'cx-seed' }, h('span', { class: 'field-label' }, 'Random seed'),
            h('div', { class: 'input-with-btn' }, seed, h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'New random seed', onclick: () => { seed.value = String(freshSeed()); } }, '⚄'))))),
      h('fieldset', {}, h('legend', {}, 'Timing'),
        h('div', { class: 'field-grid' },
          numberField({ id: 'cx-warmup', label: 'Warm-up batches', value: d.warmup, min: 0, max: 50 }),
          numberField({ id: 'cx-runs', label: 'Timed batches', value: d.timingRuns, min: 1, max: 50 }))),
      h('div', { class: 'msg', id: 'cx-errors', role: 'alert', hidden: true }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'submit', id: 'cx-run' }, 'Run analysis'),
        h('button', { class: 'btn', type: 'button', id: 'cx-cancel', disabled: true, onclick: () => this.worker.cancel() }, 'Cancel')));
    this.form.addEventListener('submit', (ev) => { ev.preventDefault(); this.start(); });
    this.#algoChanged();
  }

  #algoChanged() {
    const a = getAlgorithm(document.getElementById('cx-algo').value);
    document.getElementById('cx-theory').textContent = `Theoretical: ${a.complexity.time} time, ${a.complexity.space} space (this implementation). Max ${fmtNum(a.limits.benchmarkNodes)} nodes.`;
    const fam = document.getElementById('cx-family');
    if (a.id === 'topologicalSort' && !['dag', 'tree'].includes(fam.value)) fam.value = 'dag';
    replace(document.getElementById('cx-algo-opts'), a.id === 'astar'
      ? selectField({ id: 'cx-heuristic', label: 'Heuristic', options: opts(HEURISTICS), value: 'calibrated' }) : null);
    this.#metricOptions(a);
  }

  #buildControls() {
    const metric = h('select', { id: 'cx-metric', 'aria-label': 'Chart metric', onchange: (e) => { this.metric = e.target.value; this.#renderChart(); } });
    replace(document.getElementById('cx-chart-controls'),
      h('label', { class: 'field', for: 'cx-metric' }, h('span', { class: 'field-label' }, 'Y axis'), metric),
      checkboxField({ id: 'cx-log', label: 'Log scale', checked: false }),
      checkboxField({ id: 'cx-ref', label: 'Reference curve', checked: true }));
    document.getElementById('cx-log').addEventListener('change', () => this.#renderChart());
    document.getElementById('cx-ref').addEventListener('change', () => this.#renderChart());
  }

  #metricOptions(a) {
    const sel = document.getElementById('cx-metric');
    if (!sel) return;
    fillSelect(sel, [{ value: 'time', label: 'Execution time (ms)' }, ...a.counters.map((c) => ({ value: c.key, label: c.label }))], this.metric);
    this.metric = sel.value;
  }

  prefill(algorithmId) {
    document.getElementById('cx-algo').value = algorithmId;
    this.#algoChanged();
  }

  config() {
    const n = (id, f) => { const v = Number(document.getElementById(id).value); return Number.isFinite(v) ? v : f; };
    const h0 = document.getElementById('cx-heuristic');
    return {
      algorithm: document.getElementById('cx-algo').value,
      options: h0 ? { heuristic: h0.value } : {},
      family: document.getElementById('cx-family').value,
      minN: Math.round(n('cx-min', 50)),
      maxN: Math.round(n('cx-max', 500)),
      stepN: Math.round(n('cx-step', 50)),
      repetitions: Math.round(n('cx-reps', 5)),
      density: n('cx-density', 4),
      densityMode: document.getElementById('cx-dmode').value,
      seed: Math.round(n('cx-seed', 1)),
      weights: { distribution: document.getElementById('cx-dist').value, min: n('cx-wmin', 1), max: n('cx-wmax', 100) },
      warmup: Math.round(n('cx-warmup', 2)),
      timingRuns: Math.round(n('cx-runs', 5)),
      minBatchMs: 2,
    };
  }

  async start() {
    const cfg = this.config();
    const errors = validateComplexityConfig(cfg);
    messageList(document.getElementById('cx-errors'), errors);
    if (errors.length) return;
    const algo = getAlgorithm(cfg.algorithm);
    this.#metricOptions(algo);
    document.getElementById('cx-run').disabled = true;
    document.getElementById('cx-cancel').disabled = false;
    for (const id of ['cx-export-csv', 'cx-export-json', 'cx-save']) document.getElementById(id).disabled = true;
    replace(this.detail);
    const partial = [];
    try {
      const res = await this.worker.run({ cmd: 'complexity', config: cfg }, {
        onProgress: (p) => {
          if (p.last && (!partial.length || partial[partial.length - 1] !== p.last)) partial.push(p.last);
          this.#progress(p);
          if (partial.length) { this.result = analyzeSamples(partial, algo, { config: cfg }); this.#renderChart(); }
        },
      });
      this.result = res;
      this.#progress({ done: res.samples.length, total: res.samples.length, elapsedMs: res.elapsedMs, finished: true, terminatedBy: res.terminatedBy });
      this.#renderAll();
      announce(`Complexity analysis ${res.terminatedBy}: ${res.samples.length} measurements.`);
    } catch (err) {
      if (err.cancelled) toast('Analysis terminated.', 'warn'); else messageList(document.getElementById('cx-errors'), [err.message]);
    } finally {
      document.getElementById('cx-run').disabled = false;
      document.getElementById('cx-cancel').disabled = true;
    }
  }

  #progress(p) {
    const pct = p.total ? (p.done / p.total) * 100 : 0;
    const bar = h('span', {});
    bar.style.width = `${pct.toFixed(1)}%`;
    replace(this.progressHost,
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': p.total, 'aria-valuenow': p.done, 'aria-label': 'Analysis progress' }, bar),
      h('p', { class: 'hint' }, `${p.done} / ${p.total} measurements · ${fmtMs(p.elapsedMs)}${p.terminatedBy ? ` · ${p.terminatedBy}` : ''}`));
  }

  #renderAll() {
    this.#renderChart();
    this.#renderTable();
    for (const id of ['cx-export-csv', 'cx-export-json', 'cx-save']) document.getElementById(id).disabled = !this.result?.samples?.length;
  }

  #renderChart() {
    const r = this.result;
    if (!r?.samples?.length) return;
    const algo = getAlgorithm(r.algorithm);
    const key = this.metric;
    const isTime = key === 'time';
    const val = (s) => (isTime ? s.timeMs : s.ops[key]);
    const med = (row) => (isTime ? row.medianTimeMs : row.ops[key]);
    const label = isTime ? 'Execution time (ms)' : algo.counters.find((c) => c.key === key)?.label ?? key;
    const series = [
      { name: 'Individual measurements', kind: 'scatter', color: 'var(--accent)', points: r.samples.map((s) => ({ x: s.n, y: val(s), meta: { sample: s, extra: `E = ${s.edges}, rep ${s.rep}` } })) },
      { name: 'Median per size', kind: 'line', color: 'var(--ok)', points: r.summary.map((row) => ({ x: row.n, y: med(row) })) },
    ];
    const fit = r.fits?.[key];
    if (document.getElementById('cx-ref').checked && fit && fit.scale > 0) {
      series.push({ name: `Reference c·${algo.complexity.time} (fitted c, R² = ${Number.isFinite(fit.r2) ? fit.r2.toFixed(3) : '—'})`, kind: 'ref', color: 'var(--violet)', points: r.summary.map((row) => ({ x: row.n, y: fit.scale * algo.complexity.fn(row.n, row.edges) })) });
    }
    renderChart(this.chartHost, {
      series,
      xLabel: 'Input size (nodes)',
      yLabel: label,
      logY: document.getElementById('cx-log').checked,
      formatY: isTime ? (v) => fmtMs(v) : undefined,
      onPoint: (p) => this.#detail(p.meta?.sample),
    });
  }

  #detail(s) {
    if (!s) return;
    replace(this.detail, h('div', { class: 'card' },
      h('strong', {}, `Measurement: n = ${s.n}, repetition ${s.rep + 1}`),
      h('dl', { class: 'meta-list' },
        h('dt', {}, 'Edges'), h('dd', {}, fmtNum(s.edges)),
        h('dt', {}, 'Median time'), h('dd', {}, fmtMs(s.timeMs)),
        h('dt', {}, 'Timed samples'), h('dd', {}, s.timeSamples.map((t) => fmtMs(t)).join(', ')),
        h('dt', {}, 'Batch size'), h('dd', {}, String(s.batch)),
        h('dt', {}, 'Status'), h('dd', {}, s.status),
        Object.entries(s.ops).map(([k, v]) => [h('dt', {}, k), h('dd', {}, fmtNum(v))]))));
  }

  #renderTable() {
    const r = this.result;
    const algo = getAlgorithm(r.algorithm);
    const cols = [
      { key: 'n', label: 'Nodes', num: true },
      { key: 'edges', label: 'Edges (median)', num: true },
      { key: 'count', label: 'Runs', num: true },
      { key: 'medianTimeMs', label: 'Median time', num: true, render: (x) => fmtMs(x.medianTimeMs) },
      { key: 'iqrMs', label: 'IQR', num: true, render: (x) => fmtMs(x.iqrMs) },
      { key: 'madMs', label: 'MAD', num: true, render: (x) => fmtMs(x.madMs) },
      ...algo.counters.map((c) => ({ key: c.key, label: c.label, num: true, render: (x) => fmtNum(x.ops[c.key]) })),
    ];
    replace(this.tableHost, dataTable(cols, r.summary));
    this.note.textContent = `${r.disclaimer} Theoretical reference: ${r.theoretical}. Timings use adaptive batching with warm-up; ${r.failures?.length ? `${r.failures.length} inputs failed validation and were skipped.` : 'all inputs were valid.'}`;
  }

  #envelope() {
    const r = this.result;
    return experimentEnvelope({ kind: 'complexity', name: `Complexity ${getAlgorithm(r.algorithm).shortName} n=${r.config.minN}…${r.config.maxN} (seed ${r.config.seed})`, config: r.config, environment: r.environment, result: r });
  }

  #exportCSV() {
    if (!this.result) return;
    downloadText(safeFilename(`complexity-${this.result.algorithm}`, 'csv'), complexityToCSV(this.result), 'text/csv');
  }

  #exportJSON() {
    if (!this.result) return;
    const env = this.#envelope();
    downloadText(safeFilename(env.name, 'json'), JSON.stringify(env, null, 2));
  }

  async #save() { if (this.result) await this.app.actions.saveExperiment(this.#envelope()); }

  showSaved(env) {
    const r = env.result;
    this.result = r;
    document.getElementById('cx-algo').value = r.algorithm;
    this.#algoChanged();
    this.#progress({ done: r.samples.length, total: r.samples.length, elapsedMs: r.elapsedMs, terminatedBy: r.terminatedBy });
    this.#renderAll();
  }
}
