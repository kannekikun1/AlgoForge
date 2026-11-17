/**
 * Operation counters at the current step, labelled with each algorithm's own definitions.
 */
import { h, replace, fmtNum, fmtMs } from './dom.js';

export class StatisticsPanel {
  constructor(host) { this.host = host; }

  render(algo, event, run) {
    if (!algo || !run) {
      replace(this.host, h('p', { class: 'hint' }, 'Run an algorithm to see operation counts.'));
      return;
    }
    const counters = event?.counters ?? {};
    replace(this.host,
      h('dl', { class: 'stat-grid' },
        algo.counters.map((c) => [
          h('dt', { title: c.description ?? '' }, c.label),
          h('dd', {}, fmtNum(counters[c.key] ?? 0)),
        ])),
      run.ok ? h('p', { class: 'hint' },
        `Final result: ${run.result.status}. Traced run took ${fmtMs(run.result.elapsedMs)} including event recording — use Algorithm Race (benchmark mode) for timing comparisons.`) : null,
      run.truncated ? h('div', { class: 'msg msg-warn' }, `History limit reached: ${fmtNum(run.events.length)} of ${fmtNum(run.totalEvents)} events kept (final events retained). Raise the limit in Settings.`) : null);
  }
}
