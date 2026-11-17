/**
 * Theme (dark/light) and reduced-motion preference handling.
 */
export class ThemeManager {
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    this.theme = 'dark';
  }

  apply(theme, motion = 'system') {
    this.theme = theme === 'light' ? 'light' : 'dark';
    const root = document.documentElement;
    root.dataset.theme = this.theme;
    if (motion === 'reduce') root.dataset.motion = 'reduce';
    else delete root.dataset.motion;
    const btn = document.getElementById('btn-theme');
    if (btn) btn.setAttribute('aria-label', this.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    this.onChange(this.theme);
  }

  toggle() { return this.theme === 'dark' ? 'light' : 'dark'; }

  static prefersReducedMotion(setting) {
    if (setting === 'reduce') return true;
    if (setting === 'full') return false;
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }
}
