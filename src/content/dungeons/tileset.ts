/**
 * The vault tilesets (docs/SPIEL.md §19 "Raumvorlagen … `src/content/dungeons/<tileset>/`", §29 "Tileset `gruenhain`;
 * Terrain `erbauerboden`, `erbauerstein`"; M7-11; collection `vaultTilesets`, source kind `gewoelbe` of items). A tileset
 * names its biome, its floor and wall terrain and the decor of its templates (a character → ground and/or world object).
 * The Grünhain vaults: Builder stone overgrown by the forest above – roots through the joints, moss, cold floor runes.
 */
import type { VaultTilesetInput } from './schema';

export const VAULT_TILESETS: readonly VaultTilesetInput[] = [
  {
    id: 'gruenhain',
    biom: 'gruenhain',
    boden: 'erbauerboden',
    wand: 'erbauerstein',
    legende: {
      S: { objekt: 'ort_gw_saeule' },
      s: { objekt: 'ort_saeule' },
      r: { objekt: 'ort_geroell' },
      w: { objekt: 'ort_gw_wurzeln' },
      T: { objekt: 'ort_gw_statue' },
      u: { objekt: 'ort_gw_rune' },
      m: { objekt: 'ort_gw_moos' },
      b: { objekt: 'ort_gw_becken' },
    },
  },
];
