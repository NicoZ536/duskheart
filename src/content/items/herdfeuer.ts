/**
 * The hearth fire (docs/SPIEL.md §8 "Herdfeuer (M4-20)"; MASTERPROMPT §16.5 "Herdfeuer (Basiskern)"; M4-20): the core
 * of a base. A placeable item (category `platzierbar`, stack 10, like the stations; counts as `items`, §C, ADR-0006),
 * made at the mason's bench (src/content/recipes/basis.ts) and placed on the build grid as a 3 × 3 ring of hewn stone
 * (furniture of the category `kamin`, §16.4); drawn as `obj_herdfeuer` with the clips `aus`, `brennt`, `glut`, icon
 * `icon_herdfeuer`. The hearth system (src/game/hearth) keeps its fuel, its ember cores and whether it burns; radius,
 * fuel and store are balance values (`BALANCE.hearth`). The ember cores `glutkern_1` … `glutkern_6` come with their
 * beacons (M7-36 …).
 *
 * Tier T0 (stone blocks and clay); trade value: the ingredients plus about a fifth for the work.
 */
import { defineBuildParts } from '../buildParts';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** The hearth item. */
export const HERDFEUER = defineItemGroup('herdfeuer', [
  baseItem({
    id: 'herdfeuer',
    name: { de: 'Herdfeuer', en: 'Hearthfire' },
    beschreibung: {
      de: 'Ein Ring aus behauenen Steinen um eine Feuermulde – der Kern einer Basis. Solange es brennt, meidet die Schattenbrut seinen Umkreis von 12 Feldern, du erwachst hier wieder und überblickst alle Kisten der Basis. Höchstens drei Basen.',
      en: 'A ring of hewn stones around a fire pit – the heart of a base. While it burns, the Shadowspawn shuns its radius of 12 tiles, you wake here again and see every chest of the base at a glance. Three bases at most.',
    },
    kategorie: 'platzierbar',
    stufe: 0,
    tauschwert: 50,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
]);

/** How the hearth stands on the build grid: a 3 × 3 ring of stone (it does not burn, §16.2), furniture `kamin`. */
export const HERDFEUER_BAUTEILE = defineBuildParts('herdfeuer', [{ id: 'herdfeuer', art: 'moebel', material: 'stein', groesse: { b: 3, t: 3 }, kategorie: 'kamin' }]);
