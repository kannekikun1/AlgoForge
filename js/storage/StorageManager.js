/**
 * Storage facade.
 *   - Preferences: LocalStorage (small, synchronous), key "algoforge:prefs".
 *   - Saved graphs and experiments: IndexedDB (falls back to memory if unavailable).
 * Everything stays on this device; nothing is transmitted.
 */
import { IndexedDBAdapter, MemoryAdapter } from './IndexedDBAdapter.js';
import { makeId } from '../experiments/ExperimentSerializer.js';
import { LIMITS } from '../utils/Validation.js';

const PREFS_KEY = 'algoforge:prefs';
const AUTOSAVE_KEY = 'algoforge:autosave';

export const DEFAULT_PREFS = Object.freeze({
  theme: 'dark',
  reducedMotion: 'system', // 'system' | 'reduce' | 'full'
  historyLimit: 20000,
  speed: 8,
  showWeights: true,
  showLabels: true,
  autosave: true,
});

export class StorageManager {
  constructor({ adapter = null, localStorage = globalThis.localStorage } = {}) {
    this.adapter = adapter;
    this.ls = localStorage ?? null;
  }

  async init() {
    if (!this.adapter) {
      try {
        if (!globalThis.indexedDB) throw new Error('IndexedDB unavailable');
        this.adapter = await new IndexedDBAdapter().open();
      } catch {
        this.adapter = await new MemoryAdapter().open();
      }
    } else {
      await this.adapter.open();
    }
    return this;
  }

  get persistent() { return Boolean(this.adapter?.persistent); }

  /* Preferences */
  loadPrefs() {
    try {
      const raw = this.ls?.getItem(PREFS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const out = { ...DEFAULT_PREFS };
      for (const k of Object.keys(DEFAULT_PREFS)) if (typeof parsed[k] === typeof DEFAULT_PREFS[k]) out[k] = parsed[k];
      return out;
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  savePrefs(prefs) {
    try { this.ls?.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* quota or disabled storage */ }
  }

  /* Autosave of the working graph (small; LocalStorage) */
  autosave(payload) {
    try {
      const text = JSON.stringify(payload);
      if (text.length < 2_000_000) this.ls?.setItem(AUTOSAVE_KEY, text);
    } catch { /* ignore */ }
  }

  loadAutosave() {
    try { const raw = this.ls?.getItem(AUTOSAVE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  /* Saved graphs */
  async saveGraph({ id, name, graph, start = null, target = null }) {
    const rec = {
      id: id ?? makeId(),
      name: String(name || 'Untitled graph').slice(0, LIMITS.maxNameLength),
      savedAt: new Date().toISOString(),
      graph,
      start,
      target,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    };
    await this.adapter.put('graphs', rec);
    return rec;
  }

  listGraphs() { return this.adapter.getAll('graphs').then(sortByDate); }
  getGraph(id) { return this.adapter.get('graphs', id); }
  deleteGraph(id) { return this.adapter.delete('graphs', id); }

  /* Saved experiments (stored as their export envelope) */
  async saveExperiment(envelope) {
    const rec = { ...envelope, id: envelope.id ?? makeId(), savedAt: new Date().toISOString() };
    await this.adapter.put('experiments', rec);
    return rec;
  }

  listExperiments() { return this.adapter.getAll('experiments').then(sortByDate); }
  getExperiment(id) { return this.adapter.get('experiments', id); }
  deleteExperiment(id) { return this.adapter.delete('experiments', id); }
}

function sortByDate(list) {
  return [...list].sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}
