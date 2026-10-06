/**
 * Events of farming (docs/SPIEL.md §17 "Ereignisse zwischen Strängen", §20; M7-19 … M7-23). Aggregated into `SimEventMap`; the
 * presentation reads them after the tick (sounds of src/audio/eventMap.ts, the field's particles), the observers count and
 * tell them (statistics `geerntet`, chronicle, Funke; src/content/{stats,chronik,guide}/feld.ts).
 *
 * - `plotCreated` / `plotRemoved`: a plot came to be (the hoe tilled a field, a garden bed was placed) or went (filled in,
 *   built over, the bed taken down; `reason`).
 * - `cropPlanted`: a seed was sown on a plot. `cropRipe`: a plant reached its ripe stage at a dawn. `cropHarvested`: a ripe crop was harvested – `qualitaet` 1–3 (Normal, Silver,
 *   Gold), `anzahl` pieces of the harvest. `cropDied`: a plant died – `grund` frost, mildew, crows (a seed eaten) or the
 *   season (a tender plant in winter out of doors is frost too); `cropCleared`: E cleared a dead plant away.
 * - `plotWatered` (the can), `plotFertilized` (compost, bone meal, herb brew – `item`), `pestAppeared` (`art`: crows, hares,
 *   mildew) and `pestCured` (herb brew on mildew).
 * - `canFilled`: the watering can was filled at fresh water.
 * - `saplingPlanted`: a sapling went into the ground (`object` = the tree it grows into); `saplingGrown`: it became a tree.
 * - `wormFound`: hoeing turned up an earthworm (its drop follows as `dropSpawned`).
 * Refused commands and item uses raise `commandRejected` with a `FarmRejectReason` (texts `ui.tools.reject.<reason>` for
 * `player.useItem`, `ui.feld.reject.<reason>` for the field's own commands).
 * Catching up a frozen field is silent: what grew, dried or died there while nobody looked raises no event.
 */
import type { Layer } from '../../world/model/coords';
import type { Pest } from './types';

/** Why a field action was refused. */
export const FARM_REJECT_REASONS = [
  'noPlot',
  'plotOccupied',
  'notRipe',
  'canEmpty',
  'canFull',
  'soilWet',
  'cannotPlant',
  'notFresh',
  'notWater',
  'noMildew',
] as const;
/** One reason. */
export type FarmRejectReason = (typeof FARM_REJECT_REASONS)[number];

/** Why a plot went away. */
export type PlotRemoveReason = 'zugeschuettet' | 'ueberbaut' | 'abgebaut';
/** Why a plant died. */
export const CROP_DEATH_CAUSES = ['frost', 'mehltau', 'kraehen'] as const;
export type CropDeathCause = (typeof CROP_DEATH_CAUSES)[number];

interface Tile {
  readonly layer: Layer;
  readonly tx: number;
  readonly ty: number;
  readonly tick: number;
}

export interface FarmingEventMap {
  plotCreated: Tile & { readonly beet: boolean };
  plotRemoved: Tile & { readonly reason: PlotRemoveReason };
  cropPlanted: Tile & { readonly crop: string };
  cropRipe: Tile & { readonly crop: string };
  cropHarvested: Tile & { readonly crop: string; readonly qualitaet: number; readonly anzahl: number };
  cropDied: Tile & { readonly crop: string; readonly grund: CropDeathCause };
  cropCleared: Tile & { readonly crop: string };
  plotWatered: Tile & { readonly item: string };
  plotFertilized: Tile & { readonly item: string };
  pestAppeared: Tile & { readonly art: Exclude<Pest, 'keine'> };
  pestCured: Tile & { readonly art: Exclude<Pest, 'keine'> };
  canFilled: Tile & { readonly item: string };
  saplingPlanted: Tile & { readonly item: string; readonly object: string };
  saplingGrown: Tile & { readonly object: string };
  wormFound: Tile;
}

/** Event names of `FarmingEventMap`. */
export const FARMING_EVENT_TYPES = [
  'plotCreated',
  'plotRemoved',
  'cropPlanted',
  'cropRipe',
  'cropHarvested',
  'cropDied',
  'cropCleared',
  'plotWatered',
  'plotFertilized',
  'pestAppeared',
  'pestCured',
  'canFilled',
  'saplingPlanted',
  'saplingGrown',
  'wormFound',
] as const satisfies ReadonlyArray<keyof FarmingEventMap>;

/** Sounds of the field (src/content/sfx/feld.ts; src/audio/eventMap.ts maps the events onto them). */
export const FARM_SFX = {
  sown: 'sfx_feld_saeen',
  planted: 'sfx_feld_pflanzen',
  watered: 'sfx_feld_giessen',
  canFilled: 'sfx_feld_kanne_fuellen',
  fertilized: 'sfx_feld_duengen',
  harvested: 'sfx_feld_ernten',
  cleared: 'sfx_feld_raeumen',
  crows: 'sfx_feld_kraehe',
} as const;
