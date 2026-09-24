/**
 * Balance values of items, bags and equipment (MASTERPROMPT §13.1, §14, §D; docs/SPIEL.md §2) –
 * group `BALANCE.items` (src/content/balance.ts re-exports it). Every value states its unit and the
 * reason for it. The item categories themselves are defined with the item schema
 * (src/content/schema/item.ts); this module only imports their type, so the schema may read the
 * balance table without an import cycle.
 */
import type { ItemCategory } from '../schema/item';

export const ITEM_BALANCE = {
  /**
   * Stack size per item category [items per slot]. §13.1: "Rohstoffe 100, Barren 50, Nahrung 20
   * (Frische beim Zusammenlegen gewichtet gemittelt), Munition 200, Werkzeuge/Waffen/Rüstung 1".
   * The other categories follow the nearest §13.1 rule: seeds and saplings are carried in bulk like raw
   * materials; dishes are food; potions and medicine are consumables carried like food; shields are
   * armour; lights (a torch burns down, a lantern holds its fuel), jewellery and backpacks are single
   * pieces with their own state; placeable stations and furniture are bulky (ten set up a camp); build
   * parts are semi-finished goods like ingots.
   */
  stack: {
    rohstoff: 100,
    saatgut: 100,
    barren: 50,
    nahrung: 20,
    gericht: 20,
    trank: 20,
    medizin: 20,
    munition: 200,
    werkzeug: 1,
    waffe: 1,
    ruestung: 1,
    schild: 1,
    licht: 1,
    schmuck: 1,
    rucksack: 1,
    platzierbar: 10,
    bauteil: 50,
  } satisfies Record<ItemCategory, number>,
  bags: {
    /** Main inventory [slots]. §13.1: "Inventar 30 Plätze". */
    inventorySlots: 30,
    /** Hotbar [slots]. §13.1: "Schnellleiste 10 (Tasten 1–0, Mausrad)". */
    hotbarSlots: 10,
    /** Extra slots a backpack in the backpack slot adds, one value per backpack size [slots]. §13.1: "Rucksack-Slot +8/+16/+24". */
    backpackSlots: [8, 16, 24],
    /** Belt [slots]. §13.1: "Gürtel (3 Schnellverbrauch-Plätze, Taste Q)". */
    beltSlots: 3,
  },
  quality: {
    /** Bonus on stats and durability per quality [fraction], index = stars − 1. §13.1: "Qualität 1–3 Sterne: +10 % bzw. +20 % auf Werte und Haltbarkeit". */
    bonus: [0, 0.1, 0.2],
  },
  /** Durability per tier T0–T7 [uses]. §D: "Haltbarkeit (Nutzungen): T0 60 · T1 150 · T2 250 · T3 400 · T4 550 · T5 700 · T6 900 · T7 1200". */
  durabilityByTier: [60, 150, 250, 400, 550, 700, 900, 1200],
  /** Freshness of a stack [percent]: a new stack starts at the maximum and spoils to 0 over the item's shelf life. §18: "Frische 100 → 0 über die Haltbarkeit". */
  freshnessMax: 100,
  /**
   * Limits of aggregated equipment stats [stat unit]. §11.2: "Kleidung liefert Isolation (0–40) und
   * Kühlung (0–15)"; resistances are fractions of the damage taken and never exceed full immunity.
   */
  statLimits: {
    isolation: { min: 0, max: 40 },
    kuehlung: { min: 0, max: 15 },
    giftresistenz: { min: 0, max: 1 },
    frostresistenz: { min: 0, max: 1 },
    feuerresistenz: { min: 0, max: 1 },
    furchtresistenz: { min: 0, max: 1 },
  },
  /**
   * Burn time of fuels [real seconds]. §15.4 "Brennwerte (Startwerte)": "Zweig 15 · Holzscheit 45".
   * Driftwood is sun-dried wood and burns like a log; bark is thinner than a log but thicker than a
   * twig; dry leaves flare up and are gone almost at once (tinder).
   */
  burnSeconds: { zweig: 15, holz: 45, treibholz: 45, rinde: 20, laub: 5 },
  /**
   * Shelf life of raw food [game days]. §18 "Verderb": "Beeren 3". Soft stone fruit, mushrooms and leafy
   * herbs wilt as fast as berries; pome fruit keeps about a week longer; nuts in their shell keep for
   * two default seasons; washed-up kelp rots fastest.
   */
  shelfLifeDays: { beeren: 3, steinobst: 3, pilze: 3, blattkraut: 3, kernobst: 10, nuesse: 60, seetang: 2 },
  drops: {
    /** Chance that clearing a stump yields a sapling of its species [probability]. §14: "Der Stumpf bleibt (roden: Harz/Holz); 40 % Chance auf Setzling". */
    saplingChance: 0.4,
  },
};
