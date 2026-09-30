/**
 * Balance values of the hearth fire, the core of a base (MASTERPROMPT §16.5 "Herdfeuer (Basiskern)"; docs/SPIEL.md
 * §8 "Herdfeuer (M4-20)"; M4-20) – group `BALANCE.hearth` (src/content/balance.ts re-exports it). The hearth item
 * and its build part are content (src/content/items/herdfeuer.ts). Every value states its unit and the reason for it.
 */

export const HEARTH_BALANCE = {
  /** Hearths a world holds at most [hearths]. §16.5: "Pro Basis ein Herdfeuer, höchstens 3 Basen". */
  maxBases: 3,
  /**
   * Radius of the base around a hearth by the number of set ember cores [tiles], index = cores (0–6). §16.5:
   * "Radius 12 Tiles, mit Glutkernen (einer je Leuchtfeuer) bis 40 Tiles aufrüstbar" – the six cores of the six
   * beacons add the 28 tiles evenly (≈ 4,7 each, rounded to whole tiles).
   */
  radiusByCores: [12, 17, 21, 26, 31, 35, 40],
  /**
   * Ember core items of the six niches of the hearth ring, in niche order [item ids]. docs/SPIEL.md §8:
   * "Glutkern-Items `glutkern_1` … `glutkern_6` (Quelle je Leuchtfeuer, ab M7)" – the items come with their
   * beacons (M7-36 …); niche n takes only core n (the sprite `obj_herdfeuer` has sockets `glutkern_1` … `_6`).
   */
  coreItems: ['glutkern_1', 'glutkern_2', 'glutkern_3', 'glutkern_4', 'glutkern_5', 'glutkern_6'],
  /**
   * Least distance between the centres of two hearths [tiles]. §16.5 "Pro Basis ein Herdfeuer": a second
   * hearth inside the radius of another would stand in the same base; two base radii (2 × 12) keep the zones of
   * two fresh bases apart.
   */
  minSpacingTiles: 24,
  /**
   * Burn time of one piece of each fuel [game hours]. §16.5: "Holzscheite (1 je Spielstunde), Holzkohle (1 je
   * 3 h) oder Lumen-Scherben (1 je 6 h)"; the Lumen shard is the loot of shadow brood (M6-28, src/content/items/jagd.ts).
   */
  fuelGameHours: { holz: 1, holzkohle: 3, lumen_scherbe: 6 } as Readonly<Record<string, number>>,
  /** Pieces of fuel the store holds [pieces]. §16.5: "Vorratsfach 40" – 40 logs keep a base safe 40 game hours. */
  storePieces: 40,
  /**
   * Radius from the player within which the hearth is used (fuel, cores, lighting) [tiles], measured from its
   * footprint: the reach of a station (`BALANCE.stations.reachTiles`) – one stands at the hearth like at an oven.
   */
  reachTiles: 3,
  /**
   * Heat of a lit hearth (a heat source of the player and of rooms, §11.2 "Feuer +15 °C im Kern"): the core heat
   * of a camp fire over the wider ring of the 3 × 3 hearth [°C, tiles] – the core covers the ring, the warmth
   * reaches two tiles further than from a camp fire.
   */
  heat: { coreHeatC: 15, coreRadiusTiles: 2.5, radiusTiles: 7 },
  /**
   * Light of a lit hearth (the light source list, §12.1): the fire of a base glows farther than a camp fire
   * (§12.2 "Lagerfeuer 8") – it is the light a base gathers around [tiles, light level, 0–1, px, palette ref].
   * The flames stand 14 px above the anchor (socket `licht` of `obj_herdfeuer`), the colour is the camp fire's.
   */
  light: { radiusTiles: 10, intensity: 1.2, flicker: 0.25, flameHeightPx: 14, farbe: 'feuer.3' },
};
