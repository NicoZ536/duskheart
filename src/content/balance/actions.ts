/**
 * Balance values of the player's actions (MASTERPROMPT §11.4 "Aktionen", §18, M3-25): eating and drinking
 * (interruptible), drinking from rivers and lakes, sitting, throwing – group `BALANCE.actions`
 * (src/content/balance.ts re-exports it). Every value states its unit and the reason for it.
 */
import type { ItemCategory } from '../schema/item';

/** Categories that are eaten or drunk from the bags (§13.1 consumables). */
export type ConsumableCategory = Extract<ItemCategory, 'nahrung' | 'gericht' | 'trank' | 'medizin'>;

export const ACTION_BALANCE = {
  /**
   * Time to consume one piece [s]. Long enough that eating in a fight is a decision (§11.4 "Essen/Trinken
   * (unterbrechbar)"), short enough not to drag: a bite of raw food 1,5 s, a whole dish 2,5 s, a potion
   * gulped in 1 s, medicine applied in 1,5 s.
   */
  consumeSeconds: { nahrung: 1.5, gericht: 2.5, trank: 1, medizin: 1.5 } satisfies Record<ConsumableCategory, number>,
  /** A sip from a river, lake or spring [s]. Kneeling at the water takes longer than a bite. */
  drinkSeconds: 2,
  /** Thirst one sip of water quenches [points of 100]. §18 "Trinkschlauch (5 Schlucke)": five sips fill an empty bar. */
  sipThirst: 20,
  /** Movement speed while eating or drinking [factor]. Walking on while chewing is possible, sprinting and rolling end the meal. */
  busyMoveFactor: 0.5,
  /** Reach of drinking, sitting and throwing targets [tiles]. The interaction reach of §11.4 ("E" on targets next to the player). */
  reachTiles: 2,
  water: {
    /** Fever risk of an unfiltered sip from a river or lake [probability]. §18: "Flüsse und Seen ungefiltert (… sonst 10 %)". */
    feverChance: 0.1,
    /** Fever risk in these biomes [probability]. §18: "Nebelmoor 50 % Fieberrisiko". */
    feverChanceByBiome: { nebelmoor: 0.5 } as Readonly<Record<string, number>>,
    /** Fever risk of a spring [probability]. Spring water rises clean from the rock: nothing to filter. */
    springFeverChance: 0,
  },
  freshness: {
    /** Freshness below which food is old [percent]. §18: "Frisch (≥ 60) · Alt (20–60, −25 % Wert)". */
    oldBelow: 60,
    /** Freshness below which food is rotten [percent]. §18: "Faulig (< 20, Vergiftungsrisiko)". */
    rottenBelow: 20,
    /** Nutrition of old food [factor]. §18: "Alt (20–60, −25 % Wert)". */
    oldFactor: 0.75,
    /** Nutrition of rotten food [factor]. Rotten is worse than old (§18 lists it below "Alt"): half the value. */
    rottenFactor: 0.5,
    /** Chance of food poisoning from rotten food [probability]. §18 "Faulig … Vergiftungsrisiko": more often than not safe, never reliable. */
    rottenPoisonChance: 0.4,
  },
  throw: {
    /** Farthest throw [tiles]. A stone thrown by hand lands about as far as a torch's light reaches (§12.2: 6 tiles) and a little beyond. */
    maxTiles: 8,
    /** Flight speed [tiles/s]. A lob a little faster than a sprint (7 tiles/s, §11.4): the eye can follow the arc. */
    speedTilesPerSecond: 10,
    /** Highest point of the arc per tile of distance [px per tile]. The presentation draws the arc; a long throw rises higher. */
    arcPxPerTile: 3,
    /** Distance at which the player picks a landed throw up again [tiles]. §11.4: "Kleinteile im Radius 1,5 Tiles automatisch (Magnet)". */
    pickupTiles: 1.5,
  },
};
