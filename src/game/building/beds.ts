/**
 * Beds on the build grid and the respawn point (MASTERPROMPT §11.5 "Bett … setzt den Wiedereinstiegspunkt", §11.6;
 * M4-34): a bed or grass bed that set the respawn point and then leaves the grid – dismantled, replaced, burned –
 * takes the respawn point with it; the next respawn is on the beach again (or another spot the player chooses).
 */
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { PartDef } from '../../world/structures/catalog';
import type { PartListener } from './system';

/** The respawn point as the death system keeps it, and how to clear it. */
export interface RespawnPointHolder {
  readonly state: { readonly respawn: { readonly x: number; readonly y: number; readonly layer: number } | null };
  clearRespawnPoint(): void;
}

/** Whether world px (x, y) lies on the footprint of `part` anchored on (tx, ty), in either orientation of its footprint. */
export function footprintCovers(part: Pick<PartDef, 'w' | 'h'>, tx: number, ty: number, x: number, y: number): boolean {
  const inside = (w: number, h: number): boolean => x >= tx * TILE_PX && x < (tx + w) * TILE_PX && y >= ty * TILE_PX && y < (ty + h) * TILE_PX;
  return inside(part.w, part.h) || inside(part.h, part.w);
}

/** A part listener that clears the respawn point when the bed it lies on leaves the grid. */
export function bedRespawnListener(death: RespawnPointHolder): PartListener {
  return {
    removed: (_sim, part, layer: Layer, tx, ty) => {
      const point = death.state.respawn;
      if (part.sleepKind === null || point === null || point.layer !== layer) return;
      if (footprintCovers(part, tx, ty, point.x, point.y)) death.clearRespawnPoint();
    },
  };
}
