/**
 * Item-Icons der M7-Deko Grünhain und Küste (M7-62; src/content/bauteileDeko.ts): dieselben Raster wie die Objekte
 * (assets-src/sprites/deko/m7_deko.ts) – 16 × 16, Motiv ≤ 14 × 14 mit 1 px Luft, Kontur `nacht.1` (docs/ART.md §3).
 */
import { DEKO_M7_RASTER } from '../deko/m7_deko';
import { icon } from './_icon';

export default Object.entries(DEKO_M7_RASTER).map(([item, raster]) => icon(item, raster));
