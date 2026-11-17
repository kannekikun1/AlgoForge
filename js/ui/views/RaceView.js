/**
 * Algorithm Race view: side-by-side traced execution (synchronized or independent
 * animation) and a worker-based benchmark mode with repeated, interleaved samples.
 */
import { h, replace, fillSelect, dataTable, fmtNum, fmtMs, messageList, toast, announce } from '../dom.js';
import { GraphView } from '../../rendering/GraphView.js';
import { ExecutionController } from '../../core/ExecutionController.js';
import { listAlgorithms, getAlgorithm, sharedProblems } from '../../core/AlgorithmEngine.js';
import { prepareRace, syncIndices, syncLength, comparisonRows, validateRace, RACE_MODES, STEP_POLICIES, raceRecord } from '../../experiments/AlgorithmRace.js';
import { experimentEnvelope } from '../../experiments/ExperimentSerializer.js';
import { WorkerClient } from '../../experiments/WorkerClient.js';
import { describeEvent } from '../../core/VisualState.js';
import { speedFromSlider, sliderFromSpeed } from '../Timeline.js';
import { HEURISTICS } from '../../algorithms/astar.js';
import { downloadText, safeFilename } from '../../storage/FileManager.js';
import { toExportEnvelope } from '../../core/Graph.js';

