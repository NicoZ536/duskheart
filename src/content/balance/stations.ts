/**
 * Balance values of the stations (MASTERPROMPT §15.1 "Verarbeitungsstationen … haben Eingang, Brennstoff und
 * Ausgang, laufen zeitbasiert", "Stationsstufen erhöhen Qualität, Tempo und verfügbare Rezepte", §15.2, §15.4
 * "Brennwerte"; docs/SPIEL.md §8; M4-03 … M4-06) – group `BALANCE.stations` (src/content/balance.ts
 * re-exports it). The stations themselves are content (src/content/stations.ts); their recipes too
 * (src/content/recipes/). Every value states its unit and the reason for it.
 */

/** Stage values of one station: how fast and how well it works. */
export interface StationStageBalance {
  /**
   * Working speed [factor on the recipe time; 1 = as given]. §15.1 "Stationsstufen erhöhen … Tempo": the
   * second stage of a line works a quarter faster.
   */
  readonly tempo: number;
  /**
   * Quality points the station adds to the Handwerk level [points] (`BALANCE.crafting.quality`). §15.1
   * "Stationsstufen erhöhen Qualität": first stages add nothing, second stages and the metal anvil 20.
   */
  readonly qualitaet: number;
}

/** Fuel rules of a processing station. */
export interface StationFuelBalance {
  /**
   * Weakest fuel the station accepts [real seconds of burn value, §15.4]. A smelting furnace needs the
   * heat of charcoal (120 s) or better – wood does not melt copper –, the clay oven and the kiln take any
   * fuel.
   */
  readonly minBurnSeconds: number;
  /**
   * Fuel burned per second of work [s of burn value / s]. A furnace or oven burns its fuel as fast as a
   * fire (1); the charcoal kiln smoulders under its earth cover and needs only a quarter – one log keeps a
   * 3-minute load going (§15.4 log 45 s).
   */
  readonly burnRate: number;
}

export const STATION_BALANCE = {
  /**
   * Burn values of the fuels of §15.4 [real seconds]: "Zweig 15 · Holzscheit 45 · Harzholz 60 · Torf 90 ·
   * Holzkohle 120 · Steinkohle 180 · Öl 240 · Magmit 600". The items that exist carry them as `brennwert`
   * (twig and log through `BALANCE.items.burnSeconds`, charcoal here); tests hold both to this table.
   */
  burnSeconds: { zweig: 15, holz: 45, harzholz: 60, torf: 90, holzkohle: 120, steinkohle: 180, oel: 240, magmit: 600 },
  /**
   * Radius from the player within which one works a station's slots (puts in, takes out, opens it) or
   * repairs at it [tiles]: the crafting station radius (`BALANCE.crafting.stationRadiusTiles`, 3) – one
   * stands at the oven like at the bench.
   */
  reachTiles: 3,
  /**
   * Radius from the player within which a station can be set up [tiles]: the build reach of §16.1
   * ("Baureichweite 8 Tiles") – a station is an object of the build grid.
   */
  placeReachTiles: 8,
  /**
   * Radius within which the player "meets" a placed station [tiles] (§15.1 "die Station bekannt ist"):
   * the build reach of §16.1 ("Baureichweite 8 Tiles") – what one could build on, one can see and study.
   */
  discoverTiles: 8,
  /**
   * Stage values per station id (src/content/stations.ts) [tempo: factor on the recipe time; qualitaet: quality points],
   * the reasons with `StationStageBalance`: first stages work as given, second stages and the bronze anvil add.
   */
  stages: {
    lagerfeuer: { tempo: 1, qualitaet: 0 },
    werkbank: { tempo: 1, qualitaet: 0 },
    werkbank_2: { tempo: 1.25, qualitaet: 20 },
    saegebock: { tempo: 1, qualitaet: 0 },
    steinmetzbank: { tempo: 1, qualitaet: 0 },
    trockengestell: { tempo: 1, qualitaet: 0 },
    koehlermeiler: { tempo: 1, qualitaet: 0 },
    lehmofen: { tempo: 1, qualitaet: 0 },
    schmelzofen: { tempo: 1, qualitaet: 0 },
    // A metal anvil on a stone block: tools hammered on it hold their edge (§13.1 quality from the station).
    amboss_bronze: { tempo: 1, qualitaet: 20 },
    schleifstein: { tempo: 1, qualitaet: 0 },
    spinnrad: { tempo: 1, qualitaet: 0 },
    // The armoury (M6-12, M6-31): first stages of their lines.
    webstuhl: { tempo: 1, qualitaet: 0 },
    schneidertisch: { tempo: 1, qualitaet: 0 },
    gerbrahmen: { tempo: 1, qualitaet: 0 },
    // Strand F (M7-36): the first beacon's workbench; Lumen is bound slowly and well (a careful craft, finer pieces).
    lumen_werkbank: { tempo: 1, qualitaet: 10 },
    // Strand D (M7-20): the compost box rots at nature's pace.
    kompostkiste: { tempo: 1, qualitaet: 0 },
  } satisfies Record<string, StationStageBalance>,
  /**
   * Fuel rules per processing station with a fuel slot [minBurnSeconds: real seconds of burn value; burnRate: s of burn
   * value per s of work], the reasons with `StationFuelBalance`: the furnace needs charcoal's heat, the kiln smoulders.
   */
  fuel: {
    koehlermeiler: { minBurnSeconds: 0, burnRate: 0.25 },
    lehmofen: { minBurnSeconds: 0, burnRate: 1 },
    // Charcoal (120 s, §15.4) is the weakest fuel hot enough for copper and bronze.
    schmelzofen: { minBurnSeconds: 120, burnRate: 1 },
  } satisfies Record<string, StationFuelBalance>,
};
