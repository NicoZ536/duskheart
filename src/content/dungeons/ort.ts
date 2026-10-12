/**
 * The vault as a place (docs/SPIEL.md §18 "Nicht gezählt, aber als `PlaceDef` vorhanden: `gewoelbe` (C)", §19; M7-10, M7-16):
 * the location type `gewoelbe` (not counted towards §C "Ortstypen" – vaults count as `vaults`), the surface layout around a
 * vault's entrance – a ring of broken Builder pillars around stairs leading down (mark `eingang` in the middle: the vault's box
 * on layer −1 is centred on it) – and the chest loot of the vaults (`gewoelbe_<biom>_<stufe>`, docs/SPIEL.md §29), spread into
 * src/content/places/index.ts. The places system discovers the entrance like any place; the vault itself belongs to `vaults`.
 *
 * Loot by tier (§21 "Truhen nach Stufe"; drawn with `hash(seed, vault, chest)`, src/game/vaults/): 1 the means of a long
 * descent (torches, bandages, arrows, rope, charcoal); 2 worked metal and Lumen (bars, nails, bronze arrows, shards); 3 the
 * Builders' own things – relics for the research desk, Lumen and bronze (the end chest adds its vault's unique blueprint,
 * src/content/dungeons/belohnungen.ts). Nothing here is world material
 * (ADR-0105) and nothing gates progress (§13.2): bronze and Lumen come from smelting and the night as well.
 */
import type { PlaceDefInput, PlaceLayoutInput, PlaceLootInput } from '../places/schema';

export const VAULT_PLACE: PlaceDefInput = {
  id: 'gewoelbe',
  name: { de: 'Erbauer-Gewölbe', en: 'Builder Vault' },
  beschreibung: {
    de: 'Eine Treppe zwischen geborstenen Säulen führt hinab in die Gewölbe der Erbauer: Rätsel, Fallen, Wächter – und was sie hüten.',
    en: 'Stairs between broken pillars lead down into the vaults of the Builders: riddles, traps, guards – and what they keep.',
  },
  chronik: {
    de: 'Ich habe einen Abgang in ein Erbauer-Gewölbe gefunden: {name}. Kalte Luft steigt aus der Tiefe.',
    en: 'I found the stairs down into a Builder vault: {name}. Cold air rises from the depths.',
  },
  zaehlt: false,
  kartensymbol: 'karte_ort_gewoelbe',
  waechter: [],
  wirkung: 'gewoelbe',
};

export const VAULT_PLACE_LAYOUTS: readonly PlaceLayoutInput[] = [
  {
    id: 'gewoelbe_gruenhain_01',
    ortstyp: 'gewoelbe',
    biom: 'gruenhain',
    // Not turned: the stairs face south, the way the player looks down into them.
    drehbar: false,
    legende: {
      A: { boden: 'strasse', objekt: 'ort_gw_abgang', marke: 'eingang' },
      p: { boden: 'strasse' },
      S: { boden: 'strasse', objekt: 'ort_saeule' },
      r: { objekt: 'ort_geroell' },
      w: { objekt: 'ort_gw_wurzeln' },
    },
    zeilen: ['...r...', '.pSpSp.', 'rppppp.', '.ppAppw', '.ppppp.', '.SpppS.', '...r...'],
  },
];

export const VAULT_LOOT: readonly PlaceLootInput[] = [
  {
    id: 'gewoelbe_gruenhain_1',
    ziehungen: [2, 3],
    beute: [
      { item: 'fackel', gewicht: 3, anzahl: [2, 4] },
      { item: 'verband', gewicht: 3, anzahl: [1, 3] },
      { item: 'pfeil_feuerstein', gewicht: 2, anzahl: [6, 12] },
      { item: 'faserseil', gewicht: 2, anzahl: [2, 4] },
      { item: 'holzkohle', gewicht: 2, anzahl: [2, 5] },
      { item: 'kupferbarren', gewicht: 1, anzahl: [1, 2] },
    ],
  },
  {
    id: 'gewoelbe_gruenhain_2',
    ziehungen: [2, 4],
    beute: [
      { item: 'kupferbarren', gewicht: 3, anzahl: [1, 3] },
      { item: 'zinnbarren', gewicht: 2, anzahl: [1, 2] },
      { item: 'nagel_bronze', gewicht: 2, anzahl: [4, 10] },
      { item: 'pfeil_bronze', gewicht: 2, anzahl: [4, 8] },
      { item: 'lumen_scherbe', gewicht: 2, anzahl: [1, 2] },
      { item: 'schiene', gewicht: 1, anzahl: [1, 1] },
    ],
    garantiert: [{ item: 'lumen_scherbe', anzahl: 1 }],
  },
  {
    id: 'gewoelbe_gruenhain_3',
    ziehungen: [2, 3],
    beute: [
      { item: 'relikt_kompass', gewicht: 2, anzahl: [1, 1] },
      { item: 'relikt_siegel', gewicht: 2, anzahl: [1, 1] },
      { item: 'relikt_zahnrad', gewicht: 2, anzahl: [1, 1] },
      { item: 'bronzebarren', gewicht: 3, anzahl: [2, 4] },
      { item: 'lumen_scherbe', gewicht: 3, anzahl: [2, 4] },
    ],
    garantiert: [{ item: 'lumen_scherbe', anzahl: 2 }],
  },
];
