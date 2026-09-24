/**
 * The leaves a felled crown throws out wear the tree's season (the icons agent's request for
 * `partikel_blatt`): after `treeLanded` the leaf particles carry the palette row the tree itself shows in
 * that season – autumn leaves are not spring-green.
 */
import { describe, expect, it } from 'vitest';
import type { GatheringSystem } from '../../../src/game/gathering/system';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap } from '../../../src/game/sim';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { GatherEffects, PARTICLE_SPRITES } from '../../../src/render/game/effects';
import type { RenderScene } from '../../../src/render/scene';
import { WorldRenderTables } from '../../../src/render/world/tables';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const TABLES = new WorldRenderTables(MANIFEST);

describe('Laub gefällter Bäume', () => {
  it('trägt die Palettenzeile des Baums in der Jahreszeit', () => {
    const handlers = new Map<string, (e: never) => void>();
    const session = { onEvent: (type: string, h: (e: never) => void) => (handlers.set(type, h), () => handlers.delete(type)) };
    const fx = new GatherEffects();
    fx.follow(session as never);
    const landed: SimEventMap['treeLanded'] = { layer: 0, tx: 20, ty: 20, object: 'baum_eiche', direction: 'rechts', tick: 5 };
    (handlers.get('treeLanded') as (e: SimEventMap['treeLanded']) => void)(landed);
    const gathering = createSimulation({ seed: 1, worldSize: 'small' }).system('gathering') as GatheringSystem;
    const leaf = MANIFEST.sprites[PARTICLE_SPRITES.blatt];
    const leafFrames = new Set(leaf?.frames ?? []);
    const rows: number[] = [];
    const scene = {
      sprite: new SpriteDesc(),
      sprites: { push: (d: SpriteDesc) => (leafFrames.has(d.frame as never) ? rows.push(d.paletteRow) : 0) },
      worldUi: { damage: () => undefined, marker: () => undefined },
    } as unknown as RenderScene;
    const autumn = 2;
    fx.draw(scene, ATLAS, TABLES, 0, 1, autumn, gathering, null);
    const oak = TABLES.objects[contentWorldIdTables().objects.runtimeId('baum_eiche')];
    if (oak === undefined || oak === null) throw new Error('Eiche fehlt');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toBe(TABLES.objectRow(oak, autumn, 0));
    expect(TABLES.objectRow(oak, autumn, 0)).not.toBe(TABLES.objectRow(oak, 0, 0));
  });
});
