/**
 * AlgoForge application bootstrap: creates the stores, editor, renderer, controllers and
 * views, and wires user actions between them. Business logic lives in core/, algorithms/,
 * experiments/ and storage/; this module only coordinates.
 */
import { StateManager } from './core/StateManager.js';
import { ExecutionController } from './core/ExecutionController.js';
import { execute, getAlgorithm } from './core/AlgorithmEngine.js';
import { GraphEditor } from './editor/GraphEditor.js';
import { SelectionManager } from './editor/SelectionManager.js';
import { InputController } from './editor/InputController.js';
import { GraphView } from './rendering/GraphView.js';
import { StorageManager } from './storage/StorageManager.js';
import { parseImport, readFileText, downloadText, graphToJSONText, safeFilename } from './storage/FileManager.js';
import { generateGraph } from './experiments/GraphGenerator.js';
import { Navigation, VIEWS } from './ui/Navigation.js';
import { Sidebar } from './ui/Sidebar.js';
import { StructurePanel } from './ui/StructurePanel.js';
import { DebuggerPanel } from './ui/DebuggerPanel.js';
import { Timeline } from './ui/Timeline.js';
import { SettingsPanel } from './ui/SettingsPanel.js';
import { ThemeManager } from './ui/ThemeManager.js';
import { readGenerator } from './ui/GeneratorForm.js';
import { RaceView } from './ui/views/RaceView.js';
import { DiscoveryView } from './ui/views/DiscoveryView.js';
import { ComplexityView } from './ui/views/ComplexityView.js';
import { SavedView } from './ui/views/SavedView.js';
import { HelpView } from './ui/views/HelpView.js';
import { h, replace, toast, announce, messageList, promptDialog } from './ui/dom.js';
import { LIMITS, sanitizeText } from './utils/Validation.js';

export const SAMPLE_GRAPH = Object.freeze({
  directed: false,
  nodes: [
    { id: 'A', label: 'A', x: 90, y: 260 }, { id: 'B', label: 'B', x: 250, y: 120 }, { id: 'C', label: 'C', x: 260, y: 400 },
    { id: 'D', label: 'D', x: 430, y: 250 }, { id: 'E', label: 'E', x: 600, y: 110 }, { id: 'F', label: 'F', x: 610, y: 400 },
    { id: 'G', label: 'G', x: 780, y: 250 }, { id: 'H', label: 'H', x: 940, y: 260 },
  ],
  edges: [
    ['A', 'B', 4], ['A', 'C', 2], ['B', 'C', 1], ['B', 'D', 5], ['C', 'D', 8], ['C', 'F', 10], ['D', 'E', 3],
    ['D', 'F', 2], ['E', 'G', 1], ['F', 'G', 6], ['E', 'H', 9], ['G', 'H', 2],
  ].map(([s, t, w], i) => ({ id: `e${i + 1}`, source: s, target: t, weight: w, directed: false })),
});