export class RaceView {
  constructor(app) {
    this.app = app;
    this.form = document.getElementById('race-form');
    this.arena = document.getElementById('race-arena');
    this.transport = document.getElementById('race-transport');
    this.metrics = document.getElementById('race-metrics');
    this.note = document.getElementById('race-note');
    this.errors = document.getElementById('race-errors');
    this.worker = new WorkerClient(new URL('../../workers/benchmark.worker.js', import.meta.url));
    this.sides = null;
    this.record = null;
    this.tick = 0;
    this.syncTimer = null;
    this.#buildForm();
    this.#buildArena();
    document.getElementById('race-export').addEventListener('click', () => this.#export());
    document.getElementById('race-save').addEventListener('click', () => this.#save());
  }

  #buildForm() {
    const algos = listAlgorithms();
    const selA = h('select', { id: 'race-a', onchange: () => this.#filterB() });
    fillSelect(selA, algos.map((a) => ({ value: a.id, label: a.shortName, group: a.category })), 'dijkstra');
    const selB = h('select', { id: 'race-b', onchange: () => this.#renderOptions() });
    const mode = fillSelect(h('select', { id: 'race-mode', onchange: () => this.#modeChanged() }), Object.entries(RACE_MODES).map(([value, label]) => ({ value, label })), 'synchronized');
    const policy = fillSelect(h('select', { id: 'race-policy' }), Object.entries(STEP_POLICIES).map(([value, label]) => ({ value, label })), 'event');
    replace(this.form,
      h('label', { class: 'field', for: 'race-a' }, h('span', { class: 'field-label' }, 'Algorithm A'), selA),
      h('label', { class: 'field', for: 'race-b' }, h('span', { class: 'field-label' }, 'Algorithm B (compatible)'), selB),
      h('div', { id: 'race-options', class: 'btn-row' }),
      h('label', { class: 'field', for: 'race-mode' }, h('span', { class: 'field-label' }, 'Mode'), mode),
      h('label', { class: 'field', for: 'race-policy', id: 'race-policy-wrap' }, h('span', { class: 'field-label' }, 'Step policy'), policy),
      h('label', { class: 'field', for: 'race-runs', id: 'race-runs-wrap', hidden: true }, h('span', { class: 'field-label' }, 'Measured runs'), h('input', { type: 'number', id: 'race-runs', value: 21, min: 3, max: 500 })),
      h('label', { class: 'field', for: 'race-warmup', id: 'race-warmup-wrap', hidden: true }, h('span', { class: 'field-label' }, 'Warm-up runs'), h('input', { type: 'number', id: 'race-warmup', value: 5, min: 0, max: 100 })),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'submit', id: 'race-run' }, 'Start race'),
        h('button', { class: 'btn', type: 'button', id: 'race-cancel', hidden: true, onclick: () => this.worker.cancel(200) }, 'Cancel')));
    this.form.addEventListener('submit', (ev) => { ev.preventDefault(); this.start(); });
    this.#filterB('astar');
  }

  #filterB(preferred) {
    const a = document.getElementById('race-a').value;
    const selB = document.getElementById('race-b');
    const cur = preferred ?? selB.value;
    const options = listAlgorithms().filter((b) => b.id !== a && sharedProblems(a, b.id).length).map((b) => ({ value: b.id, label: b.shortName, group: b.category }));
    // A* vs A* with different heuristics is also a meaningful race.
    if (a === 'astar') options.unshift({ value: 'astar', label: 'A* (other heuristic)' });
    fillSelect(selB, options, options.some((o) => o.value === cur) ? cur : options[0]?.value);
    this.#renderOptions();
  }

  #renderOptions() {
    const host = document.getElementById('race-options');
    const fields = [];
    for (const side of ['a', 'b']) {
      const id = document.getElementById(`race-${side}`).value;
      if (id === 'astar') {
        const sel = fillSelect(h('select', { id: `race-${side}-heuristic` }), Object.entries(HEURISTICS).map(([value, label]) => ({ value, label })), side === 'b' && document.getElementById('race-a').value === 'astar' ? 'zero' : 'calibrated');
        fields.push(h('label', { class: 'field', for: `race-${side}-heuristic` }, h('span', { class: 'field-label' }, `${side.toUpperCase()}: heuristic`), sel));
      }
    }
    replace(host, fields);
  }

  #modeChanged() {
    const mode = document.getElementById('race-mode').value;
    document.getElementById('race-policy-wrap').hidden = mode !== 'synchronized';
    document.getElementById('race-runs-wrap').hidden = mode !== 'benchmark';
    document.getElementById('race-warmup-wrap').hidden = mode !== 'benchmark';
  }

  #buildArena() {
    const mk = (side) => {
      const canvas = h('canvas', { role: 'img', 'aria-label': `Algorithm ${side} visualization` });
      const title = h('div', { class: 'mini-title' }, h('span', { class: 'badge badge-accent' }, side), h('span', { id: `race-${side}-name` }, '—'));
      const step = h('span', { class: 'mini-step', id: `race-${side}-step` }, '');
      const foot = h('div', { class: 'mini-foot', id: `race-${side}-foot`, 'aria-live': 'polite' });
      const panel = h('div', { class: 'mini-graph' }, h('div', { class: 'mini-head' }, title, step), canvas, foot);
      return { panel, canvas };
    };
    const A = mk('A'); const B = mk('B');
    replace(this.arena, A.panel, B.panel);
    this.viewA = new GraphView(A.canvas, { panZoom: true });
    this.viewB = new GraphView(B.canvas, { panZoom: true });
  }

  /** Called when the view becomes visible or the workspace graph changes. */
  refreshGraph() {
    const g = this.app.editor.graph.toJSON();
    for (const v of [this.viewA, this.viewB]) {
      v.setGraph(g);
      v.autoFit = true;
      v.fit();
      v.setOverlay({ start: this.app.store.get('start'), target: this.app.store.get('target') });
      v.setOptions({ showWeights: this.app.prefs.showWeights, showLabels: this.app.prefs.showLabels });
    }
  }

  onThemeChange() { this.viewA.refreshColors(); this.viewB.refreshColors(); }

  #specs() {
    const store = this.app.store;
    const base = { start: store.get('start') ?? undefined, target: store.get('target') ?? undefined };
    const spec = (side) => {
      const id = document.getElementById(`race-${side}`).value;
      const options = { ...base };
      const hs = document.getElementById(`race-${side}-heuristic`);
      if (hs) options.heuristic = hs.value;
      return { id, options };
    };
    return [spec('a'), spec('b')];
  }

