/** Browser entry for the shared test suite (open tests/index.html via the dev server). */
import { run } from './harness.js';
import './core/core.test.js';
import './structures/structures.test.js';
import './algorithms/algorithms.test.js';
import './algorithms/property.test.js';
import './algorithms/differential.test.js';
import './experiments/experiments.test.js';
import './storage/storage.test.js';
import './integration/integration.test.js';

const log = document.getElementById('log');
const summary = document.getElementById('summary');
const lines = [];
const { passed, failed } = await run({ report: (l) => lines.push(l) });
log.textContent = lines.join('\n');
summary.textContent = `${passed} passed, ${failed} failed`;
summary.className = failed ? 'fail' : 'pass';
document.documentElement.dataset.done = failed ? 'fail' : 'pass';
