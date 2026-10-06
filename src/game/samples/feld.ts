/**
 * Samples of the field and the fishing for the presentation (docs/SPIEL.md §30 "Render-Szenen-Teile … src/render/game/farming.ts,
 * src/render/game/fishing.ts", "Angel-Minispiel (HUD) – sampleFishing"): read-only views into the farming and fishing systems,
 * found once and kept (nothing allocates per frame).
 */
import { FarmingSystem } from '../farming/system';
import type { FarmChunk } from '../farming/store';
import type { CropDef } from '../../content/farming/schema';
import { FishingSystem, type IceHole } from '../fishing/system';
import type { FishingSample } from '../fishing/types';
import type { Simulation } from '../sim';
import type { Layer } from '../../world/model/coords';

/** A fresh fishing sample. */
export function createFishingSample(): FishingSample {
  return { phase: 'aus', floatX: 0, floatY: 0, tension: 0, pull: 0, fish: '', layer: 0, reeling: false, distance: 0, leaping: false, grund: '' };
}

/** The plots of a chunk as the renderer reads them (typed columns of the FarmStore; never write). */
export type FarmChunkView = Pick<FarmChunk, 'flags' | 'moisture' | 'crop' | 'stage' | 'pest' | 'count'>;

/** A trap as the renderer reads it. */
export interface TrapView {
  readonly tx: number;
  readonly ty: number;
  readonly fish: readonly string[];
}

/** Finds the farming and fishing systems of a simulation once. */
export class FeldSampler {
  private farming: FarmingSystem | null | undefined = undefined;
  private fishing: FishingSystem | null | undefined = undefined;

  private farm(sim: Simulation): FarmingSystem | null {
    if (this.farming === undefined) {
      const s = sim.systems.find((x) => x instanceof FarmingSystem);
      this.farming = s instanceof FarmingSystem ? s : null;
    }
    return this.farming;
  }

  private fish(sim: Simulation): FishingSystem | null {
    if (this.fishing === undefined) {
      const s = sim.systems.find((x) => x instanceof FishingSystem);
      this.fishing = s instanceof FishingSystem ? s : null;
    }
    return this.fishing;
  }

  /** The plots of chunk (layer, cx, cy), or undefined. */
  farmChunk(sim: Simulation, layer: Layer, cx: number, cy: number): FarmChunkView | undefined {
    return this.farm(sim)?.chunkAt(layer, cx, cy);
  }

  /** The crop of a farm-store crop index (index + 1), or null. */
  crop(sim: Simulation, index: number): CropDef | null {
    return this.farm(sim)?.cropAt(index) ?? null;
  }

  /** The fish traps of chunk (layer, cx, cy). */
  traps(sim: Simulation, layer: Layer, cx: number, cy: number): readonly TrapView[] {
    return this.fish(sim)?.trapsIn(layer, cx, cy) ?? NO_TRAPS;
  }

  /** Whether an open ice hole is on tile (tx, ty) today. */
  iceHole(sim: Simulation, layer: Layer, tx: number, ty: number): boolean {
    return this.fish(sim)?.holeOpen(layer, tx, ty, sim.clock.day) ?? false;
  }

  /** The ice holes cut so far (open while younger than `iceHoleDays`). */
  iceHoles(sim: Simulation): ReadonlyMap<number, IceHole> {
    return this.fish(sim)?.iceHoles ?? NO_HOLES;
  }

  /** The line (phase `aus` without one or without the system). */
  fishingLine(sim: Simulation, out: FishingSample): FishingSample {
    const f = this.fish(sim);
    if (f === null) {
      out.phase = 'aus';
      return out;
    }
    return f.sample(out);
  }
}

const NO_TRAPS: readonly TrapView[] = Object.freeze([]);
const NO_HOLES: ReadonlyMap<number, IceHole> = new Map();
