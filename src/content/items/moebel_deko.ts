/**
 * Deko, Pflanzen, Textilien und Wandobjekte T0–T1 (M4-19; docs/SPIEL.md §8; MASTERPROMPT §16.1 "Wandobjekte
 * (Fackeln, Regale, Bilder, Trophäen)", §16.4 "Behaglichkeit … Deko"): Bilder und Schilder, Spiegel, Fahne,
 * Vorhang, Wandteppich, Kränze und Blumen, Töpfe und Kübel, der Strohteppich und die Dinge für Hof und Garten.
 * Aufbau wie moebel.ts: ein `bauteil`-Item, ein Bauteil-Eintrag (`moebel` oder `wandmoebel`) mit Möbelkategorie
 * – Deko, Bild, Pflanze, Teppich und Trophäe zählen für die Behaglichkeit als Deko (src/content/buildParts.ts
 * `DECORATION_CATEGORIES`), drei Trophäenbretter machen eine Trophäenhalle (src/content/roomTypes.ts).
 *
 * Wandobjekte liegen auf der Ebene Wandobjekt eines Wand-Tiles und hängen an dessen 16-px-Wandfront
 * (Sprite-Anker = unterster Pixel) in der Höhe `MOEBEL_WANDHOEHE_PX` über ihrer Fußlinie; Textilien sind aus
 * Stroh, Fasern oder Garn und brennen wie Stroh.
 */
import { ITEM_SFX } from './define';
import { moebelGruppe, type MoebelSpec } from './moebel';

/** Tier of decoration of wood, straw, plants, stone, clay and glass. */
const T0 = 0;
/** Tier of decoration with yarn or bronze. */
const T1 = 1;

const holz = ITEM_SFX.holz;
const stein = ITEM_SFX.stein;
const stoff = ITEM_SFX.pflanze;
const pflanze = ITEM_SFX.pflanze;
const ton = ITEM_SFX.erde;
const geraet = ITEM_SFX.werkzeug;

