/**
 * M5-19 „Laub-Palettenzeilen mit Übergang über 2 Tage“: the foliage blend around a change of seasons – from one day
 * before a season begins to one day into it, continuous and monotone – and how the object layer turns it into sprites:
 * one frame for both seasons → the second palette row takes over pixel by pixel; a leafy and a bare frame (a
 * deciduous tree going into winter) → the bare frame below, the leafy one on top shedding its canopy pixels.
 */
import { describe, expect, it } from 'vitest';
import { foliageBlend, type SeasonBlend } from '../../../src/render/surface/season';
import { SURFACE_PARAMS } from '../../../src/render/surface/params';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { WorldRenderTables } from '../../../src/render/world/tables';
import { WorldObjectLayer, type ObjectView } from '../../../src/render/world/objects';
import { RenderScene } from '../../../src/render/scene';
import { ChunkData } from '../../../src/world/model/chunk';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { ChunkSignatures } from '../../../src/render/world/signature';
import { SURFACE_FLAG, OFFSET, INSTANCE_STRIDE } from '../../../src/render/batch/spriteLayout';

const LENGTH = 7;

function blend(season: number, day: number, fraction: number): SeasonBlend {
  return foliageBlend(season, day, fraction, LENGTH, { from: 0, to: -1, progress: 0 });
}

/** Absolute position [days since spring day 1, 00:00] → blend. */
function at(t: number): SeasonBlend {
  const season = Math.floor(t / LENGTH) % 4;
  const within = t - Math.floor(t / LENGTH) * LENGTH;
  return blend(season, Math.floor(within) + 1, within - Math.floor(within));
}

describe('Laubwechsel der Jahreszeiten', () => {
  it('lasts two days, centred on the change of season', () => {
    expect(SURFACE_PARAMS.seasons.transitionDays).toBe(2);
    expect(blend(1, 3, 0.5)).toEqual({ from: 1, to: -1, progress: 0 });
    // Summer → autumn: starts one day before autumn day 1, is half-way at midnight, done a day into autumn.
    expect(at(2 * LENGTH - 1.0001).to).toBe(-1);
    const start = at(2 * LENGTH - 0.999);
    expect([start.from, start.to]).toEqual([1, 2]);
    expect(start.progress).toBeCloseTo(0, 2);
    const mid = at(2 * LENGTH);
    expect([mid.from, mid.to]).toEqual([1, 2]);
    expect(mid.progress).toBeCloseTo(0.5, 12);
    const late = at(2 * LENGTH + 0.999);
    expect(late.progress).toBeCloseTo(1, 2);
    expect(at(2 * LENGTH + 1.0001).to).toBe(-1);
  });

  it('runs continuously and monotonously, winter → spring included', () => {
    for (const change of [1, 2, 3, 4]) {
      let last = -1;
      for (let k = 0; k <= 200; k++) {
        const t = change * LENGTH - 1 + (k / 200) * 2 - 1e-9;
        const b = at(t);
        if (b.to < 0) continue;
        expect(b.to).toBe((b.from + 1) % 4);
        if (last >= 0) {
          expect(b.progress).toBeGreaterThanOrEqual(last - 1e-9);
          expect(b.progress - last).toBeLessThan(0.02);
        }
        last = b.progress;
      }
      expect(last).toBeGreaterThan(0.99);
    }
  });

  it('fits into short seasons (3 days)', () => {
    const b = foliageBlend(0, 1, 0, 3, { from: 0, to: -1, progress: 0 });
    expect([b.from, b.to, b.progress]).toEqual([3, 0, 0.5]);
  });
});

describe('Objektschicht im Jahreszeitenwechsel', () => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  const manifest = manifestFromGenerated(mod);
  const tables = new WorldRenderTables(manifest);
  const ids = contentWorldIdTables();

  /** A chunk with one object `id` in its middle, the scene after emitting it with the given season blend. */
  function emit(id: string, season: number, from: number, to: number, progress: number): RenderScene {
    const chunk = new ChunkData(0, 0, 0);
    chunk.object[16 * 32 + 16] = ids.objects.runtimeId(id);
    chunk.biome.fill(ids.biomes.runtimeId('gruenhain'));
    const layer = new WorldObjectLayer(tables);
    layer.season = season;
    const scene = new RenderScene();
    scene.beginFrame(0);
    scene.surface.seasonFrom = from;
    scene.surface.seasonTo = to;
    scene.surface.seasonProgress = progress;
    const view: ObjectView = { layer: 0, chunks: { get: (_l, cx, cy) => (cx === 0 && cy === 0 ? chunk : undefined) }, signatures: new ChunkSignatures(), left: 0, top: 0, right: 512, bottom: 600, fadeX: 0, fadeY: 0, fadeRadius: 0 };
    layer.emit(scene, view);
    return scene;
  }

  function surfaceOf(scene: RenderScene, i: number): number[] {
    const u8 = new Uint8Array(scene.sprites.words.buffer);
    return [...u8.subarray(i * INSTANCE_STRIDE + OFFSET.surface, i * INSTANCE_STRIDE + OFFSET.surface + 4)];
  }

  it('a tree whose frame stays turns to the next row: row 2 = the next season, blend = progress', () => {
    const def = tables.objects[ids.objects.runtimeId('baum_eiche')];
    if (def === null || def === undefined) throw new Error('baum_eiche fehlt');
    expect(def.seasonFrames[1]).toBe(def.seasonFrames[2]);
    const scene = emit('baum_eiche', 1, 1, 2, 0.4);
    expect(scene.sprites.count).toBe(1);
    const [row2, blendByte, flags] = surfaceOf(scene, 0);
    expect(row2).toBe(tables.objectRow(def, 2, ids.biomes.runtimeId('gruenhain')));
    expect(blendByte).toBe(Math.round(0.4 * 255));
    expect((flags ?? 0) & SURFACE_FLAG.swap).toBe(SURFACE_FLAG.swap);
    expect((flags ?? 0) & SURFACE_FLAG.weathered).toBe(SURFACE_FLAG.weathered);
  });

  it('into winter a deciduous tree stands bare below while its leafy frame sheds on top', () => {
    const def = tables.objects[ids.objects.runtimeId('baum_eiche')];
    if (def === null || def === undefined) throw new Error('baum_eiche fehlt');
    expect(def.seasonFrames[2]).not.toBe(def.seasonFrames[3]);
    const scene = emit('baum_eiche', 2, 2, 3, 0.32);
    expect(scene.sprites.count).toBe(2);
    const [, blendTop, flagsTop] = surfaceOf(scene, 1);
    expect((flagsTop ?? 0) & SURFACE_FLAG.shed).toBe(SURFACE_FLAG.shed);
    expect(blendTop).toBe(Math.round(0.32 * 255));
    expect((surfaceOf(scene, 0)[2] ?? 0) & SURFACE_FLAG.shed).toBe(0);
    // Out of winter the leaves bud: the leafy frame sheds less as the change goes on.
    const spring = emit('baum_eiche', 0, 3, 0, 0.32);
    expect(spring.sprites.count).toBe(2);
    expect(surfaceOf(spring, 1)[1]).toBe(Math.round(0.68 * 255));
  });

  it('outside a change nothing is blended', () => {
    const scene = emit('baum_eiche', 1, 1, -1, 0);
    expect(scene.sprites.count).toBe(1);
    expect(surfaceOf(scene, 0).slice(0, 2)).toEqual([0, 0]);
  });
});
