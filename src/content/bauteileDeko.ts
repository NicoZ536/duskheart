/**
 * Deko Grünhain und Küste (M7-62, Strang I; MASTERPROMPT §16 „Möbel & Deko (≥ 180 Bauteile, Möbel, Deko)“, §16.4 Raumwert Deko;
 * docs/SPIEL.md §26 „Schmuck 1–5 und Deko“): 18 Bauteile der Kategorien Deko, Pflanze, Bild, Trophäe und Teppich – Items und
 * Bauteil-Datensätze aus einer Liste (`moebelGruppe`), registriert in src/content/items/index.ts (Items) und
 * src/content/buildPartsAlle.ts (Bauteile); Rezepte src/content/recipes/deko_m7.ts, Objekte `obj_<id>` und Icons
 * assets-src/sprites/deko/m7_deko.ts, assets-src/sprites/icons/deko_m7.ts.
 *
 * - **Grünhain** (aus Wald und Jagd): Hirschgeweih an der Wand (die Trophäe des Rehbocks, ADR-0040), Moosstein, Farnkübel,
 *   Pilzstumpf, Kräuterbund, Blumenkranz, Federgesteck, Wurzelskulptur, Rindenschale.
 * - **Küste** (Strandgut): Muschelschale, Treibholzskulptur, Fischernetz, Steinanker, Buddelschiff (T1: Glas und Garn an der
 *   Werkbank II), Muschelbild, Kieselmosaik (flach, begehbar wie ein Teppich), Muschelwindspiel, Strandgutregal.
 * Tauschwerte [Tauschpunkte]: die Zutaten plus rund ein Fünftel für die Arbeit (wie die Möbel M4-19).
 */
import { ITEM_SFX } from './items/define';
import { moebelGruppe, type MoebelSpec } from './items/moebel';

