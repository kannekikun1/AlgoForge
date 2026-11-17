/**
 * Experiment serialization: a portable, versioned JSON envelope for Discovery, Race and
 * Complexity experiments, plus validation for imports. Imported data is treated purely as
 * data — nothing in it is ever executed or injected as HTML.
 */
import { SCHEMA_VERSION } from '../core/Graph.js';
import { validateGraphData } from '../core/GraphValidator.js';
import { isPlainObject, LIMITS } from '../utils/Validation.js';

export const EXPERIMENT_KINDS = Object.freeze(['discovery', 'race', 'complexity']);

export function experimentEnvelope({ kind, name, config, result, environment, graph = null, id = null }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    application: 'AlgoForge',
    type: 'experiment',
    kind,
    id: id ?? makeId(),
    name: name ?? `${kind} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    createdAt: new Date().toISOString(),
    config: config ?? {},
    environment: environment ?? {},
    graph,
    result: sanitizeNumbers(result),
  };
}

/** JSON has no Infinity/NaN; encode them as strings so exports round-trip losslessly. */
export function sanitizeNumbers(v) {
  if (typeof v === 'number') {
    if (v === Infinity) return 'Infinity';
    if (v === -Infinity) return '-Infinity';
    if (Number.isNaN(v)) return null;
    return v;
  }
  if (Array.isArray(v)) return v.map(sanitizeNumbers);
  if (ArrayBuffer.isView(v)) return Array.from(v, sanitizeNumbers);
  if (isPlainObject(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (typeof x !== 'function') o[k] = sanitizeNumbers(x);
    return o;
  }
  return v;
}

export function validateExperimentEnvelope(obj) {
  const errors = [];
  if (!isPlainObject(obj)) return ['Experiment file must be a JSON object.'];
  if (obj.schemaVersion !== SCHEMA_VERSION) errors.push(`Unsupported schema version ${String(obj.schemaVersion)} (expected ${SCHEMA_VERSION}).`);
  if (obj.type !== 'experiment') errors.push('Not an experiment file.');
  if (!EXPERIMENT_KINDS.includes(obj.kind)) errors.push(`Unknown experiment kind "${String(obj.kind)}".`);
  if (typeof obj.name !== 'string' || obj.name.length > LIMITS.maxNameLength) errors.push('Experiment name must be a string.');
  if (!isPlainObject(obj.result)) errors.push('Experiment result is missing.');
  if (obj.graph !== null && obj.graph !== undefined) {
    const v = validateGraphData(obj.graph, { allowEmpty: true });
    errors.push(...v.errors.map((e) => `Graph: ${e.message}`));
  }
  if (Array.isArray(obj.result?.samples) && obj.result.samples.length > LIMITS.maxExperimentSamples) errors.push('Too many samples in experiment.');
  if (obj.kind === 'discovery' && obj.result?.best?.graph) {
    const v = validateGraphData(obj.result.best.graph, { allowEmpty: true });
    errors.push(...v.errors.map((e) => `Winning graph: ${e.message}`));
  }
  return errors;
}

export function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const a = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(a);
  else for (let i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
