/**
 * DOM helpers. All text goes through textContent / createTextNode — never innerHTML — so
 * user-controlled strings (labels, imported names) cannot inject markup.
 */

/**
 * h('button', { class: 'btn', onclick: fn, 'aria-label': 'x', dataset: {k: 'v'} }, 'text', child)
 */
export function h(tag, attrs = {}, ...children) {
  const el = tag.startsWith('svg:') ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' && 'value' in el && !(el instanceof SVGElement)) el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function replace(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Build a <select> from [{value,label,group?}] (groups become <optgroup>). */
export function fillSelect(select, options, value) {
  clear(select);
  const groups = new Map();
  for (const o of options) {
    const opt = h('option', { value: o.value }, o.label);
    if (o.disabled) opt.disabled = true;
    if (o.group) {
      if (!groups.has(o.group)) {
        const g = h('optgroup', { label: o.group });
        groups.set(o.group, g);
        select.append(g);
      }
      groups.get(o.group).append(opt);
    } else select.append(opt);
  }
  if (value !== undefined && options.some((o) => String(o.value) === String(value))) select.value = String(value);
  return select;
}

/** Simple data table. columns: [{key,label,num?,render?(row)}] */
export function dataTable(columns, rows, { caption, className = 'data-table', rowAttrs } = {}) {
  return h('table', { class: className },
    caption ? h('caption', {}, caption) : null,
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : null, scope: 'col' }, c.label)))),
    h('tbody', {}, rows.map((r, i) => h('tr', rowAttrs ? rowAttrs(r, i) : {}, columns.map((c) => {
      const v = c.render ? c.render(r, i) : r[c.key];
      return h('td', { class: [c.num ? 'num' : '', c.cls?.(r) ?? ''].join(' ').trim() || null }, v instanceof Node ? v : fmtCell(v));
    })))));
}

export function fmtCell(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return fmtNum(v);
  return String(v);
}

export function fmtNum(v, digits = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '−∞';
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (abs >= 1) return v.toFixed(digits > 2 ? 2 : digits);
  if (abs === 0) return '0';
  return v.toPrecision(digits);
}

export function fmtMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 0.001) return `${(ms * 1e6).toFixed(0)} ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(1)} µs`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 3 : 1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/* ---------- Announcements & toasts ---------- */
let announcer = null;
export function announce(text) {
  announcer ??= document.getElementById('announcer');
  if (!announcer) return;
  announcer.textContent = '';
  setTimeout(() => { announcer.textContent = text; }, 30);
}

export function toast(text, kind = 'info', ms = 4200) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
  host.append(el);
  while (host.children.length > 4) host.firstChild.remove();
  setTimeout(() => el.remove(), ms);
}

export function messageList(el, messages, kind = 'error') {
  if (!messages?.length) { el.hidden = true; clear(el); return; }
  el.hidden = false;
  el.className = `msg msg-${kind}`;
  replace(el, messages.length === 1 ? messages[0] : h('ul', {}, messages.map((m) => h('li', {}, m))));
}

/** Numeric/select/checkbox form field builders used by experiment forms. */
export function numberField({ id, label, value, min, max, step = 1, hint, cls }) {
  return h('label', { class: `field ${cls ?? ''}`, for: id },
    h('span', { class: 'field-label' }, label),
    h('input', { type: 'number', id, value, min, max, step, inputmode: step === 1 ? 'numeric' : 'decimal' }),
    hint ? h('span', { class: 'hint' }, hint) : null);
}

export function selectField({ id, label, options, value, cls, onchange }) {
  const sel = h('select', { id, onchange });
  fillSelect(sel, options, value);
  return h('label', { class: `field ${cls ?? ''}`, for: id }, h('span', { class: 'field-label' }, label), sel);
}

export function checkboxField({ id, label, checked, cls }) {
  return h('label', { class: `checkbox ${cls ?? ''}`, for: id }, h('input', { type: 'checkbox', id, checked }), label);
}

export function readNumber(id, fallback) {
  const el = document.getElementById(id);
  const v = Number.parseFloat(el?.value);
  return Number.isFinite(v) ? v : fallback;
}

export function readInt(id, fallback) {
  const v = Math.round(readNumber(id, fallback));
  return Number.isFinite(v) ? v : fallback;
}

/** Prompt dialog (native <dialog>). Resolves to the string or null if cancelled. */
export function promptDialog({ title, label, value = '' }) {
  const dlg = document.getElementById('prompt-dialog');
  const input = document.getElementById('prompt-input');
  document.getElementById('prompt-title').textContent = title;
  document.getElementById('prompt-label').textContent = label;
  input.value = value;
  return new Promise((resolve) => {
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      resolve(dlg.returnValue === 'ok' ? input.value.trim() : null);
    };
    dlg.addEventListener('close', onClose);
    dlg.returnValue = '';
    dlg.showModal();
    input.select();
  });
}

export function confirmAction(text) {
  // Native confirm is synchronous and blocks; acceptable for destructive actions only.
  return globalThis.confirm ? globalThis.confirm(text) : true;
}
