/**
 * Ammunition and thrown weapons T0–T1 (MASTERPROMPT §19.2 "Munition: Pfeile (Feuerstein, Bronze, … Feuer, Gift, Stumpf,
 * Leucht …), Bolzen, Schleudersteine", "Wurfwaffen (Wurfmesser, … Brandflasche …)"; §12.2 "Leuchtpfeil | 3 | 60 s";
 * docs/SPIEL.md §10, §14; M6-07, M6-08, M6-11).
 *
 * - **Arrows, bolts, sling stones** carry a `munition` block: the weapon class that shoots them and what they add to its
 *   shot – damage [HP, before tension, resistance and armour], the damage type (the head decides, not the bow),
 *   optionally an impact class, a condition and a light. The combat system takes the first fitting piece from the hotbar,
 *   then the bags (src/game/combat/weapons.ts `findAmmo`); spent arrows and bolts can be picked up again with a chance.
 * - **Thrown weapons** carry a `waffe` block of class `wurf` (src/content/schema/item.ts): the throwing knife hits one body
 *   and lands as an item (`einzel`), the fire flask bursts and sets the ground alight (`brand`, radius [px]). Sprengtopf,
 *   frost and blinding bombs follow with their materials (M8-30). Thrown weapons count as weapons (§C, items/index.ts).
 * - Stack 200 (§13.1 "Munition 200"): no durability.
 * - Trade values [trade points, 1 = one log] per piece: the recipe's ingredients divided by the pieces it makes plus about
 *   a fifth for the work, at least 1.
 */
import { BALANCE } from '../balance';
import type { ItemInput } from '../schema/item';
import { baseItem, defineItemGroup, ITEM_SFX, type ItemSpec } from './define';

/** Tiers (§13.2). */
const T0 = 0;
const T1 = 1;

/** Sounds of the ammunition: arrows rattle like twigs, bolts and knives like metal gear, stones like stone. */
const PFEIL_SFX = { aufheben: ITEM_SFX.holz } as const;

/** An ammunition record (category `munition`). */
function munition(spec: Omit<ItemSpec, 'kategorie'> & { readonly munition: NonNullable<ItemInput['munition']> }): ItemInput {
  return baseItem({ ...spec, kategorie: 'munition' });
}

/** A thrown weapon (category `munition` with a `waffe` block of class `wurf`). */
function wurfwaffe(spec: Omit<ItemSpec, 'kategorie'> & { readonly waffe: NonNullable<ItemInput['waffe']> }): ItemInput {
  return baseItem({ ...spec, kategorie: 'munition' });
}

/** Damage of a thrown weapon of tier `stufe` [HP] (§D: base damage × the thrown class factor 1,0). */
function wurfSchaden(stufe: number): number {
  return (BALANCE.tools.weaponDamageByTier[stufe] as number) * BALANCE.tools.weaponClassFactor.wurf;
}

/**
 * Throwing knives: 8 tiles of range (128 px), 0,5 s per throw, 4 stamina, one body at impact class 1; 420 px/s – slower
 * than an arrow, faster than a stone. The bronze knife flies a tile farther and faster.
 */
const WURFMESSER = { reichweite: 128, bogen: 10, tempo: 0.5, ausdauer: 4, stagger: 0.1, wucht: 1 } as const;