const SPECS: readonly MoebelSpec[] = [
  {
    id: 'hirschgeweih_wand',
    stufe: 0,
    name: { de: 'Hirschgeweih an der Wand', en: 'Mounted Antlers' },
    beschreibung: {
      de: 'Das Geweih eines Rehbocks auf einem Brett, mit Faserseil gebunden. Erinnert an die erste Jagd und schmückt jede Hütte.',
      en: 'A roe buck’s antlers on a board, bound with fibre rope. A reminder of the first hunt that graces any hut.',
    },
    tauschwert: 22,
    aufheben: ITEM_SFX.knochen,
    platz: { art: 'wandmoebel', material: 'holz', kategorie: 'trophaee' },
  },
  {
    id: 'moosstein',
    stufe: 0,
    name: { de: 'Moosstein', en: 'Mossy Stone' },
    beschreibung: {
      de: 'Ein runder Feldstein mit einem Polster aus Moos, so wie er im Grünhain am Bach liegt. Bringt den Wald ins Haus.',
      en: 'A round fieldstone with a cushion of moss, just as it lies by a Greengrove brook. Brings the forest indoors.',
    },
    tauschwert: 8,
    aufheben: ITEM_SFX.stein,
    platz: { art: 'moebel', material: 'stein', kategorie: 'deko' },
  },
  {
    id: 'farnkuebel',
    stufe: 0,
    name: { de: 'Farnkübel', en: 'Fern Tub' },
    beschreibung: {
      de: 'Ein Holzkübel voll Walderde, darin ein großer Farn. Seine Wedel wiegen sich im Luftzug.',
      en: 'A wooden tub of forest soil holding a large fern. Its fronds sway in the draught.',
    },
    tauschwert: 14,
    aufheben: ITEM_SFX.pflanze,
    platz: { art: 'moebel', material: 'holz', kategorie: 'pflanze' },
  },
  {
    id: 'pilzstumpf',
    stufe: 0,
    name: { de: 'Pilzstumpf', en: 'Mushroom Stump' },
    beschreibung: {
      de: 'Ein Stück Baumstumpf, auf dem rote Pilze wachsen. Bitte nicht essen – nur ansehen.',
      en: 'A piece of tree stump with red mushrooms growing on it. Please do not eat – just look.',
    },
    tauschwert: 10,
    aufheben: ITEM_SFX.holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'deko' },
  },
  {
    id: 'kraeuterbund',
    stufe: 0,
    name: { de: 'Kräuterbund', en: 'Herb Bundle' },
    beschreibung: {
      de: 'Schafgarbe und Wegerich, kopfüber an einer Schnur zum Trocknen aufgehängt. Duftet nach Sommerwiese.',
      en: 'Yarrow and plantain hung upside down on a string to dry. Smells of a summer meadow.',
    },
    tauschwert: 9,
    aufheben: ITEM_SFX.pflanze,
    platz: { art: 'wandmoebel', material: 'stroh', kategorie: 'deko' },
  },
  {
    id: 'blumenkranz',
    stufe: 0,
    name: { de: 'Blumenkranz', en: 'Flower Wreath' },
    beschreibung: {
      de: 'Ein Kranz aus Weidenzweigen mit roten, gelben und blauen Blüten. Die Farben der Wiesen an der Wand.',
      en: 'A wreath of willow twigs with red, yellow and blue flowers. The colours of the meadows on the wall.',
    },
    tauschwert: 11,
    aufheben: ITEM_SFX.pflanze,
    platz: { art: 'wandmoebel', material: 'stroh', kategorie: 'deko' },
  },
  {
    id: 'federgesteck',
    stufe: 0,
    name: { de: 'Federgesteck', en: 'Feather Arrangement' },
    beschreibung: {
      de: 'Ein Tontopf mit einem Strauß Federn – grau, blau und rostrot. Jede Feder ein Vogel, den man gesehen hat.',
      en: 'A clay pot with a bouquet of feathers – grey, blue and rust red. Every feather a bird one has seen.',
    },
    tauschwert: 12,
    aufheben: ITEM_SFX.federn,
    platz: { art: 'moebel', material: 'lehm', kategorie: 'deko' },
  },
  {
    id: 'wurzelskulptur',
    stufe: 0,
    name: { de: 'Wurzelskulptur', en: 'Root Sculpture' },
    beschreibung: {
      de: 'Eine verdrehte Baumwurzel, geschält und mit Harz poliert. Wer genau hinsieht, erkennt einen springenden Hirsch.',
      en: 'A twisted tree root, peeled and polished with resin. Look closely and you see a leaping stag.',
    },
    tauschwert: 13,
    aufheben: ITEM_SFX.holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'deko' },
  },
  {
    id: 'rindenschale',
    stufe: 0,
    name: { de: 'Rindenschale', en: 'Bark Bowl' },
    beschreibung: {
      de: 'Eine Schale aus gebogener Rinde voller Herbstlaub. Ein Stück Jahreszeit auf dem Tisch.',
      en: 'A bowl of bent bark full of autumn leaves. A piece of the season on the table.',
    },
    tauschwert: 7,
    aufheben: ITEM_SFX.holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'deko' },
  },
  {
    id: 'muschelschale',
    stufe: 0,
    name: { de: 'Muschelschale', en: 'Shell Bowl' },
    beschreibung: {
      de: 'Eine Tonschale voller Muscheln vom Strand, glatt gespült von der Brandung.',
      en: 'A clay bowl full of shells from the beach, washed smooth by the surf.',
    },
    tauschwert: 12,
    aufheben: ITEM_SFX.muschel,
    platz: { art: 'moebel', material: 'lehm', kategorie: 'deko' },
  },
  {
    id: 'treibholzskulptur',
    stufe: 0,
    name: { de: 'Treibholzskulptur', en: 'Driftwood Sculpture' },
    beschreibung: {
      de: 'Zwei silbergraue Treibholzäste, gekreuzt auf einem Steinsockel. Das Meer hat sie geformt, du hast sie nur aufgestellt.',
      en: 'Two silver-grey pieces of driftwood crossed on a stone base. The sea shaped them, you only set them up.',
    },
    tauschwert: 11,
    aufheben: ITEM_SFX.holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'deko' },
  },
  {
    id: 'fischernetz_wand',
    stufe: 0,
    name: { de: 'Fischernetz', en: 'Fishing Net' },
    beschreibung: {
      de: 'Ein altes Netz an einer Treibholzlatte, unten ein Schwimmer aus Kork. Riecht noch ein wenig nach Meer.',
      en: 'An old net on a driftwood batten, a cork float at the bottom. Still smells a little of the sea.',
    },
    tauschwert: 12,
    aufheben: ITEM_SFX.pflanze,
    platz: { art: 'wandmoebel', material: 'stroh', kategorie: 'deko' },
  },
  {
    id: 'steinanker',
    stufe: 0,
    name: { de: 'Steinanker', en: 'Stone Anchor' },
    beschreibung: {
      de: 'Ein durchbohrter Stein in Ankerform mit einem Seilring. Hält kein Boot mehr, aber die Erinnerung an die Überfahrt.',
      en: 'A pierced stone in the shape of an anchor with a rope ring. It holds no boat any more, only the memory of the crossing.',
    },
    tauschwert: 14,
    aufheben: ITEM_SFX.stein,
    platz: { art: 'moebel', material: 'stein', kategorie: 'deko' },
  },
  {
    id: 'buddelschiff',
    stufe: 1,
    name: { de: 'Buddelschiff', en: 'Ship in a Bottle' },
    beschreibung: {
      de: 'Ein winziges Schiff mit Garnsegeln in einer liegenden Glasflasche. Wie es hineinkam, bleibt dein Geheimnis.',
      en: 'A tiny ship with yarn sails in a bottle lying on its side. How it got in stays your secret.',
    },
    tauschwert: 26,
    aufheben: ITEM_SFX.glas,
    platz: { art: 'moebel', material: 'glas', kategorie: 'deko' },
  },
  {
    id: 'muschelbild',
    stufe: 0,
    name: { de: 'Muschelbild', en: 'Shell Mosaic' },
    beschreibung: {
      de: 'Ein Holzrahmen mit Muscheln in Reihen und Rosetten, mit Harz eingeklebt. Glänzt, wenn das Licht darauf fällt.',
      en: 'A wooden frame with shells set in rows and rosettes, glued in with resin. It gleams when the light falls on it.',
    },
    tauschwert: 15,
    aufheben: ITEM_SFX.muschel,
    platz: { art: 'wandmoebel', material: 'holz', kategorie: 'bild' },
  },
  {
    id: 'kieselmosaik',
    stufe: 0,
    name: { de: 'Kieselmosaik', en: 'Pebble Mosaic' },
    beschreibung: {
      de: 'Flache Kiesel und Sand, im Boden zu einem Muster verlegt – ein Teppich, der nicht nass wird.',
      en: 'Flat pebbles and sand laid into the floor in a pattern – a rug that never gets wet.',
    },
    tauschwert: 8,
    aufheben: ITEM_SFX.stein,
    platz: { art: 'moebel', material: 'stein', kategorie: 'teppich', blockiert: false },
  },
  {
    id: 'muschelwindspiel',
    stufe: 0,
    name: { de: 'Muschelwindspiel', en: 'Shell Wind Chime' },
    beschreibung: {
      de: 'Muscheln an Faserschnüren unter einer Latte. Klappert leise, wenn jemand vorbeigeht.',
      en: 'Shells on fibre strings beneath a batten. They clatter softly when someone walks past.',
    },
    tauschwert: 10,
    aufheben: ITEM_SFX.muschel,
    platz: { art: 'wandmoebel', material: 'stroh', kategorie: 'deko' },
  },
  {
    id: 'strandgutregal',
    stufe: 0,
    name: { de: 'Strandgutregal', en: 'Beachcomber’s Shelf' },
    beschreibung: {
      de: 'Ein Wandregal aus Treibholz mit den Funden vom Strand: Muscheln, eine Glasscherbe, ein glatter Stein.',
      en: 'A driftwood wall shelf holding finds from the beach: shells, a shard of glass, a smooth stone.',
    },
    tauschwert: 16,
    aufheben: ITEM_SFX.holz,
    platz: { art: 'wandmoebel', material: 'holz', kategorie: 'deko' },
  },
];

const GRUPPE = moebelGruppe('deko_m7', SPECS);

/** Items der M7-Deko. */
export const DEKO_M7_ITEMS = GRUPPE.items;
/** Ihre Bauteile. */
export const DEKO_M7_BAUTEILE = GRUPPE.teile;