  start() {
    this.#stopSides();
    const [a, b] = this.#specs();
    const graph = this.app.editor.graph.toJSON();
    const errors = validateRace(a.id, b.id, graph);
    if (a.id === b.id && JSON.stringify(a.options) === JSON.stringify(b.options)) errors.push('Choose different algorithms or options for A and B.');
    messageList(this.errors, errors);
    if (errors.length) return;
    this.refreshGraph();
    const mode = document.getElementById('race-mode').value;
    const { runA, runB } = prepareRace(a, b, graph, { historyLimit: this.app.prefs.historyLimit });
    const errs = [];
    if (!runA.ok) errs.push(`A (${getAlgorithm(a.id).shortName}): ${runA.errors.map((e) => e.message).join(' ')}`);
    if (!runB.ok) errs.push(`B (${getAlgorithm(b.id).shortName}): ${runB.errors.map((e) => e.message).join(' ')}`);
    messageList(this.errors, errs);
    if (errs.length) return;
    document.getElementById('race-A-name').textContent = labelFor(a);
    document.getElementById('race-B-name').textContent = labelFor(b);
    this.specs = { a, b, graph, mode, policy: document.getElementById('race-policy').value };
    this.runs = { runA, runB };
    this.record = raceRecord({ a, b, graph, mode, policy: this.specs.policy, resultA: runA.result, resultB: runB.result });
    this.#renderMetrics(null);

    if (mode === 'benchmark') {
      this.#showFinal();
      this.#benchmark(a, b, graph);
      return;
    }
    const ctlA = new ExecutionController({ speed: 8 });
    const ctlB = new ExecutionController({ speed: 8 });
    ctlA.load(runA.events);
    ctlB.load(runB.events);
    this.sides = { A: { ctl: ctlA, view: this.viewA, run: runA }, B: { ctl: ctlB, view: this.viewB, run: runB } };
    for (const [k, s] of Object.entries(this.sides)) {
      s.ctl.on('change', ({ state, event }) => {
        s.view.setVisual(state);
        document.getElementById(`race-${k}-step`).textContent = `step ${s.ctl.index + 1} / ${s.ctl.length}`;
        const foot = document.getElementById(`race-${k}-foot`);
        const labelOf = (id) => this.app.editor.graph.getNode(id)?.label ?? id;
        foot.textContent = event ? describeEvent(event, labelOf) : 'Ready.';
      });
      s.ctl.seek(-1);
      s.ctl.seek(0);
    }
    this.#buildTransport(mode);
    announce('Race ready. Press play.');
  }

