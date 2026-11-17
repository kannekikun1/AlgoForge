/**
 * Minimal promise wrapper around IndexedDB with an in-memory fallback.
 *
 * Object stores: 'graphs' and 'experiments', both keyed by `id`.
 * When IndexedDB is unavailable (private browsing in some browsers, file:// origins, tests),
 * a MemoryAdapter with the same interface is used and `persistent` is false.
 */
export const DB_NAME = 'algoforge';
export const DB_VERSION = 1;
export const STORES = Object.freeze(['graphs', 'experiments']);

export class IndexedDBAdapter {
  constructor(name = DB_NAME, idb = globalThis.indexedDB) {
    this.name = name;
    this.idb = idb;
    this.db = null;
    this.persistent = true;
  }

  async open() {
    if (this.db) return this;
    this.db = await new Promise((resolve, reject) => {
      const req = this.idb.open(this.name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB open blocked.'));
    });
    return this;
  }

  #tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      const req = fn(os);
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted (storage quota?)'));
    });
  }

  put(store, value) { return this.#tx(store, 'readwrite', (os) => os.put(value)); }
  get(store, id) { return this.#tx(store, 'readonly', (os) => os.get(id)); }
  delete(store, id) { return this.#tx(store, 'readwrite', (os) => os.delete(id)); }
  getAll(store) { return this.#tx(store, 'readonly', (os) => os.getAll()); }
  clear(store) { return this.#tx(store, 'readwrite', (os) => os.clear()); }
}

export class MemoryAdapter {
  constructor() {
    this.stores = new Map(STORES.map((s) => [s, new Map()]));
    this.persistent = false;
  }

  async open() { return this; }
  async put(store, value) { this.stores.get(store).set(value.id, structuredCloneSafe(value)); return value.id; }
  async get(store, id) { const v = this.stores.get(store).get(id); return v ? structuredCloneSafe(v) : undefined; }
  async delete(store, id) { this.stores.get(store).delete(id); }
  async getAll(store) { return [...this.stores.get(store).values()].map(structuredCloneSafe); }
  async clear(store) { this.stores.get(store).clear(); }
}

function structuredCloneSafe(v) {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}
