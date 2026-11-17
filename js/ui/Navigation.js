/**
 * Workspace selector (ARIA tabs + compact <select> on small screens).
 * Editor and Debugger share the workspace panel; other views have their own panels.
 */
import { $$ } from './dom.js';

export const VIEWS = ['editor', 'debugger', 'race', 'discovery', 'complexity', 'saved', 'help'];
const PANEL_FOR = { editor: 'view-workspace', debugger: 'view-workspace', race: 'view-race', discovery: 'view-discovery', complexity: 'view-complexity', saved: 'view-saved', help: 'view-help' };

export class Navigation {
  constructor({ onChange }) {
    this.onChange = onChange;
    this.tabs = $$('#view-tabs [role="tab"]');
    this.select = document.getElementById('view-select');
    this.current = 'editor';
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => this.go(tab.dataset.view));
      tab.addEventListener('keydown', (ev) => this.#keys(ev, tab));
    }
    this.select.addEventListener('change', () => this.go(this.select.value));
  }

  #keys(ev, tab) {
    const i = this.tabs.indexOf(tab);
    let j = null;
    if (ev.key === 'ArrowRight') j = (i + 1) % this.tabs.length;
    else if (ev.key === 'ArrowLeft') j = (i - 1 + this.tabs.length) % this.tabs.length;
    else if (ev.key === 'Home') j = 0;
    else if (ev.key === 'End') j = this.tabs.length - 1;
    if (j === null) return;
    ev.preventDefault();
    this.tabs[j].focus();
    this.go(this.tabs[j].dataset.view);
  }

  go(view) {
    if (!VIEWS.includes(view)) return;
    const prev = this.current;
    this.current = view;
    for (const tab of this.tabs) {
      const on = tab.dataset.view === view;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    this.select.value = view;
    for (const id of new Set(Object.values(PANEL_FOR))) {
      const panel = document.getElementById(id);
      panel.hidden = id !== PANEL_FOR[view];
    }
    const ws = document.getElementById('view-workspace');
    ws.dataset.mode = view === 'debugger' ? 'debugger' : 'editor';
    ws.setAttribute('aria-labelledby', view === 'debugger' ? 'tab-debugger' : 'tab-editor');
    if (prev !== view) this.onChange(view, prev);
    try { history.replaceState(null, '', `#${view}`); } catch { /* sandboxed */ }
  }
}
