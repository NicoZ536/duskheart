/**
 * Balance values of the kitchen and of eating (MASTERPROMPT §18 "Kochen, Ernährung", §16.4 "Küche … Speisesaal", §12.3
 * "Wohlfühlessen"; docs/SPIEL.md §21; M7-25 … M7-28) – group `BALANCE.meals` (src/content/balance.ts re-exports it): raw meat,
 * boredom, the limit of meal effects, the kitchen and the dining hall, the cooking stations. The dishes, potions and their
 * conditions are content (src/content/items/gerichte.ts, traenke.ts, src/content/conditions_m7.ts). Every value states its
 * unit and the reason for it.
 */

/**
 * Stations a kitchen speeds up (docs/SPIEL.md §21 "Koch-Stationen"): the camp fire's spit, the cauldron, the oven, the
 * smokehouse, the drying rack and the herb table – where food and remedies are made, not the mill or the fermenting barrel
 * (they work on their own and need no cook).
 */
export const KOCH_STATIONEN = ['lagerfeuer', 'kessel', 'backofen', 'raeucherkammer', 'trockengestell', 'kraeutertisch'] as const;

/** Stations that are a cooking place of a kitchen (furniture category `kochstelle`, src/content/roomTypes.ts). */
export const KOCHSTELLEN = ['kessel', 'backofen'] as const;

export const MEALS_BALANCE = {
  /**
   * Chance that a piece of raw meat or raw fish (ingredient group `fleisch_roh`) poisons [probability]. §18: "rohes Fleisch
   * 30 % Lebensmittelvergiftung" – cooking is worth the fire.
   */
  rawMeatPoison: 0.3,
  boredom: {
    /** Counter one eaten piece adds to its dish [pieces]. §18 counts pieces: "dieselbe Speise 3× an einem Tag". */
    perPiece: 1,
    /**
     * Counter from which a piece of the same dish gives less [pieces before eating]. §18 "3× an einem Tag → −50 %": the third
     * piece of a day finds two before it.
     */
    from: 2,
    /** Share of its nutrition a piece eaten in boredom still gives [factor]. §18: "−50 % Nährwert". */
    factor: 0.5,
    /**
     * Counter that fades at every 06:00 [pieces per dawn]. §18 "klingt über 2 Tage ab": the three pieces of a greedy day are
     * forgotten after the second dawn (3 − 2 × 1,5 = 0); one piece a day never bores.
     */
    decayPerDawn: 1.5,
  },
  /** Different meal conditions active at once at most [conditions]. §18: "höchstens 2 verschiedene gleichzeitig" – the oldest gives way. */
  maxMealEffects: 2,
  kitchen: {
    /** Crafting tempo a kitchen adds at its cooking stations [fraction]. §16.4: "Küche (… +20 % Kochtempo …)". */
    tempo: 0.2,
    /** Effect of a dish made in a kitchen [factor on nutrition, comfort and the durations of its conditions]. §16.4: "+10 % Mahlzeitwirkung". */
    effect: 1.1,
  },
  /**
   * Fear a meal eaten in a dining hall calms besides its own comfort [points]. §16.4 "Speisesaal (… Essen senkt Furcht
   * zusätzlich)": half the least comfort food (§12.3 "−10 bis −25") – a shared table, not a feast.
   */
  diningHallComfort: 5,
  /**
   * Stations a kitchen speeds up [station ids] (`KOCH_STATIONEN`): where food and remedies are made by hand or fire – the
   * mill and the fermenting barrel run on their own.
   */
  cookingStations: KOCH_STATIONEN as readonly string[],
  /**
   * Shelf life of cooked food by kind [game days]. §18 "Brot 5 · … · Salzfisch 25, Trockenfleisch 30": roast and grilled food
   * keeps three days, soups, stews and salads two (they turn sour), teas three, cakes four; drying and smoking with salt keep
   * meat and fish a month. Wine and beer keep (no shelf life).
   */
  shelfLifeDays: { gebraten: 3, suppe: 2, salat: 2, tee: 3, brot: 5, kuchen: 4, trockenfleisch: 30, raeucherfisch: 25 },
  /** Stations that count as the cooking place of a kitchen [station ids] (`KOCHSTELLEN`): the cauldron and the oven, as §16.4 "Kessel + Vorrat + Tisch" names. */
  cookingPlaces: KOCHSTELLEN as readonly string[],
};
