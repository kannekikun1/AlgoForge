/**
 * Benchmark worker: Algorithm Race benchmark mode and the Complexity Analyzer.
 *   in:  { cmd: 'race', a, b, graph, config }   { cmd: 'complexity', config }   { cmd: 'cancel' }
 *   out: { type: 'progress', progress }  { type: 'done', result }  { type: 'error', message }
 */
import { benchmarkPair, environmentInfo } from '../experiments/BenchmarkRunner.js';
import { ComplexityAnalyzer } from '../experiments/ComplexityAnalyzer.js';
import { runSliced } from './workerLoop.js';

let current = null;

self.onmessage = (ev) => {
  const msg = ev.data ?? {};
  try {
    if (msg.cmd === 'race') {
      const result = benchmarkPair(msg.a, msg.b, msg.graph, msg.config ?? {});
      self.postMessage({ type: 'done', result });
    } else if (msg.cmd === 'complexity') {
      current?.cancel();
      const analyzer = new ComplexityAnalyzer(msg.config ?? {});
      if (analyzer.errors.length) {
        self.postMessage({ type: 'error', message: analyzer.errors.join(' ') });
        return;
      }
      const env = environmentInfo();
      current = runSliced({
        step: (ms) => analyzer.step(ms),
        progress: () => analyzer.progress(),
        result: () => ({ ...analyzer.result(), environment: env }),
        cancel: () => analyzer.cancel(),
      }, { post: (m) => self.postMessage(m) });
    } else if (msg.cmd === 'cancel') {
      current?.cancel();
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) });
  }
};
