/**
 * Placed lights on a raised level (MASTERPROMPT §4.4 height levels, §6.1 G-buffer height; M5 follow-up of the docs
 * review): the light bridge (src/render/game/lights.ts) draws a standing torch, a camp fire and a wall torch with the
 * height base of the level of their own tile (`LightFrame.levelAt` × `WAND_PX_JE_STUFE`, as stations, fire and build
 * parts do) – a wall torch higher by its wall mount. Without the level a torch on a plateau wrote the ground's height
 * into the G-buffer: lit, shadowed and outlined as if it stood a level lower.
 *
 * M5 review M3: drops (icon, glint and their ground shadow) and graves stand on their tile's level the same way – a
 * drop's shadow on a plateau is the plateau's ground, not a hole down to level 0.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import type { DeathSystem } from '../../../src/game/death/system';
import type { DropSystem } from '../../../src/game/drops/system';
import type { DropState } from '../../../src/game/drops/state';
import { DROP_GLINT, DROP_SHADOW_SPRITE, DropSprites, iconSprite } from '../../../src/render/game/drops';
import { GRAVE_SPRITE, GraveSprites } from '../../../src/render/game/graves';
import { createLightFrame, LightBridge, type LightFrame } from '../../../src/render/game/lights';
import { RenderScene } from '../../../src/render/scene';
import { WAND_PX_JE_STUFE } from '../../../src/world/autotile';
import { TILE_PX } from '../../../src/world/model/coords';
import { lightWorld, type LightWorld } from '../game/licht-testwelt';
import { meadow, OFFSET } from '../game/spieler-testwelt';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };

/** Drawn tiles of the three lights: a standing torch, a camp fire, a torch on the rock face of row 3. */
const STAND = { x: 12, y: 12 };
const FIRE = { x: 11, y: 10 };
const WALL = { x: 10, y: 4 };

/** A camp on a meadow with a rock at (10, 3): the three lights placed and burning. */
function camp(): LightWorld {
  const rows = meadow(24, 24);
  rows[3] = '..........#.............';
  const w = lightWorld(rows);
  w.spawn(10, 10);
  w.give('fackel', 2);
  w.give('lagerfeuer', 1);
  w.give('holz', 3);
  w.place('fackel', STAND.x, STAND.y);
  const fire = w.place('lagerfeuer', FIRE.x, FIRE.y);
  w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('holz') }]);
  w.step(1, [{ type: 'light.ignite', tx: OFFSET + FIRE.x, ty: OFFSET + FIRE.y }]);
  const wall = w.place('fackel', WALL.x, WALL.y);
  expect(w.light.placed(wall)?.mount).toBe('wand');
  return w;
}

/** The height base of every placed-light sprite drawn with `levelAt`, by the drawn tile it stands on ("x,y"). */
function heights(w: LightWorld, levelAt: LightFrame['levelAt']): Record<string, number> {
  const scene = new RenderScene();
  scene.beginFrame(0);
  const out: Record<string, number> = {};
  const push = scene.sprites.push.bind(scene.sprites);
  scene.sprites.push = (d: SpriteDesc): number => {
    // Every placed light's anchor lies inside its own tile (a wall torch a few px into it).
    out[`${Math.floor(d.x / TILE_PX) - OFFSET},${Math.floor(d.y / TILE_PX) - OFFSET}`] = d.heightBase;
    return push(d);
  };
  const frame = createLightFrame();
  frame.left = OFFSET * TILE_PX;
  frame.top = OFFSET * TILE_PX;
  frame.right = (OFFSET + 24) * TILE_PX;
  frame.bottom = (OFFSET + 24) * TILE_PX;
  frame.levelAt = levelAt;
  new LightBridge().fill(scene, ATLAS, w.sim, frame);
  return out;
}

describe('Platzierte Lichter auf ihrer Höhenebene', () => {
  it('Fackel am Pfahl, Lagerfeuer und Wandfackel stehen auf der Ebene ihrer Kachel, die Wandfackel um ihre Halterung höher', () => {
    const w = camp();
    const mount = BALANCE.light.torch.wallMountPx;
    const key = (t: { x: number; y: number }): string => `${t.x},${t.y}`;
    // Ground level: only the wall mount.
    expect(heights(w, () => 0)).toEqual({ [key(STAND)]: 0, [key(FIRE)]: 0, [key(WALL)]: mount });
    // Everything two levels up.
    expect(heights(w, () => 2)).toEqual({ [key(STAND)]: 2 * WAND_PX_JE_STUFE, [key(FIRE)]: 2 * WAND_PX_JE_STUFE, [key(WALL)]: 2 * WAND_PX_JE_STUFE + mount });
    // Each light asks its own tile: only the standing torch's tile is raised.
    const raised = heights(w, (tx, ty) => (tx === OFFSET + STAND.x && ty === OFFSET + STAND.y ? 1 : 0));
    expect(raised).toEqual({ [key(STAND)]: WAND_PX_JE_STUFE, [key(FIRE)]: 0, [key(WALL)]: mount });
  });
});

