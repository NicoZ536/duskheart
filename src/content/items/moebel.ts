/**
 * Möbel und Lichter T0–T1 (M4-19; docs/SPIEL.md §8 "Möbel, Deko, Wandobjekte, Lichter T0–T1 (M4-19)";
 * MASTERPROMPT §16.1 "Objekte (1×1 bis 4×4) · Wandobjekte", §16.4 "Behaglichkeit … aus einzigartigen
 * Möbelkategorien", §12.2 "Kerzen, Wandlampen, Kronleuchter 3–9 … Behaglichkeit"): Betten, Sitzmöbel, Tische,
 * Schränke und Regale, Deko-Behälter und die Lichter aus Harz, Glas und Stein. Deko, Pflanzen, Textilien und
 * die übrigen Wandobjekte stehen in moebel_deko.ts.
 *
 * Jedes Möbel ist dreierlei:
 * - ein **Item** der Kategorie `bauteil` (Stapel 50, zählt als `items` und `buildParts`, §C „Bauteile, Möbel,
 *   Deko“, ADR-0006), hergestellt an einer Station (src/content/recipes/moebel.ts), gezeichnet als
 *   `obj_<id>` (assets-src/sprites/moebel/) mit dem Icon `icon_<id>` (assets-src/sprites/icons/moebel*.ts);
 * - ein **Bauteil** (src/content/buildParts.ts): `moebel` auf der Objektebene oder `wandmoebel` an der
 *   Wandfläche nördlich seines Tiles, mit Stellfläche `groesse` (Breite × Tiefe), Material (Trefferpunkte,
 *   Brennbarkeit) und Möbelkategorie für Raumtyp und Behaglichkeit (§16.4); Betten sind Schlafplätze;
 * - die **Lichter** zusätzlich eine Lichtart (`MOEBEL_LICHTER`): Radius nach §12.2, Farbe, Brennstoff und
 *   Brenndauer, Einbauhöhe der Flamme (Sockel `licht` des Sprites).
 *
 * Stufen folgen den Zutaten (tools/validator/tiers.ts): Holz, Stroh, Stein, Keramik und Glas sind T0, Garn,
 * Bronze und Bronzenägel T1. Tauschwerte: Zutaten plus etwa ein Fünftel für die Arbeit (wie grundlagen.ts).
 * Kerzenständer (Kerzen aus Wachs, M8-43) und das Hirschgeweih (Geweih von der Jagd, M6) kommen mit ihren
 * Quellen.
 */
import { z } from 'zod';
import { paletteRefSchema } from '../biomes';
import { defineBuildParts, type BuildPartInput } from '../buildParts';
import { deepFreeze } from '../freeze';
import { idSchema, localizedTextSchema, refSchema } from '../schema/common';
import { sfxIdSchema } from '../schema/item';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Tier of furniture made of wood, straw, stone, ceramic and glass. */
const T0 = 0;
/** Tier of furniture with yarn or bronze (§13.2, the smelter and the spinning wheel). */
const T1 = 1;

/** Text in both languages. */
interface Text {
  readonly de: string;
  readonly en: string;
}

/** One piece of furniture: item data plus how it is placed (build part without its id). */
export interface MoebelSpec {
  readonly id: string;
  readonly stufe: number;
  readonly name: Text;
  readonly beschreibung: Text;
  readonly tauschwert: number;
  /** Handling sound (`ITEM_SFX`). */
  readonly aufheben: string;
  /** Build part record without the id (`art`, `material`, `groesse`, `kategorie` …). */
  readonly platz: Omit<BuildPartInput, 'id'>;
}

/** Items and build parts of a list of furniture. */
export function moebelGruppe(group: string, specs: readonly MoebelSpec[]): { readonly items: ReturnType<typeof defineItemGroup>; readonly teile: ReturnType<typeof defineBuildParts> } {
  const items = defineItemGroup(
    group,
    specs.map((s) => baseItem({ id: s.id, name: s.name, beschreibung: s.beschreibung, kategorie: 'bauteil', stufe: s.stufe, tauschwert: s.tauschwert, sounds: { aufheben: s.aufheben } })),
  );
  const teile = defineBuildParts(group, specs.map((s) => ({ id: s.id, ...s.platz })));
  return { items, teile };
}

