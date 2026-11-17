/**
 * Shared validation helpers and resource limits.
 * Limits protect the browser from accidental (or malicious) oversized inputs.
 */
export const LIMITS = Object.freeze({
  maxNodes: 5000,
  maxEdges: 20000,
  maxIdLength: 64,
  maxLabelLength: 32,
  maxCoordinate: 1e6,
  maxAbsWeight: 1e9,
  maxImportBytes: 8 * 1024 * 1024,
  maxExperimentSamples: 200000,
  maxNameLength: 120,
});

export function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isNonEmptyString(v, maxLen = Infinity) {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen;
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function toInt(v, fallback, lo = -Infinity, hi = Infinity) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, lo, hi);
}

export function toNumber(v, fallback, lo = -Infinity, hi = Infinity) {
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, lo, hi);
}

/** Strip control characters and trim to a maximum length. Output is still only ever used via textContent. */
export function sanitizeText(v, maxLen) {
  // eslint-disable-next-line no-control-regex
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLen);
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deterministic natural ("numeric-aware") string comparison that does not depend on
 * locale data, so that canonical orders are identical across browsers and Node.
 * "node-2" < "node-10", "A" < "B" < "AA".
 */
export function naturalCompare(a, b) {
  if (a === b) return 0;
  const ta = tokenize(a);
  const tb = tokenize(b);
  const len = Math.min(ta.length, tb.length);
  // Lexicographic comparison over token sequences, where tokens are totally ordered:
  // numeric tokens < text tokens; numeric tokens by value; text tokens by (length, code units).
  // Ordering text by length first gives spreadsheet-style labels: A < B < … < Z < AA < AB.
  for (let i = 0; i < len; i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === y) continue;
    const xd = isDigit(x);
    const yd = isDigit(y);
    if (xd !== yd) return xd ? -1 : 1;
    if (xd) {
      const xs = x.replace(/^0+(?=\d)/, '');
      const ys = y.replace(/^0+(?=\d)/, '');
      if (xs.length !== ys.length) return xs.length - ys.length;
      if (xs !== ys) return xs < ys ? -1 : 1;
      continue; // same value, different zero padding: resolved by final tie-break
    }
    if (x.length !== y.length) return x.length - y.length;
    return x < y ? -1 : 1;
  }
  if (ta.length !== tb.length) return ta.length - tb.length;
  return a < b ? -1 : 1;
}

function isDigit(token) {
  const c = token.charCodeAt(0);
  return c >= 48 && c <= 57;
}

function tokenize(s) {
  return String(s).match(/\d+|\D+/g) ?? [''];
}
