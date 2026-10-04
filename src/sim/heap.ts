/**
 * Minimal binary min-heap over integer items keyed by a float priority.
 *
 * Kept allocation-free in the hot loop: both arrays grow geometrically and are
 * reused across searches via `clear()`.
 */
export class MinHeap {
  private items: Int32Array;
  private keys: Float64Array;
  private size = 0;

  constructor(capacity = 1024) {
    this.items = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  get length(): number {
    return this.size;
  }

  clear(): void {
    this.size = 0;
  }

  push(item: number, key: number): void {
    if (this.size === this.items.length) this.grow();
    let i = this.size++;
    this.items[i] = item;
    this.keys[i] = key;
    // Sift up.
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Returns the item with the smallest key, or -1 when empty. */
  pop(): number {
    if (this.size === 0) return -1;
    const top = this.items[0]!;
    this.size--;
    if (this.size > 0) {
      this.items[0] = this.items[this.size]!;
      this.keys[0] = this.keys[this.size]!;
      // Sift down.
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.size && this.keys[left]! < this.keys[smallest]!) smallest = left;
        if (right < this.size && this.keys[right]! < this.keys[smallest]!) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const item = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = item;
    const key = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = key;
  }

  private grow(): void {
    const items = new Int32Array(this.items.length * 2);
    items.set(this.items);
    this.items = items;
    const keys = new Float64Array(this.keys.length * 2);
    keys.set(this.keys);
    this.keys = keys;
  }
}