const DEKO_SPECS: readonly MoebelSpec[] = [
  // --- Wandobjekte ------------------------------------------------------------------------------------
  {
    id: 'bild_landschaft',
    stufe: T1,
    name: { de: 'Landschaftsbild', en: 'Landscape Painting' },
    beschreibung: {
      de: 'Grüne Hügel, ein Weg und die Sonne, gemalt mit Blütenfarben und Holzkohle auf gespanntem Garn. Erinnert daran, wie die Welt einmal aussah.',
      en: 'Green hills, a path and the sun, painted with flower dyes and charcoal on stretched yarn. A reminder of how the world once looked.',
    },
    tauschwert: 17,
    aufheben: holz,
    platz: { art: 'wandmoebel', material: 'holz', kategorie: 'bild' },
  },
  {
    id: 'wandteppich',
    stufe: T1,
    name: { de: 'Wandteppich', en: 'Tapestry' },
    beschreibung: {
      de: 'Ein gewebter Behang mit Rautenmuster in Rot und Blau. Hält die Kälte der Wand ein wenig ab und schmückt den Raum.',
      en: 'A woven hanging with a diamond pattern in red and blue. Keeps a little of the wall’s cold away and adorns the room.',
    },
    tauschwert: 34,
    aufheben: stoff,
    platz: { art: 'wandmoebel', material: 'stroh', kategorie: 'bild' },
  },
  {
    id: 'wandschild',
    stufe: T0,
    name: { de: 'Wandschild', en: 'Wall Sign' },
    beschreibung: {
      de: 'Ein Brett an zwei Seilen mit einer eingebrannten Herdflamme. Zeigt, wo das Zuhause ist.',
      en: 'A board on two ropes with a hearth flame burnt into it. Shows where home is.',
    },
    tauschwert: 10,
    aufheben: holz,
    platz: { art: 'wandmoebel', material: 'holz', kategorie: 'bild' },
  },
  {
    id: 'spiegel_wand',
    stufe: T1,
    name: { de: 'Wandspiegel', en: 'Wall Mirror' },
    beschreibung: {
      de: 'Glas mit einer Zinnschicht in einem ovalen Bronzerahmen. Wer hineinsieht, sieht jemanden, der noch nicht aufgegeben hat.',
      en: 'Glass backed with tin in an oval bronze frame. Whoever looks into it sees someone who has not given up yet.',
    },
    tauschwert: 40,
    aufheben: geraet,
    platz: { art: 'wandmoebel', material: 'glas', kategorie: 'deko' },
  },
  {
    id: 'trophaeenbrett',
    stufe: T1,
    name: { de: 'Trophäenbrett', en: 'Trophy Board' },
    beschreibung: {
      de: 'Ein Wappenschild aus Holz mit geschnitztem Rand und Bronzehaken für eine Trophäe. Drei davon in einem Raum machen eine Trophäenhalle.',
      en: 'A wooden shield with a carved rim and a bronze hook for a trophy. Three of them in a room make a trophy hall.',
    },
    tauschwert: 20,
    aufheben: holz,
    platz: { art: 'wandmoebel', material: 'holz', kategorie: 'trophaee' },
  },
  {
    id: 'vorhang_leinen',
    stufe: T1,
    name: { de: 'Leinenvorhang', en: 'Linen Curtain' },
    beschreibung: {
      de: 'Zwei gebündelte Vorhänge aus Garn an einer Stange. Hängt über ein Fenster und macht den Raum wohnlich.',
      en: 'Two tied-back curtains of yarn on a rod. Hangs over a window and makes the room homely.',
    },
    tauschwert: 23,
    aufheben: stoff,
    platz: { art: 'wandmoebel', material: 'stroh', kategorie: 'deko' },
  },
  {
    id: 'fahne_wand',
    stufe: T1,
    name: { de: 'Wandfahne', en: 'Wall Banner' },
    beschreibung: {
      de: 'Ein rotes Tuch mit goldener Herdflamme an einer Stange, gefärbt mit Blüten. Das Zeichen derer, die das Licht zurückbringen.',
      en: 'A red cloth with a golden hearth flame on a rod, dyed with flowers. The sign of those who bring the light back.',
    },
    tauschwert: 26,
    aufheben: stoff,
    platz: { art: 'wandmoebel', material: 'stroh', kategorie: 'deko' },
  },
  {
    id: 'kranz_tuer',
    stufe: T0,
    name: { de: 'Türkranz', en: 'Door Wreath' },
    beschreibung: {
      de: 'Ein Ring aus Zweigen und Laub mit roten Blüten und einer Schleife. Hängt an Tür oder Wand und heißt Heimkehrer willkommen.',
      en: 'A ring of twigs and leaves with red flowers and a bow. Hangs on a door or wall and welcomes whoever comes home.',
    },
    tauschwert: 24,
    aufheben: pflanze,
    platz: { art: 'wandmoebel', material: 'stroh', kategorie: 'deko' },
  },
  {
    id: 'werkzeugwand_deko',
    stufe: T0,
    name: { de: 'Werkzeugbrett', en: 'Tool Board' },
    beschreibung: {
      de: 'Ein Lochbrett mit Steinaxt, Hammer und Seilrolle. Zur Zierde – die Werkzeuge sind festgebunden.',
      en: 'A pegboard with a stone axe, a hammer and a coil of rope. For show – the tools are tied on.',
    },
    tauschwert: 18,
    aufheben: holz,
    platz: { art: 'wandmoebel', material: 'holz', kategorie: 'deko' },
  },
  {
    id: 'blumenampel',
    stufe: T0,
    name: { de: 'Blumenampel', en: 'Hanging Basket' },
    beschreibung: {
      de: 'Ein Tontopf mit gelben Blüten in einem Netz aus Faserseil. Hängt an der Wand und blüht auch im Haus.',
      en: 'A clay pot with yellow flowers in a net of fibre rope. Hangs on the wall and blooms indoors too.',
    },
    tauschwert: 26,
    aufheben: pflanze,
    platz: { art: 'wandmoebel', material: 'lehm', kategorie: 'pflanze' },
  },
  // --- Pflanzen ---------------------------------------------------------------------------------------
  {
    id: 'blumentopf',
    stufe: T0,
    name: { de: 'Blumentopf', en: 'Flower Pot' },
    beschreibung: {
      de: 'Ein Tontopf mit roten Blüten. Ein Stück Wiese für drinnen.',
      en: 'A clay pot with red flowers. A piece of meadow for indoors.',
    },
    tauschwert: 17,
    aufheben: pflanze,
    platz: { art: 'moebel', material: 'lehm', kategorie: 'pflanze' },
  },
  {
    id: 'topfpflanze',
    stufe: T0,
    name: { de: 'Topfpflanze', en: 'Potted Plant' },
    beschreibung: {
      de: 'Ein Tontopf mit einem jungen Laubbaum, der sich zu einem dichten Blattbusch gefächert hat.',
      en: 'A clay pot with a young broadleaf tree that has fanned out into a dense bush of leaves.',
    },
    tauschwert: 16,
    aufheben: pflanze,
    platz: { art: 'moebel', material: 'lehm', kategorie: 'pflanze' },
  },
  {
    id: 'pflanzkuebel',
    stufe: T0,
    name: { de: 'Pflanzkübel', en: 'Planter' },
    beschreibung: {
      de: 'Ein langer Holzkasten voll Erde mit gelben Blüten. Schmückt Hof und Stube.',
      en: 'A long wooden box of earth with yellow flowers. Brightens yard and parlour.',
    },
    tauschwert: 16,
    aufheben: pflanze,
    platz: { art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'pflanze' },
  },
  // --- Textilien und Deko -------------------------------------------------------------------------------
  {
    id: 'teppich_stroh',
    stufe: T0,
    name: { de: 'Strohteppich', en: 'Straw Rug' },
    beschreibung: {
      de: 'Eine geflochtene Matte mit Randborte und einer Raute aus rot gefärbten Halmen. Liegt flach auf dem Boden, man geht darüber.',
      en: 'A woven mat with a border and a diamond of red-dyed straw. Lies flat on the floor; you walk over it.',
    },
    tauschwert: 46,
    aufheben: stoff,
    platz: { art: 'moebel', material: 'stroh', groesse: { b: 2, t: 2 }, kategorie: 'teppich', blockiert: false },
  },
  {
    id: 'vase_keramik',
    stufe: T0,
    name: { de: 'Keramikvase', en: 'Ceramic Vase' },
    beschreibung: {
      de: 'Eine bauchige Vase mit blauer Glasur und hellem Wellenband, im Lehmofen gebrannt.',
      en: 'A bellied vase with a blue glaze and a pale wave band, fired in the clay oven.',
    },
    tauschwert: 8,
    aufheben: ton,
    platz: { art: 'moebel', material: 'lehm', kategorie: 'deko' },
  },
  {
    id: 'wiege',
    stufe: T1,
    name: { de: 'Wiege', en: 'Cradle' },
    beschreibung: {
      de: 'Ein kleiner Kasten auf gebogenen Kufen mit Strohkissen und rotem Deckchen. Wartet auf bessere Zeiten.',
      en: 'A small box on curved rockers with a straw cushion and a red blanket. Waiting for better times.',
    },
    tauschwert: 20,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'deko' },
  },
  {
    id: 'schaukelpferd',
    stufe: T0,
    name: { de: 'Schaukelpferd', en: 'Rocking Horse' },
    beschreibung: {
      de: 'Ein Holzpferd auf Kufen mit einer Mähne aus Fasern. Ein Spielzeug aus der Zeit vor der Dunkelheit – oder für die Zeit danach.',
      en: 'A wooden horse on rockers with a mane of fibres. A toy from the time before the darkness – or for the time after it.',
    },
    tauschwert: 13,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'deko' },
  },
  {
    id: 'waschzuber',
    stufe: T0,
    name: { de: 'Waschzuber', en: 'Wash Tub' },
    beschreibung: {
      de: 'Ein runder Bottich aus Dauben mit zwei Griffen, voll klarem Wasser. Zur Zierde.',
      en: 'A round tub of staves with two handles, full of clear water. For show.',
    },
    tauschwert: 12,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'deko' },
  },
  // --- Hof und Garten ---------------------------------------------------------------------------------
  {
    id: 'uhr_sonne',
    stufe: T1,
    name: { de: 'Sonnenuhr', en: 'Sundial' },
    beschreibung: {
      de: 'Eine Steinsäule mit Zifferblatt und bronzenem Zeiger. Zeigt die Stunde, solange die Sonne scheint.',
      en: 'A stone pillar with a dial and a bronze gnomon. Tells the hour as long as the sun shines.',
    },
    tauschwert: 32,
    aufheben: stein,
    platz: { art: 'moebel', material: 'stein', kategorie: 'deko' },
  },
  {
    id: 'vogelhaus',
    stufe: T0,
    name: { de: 'Vogelhaus', en: 'Birdhouse' },
    beschreibung: {
      de: 'Ein Häuschen mit Schindeldach und Flugloch auf einem Pfahl. Vielleicht kehren die Vögel zurück.',
      en: 'A little house with a shingle roof and an entrance hole on a post. Perhaps the birds will return.',
    },
    tauschwert: 10,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'deko' },
  },
  {
    id: 'holzstapel',
    stufe: T0,
    name: { de: 'Holzstapel', en: 'Woodpile' },
    beschreibung: {
      de: 'Scheite in drei Lagen zwischen zwei Pflöcken. Zur Zierde – zum Heizen nimmt man Holz aus der Kiste.',
      en: 'Logs in three layers between two stakes. For show – for heating, take wood from a chest.',
    },
    tauschwert: 24,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'deko' },
  },
  {
    id: 'steinbrunnen_deko',
    stufe: T0,
    name: { de: 'Zierbrunnen', en: 'Stone Well' },
    beschreibung: {
      de: 'Ein Ring aus Feldsteinen mit Schindeldach, Welle und Eimer. Zur Zierde – Wasser schöpft man am Ufer.',
      en: 'A ring of fieldstones with a shingle roof, a windlass and a bucket. For show – water is drawn at the shore.',
    },
    tauschwert: 82,
    aufheben: stein,
    platz: { art: 'moebel', material: 'stein', groesse: { b: 2, t: 2 }, kategorie: 'deko' },
  },
  {
    id: 'wegweiser',
    stufe: T0,
    name: { de: 'Wegweiser', en: 'Signpost' },
    beschreibung: {
      de: 'Ein Pfahl mit zwei Pfeilbrettern und eingebrannten Zeichen. Zeigt den Weg nach Hause.',
      en: 'A post with two arrow boards and burnt-in signs. Points the way home.',
    },
    tauschwert: 10,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'deko' },
  },
];

