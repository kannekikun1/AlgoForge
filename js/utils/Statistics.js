/**
 * Descriptive statistics used by the benchmark runner, race and complexity analyzer.
 * All functions are pure and ignore non-finite values.
 */

function clean(values) {
  return values.filter((v) => typeof v === 'number' && Number.isFinite(v));
}

export function sum(values) {
  let s = 0;
  for (const v of clean(values)) s += v;
  return s;
}

export function mean(values) {
  const v = clean(values);
  return v.length ? sum(v) / v.length : NaN;
}

/** Quantile with linear interpolation between closest ranks (type 7, as in R / NumPy default). */
export function quantile(values, q) {
  const v = clean(values).sort((a, b) => a - b);
  if (!v.length) return NaN;
  if (v.length === 1) return v[0];
  const pos = (v.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function median(values) { return quantile(values, 0.5); }

/** Sample standard deviation (n - 1 denominator). */
export function stdev(values) {
  const v = clean(values);
  if (v.length < 2) return 0;
  const m = mean(v);
  let acc = 0;
  for (const x of v) acc += (x - m) ** 2;
  return Math.sqrt(acc / (v.length - 1));
}

/** Median absolute deviation (unscaled). */
export function mad(values) {
  const v = clean(values);
  if (!v.length) return NaN;
  const m = median(v);
  return median(v.map((x) => Math.abs(x - m)));
}

export function iqr(values) {
  return quantile(values, 0.75) - quantile(values, 0.25);
}

export function summarize(values) {
  const v = clean(values);
  return {
    count: v.length,
    min: v.length ? Math.min(...v) : NaN,
    max: v.length ? Math.max(...v) : NaN,
    mean: mean(v),
    median: median(v),
    stdev: stdev(v),
    q1: quantile(v, 0.25),
    q3: quantile(v, 0.75),
    iqr: iqr(v),
    mad: mad(v),
  };
}

/**
 * Least-squares fit of y ≈ c · f(x) through the origin. Returns c.
 * Used only to scale theoretical reference curves for visual comparison.
 */
export function fitScale(fx, ys) {
  let num = 0;
  let den = 0;
  for (let i = 0; i < fx.length; i++) {
    if (!Number.isFinite(fx[i]) || !Number.isFinite(ys[i])) continue;
    num += fx[i] * ys[i];
    den += fx[i] * fx[i];
  }
  return den > 0 ? num / den : 0;
}

/** Coefficient of determination of a fitted curve. */
export function rSquared(ys, fitted) {
  const m = mean(ys);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < ys.length; i++) {
    ssTot += (ys[i] - m) ** 2;
    ssRes += (ys[i] - fitted[i]) ** 2;
  }
  return ssTot > 0 ? 1 - ssRes / ssTot : NaN;
}