class App {
  async init() {
    this.storage = await new StorageManager().init();
    this.prefs = this.storage.loadPrefs();
    this.theme = new ThemeManager({ onChange: () => this.#themeChanged() });
    this.theme.apply(this.prefs.theme, this.prefs.reducedMotion);

    this.store = new StateManager({ view: 'editor', algorithmId: 'dijkstra', algoOptions: {}, start: null, target: null, tool: 'select' });
    this.editor = new GraphEditor();
    this.selection = new SelectionManager();
    this.execution = null;
    this.ui = { error: (m) => toast(m, 'error') };
    this.actions = this.#actions();

    this.canvas = document.getElementById('graph-canvas');
    this.view = new GraphView(this.canvas, { onViewportChange: () => this.#zoomLabel() });
    this.view.setOptions({ showWeights: this.prefs.showWeights, showLabels: this.prefs.showLabels });
    this.controller = new ExecutionController({ speed: this.prefs.speed });
    this.input = new InputController({
      view: this.view,
      editor: this.editor,
      selection: this.selection,
      getTool: () => this.store.get('tool'),
      getDefaultWeight: () => {
        const v = Number.parseFloat(document.getElementById('default-weight').value);
        return Number.isFinite(v) && Math.abs(v) <= LIMITS.maxAbsWeight ? v : 1;
      },
      onError: (m) => toast(m, 'error'),
      onEditEdge: (id) => { this.selection.set({ type: 'edge', id }); this.nav.go('editor'); setTimeout(() => this.structure.focusWeight(), 0); },
      onViewport: () => this.#zoomLabel(),
    });

    this.sidebar = new Sidebar(this);
    this.structure = new StructurePanel(this);
    this.debugger = new DebuggerPanel(this);
    this.timeline = new Timeline(this.controller, { onSpeed: (s) => this.actions.setPrefs({ speed: s }, { silent: true }) });
    this.timeline.setSpeed(this.prefs.speed);
    this.settings = new SettingsPanel(this);
    this.race = new RaceView(this);
    this.discovery = new DiscoveryView(this);
    this.complexity = new ComplexityView(this);
    this.saved = new SavedView(this);
    this.help = new HelpView();
    this.nav = new Navigation({ onChange: (v, prev) => this.#viewChanged(v, prev) });

    this.#wireEvents();
    this.#buildLegend();
    this.#restore();
    const initial = location.hash.slice(1);
    const first = VIEWS.includes(initial) ? initial : 'editor';
    this.nav.go(first);
    this.#viewChanged(first);
    if (globalThis.matchMedia?.('(max-width: 1080px)').matches) this.#togglePanel('left', false), this.#togglePanel('right', false);
    document.documentElement.dataset.ready = 'true';
  }

  /* ------------------------------------------------------------------ actions */
  #actions() {
    const app = this;
    return {
      selectAlgorithm(id) {
        app.store.set({ algorithmId: id });
        app.sidebar.renderAlgorithm();
        app.#clearExecution();
      },
      setAlgoOption(algoId, key, value) {
        const all = { ...app.store.get('algoOptions') };
        all[algoId] = { ...(all[algoId] ?? {}), [key]: value };
        app.store.set({ algoOptions: all });
        app.sidebar.renderAlgorithm();
        app.#clearExecution();
      },
      setEndpoints(patch) {
        const g = app.editor.graph;
        const next = {};
        for (const k of ['start', 'target']) if (k in patch) next[k] = patch[k] && g.hasNode(patch[k]) ? patch[k] : null;
        app.store.set(next);
        app.view.setOverlay({ start: app.store.get('start'), target: app.store.get('target') });
        app.sidebar.renderNodes();
        app.structure.renderProps();
        app.#clearExecution();
        app.#autosave();
      },
      run({ play = false, toEnd = false } = {}) {
        const algo = getAlgorithm(app.store.get('algorithmId'));
        const opts = { start: app.store.get('start') ?? undefined, target: app.store.get('target') ?? undefined, ...(app.store.get('algoOptions')[algo.id] ?? {}) };
        const run = execute(algo.id, app.editor.graph.toJSON(), opts, { trace: true, historyLimit: app.prefs.historyLimit });
        app.execution = { ...run, algo };
        const errBox = document.getElementById('run-errors');
        if (!run.ok) {
          messageList(errBox, run.errors.map((e) => e.message));
          app.timeline.message(run.errors.map((e) => e.message).join(' '), true);
          app.controller.load(run.events);
          app.controller.toEnd();
          app.nav.go('debugger');
          announce(`Cannot run ${algo.name}: ${run.errors[0].message}`);
          return;
        }
        messageList(errBox, []);
        app.timeline.message(run.truncated ? `Trace truncated to ${run.events.length} events (history limit).` : `${algo.name}: ${run.events.length} events recorded. Result: ${run.result.status}.`);
        app.controller.load(run.events);
        app.nav.go('debugger');
        if (toEnd) app.controller.toEnd();
        else if (play) { app.controller.seek(0); app.controller.play(); } else app.controller.seek(0);
        announce(`${algo.name} ready: ${run.events.length} steps.`);
      },
      setTool(tool) {
        app.store.set({ tool });
        app.input.cancelPending();
        app.canvas.dataset.tool = tool;
        app.sidebar.renderTool(tool);
        app.#status();
      },
      setDirected(d) { app.editor.setDirected(Boolean(d)); },
      undo() { if (!app.editor.undo()) toast('Nothing to undo.'); },
      redo() { if (!app.editor.redo()) toast('Nothing to redo.'); },
      fit() { app.view.autoFit = false; app.view.fit(); },
      resetView() { app.view.resetView(); },
      clearGraph() {
        if (!app.editor.graph.nodeCount) return;
        app.editor.clear();
        toast('Graph cleared. Undo with Ctrl+Z.');
      },
      generate() {
        const p = readGenerator('gen');
        try {
          const r = generateGraph({ ...p, width: 1000, height: 640 }, p.seed);
          app.editor.load(r.graph, { label: 'Generate graph' });
          app.store.set({ start: r.start, target: r.target });
          app.actions.setEndpoints({ start: r.start, target: r.target });
          app.view.autoFit = true;
          app.view.fit();
          announce(`Generated ${r.graph.nodes.length} nodes and ${r.graph.edges.length} edges (seed ${p.seed}).`);
        } catch (err) { toast(err.message, 'error'); }
      },
      goto(view) { app.nav.go(view); },
      loadSample() { app.#loadSample(); },
      sendToDiscovery() { app.discovery.prefill(readGenerator('gen')); app.nav.go('discovery'); },
      sendToComplexity() { app.complexity.prefill(app.store.get('algorithmId')); app.nav.go('complexity'); },
      select(sel) { app.selection.set(sel); },
      updateNode(id, patch) { try { app.editor.updateNode(id, patch); } catch (e) { toast(e.message, 'error'); } },
      updateEdge(id, patch) { try { app.editor.updateEdge(id, patch); } catch (e) { toast(e.message, 'error'); } },
      removeNode(id) { app.editor.removeNode(id); },
      removeEdge(id) { app.editor.removeEdge(id); },
      deleteSelection() {
        const s = app.selection.current;
        if (!s) return;
        if (s.type === 'node') app.editor.removeNode(s.id); else app.editor.removeEdge(s.id);
        app.selection.clear();
      },
      addNodeAuto(label) {
        const vp = app.view.viewport;
        const [cx, cy] = vp.toWorld(app.view.renderer.width / 2, app.view.renderer.height / 2);
        const k = app.editor.graph.nodeCount;
        const ang = k * 2.399963; // golden angle spiral keeps new nodes from stacking
        const r = 30 + 12 * Math.sqrt(k);
        try {
          const n = app.editor.addNode(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, label ? { label } : {});
          app.selection.set({ type: 'node', id: n.id });
          announce(`Added node ${n.label}.`);
        } catch (e) { toast(e.message, 'error'); }
      },
      addEdgeDirect(s, t, w) {
        try {
          const e = app.editor.addEdge(s, t, w);
          app.selection.set({ type: 'edge', id: e.id });
          announce('Edge added.');
        } catch (e) { toast(e.message, 'error'); }
      },
      loadGraphData(graph, { label = 'Load graph' } = {}) {
        app.editor.load(graph, { label });
        app.view.autoFit = true;
        app.view.fit();
      },
      async saveGraph() {
        const name = await promptDialog({ title: 'Save graph', label: 'Name', value: `Graph ${new Date().toLocaleString()}` });
        if (name === null) return;
        try {
          await app.storage.saveGraph({ name: sanitizeText(name, LIMITS.maxNameLength) || 'Untitled graph', graph: app.editor.graph.toJSON(), start: app.store.get('start'), target: app.store.get('target') });
          toast(`Saved “${name}”.`, 'ok');
        } catch (err) { toast(`Could not save: ${err.message}`, 'error'); }
      },
      async saveExperiment(env) {
        const name = await promptDialog({ title: 'Save experiment', label: 'Name', value: env.name });
        if (name === null) return;
        try {
          await app.storage.saveExperiment({ ...env, name: sanitizeText(name, LIMITS.maxNameLength) || env.name });
          toast('Experiment saved. Find it under Saved.', 'ok');
        } catch (err) { toast(`Could not save experiment: ${err.message}`, 'error'); }
      },
      openSavedGraph(rec) {
        app.editor.load(rec.graph, { label: `Open ${rec.name}` });
        app.actions.setEndpoints({ start: rec.start, target: rec.target });
        app.view.autoFit = true;
        app.view.fit();
        app.nav.go('editor');
        toast(`Opened “${rec.name}”.`, 'ok');
      },
      openExperiment(env) {
        try {
          if (env.kind === 'discovery') { app.nav.go('discovery'); app.discovery.showSaved(env); } else if (env.kind === 'complexity') { app.nav.go('complexity'); app.complexity.showSaved(env); } else if (env.kind === 'race') { app.nav.go('race'); app.race.showSaved(env); }
        } catch (err) { toast(`Could not open experiment: ${err.message}`, 'error'); }
      },
      setPrefs(patch, { silent = false } = {}) {
        app.prefs = { ...app.prefs, ...patch };
        app.storage.savePrefs(app.prefs);
        if ('theme' in patch || 'reducedMotion' in patch) app.theme.apply(app.prefs.theme, app.prefs.reducedMotion);
        if ('showWeights' in patch || 'showLabels' in patch) app.view.setOptions({ showWeights: app.prefs.showWeights, showLabels: app.prefs.showLabels });
        if ('speed' in patch && !silent) app.timeline.setSpeed(app.prefs.speed);
      },
      async importFile(file) {
        try {
          const text = await readFileText(file);
          const r = parseImport(text);
          if (!r.ok) { toast(`Import failed: ${r.errors.slice(0, 3).join(' ')}`, 'error', 8000); return; }
          if (r.kind === 'graph') {
            app.editor.load(r.graph, { label: 'Import graph' });
            app.actions.setEndpoints({ start: r.meta.start, target: r.meta.target });
            app.view.autoFit = true;
            app.view.fit();
            app.nav.go('editor');
            toast(`Imported ${r.graph.nodes.length} nodes, ${r.graph.edges.length} edges.${r.warnings.length ? ` Note: ${r.warnings.join(' ')}` : ''}`, r.warnings.length ? 'warn' : 'ok', 7000);
          } else {
            app.actions.openExperiment(r.experiment);
            toast(`Imported ${r.experiment.kind} experiment “${r.experiment.name}”.`, 'ok');
          }
        } catch (err) { toast(`Import failed: ${err.message}`, 'error'); }
      },
      exportGraph() {
        const text = graphToJSONText(app.editor.graph.toJSON(), { name: 'AlgoForge graph', start: app.store.get('start'), target: app.store.get('target') });
        downloadText(safeFilename(`algoforge-graph-${new Date().toISOString().slice(0, 10)}`, 'json'), text);
      },
    };
  }

  /* ------------------------------------------------------------------ wiring */
  #wireEvents() {
    this.editor.on('change', ({ kind }) => this.#graphChanged(kind));
    this.selection.on('change', (sel) => {
      this.view.setOverlay({ selection: sel });
      this.structure.renderProps();
      if (this.editor.graph.nodeCount <= 400) this.structure.renderStructure();
    });
    this.controller.on('change', ({ state }) => {
      this.view.setVisual(state);
      this.#scheduleDebugger();
    });

    document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-import').click());
    document.getElementById('file-import').addEventListener('change', (ev) => {
      const f = ev.target.files?.[0];
      if (f) this.actions.importFile(f);
      ev.target.value = '';
    });
    document.getElementById('btn-export').addEventListener('click', () => this.actions.exportGraph());
    document.getElementById('btn-save').addEventListener('click', () => this.actions.saveGraph());
    document.getElementById('btn-theme').addEventListener('click', () => this.actions.setPrefs({ theme: this.theme.toggle() }));
    document.getElementById('btn-zoom-in').addEventListener('click', () => { this.view.zoomBy(1.25); });
    document.getElementById('btn-zoom-out').addEventListener('click', () => { this.view.zoomBy(0.8); });
    document.getElementById('btn-sample').addEventListener('click', () => this.#loadSample());
    document.getElementById('toggle-left').addEventListener('click', () => this.#togglePanel('left'));
    document.getElementById('toggle-right').addEventListener('click', () => this.#togglePanel('right'));
    // On narrow screens the sidebars are overlay drawers: touching the canvas closes them.
    this.canvas.addEventListener('pointerdown', () => this.#closeDrawers(), true);

    // Drag & drop import onto the canvas.
    const area = document.getElementById('canvas-area');
    area.addEventListener('dragover', (ev) => { ev.preventDefault(); });
    area.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const f = ev.dataTransfer?.files?.[0];
      if (f) this.actions.importFile(f);
    });

    document.addEventListener('keydown', (ev) => this.#keydown(ev));
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => this.theme.apply(this.prefs.theme, this.prefs.reducedMotion));
  }

  #keydown(ev) {
    const t = ev.target;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
    if (document.querySelector('dialog[open]')) return;
    const inWorkspace = !document.getElementById('view-workspace').hidden;
    if (!inWorkspace) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const key = ev.key;
    const A = this.actions;
    const sel = this.selection.current;
    const consume = () => ev.preventDefault();

    if (mod && (key === 'z' || key === 'Z')) { consume(); if (ev.shiftKey) A.redo(); else A.undo(); return; }
    if (mod && (key === 'y' || key === 'Y')) { consume(); A.redo(); return; }
    if (mod || (ev.altKey && !key.startsWith('Arrow'))) return;

    if (ev.altKey && key.startsWith('Arrow') && sel?.type === 'node') {
      consume();
      const n = this.editor.graph.getNode(sel.id);
      const d = ev.shiftKey ? 1 : 10;
      const dx = key === 'ArrowLeft' ? -d : key === 'ArrowRight' ? d : 0;
      const dy = key === 'ArrowUp' ? -d : key === 'ArrowDown' ? d : 0;
      this.editor.beginMove();
      this.editor.moveNode(n.id, n.x + dx, n.y + dy);
      return;
    }
    switch (key) {
      case 'v': case 'V': A.setTool('select'); break;
      case 'n': case 'N': A.setTool('node'); break;
      case 'e': case 'E': A.setTool('edge'); break;
      case 'd': case 'D': A.setTool('delete'); break;
      case 'Delete': case 'Backspace': if (sel) { consume(); A.deleteSelection(); } break;
      case 'f': case 'F': A.fit(); break;
      case '0': A.resetView(); break;
      case '+': case '=': this.view.zoomBy(1.25); break;
      case '-': case '_': this.view.zoomBy(0.8); break;
      case 's': case 'S': if (sel?.type === 'node') A.setEndpoints({ start: sel.id }); break;
      case 't': case 'T': if (sel?.type === 'node') A.setEndpoints({ target: sel.id }); break;
      case 'r': case 'R': A.run({ play: true }); break;
      case 'Escape': this.input.cancelPending(); this.selection.clear(); this.#closeDrawers(); break;
      case ' ':
        if (tag === 'BUTTON') return;
        if (this.controller.length) { consume(); this.controller.toggle(); }
        break;
      case 'ArrowRight': if (this.controller.length) { consume(); this.controller.stepForward(); } break;
      case 'ArrowLeft': if (this.controller.length) { consume(); this.controller.stepBackward(); } break;
      case 'Home': if (this.controller.length) { consume(); this.controller.pause(); this.controller.seek(-1); } break;
      case 'End': if (this.controller.length) { consume(); this.controller.toEnd(); } break;
      default: break;
    }
  }

  #graphChanged(kind) {
    if (kind === 'load') this.view.setGraph(this.editor.graph);
    else if (kind === 'structure') this.view.invalidate();
    else this.view.requestRender();

    if (kind === 'position') {
      this.structure.updateNodePosition(this.selection.current?.id);
      if (this.execution?.algo?.id === 'astar') this.#clearExecution('Node moved — A* heuristic depends on positions; trace cleared.');
      this.#autosave();
      return;
    }
    this.selection.prune(this.editor.graph);
    const g = this.editor.graph;
    const patch = {};
    if (this.store.get('start') && !g.hasNode(this.store.get('start'))) patch.start = null;
    if (this.store.get('target') && !g.hasNode(this.store.get('target'))) patch.target = null;
    this.store.set(patch);
    this.view.setOverlay({ start: this.store.get('start'), target: this.store.get('target') });
    this.sidebar.renderNodes();
    this.sidebar.renderHistory();
    this.structure.renderAll();
    this.#clearExecution(this.execution ? 'Graph changed — previous trace cleared.' : null);
    document.getElementById('empty-hint').hidden = g.nodeCount > 0;
    this.#status();
    this.#autosave();
  }

  #clearExecution(message = null) {
    if (!this.execution && !this.controller.length) return;
    this.controller.clear();
    this.execution = null;
    this.view.setVisual(null);
    messageList(document.getElementById('run-errors'), []);
    this.timeline.message(message ?? '');
    this.#scheduleDebugger();
  }

  #scheduleDebugger() {
    if (this.debugPending) return;
    this.debugPending = true;
    requestAnimationFrame(() => {
      this.debugPending = false;
      this.debugger.render();
      this.#status();
    });
  }

  #viewChanged(view) {
    this.store.set({ view });
    if (view !== 'debugger' && view !== 'editor') this.controller.pause();
    if (view === 'editor' || view === 'debugger') {
      document.getElementById('legend').hidden = view !== 'debugger';
      requestAnimationFrame(() => { this.view.renderer.resize(); this.view.requestRender(); });
      if (view === 'debugger') this.debugger.render();
    }
    if (view === 'race') this.race.refreshGraph();
    if (view === 'saved') this.saved.render();
    if (view === 'help') this.help.render();
  }

  #togglePanel(side, open) {
    const ws = document.getElementById('view-workspace');
    const cls = `${side}-collapsed`;
    const willOpen = open ?? ws.classList.contains(cls);
    ws.classList.toggle(cls, !willOpen);
    document.getElementById(`toggle-${side}`).setAttribute('aria-expanded', String(willOpen));
    setTimeout(() => { this.view.renderer.resize(); this.view.requestRender(); }, 220);
  }

  #closeDrawers() {
    if (!globalThis.matchMedia?.('(max-width: 1080px)').matches) return;
    const ws = document.getElementById('view-workspace');
    if (!ws.classList.contains('left-collapsed')) this.#togglePanel('left', false);
    if (!ws.classList.contains('right-collapsed')) this.#togglePanel('right', false);
  }

  #status() {
    const g = this.editor.graph;
    const tool = this.store.get('tool');
    const hints = { select: 'drag to move · double-click to add', node: 'click to add nodes', edge: this.input.pendingSource ? 'click target node' : 'click source node', delete: 'click to delete' };
    const run = this.execution;
    const step = run?.ok ? ` · step ${this.controller.index + 1}/${this.controller.length}` : '';
    document.getElementById('canvas-status').textContent = `${g.nodeCount} nodes · ${g.edgeCount} edges · ${g.directed ? 'directed' : 'undirected'} · ${tool}: ${hints[tool]}${step}`;
  }

