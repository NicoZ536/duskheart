/**
 * M1-15/M1-28: y-sort + layer order – ground → water → objects → canopy, within a layer by anchor
 * depth, equal depths in submission order (stable, frame after frame). The compact radix keys (depth
 * bits sized to the frame's depth range, the range tracked by `SpriteList` while pushing) sort exactly
 * like a reference sort, for narrow and very wide ranges alike.
 */
import { describe, expect, it } from 'vitest';
import { LAYER, SPRITE_LAYERS } from '../../../src/render/batch/spriteLayout';
import { SpriteDesc, SpriteList } from '../../../src/render/batch/spriteList';
import { DEPTH_STEPS_PER_PX, YSorter } from '../../../src/render/sort/ysort';
import { Rng } from '../../../src/engine/rng';

const FRAME = { x: 0, y: 0, w: 16, h: 16, ax: 8, ay: 15 };

function order(layers: number[], depths: number[]): number[] {
  const s = new YSorter();
  return [...s.sort(layers, depths, layers.length).subarray(0, layers.length)];
}

function reference(layers: readonly number[], depths: readonly number[]): number[] {
  return [...Array(layers.length).keys()].sort((a, b) => (layers[a] ?? 0) - (layers[b] ?? 0) || (depths[a] ?? 0) - (depths[b] ?? 0) || a - b);
}

/** Random layers and depths over `span` px, quantised to the sort resolution. */
function randomSprites(seed: number, n: number, span: number): { layers: number[]; depths: number[] } {
  const rng = new Rng(seed);
  const layers: number[] = [];
  const depths: number[] = [];
  for (let i = 0; i < n; i++) {
    layers.push(Math.floor(rng.next() * 4));
    depths.push(Math.round((rng.next() - 0.5) * span * DEPTH_STEPS_PER_PX) / DEPTH_STEPS_PER_PX);
  }
  return { layers, depths };
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

  it('matches a stable reference sort on random data (negative, fractional, narrow and very wide ranges)', () => {
    // 248 px (the stress scene: two radix passes), 4 000 px, 3 million px (all four digits).
    for (const [seed, span] of [[4242, 248], [7, 4000], [99, 3_000_000]] as const) {
      const { layers, depths } = randomSprites(seed, 3000, span);
      expect(order(layers, depths), `Spanne ${span}`).toEqual(reference(layers, depths));
    }
  });

  it('sorts with the depth range SpriteList tracked exactly as with the range it finds itself', () => {
    const { layers, depths } = randomSprites(5, 2000, 600);
    const list = new SpriteList(16);
    const d = new SpriteDesc();
    d.frame = FRAME;
    for (let i = 0; i < layers.length; i++) {
      d.layer = SPRITE_LAYERS[layers[i] ?? 0] ?? 'objects';
      d.y = depths[i] ?? 0;
      list.push(d);
    }
    expect(list.depthMin).toBe(Math.min(...depths));
    expect(list.depthMax).toBe(Math.max(...depths));
    const s = new YSorter();
    const tracked = [...s.sort(list.layerKeys, list.depthKeys, list.count, list.depthMin, list.depthMax).subarray(0, list.count)];
    expect(tracked).toEqual(reference(layers, depths));
    list.clear();
    expect([list.depthMin, list.depthMax]).toEqual([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
  });

  it('keeps the layer order when the given range is too narrow; non-finite depths go first in their layer', () => {
    const layers = [LAYER.canopy, LAYER.objects, LAYER.objects, LAYER.ground, LAYER.objects, LAYER.objects];
    const depths = [0, 900, 5, 10, Number.NaN, Number.NEGATIVE_INFINITY];
    // The caller claims a range of 0…8 px: depth 900 must not spill into the layer bits.
    const s = new YSorter();
    expect([...s.sort(layers, depths, 6, 0, 8).subarray(0, 6)]).toEqual([3, 4, 5, 2, 1, 0]);
    expect([...s.layerCount]).toEqual([1, 0, 4, 1]);
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
