/**
 * Discovery Mode worker. Messages:
 *   in:  { cmd: 'start', config }   { cmd: 'cancel' }
 *   out: { type: 'progress', progress }  { type: 'done', result }  { type: 'error', message }
 */
import { DiscoveryEngine } from '../experiments/DiscoveryEngine.js';
import { environmentInfo } from '../experiments/BenchmarkRunner.js';
import { runSliced } from './workerLoop.js';

let current = null;

self.onmessage = (ev) => {
  const msg = ev.data ?? {};
  if (msg.cmd === 'start') {
    current?.cancel();
    const engine = new DiscoveryEngine(msg.config ?? {});
    if (engine.errors.length) {
      self.postMessage({ type: 'error', message: engine.errors.join(' ') });
      return;
    }
    const env = environmentInfo();
    current = runSliced({
      step: (ms) => engine.step(ms),
      progress: () => engine.progress(),
      result: () => ({ ...engine.result(), environment: env }),
      cancel: () => engine.cancel(),
    }, { post: (m) => self.postMessage(m) });
  } else if (msg.cmd === 'cancel') {
    current?.cancel();
  }
};
