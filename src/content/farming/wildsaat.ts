/**
 * Seeds from the wild (docs/SPIEL.md §20 "Saaten", MASTERPROMPT §17; M7-21, M7-22): before the first harvest the seeds
 * have to come from somewhere. Wild herbs, grasses, flowers and berry bushes carry the seeds of their wild kin – when they
 * are picked in summer and autumn, now and then one comes along. Joined into the drops of their world objects in
 * src/content/worldObjects.ts; the seeds' source `welt:<objekt>` follows from there (src/content/items/usage.ts).
 *
 * Chance per seed and pick [0–1]: a handful of wild herbs gives about one seed of some kind every three picks, so the
 * first plot is sown on the first day of picking; a whole garden needs its own harvests.
 */

/** A seed drop of a world object (the shape of `worldObjectDropSchema`). */
export interface WildSeedDrop {
  readonly item: string;
  readonly min: number;
  readonly max: number;
  readonly chance: number;
  readonly jahreszeiten: ('fruehling' | 'sommer' | 'herbst' | 'winter')[];
}

/** Chance of one seed kind per pick [0–1]. */
const SEED_CHANCE = 0.05;
/** Seeds ripen in the second half of the year. */
const SEED_SEASONS = ['sommer', 'herbst'] as const;

function seeds(crops: readonly string[]): readonly WildSeedDrop[] {
  return crops.map((c) => ({ item: `saat_${c}`, min: 1, max: 1, chance: SEED_CHANCE, jahreszeiten: [...SEED_SEASONS] }));
}

/** Seed drops per world object id (wild herbs: vegetables and chamomile; fibre grass: the grains and flax; flowers: pulses and fruit vegetables; berry bushes: strawberries). */
export const WILD_SEED_DROPS = {
  pflanze_kraeuter: seeds(['karotte', 'kartoffel', 'ruebe', 'zwiebel', 'knoblauch', 'kohl', 'salat', 'kamille']),
  pflanze_fasergras: seeds(['weizen', 'gerste', 'roggen', 'mais', 'flachs']),
  deko_blumen: seeds(['erbse', 'bohne', 'tomate', 'kuerbis']),
  busch_beeren: seeds(['erdbeere']),
} as const;
