/**
 * M1-15: y-sort + layer order – ground → water → objects → canopy, within a layer by anchor depth,
 * equal depths in submission order (stable, frame after frame).
 */
import { describe, expect, it } from 'vitest';
import { LAYER } from '../../../src/render/batch/spriteLayout';
import { SpriteDesc, SpriteList } from '../../../src/render/batch/spriteList';
import { DEPTH_STEPS_PER_PX, YSorter } from '../../../src/render/sort/ysort';
import { Rng } from '../../../src/engine/rng';

const FRAME = { x: 0, y: 0, w: 16, h: 16, ax: 8, ay: 15 };

function order(layers: number[], depths: number[]): number[] {
  const s = new YSorter();
  return [...s.sort(layers, depths, layers.length).subarray(0, layers.length)];
}

describe('y-Sortierung', () => {
  it('sorts by layer first, then by depth', () => {
    const layers = [LAYER.canopy, LAYER.objects, LAYER.ground, LAYER.water, LAYER.objects];
    const depths = [0, 50, 100, 70, 10];
    expect(order(layers, depths)).toEqual([2, 3, 4, 1, 0]);
  });

  it('is stable: equal depths keep submission order, also after many frames', () => {
    const layers = new Array(9).fill(LAYER.objects) as number[];
    const depths = [5, 3, 5, 3, 5, 3, 7, 7, 7];
    const expected = [1, 3, 5, 0, 2, 4, 6, 7, 8];
    const s = new YSorter();
    for (let frame = 0; frame < 5; frame++) expect([...s.sort(layers, depths, 9).subarray(0, 9)]).toEqual(expected);
  });

  it('matches a stable reference sort on random data (negative, fractional and large depths)', () => {
    const rng = new Rng(4242);
    const n = 3000;
    const layers: number[] = [];
    const depths: number[] = [];
    for (let i = 0; i < n; i++) {
      layers.push(Math.floor(rng.next() * 4));
      // Quantised to the sort resolution so the reference compares the same keys.
      depths.push(Math.round((rng.next() * 4000 - 2000) * DEPTH_STEPS_PER_PX) / DEPTH_STEPS_PER_PX);
    }
    const reference = [...Array(n).keys()].sort((a, b) => (layers[a] ?? 0) - (layers[b] ?? 0) || (depths[a] ?? 0) - (depths[b] ?? 0) || a - b);
    expect(order(layers, depths)).toEqual(reference);
  });

  it('reports layer ranges', () => {
    const s = new YSorter();
    s.sort([LAYER.objects, LAYER.ground, LAYER.objects, LAYER.canopy], [1, 2, 3, 4], 4);
    expect([...s.layerStart]).toEqual([0, 1, 1, 3]);
    expect([...s.layerCount]).toEqual([1, 0, 2, 1]);
  });

  it('SpriteList uses the anchor y as depth unless a depth is given', () => {
    const list = new SpriteList(4);
    const d = new SpriteDesc();
    d.frame = FRAME;
    d.y = 42.5;
    list.push(d);
    d.depth = 7;
    list.push(d);
    expect([...list.depthKeys.subarray(0, 2)]).toEqual([42.5, 7]);
    expect(list.layerKeys[0]).toBe(LAYER.objects);
  });

  it('a figure standing lower on screen is drawn after (in front of) the tree', () => {
    const list = new SpriteList(4);
    const d = new SpriteDesc();
    d.frame = FRAME;
    d.y = 30; // tree anchor
    list.push(d);
    d.y = 40; // figure in front
    list.push(d);
    d.y = 20; // figure behind
    list.push(d);
    expect([...new YSorter().sort(list.layerKeys, list.depthKeys, 3).subarray(0, 3)]).toEqual([2, 0, 1]);
  });
});
