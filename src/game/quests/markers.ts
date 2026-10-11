/**
 * Map markers of the tracked quests (MASTERPROMPT §23.3 "Aufgaben … mit Hinweisen und Kartenmarkern"; docs/SPIEL.md §23
 * "Kartenmarker (`ort` Ortstyp/Variante nächster Slot, `leuchtfeuer` Nummer, `punkt`)"; M7-42): the current step of every
 * tracked quest that names a marker becomes a derived map marker (kind `aufgabe`, symbol `karte_aufgabe`, named by the quest)
 * – read when the map or the minimap asks, never saved. Where the marker lies comes from the systems that own the place: the
 * nearest undiscovered slot of a location type (places), a beacon's site (beacons), a boss's arena (bosses).
 *
 * `questTarget` resolves one marker into a held record (no allocation); the HUD's tracker uses it for its direction arrow.
 */
import type { QuestMarker } from '../../content/quests/schema';
import type { Layer } from '../../world/model/coords';
import type { MapMarkerSource } from '../map/types';
import type { Simulation } from '../sim';
import type { QuestsSystem } from './system';

/** Map symbol of a quest target (assets-src/sprites/ui/karte_marker.ts). */
export const QUEST_MARKER_SPRITE = 'karte_aufgabe';

/** Where a marker lies [tiles]. */
export interface QuestTarget {
  layer: number;
  tx: number;
  ty: number;
}

/** The systems that know where things are (each optional: a marker without its owner is not shown). */
export interface QuestMarkerWorld {
  /** Nearest slot of location type `type` not yet known, from tile (tx, ty), into `out`; false when there is none. */
  place?(sim: Simulation, type: string, variant: string | undefined, layer: Layer, tx: number, ty: number, out: QuestTarget): boolean;
  /** Site of beacon `nummer` into `out`. */
  beacon?(sim: Simulation, nummer: number, out: QuestTarget): boolean;
  /** Arena (the boss's altar) of boss `id` into `out`. */
  boss?(sim: Simulation, id: string, out: QuestTarget): boolean;
  /** The player's layer and tile into `out` (the "nearest" of a place marker); false without a player. */
  player?(sim: Simulation, out: QuestTarget): boolean;
}

/** Resolves `marker` into `out`; false when its place is unknown. */
export function questTarget(sim: Simulation, marker: QuestMarker, world: QuestMarkerWorld, from: QuestTarget, out: QuestTarget): boolean {
  switch (marker.art) {
    case 'punkt':
      out.layer = marker.layer;
      out.tx = marker.tx;
      out.ty = marker.ty;
      return true;
    case 'leuchtfeuer':
      return world.beacon?.(sim, marker.nummer, out) ?? false;
    case 'boss':
      return world.boss?.(sim, marker.boss, out) ?? false;
    case 'ort':
      if (world.player === undefined || !world.player(sim, from)) return false;
      return world.place?.(sim, marker.ortstyp, marker.variante, from.layer as Layer, from.tx, from.ty, out) ?? false;
  }
}

/** The map marker source of the tracked quests' current steps. */
export function questMarkerSource(quests: QuestsSystem, world: QuestMarkerWorld): MapMarkerSource {
  const from: QuestTarget = { layer: 0, tx: 0, ty: 0 };
  const at: QuestTarget = { layer: 0, tx: 0, ty: 0 };
  return (sim, layer, visit) => {
    const runs = quests.runs;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i] as (typeof runs)[number];
      if (!quests.active(run) || run.state?.tracked !== true) continue;
      const marker = quests.currentStep(run)?.marker;
      if (marker === undefined || !questTarget(sim, marker, world, from, at) || at.layer !== layer) continue;
      visit('aufgabe', QUEST_MARKER_SPRITE, run.def.id, layer, at.tx, at.ty);
    }
  };
}
