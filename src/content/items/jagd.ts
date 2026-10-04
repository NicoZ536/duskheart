/**
 * Hunting goods, the Lumen shard and the traps (MASTERPROMPT §14 "Jagen & Zerlegen: Fleisch, Fell/Leder, Knochen,
 * Federn, Fett, Sehnen, Spezialteile; Fallen (Schlinge, Kastenfalle)", §12.4 "Beute: Lumen-Scherben", §16.5; docs/SPIEL.md
 * §11 "Beute, Jagen, Fallen", §14 "Jagdgüter"; M6-28, M6-30).
 *
 * - **Carving** (`zerlegen` of the loot tables, src/content/creatures/beute.ts): a carcass cut up with a knife yields
 *   raw game meat or fowl, hide, bones, feathers, fat, sinews and the special parts of its kind (the roe buck's antlers).
 *   Their sources are the loot tables (`drop:<kreatur>`), derived like world drops; their uses are the armoury's recipes
 *   (bone weapons, arrows, the composite bow, leather from the tanning frame), the traps and the fire.
 * - **Raw meat** is raw food (§18 "roh (geringer Wert)"): it fills a little, frightens a little (§12.3 "rohe Nahrung +5")
 *   and spoils within two days (`BALANCE.creatures.hunting.meatShelfDays`); the kitchen of M7 cooks it.
 * - **Fat** burns (tallow): a fuel that lasts like resin-rich wood (§15.4 "Harzholz 60").
 * - **The Lumen shard** is what defeated shadow brood leaves (§12.4, `lootTables`); a hearth burns one for six game hours
 *   (§16.5, `BALANCE.hearth.fuelGameHours`) – the base's safest fuel.
 * - **Traps** are set up in the world (`trap.place`, src/game/creatures/traps.ts) and catch small game (`traps`
 *   collection, src/content/creatures/fallen.ts): the snare is quick to make, the box trap holds more reliably. Set up,
 *   they are an end in themselves like a camp fire (`endprodukt`).
 * - Trade values [trade points, 1 = one piece of wood]: by the effort of the hunt; traps by their ingredients plus about a
 *   fifth for the work.
 */
import { BALANCE } from '../balance';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';


const H = BALANCE.creatures.hunting;

