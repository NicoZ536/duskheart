/**
 * Storage T0–T1 (docs/SPIEL.md §8 "Lagerung (M4-21)"; MASTERPROMPT §16.7 "Holzkiste 16 · Truhe 24 · … · Lagerregal
 * 48 (nur Rohstoffe)"; M4-21): the wooden chest, the chest with bronze bands and the storage shelf.
 *
 * Each is a placeable item (category `platzierbar`, stack 10, like the stations; counts as `items`, §C, ADR-0006), made
 * at a station (src/content/recipes/basis.ts) and placed on the build grid as a piece of furniture of the category `lager`
 * (§16.4: the store room counts chests); drawn as `obj_<id>` with the clips `zu`/`offen`, icon `icon_<id>`. The
 * storage system (src/game/storage) keeps what lies inside; its slots and the shelf's rule are balance values
 * (`BALANCE.storage.containers`).
 *
 * Tiers after the ingredients: logs, planks and beams T0, the bronze nails of the chest T1. Trade values: the
 * ingredients plus about a fifth for the work (like grundlagen.ts).
 */
import { defineBuildParts } from '../buildParts';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Tier of the wooden chest and the shelf. */
const T0 = 0;
/** Tier of the chest (bronze nails). */
const T1 = 1;

/** The storage items. */
export const LAGERUNG = defineItemGroup('lagerung', [
  baseItem({
    id: 'kiste_holz',
    name: { de: 'Holzkiste', en: 'Wooden Crate' },
    beschreibung: {
      de: 'Eine Kiste aus Scheiten, mit Seil verzurrt. Aufgestellt fasst sie 16 Stapel – die Werkbank nimmt, was sie braucht, auch aus Kisten in der Nähe.',
      en: 'A crate of split logs lashed with rope. Set up, it holds 16 stacks – the workbench takes what it needs from crates nearby as well.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 12,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'truhe',
    name: { de: 'Truhe', en: 'Chest' },
    beschreibung: {
      de: 'Eine Truhe aus Brettern mit gewölbtem Deckel und Bronzebändern. Aufgestellt fasst sie 24 Stapel.',
      en: 'A chest of planks with a domed lid and bronze bands. Set up, it holds 24 stacks.',
    },
    kategorie: 'platzierbar',
    stufe: T1,
    tauschwert: 18,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'lagerregal',
    name: { de: 'Lagerregal', en: 'Storage Shelf' },
    beschreibung: {
      de: 'Ein Pfostenregal mit drei Böden, zwei Felder breit. Es fasst 48 Stapel, aber nur Rohstoffe und Barren – Holz, Steine, Fasern, Erz.',
      en: 'A post shelf with three boards, two tiles wide. It holds 48 stacks, but only raw materials and ingots – wood, stones, fibres, ore.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 22,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
]);

/**
 * How the storage items stand on the build grid (§16.1 "Objekte"): furniture of the category `lager`, wood (they
 * burn, §16.2); the shelf is two tiles wide (sprite `obj_lagerregal`, Stellfläche 2 × 1).
 */
export const LAGERUNG_BAUTEILE = defineBuildParts('lagerung', [
  { id: 'kiste_holz', art: 'moebel', material: 'holz', kategorie: 'lager' },
  { id: 'truhe', art: 'moebel', material: 'holz', kategorie: 'lager' },
  { id: 'lagerregal', art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'lager' },
]);
