#!/usr/bin/env node
/**
 * Node test runner: imports every *.test.js file under tests/ and runs the shared harness.
 * Usage: node tests/run-node.mjs [filter]
 */
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './harness.js';

const root = dirname(fileURLToPath(import.meta.url));

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'e2e') out.push(...collect(p)); } else if (name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

const files = collect(root);
for (const f of files) {
  console.log(`• ${relative(root, f)}`);
  await import(pathToFileURL(f).href);
}
const { failed } = await run({ filter: process.argv[2] ?? null });
process.exit(failed ? 1 : 0);
