/**
 * Every build part of the game (registry collection `buildParts`, src/content/index.ts): the structure parts and
 * early placeables of src/content/buildParts.ts, and the furniture, lights and decoration of M4-19, whose records
 * live beside their items (src/content/items/moebel.ts, moebel_deko.ts). Joined here rather than in
 * buildParts.ts, which those files import for their schema.
 */
import { BUILD_PARTS, type BuildPartDef } from './buildParts';
import { MOEBEL_BAUTEILE } from './items/moebel';
import { MOEBEL_DEKO_BAUTEILE } from './items/moebel_deko';
import { LAGERUNG_BAUTEILE } from './items/lagerung';
import { HERDFEUER_BAUTEILE } from './items/herdfeuer';
import { BORKENVATER_BAUTEILE } from './items/borkenvater';
import { LEUCHTFEUER_BAUTEILE } from './items/leuchtfeuer';
import { FELD_BAUTEILE } from './bauteileFeld';
import { INSTRUMENTE_BAUTEILE } from './items/instrumente';

/** All build parts, in group order. */
export const ALL_BUILD_PARTS: readonly BuildPartDef[] = [...BUILD_PARTS, ...MOEBEL_BAUTEILE, ...MOEBEL_DEKO_BAUTEILE, ...LAGERUNG_BAUTEILE, ...HERDFEUER_BAUTEILE, ...BORKENVATER_BAUTEILE, ...LEUCHTFEUER_BAUTEILE, ...FELD_BAUTEILE, ...INSTRUMENTE_BAUTEILE];
