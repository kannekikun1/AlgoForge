/**
 * Reusable seeded-generator form (sidebar, Discovery Mode).
 */
import { h, numberField, selectField, checkboxField, readNumber, readInt } from './dom.js';
import { FAMILIES, WEIGHT_DISTRIBUTIONS, ENDPOINT_POLICIES } from '../experiments/GraphGenerator.js';
import { freshSeed } from '../core/SeededRandom.js';

const opts = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));

export function generatorFields(prefix, v = {}, { showSeed = true, showEndpoints = false, showDirected = true, nodesMax = 2000 } = {}) {
  const id = (k) => `${prefix}-${k}`;
  const seedInput = h('input', { type: 'number', id: id('seed'), value: v.seed ?? freshSeed(), min: 0, step: 1, inputmode: 'numeric' });
  const dice = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'New random seed', title: 'New random seed', onclick: () => { seedInput.value = String(freshSeed()); } }, '⚄');
  return h('div', { class: 'field-grid' },
    selectField({ id: id('family'), label: 'Graph family', options: opts(FAMILIES), value: v.family ?? 'random', cls: 'span-2' }),
    numberField({ id: id('nodes'), label: 'Nodes', value: v.nodes ?? 12, min: 1, max: nodesMax }),
    numberField({ id: id('density'), label: 'Edge density (0–1)', value: v.density ?? 0.25, min: 0, max: 1, step: 0.01 }),
    selectField({ id: id('dist'), label: 'Weight distribution', options: opts(WEIGHT_DISTRIBUTIONS), value: v.weights?.distribution ?? 'uniform', cls: 'span-2' }),
    numberField({ id: id('wmin'), label: 'Min weight', value: v.weights?.min ?? 1, step: 1 }),
    numberField({ id: id('wmax'), label: 'Max weight', value: v.weights?.max ?? 20, step: 1 }),
    showEndpoints ? selectField({ id: id('endpoints'), label: 'Start / destination', options: opts(ENDPOINT_POLICIES), value: v.endpoints ?? 'spread', cls: 'span-2' }) : null,
    showSeed ? h('label', { class: 'field span-2', for: id('seed') }, h('span', { class: 'field-label' }, 'Random seed'), h('div', { class: 'input-with-btn' }, seedInput, dice)) : null,
    h('div', { class: 'span-2 btn-row' },
      showDirected ? checkboxField({ id: id('directed'), label: 'Directed', checked: v.directed ?? false }) : null,
      checkboxField({ id: id('connected'), label: 'Connected', checked: v.connected ?? true })),
  );
}

export function readGenerator(prefix) {
  const id = (k) => document.getElementById(`${prefix}-${k}`);
  return {
    family: id('family').value,
    nodes: readInt(`${prefix}-nodes`, 12),
    density: readNumber(`${prefix}-density`, 0.25),
    directed: id('directed') ? id('directed').checked : false,
    connected: id('connected').checked,
    weights: { distribution: id('dist').value, min: readNumber(`${prefix}-wmin`, 1), max: readNumber(`${prefix}-wmax`, 20) },
    endpoints: id('endpoints')?.value ?? 'spread',
    seed: id('seed') ? readInt(`${prefix}-seed`, 1) : undefined,
  };
}

export function writeGenerator(prefix, v) {
  const set = (k, val) => { const el = document.getElementById(`${prefix}-${k}`); if (el && val !== undefined) { if (el.type === 'checkbox') el.checked = Boolean(val); else el.value = String(val); } };
  set('family', v.family); set('nodes', v.nodes); set('density', v.density); set('directed', v.directed); set('connected', v.connected);
  set('dist', v.weights?.distribution); set('wmin', v.weights?.min); set('wmax', v.weights?.max); set('endpoints', v.endpoints); set('seed', v.seed);
}
