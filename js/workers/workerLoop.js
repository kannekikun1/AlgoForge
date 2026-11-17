/**
 * Shared slicing loop for worker jobs.
 *
 * A job object exposes `step(budgetMs) → done`, `progress()`, `result()` and `cancel()`.
 * The loop yields to the worker's event queue between slices (so a "cancel" message is
 * processed promptly) and posts progress at most every `progressMs` to avoid flooding the
 * main thread.
 */
export function runSliced(job, { post, sliceMs = 40, progressMs = 200 }) {
  let lastProgress = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    let done;
    try {
      done = job.step(sliceMs);
    } catch (err) {
      stopped = true;
      post({ type: 'error', message: err?.message ?? String(err) });
      return;
    }
    const t = performance.now();
    if (done) {
      stopped = true;
      post({ type: 'progress', progress: job.progress() });
      post({ type: 'done', result: job.result() });
      return;
    }
    if (t - lastProgress >= progressMs) {
      lastProgress = t;
      post({ type: 'progress', progress: job.progress() });
    }
    setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  return {
    cancel() { job.cancel(); },
  };
}
