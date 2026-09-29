/**
 * Placed lights on a raised level (MASTERPROMPT §4.4 height levels, §6.1 G-buffer height; M5 follow-up of the docs
 * review): the light bridge (src/render/game/lights.ts) draws a standing torch, a camp fire and a wall torch with the
 * height base of the level of their own tile (`LightFrame.levelAt` × `WAND_PX_JE_STUFE`, as stations, fire and build
 * parts do) – a wall torch higher by its wall mount. Without the level a torch on a plateau wrote the ground's height
 * into the G-buffer: lit, shadowed and outlined as if it stood a level lower.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { SpriteDesc } from '../../../src/render/batch/spriteList';
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
