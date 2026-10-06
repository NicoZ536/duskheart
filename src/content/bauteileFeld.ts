/**
 * Build parts of the field (docs/SPIEL.md §20 "Beet-Bauteile", §29 "Bauteile beet_holz, beet_stein, vogelscheuche"; MASTERPROMPT
 * §17, §16.4 "Gewächshaus … Beete"; M7-20, M7-23): two garden beds and the scarecrow, built like furniture (item + build part,
 * `moebelGruppe`). Their recipes are in src/content/recipes/feld.ts, their sprites `obj_<id>` in assets-src/sprites/feld/.
 *
 * - **Garden beds** (`beet_holz`, `beet_stein`; furniture category `beet`, layer `objekt`, 1 × 1, not blocking): a frame of
 *   planks or fieldstones full of soil – a field without a hoe, also on a built floor. The farming system makes the bed
 *   a plot when it is placed and drops the plot when it is taken down (src/game/farming). A room with a bed under a
 *   glass roof is a greenhouse (src/content/roomTypes.ts), whose plots grow all year.
 * - **Scarecrow** (`vogelscheuche`; category `deko`, blocking): keeps crows off the plots within
 *   `BALANCE.farming.pests.scarecrowTiles` (§17 "Krähen (Vogelscheuche)").
 * Trade values [trade points, 1 = one log]: the ingredients plus about a fifth for the work.
 */
import { ITEM_SFX } from './items/define';
import { moebelGruppe, type MoebelSpec } from './items/moebel';

const SPECS: readonly MoebelSpec[] = [
  {
    id: 'beet_holz',
    stufe: 0,
    name: { de: 'Holzbeet', en: 'Wooden Garden Bed' },
    beschreibung: {
      de: 'Ein Rahmen aus Brettern voll lockerer Erde: ein Acker ohne Hacke, auch auf gebautem Boden. Unter einem Glasdach wird daraus ein Gewächshaus, in dem das ganze Jahr etwas wächst.',
      en: 'A frame of planks full of loose soil: a field without a hoe, even on a built floor. Under a glass roof it makes a greenhouse where something grows all year.',
    },
    tauschwert: 10,
    aufheben: ITEM_SFX.holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'beet', blockiert: false },
  },
  {
    id: 'beet_stein',
    stufe: 0,
    name: { de: 'Steinbeet', en: 'Stone Garden Bed' },
    beschreibung: {
      de: 'Ein Hochbeet aus Feldsteinen voll lockerer Erde: ein Acker ohne Hacke, der nicht verrottet und kein Feuer fängt.',
      en: 'A raised bed of fieldstones full of loose soil: a field without a hoe that neither rots nor burns.',
    },
    tauschwert: 9,
    aufheben: ITEM_SFX.stein,
    platz: { art: 'moebel', material: 'stein', kategorie: 'beet', blockiert: false },
  },
  {
    id: 'vogelscheuche',
    stufe: 0,
    name: { de: 'Vogelscheuche', en: 'Scarecrow' },
    beschreibung: {
      de: 'Ein Kreuz aus Zweigen mit Strohkopf und flatternden Fasern. Hält Krähen von den Feldern im Umkreis von sechs Schritten fern.',
      en: 'A cross of twigs with a straw head and fluttering fibres. Keeps crows off the fields within six steps.',
    },
    tauschwert: 12,
    aufheben: ITEM_SFX.pflanze,
    platz: { art: 'moebel', material: 'holz', kategorie: 'deko' },
  },
];

const GRUPPE = moebelGruppe('feld_bauteile', SPECS);

/** Items of the beds and the scarecrow. */
export const FELD_BAUTEILE_ITEMS = GRUPPE.items;
/** Their build parts. */
export const FELD_BAUTEILE = GRUPPE.teile;
/** The scarecrow part. */
export const SCARECROW_PART = 'vogelscheuche';
