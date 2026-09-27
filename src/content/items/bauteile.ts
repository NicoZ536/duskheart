/**
 * Build part items of tiers T0–T1 (docs/SPIEL.md §8 "Bauteile (M4-12)"; MASTERPROMPT §16.1, §16.2; M4-12):
 * walls, floors, roofs, doors, gates, a trapdoor, windows, pillars, fences, a ladder, stairs and a jetty. Each
 * is made at a station (src/content/recipes/bauteile.ts) and placed from the bags on the build grid
 * (src/game/building); how it stands, collides and insulates says its build part record
 * (src/content/buildParts.ts). They count as `items` and `buildParts` (§C, ADR-0006).
 *
 * - Tiers after the material (§16.2): palisade, wood and straw T0; timber frame, stone, glass and the
 *   shingles fastened with bronze nails T1.
 * - Trade values [trade points]: the ingredients of the recipe plus about a fifth for the work, like the
 *   basics (src/content/items/grundlagen.ts).
 * - Handling sounds by the material in the hand.
 */
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Tier of the parts of palisade, wood and straw (§16.2 "T0"). */
const T0 = 0;
/** Tier of the parts of timber frame, stone and glass (§16.2 "T1"). */
const T1 = 1;

/** A build part item: stack of 50 (`BALANCE.items.stack.bauteil`), placed in the world. */
function part(id: string, tier: number, name: { de: string; en: string }, beschreibung: { de: string; en: string }, tauschwert: number, aufheben: string): ReturnType<typeof baseItem> {
  return baseItem({ id, name, beschreibung, kategorie: 'bauteil', stufe: tier, tauschwert, sounds: { aufheben } });
}