const GRUPPE = moebelGruppe('moebel_deko', DEKO_SPECS);

/** Decoration items (category `bauteil`). */
export const MOEBEL_DEKO = GRUPPE.items;
/** How the decoration is placed (build parts; registered with src/content/buildParts.ts). */
export const MOEBEL_DEKO_BAUTEILE = GRUPPE.teile;

/**
 * Height of a wall object's anchor (its lowest pixel row) above the foot line of the wall front it hangs on
 * [px]. A wall object sits on the layer `wandobjekt` of the open tile in front of a wall and hangs on the 16 px
 * front of that wall to its north (ADR-0040; assets-src/sprites/bau/_bau.ts: the front of a wall on tile (tx, ty)
 * reaches from world y `ty·16 − 5` to its foot line `ty·16 + 10`; §4.4 "16 px sichtbare Wand je Höhenstufe"). Every object fits the front: its height
 * plus this offset stays within 16 px (tests/unit/content/moebel.test.ts) – shelves and lamps at chest height
 * of the figure, pictures above them, curtains, banners and the tapestry from just above the floor to the top.
 */
export const MOEBEL_WANDHOEHE_PX: Readonly<Record<string, number>> = {
  regal_wand: 4,
  kleiderhaken: 1,
  harzlampe_wand: 3,
  bild_landschaft: 2,
  wandteppich: 1,
  wandschild: 3,
  spiegel_wand: 2,
  trophaeenbrett: 1,
  vorhang_leinen: 1,
  fahne_wand: 1,
  kranz_tuer: 1,
  werkzeugwand_deko: 1,
  blumenampel: 2,
};