/** Hunting goods, the Lumen shard and the traps. */
export const JAGD = defineItemGroup('jagd', [
  baseItem({
    id: 'wildfleisch_roh',
    name: { de: 'Rohes Wildfleisch', en: 'Raw Venison' },
    beschreibung: {
      de: 'Dunkles Fleisch von Hase und Reh, frisch zerlegt. Roh macht es nur ein wenig satt und schlägt auf die Stimmung; gebraten nährt es gut. Verdirbt schnell.',
      en: 'Dark meat of hare and deer, freshly carved. Raw it fills only a little and weighs on the mind; roasted it nourishes well. Spoils quickly.',
    },
    kategorie: 'nahrung',
    frische: H.meatShelfDays,
    essbar: { saettigung: 6, durst: 0 },
    tauschwert: 4,
    sounds: { aufheben: ITEM_SFX.fleisch },
  }),
  baseItem({
    id: 'gefluegel_roh',
    name: { de: 'Rohes Geflügel', en: 'Raw Fowl' },
    beschreibung: {
      de: 'Helles Fleisch von Wachtel und anderem Federwild. Roh wenig nahrhaft und unangenehm; am Feuer gegart ein gutes Mahl. Verdirbt schnell.',
      en: 'Pale meat of quail and other fowl. Raw it gives little and sits badly; cooked over a fire it makes a good meal. Spoils quickly.',
    },
    kategorie: 'nahrung',
    frische: H.meatShelfDays,
    essbar: { saettigung: 5, durst: 0 },
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.fleisch },
  }),
  baseItem({
    id: 'fell',
    name: { de: 'Fell', en: 'Hide' },
    beschreibung: {
      de: 'Das abgezogene Fell eines Tiers. Auf dem Gerbrahmen wird es zu Leder.',
      en: 'The skinned hide of an animal. On the tanning frame it becomes leather.',
    },
    kategorie: 'rohstoff',
    tauschwert: 5,
    sounds: { aufheben: ITEM_SFX.fell },
  }),
  baseItem({
    id: 'knochen',
    name: { de: 'Knochen', en: 'Bone' },
    beschreibung: {
      de: 'Ein sauberer Röhrenknochen. Hart genug für Keule und Dolch, biegsam genug für den Kompositbogen.',
      en: 'A clean long bone. Hard enough for club and dagger, springy enough for the composite bow.',
    },
    kategorie: 'rohstoff',
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.knochen },
  }),
  baseItem({
    id: 'federn',
    name: { de: 'Federn', en: 'Feathers' },
    beschreibung: {
      de: 'Schwungfedern von Federwild. Am Pfeilschaft halten sie den Flug gerade.',
      en: 'Flight feathers of fowl. On an arrow shaft they keep its flight straight.',
    },
    kategorie: 'rohstoff',
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.federn },
  }),
  baseItem({
    id: 'fett',
    name: { de: 'Fett', en: 'Fat' },
    beschreibung: {
      de: 'Ausgeschnittenes Tierfett. Es brennt hell und lange wie harziges Holz.',
      en: 'Fat cut from game. It burns bright and long like resinous wood.',
    },
    kategorie: 'rohstoff',
    brennwert: H.fatBurnSeconds,
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.fleisch },
  }),
  baseItem({
    id: 'sehnen',
    name: { de: 'Sehnen', en: 'Sinew' },
    beschreibung: {
      de: 'Getrocknete Sehnen aus Rücken und Läufen. Zäher als jede Faser – für Bogensehnen und die Auslöser von Fallen.',
      en: 'Dried sinew from back and legs. Tougher than any fibre – for bowstrings and the triggers of traps.',
    },
    kategorie: 'rohstoff',
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.fell },
  }),
  baseItem({
    id: 'hirschgeweih',
    name: { de: 'Geweih', en: 'Antlers' },
    beschreibung: {
      de: 'Das kleine Geweih eines Rehbocks. Ein Jagdstück, das an die Wand gehört.',
      en: 'The small antlers of a roe buck. A hunting trophy that belongs on a wall.',
    },
    kategorie: 'rohstoff',
    raritaet: 'ungewoehnlich',
    tauschwert: 12,
    sounds: { aufheben: ITEM_SFX.knochen },
  }),
  baseItem({
    id: 'lumen_scherbe',
    name: { de: 'Lumen-Scherbe', en: 'Lumen Shard' },
    beschreibung: {
      de: 'Ein Splitter kalten Lichts, den besiegte Schattenbrut zurücklässt. Im Herdfeuer brennt eine Scherbe sechs Stunden lang.',
      en: 'A splinter of cold light that defeated shadow brood leaves behind. In a hearth fire one shard burns for six hours.',
    },
    kategorie: 'rohstoff',
    raritaet: 'selten',
    tauschwert: 15,
    sounds: { aufheben: ITEM_SFX.lumen },
  }),
  baseItem({
    id: 'schlinge',
    name: { de: 'Schlinge', en: 'Snare' },
    beschreibung: {
      de: 'Eine Laufschlinge aus Faserseil an einem Pflock. Aus der Hand mit der Primärtaste aufgestellt, fängt sie kleines Wild, das hindurchläuft – nicht jedes Mal. E nimmt sie wieder auf, der Fang bleibt zum Zerlegen liegen.',
      en: 'A running noose of fibre rope on a peg. Set up from the hand with the primary button, it catches small game running through it – not every time. E takes it back; the catch stays behind for carving.',
    },
    kategorie: 'platzierbar',
    endprodukt: true,
    tauschwert: 8,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'kastenfalle',
    name: { de: 'Kastenfalle', en: 'Box Trap' },
    beschreibung: {
      de: 'Ein Holzkasten mit Falltür und Sehnenauslöser. Aus der Hand mit der Primärtaste aufgestellt, schnappt er zuverlässig zu, sobald kleines Wild hineinläuft. E nimmt ihn wieder auf, der Fang bleibt zum Zerlegen liegen.',
      en: 'A wooden box with a drop door and a sinew trigger. Set up from the hand with the primary button, it snaps shut reliably as soon as small game walks in. E takes it back; the catch stays behind for carving.',
    },
    kategorie: 'platzierbar',
    endprodukt: true,
    tauschwert: 16,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
]);
