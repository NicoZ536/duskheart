/**
 * Beacons and visions (docs/SPIEL.md §22 "Leuchtfeuer", MASTERPROMPT §8, §23.1; ADR-0207; strand F, collections `beacons`
 * = `leuchtfeuer_1…6` in `BEACON_BIOMES` order, `visions`). The zod schemas producing these types are strand F's.
 */
import type { LocalizedText } from '../schema/common';

export interface BeaconDef {
  readonly id: string;
  readonly nummer: 1 | 2 | 3 | 4 | 5 | 6;
  readonly biom: string;
  readonly boss: string;
  readonly glutkern: string;
  readonly freischaltungen: readonly string[];
  readonly vision: string;
}
export interface VisionDef {
  readonly id: string;
  readonly bilder: readonly { readonly sprite: string; readonly zeilen: readonly LocalizedText[]; readonly sekunden: number }[];
}
