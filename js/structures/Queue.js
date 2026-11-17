/**
 * FIFO queue with amortised O(1) enqueue/dequeue (head index + periodic compaction).
 */
export class Queue {
  #items = [];
  #head = 0;

  get size() { return this.#items.length - this.#head; }
  isEmpty() { return this.size === 0; }

  enqueue(v) { this.#items.push(v); }

  dequeue() {
    if (this.isEmpty()) return undefined;
    const v = this.#items[this.#head++];
    if (this.#head > 1024 && this.#head * 2 > this.#items.length) {
      this.#items = this.#items.slice(this.#head);
      this.#head = 0;
    }
    return v;
  }

  peek() { return this.isEmpty() ? undefined : this.#items[this.#head]; }

  /** Snapshot of the contents in queue order (for the state inspector). */
  toArray() { return this.#items.slice(this.#head); }
}
