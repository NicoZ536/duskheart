/**
 * Balance values of storage (MASTERPROMPT §16.7 "Lagerung", §15.1 "Crafting nimmt aus Inventar und Kisten im
 * Umkreis"; docs/SPIEL.md §8 "Lagerung (M4-21)"; M4-21, M4-24) – group `BALANCE.storage` (src/content/balance.ts
 * re-exports it). The chest items and their build parts are content (src/content/items/lagerung.ts). Every value
 * states its unit and the reason for it.
 */
import type { ItemCategory } from '../schema/item';

/** What a kind of container holds. */
export interface ContainerBalance {
  /** Slots [slots]. */
  readonly slots: number;
  /** Item categories it takes (absent: every category). */
  readonly only?: readonly ItemCategory[];
}

export const STORAGE_BALANCE = {
  /**
   * The containers T0–T1 by their item [slots]. §16.7: "Holzkiste 16 · Truhe 24 · … · Lagerregal 48 (nur
   * Rohstoffe)" – the shelf takes raw materials and ingots (`rohstoff`, `barren`: what the bench and the furnace
   * work), no tools, food or furniture. Iron chest, cool box and pantry barrel come with their materials (M7, M8).
   */
  containers: {
    kiste_holz: { slots: 16 },
    truhe: { slots: 24 },
    lagerregal: { slots: 48, only: ['rohstoff', 'barren'] },
  } as Readonly<Record<string, ContainerBalance>>,
  /**
   * Radius from the player within which a chest is opened, filled and emptied [tiles], measured from its
   * footprint: the reach of a station (`BALANCE.stations.reachTiles`) – one stands at a chest like at a bench.
   */
  reachTiles: 3,
  /** Radius of the quick stash around the player [tiles]. §16.7: "Schnellablage in passende Kisten (10 Tiles)". */
  quickStashTiles: 10,
  /**
   * Radius from a blueprint within which finishing it takes the part from chests [tiles]. §16.6 "Material kommt aus
   * Kisten im Umkreis": the crafting radius of §15.1 ("Kisten im Umkreis von 8 Tiles") – the same chests serve the
   * bench and the building site.
   */
  blueprintChestTiles: 8,
  /**
   * Radius of "the base" a search and the overview run over when no hearth covers the spot [tiles]: the base
   * radius of a hearth without cores (§16.5 "Radius 12 Tiles").
   */
  searchRadiusTiles: 12,
  /** Longest chest name [characters]. §16.7 "Umbenennen": a label on the lid – about two words in the UI font. */
  nameMaxLength: 24,
};