  #buildTransport(mode) {
    const btn = (label, fn, aria) => h('button', { class: 'btn btn-sm', type: 'button', onclick: fn, 'aria-label': aria ?? label }, label);
    const { A, B } = this.sides;
    if (mode === 'independent') {
      const speedCtl = (side, s) => {
        const range = h('input', { type: 'range', min: 0, max: 100, value: sliderFromSpeed(8), 'aria-label': `Speed of ${side}`, oninput: (e) => s.ctl.setSpeed(speedFromSlider(Number(e.target.value))) });
        return h('label', { class: 'speed' }, h('span', { class: 'field-label' }, `${side} speed`), range);
      };
      replace(this.transport,
        btn('▶ Play both', () => { A.ctl.play(); B.ctl.play(); }, 'Play both'),
        btn('❚❚ Pause', () => { A.ctl.pause(); B.ctl.pause(); }, 'Pause both'),
        btn('⟲ Restart', () => { A.ctl.restart(); B.ctl.restart(); }, 'Restart both'),
        btn('⇥ End', () => { A.ctl.toEnd(); B.ctl.toEnd(); this.#showFinal(); }, 'Jump to end'),
        speedCtl('A', A), speedCtl('B', B));
      const done = () => { if (A.ctl.atEnd && B.ctl.atEnd) this.#showFinal(); };
      A.ctl.on('end', done); B.ctl.on('end', done);
      return;
    }
    // Synchronized
    const len = syncLength(A.ctl.length, B.ctl.length);
    const range = h('input', { type: 'range', min: 0, max: Math.max(0, len - 1), value: 0, id: 'race-tick', 'aria-label': 'Synchronized timeline' });
    const label = h('span', { class: 'timeline-label mono' }, '');
    const set = (t) => {
      this.tick = Math.max(0, Math.min(len - 1, t));
      const [ia, ib] = syncIndices(this.tick, A.ctl.length, B.ctl.length, this.specs.policy);
      A.ctl.seek(ia); B.ctl.seek(ib);
      range.value = String(this.tick);
      label.textContent = `tick ${this.tick + 1} / ${len}`;
      if (this.tick >= len - 1) { this.#pauseSync(); this.#showFinal(); }
    };
    range.addEventListener('input', () => { this.#pauseSync(); set(Number(range.value)); });
    let speed = 8;
    const speedRange = h('input', { type: 'range', min: 0, max: 100, value: sliderFromSpeed(8), 'aria-label': 'Speed', oninput: (e) => { speed = speedFromSlider(Number(e.target.value)); } });
    const playBtn = btn('▶ Play', () => {
      if (this.syncTimer) { this.#pauseSync(); return; }
      if (this.tick >= len - 1) set(0);
      let last = performance.now(); let acc = 0;
      playBtn.textContent = '❚❚ Pause';
      const frame = (t) => {
        if (!this.syncTimer) return;
        acc += ((t - last) / 1000) * speed; last = t;
        const k = Math.floor(acc);
        if (k > 0) { acc -= k; set(this.tick + k); }
        if (this.syncTimer) this.syncTimer = requestAnimationFrame(frame);
      };
      this.syncTimer = requestAnimationFrame(frame);
    }, 'Play or pause');
    this.playBtn = playBtn;
    replace(this.transport,
      btn('⟲', () => { this.#pauseSync(); set(0); }, 'Restart'),
      btn('◀', () => { this.#pauseSync(); set(this.tick - 1); }, 'Step back'),
      playBtn,
      btn('▶|', () => { this.#pauseSync(); set(this.tick + 1); }, 'Step forward'),
      btn('⇥', () => { this.#pauseSync(); set(len - 1); }, 'Jump to end'),
      h('div', { class: 'timeline' }, range, label),
      h('label', { class: 'speed' }, h('span', { class: 'field-label' }, 'Speed'), speedRange));
    set(0);
  }

  #pauseSync() {
    if (this.syncTimer) cancelAnimationFrame(this.syncTimer);
    this.syncTimer = null;
    if (this.playBtn) this.playBtn.textContent = '▶ Play';
  }

  #stopSides() {
    this.#pauseSync();
    if (this.sides) for (const s of Object.values(this.sides)) s.ctl.pause();
    this.sides = null;
    replace(this.transport);
  }

  #showFinal() {
    const { runA, runB } = this.runs;
    // Final visual state on both panels.
    for (const [view, run] of [[this.viewA, runA], [this.viewB, runB]]) {
      const c = new ExecutionController();
      c.load(run.events);
      c.seek(run.events.length - 1);
      view.setVisual(c.state);
    }
    this.#renderMetrics(this.record.benchmark);
  }

  async #benchmark(a, b, graph) {
    const runs = Math.max(3, Math.min(500, Number(document.getElementById('race-runs').value) || 21));
    const warmup = Math.max(0, Math.min(100, Number(document.getElementById('race-warmup').value) || 5));
    const runBtn = document.getElementById('race-run');
    const cancel = document.getElementById('race-cancel');
    runBtn.disabled = true; cancel.hidden = false;
    replace(this.transport, h('span', { class: 'hint' }, `Benchmarking in a background worker: ${warmup} warm-up + ${runs} measured runs each, interleaved A/B…`));
    try {
      const res = await this.worker.run({ cmd: 'race', a, b, graph, config: { runs, warmup } });
      if (!res.ok) throw new Error([...(res.errorsA ?? []), ...(res.errorsB ?? [])].map((e) => e.message).join(' '));
      this.record.benchmark = res;
      this.record.rows = comparisonRows({ result: this.runs.runA.result, timeMs: res.a.stats.median }, { result: this.runs.runB.result, timeMs: res.b.stats.median });
      replace(this.transport, h('span', { class: 'hint' }, `Benchmark complete — ${runs} samples per algorithm (batch sizes ${res.a.batch} / ${res.b.batch}). Timer resolution ≈ ${fmtMs(res.environment.timerResolutionMs)}.`));
      this.#renderMetrics(res);
      announce('Benchmark complete.');
    } catch (err) {
      replace(this.transport);
      if (!err.cancelled) messageList(this.errors, [err.message]); else toast('Benchmark cancelled.');
    } finally {
      runBtn.disabled = false; cancel.hidden = true;
    }
  }

  #renderMetrics(bench) {
    const { runA, runB } = this.runs;
    const rows = comparisonRows({ result: runA.result, timeMs: bench?.a?.stats?.median ?? null }, { result: runB.result, timeMs: bench?.b?.stats?.median ?? null });
    const fmt = (row, v) => (row.key === 'timeMs' ? (v === null ? 'benchmark mode only' : fmtMs(v)) : row.key === 'status' ? v : fmtNum(v));
    const cell = (row, side) => {
      const v = side === 'A' ? row.a : row.b;
      const def = side === 'A' ? row.definitionA : row.definitionB;
      return h('span', { class: row.winner === side ? 'winner' : '', title: def ?? '' }, fmt(row, v));
    };
    const extra = bench ? [
      { label: 'Timing dispersion (IQR)', a: fmtMs(bench.a.stats.iqr), b: fmtMs(bench.b.stats.iqr) },
      { label: 'Min / max sample', a: `${fmtMs(bench.a.stats.min)} / ${fmtMs(bench.a.stats.max)}`, b: `${fmtMs(bench.b.stats.min)} / ${fmtMs(bench.b.stats.max)}` },
    ] : [];
    replace(this.metrics, dataTable(
      [{ key: 'label', label: 'Metric' }, { key: 'a', label: `A · ${labelFor(this.specs.a)}`, num: true, render: (r) => (r.key ? cell(r, 'A') : r.a) }, { key: 'b', label: `B · ${labelFor(this.specs.b)}`, num: true, render: (r) => (r.key ? cell(r, 'B') : r.b) }],
      [...rows, ...extra]));
    this.note.textContent = 'Lower is marked ◂ where lower is better. Hover a counter to see that algorithm’s definition — operation counts are algorithm-specific and not universally equivalent. Times are median browser measurements (rendering excluded); they vary by device and run.';
    document.getElementById('race-export').disabled = false;
    document.getElementById('race-save').disabled = false;
  }

  #envelope() {
    const rec = this.record;
    return experimentEnvelope({
      kind: 'race',
      name: `Race ${labelFor(this.specs.a)} vs ${labelFor(this.specs.b)}`,
      config: { algorithms: rec.algorithms, mode: rec.mode, policy: rec.policy },
      environment: rec.benchmark?.environment ?? {},
      graph: toExportEnvelope(rec.graph).graph,
      result: { resultA: rec.resultA, resultB: rec.resultB, benchmark: rec.benchmark, rows: comparisonRows({ result: rec.resultA, timeMs: rec.benchmark?.a?.stats?.median ?? null }, { result: rec.resultB, timeMs: rec.benchmark?.b?.stats?.median ?? null }), note: rec.note },
    });
  }

  #export() {
    if (!this.record) return;
    const env = this.#envelope();
    downloadText(safeFilename(env.name, 'json'), JSON.stringify(env, null, 2));
  }

  async #save() {
    if (!this.record) return;
    await this.app.actions.saveExperiment(this.#envelope());
  }

  /** Pre-select algorithms (e.g. from Discovery Mode). */
  preset(A, B) {
    document.getElementById('race-a').value = A.id;
    this.#filterB(B.id);
    for (const [side, spec] of [['a', A], ['b', B]]) {
      const el = document.getElementById(`race-${side}-heuristic`);
      if (el && spec.options?.heuristic) el.value = spec.options.heuristic;
    }
    this.refreshGraph();
  }

  /** Load a saved race experiment for display. */
  showSaved(env) {
    this.app.actions.loadGraphData(env.graph, { label: 'Load race graph' });
    const A = env.config.algorithms.A; const B = env.config.algorithms.B;
    document.getElementById('race-a').value = A.id;
    this.#filterB(B.id);
    document.getElementById('race-mode').value = env.config.mode === 'benchmark' ? 'synchronized' : env.config.mode;
    this.#modeChanged();
    this.app.store.set({ start: A.options.start ?? null, target: A.options.target ?? null });
    this.start();
    toast('Race re-executed on the saved graph. Saved benchmark timings are in the exported JSON.', 'info');
  }
}

function labelFor(spec) {
  const a = getAlgorithm(spec.id);
  if (spec.id === 'astar' && spec.options?.heuristic && spec.options.heuristic !== 'calibrated') return `A* (${spec.options.heuristic})`;
  return a.shortName;
}
