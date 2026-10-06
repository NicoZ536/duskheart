/**
 * The location types of M7 (docs/SPIEL.md §18 "Ortstypen M7", §29; MASTERPROMPT §21; M7-08, M7-09; strand B): ten types that
 * count towards §C "Ortstypen" – the beacon site, the look-out tower, the abandoned farmstead, the shrine, the natural wonder
 * (variant `uraltbaum`), the dig site, the hermit's hut, the bridge ruin, the Builder graveyard and the meteorite crater. Each
 * names its map symbol `karte_ort_<id>`, its chronicle line, its guards and its effect; the layouts stand in
 * src/content/places/layouts/, the chest loot in src/content/places/beute.ts.
 *
 * `stinger` stays unset until the stinger collection of strand A is integrated (open point M7-73; every type plays the
 * discovery stinger `entdeckung`). Guards are the Grünhain's own creatures (owned, `ort:<slot>`): wasps in the tower, a wolf
 * pair in the farmstead, a boar at the bridge, thornlings among the graves.
 */
import type { PlaceDefInput } from './schema';

/** Seconds a shrine's blessing lasts [s] – ten minutes of game time at the standard day (one game hour = 60 s). */
const BLESSING_SECONDS = 600;
/** Days until a shrine blesses again [game days] – a weekly ritual, the rhythm of the shadow tide (§16.8). */
const BLESSING_COOLDOWN_DAYS = 3;
/** Radius a look-out tower reveals on the map [tiles] (§25 "Aussichtstürme 80"). */
const LOOKOUT_TILES = 80;

