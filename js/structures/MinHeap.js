/**
 * Generic binary min-heap ordered by a comparator.
 * push/pop: O(log n); peek: O(1).
 */
export class MinHeap {
  /** @param {(a:any,b:any)=>number} compare */
  constructor(compare = (a, b) => a - b) {
    this.compare = compare;
    this.items = [];
  }

  get size() { return this.items.length; }
  isEmpty() { return this.items.length === 0; }
  peek() { return this.items[0]; }

  push(v) {
    const a = this.items;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.compare(a[i], a[p]) >= 0) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < n && this.compare(a[l], a[s]) < 0) s = l;
        if (r < n && this.compare(a[r], a[s]) < 0) s = r;
        if (s === i) break;
        [a[i], a[s]] = [a[s], a[i]];
        i = s;
      }
    }
    return top;
  }

  /** Sorted copy of the contents (O(n log n); inspector use only). */
  toSortedArray() { return [...this.items].sort(this.compare); }
}