  #zoomLabel() {
    document.getElementById('zoom-level').textContent = `${Math.round(this.view.viewport.scale * 100)}%`;
  }

  #themeChanged() {
    this.view?.refreshColors();
    this.race?.onThemeChange();
    this.discovery?.onThemeChange();
    this.#buildLegend();
  }

  #buildLegend() {
    const host = document.getElementById('legend');
    if (!host) return;
    const s = (tag, attrs) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) {
        if ((k === 'fill' || k === 'stroke') && String(v).startsWith('var(')) el.style[k] = v; else el.setAttribute(k, v);
      }
      return el;
    };
    const icon = (...kids) => { const g = s('svg', { viewBox: '0 0 18 14', 'aria-hidden': 'true' }); g.append(...kids); return g; };
    const node = (attrs) => icon(s('circle', { cx: 9, cy: 7, r: 5.5, fill: 'var(--g-node)', 'stroke-width': 1.8, ...attrs }));
    const edge = (attrs) => icon(s('line', { x1: 1, y1: 7, x2: 17, y2: 7, ...attrs }));
    replace(host,
      h('span', {}, node({ stroke: 'var(--g-discovered)', 'stroke-dasharray': '2 1.5' }), 'Discovered'),
      h('span', {}, node({ stroke: 'var(--g-visited)', 'stroke-width': 2.4 }), 'Visited'),
      h('span', {}, node({ stroke: 'var(--g-visited)', fill: 'var(--g-finalized)' }), 'Finalized'),
      h('span', {}, icon(s('circle', { cx: 9, cy: 7, r: 6.5, fill: 'none', stroke: 'var(--g-current)', 'stroke-width': 1.5 }), s('circle', { cx: 9, cy: 7, r: 4, fill: 'var(--g-node)', stroke: 'var(--g-node-stroke)' })), 'Current'),
      h('span', {}, edge({ stroke: 'var(--g-examined)', 'stroke-width': 2, 'stroke-dasharray': '3 2' }), 'Examined'),
      h('span', {}, edge({ stroke: 'var(--g-tree)', 'stroke-width': 3 }), 'Tree / relaxed'),
      h('span', {}, edge({ stroke: 'var(--g-rejected)', 'stroke-width': 2, 'stroke-dasharray': '1 2' }), 'Rejected'),
      h('span', {}, edge({ stroke: 'var(--g-path)', 'stroke-width': 4 }), 'Path'),
      h('span', {}, node({ stroke: 'var(--g-error)', 'stroke-width': 2.4 }), 'Cycle / error'));
  }

  #autosave() {
    if (!this.prefs.autosave) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.storage.autosave({ graph: this.editor.graph.toJSON(), start: this.store.get('start'), target: this.store.get('target'), algorithmId: this.store.get('algorithmId') });
    }, 600);
  }

  #restore() {
    const saved = this.prefs.autosave ? this.storage.loadAutosave() : null;
    let restored = false;
    if (saved?.graph) {
      const r = parseImport(JSON.stringify({ schemaVersion: 1, application: 'AlgoForge', graph: saved.graph }));
      if (r.ok) {
        this.editor.load(r.graph, { resetHistory: true, label: 'Restore' });
        this.actions.setEndpoints({ start: saved.start, target: saved.target });
        try { if (saved.algorithmId) this.actions.selectAlgorithm(getAlgorithm(saved.algorithmId).id); } catch { /* unknown id */ }
        restored = true;
      }
    }
    if (!restored) this.#loadSample(true);
    this.view.autoFit = true;
    this.view.fit();
    this.actions.setTool('select');
    this.sidebar.renderHistory();
  }

  #loadSample(reset = false) {
    this.editor.load(JSON.parse(JSON.stringify(SAMPLE_GRAPH)), { resetHistory: reset, label: 'Load sample graph' });
    this.actions.setEndpoints({ start: 'A', target: 'H' });
    this.view.autoFit = true;
    this.view.fit();
  }
}

const app = new App();
app.init().catch((err) => {
  console.error(err);
  const main = document.getElementById('main');
  main.prepend(h('div', { class: 'msg msg-error', role: 'alert' }, `AlgoForge failed to start: ${err.message}`));
});
globalThis.__algoforge = app; // exposed for debugging and end-to-end tests