/** The build part items. */
export const BAUTEILE = defineItemGroup('bauteile', [
  // --- Walls -------------------------------------------------------------------------------------
  part(
    'wand_palisade',
    T0,
    { de: 'Palisadenwand', en: 'Palisade Wall' },
    {
      de: 'Angespitzte Pfähle, dicht an dicht gerammt und verschnürt. Schnell gesetzt und schwach (150 Trefferpunkte), brennt leicht, der Wind pfeift durch die Fugen.',
      en: 'Sharpened stakes rammed in side by side and lashed together. Quick to raise and weak (150 hit points), burns easily, the wind whistles through the gaps.',
    },
    5,
    ITEM_SFX.holz,
  ),
  part(
    'wand_holz',
    T0,
    { de: 'Holzwand', en: 'Wooden Wall' },
    {
      de: 'Eine Wand aus gesägten Brettern. Hält 300 Trefferpunkte und die Nachtkälte gut draußen, fängt aber Feuer.',
      en: 'A wall of sawn planks. Holds 300 hit points and keeps the night cold out well, but catches fire.',
    },
    8,
    ITEM_SFX.holz,
  ),
  part(
    'wand_fachwerk',
    T1,
    { de: 'Fachwerkwand', en: 'Timber-Frame Wall' },
    {
      de: 'Ein Balkenfachwerk mit Lehm ausgefüllt. Hält 450 Trefferpunkte, dämmt am besten und brennt kaum (70 % weniger als Holz).',
      en: 'A frame of beams filled with clay. Holds 450 hit points, insulates best and hardly burns (70% less than wood).',
    },
    14,
    ITEM_SFX.holz,
  ),
  part(
    'wand_stein',
    T1,
    { de: 'Steinwand', en: 'Stone Wall' },
    {
      de: 'Behauene Steinblöcke mit Lehm verfugt. Hält 900 Trefferpunkte und brennt nicht.',
      en: 'Dressed stone blocks jointed with clay. Holds 900 hit points and does not burn.',
    },
    16,
    ITEM_SFX.stein,
  ),
  // --- Floors ------------------------------------------------------------------------------------
  part(
    'boden_holz',
    T0,
    { de: 'Holzboden', en: 'Wooden Floor' },
    { de: 'Dielen auf dem Boden eines Hauses: warm unter den Füßen, sauber zu fegen.', en: 'Planks on the floor of a house: warm underfoot, easy to sweep.' },
    5,
    ITEM_SFX.holz,
  ),
  part(
    'boden_stein',
    T1,
    { de: 'Steinboden', en: 'Stone Floor' },
    { de: 'Gelegte Steinplatten: kühl, fest und feuerfest.', en: 'Laid flagstones: cool, solid and fireproof.' },
    10,
    ITEM_SFX.stein,
  ),
  part(
    'boden_lehm',
    T0,
    { de: 'Lehmboden', en: 'Clay Floor' },
    { de: 'Gestampfter Lehm mit Kies: der schlichteste feste Boden, brennt nicht.', en: 'Rammed clay with gravel: the plainest solid floor, does not burn.' },
    4,
    ITEM_SFX.erde,
  ),
  // --- Roofs -------------------------------------------------------------------------------------
  part(
    'dach_stroh',
    T0,
    { de: 'Strohdach', en: 'Thatched Roof' },
    {
      de: 'Strohbündel auf Zweigen. Hält warm und trocken, braucht aber eine Stütze (Wand oder Säule) in höchstens 3 Feldern und brennt leicht.',
      en: 'Straw bundles on twigs. Keeps warm and dry, but needs a support (wall or pillar) within 3 tiles and burns easily.',
    },
    6,
    ITEM_SFX.pflanze,
  ),
  part(
    'dach_schindel',
    T1,
    { de: 'Schindeldach', en: 'Shingle Roof' },
    {
      de: 'Holzschindeln, mit Bronzenägeln befestigt. Spannt bis zu 5 Felder von einer Stütze.',
      en: 'Wooden shingles fastened with bronze nails. Spans up to 5 tiles from a support.',
    },
    12,
    ITEM_SFX.holz,
  ),
  part(
    'dach_glas',
    T1,
    { de: 'Glasdach', en: 'Glass Roof' },
    {
      de: 'Glasscheiben in einem Balkenrahmen. Lässt das Licht herein – ein Raum mit Beeten darunter wird zum Gewächshaus. Spannt bis zu 5 Felder.',
      en: 'Glass panes in a frame of beams. Lets the light in – a room with garden beds beneath becomes a greenhouse. Spans up to 5 tiles.',
    },
    18,
    ITEM_SFX.stein,
  ),
  // --- Doors, gates, trapdoor --------------------------------------------------------------------
  part(
    'tuer_holz',
    T0,
    { de: 'Holztür', en: 'Wooden Door' },
    { de: 'Eine Brettertür in einer Wand. Geschlossen hält sie Wind und Kälte draußen, offen lässt sie dich durch.', en: 'A plank door in a wall. Closed it keeps wind and cold out, open it lets you through.' },
    10,
    ITEM_SFX.holz,
  ),
  part(
    'tuer_verstaerkt',
    T1,
    { de: 'Verstärkte Tür', en: 'Reinforced Door' },
    { de: 'Eine Brettertür mit Bronzebändern: doppelt so zäh wie eine einfache Holztür.', en: 'A plank door with bronze bands: twice as tough as a plain wooden door.' },
    22,
    ITEM_SFX.holz,
  ),
  part(
    'tor_holz',
    T0,
    { de: 'Holztor', en: 'Wooden Gate' },
    { de: 'Ein zweiflügeliges Tor, zwei Felder breit – für Palisaden, Zäune und große Hallen.', en: 'A two-leaf gate, two tiles wide – for palisades, fences and large halls.' },
    19,
    ITEM_SFX.holz,
  ),
  part(
    'falltuer_holz',
    T0,
    { de: 'Falltür', en: 'Trapdoor' },
    { de: 'Eine Klappe im Boden. Geschlossen kann man darüber gehen, offen klafft ein Schacht.', en: 'A hatch in the floor. Closed you can walk over it, open it leaves a gaping shaft.' },
    8,
    ITEM_SFX.holz,
  ),
  // --- Windows -----------------------------------------------------------------------------------
  part(
    'fenster_offen',
    T0,
    { de: 'Fensteröffnung', en: 'Window Opening' },
    { de: 'Ein gerahmtes Loch in der Wand: Licht und Luft kommen herein, die Wärme geht hinaus.', en: 'A framed hole in the wall: light and air come in, warmth goes out.' },
    4,
    ITEM_SFX.holz,
  ),
  part(
    'fenster_glas',
    T1,
    { de: 'Glasfenster', en: 'Glass Window' },
    { de: 'Eine Glasscheibe im Holzrahmen: lässt das Licht herein und hält die Kälte halbwegs draußen.', en: 'A glass pane in a wooden frame: lets the light in and keeps the cold halfway out.' },
    12,
    ITEM_SFX.stein,
  ),
  part(
    'fenster_buntglas',
    T1,
    { de: 'Buntglasfenster', en: 'Stained-Glass Window' },
    {
      de: 'Rote, blaue und grüne Glasstücke in Kupferruten, gefasst in einen Holzrahmen. Dämmt wie ein Glasfenster; brennt drinnen Licht, leuchtet es nachts bunt hinaus.',
      en: 'Red, blue and green pieces of glass set in copper cames within a wooden frame. Insulates like a glass window; with a light burning inside, it glows in colours into the night.',
    },
    30,
    ITEM_SFX.stein,
  ),
  // --- Pillars and fences ------------------------------------------------------------------------
  part(
    'saeule_holz',
    T0,
    { de: 'Holzsäule', en: 'Wooden Pillar' },
    { de: 'Ein Stützbalken: trägt ein Dach, wo keine Wand steht.', en: 'A supporting beam: carries a roof where no wall stands.' },
    4,
    ITEM_SFX.holz,
  ),
  part(
    'saeule_stein',
    T1,
    { de: 'Steinsäule', en: 'Stone Pillar' },
    { de: 'Gemauerte Steinblöcke: eine Stütze, die nicht brennt.', en: 'Stacked stone blocks: a support that does not burn.' },
    8,
    ITEM_SFX.stein,
  ),
  part(
    'zaun_holz',
    T0,
    { de: 'Holzzaun', en: 'Wooden Fence' },
    { de: 'Ein Zaun aus Pfosten und Zweigen: hält Tiere und Wanderer auf, schließt aber keinen Raum.', en: 'A fence of posts and twigs: stops animals and walkers, but closes no room.' },
    2,
    ITEM_SFX.holz,
  ),
  part(
    'zaun_stein',
    T1,
    { de: 'Steinmauer', en: 'Stone Fence' },
    { de: 'Eine niedrige Trockenmauer: zäher als ein Holzzaun und feuerfest.', en: 'A low dry-stone wall: tougher than a wooden fence and fireproof.' },
    6,
    ITEM_SFX.stein,
  ),
  // --- Ways up and over the water ----------------------------------------------------------------
  part(
    'leiter_holz',
    T0,
    { de: 'Holzleiter', en: 'Wooden Ladder' },
    { de: 'An eine Klippe gelehnt: drück dich gegen die Wand, um hinaufzuklettern.', en: 'Leaned against a cliff: push against the wall to climb up.' },
    8,
    ITEM_SFX.holz,
  ),
  part(
    'treppe_holz',
    T0,
    { de: 'Holztreppe', en: 'Wooden Stairs' },
    { de: 'Stufen über eine Klippe von einer Höhenstufe: hinauf und hinab, ohne zu klettern.', en: 'Steps over a cliff of one height level: up and down without climbing.' },
    12,
    ITEM_SFX.holz,
  ),
  part(
    'steg_holz',
    T0,
    { de: 'Holzsteg', en: 'Wooden Jetty' },
    { de: 'Bretter auf Pfählen im Wasser: ein Weg übers Wasser und der Grund für Pfahlbauten.', en: 'Planks on piles in the water: a walkway over the water and the ground for stilt houses.' },
    7,
    ITEM_SFX.holz,
  ),
]);