const holz = ITEM_SFX.holz;
const stein = ITEM_SFX.stein;
const stoff = ITEM_SFX.pflanze;
const geraet = ITEM_SFX.werkzeug;
const ton = ITEM_SFX.erde;

const MOEBEL_SPECS: readonly MoebelSpec[] = [
  // --- Betten (Schlafplätze, §11.5; Raumtyp Schlafraum: Bett + Licht) -------------------------------
  {
    id: 'strohbett',
    stufe: T0,
    name: { de: 'Strohbett', en: 'Straw Bed' },
    beschreibung: {
      de: 'Ein Strohsack in einem niedrigen Rahmen aus Rundhölzern, am Fußende eine Wolldecke. Ein richtiges Bett: Hier schläft man durch, erholt sich ganz und erwacht wieder.',
      en: 'A straw mattress in a low frame of round timber, a woollen blanket at the foot. A real bed: you sleep through the night here, recover fully and wake here again.',
    },
    tauschwert: 53,
    aufheben: stoff,
    platz: { art: 'moebel', material: 'stroh', groesse: { b: 1, t: 2 }, kategorie: 'bett', schlafplatz: 'bett' },
  },
  {
    id: 'holzbett',
    stufe: T1,
    name: { de: 'Holzbett', en: 'Wooden Bed' },
    beschreibung: {
      de: 'Ein Bett mit Kopf- und Fußteil, Leinenkissen und roter Wolldecke. Hier schläft man durch, erholt sich ganz und erwacht wieder – mit Licht im Raum wird daraus ein Schlafraum.',
      en: 'A bed with head- and footboard, a linen pillow and a red woollen blanket. You sleep through the night here, recover fully and wake here again – with a light in the room it makes a bedroom.',
    },
    tauschwert: 54,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', groesse: { b: 1, t: 2 }, kategorie: 'bett', schlafplatz: 'bett' },
  },
  // --- Sitzmöbel (Raumtyp Speisesaal: Tisch + zwei Sitze) --------------------------------------------
  {
    id: 'hocker_holz',
    stufe: T0,
    name: { de: 'Holzhocker', en: 'Wooden Stool' },
    beschreibung: {
      de: 'Eine runde Sitzscheibe auf gespreizten Beinen. Ein Sitzplatz, der wenig Raum braucht.',
      en: 'A round seat on splayed legs. A place to sit that takes little room.',
    },
    tauschwert: 6,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'sitz' },
  },
  {
    id: 'stuhl_holz',
    stufe: T0,
    name: { de: 'Holzstuhl', en: 'Wooden Chair' },
    beschreibung: {
      de: 'Ein Stuhl mit Sprossenlehne. Zwei davon an einem Tisch machen aus einem Raum einen Speisesaal.',
      en: 'A chair with a ladder back. Two of them at a table turn a room into a dining hall.',
    },
    tauschwert: 7,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'sitz' },
  },
  {
    id: 'bank_holz',
    stufe: T0,
    name: { de: 'Holzbank', en: 'Wooden Bench' },
    beschreibung: {
      de: 'Eine dicke Sitzbohle auf vier Beinen, Platz für zwei. Steht gut an einem langen Tisch.',
      en: 'A thick seat plank on four legs, room for two. Sits well at a long table.',
    },
    tauschwert: 11,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'sitz' },
  },
  {
    id: 'gartenbank',
    stufe: T0,
    name: { de: 'Gartenbank', en: 'Garden Bench' },
    beschreibung: {
      de: 'Ein Lattensitz mit Lehne auf zwei gemauerten Steinwangen. Wind und Regen können ihr wenig anhaben.',
      en: 'A slatted seat with a backrest on two masonry stone ends. Wind and rain can do little to it.',
    },
    tauschwert: 16,
    aufheben: stein,
    platz: { art: 'moebel', material: 'stein', groesse: { b: 2, t: 1 }, kategorie: 'sitz' },
  },
  {
    id: 'schaukelstuhl',
    stufe: T1,
    name: { de: 'Schaukelstuhl', en: 'Rocking Chair' },
    beschreibung: {
      de: 'Ein Stuhl mit hoher Lehne und Armlehnen auf gebogenen Kufen, mit Bronzenägeln gefügt. Der gemütlichste Sitzplatz am Kamin.',
      en: 'A high-backed chair with armrests on curved rockers, joined with bronze nails. The cosiest seat by the fireplace.',
    },
    tauschwert: 17,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'sitz' },
  },
  {
    id: 'truhenbank',
    stufe: T1,
    name: { de: 'Truhenbank', en: 'Chest Bench' },
    beschreibung: {
      de: 'Eine Kastenbank mit Lehne, Sitzdeckel und Bronzeschloss. Zwei sitzen darauf; als Kiste dient sie nicht.',
      en: 'A box bench with a backrest, a seat lid and a bronze lock. Two can sit on it; it does not serve as a chest.',
    },
    tauschwert: 30,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'sitz' },
  },
  {
    id: 'sitzkissen',
    stufe: T1,
    name: { de: 'Sitzkissen', en: 'Floor Cushion' },
    beschreibung: {
      de: 'Ein dickes, mit Fasern gestopftes Kissen aus gewebtem Garn. Man sitzt am Boden und kann darüber hinweggehen.',
      en: 'A thick cushion of woven yarn stuffed with fibres. You sit on the floor and can walk over it.',
    },
    tauschwert: 16,
    aufheben: stoff,
    platz: { art: 'moebel', material: 'stroh', kategorie: 'sitz', blockiert: false },
  },
  // --- Tische ---------------------------------------------------------------------------------------
  {
    id: 'tisch_holz',
    stufe: T0,
    name: { de: 'Holztisch', en: 'Wooden Table' },
    beschreibung: {
      de: 'Ein Tisch aus drei Bohlen auf vier Beinen. Mit Stühlen ein Speisesaal, mit Kochstelle und Vorrat eine Küche.',
      en: 'A table of three planks on four legs. With chairs it makes a dining hall, with a cooking place and supplies a kitchen.',
    },
    tauschwert: 12,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'tisch' },
  },
  {
    id: 'tischdecke',
    stufe: T1,
    name: { de: 'Tisch mit Tischdecke', en: 'Table with Tablecloth' },
    beschreibung: {
      de: 'Ein Holztisch unter einer rot-weiß karierten Decke aus Garn, mit Blütenrot gefärbt. Zählt als Tisch und macht jede Mahlzeit ein wenig festlicher.',
      en: 'A wooden table under a red-and-white checked cloth of yarn, dyed with flower red. Counts as a table and makes every meal a little more festive.',
    },
    tauschwert: 32,
    aufheben: stoff,
    platz: { art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'tisch' },
  },
  {
    id: 'schreibpult',
    stufe: T1,
    name: { de: 'Schreibpult', en: 'Writing Desk' },
    beschreibung: {
      de: 'Ein Pult mit zwei Schubladen und Bronzeknäufen, darauf ein Blatt, Tintenfass und Feder. Tinte aus Holzkohle.',
      en: 'A desk with two drawers and bronze knobs, on it a sheet, an inkwell and a quill. Ink from charcoal.',
    },
    tauschwert: 19,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'tisch' },
  },
  {
    id: 'nachttisch',
    stufe: T0,
    name: { de: 'Nachttisch', en: 'Bedside Table' },
    beschreibung: {
      de: 'Ein kleines Schränkchen mit Schublade und offenem Fach. Gehört neben das Bett.',
      en: 'A small cabinet with a drawer and an open shelf. Belongs next to the bed.',
    },
    tauschwert: 7,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'schrank' },
  },
  // --- Schränke und Regale (Einrichtung, keine Lagerung – die Kisten sind M4-21) -------------------
  {
    id: 'schrank_holz',
    stufe: T1,
    name: { de: 'Kleiderschrank', en: 'Wardrobe' },
    beschreibung: {
      de: 'Ein hoher Schrank mit zwei Türen, vertieften Füllungen und Bronzeknäufen. Macht den Raum wohnlich; lagern lässt sich darin nichts.',
      en: 'A tall wardrobe with two doors, recessed panels and bronze knobs. Makes a room homely; it stores nothing.',
    },
    tauschwert: 41,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'schrank' },
  },
  {
    id: 'kommode',
    stufe: T1,
    name: { de: 'Kommode', en: 'Chest of Drawers' },
    beschreibung: {
      de: 'Eine breite Kommode mit sechs Schubladen und Bronzegriffen. Macht den Raum wohnlich; lagern lässt sich darin nichts.',
      en: 'A broad chest with six drawers and bronze handles. Makes a room homely; it stores nothing.',
    },
    tauschwert: 34,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'schrank' },
  },
  {
    id: 'buecherregal',
    stufe: T1,
    name: { de: 'Bücherregal', en: 'Bookshelf' },
    beschreibung: {
      de: 'Drei Böden voller Bücher – Blätter aus Birkenrinde, mit Garn gebunden. Wer abends darin blättert, fürchtet sich weniger.',
      en: 'Three shelves full of books – leaves of birch bark bound with yarn. Leafing through them in the evening, you fear less.',
    },
    tauschwert: 32,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'schrank' },
  },
  {
    id: 'weinregal',
    stufe: T0,
    name: { de: 'Weinregal', en: 'Wine Rack' },
    beschreibung: {
      de: 'Ein Gitter aus dreißig Fächern, in den meisten eine Flasche aus grünem Glas. Die Flaschen sind leer – noch.',
      en: 'A lattice of thirty cubbies, most holding a bottle of green glass. The bottles are empty – for now.',
    },
    tauschwert: 36,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', groesse: { b: 2, t: 1 }, kategorie: 'schrank' },
  },
  {
    id: 'regal_wand',
    stufe: T0,
    name: { de: 'Wandregal', en: 'Wall Shelf' },
    beschreibung: {
      de: 'Ein Brett auf zwei Konsolen, darauf ein Tonkrug und kleine Töpfe. Hängt an der Wand.',
      en: 'A board on two brackets holding a clay jug and small pots. Hangs on the wall.',
    },
    tauschwert: 12,
    aufheben: holz,
    platz: { art: 'wandmoebel', material: 'holz', kategorie: 'schrank' },
  },
  {
    id: 'kleiderhaken',
    stufe: T0,
    name: { de: 'Kleiderhaken', en: 'Coat Hooks' },
    beschreibung: {
      de: 'Ein Brett mit drei Holzzapfen, daran eine Kappe und ein Beutel aus Fasern. Hängt an der Wand.',
      en: 'A board with three wooden pegs, a hood and a fibre bag hanging on them. Hangs on the wall.',
    },
    tauschwert: 12,
    aufheben: holz,
    platz: { art: 'wandmoebel', material: 'holz', kategorie: 'schrank' },
  },
  // --- Deko-Behälter (keine Kisten: Lagerung ist M4-21) -----------------------------------------------
  {
    id: 'truhe_deko',
    stufe: T1,
    name: { de: 'Reisetruhe', en: 'Travel Chest' },
    beschreibung: {
      de: 'Eine Truhe mit gewölbtem Deckel, Kupferbändern und Schloss. Zur Zierde – verschlossen, der Schlüssel fehlt.',
      en: 'A chest with a domed lid, copper bands and a lock. For show – locked, and the key is missing.',
    },
    tauschwert: 24,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'deko' },
  },
  {
    id: 'kiste_deko',
    stufe: T0,
    name: { de: 'Apfelkiste', en: 'Apple Crate' },
    beschreibung: {
      de: 'Eine Lattenkiste mit einem Haufen roter Äpfel darauf. Zur Zierde: Die Äpfel sind fest verkeilt und nicht mehr zu essen.',
      en: 'A slatted crate topped with a heap of red apples. For show: the apples are wedged in tight and no longer fit to eat.',
    },
    tauschwert: 19,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'deko' },
  },
  {
    id: 'fass_holz',
    stufe: T0,
    name: { de: 'Holzfass', en: 'Wooden Barrel' },
    beschreibung: {
      de: 'Ein bauchiges Fass aus Dauben, gehalten von Reifen aus gespaltenen Zweigen. Zur Zierde; das Vorratsfass folgt später.',
      en: 'A bellied barrel of staves held by hoops of split twigs. For show; the storage barrel comes later.',
    },
    tauschwert: 12,
    aufheben: holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'deko' },
  },
  // --- Lichter (§12.2; Lichtarten in MOEBEL_LICHTER) --------------------------------------------------
  {
    id: 'harzlampe',
    stufe: T0,
    name: { de: 'Harzlampe', en: 'Resin Lamp' },
    beschreibung: {
      de: 'Eine Tonschale voll Harz auf einem hölzernen Dreibein. Leuchtet vier Kacheln weit, ein Harzbrocken brennt sechs Spielstunden.',
      en: 'A clay bowl full of resin on a wooden tripod. Lights four tiles around; a lump of resin burns for six game hours.',
    },
    tauschwert: 20,
    aufheben: ton,
    platz: { art: 'moebel', material: 'holz', kategorie: 'licht' },
  },
  {
    id: 'harzlampe_wand',
    stufe: T0,
    name: { de: 'Wand-Harzlampe', en: 'Wall Resin Lamp' },
    beschreibung: {
      de: 'Eine Tonschale voll Harz auf einem Wandbrett. Leuchtet vier Kacheln weit, ein Harzbrocken brennt sechs Spielstunden.',
      en: 'A clay bowl full of resin on a wall bracket. Lights four tiles around; a lump of resin burns for six game hours.',
    },
    tauschwert: 18,
    aufheben: ton,
    platz: { art: 'wandmoebel', material: 'holz', kategorie: 'licht' },
  },
  {
    id: 'laterne_stehend',
    stufe: T1,
    name: { de: 'Stehlaterne', en: 'Standing Lantern' },
    beschreibung: {
      de: 'Eine Bronzelaterne mit vier Glasscheiben auf einem Holzsockel. Leuchtet fünf Kacheln weit, trotzt Wind und Regen; ein Harzbrocken brennt acht Spielstunden.',
      en: 'A bronze lantern with four glass panes on a wooden base. Lights five tiles around and braves wind and rain; a lump of resin burns for eight game hours.',
    },
    tauschwert: 31,
    aufheben: geraet,
    platz: { art: 'moebel', material: 'glas', kategorie: 'licht' },
  },
  {
    id: 'laternenpfahl',
    stufe: T1,
    name: { de: 'Laternenpfahl', en: 'Lantern Post' },
    beschreibung: {
      de: 'Ein Balken mit Kreuzfuß, oben eine Bronzelaterne über Kopfhöhe. Leuchtet sieben Kacheln weit, trotzt Wind und Regen; ein Harzbrocken brennt acht Spielstunden.',
      en: 'A beam on a cross foot with a bronze lantern above head height. Lights seven tiles around and braves wind and rain; a lump of resin burns for eight game hours.',
    },
    tauschwert: 41,
    aufheben: geraet,
    platz: { art: 'moebel', material: 'holz', kategorie: 'licht' },
  },
  {
    id: 'kamin_stein',
    stufe: T0,
    name: { de: 'Steinkamin', en: 'Stone Fireplace' },
    beschreibung: {
      de: 'Ein gemauerter Kamin mit Holzsims, der Schornstein führt in die Wand. Brennt Holz wie ein Lagerfeuer, leuchtet sechs Kacheln weit und heizt den Raum.',
      en: 'A masonry fireplace with a wooden mantel, its chimney leading into the wall. Burns wood like a campfire, lights six tiles around and heats the room.',
    },
    tauschwert: 64,
    aufheben: stein,
    platz: { art: 'moebel', material: 'stein', groesse: { b: 2, t: 1 }, kategorie: 'kamin' },
  },
];

