/**
 * Binary min-heap over dense node ids with decrease-key (path searches, src/world/path/search.ts). Keys live in
 * the caller's arrays: `f` (priority) and `g` (cost so far). The order is total – smaller f, then larger g (the node
 * nearer the goal), then smaller id – so the pop order, and with it every search result, depends only on the key
 * values, never on the heap's internal layout. No allocation after the arrays have grown to the node count.
 */
import { grow } from './grid';

export class NodeHeap {
  private items = new Int32Array(0);
  /** Heap position + 1 of each node (0 = not in the heap). */
  private pos = new Int32Array(0);
  private size = 0;
  private f: Int32Array = new Int32Array(0);
  private g: Int32Array = new Int32Array(0);

  /** Empties the heap for a search over `nodes` ids keyed by `f` and `g`. */
  reset(nodes: number, f: Int32Array, g: Int32Array): void {
    if (this.pos.length < nodes) {
      this.pos = new Int32Array(grow(this.pos.length, nodes));
      this.items = new Int32Array(this.pos.length);
    } else {
      for (let i = 0; i < this.size; i++) this.pos[this.items[i] as number] = 0;
    }
    this.size = 0;
    this.f = f;
    this.g = g;
  }

  get length(): number {
    return this.size;
  }

  /** Inserts `node` or moves it up after its key decreased. */
  push(node: number): void {
    const at = this.pos[node] as number;
    if (at === 0) {
      this.items[this.size] = node;
      this.pos[node] = ++this.size;
      this.up(this.size - 1);
    } else {
      this.up(at - 1);
    }
  }

  /** Removes and returns the smallest node (−1 when empty). */
  pop(): number {
    if (this.size === 0) return -1;
    const top = this.items[0] as number;
    this.pos[top] = 0;
    this.size--;
    if (this.size > 0) {
      const last = this.items[this.size] as number;
      this.items[0] = last;
      this.pos[last] = 1;
      this.down(0);
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const fa = this.f[a] as number;
    const fb = this.f[b] as number;
    if (fa !== fb) return fa < fb;
    const ga = this.g[a] as number;
    const gb = this.g[b] as number;
    if (ga !== gb) return ga > gb;
    return a < b;
  }

  private up(i: number): void {
    const items = this.items;
    const node = items[i] as number;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = items[parent] as number;
      if (!this.less(node, p)) break;
      items[i] = p;
      this.pos[p] = i + 1;
      i = parent;
    }
    items[i] = node;
    this.pos[node] = i + 1;
  }

  private down(i: number): void {
    const items = this.items;
    const n = this.size;
    const node = items[i] as number;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      let c = l;
      if (r < n && this.less(items[r] as number, items[l] as number)) c = r;
      const child = items[c] as number;
      if (!this.less(child, node)) break;
      items[i] = child;
      this.pos[child] = i + 1;
      i = c;
    }
    items[i] = node;
    this.pos[node] = i + 1;
  }
}
