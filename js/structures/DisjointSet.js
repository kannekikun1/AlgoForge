/**
 * Disjoint-set union (union–find) over integers 0..n-1.
 * Union by rank + path halving: near-constant amortised time per operation (O(α(n))).
 * `finds` and `unions` count operations for the statistics panel.
 */
export class DisjointSet {
  /** @param {number} n @param {{finds:number,unions:number}|null} [counters] live counters */
  constructor(n, counters = null) {
    this.counters = counters;
    this.parent = new Int32Array(n);
    this.rank = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
    this.count = n;
    this.finds = 0;
    this.unions = 0;
  }

  find(x) {
    this.finds++;
    if (this.counters) this.counters.finds++;
    const p = this.parent;
    while (p[x] !== x) {
      p[x] = p[p[x]];
      x = p[x];
    }
    return x;
  }

  /** @returns {boolean} true if the sets were merged (false if already joined). */
  union(a, b) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
    this.count--;
    this.unions++;
    if (this.counters) this.counters.unions++;
    return true;
  }

  connected(a, b) { return this.find(a) === this.find(b); }
}