export const PLACE_TYPES_B: readonly PlaceDefInput[] = [
  {
    id: 'leuchtfeuer',
    name: { de: 'Leuchtfeuer-Stätte', en: 'Beacon Site' },
    beschreibung: {
      de: 'Ein gepflasterter Platz der Erbauer mit geborstenen Säulen. In seiner Mitte wartet ein kaltes Leuchtfeuer darauf, wieder entzündet zu werden.',
      en: 'A paved Builder plaza ringed by shattered pillars. At its heart a cold beacon waits to be lit again.',
    },
    chronik: { de: 'Ich habe die {name} gefunden. Das alte Feuer ist erloschen – noch.', en: 'I found the {name}. The old fire has gone out – for now.' },
    zaehlt: true,
    kartensymbol: 'karte_ort_leuchtfeuer',
    waechter: [],
    wirkung: 'leuchtfeuer',
  },
  {
    id: 'aussichtsturm',
    name: { de: 'Aussichtsturm', en: 'Lookout Tower' },
    beschreibung: {
      de: 'Ein alter Wachturm aus Feldstein und Balken. Von seiner Plattform überblickt man das Land weit in alle Richtungen.',
      en: 'An old watchtower of fieldstone and beams. From its platform the land lies open far in every direction.',
    },
    chronik: { de: 'Ein {name} auf der Höhe. Von oben sieht die Welt kleiner aus.', en: 'A {name} on the heights. From up there the world looks smaller.' },
    zaehlt: true,
    kartensymbol: 'karte_ort_aussichtsturm',
    waechter: [{ creature: 'wespenschwarm', anzahl: 1 }],
    wirkung: 'aussicht',
    aussichtTiles: LOOKOUT_TILES,
  },
  {
    id: 'gehoeft',
    name: { de: 'Verlassenes Gehöft', en: 'Abandoned Farmstead' },
    beschreibung: {
      de: 'Die Mauern eines Bauernhauses, ein zerbrochener Karren, ein Brunnen. Wer hier lebte, ging in Eile – und kam nie zurück.',
      en: 'The walls of a farmhouse, a broken cart, a well. Whoever lived here left in a hurry – and never came back.',
    },
    chronik: { de: 'Ein {name}. Jemand hat hier gelebt, bevor die Dunkelheit kam.', en: 'An {name}. Someone lived here before the darkness came.' },
    zaehlt: true,
    kartensymbol: 'karte_ort_gehoeft',
    waechter: [{ creature: 'wolf', anzahl: 2 }],
    wirkung: 'tafel',
    notiz: {
      titel: { de: 'Ein Zettel am Pfahl', en: 'A note on the post' },
      text: {
        de: 'Mara, wenn du das liest: Die Schatten kamen über den Bach, schon zwei Nächte vor dem Neumond. Wir gehen zum Leuchtfeuer, solange es noch brennt. Die Saat liegt in der Truhe. Vergiss den Schlüssel nicht. – Jorin',
        en: 'Mara, if you read this: the shadows came over the brook, two nights before the new moon already. We are going to the beacon while it still burns. The seed is in the chest. Do not forget the key. – Jorin',
      },
    },
  },
  {
    id: 'schrein',
    name: { de: 'Schrein der Erbauer', en: 'Builder Shrine' },
    beschreibung: {
      de: 'Eine kleine steinerne Gestalt auf einem Altar, umgeben von geschliffenen Platten. Wer hier betet, spürt eine stille Wärme.',
      en: 'A small stone figure on an altar, ringed by polished slabs. Whoever prays here feels a quiet warmth.',
    },
    chronik: { de: 'Ein {name}. Die Erbauer haben hier etwas hinterlassen, das noch immer wacht.', en: 'A {name}. The Builders left something here that still keeps watch.' },
    zaehlt: true,
    kartensymbol: 'karte_ort_schrein',
    waechter: [],
    wirkung: 'segen',
    segen: { zustand: 'gesegnet', sekunden: BLESSING_SECONDS, abklingTage: BLESSING_COOLDOWN_DAYS },
  },
  {
    id: 'naturwunder',
    name: { de: 'Naturwunder', en: 'Natural Wonder' },
    beschreibung: {
      de: 'Ein Ort, an dem die Welt älter ist als jede Ruine. Der Uraltbaum des Grünhains trägt Wurzeln wie Mauern und eine Krone wie ein Himmel.',
      en: 'A place where the world is older than any ruin. The Ancient Tree of the Greengrove has roots like walls and a crown like a sky.',
    },
    chronik: { de: 'Ein {name}: der Uraltbaum. Unter ihm fühlt sich die Nacht weniger kalt an.', en: 'A {name}: the Ancient Tree. Beneath it the night feels less cold.' },
    zaehlt: true,
    kartensymbol: 'karte_ort_naturwunder',
    entdeckungTiles: 14,
    waechter: [],
    wirkung: 'keine',
  },
  {
    id: 'buddelstelle',
    name: { de: 'Buddelstelle', en: 'Dig Site' },
    beschreibung: {
      de: 'Ein Kreuz aus Steinen auf lockerer Erde. Irgendwer hat hier etwas vergraben – eine Schaufel bringt es ans Licht.',
      en: 'A cross of stones on loose earth. Someone buried something here – a shovel brings it to light.',
    },
    chronik: { de: 'Eine {name}. Ein Kreuz aus Steinen markiert die Stelle.', en: 'A {name}. A cross of stones marks the spot.' },
    zaehlt: true,
    kartensymbol: 'karte_ort_buddelstelle',
    entdeckungTiles: 4,
    waechter: [],
    wirkung: 'buddeln',
  },
  {
    id: 'eremitenhuette',
    name: { de: 'Eremitenhütte', en: "Hermit's Hut" },
    beschreibung: {
      de: 'Eine Hütte aus Rinde und Lehm, weit weg von allen Wegen. Kräuter hängen noch unter dem Dach, die Feuerstelle ist längst kalt.',
      en: 'A hut of bark and clay, far from every road. Herbs still hang under the eaves; the fire pit has long gone cold.',
    },
    chronik: { de: 'Eine {name}, fernab aller Wege. Wer hier lebte, wollte nicht gefunden werden.', en: 'A {name}, far from every road. Whoever lived here did not want to be found.' },
    zaehlt: true,
    kartensymbol: 'karte_ort_eremitenhuette',
    waechter: [],
    wirkung: 'tafel',
    notiz: {
      titel: { de: 'Ein Blatt Rinde, eng beschrieben', en: 'A strip of bark, closely written' },
      text: {
        de: 'Das Licht ist kein Geschenk. Es ist ein Versprechen, das wir gebrochen haben. Die Erbauer bauten sechs Feuer, damit die Nacht nicht zurückkommt – und wir ließen sie ausgehen, eins nach dem anderen. Wer das liest: Folge der alten Straße. Das erste Feuer wartet noch.',
        en: 'The light is no gift. It is a promise we broke. The Builders raised six fires so the night would not return – and we let them go out, one after another. Whoever reads this: follow the old road. The first fire is still waiting.',
      },
    },
  },
  {
    id: 'brueckenruine',
    name: { de: 'Brückenruine', en: 'Bridge Ruin' },
    beschreibung: {
      de: 'Der Brückenkopf einer Erbauer-Brücke: geborstene Pfeiler, ein gestürzter Steinkopf. Die Brücke trägt noch – gerade so.',
      en: 'The head of a Builder bridge: cracked pillars, a toppled stone head. The bridge still holds – barely.',
    },
    chronik: { de: 'Eine {name}. Die Erbauer bauten für die Ewigkeit; die Ewigkeit war kürzer.', en: 'A {name}. The Builders built for eternity; eternity was shorter.' },
    zaehlt: true,
    kartensymbol: 'karte_ort_brueckenruine',
    waechter: [{ creature: 'keiler', anzahl: 1 }],
    wirkung: 'keine',
  },
  {
    id: 'friedhof',
    name: { de: 'Friedhof der Erbauer', en: 'Builder Graveyard' },
    beschreibung: {
      de: 'Reihen verwitterter Grabsteine hinter einem rostigen Zaun, in der Mitte ein Obelisk mit einer Inschrift. Dornlinge wuchern zwischen den Gräbern.',
      en: 'Rows of weathered gravestones behind a rusted fence, an obelisk with an inscription in their midst. Thornlings grow rampant among the graves.',
    },
    chronik: { de: 'Ein {name}. Selbst die Erbauer mussten sterben.', en: 'A {name}. Even the Builders had to die.' },
    zaehlt: true,
    kartensymbol: 'karte_ort_friedhof',
    waechter: [{ creature: 'dornling', anzahl: 3 }],
    wirkung: 'tafel',
    notiz: {
      titel: { de: 'Inschrift auf dem Obelisken', en: 'Inscription on the obelisk' },
      text: {
        de: 'HIER RUHEN DIE HÜTER DES ERSTEN FEUERS. SIE GABEN IHR LICHT, DAMIT DIE ANDEREN SEHEN. WER DIESES FEUER WIEDER ENTZÜNDET, TRÄGT IHREN NAMEN WEITER.',
        en: 'HERE REST THE KEEPERS OF THE FIRST FIRE. THEY GAVE THEIR LIGHT SO OTHERS COULD SEE. WHOEVER LIGHTS THIS FIRE AGAIN CARRIES THEIR NAME ON.',
      },
    },
  },
  {
    id: 'meteoritenkrater',
    name: { de: 'Meteoritenkrater', en: 'Meteorite Crater' },
    beschreibung: {
      de: 'Eine versengte Mulde, in deren Mitte ein Stern vom Himmel liegt. Um ihn herum glänzt dunkles Sternenerz im aufgebrochenen Boden.',
      en: 'A scorched hollow with a fallen star at its centre. Around it dark star ore glints in the broken ground.',
    },
    chronik: { de: 'Ein {name}. Hier ist ein Stern gefallen – und hat sein Erz zurückgelassen.', en: 'A {name}. A star fell here – and left its ore behind.' },
    zaehlt: true,
    kartensymbol: 'karte_ort_meteoritenkrater',
    waechter: [],
    wirkung: 'krater',
  },
];
