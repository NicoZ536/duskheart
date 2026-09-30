/**
 * Light for the path finding (M6-28, §12.4 "Meidet Licht > 0,5"; docs/SPIEL.md §11 "Schattenbrut-Licht"): the
 * shadow brood plans around tiles brighter than its `avoidLightAbove`. The service asks a sampler once per request
 * for the tiles of the searched window; the gameplay light map (src/world/lightmap, the light system's
 * `mapFor(sim)`) is the source.
 *
 * `lightListSampler` (M6-16b/c) is the one the game uses: a tile can only be brighter than the threshold where a light
 * reaches it, as long as the ambient light cannot exceed the threshold anywhere on the layer – at night and underground,
 * when shadow brood is about. It then asks the map only for the tiles within the reach of each light of the layer
 * (a torch: 13 × 13 tiles) instead of every tile of the window (up to 5 × 5 chunks = 25 600 tiles). By day it falls back
 * to the per-tile form. Both give the same marks (tests/unit/game/schattenbrut.test.ts compares them).
 */
import type { MapLight } from '../lightmap/lightmap';
import { TILE_PX, type Layer } from '../model/coords';

/** Marks bright tiles for a path request. */
export interface PathLightSampler {
  /**
   * Sets `out[y × w + x]` to 1 for every tile (tx0 + x, ty0 + y) of the rectangle whose light level is above
   * `threshold` and to 0 for the rest.
   */
  markBright(layer: Layer, tx0: number, ty0: number, w: number, h: number, threshold: number, out: Uint8Array): void;
}

/** The part of the gameplay light map a sampler reads: the level at a tile's centre. */
export interface TileLightLevels {
  tileLevel(layer: Layer, tx: number, ty: number): number;
}

/**
 * A sampler over tile levels, one query per tile (`GameplayLightMap.tileLevel`, the value the light stage and the
 * spawn rules read). A shadow brood's window is a few chunks around it and its prey, so the per-tile form is enough.
 */
export function tileLevelSampler(levels: () => TileLightLevels): PathLightSampler {
  return {
    markBright(layer, tx0, ty0, w, h, threshold, out) {
      const map = levels();
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) out[row + x] = map.tileLevel(layer, tx0 + x, ty0 + y) > threshold ? 1 : 0;
      }
    },
  };
}

/** What `lightListSampler` reads: the light list and tile levels of the same stamp, and a bound of the ambient light. */
export interface LightListInputs {
  /** The lights of this stamp (the list the light map evaluates). */
  lights(): readonly MapLight[];
  /** Tile levels of the same stamp (ambient + lights). */
  levels(): TileLightLevels;
  /**
   * Largest ambient light any tile of `layer` can have now (§12.1: the weather only dims the day, so the calendar's
   * light without weather bounds it; caves: the cave ambient).
   */
  ambientBound(layer: Layer): number;
}

/**
 * A sampler that visits only the tiles lights reach (see module comment). Exact: a tile outside every light's radius
 * holds its ambient light alone (the falloff is zero at the radius, `lightFalloff`), which is at most the bound.
 */
export function lightListSampler(inputs: LightListInputs): PathLightSampler {
  const perTile = tileLevelSampler(inputs.levels);
  return {
    markBright(layer, tx0, ty0, w, h, threshold, out) {
      if (inputs.ambientBound(layer) > threshold) {
        perTile.markBright(layer, tx0, ty0, w, h, threshold, out);
        return;
      }
      out.fill(0, 0, w * h);
      const lights = inputs.lights();
      if (lights.length === 0) return;
      const map = inputs.levels();
      const tx1 = tx0 + w - 1;
      const ty1 = ty0 + h - 1;
      for (let k = 0; k < lights.length; k++) {
        const l = lights[k] as MapLight;
        if (l.layer !== layer || !(l.radius > 0) || !(l.intensity > 0)) continue;
        // Tiles whose centre (t + ½) lies within the radius: t from ⌊(x − r)⌋ to ⌊(x + r)⌋ in tile units.
        const r = l.radius / TILE_PX;
        const cx = l.x / TILE_PX;
        const cy = l.y / TILE_PX;
        const x0 = Math.max(tx0, Math.floor(cx - r));
        const x1 = Math.min(tx1, Math.floor(cx + r));
        const y0 = Math.max(ty0, Math.floor(cy - r));
        const y1 = Math.min(ty1, Math.floor(cy + r));
        for (let ty = y0; ty <= y1; ty++) {
          const row = (ty - ty0) * w;
          for (let tx = x0; tx <= x1; tx++) {
            const i = row + tx - tx0;
            if (out[i] === 0 && map.tileLevel(layer, tx, ty) > threshold) out[i] = 1;
          }
        }
      }
    },
  };
}
