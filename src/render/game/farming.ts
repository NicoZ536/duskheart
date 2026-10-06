/**
 * The fields in the game view (docs/SPIEL.md §30 "src/render/game/farming.ts (Pflanzenstufen y-sortiert, feuchter Acker,
 * Schädlinge)"; M7-19 … M7-22): for every plot of the chunks around the view (`GameSession.sampleFarmChunk`, the farm
 * store's typed columns, read only):
 * - moist soil (moisture ≥ `WET_MOISTURE`): the dark furrows `feld_nass` on the ground layer over the field;
 * - the crop: `feldfrucht_<id>`, frame = its stage; a dead plant `feldfrucht_<id>_welk`; y-sorted with the objects, its foot
 *   on the tile's lower edge (in front of a garden bed's rim), swaying in the wind like grass;
 * - pests: crows pecking at the plot (`feld_kraehe`, clip `picken`), a white bloom of mildew over the plant.
 * Hares leave no mark of their own (the plant fell back a stage). Allocates nothing per frame.
 */
import { CROPS } from '../../content/farming/index';
import { PLOT } from '../../game/farming/store';
import { PESTS } from '../../game/farming/types';
import type { GameSession } from '../../game/session';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { CHUNK_AREA, CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import { clipFrameAt } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';

/** Moisture from which the soil shows dark and wet [0–100]: above the growth threshold (20) with room for a dry spell. */
export const WET_MOISTURE = 40;
/** The crop's foot below the tile's top edge [px]: on the lower edge, in front of a garden bed's rim (anchor row 14). */
const FOOT_PX = 15;
/** Sway of a crop in the wind [px at its top]: like tall grass. */
const CROP_WIND = 0.6;
const CROW = PESTS.indexOf('kraehen');
const MILDEW = PESTS.indexOf('mehltau');
/** The crow sits beside the plant [px]. */
const CROW_DX = 4;
/** The mildew bloom over the plant's middle [px above the foot]. */
const MILDEW_LIFT = 5;

/** What the field and fishing views read of the session (src/game/samples/feld.ts). */
export type FeldSession = Pick<GameSession, 'sim' | 'sampleFarmChunk' | 'farmCrop' | 'sampleFishing' | 'sampleFishTraps' | 'sampleIceHoles'>;

/** Whether `session` offers the field samples (a test session may not). */
export function isFeldSession(session: Partial<FeldSession>): session is FeldSession {
  return session.sim !== undefined && session.sampleFarmChunk !== undefined && session.sampleFishing !== undefined && session.sampleFishTraps !== undefined && session.sampleIceHoles !== undefined && session.farmCrop !== undefined;
}

/** What the field view draws in a frame. */
export interface FarmFrame {
  layer: Layer;
  left: number;
  top: number;
  right: number;
  bottom: number;
  time: number;
  /** Height level of tile (tx, ty) of the layer drawn (the game view's terrain). */
  levelAt: (tx: number, ty: number) => number;
}

export function createFarmFrame(): FarmFrame {
  return { layer: 0, left: 0, top: 0, right: 0, bottom: 0, time: 0, levelAt: () => 0 };
}

export class FarmView {
  private manifest: AtlasManifest | null = null;
  /** Crop sprites by farm-store crop index (index + 1; 0 unused). */
  private readonly crops: (AtlasSprite | null)[] = new Array<AtlasSprite | null>(CROPS.length + 1).fill(null);
  private readonly wilted: (AtlasSprite | null)[] = new Array<AtlasSprite | null>(CROPS.length + 1).fill(null);
  private wet: AtlasSprite | null = null;
  private crow: AtlasSprite | null = null;
  private mildew: AtlasSprite | null = null;
  /** Plants drawn in the last frame. */
  drawn = 0;

  private bind(manifest: AtlasManifest): void {
    this.manifest = manifest;
    for (let k = 0; k < CROPS.length; k++) {
      const id = (CROPS[k] as (typeof CROPS)[number]).id;
      this.crops[k + 1] = manifest.sprites[`feldfrucht_${id}`] ?? null;
      this.wilted[k + 1] = manifest.sprites[`feldfrucht_${id}_welk`] ?? null;
    }
    this.wet = manifest.sprites['feld_nass'] ?? null;
    this.crow = manifest.sprites['feld_kraehe'] ?? null;
    this.mildew = manifest.sprites['feld_mehltau'] ?? null;
  }

  draw(scene: RenderScene, atlas: AtlasData, session: FeldSession, f: FarmFrame): void {
    if (this.manifest !== atlas.manifest) this.bind(atlas.manifest);
    this.drawn = 0;
    const cx0 = Math.floor(f.left / TILE_PX) >> CHUNK_SHIFT;
    const cx1 = Math.floor(f.right / TILE_PX) >> CHUNK_SHIFT;
    const cy0 = Math.floor(f.top / TILE_PX) >> CHUNK_SHIFT;
    const cy1 = Math.floor((f.bottom + TILE_PX * 2) / TILE_PX) >> CHUNK_SHIFT;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = session.sampleFarmChunk(f.layer, cx, cy);
        if (c === undefined || c.count === 0) continue;
        const x0 = cx << CHUNK_SHIFT;
        const y0 = cy << CHUNK_SHIFT;
        for (let i = 0; i < CHUNK_AREA; i++) {
          const flags = c.flags[i] as number;
          if ((flags & PLOT.present) === 0) continue;
          const tx = x0 + (i & CHUNK_MASK);
          const ty = y0 + (i >> CHUNK_SHIFT);
          const px = tx * TILE_PX;
          const py = ty * TILE_PX;
          if (px + TILE_PX < f.left || px > f.right || py + TILE_PX * 2 < f.top || py > f.bottom) continue;
          const level = f.levelAt(tx, ty) * WAND_PX_JE_STUFE;
          // Wet soil: the furrows on the ground (not under a garden bed's frame: the bed shows its own soil).
          if ((c.moisture[i] as number) >= WET_MOISTURE && (flags & PLOT.beet) === 0 && this.wet !== null) {
            const d = scene.sprite.reset();
            d.frame = this.wet.frames[0] as SpriteFrameRef;
            d.x = px;
            d.y = py;
            d.layer = 'ground';
            d.heightBase = level;
            scene.sprites.push(d);
          }
          const crop = c.crop[i] as number;
          if (crop === 0) continue;
          const dead = (flags & PLOT.dead) !== 0;
          const sprite = dead ? this.wilted[crop] : this.crops[crop];
          if (sprite === null || sprite === undefined) continue;
          const stage = c.stage[i] as number;
          const d = scene.sprite.reset();
          d.frame = (dead ? sprite.frames[0] : (sprite.frames[stage] ?? sprite.frames[sprite.frames.length - 1])) as SpriteFrameRef;
          d.x = px + TILE_PX / 2;
          d.y = py + FOOT_PX;
          d.heightBase = level;
          d.windAmplitude = dead ? 0 : CROP_WIND;
          d.windPhase = (tx * 7 + ty * 13) * 0.37;
          d.weathered = true;
          scene.sprites.push(d);
          this.drawn++;
          const pest = c.pest[i] as number;
          if (pest === CROW && this.crow !== null) {
            const clip = this.crow.clips['picken'];
            const e = scene.sprite.reset();
            e.frame = (this.crow.frames[clip === undefined ? 0 : clipFrameAt(clip, f.time + tx * 0.31)] ?? this.crow.frames[0]) as SpriteFrameRef;
            e.x = px + TILE_PX / 2 + CROW_DX;
            e.y = py + FOOT_PX + 0.5;
            e.heightBase = level;
            scene.sprites.push(e);
          } else if (pest === MILDEW && this.mildew !== null && !dead) {
            const e = scene.sprite.reset();
            e.frame = this.mildew.frames[0] as SpriteFrameRef;
            e.x = px + TILE_PX / 2;
            e.y = py + FOOT_PX - MILDEW_LIFT;
            e.depth = py + FOOT_PX + 0.25;
            e.heightBase = level;
            scene.sprites.push(e);
          }
        }
      }
    }
  }
}
