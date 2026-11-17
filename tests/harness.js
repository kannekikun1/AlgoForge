/**
 * Tiny dependency-free test harness that runs unchanged in Node (tests/run-node.mjs) and in
 * the browser (tests/index.html).
 */
const registry = [];
let currentSuite = '';

export function suite(name, fn) {
  const prev = currentSuite;
  currentSuite = prev ? `${prev} › ${name}` : name;
  fn();
  currentSuite = prev;
}

export function test(name, fn) {
  registry.push({ name: currentSuite ? `${currentSuite} › ${name}` : name, fn });
}

export class AssertionError extends Error {
  constructor(message) { super(message); this.name = 'AssertionError'; }
}

const show = (v) => {
  try {
    return JSON.stringify(v, (k, x) => (x === Infinity ? '∞' : x instanceof Set ? [...x] : x));
  } catch { return String(v); }
};

export const assert = {
  ok(v, msg = 'expected truthy') { if (!v) throw new AssertionError(msg); },
  equal(a, b, msg) { if (a !== b) throw new AssertionError(msg ?? `expected ${show(b)}, got ${show(a)}`); },
  notEqual(a, b, msg) { if (a === b) throw new AssertionError(msg ?? `expected value other than ${show(b)}`); },
  close(a, b, eps = 1e-9, msg) {
    if (!(a === b || Math.abs(a - b) <= eps)) throw new AssertionError(msg ?? `expected ≈${b}, got ${a}`);
  },
  deepEqual(a, b, msg) {
    const sa = show(a); const sb = show(b);
    if (sa !== sb) throw new AssertionError(msg ?? `deepEqual failed\n  actual:   ${sa}\n  expected: ${sb}`);
  },
  throws(fn, re, msg) {
    try { fn(); } catch (err) {
      if (re && !re.test(String(err.message))) throw new AssertionError(msg ?? `error "${err.message}" does not match ${re}`);
      return;
    }
    throw new AssertionError(msg ?? 'expected function to throw');
  },
  async rejects(fn, re) {
    try { await fn(); } catch (err) {
      if (re && !re.test(String(err.message))) throw new AssertionError(`error "${err.message}" does not match ${re}`);
      return;
    }
    throw new AssertionError('expected promise to reject');
  },
};

/** Run all registered tests. `report(line)` receives human-readable lines. */
export async function run({ report = console.log, filter = null } = {}) {
  let passed = 0;
  let failed = 0;
  const failures = [];
  const t0 = Date.now();
  for (const t of registry) {
    if (filter && !t.name.includes(filter)) continue;
    try {
      await t.fn();
      passed++;
      report(`  ✓ ${t.name}`);
    } catch (err) {
      failed++;
      failures.push({ name: t.name, err });
      report(`  ✗ ${t.name}\n      ${String(err?.stack ?? err).split('\n').slice(0, 4).join('\n      ')}`);
    }
  }
  report(`\n${passed} passed, ${failed} failed (${Date.now() - t0} ms)`);
  return { passed, failed, failures };
}
