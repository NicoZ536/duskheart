/**
 * Events of harvesting (MASTERPROMPT §2.7 "Jede Aktion hat visuelles und akustisches Feedback", §14
 * "Feedback: Partikel je Material, materialspezifische Treffersounds, fliegende Drops mit Magnet,
 * Fortschrittsanzeige bei großen Objekten"). The presentation maps them to particles, the falling tree,
 * the dust cloud and the sounds of `GATHERING_SFX`; the skill system (§23.2) counts `harvested` for
 * experience.
 *
 * - `harvestHit`: a tool hit or a finished hand pick on an object or tile – material, hits done and
 *   needed; `tooHard` when the tool is too weak (§13.2 "Zu hart" + sparks, nothing happens).
 * - `harvested`: an object or tile is done – what, how (action), which skill, where. Hits and harvests
 *   name their experience source (`xp`, ids of src/content/skills.ts) for the skill system (§23.2).
 * - `treeFelled`: the last axe hit – the tree starts to fall in `direction`, lands at `landsAtTick`.
 * - `treeLanded`: the trunk hit the ground (dust, crash; creatures under it take damage, `treeFallDamage`).
 * - `tileDug`: a tile was dug or tilled – path, pit, water ditch or field (§14 "begrenztes Terraforming").
 * - `digSpotFound`: a hidden dig spot gave up its find (§14 "versteckte Buddelstellen").
 * - `objectRegrown`: a harvested object is back (tree from its stump, fruit, bush, plant, node).
 */
import type { Layer } from '../../world/model/coords';
import type { FallDirection } from './formulas';
import type { HarvestAction, HarvestMaterial, HarvestSkill } from './rules';

/** What became of a dug tile. */
export const DIG_RESULTS = ['pfad', 'grube', 'wassergraben', 'feld', 'stollen'] as const;
export type DigResult = (typeof DIG_RESULTS)[number];

export interface GatheringEventMap {
  harvestHit: {
    readonly layer: Layer;
    readonly tx: number;
    readonly ty: number;
    /** Hit point in the world [px] (the target's centre). */
    readonly x: number;
    readonly y: number;
    /** World object id, or the terrain id of a mined or dug tile. */
    readonly target: string;
    readonly action: HarvestAction;
    readonly material: HarvestMaterial;
    readonly hits: number;
    readonly hitsNeeded: number;
    readonly tooHard: boolean;
    /** Experience source of the hit (src/content/skills.ts), `null` when it gives none. */
    readonly xp: string | null;
    readonly tick: number;
  };
  harvested: {
    readonly layer: Layer;
    readonly tx: number;
    readonly ty: number;
    readonly x: number;
    readonly y: number;
    readonly target: string;
    readonly action: HarvestAction;
    readonly material: HarvestMaterial;
    readonly skill: HarvestSkill;
    /** Experience source of the harvest (src/content/skills.ts). */
    readonly xp: string;
    readonly tick: number;
  };
  treeFelled: { readonly layer: Layer; readonly tx: number; readonly ty: number; readonly object: string; readonly direction: FallDirection; readonly landsAtTick: number; readonly tick: number };
  treeLanded: { readonly layer: Layer; readonly tx: number; readonly ty: number; readonly object: string; readonly direction: FallDirection; readonly tick: number };
  tileDug: { readonly layer: Layer; readonly tx: number; readonly ty: number; readonly from: string; readonly to: string; readonly result: DigResult; readonly tick: number };
  digSpotFound: { readonly layer: Layer; readonly tx: number; readonly ty: number; readonly tick: number };
  objectRegrown: { readonly layer: Layer; readonly tx: number; readonly ty: number; readonly object: string; readonly tick: number };
}

/** Event names of `GatheringEventMap`. */
export const GATHERING_EVENT_TYPES = ['harvestHit', 'harvested', 'treeFelled', 'treeLanded', 'tileDug', 'digSpotFound', 'objectRegrown'] as const satisfies ReadonlyArray<keyof GatheringEventMap>;

/**
 * Sounds of harvesting (`sfx_<bereich>_<name>`, docs/SPIEL.md §5; presets in M3-33): a hit sound per
 * material (§14 "materialspezifische Treffersounds"), the spark of a too weak tool, the creak and crash
 * of a falling tree, the pick of a hand harvest, the find of a dig spot.
 */
export const GATHERING_SFX = {
  hit: {
    holz: 'sfx_sammeln_holz',
    stein: 'sfx_sammeln_stein',
    erz: 'sfx_sammeln_erz',
    kristall: 'sfx_sammeln_kristall',
    pflanze: 'sfx_sammeln_pflanze',
    erde: 'sfx_graben_erde',
    sand: 'sfx_graben_sand',
    schnee: 'sfx_graben_schnee',
  } satisfies Record<HarvestMaterial, string>,
  tooHard: 'sfx_sammeln_zuhart',
  pick: 'sfx_sammeln_pfluecken',
  treeCreak: 'sfx_baum_knarren',
  treeLand: 'sfx_baum_aufprall',
  digSpot: 'sfx_graben_fund',
} as const;