const GRUPPE = moebelGruppe('moebel', MOEBEL_SPECS);

/** Furniture and light items (category `bauteil`). */
export const MOEBEL = GRUPPE.items;
/** How the furniture and lights are placed (build parts; registered with src/content/buildParts.ts). */
export const MOEBEL_BAUTEILE = GRUPPE.teile;

/**
 * Colour variants of furniture (MASTERPROMPT §5 "Möbel-Farbvarianten", assets-src/sprites/moebel/varianten.ts):
 * the same piece with another cloth (red → green, blue, violet, ochre) or wood (oak → walnut, birch), chosen
 * when placing it. A variant is the same item and build part – it only swaps the sprite (§C counts the piece
 * once).
 */
export const MOEBEL_FARBVARIANTEN: Readonly<Record<string, readonly string[]>> = {
  holzbett: ['obj_holzbett_gruen', 'obj_holzbett_blau', 'obj_holzbett_violett', 'obj_holzbett_ocker'],
  sitzkissen: ['obj_sitzkissen_gruen', 'obj_sitzkissen_blau', 'obj_sitzkissen_violett', 'obj_sitzkissen_ocker'],
  fahne_wand: ['obj_fahne_wand_gruen', 'obj_fahne_wand_blau', 'obj_fahne_wand_violett', 'obj_fahne_wand_ocker'],
  tisch_holz: ['obj_tisch_holz_nussbaum', 'obj_tisch_holz_birke'],
  stuhl_holz: ['obj_stuhl_holz_nussbaum', 'obj_stuhl_holz_birke'],
};

