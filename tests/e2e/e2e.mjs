#!/usr/bin/env node
/**
 * End-to-end browser tests (development-only; uses Playwright).
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   node scripts/serve.mjs 8080 &   node tests/e2e/e2e.mjs [--screenshots]
 *
 * Environment: E2E_URL (default http://localhost:8080/), CHROME_PATH (optional executable).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL_ = process.env.E2E_URL ?? 'http://localhost:8080/';
const SHOTS = process.argv.includes('--screenshots');
const shotDir = new URL('../../assets/screenshots/', import.meta.url).pathname;
if (SHOTS) mkdirSync(shotDir, { recursive: true });

const results = [];
const errors = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(['✓', name, Date.now() - t0]); } catch (err) {
    results.push(['✗', name, Date.now() - t0, err.message.split('\n').slice(0, 6).join('\n    ')]);
    if (process.env.E2E_DEBUG) await page.screenshot({ path: `/tmp/e2e-fail-${results.length}.png` }).catch(() => {});
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());

const app = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${shotDir}${name}.png` }); };
const canvasBox = async () => page.locator('#graph-canvas').boundingBox();

await page.goto(URL_);
await page.waitForSelector('html[data-ready="true"]', { state: 'attached' });
await app(() => localStorage.clear());
await page.reload();
await page.waitForSelector('html[data-ready="true"]', { state: 'attached' });

await step('loads sample graph without errors', async () => {
  const n = await app(() => window.__algoforge.editor.graph.nodeCount);
  expect(n === 8, `expected 8 nodes, got ${n}`);
  await shot('editor');
});

await step('add nodes with node tool and connect with edge tool', async () => {
  await page.click('[data-tool="node"]');
  const box = await canvasBox();
  const before = await app(() => window.__algoforge.editor.graph.nodeCount);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.85);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.85);
  const after = await app(() => window.__algoforge.editor.graph.nodeCount);
  expect(after === before + 2, `nodes ${before} → ${after}`);
  await page.keyboard.press('e');
  const edgesBefore = await app(() => window.__algoforge.editor.graph.edgeCount);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.85);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.85);
  const edgesAfter = await app(() => window.__algoforge.editor.graph.edgeCount);
  expect(edgesAfter === edgesBefore + 1, 'edge not added');
});

await step('drag node, undo and redo', async () => {
  await page.keyboard.press('v');
  const box = await canvasBox();
  const [sx, sy] = [box.x + box.width * 0.7, box.y + box.height * 0.85];
  const id = await app(() => window.__algoforge.editor.graph.nodes.at(-1).id);
  const x0 = await app((nid) => window.__algoforge.editor.graph.getNode(nid).x, id);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 60, sy - 40, { steps: 6 });
  await page.mouse.up();
  const x1 = await app((nid) => window.__algoforge.editor.graph.getNode(nid).x, id);
  expect(x1 > x0 + 20, `node did not move (${x0} → ${x1})`);
  await page.keyboard.press('Control+z');
  const x2 = await app((nid) => window.__algoforge.editor.graph.getNode(nid).x, id);
  expect(Math.abs(x2 - x0) < 0.5, 'undo did not restore position');
  await page.keyboard.press('Control+Shift+z');
  const x3 = await app((nid) => window.__algoforge.editor.graph.getNode(nid).x, id);
  expect(Math.abs(x3 - x1) < 0.5, 'redo failed');
});

await step('delete selection with keyboard and edit via structure panel', async () => {
  const n0 = await app(() => window.__algoforge.editor.graph.nodeCount);
  await page.locator('#graph-canvas').focus();
  await page.keyboard.press('Delete');
  const n1 = await app(() => window.__algoforge.editor.graph.nodeCount);
  expect(n1 === n0 - 1, 'delete key failed');
  await page.fill('#add-node-label', 'Z9');
  await page.click('#structure-body form button[type=submit]');
  const has = await app(() => window.__algoforge.editor.graph.nodes.some((n) => n.label === 'Z9'));
  expect(has, 'structure add-node failed');
});

await step('reload sample, run Dijkstra, step back and forth', async () => {
  await app(() => window.__algoforge.actions.loadSample());
  await page.selectOption('#algo-select', 'dijkstra');
  await page.click('#btn-run');
  await page.waitForTimeout(400);
  await page.click('#pb-play'); // pause
  await page.click('#pb-forward');
  await page.click('#pb-forward');
  const i1 = await app(() => window.__algoforge.controller.index);
  await page.click('#pb-back');
  const i2 = await app(() => window.__algoforge.controller.index);
  expect(i2 === i1 - 1, 'step back failed');
  await page.click('#pb-end');
  const st = await app(() => window.__algoforge.controller.state.status);
  expect(st === 'completed', `status ${st}`);
  const cur = await page.locator('#pseudocode li[aria-current="step"]').count();
  expect(cur === 1, 'pseudocode highlight missing');
  await page.click('#pb-timeline');
  await shot('debugger');
});

await step('every algorithm runs (or reports a clear error) in the debugger', async () => {
  const ids = await app(() => [...document.querySelectorAll('#algo-select option')].map((o) => o.value));
  for (const id of ids) {
    await page.selectOption('#algo-select', id);
    await page.click('#btn-run-instant');
    const s = await app(() => ({ ok: window.__algoforge.execution?.ok, status: window.__algoforge.controller.state.status, err: document.getElementById('run-errors').textContent }));
    expect(s.ok ? ['completed', 'failed'].includes(s.status) : s.err.length > 0, `${id}: ${JSON.stringify(s)}`);
  }
});

await step('topological sort on directed graph after mode switch', async () => {
  await page.click('label.switch');
  await page.selectOption('#algo-select', 'topologicalSort');
  await page.click('#btn-run-instant');
  const ok = await app(() => window.__algoforge.execution.ok);
  expect(ok, 'kahn failed to run');
  await page.click('label.switch');
});

await step('generate seeded graph is reproducible', async () => {
  await page.fill('#gen-seed', '4242');
  await page.fill('#gen-nodes', '30');
  await page.click('#btn-generate');
  const a = await app(() => JSON.stringify(window.__algoforge.editor.graph.toJSON()));
  await page.click('#btn-generate');
  const b = await app(() => JSON.stringify(window.__algoforge.editor.graph.toJSON()));
  expect(a === b, 'same seed produced different graphs');
});

await step('race: synchronized mode plays to the end and shows metrics', async () => {
  await page.fill('#gen-seed', '7');
  await page.selectOption('#gen-family', 'geometric');
  await page.fill('#gen-nodes', '60');
  await page.fill('#gen-density', '0.06');
  await page.selectOption('#gen-dist', 'euclidean');
  await page.click('#btn-generate');
  await page.click('#tab-race');
  await page.selectOption('#race-a', 'dijkstra');
  await page.selectOption('#race-b', 'astar');
  await page.click('#race-run');
  await page.waitForSelector('#race-tick');
  await page.click('#race-transport button:has-text("⇥")');
  await page.waitForSelector('#race-metrics table');
  const rows = await page.locator('#race-metrics tbody tr').count();
  expect(rows >= 9, 'metrics table incomplete');
  await shot('race');
});

await step('race: benchmark mode runs in a worker', async () => {
  await page.selectOption('#race-mode', 'benchmark');
  await page.fill('#race-runs', '5');
  await page.fill('#race-warmup', '1');
  await page.click('#race-run');
  await page.waitForFunction(() => /Benchmark complete/.test(document.getElementById('race-transport').textContent), null, { timeout: 30000 });
  const t = await page.locator('#race-metrics tbody tr').first().textContent();
  expect(/[µm]s|ns/.test(t), `no timing: ${t}`);
});

await step('discovery: search runs in worker, UI responsive, result reproducible', async () => {
  await page.click('#tab-discovery');
  await page.fill('#disc-nodes', '40');
  await page.fill('#disc-experiments', '300');
  await page.fill('#disc-seed', '84721');
  await page.click('#disc-start');
  // UI responsiveness probe while the worker runs.
  const t0 = Date.now();
  await app(() => new Promise((r) => requestAnimationFrame(() => r())));
  expect(Date.now() - t0 < 500, 'main thread blocked');
  await page.waitForFunction(() => !document.getElementById('disc-open').disabled, null, { timeout: 60000 });
  const first = await app(() => JSON.stringify(window.__algoforge.discovery.result.best.graph));
  await shot('discovery');
  await page.click('#disc-start');
  await page.waitForFunction(() => !document.getElementById('disc-open').disabled, null, { timeout: 60000 });
  const second = await app(() => JSON.stringify(window.__algoforge.discovery.result.best.graph));
  expect(first === second, 'same seed gave a different winner');
});

await step('discovery: cancel returns partial result', async () => {
  await page.fill('#disc-experiments', '1000000');
  await page.click('#disc-start');
  await page.waitForTimeout(800);
  await page.click('#disc-cancel');
  await page.waitForFunction(() => !document.getElementById('disc-start').disabled, null, { timeout: 10000 });
  const by = await app(() => window.__algoforge.discovery.result?.terminatedBy);
  expect(by === 'cancelled', `terminatedBy=${by}`);
  await page.fill('#disc-experiments', '300');
});

await step('discovery: save experiment and open the graph in the editor', async () => {
  await page.click('#disc-save');
  await page.click('#prompt-ok');
  await page.waitForTimeout(300);
  await page.click('#disc-open');
  const view = await app(() => window.__algoforge.store.get('view'));
  expect(view === 'editor', 'did not switch to editor');
});

await step('complexity: run analysis, chart and table render, CSV export', async () => {
  await page.click('#tab-complexity');
  await page.selectOption('#cx-algo', 'bfs');
  await page.fill('#cx-min', '50');
  await page.fill('#cx-max', '400');
  await page.fill('#cx-step', '50');
  await page.fill('#cx-reps', '3');
  await page.click('#cx-run');
  await page.waitForFunction(() => !document.getElementById('cx-export-csv').disabled, null, { timeout: 60000 });
  const pts = await page.locator('#complexity-chart circle.pt').count();
  expect(pts === 24, `expected 24 points, got ${pts}`);
  // Keyboard activation (also verifies the chart points are keyboard accessible).
  await page.locator('#complexity-chart circle.pt').first().focus();
  await page.keyboard.press('Enter');
  expect(await page.locator('#complexity-detail .card').count() === 1, 'detail missing');
  await page.selectOption('#cx-metric', 'nodesVisited');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#cx-export-csv')]);
  expect(dl.suggestedFilename().endsWith('.csv'), 'csv not downloaded');
  await shot('complexity');
  await page.click('#cx-save');
  await page.click('#prompt-ok');
});

await step('save graph, list in Saved, export and re-import', async () => {
  await page.click('#btn-save');
  await page.fill('#prompt-input', 'E2E graph');
  await page.click('#prompt-ok');
  await page.click('#tab-saved');
  await page.waitForSelector('#saved-graphs table');
  const names = await page.locator('#saved-graphs tbody td:first-child').allTextContents();
  expect(names.includes('E2E graph'), 'saved graph missing');
  const exps = await page.locator('#saved-experiments tbody tr').count();
  expect(exps >= 2, `expected ≥2 experiments, got ${exps}`);
  await shot('saved');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
  const path = await dl.path();
  await page.setInputFiles('#file-import', path);
  await page.waitForTimeout(300);
  const n = await app(() => window.__algoforge.editor.graph.nodeCount);
  expect(n > 0, 'import failed');
});

await step('saved experiments re-open in their views', async () => {
  await page.click('#tab-saved');
  await page.waitForSelector('#saved-experiments table');
  const rows = page.locator('#saved-experiments tbody tr');
  const kinds = await rows.locator('td:nth-child(2)').allTextContents();
  for (let i = 0; i < kinds.length; i++) {
    await page.click('#tab-saved');
    await page.waitForSelector('#saved-experiments table');
    await page.locator('#saved-experiments tbody tr').nth(i).locator('button:has-text("Open")').click();
    await page.waitForTimeout(300);
    const view = await app(() => window.__algoforge.store.get('view'));
    expect(view === kinds[i].trim(), `expected ${kinds[i]} view, got ${view}`);
  }
  expect(await page.locator('#complexity-chart circle.pt').count() > 0, 'saved complexity chart not rendered');
});

await step('malformed import is rejected without crashing', async () => {
  await page.setInputFiles('#file-import', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":1,"graph":{"nodes":[{"id":"A","x":"<script>","y":0}],"edges":[]}}') });
  await page.waitForSelector('.toast-error');
  const n = await app(() => window.__algoforge.editor.graph.nodeCount);
  expect(n > 0, 'graph lost after bad import');
});

await step('light theme and settings persist', async () => {
  await page.click('#btn-theme');
  expect(await app(() => document.documentElement.dataset.theme) === 'light', 'theme not applied');
  await page.click('#tab-debugger');
  await page.click('#btn-run-instant');
  await shot('debugger-light');
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]', { state: 'attached' });
  expect(await app(() => document.documentElement.dataset.theme) === 'light', 'theme not persisted');
  await page.click('#btn-theme');
});

await step('help view renders algorithm docs', async () => {
  await page.click('#tab-help');
  const docs = await page.locator('.algo-doc').count();
  expect(docs === 10, `expected 10 algorithm docs (9 core + example), got ${docs}`);
});

await step('mobile viewport: drawers, canvas usable, touch-sized controls', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await m.newPage();
  p.on('pageerror', (e) => errors.push(`mobile pageerror: ${e.message}`));
  await p.goto(URL_);
  await p.waitForSelector('html[data-ready="true"]', { state: 'attached' });
  await p.waitForTimeout(400);
  const collapsed = await p.evaluate(() => {
    const ws = document.getElementById('view-workspace');
    const r = document.querySelector('.sidebar-left').getBoundingClientRect();
    return ws.classList.contains('left-collapsed') && r.right <= 1;
  });
  expect(collapsed, 'left drawer should start fully collapsed');
  const box = await p.locator('#graph-canvas').boundingBox();
  expect(box.width > 300 && box.height > 300, 'canvas too small');
  if (SHOTS) await p.screenshot({ path: `${shotDir}mobile.png` });
  await p.click('#toggle-left');
  await p.waitForTimeout(400);
  const open = await p.evaluate(() => { const r = document.querySelector('.sidebar-left').getBoundingClientRect(); return r.left >= -1 && getComputedStyle(document.querySelector('.sidebar-left')).visibility === 'visible'; });
  expect(open, 'tools drawer did not open');
  if (SHOTS) await p.screenshot({ path: `${shotDir}mobile-tools.png` });
  await p.locator('#graph-canvas').tap({ position: { x: 360, y: 400 } });
  await p.waitForTimeout(400);
  const closed = await p.evaluate(() => document.getElementById('view-workspace').classList.contains('left-collapsed'));
  expect(closed, 'tapping the canvas should close the drawer');
  await m.close();
});

await step('performance: 500 nodes / 2000 edges renders and drags smoothly', async () => {
  await page.click('#tab-editor');
  await app(() => {
    const a = window.__algoforge;
    const nodes = []; const edges = [];
    for (let i = 0; i < 500; i++) nodes.push({ id: `n${i}`, label: `${i}`, x: (i % 25) * 60, y: Math.floor(i / 25) * 60 });
    let k = 0;
    for (let i = 0; i < 500; i++) for (let j = 1; j <= 4; j++) edges.push({ id: `e${k++}`, source: `n${i}`, target: `n${(i * 7 + j * 13) % 500}`, weight: j });
    a.actions.loadGraphData({ directed: false, nodes, edges });
  });
  const ms = await app(async () => {
    const v = window.__algoforge.view;
    const t0 = performance.now();
    for (let i = 0; i < 30; i++) v.draw();
    return (performance.now() - t0) / 30;
  });
  expect(ms < 16, `average draw ${ms.toFixed(1)} ms`);
  results.push(['ℹ', `average full redraw: ${ms.toFixed(2)} ms`, 0]);
});

await browser.close();
for (const r of results) console.log(`${r[0]} ${r[1]}${r[2] ? ` (${r[2]} ms)` : ''}${r[3] ? `\n    ${r[3]}` : ''}`);
const unexpected = errors.filter((e) => !/favicon/.test(e));
if (unexpected.length) console.log(`\nBrowser errors:\n  ${unexpected.join('\n  ')}`);
const failed = results.filter((r) => r[0] === '✗').length;
console.log(`\n${results.filter((r) => r[0] === '✓').length} passed, ${failed} failed`);
process.exit(failed || unexpected.length ? 1 : 0);
