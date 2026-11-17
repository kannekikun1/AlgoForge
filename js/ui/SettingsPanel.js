/**
 * Settings dialog: theme, motion, visualization history limit, default speed and display
 * toggles. Preferences persist in LocalStorage.
 */
import { h, replace, fillSelect } from './dom.js';
import { DEFAULT_PREFS } from '../storage/StorageManager.js';

export class SettingsPanel {
  constructor(app) {
    this.app = app;
    this.dialog = document.getElementById('settings-dialog');
    this.body = document.getElementById('settings-body');
    document.getElementById('btn-settings').addEventListener('click', () => this.open());
    document.getElementById('settings-reset').addEventListener('click', () => {
      app.actions.setPrefs({ ...DEFAULT_PREFS });
      this.render();
    });
  }

  open() {
    this.render();
    this.dialog.showModal();
  }

  render() {
    const p = this.app.prefs;
    const set = (patch) => this.app.actions.setPrefs(patch);
    const theme = fillSelect(h('select', { id: 'set-theme', onchange: (e) => set({ theme: e.target.value }) }), [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }], p.theme);
    const motion = fillSelect(h('select', { id: 'set-motion', onchange: (e) => set({ reducedMotion: e.target.value }) }), [
      { value: 'system', label: 'Follow system setting' }, { value: 'reduce', label: 'Reduce motion' }, { value: 'full', label: 'Full motion' }], p.reducedMotion);
    const hist = h('input', { type: 'number', id: 'set-history', min: 100, max: 500000, step: 100, value: p.historyLimit, onchange: (e) => {
      const v = Math.round(Number(e.target.value));
      if (Number.isFinite(v) && v >= 100 && v <= 500000) set({ historyLimit: v }); else e.target.value = String(p.historyLimit);
    } });
    const cb = (id, key, label) => h('label', { class: 'checkbox', for: id }, h('input', { type: 'checkbox', id, checked: p[key], onchange: (e) => set({ [key]: e.target.checked }) }), label);
    replace(this.body,
      h('div', { class: 'field-grid' },
        h('label', { class: 'field', for: 'set-theme' }, h('span', { class: 'field-label' }, 'Theme'), theme),
        h('label', { class: 'field', for: 'set-motion' }, h('span', { class: 'field-label' }, 'Motion'), motion),
        h('label', { class: 'field span-2', for: 'set-history' }, h('span', { class: 'field-label' }, 'Visualization history limit (events per run)'), hist,
          h('span', { class: 'hint' }, 'Longer traces are truncated (the final events are always kept). Higher limits use more memory.'))),
      cb('set-weights', 'showWeights', 'Show edge weights on canvas'),
      cb('set-labels', 'showLabels', 'Show node labels and distance annotations'),
      cb('set-autosave', 'autosave', 'Autosave the working graph in this browser'),
      h('p', { class: 'hint' }, `Storage: ${this.app.storage.persistent ? 'IndexedDB (persistent)' : 'in-memory only (IndexedDB unavailable — saved items are lost on reload)'}. All data stays on this device.`));
  }
}
