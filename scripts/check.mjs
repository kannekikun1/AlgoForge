#!/usr/bin/env node
/**
 * Repository checks (run in CI and locally with `npm run check`):
 *   1. JavaScript syntax of every .js/.mjs file
 *   2. Required project structure
 *   3. Relative import resolution; no bare (npm) specifiers in application code
 *   4. No circular module dependencies in js/
 *   5. Security lint: no eval / new Function / innerHTML-style sinks in application code
 *   6. package.json declares no runtime dependencies
 *   7. Relative links in Markdown documentation resolve
 *   8. The browser test runner imports every *.test.js file
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const fail = (section, msg) => problems.push(`[${section}] ${msg}`);
const rel = (p) => relative(root, p).split('\\').join('/');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(root);
const jsFiles = files.filter((f) => ['.js', '.mjs'].includes(extname(f)));
const appFiles = jsFiles.filter((f) => rel(f).startsWith('js/'));

// 1. Syntax
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail('syntax', `${rel(f)}: ${r.stderr.split('\n').slice(0, 3).join(' ')}`);
}

// 2. Structure
const required = [
  'index.html', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'CHANGELOG.md', '.gitignore', 'package.json',
  'css/variables.css', 'css/reset.css', 'css/layout.css', 'css/components.css', 'css/canvas.css', 'css/themes.css', 'css/responsive.css',
  'js/main.js',
  ...['Graph', 'GraphValidator', 'AlgorithmEngine', 'ExecutionController', 'EventRecorder', 'StateManager', 'SeededRandom', 'VisualState'].map((m) => `js/core/${m}.js`),
  ...['bfs', 'dfs', 'dijkstra', 'astar', 'bellmanFord', 'floydWarshall', 'kruskal', 'prim', 'topologicalSort'].map((m) => `js/algorithms/${m}.js`),
  ...['PriorityQueue', 'DisjointSet', 'Queue', 'MinHeap'].map((m) => `js/structures/${m}.js`),
  ...['CanvasRenderer', 'GraphRenderer', 'AnimationController', 'ViewportController'].map((m) => `js/rendering/${m}.js`),
  ...['GraphEditor', 'InputController', 'SelectionManager', 'HistoryManager'].map((m) => `js/editor/${m}.js`),
  ...['GraphGenerator', 'BenchmarkRunner', 'AlgorithmRace', 'DiscoveryEngine', 'ComplexityAnalyzer', 'ExperimentSerializer'].map((m) => `js/experiments/${m}.js`),
  'js/workers/benchmark.worker.js', 'js/workers/discovery.worker.js',
  ...['StorageManager', 'IndexedDBAdapter', 'FileManager'].map((m) => `js/storage/${m}.js`),
  ...['Navigation', 'Sidebar', 'DebuggerPanel', 'StatisticsPanel', 'SettingsPanel', 'ThemeManager'].map((m) => `js/ui/${m}.js`),
  ...['EventEmitter', 'Statistics', 'Validation'].map((m) => `js/utils/${m}.js`),
  ...['architecture', 'algorithms', 'benchmarking', 'discovery-mode', 'testing', 'contributing-algorithms'].map((m) => `docs/${m}.md`),
  '.github/workflows/ci.yml', '.github/PULL_REQUEST_TEMPLATE.md',
];
for (const r of required) if (!existsSync(join(root, r))) fail('structure', `missing ${r}`);
for (const d of ['tests/algorithms', 'tests/structures', 'tests/experiments', 'tests/storage', 'tests/integration']) {
  if (!existsSync(join(root, d)) || !readdirSync(join(root, d)).some((f) => f.endsWith('.test.js'))) fail('structure', `${d} has no tests`);
}

// 3. Imports
const importRe = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]|new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g;
const graph = new Map();
for (const f of jsFiles) {
  const src = readFileSync(f, 'utf8');
  const deps = [];
  for (const m of src.matchAll(importRe)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const target = resolve(dirname(f), spec);
      if (!existsSync(target)) fail('imports', `${rel(f)} → ${spec} (not found)`);
      else if (m[4] === undefined) deps.push(target);
    } else if (spec.startsWith('node:')) {
      if (rel(f).startsWith('js/')) fail('imports', `${rel(f)} imports Node built-in ${spec}`);
    } else if (rel(f).startsWith('js/')) {
      fail('imports', `${rel(f)} imports bare specifier "${spec}" (runtime npm dependencies are not allowed)`);
    }
  }
  graph.set(f, deps);
}

// 4. Cycles (js/ only)
const state = new Map();
const stack = [];
function dfs(u) {
  state.set(u, 1);
  stack.push(u);
  for (const v of graph.get(u) ?? []) {
    if (!rel(v).startsWith('js/')) continue;
    if (state.get(v) === 1) { fail('cycles', [...stack.slice(stack.indexOf(v)), v].map(rel).join(' → ')); continue; }
    if (!state.get(v)) dfs(v);
  }
  stack.pop();
  state.set(u, 2);
}
for (const f of appFiles) if (!state.get(f)) dfs(f);

// 5. Security lint
const sinks = [/\beval\s*\(/, /\bnew\s+Function\s*\(/, /\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML\s*\(/, /document\.write\s*\(/, /setTimeout\s*\(\s*['"`]/];
for (const f of appFiles) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\*|\/\/)/.test(line)) return;
    for (const re of sinks) if (re.test(line)) fail('security', `${rel(f)}:${i + 1} uses ${re}`);
  });
}
const html = readFileSync(join(root, 'index.html'), 'utf8');
if (!/Content-Security-Policy/.test(html)) fail('security', 'index.html lacks a Content-Security-Policy');
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) fail('security', 'index.html contains an inline script');
if (/\son[a-z]+\s*=\s*"/i.test(html)) fail('security', 'index.html contains inline event handlers');
if (/https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<!--[\s\S]*?-->/g, ''))) fail('security', 'index.html references a remote resource');

// 6. Dependencies
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.dependencies && Object.keys(pkg.dependencies).length) fail('deps', 'package.json declares runtime dependencies');

// 7. Markdown links
for (const f of files.filter((x) => x.endsWith('.md'))) {
  const src = readFileSync(f, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const m of src.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    const target = resolve(dirname(f), href.split('#')[0]);
    if (!existsSync(target)) fail('docs', `${rel(f)} → ${href}`);
  }
}

// 8. Browser runner completeness
const runner = readFileSync(join(root, 'tests/run-browser.js'), 'utf8');
for (const t of files.filter((x) => x.endsWith('.test.js'))) {
  const r = `./${relative(join(root, 'tests'), t).split('\\').join('/')}`;
  if (!runner.includes(`'${r}'`)) fail('tests', `tests/run-browser.js does not import ${r}`);
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ checks passed (${jsFiles.length} JS files, ${appFiles.length} application modules, no cycles, no unsafe sinks, ${files.filter((x) => x.endsWith('.md')).length} Markdown files)`);
