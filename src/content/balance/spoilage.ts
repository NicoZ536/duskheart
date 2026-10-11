/**
 * Balance values of spoilage (MASTERPROMPT §18 "Verderb", §16.4 "Lager … Eiskeller", §16.7 "Vorratsfass"; docs/SPIEL.md §21
 * "Verderb"; M7-29) – group `BALANCE.spoilage` (src/content/balance.ts re-exports it): the factors in their fixed order
 * (container × room × surroundings) and the grid of the freshness values. The shelf lives are the items' `frische` [days].
 * Every value states its unit and the reason for it.
 */

/** Kinds of perishable containers (the same list as `PERISHABLE_CONTAINERS`, src/game/spoilage/types.ts). */
export const SPOILAGE_CONTAINERS = ['taschen', 'kiste', 'vorratsfass', 'station', 'drop', 'grab'] as const;

/** Biomes hot enough to spoil food faster (§18 "heißes Biom ×1,5"): the glowing desert and the ash chasm. */
export const HOT_BIOMES = ['glutsand', 'aschenschlund'] as const;

export const SPOILAGE_BALANCE = {
  /**
   * Factor of each container kind on the loss per hour [× the shelf life's pace]. §18 "Vorratsfass ×0,75" (a closed barrel
   * keeps air and vermin out); the bags, a chest, a station's slots, a dropped stack and a grave keep nothing fresher. The
   * cool box (×0,3) follows with M8-32.
   */
  containers: { taschen: 1, kiste: 1, vorratsfass: 0.75, station: 1, drop: 1, grab: 1 } satisfies Record<(typeof SPOILAGE_CONTAINERS)[number], number>,
  /**
   * Factor of the room a container stands in [× the loss per hour], by room type (src/content/roomTypes.ts). §16.4 "Lager
   * (≥ 4 Kisten: Verderb −10 %)", "Eiskeller (< 4 °C: Verderb ×0,2)"; every other room keeps the pace.
   */
  rooms: { lager: 0.9, eiskeller: 0.2 } as Readonly<Record<string, number>>,
  /** Factor of winter for a container outdoors [× the loss per hour]. §18: "Winter im Freien ×0,5" – the cold keeps it. */
  winterOutdoors: 0.5,
  /** Factor of a hot biome [× the loss per hour]. §18: "heißes Biom ×1,5" (`HOT_BIOMES`). */
  hotBiome: 1.5,
  /** Hot biomes [biome ids] (`HOT_BIOMES`): the glowing desert and the ash chasm are the hot lands of §9.3. */
  hotBiomes: HOT_BIOMES as readonly string[],
  /**
   * Binary places of the freshness grid [bits]. docs/SPIEL.md §21: loss and freshness lie on the grid 2^-16, so n single
   * hours and one step of n hours subtract bit-identically (|freshness| ≤ 100 needs 7 bits before the point, 23 in all).
   */
  gridBits: 16,
};
