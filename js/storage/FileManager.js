/**
 * File import/export.
 *
 * Import pipeline: size check → JSON.parse (never eval) → envelope/schema checks → structural
 * graph validation → normalisation into fresh objects containing only known fields. Unknown
 * fields (including "__proto__" keys) are dropped; nothing from a file is ever executed or
 * inserted as HTML. Malformed input produces a descriptive error instead of throwing.
 */
import { SCHEMA_VERSION, toExportEnvelope } from '../core/Graph.js';
import { validateGraphData } from '../core/GraphValidator.js';
import { validateExperimentEnvelope } from '../experiments/ExperimentSerializer.js';
import { LIMITS, isPlainObject } from '../utils/Validation.js';

/**
 * Parse and validate an imported file's text.
 * @returns {{ok:true, kind:'graph', graph:object, warnings:Array, meta:object} |
 *           {ok:true, kind:'experiment', experiment:object, warnings:Array} |
 *           {ok:false, errors:string[]}}
 */
export function parseImport(text, { maxBytes = LIMITS.maxImportBytes } = {}) {
  if (typeof text !== 'string') return { ok: false, errors: ['File could not be read as text.'] };
  if (text.length > maxBytes) return { ok: false, errors: [`File is too large (${(text.length / 1048576).toFixed(1)} MB; limit ${(maxBytes / 1048576).toFixed(0)} MB).`] };
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`Invalid JSON: ${err.message}`] };
  }
  if (!isPlainObject(obj)) return { ok: false, errors: ['Top-level JSON value must be an object.'] };
  if (obj.schemaVersion === undefined) return { ok: false, errors: ['Missing "schemaVersion".'] };
  if (obj.schemaVersion !== SCHEMA_VERSION) return { ok: false, errors: [`Unsupported schema version ${String(obj.schemaVersion)}; this build supports version ${SCHEMA_VERSION}.`] };
  if (obj.application !== undefined && obj.application !== 'AlgoForge') {
    return { ok: false, errors: [`File was produced by "${String(obj.application)}", not AlgoForge.`] };
  }

  if (obj.type === 'experiment') {
    const errors = validateExperimentEnvelope(obj);
    if (errors.length) return { ok: false, errors };
    return { ok: true, kind: 'experiment', experiment: JSON.parse(JSON.stringify(obj)), warnings: [] };
  }

  if (!isPlainObject(obj.graph)) return { ok: false, errors: ['Missing "graph" object.'] };
  const v = validateGraphData(obj.graph, { allowEmpty: true });
  if (!v.ok) return { ok: false, errors: v.errors.map((e) => e.message) };
  return {
    ok: true,
    kind: 'graph',
    graph: normalizeGraph(obj.graph),
    warnings: v.warnings.map((w) => w.message),
    meta: {
      name: typeof obj.name === 'string' ? obj.name.slice(0, LIMITS.maxNameLength) : null,
      start: typeof obj.start === 'string' ? obj.start : null,
      target: typeof obj.target === 'string' ? obj.target : null,
    },
  };
}

/** Copy only known fields into fresh objects. Assumes prior validation. */
export function normalizeGraph(g) {
  const directed = Boolean(g.directed);
  return {
    directed,
    nodes: g.nodes.map((n) => ({ id: String(n.id), label: typeof n.label === 'string' ? n.label : String(n.id), x: Number(n.x), y: Number(n.y) })),
    edges: g.edges.map((e) => ({ id: String(e.id), source: String(e.source), target: String(e.target), weight: Number(e.weight), directed })),
  };
}

export function graphToJSONText(graphData, extra = {}) {
  return JSON.stringify(toExportEnvelope(graphData, extra), null, 2);
}

/* ---------- Browser-only helpers ---------- */

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file, { maxBytes = LIMITS.maxImportBytes } = {}) {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) { reject(new Error(`File is too large (limit ${(maxBytes / 1048576).toFixed(0)} MB).`)); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'));
    reader.readAsText(file);
  });
}

export function safeFilename(name, ext) {
  const base = String(name || 'algoforge').replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'algoforge';
  return `${base}.${ext}`;
}