// ---------------------------------------------------------------------------------------------
// Lichter
// ---------------------------------------------------------------------------------------------

/**
 * How a furniture light burns:
 * - `lampe`: a wick in a fuel (`brennstoff`, one piece at a time): each piece burns `stundenJeEinheit` game
 *   hours, the lamp holds up to `vorrat` pieces; lit by hand, it goes out when the fuel is gone. Wind- and
 *   rainproof when `wetterfest` (behind glass); an open flame in the rain burns out like a torch.
 * - `feuer`: an open fire like the camp fire (fuel by its burn value, §15.4) up to `maxSekunden`; it warms by
 *   `waermeC` in its core (§11.2, the heat source of the room climate, §16.4).
 */
export const MOEBEL_LICHT_VERHALTEN = ['lampe', 'feuer'] as const;

/** Schema of one furniture light. */
export const moebelLichtSchema = z
  .object({
    /** The furniture item that gives the light. */
    item: refSchema,
    name: localizedTextSchema,
    /** Its placed sprite; the socket `licht` of every frame is the flame. */
    sprite: idSchema,
    verhalten: z.enum(MOEBEL_LICHT_VERHALTEN),
    /** Reach [tiles]. §12.2. */
    radius: z.number().positive(),
    /** Brightness at the flame [light level, 1 = daylight]. */
    intensitaet: z.number().positive(),
    /** Flicker [0–1]. */
    flackern: z.number().min(0).max(1),
    /** Colour of the light (palette reference of the flame). */
    farbe: paletteRefSchema,
    /** Where it hangs: on the floor or a wall face (like the wall torch). */
    montage: z.enum(['boden', 'wand']),
    /** Lamps: the fuel item, hours per piece [game hours], pieces it holds; `wetterfest`: behind glass. */
    brennstoff: refSchema.optional(),
    stundenJeEinheit: z.number().positive().optional(),
    vorrat: z.number().int().min(1).optional(),
    wetterfest: z.boolean(),
    /** Fires: most fuel it holds [s] and its heat in the core [°C]. */
    maxSekunden: z.number().positive().optional(),
    waermeC: z.number().positive().optional(),
    sounds: z.object({ an: sfxIdSchema, aus: sfxIdSchema, brennen: sfxIdSchema }).strict(),
  })
  .strict()
  .superRefine((l, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    const lampe = l.verhalten === 'lampe';
    if (lampe && (l.brennstoff === undefined || l.stundenJeEinheit === undefined || l.vorrat === undefined)) issue('brennstoff', 'a lamp names its fuel, hours per piece and stock');
    if (!lampe && (l.maxSekunden === undefined || l.waermeC === undefined)) issue('maxSekunden', 'a fire names its most fuel and its heat');
    if (!lampe && (l.brennstoff !== undefined || l.wetterfest)) issue('brennstoff', 'a fire burns any fuel and is not weatherproof');
    if (l.sprite !== `obj_${l.item}`) issue('sprite', `the light of ${l.item} is drawn as obj_${l.item}`);
  });

