/**
 * The player's graves in the game view (M3-26, MASTERPROMPT §11.6 "Grab mit Inventar … bleibt bis
 * geleert"): each grave of the death system stands where the player died as the sprite `grab` (a mound
 * with a cloth in the player's colours waving on its stake, clip `wehen`), each in its own phase; the grave
 * the interaction offers to salvage (E, use target `grab`) carries the outline (§4.6). Reads the death
 * system's state only; allocates nothing per frame.
 */
import type { DeathSystem } from '../../game/death/system';
import type { Layer } from '../../world/model/coords';
import { TILE_PX } from '../../world/model/coords';
import { clipFrameAt } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';

/** Sprite and clip of a grave (M3 art `platzierbar/grab.ts`). */
export const GRAVE_SPRITE = 'grab';
const WAVE_CLIP = 'wehen';
/** Clip phase offset per grave id [s]: two graves do not wave in step. */
const PHASE_STEP = 0.43;

export class GraveSprites {
  private manifest: AtlasManifest | null = null;
  private sprite: AtlasSprite | null = null;
  /** Graves drawn in the last frame. */
  drawn = 0;

  /** Draws the graves on `layer`; the one on tile (focusTx, focusTy) carries the outline. */
  draw(scene: RenderScene, atlas: AtlasData, death: DeathSystem, layer: Layer, time: number, focusTx: number, focusTy: number): void {
    if (this.manifest !== atlas.manifest) {
      this.manifest = atlas.manifest;
      this.sprite = atlas.manifest.sprites[GRAVE_SPRITE] ?? null;
    }
    this.drawn = 0;
    const sprite = this.sprite;
    if (sprite === null) return;
    const clip = sprite.clips[WAVE_CLIP];
    const graves = death.state.graves;
    for (let i = 0; i < graves.length; i++) {
      const g = graves[i];
      if (g === undefined || g.layer !== layer) continue;
      const d = scene.sprite.reset();
      d.frame = (sprite.frames[clip === undefined ? 0 : clipFrameAt(clip, time + g.id * PHASE_STEP)] ?? sprite.frames[0]) as SpriteFrameRef;
      d.x = Math.round(g.x);
      d.y = Math.round(g.y);
      d.outline = Math.floor(g.x / TILE_PX) === focusTx && Math.floor(g.y / TILE_PX) === focusTy;
      scene.sprites.push(d);
      this.drawn++;
    }
  }
}