/** Ammunition and thrown weapons T0–T1 (docs/SPIEL.md §14). */
export const MUNITION = defineItemGroup('munition', [
  // ---- Arrows (bow) ----
  munition({
    id: 'pfeil_feuerstein',
    name: { de: 'Feuersteinpfeil', en: 'Flint Arrow' },
    beschreibung: {
      de: 'Ein Zweigschaft mit geschlagener Feuersteinspitze und Federn. Der gewöhnliche Pfeil für den Bogen; oft findet man ihn nach dem Schuss wieder.',
      en: 'A twig shaft with a knapped flint head and feathers. The common arrow for the bow; often found again after the shot.',
    },
    stufe: T0,
    munition: { fuer: 'bogen', schaden: 2, schadensart: 'stich' },
    tauschwert: 1,
    sounds: PFEIL_SFX,
  }),
  munition({
    id: 'pfeil_bronze',
    name: { de: 'Bronzepfeil', en: 'Bronze Arrow' },
    beschreibung: {
      de: 'Ein Pfeil mit gegossener Bronzespitze: dringt tiefer ein als Feuerstein.',
      en: 'An arrow with a cast bronze head: pierces deeper than flint.',
    },
    stufe: T1,
    munition: { fuer: 'bogen', schaden: 4, schadensart: 'stich' },
    tauschwert: 2,
    sounds: PFEIL_SFX,
  }),
  munition({
    id: 'pfeil_stumpf',
    name: { de: 'Stumpfer Pfeil', en: 'Blunt Arrow' },
    beschreibung: {
      de: 'Ein Pfeil mit Holzknauf statt Spitze. Verletzt kaum, schlägt aber hart und betäubt manchmal – für Wild, dessen Fell heil bleiben soll.',
      en: 'An arrow with a wooden knob instead of a head. Barely wounds, but strikes hard and sometimes stuns – for game whose pelt should stay whole.',
    },
    stufe: T0,
    // Impact 2 instead of the bow's 1; a stun in one hit of four (1,5 s, §19.3 "Betäubung").
    munition: { fuer: 'bogen', schaden: 0, schadensart: 'wucht', wucht: 2, zustand: { id: 'betaeubt', chance: 0.25, sekunden: 1.5 } },
    tauschwert: 1,
    sounds: PFEIL_SFX,
  }),
  munition({
    id: 'pfeil_feuer',
    name: { de: 'Brandpfeil', en: 'Fire Arrow' },
    beschreibung: {
      de: 'Ein Feuersteinpfeil, dessen Kopf in Harz und Fasern gewickelt ist. Setzt das Ziel in Brand.',
      en: 'A flint arrow whose head is wrapped in resin and fibres. Sets the target on fire.',
    },
    stufe: T0,
    // §19.3 "Brennen": every hit sets the target burning for 4 s.
    munition: { fuer: 'bogen', schaden: 1, schadensart: 'feuer', zustand: { id: 'brennen', chance: 1, sekunden: 4 } },
    tauschwert: 3,
    sounds: PFEIL_SFX,
  }),
  munition({
    id: 'pfeil_gift',
    name: { de: 'Giftpfeil', en: 'Poison Arrow' },
    beschreibung: {
      de: 'Ein Feuersteinpfeil, dessen Spitze in zerstoßenem Fliegenpilz getränkt ist. Vergiftet, was er trifft.',
      en: 'A flint arrow whose head is steeped in crushed fly agaric. Poisons whatever it hits.',
    },
    stufe: T0,
    // §19.3 "Gift": every hit poisons for 8 s (the fly agaric's poison, §11.3 "Vergiftung").
    munition: { fuer: 'bogen', schaden: 1, schadensart: 'gift', zustand: { id: 'vergiftung', chance: 1, sekunden: 8 } },
    tauschwert: 2,
    sounds: PFEIL_SFX,
  }),
  munition({
    id: 'pfeil_leucht',
    name: { de: 'Leuchtpfeil', en: 'Glow Arrow' },
    beschreibung: {
      de: 'Ein Feuersteinpfeil mit einer Kappe aus Leuchtpilz. Wo er steckt – im Boden oder im Gegner –, leuchtet er eine Minute lang drei Kacheln weit.',
      en: 'A flint arrow capped with glow mushroom. Where it sticks – in the ground or in a foe – it lights three tiles for a minute.',
    },
    stufe: T0,
    // §12.2 "Leuchtpfeil | 3 | 60 s | steckt im Boden oder im Gegner".
    munition: { fuer: 'bogen', schaden: 0, schadensart: 'stich', licht: { radius: 3, sekunden: 60 } },
    tauschwert: 3,
    sounds: PFEIL_SFX,
  }),
  // ---- Bolts (crossbow) and sling stones ----
  munition({
    id: 'bolzen_bronze',
    name: { de: 'Bronzebolzen', en: 'Bronze Bolt' },
    beschreibung: {
      de: 'Ein kurzer, schwerer Bolzen mit Bronzespitze und Holzflügeln für die Armbrust. Stößt Getroffene zurück.',
      en: 'A short, heavy bolt with a bronze head and wooden vanes for the crossbow. Knocks the target back.',
    },
    stufe: T1,
    munition: { fuer: 'armbrust', schaden: 4, schadensart: 'stich', wucht: 3 },
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.werkzeug },
  }),
  munition({
    id: 'schleuderstein',
    name: { de: 'Schleuderstein', en: 'Sling Stone' },
    beschreibung: {
      de: 'Ein rundgeschliffener Kiesel, handlich für die Schleuder.',
      en: 'A pebble ground round, handy for the sling.',
    },
    stufe: T0,
    munition: { fuer: 'schleuder', schaden: 1, schadensart: 'wucht' },
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  // ---- Thrown weapons ----
  wurfwaffe({
    id: 'wurfmesser_feuerstein',
    name: { de: 'Feuerstein-Wurfmesser', en: 'Flint Throwing Knife' },
    beschreibung: {
      de: 'Eine ausgewogene, schmale Feuersteinklinge zum Werfen. Halten zielt, Loslassen wirft; das Messer bleibt liegen, wo es trifft.',
      en: 'A balanced, slender flint blade for throwing. Holding aims, letting go throws; the knife stays where it hits.',
    },
    stufe: T0,
    waffe: { klasse: 'wurf', schadensart: 'stich', schaden: wurfSchaden(T0), ...WURFMESSER, geschoss: { geschwindigkeit: 420 }, wurf: { wirkung: 'einzel', radius: 0 } },
    tauschwert: 6,
    sounds: { aufheben: ITEM_SFX.stein, benutzen: 'sfx_kampf_wurf' },
  }),
  wurfwaffe({
    id: 'wurfmesser_bronze',
    name: { de: 'Bronze-Wurfmesser', en: 'Bronze Throwing Knife' },
    beschreibung: {
      de: 'Ein gegossenes Bronzemesser mit Ringgriff, zum Werfen ausgewogen. Fliegt weiter und trifft härter als Feuerstein.',
      en: 'A cast bronze knife with a ring grip, balanced for throwing. Flies farther and hits harder than flint.',
    },
    stufe: T1,
    waffe: { klasse: 'wurf', schadensart: 'stich', schaden: wurfSchaden(T1), ...WURFMESSER, reichweite: 144, geschoss: { geschwindigkeit: 460 }, wurf: { wirkung: 'einzel', radius: 0 } },
    tauschwert: 5,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: 'sfx_kampf_wurf' },
  }),
  wurfwaffe({
    id: 'brandflasche',
    name: { de: 'Brandflasche', en: 'Fire Flask' },
    beschreibung: {
      de: 'Ein Tontopf voll Harz mit brennendem Faserdocht. Im Bogen geworfen zerschellt er, setzt den Boden in Brand und alle in der Nähe in Flammen.',
      en: 'A clay pot full of resin with a burning fibre wick. Thrown in an arc it shatters, sets the ground alight and everyone close by on fire.',
    },
    stufe: T0,
    // A burst of 20 px (1,25 tiles) that burns for 6 s; 240 px/s over its arc; 6 damage of flame at the landing.
    waffe: {
      klasse: 'wurf',
      schadensart: 'feuer',
      schaden: 6,
      reichweite: 128,
      bogen: 10,
      tempo: 0.8,
      ausdauer: 6,
      stagger: 0,
      wucht: 1,
      zustand: { id: 'brennen', chance: 1, sekunden: 6 },
      geschoss: { geschwindigkeit: 240 },
      wurf: { wirkung: 'brand', radius: 20 },
    },
    tauschwert: 19,
    sounds: { aufheben: ITEM_SFX.erde, benutzen: 'sfx_kampf_wurf' },
  }),
]);