/** One furniture light (validated). */
export type MoebelLicht = z.output<typeof moebelLichtSchema>;

/** Error in the furniture lights. */
export class MoebelLichtError extends Error {
  override readonly name = 'MoebelLichtError';
}

function defineMoebelLichter(records: readonly z.input<typeof moebelLichtSchema>[]): readonly MoebelLicht[] {
  const seen = new Set<string>();
  const parsed = records.map((raw, index) => {
    const r = moebelLichtSchema.safeParse(raw);
    if (!r.success) throw new MoebelLichtError(`Möbellicht [${index}] "${raw.item}" invalid: ${r.error.issues.map((i) => `${i.path.map(String).join('.') || '(licht)'}: ${i.message}`).join('; ')}`);
    if (seen.has(r.data.item)) throw new MoebelLichtError(`Möbellicht "${r.data.item}" doppelt`);
    seen.add(r.data.item);
    return r.data;
  });
  deepFreeze(parsed);
  return parsed;
}

const LAMPE_SOUNDS = { an: 'sfx_fackel_entzuenden', aus: 'sfx_fackel_erloeschen', brennen: 'sfx_fackel_brennen' } as const;

/**
 * The furniture lights of M4-19. Radii after §12.2 "Kerzen, Wandlampen, Kronleuchter 3–9", "Öllaterne 7":
 * - Harzlampen 4 tiles: a small open flame, brighter than a candle (3), weaker than a torch (6); a lump of
 *   resin (one of the torch's ingredients, which burns 4 h with its fibres) lasts 6 game hours in the bowl,
 *   the bowl holds 4 lumps (a day). Flicker like a small flame; open, so rain puts it out.
 * - Laternen: the flame behind glass burns more slowly (8 h a lump) and steadier (flicker 0,08), wind- and
 *   rainproof like the oil lantern (§12.2 "wetterfest"); the standing lantern 5 tiles, the post 7 like the oil
 *   lantern, its flame high above the ground.
 * - Steinkamin 6 tiles: a fire in a room – smaller than the camp fire (8) because the hearth walls shade it;
 *   it holds twice a camp fire's stock (12 min, §15.4 "Ein Lagerfeuer fasst höchstens 6 Minuten") and warms
 *   like a fire (§11.2 "+15 °C im Kern").
 * Colours: resin burns golden (`feuer.4`), the lantern glass warm cream (`sand.4`), wood fire orange like
 * the camp fire (`feuer.3`).
 */
