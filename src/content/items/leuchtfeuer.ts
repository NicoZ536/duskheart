/**
 * Items of the first beacon (MASTERPROMPT §23.1 "Leuchtfeuer 1 Grünhain: Lumen-Werkbank, Lumen-Laterne, Wegsteine (+ jeweils
 * ein Glutkern für das Herdfeuer)", §16.5 "Radius 12 Tiles, mit Glutkernen (einer je Leuchtfeuer) bis 40 Tiles", §25
 * "Schnellreise … Wegsteine"; docs/SPIEL.md §22, §29; M7-36, M7-37):
 *
 * - `glutkern_1` – the ember core the lit beacon of Grünhain puts into the bags (source `leuchtfeuer:leuchtfeuer_1`); set into
 *   niche 1 of a hearth it widens the base (`BALANCE.hearth.radiusByCores`). The cores of beacons 2–6 come with them
 *   (M8-44, M8-46, M10-23, M10-24, M12-13).
 * - `wegstein` – a carved standing stone with a Lumen eye: a fast-travel point (src/game/travel/), furniture on the build
 *   grid (`moebel`, 1 × 1, stone), made at the Lumen workbench only after the unlock `lf1_wegsteine`; named on the travel
 *   screen (`travel.rename`).
 * The Lumen workbench itself is a station (src/content/items/stationen.ts, src/content/stations.ts), the Lumen lantern a
 * light (src/content/items/lumen.ts). Trade values [trade points, 1 = one piece of wood]: ingredients plus a fifth.
 */
import { defineBuildParts } from '../buildParts';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Tier of the first beacon's knowledge (T1, after the Borkenvater). */
const TIER = 1;

/** Ember core 1 and the way stone. */
export const LEUCHTFEUER_ITEMS = defineItemGroup('leuchtfeuer', [
  baseItem({
    id: 'glutkern_1',
    name: { de: 'Glutkern des Grünhains', en: 'Greenwood Ember Core' },
    beschreibung: {
      de: 'Ein Stück der neu entfachten Flamme des ersten Leuchtfeuers, warm wie ein Herzschlag. In die erste Nische eines Herdfeuers gesetzt, weitet es den Schutz der Basis.',
      en: 'A piece of the first beacon’s rekindled flame, warm as a heartbeat. Set into the first niche of a hearth fire, it widens the base’s protection.',
    },
    kategorie: 'rohstoff',
    stufe: TIER,
    raritaet: 'episch',
    // Set into niche 1 of a hearth (`hearth.core`, `BALANCE.hearth.coreItems`) – a balance list, not a content reference.
    endprodukt: true,
    tauschwert: 100,
    quellen: ['leuchtfeuer:leuchtfeuer_1'],
    sounds: { aufheben: ITEM_SFX.lumen },
  }),
  baseItem({
    id: 'wegstein',
    name: { de: 'Wegstein', en: 'Way Stone' },
    beschreibung: {
      de: 'Ein behauener Stein mit einem Auge aus Lumen. Aufgestellt wird er zum Reiseziel: Von jedem Leuchtfeuer, Herdfeuer und Wegstein aus reist du gegen Lumen-Scherben hierher.',
      en: 'A carved stone with an eye of Lumen. Set up, it becomes a destination: from every beacon, hearth fire and way stone you travel here for Lumen shards.',
    },
    kategorie: 'bauteil',
    stufe: TIER,
    raritaet: 'selten',
    tauschwert: 40,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
]);

/** The way stone on the build grid: standing furniture of stone (sprite `obj_wegstein`). */
export const LEUCHTFEUER_BAUTEILE = defineBuildParts('leuchtfeuer', [{ id: 'wegstein', art: 'moebel', material: 'stein', kategorie: 'deko' }]);
