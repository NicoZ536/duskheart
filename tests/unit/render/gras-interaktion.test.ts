/**
 * M5-17 „interaktives Gras (Figuren biegen es weg, Interaktionstextur)“: every figure stamps a dome of pressure into the
 * world-anchored interaction texture (src/render/surface/interactionPass.ts, shaders/world/interaction_*.frag); the
 * pressure springs back with a half-life and leaves no residue; grass and herbs bend fully, bushes are brushed, trees
 * stand (`SURFACE_PARAMS.grass.bendByKind`, carried per sprite as `bend`); the sprite program leans a sprite down the
 * slope of the pressure and presses it down where a figure stands on it.
 */
import { describe, expect, it } from 'vitest';
import { SHADERS } from '../../../src/render/shaderLib';
import { pressureAfter, pushDome } from '../../../src/render/surface/rules';
import { SURFACE_PARAMS } from '../../../src/render/surface/params';
import { BENDER_FIELDS, SurfaceState } from '../../../src/render/surface/state';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { WorldRenderTables } from '../../../src/render/world/tables';
import { WorldObjectLayer, type ObjectView } from '../../../src/render/world/objects';
import { RenderScene } from '../../../src/render/scene';
import { ChunkData } from '../../../src/world/model/chunk';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { ChunkSignatures } from '../../../src/render/world/signature';
import { INSTANCE_STRIDE, OFFSET } from '../../../src/render/batch/spriteLayout';
import { WORLD_OBJECTS } from '../../../src/content/worldObjects';

const G = SURFACE_PARAMS.grass;

describe('Interaktionstextur', () => {
  it('ein Druck-Dom: voll unter den Füßen, null am Radius, dazwischen stetig fallend', () => {
    expect(pushDome(0, G.benderRadiusPx, 1)).toBe(1);
    expect(pushDome(G.benderRadiusPx, G.benderRadiusPx, 1)).toBe(0);
    let last = 1;
    for (let d = 0; d <= G.benderRadiusPx; d += 0.5) {
      const v = pushDome(d, G.benderRadiusPx, 1);
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
    const src = SHADERS['world/interaction_stamp.frag'] ?? '';
    expect(src).toContain('float dome = 1.0 - x * x;');
  });

  it('federt mit der Halbwertszeit zurück und lässt keinen Rest', () => {
    expect(pressureAfter(1, G.springBackSeconds)).toBeCloseTo(0.5, 9);
    expect(pressureAfter(1, 0)).toBe(1);
    // Frame by frame at 60 Hz the same as at once, until the residue threshold cuts it off.
    let p = 1;
    let frames = 0;
    while (p > 0 && frames < 10_000) {
      p = pressureAfter(p, 1 / 60);
      frames++;
    }
    expect(p).toBe(0);
    expect(frames / 60).toBeLessThan(G.springBackSeconds * 12);
    const src = SHADERS['world/interaction_decay.frag'] ?? '';
    expect(src).toContain('oValue = vec4(pressure < 1.5 / 255.0 ? 0.0 : pressure, 0.0, 0.0, 1.0);');
  });

  it('nimmt Figuren bis zur Kapazität auf, ohne zu allozieren', () => {
    const s = new SurfaceState();
    const array = s.benders;
    for (let i = 0; i < G.maxBenders + 5; i++) s.addBender(i, 2 * i, G.benderRadiusPx, 1);
    expect(s.benderCount).toBe(G.maxBenders);
    expect(s.benders).toBe(array);
    expect(s.benders[3 * BENDER_FIELDS + 1]).toBe(6);
    s.beginFrame();
    expect(s.benderCount).toBe(0);
  });

  it('der Sprite-Shader neigt gegen das Gefälle und drückt nieder', () => {
    const src = SHADERS['sprite_gbuffer.vert'] ?? '';
    expect(src).toContain('vec2 lean = clamp(-vec2(gx, gy) * 1.5, vec2(-1.0), vec2(1.0));');
    expect(src).toContain('rel.y *= 1.0 - p * DH_FLATTEN_SHARE * k;');
  });
});

describe('Biegung je Objektart', () => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  const tables = new WorldRenderTables(manifestFromGenerated(mod));
  const ids = contentWorldIdTables();

  function bendOf(id: string): number {
    const chunk = new ChunkData(0, 0, 0);
    chunk.object[16 * 32 + 16] = ids.objects.runtimeId(id);
    chunk.biome.fill(ids.biomes.runtimeId('gruenhain'));
    const layer = new WorldObjectLayer(tables);
    const scene = new RenderScene();
    scene.beginFrame(0);
    const view: ObjectView = { layer: 0, chunks: { get: (_l, cx, cy) => (cx === 0 && cy === 0 ? chunk : undefined) }, signatures: new ChunkSignatures(), left: 0, top: 0, right: 512, bottom: 600, fadeX: 0, fadeY: 0, fadeRadius: 0 };
    layer.emit(scene, view);
    const u8 = new Uint8Array(scene.sprites.words.buffer);
    let best = 0;
    for (let i = 0; i < scene.sprites.count; i++) best = Math.max(best, u8[i * INSTANCE_STRIDE + OFFSET.surface + 3] ?? 0);
    return best / 255;
  }

  it('Gras und Kräuter ganz, Büsche gestreift, Bäume stehen', () => {
    const kind = (k: string): string | undefined => WORLD_OBJECTS.find((o) => o.kind === k && tables.objects.some((d) => d !== null && d.id === o.id && d.wind > 0))?.id;
    const pflanze = kind('pflanze');
    const baum = WORLD_OBJECTS.find((o) => o.kind === 'baum')?.id;
    expect(pflanze).toBeDefined();
    expect(baum).toBeDefined();
    expect(bendOf(pflanze as string)).toBeCloseTo(G.bendByKind['pflanze'] ?? 0, 2);
    expect(bendOf(baum as string)).toBe(0);
    const busch = kind('busch');
    if (busch !== undefined) expect(bendOf(busch)).toBeCloseTo(G.bendByKind['busch'] ?? 0, 2);
  });
});