export const MOEBEL_LICHTER = defineMoebelLichter([
  {
    item: 'harzlampe',
    name: { de: 'Harzlampe', en: 'Resin Lamp' },
    sprite: 'obj_harzlampe',
    verhalten: 'lampe',
    radius: 4,
    intensitaet: 0.85,
    flackern: 0.18,
    farbe: 'feuer.4',
    montage: 'boden',
    brennstoff: 'harz',
    stundenJeEinheit: 6,
    vorrat: 4,
    wetterfest: false,
    sounds: LAMPE_SOUNDS,
  },
  {
    item: 'harzlampe_wand',
    name: { de: 'Wand-Harzlampe', en: 'Wall Resin Lamp' },
    sprite: 'obj_harzlampe_wand',
    verhalten: 'lampe',
    radius: 4,
    intensitaet: 0.85,
    flackern: 0.18,
    farbe: 'feuer.4',
    montage: 'wand',
    brennstoff: 'harz',
    stundenJeEinheit: 6,
    vorrat: 4,
    wetterfest: false,
    sounds: LAMPE_SOUNDS,
  },
  {
    item: 'laterne_stehend',
    name: { de: 'Stehlaterne', en: 'Standing Lantern' },
    sprite: 'obj_laterne_stehend',
    verhalten: 'lampe',
    radius: 5,
    intensitaet: 0.9,
    flackern: 0.08,
    farbe: 'sand.4',
    montage: 'boden',
    brennstoff: 'harz',
    stundenJeEinheit: 8,
    vorrat: 4,
    wetterfest: true,
    sounds: LAMPE_SOUNDS,
  },
  {
    item: 'laternenpfahl',
    name: { de: 'Laternenpfahl', en: 'Lantern Post' },
    sprite: 'obj_laternenpfahl',
    verhalten: 'lampe',
    radius: 7,
    intensitaet: 0.95,
    flackern: 0.08,
    farbe: 'sand.4',
    montage: 'boden',
    brennstoff: 'harz',
    stundenJeEinheit: 8,
    vorrat: 4,
    wetterfest: true,
    sounds: LAMPE_SOUNDS,
  },
  {
    item: 'kamin_stein',
    name: { de: 'Steinkamin', en: 'Stone Fireplace' },
    sprite: 'obj_kamin_stein',
    verhalten: 'feuer',
    radius: 6,
    intensitaet: 1.1,
    flackern: 0.3,
    farbe: 'feuer.3',
    montage: 'boden',
    wetterfest: false,
    maxSekunden: 720,
    waermeC: 15,
    sounds: { an: 'sfx_feuer_entzuenden', aus: 'sfx_feuer_erloeschen', brennen: 'sfx_feuer_knistern' },
  },
]);
