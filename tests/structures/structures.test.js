import { suite, test, assert } from '../harness.js';
import { Queue } from '../../js/structures/Queue.js';
import { MinHeap } from '../../js/structures/MinHeap.js';
import { PriorityQueue } from '../../js/structures/PriorityQueue.js';
import { DisjointSet } from '../../js/structures/DisjointSet.js';
import { SeededRandom } from '../../js/core/SeededRandom.js';

suite('Queue', () => {
  test('FIFO order and size', () => {
    const q = new Queue();
    for (let i = 0; i < 5000; i++) q.enqueue(i);
    for (let i = 0; i < 2500; i++) assert.equal(q.dequeue(), i);
    assert.equal(q.size, 2500);
    assert.equal(q.peek(), 2500);
    assert.deepEqual(q.toArray().slice(0, 2), [2500, 2501]);
  });
  test('empty dequeue returns undefined', () => {
    assert.equal(new Queue().dequeue(), undefined);
  });
});

suite('MinHeap', () => {
  test('heap sort matches Array.sort on random input', () => {
    const rng = new SeededRandom(1);
    const h = new MinHeap();
    const vals = Array.from({ length: 2000 }, () => rng.int(-1000, 1000));
    vals.forEach((v) => h.push(v));
    const out = [];
    while (!h.isEmpty()) out.push(h.pop());
    assert.deepEqual(out, [...vals].sort((a, b) => a - b));
  });
});

suite('PriorityQueue', () => {
  test('orders by priority, then tie, then tie2, then insertion', () => {
    const pq = new PriorityQueue();
    pq.push('c', 1, 2);
    pq.push('a', 1, 1, 5);
    pq.push('b', 1, 1, 3);
    pq.push('z', 0, 9);
    pq.push('d', 1, 2);
    const out = [];
    while (!pq.isEmpty()) out.push(pq.pop().value);
    assert.deepEqual(out, ['z', 'b', 'a', 'c', 'd']);
    assert.equal(pq.pushes, 5);
    assert.equal(pq.pops, 5);
  });
  test('snapshot is in pop order', () => {
    const pq = new PriorityQueue();
    [5, 3, 8, 1].forEach((p) => pq.push(p, p));
    assert.deepEqual(pq.snapshot().map((e) => e.value), [1, 3, 5, 8]);
  });
  test('stress: matches sorted order', () => {
    const rng = new SeededRandom(2);
    const pq = new PriorityQueue();
    const items = Array.from({ length: 3000 }, (_, i) => [rng.int(0, 50), i]);
    items.forEach(([p, i]) => pq.push(i, p, 0));
    const out = [];
    while (!pq.isEmpty()) out.push(pq.pop().value);
    const expected = [...items].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1])).map((x) => x[1]);
    assert.deepEqual(out, expected);
  });
});

suite('DisjointSet', () => {
  test('union/find/connected/count', () => {
    const ds = new DisjointSet(6);
    assert.ok(ds.union(0, 1));
    assert.ok(ds.union(2, 3));
    assert.ok(!ds.union(1, 0));
    assert.ok(ds.union(1, 3));
    assert.ok(ds.connected(0, 2));
    assert.ok(!ds.connected(0, 5));
    assert.equal(ds.count, 3);
    assert.equal(ds.unions, 3);
  });
  test('long chains stay correct', () => {
    const ds = new DisjointSet(10000);
    for (let i = 1; i < 10000; i++) ds.union(i - 1, i);
    assert.ok(ds.connected(0, 9999));
    assert.equal(ds.count, 1);
  });
});
