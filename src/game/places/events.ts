/**
 * Events of the places (aggregated into `SimEventMap`; docs/SPIEL.md §17 "Ereignisse zwischen Strängen", §18) – the feedback
 * of MASTERPROMPT §2.7 for §21: the music plays the discovery stinger (strand A), the chronicle, the statistics and the quests
 * count (strand G), the map sets its markers and reveals what a tower shows, the HUD tells "Entdeckt: …".
 *
 * - `placeDiscovered`: the player came within the discovery radius of a place for the first time (once per slot);
 *   `place` is the slot id, `ortstyp` its location type, `variante` the slot's variant, `biome`, the centre tile (`x`, `y`)
 *   and `layer`.
 * - `placeRevealed`: a map (map table, quest, trader) showed a place without a visit (`quelle`).
 * - `placeChestOpened`: a chest of a place opened (`chest` = its index among the place's chests, `stufe` its tier);
 *   `placeLooted`: its last chest – the place is plundered (chests never come back, §21).
 * - `placeCleansed`: the last guard of the place fell; its guards come back after `BALANCE.places.returnDays`.
 *   `placeGuardsReturned`: part of them came back (`anzahl`), the place is no longer cleansed.
 * - `towerClimbed`: the player climbed a look-out tower; the map reveals `radiusTiles` around it (centre `x`, `y` in tiles).
 * - `shrineBlessed`: a shrine gave its blessing (`zustand`, for `sekunden`).
 * - `placeNoteRead`: the player read the note of a place (farmstead, hermit's hut, graveyard); the HUD shows its text.
 * - `placeDugUp`: the shovel brought up a dig site's cache.
 * Refused commands raise `commandRejected` with a `PlaceRejectReason` (texts `ui.ort.reject.<reason>`).
 */
import type { PlaceRevealSource } from './types';

/**
 * Why a place command had no effect:
 * - `noPlayer`; `dead`, `asleep` – the player cannot act (§11.5, §11.6);
 * - `unknownPlace` – no place in that slot; `unknownMark` – the place has no such mark; `outOfReach` – farther than the
 *   interaction's reach from the mark;
 * - `chestOpen` – the chest is open already (chests never come back); `blessingCooling` – the shrine gives its blessing
 *   again only after its days (§21 "zeitweiliger Segen"); `nothingThere` – the mark has no use (a guard's spawn point).
 */
export const PLACE_REJECT_REASONS = ['noPlayer', 'dead', 'asleep', 'unknownPlace', 'unknownMark', 'outOfReach', 'chestOpen', 'blessingCooling', 'nothingThere'] as const;
/** One reason a place command was refused. */
export type PlaceRejectReason = (typeof PLACE_REJECT_REASONS)[number];

interface PlaceBase {
  /** Slot id of the place (`LocationSlot.id`). */
  readonly place: number;
  readonly ortstyp: string;
  readonly tick: number;
}

export interface PlaceEventMap {
  placeDiscovered: PlaceBase & { readonly variante: string; readonly biome: string; readonly x: number; readonly y: number; readonly layer: number };
  placeRevealed: PlaceBase & { readonly quelle: Exclude<PlaceRevealSource, 'entdeckt'> };
  placeChestOpened: PlaceBase & { readonly chest: number; readonly stufe: number; readonly tx: number; readonly ty: number };
  placeLooted: PlaceBase;
  placeCleansed: PlaceBase;
  placeGuardsReturned: PlaceBase & { readonly anzahl: number };
  towerClimbed: PlaceBase & { readonly radiusTiles: number; readonly x: number; readonly y: number; readonly layer: number };
  shrineBlessed: PlaceBase & { readonly zustand: string; readonly sekunden: number };
  placeNoteRead: PlaceBase;
  placeDugUp: PlaceBase & { readonly tx: number; readonly ty: number };
}

/** Event names of `PlaceEventMap`. */
export const PLACE_EVENT_TYPES = [
  'placeDiscovered',
  'placeRevealed',
  'placeChestOpened',
  'placeLooted',
  'placeCleansed',
  'placeGuardsReturned',
  'towerClimbed',
  'shrineBlessed',
  'placeNoteRead',
  'placeDugUp',
] as const satisfies ReadonlyArray<keyof PlaceEventMap>;

/** Sounds of the places (src/content/sfx/orte.ts; src/audio/eventMap.ts). */
export const PLACE_SFX = {
  discovered: 'sfx_ort_entdeckt',
  chest: 'sfx_ort_truhe_auf',
  tower: 'sfx_ort_aussicht',
  note: 'sfx_ort_notiz',
  cache: 'sfx_ort_fund',
  cleansed: 'sfx_ort_gesaeubert',
} as const;