/** A scene that records the height base of every sprite pushed, by sprite id (first of each id). */
function recordingHeights(): { scene: RenderScene; heights: Map<string, number[]> } {
  const owner = new Map<unknown, string>();
  for (const sp of Object.values(MANIFEST.sprites)) for (const f of sp.frames) owner.set(f, sp.id);
  const heights = new Map<string, number[]>();
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc): number {
        const id = owner.get(d.frame) ?? '?';
        heights.set(id, [...(heights.get(id) ?? []), d.heightBase]);
        return 0;
      },
    },
  } as unknown as RenderScene;
  return { scene, heights };
}

/** A drop of `item` lying (or `flying`) at world px (x, y) on layer 0. */
function drop(item: string, x: number, y: number, flying: boolean): DropState {
  return { stack: { item, count: 1 }, layer: 0, x, y, prevX: x, prevY: y, fromX: x, fromY: y, toX: x, toY: y, flightTicks: flying ? 5 : 0, flightTotal: flying ? 20 : 0, settleTicks: 0, expiresAtTick: 1e9, pulled: false, blocked: false } as DropState;
}

describe('Drops und Gräber auf ihrer Höhenebene (M5-Review M3)', () => {
  const ITEM = 'steinaxt';
  /** Tile (3, 5) is two levels up, everything else level 0. */
  const levelAt = (tx: number, ty: number): number => (tx === 3 && ty === 5 ? 2 : 0);
  const onPlateau = drop(ITEM, 3.5 * TILE_PX, 5.5 * TILE_PX, false);
  const below = drop(ITEM, 8.5 * TILE_PX, 5.5 * TILE_PX, false);

  it('Symbol, Glitzern und Bodenschatten eines Drops tragen die Ebene seiner Kachel', () => {
    expect(MANIFEST.sprites[iconSprite(ITEM)]).toBeDefined();
    const store = { size: 1, valueAt: () => onPlateau, entityAt: () => 1 };
    const sprites = new DropSprites();
    sprites.levelAt = levelAt;
    const r = recordingHeights();
    // Dark everywhere: the glint is drawn too.
    sprites.draw(r.scene, ATLAS, { store } as unknown as DropSystem, 0, 0, 0, 0, () => true);
    const plateau = 2 * WAND_PX_JE_STUFE;
    // The ground shadow lies on the plateau's ground; icon and glint stand above it by their lift.
    expect(r.heights.get(DROP_SHADOW_SPRITE)).toEqual([plateau]);
    const [icon] = r.heights.get(iconSprite(ITEM)) ?? [];
    expect(icon).toBeGreaterThan(plateau);
    expect(icon).toBeLessThan(plateau + WAND_PX_JE_STUFE);
    expect(r.heights.get(DROP_GLINT.sprite)).toEqual([(icon ?? 0) + DROP_GLINT.offsetY]);
  });

  it('ein Drop daneben auf Ebene 0 und ohne Gelände (Standard) bleibt unten', () => {
    const lower = new DropSprites();
    lower.levelAt = levelAt;
    const r = recordingHeights();
    lower.draw(r.scene, ATLAS, { store: { size: 1, valueAt: () => below, entityAt: () => 1 } } as unknown as DropSystem, 0, 0, 0, 0, null);
    expect(r.heights.get(DROP_SHADOW_SPRITE)).toEqual([0]);
    const plain = recordingHeights();
    new DropSprites().draw(plain.scene, ATLAS, { store: { size: 1, valueAt: () => onPlateau, entityAt: () => 1 } } as unknown as DropSystem, 0, 0, 0, 0, null);
    expect(plain.heights.get(DROP_SHADOW_SPRITE)).toEqual([0]);
    expect(plain.heights.get(iconSprite(ITEM))).toEqual(r.heights.get(iconSprite(ITEM)));
  });

  it('ein fliegender Drop steht über der Ebene seiner Bodenspur', () => {
    const sprites = new DropSprites();
    sprites.levelAt = levelAt;
    const r = recordingHeights();
    sprites.draw(r.scene, ATLAS, { store: { size: 1, valueAt: () => drop(ITEM, 3.5 * TILE_PX, 5.5 * TILE_PX, true), entityAt: () => 1 } } as unknown as DropSystem, 0, 0, 0, 0, null);
    expect(r.heights.get(DROP_SHADOW_SPRITE)).toEqual([2 * WAND_PX_JE_STUFE]);
    expect(r.heights.get(iconSprite(ITEM))?.[0]).toBeGreaterThan(2 * WAND_PX_JE_STUFE);
  });

  it('ein Grab steht auf der Ebene seiner Kachel', () => {
    const graves = [
      { id: 1, layer: 0, x: 3.5 * TILE_PX, y: 5.5 * TILE_PX },
      { id: 2, layer: 0, x: 8.5 * TILE_PX, y: 5.5 * TILE_PX },
    ];
    const death = { state: { graves } } as unknown as DeathSystem;
    const g = new GraveSprites();
    g.levelAt = levelAt;
    const r = recordingHeights();
    g.draw(r.scene, ATLAS, death, 0, 0, -1, -1);
    expect(r.heights.get(GRAVE_SPRITE)).toEqual([2 * WAND_PX_JE_STUFE, 0]);
    const plain = recordingHeights();
    new GraveSprites().draw(plain.scene, ATLAS, death, 0, 0, -1, -1);
    expect(plain.heights.get(GRAVE_SPRITE)).toEqual([0, 0]);
  });
});
