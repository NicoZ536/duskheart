/**
 * Weapons T0–T1 of every melee and ranged class (MASTERPROMPT §19.2 "Waffenklassen", §D "Waffenschaden Basis je Stufe",
 * "Klassenfaktor", "Haltbarkeit"; docs/SPIEL.md §10 "Angriffe als Daten", §14 "Waffen T0 (11) … T1 (11)"; M6-11).
 *
 * Every weapon carries its `waffe` block (src/content/schema/item.ts): the class decides the combat rules
 * (src/game/combat/weapons.ts), the numbers here decide how it feels. The stone spear (T0) is a basic of
 * src/content/items/grundlagen.ts; the thrown weapons (throwing knives, the fire flask) are ammunition by category
 * (src/content/items/munition.ts) and count as weapons too (src/content/items/index.ts).
 *
 * - **Damage** [HP per light blow or full shot] = base damage of the tier × class factor (§D; `weaponDamage`): T0 8,
 *   T1 12 × dagger 0,6 · sword 1,0 · spear 0,95 · club 1,1 · axe 1,15 · bow 1,1 · crossbow 1,6 · two-hander 1,8 ·
 *   sling 0,9. `werte.schaden` shows the same number in the tooltip.
 * - **Durability** [uses] per tier (§D: T0 60, T1 150), `BALANCE.items.durabilityByTier`.
 * - **Reach** [px], **swing** [°], **tempo** [s per blow], **stamina** [points per blow], **stagger** [s] and
 *   **impact** [class 1–5] per class (constants below with their reason); a bronze weapon reaches a little farther than
 *   its stone twin (a cast blade is longer than a knapped one) and hits harder, it does not swing faster.
 * - Battle axes carry tool data of kind `axt` (§19.2 "fällt Bäume mit 50 %"): they fell with half their mining power.
 * - Trade values [trade points, 1 = one log]: the ingredients of the recipe (src/content/recipes/waffen.ts) plus about a
 *   fifth for the work.
 */
import { BALANCE } from '../balance';
import type { WeaponClass } from '../balance/tools';
import type { ItemInput } from '../schema/item';
import { baseItem, defineItemGroup, ITEM_SFX, type ItemSpec } from './define';

/** Tiers of the stone-age and the bronze weapons (§13.2). */
const T0 = 0;
const T1 = 1;

/** Damage of a weapon of class `klasse` and tier `stufe` [HP] (§D: base damage × class factor, rounded to 0,1 HP). */
function schaden(stufe: number, klasse: WeaponClass): number {
  const base = BALANCE.tools.weaponDamageByTier[stufe] as number;
  const PRECISION = 10;
  return Math.round(base * BALANCE.tools.weaponClassFactor[klasse] * PRECISION) / PRECISION;
}

/** Durability of a weapon of tier `stufe` [uses] (§D). */
function haltbarkeit(stufe: number): number {
  return BALANCE.items.durabilityByTier[stufe] as number;
}

/**
 * Swing sounds by damage type (src/content/sfx/kampf.ts, M6-33): the blade cuts the air bright, a point whips, a club
 * swishes low. The combat events play them (src/audio/eventMap.ts `attackStarted`).
 */
export const WAFFEN_SFX = {
  hieb: 'sfx_kampf_schwung_hieb',
  stich: 'sfx_kampf_schwung_stich',
  wucht: 'sfx_kampf_schwung_wucht',
  bogen: 'sfx_kampf_bogen_spannen',
  armbrust: 'sfx_kampf_armbrust_laden',
  schleuder: 'sfx_kampf_schleuder_wirbel',
} as const;

// ---------------------------------------------------------------------------------------------
// Class profiles: reach [px], swing [°], tempo [s], stamina [points], stagger [s], impact [1–5]
// ---------------------------------------------------------------------------------------------

/**
 * Sword: a tile and a quarter of reach (20 px, a step and a blade), a 100° cut, half a second per blow (§19.2 "3er-Kombo":
 * three blows in 1,5 s), 8 stamina (12 blows from full stamina), a short stagger, impact 2. The third blow of the combo
 * cuts half again as hard.
 */
const SCHWERT = { reichweite: 20, bogen: 100, tempo: 0.5, ausdauer: 8, stagger: 0.2, wucht: 2, kombo: [1, 1, 1.5] } as const;
/** Axe: shorter than a sword (18 px), a narrower chop (90°), slower (0,65 s), heavier on stamina (10), impact 3. */
const AXT = { reichweite: 18, bogen: 90, tempo: 0.65, ausdauer: 10, stagger: 0.25, wucht: 3 } as const;
/** Club: like the axe in reach and swing, the longest stagger of the one-handers (0,6 s, §19.2 "hoher Stagger"), impact 4. */
const KEULE = { reichweite: 18, bogen: 90, tempo: 0.6, ausdauer: 11, stagger: 0.6, wucht: 4 } as const;
/** Spear: the longest one-handed reach (28 px ≈ 1,75 tiles, §19.2 "Reichweite"), a narrow 40° thrust (as the stone spear). */
const SPEER = { reichweite: 28, bogen: 40, tempo: 0.55, ausdauer: 9, stagger: 0.2, wucht: 2 } as const;
/** Dagger: the shortest reach (14 px), fast (0,35 s, §19.2 "schnell"), cheap (5 stamina), barely staggers, impact 1. */
const DOLCH = { reichweite: 14, bogen: 60, tempo: 0.35, ausdauer: 5, stagger: 0.1, wucht: 1 } as const;
/** Two-hander: broad (140°) and long (24 px), slow (1 s per blow, §19.2 "breit, langsam"), 18 stamina, impact 5. */
const ZWEIHAND = { reichweite: 24, bogen: 140, tempo: 1, ausdauer: 18, stagger: 0.5, wucht: 5 } as const;
/** Ranged weapons: the swing is unused for a shot (schema: the width they cover); 10° keeps the value meaningful. */
const FERN_BOGEN = 10;

/** A bronze blade reaches this much farther than its stone twin [px]: a cast blade is longer than a knapped one. */
const BRONZE_REICHWEITE = 2;

/** A weapon record (category `waffe`, durability and tooltip damage of its tier). */
function waffe(spec: Omit<ItemSpec, 'kategorie' | 'haltbarkeit' | 'werte' | 'waffe'> & { readonly waffe: NonNullable<ItemInput['waffe']>; readonly stufe: number }): ItemInput {
  return baseItem({ ...spec, kategorie: 'waffe', haltbarkeit: haltbarkeit(spec.stufe), werte: { schaden: spec.waffe.schaden } });
}

/** Weapons T0–T1 (docs/SPIEL.md §14; the stone spear is in grundlagen.ts, thrown weapons in munition.ts). */
export const WAFFEN = defineItemGroup('waffen', [
  // ---- T0: stone, flint, bone, wood (§13.2) ----
  waffe({
    id: 'feuersteinklinge',
    name: { de: 'Feuersteinklinge', en: 'Flint Blade' },
    beschreibung: {
      de: 'Eine lange, beidseitig geschlagene Feuersteinklinge in einem umwickelten Holzgriff. Das erste Schwert: drei schnelle Schnitte in Folge, schwer geführt ein Rundumhieb.',
      en: 'A long flint blade knapped on both faces, set in a wrapped wooden grip. The first sword: three quick cuts in a row, a sweep all around when swung heavy.',
    },
    stufe: T0,
    waffe: { klasse: 'schwert', schadensart: 'hieb', schaden: schaden(T0, 'schwert'), ...SCHWERT, kombo: [...SCHWERT.kombo], schwer: 'rundumhieb' },
    tauschwert: 17,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: WAFFEN_SFX.hieb },
  }),
  waffe({
    id: 'steinkampfaxt',
    name: { de: 'Steinkampfaxt', en: 'Stone Battle Axe' },
    beschreibung: {
      de: 'Ein schwerer, geschliffener Steinkeil an einem kurzen Schaft. Schwer geführt bricht sie die Rüstung des Gegners auf; Bäume fällt sie nur halb so gut wie eine Axt.',
      en: 'A heavy ground stone wedge on a short haft. Swung heavy it breaks the foe’s armour; it fells trees only half as well as an axe.',
    },
    stufe: T0,
    werkzeug: { art: 'axt', abbaukraft: BALANCE.tools.miningPowerByTier[T0] as number },
    waffe: { klasse: 'axt', schadensart: 'hieb', schaden: schaden(T0, 'axt'), ...AXT, schwer: 'ruestungsbruch' },
    tauschwert: 11,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: WAFFEN_SFX.hieb },
  }),
  waffe({
    id: 'holzkeule',
    name: { de: 'Holzkeule', en: 'Wooden Club' },
    beschreibung: {
      de: 'Ein knorriger Ast mit dickem Kopf. Schnell gemacht, schlägt dumpf und lässt den Getroffenen taumeln.',
      en: 'A gnarled branch with a thick head. Quickly made, it strikes blunt and leaves the target staggering.',
    },
    stufe: T0,
    waffe: { klasse: 'keule', schadensart: 'wucht', schaden: schaden(T0, 'keule'), ...KEULE },
    tauschwert: 4,
    sounds: { aufheben: ITEM_SFX.holz, benutzen: WAFFEN_SFX.wucht },
  }),
  waffe({
    id: 'knochenkeule',
    name: { de: 'Knochenkeule', en: 'Bone Club' },
    beschreibung: {
      de: 'Ein schwerer Röhrenknochen, mit Knochensplittern gespickt und an einen Holzgriff gebunden. Trifft wie die Holzkeule, betäubt aber manchmal.',
      en: 'A heavy long bone studded with bone splinters and bound to a wooden grip. Hits like the wooden club, but sometimes stuns.',
    },
    stufe: T0,
    // §19.3 "Zustände über Waffen (… Betäubung)": one blow in six rings the head for a second and a half.
    waffe: { klasse: 'keule', schadensart: 'wucht', schaden: schaden(T0, 'keule'), ...KEULE, zustand: { id: 'betaeubt', chance: 0.15, sekunden: 1.5 } },
    tauschwert: 13,
    sounds: { aufheben: ITEM_SFX.holz, benutzen: WAFFEN_SFX.wucht },
  }),
  waffe({
    id: 'knochendolch',
    name: { de: 'Knochendolch', en: 'Bone Dagger' },
    beschreibung: {
      de: 'Ein spitz geschliffener Knochensplitter mit Schnurgriff. Schnell und leise: von hinten beim Schleichen trifft er dreifach, und die Wunde blutet oft nach.',
      en: 'A bone splinter ground to a point, with a cord grip. Fast and quiet: from behind while sneaking it hits threefold, and the wound often bleeds.',
    },
    stufe: T0,
    // §19.3 "Blutung": a quarter of the stabs open a wound that bleeds for 4 s.
    waffe: { klasse: 'dolch', schadensart: 'stich', schaden: schaden(T0, 'dolch'), ...DOLCH, zustand: { id: 'blutung', chance: 0.25, sekunden: 4 } },
    tauschwert: 10,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: WAFFEN_SFX.stich },
  }),
  waffe({
    id: 'felsbrecher',
    name: { de: 'Felsbrecher', en: 'Rockbreaker' },
    beschreibung: {
      de: 'Ein behauener Steinblock auf einem langen Balkenstiel, nur mit beiden Händen zu führen. Langsam und breit – wen er trifft, der fliegt. Die Fackel hängt dabei am Gürtel.',
      en: 'A dressed stone block on a long beam haft, wielded with both hands only. Slow and broad – whoever it hits goes flying. The torch hangs on the belt meanwhile.',
    },
    stufe: T0,
    waffe: { klasse: 'zweihand', schadensart: 'wucht', schaden: schaden(T0, 'zweihand'), ...ZWEIHAND, stagger: 0.6 },
    tauschwert: 25,
    sounds: { aufheben: ITEM_SFX.stein, benutzen: WAFFEN_SFX.wucht },
  }),
  waffe({
    id: 'kurzbogen',
    name: { de: 'Kurzbogen', en: 'Short Bow' },
    beschreibung: {
      de: 'Ein Bogen aus einem Eschenstab mit gedrehter Fasersehne. Halten spannt (voll nach 0,8 s), Loslassen schießt; braucht Pfeile in den Taschen.',
      en: 'A bow of an ash stave with a twisted fibre string. Holding draws (full after 0.8 s), letting go shoots; needs arrows in the bags.',
    },
    stufe: T0,
    // 12 tiles of range; 480 px/s crosses them in 0,4 s – fast enough to lead a running wolf by a body length.
    waffe: { klasse: 'bogen', schadensart: 'stich', schaden: schaden(T0, 'bogen'), reichweite: 192, bogen: FERN_BOGEN, tempo: 0.9, ausdauer: 6, stagger: 0.1, wucht: 1, geschoss: { geschwindigkeit: 480 } },
    tauschwert: 12,
    sounds: { aufheben: ITEM_SFX.holz, benutzen: WAFFEN_SFX.bogen },
  }),
  waffe({
    id: 'schleuder',
    name: { de: 'Schleuder', en: 'Sling' },
    beschreibung: {
      de: 'Zwei Faserschnüre mit einer geflochtenen Tasche. Halten lässt sie kreisen, Loslassen wirft einen Schleuderstein – schwächer als ein Bogen, aber Steine gibt es überall.',
      en: 'Two fibre cords with a braided pouch. Holding whirls it, letting go hurls a sling stone – weaker than a bow, but stones are everywhere.',
    },
    stufe: T0,
    // 10 tiles of range at 360 px/s: a stone arcs slower than an arrow.
    waffe: { klasse: 'schleuder', schadensart: 'wucht', schaden: schaden(T0, 'schleuder'), reichweite: 160, bogen: FERN_BOGEN, tempo: 0.7, ausdauer: 5, stagger: 0.15, wucht: 2, geschoss: { geschwindigkeit: 360 } },
    tauschwert: 10,
    sounds: { aufheben: ITEM_SFX.pflanze, benutzen: WAFFEN_SFX.schleuder },
  }),
  // ---- T1: bronze (§13.2) ----
  waffe({
    id: 'bronzeschwert',
    name: { de: 'Bronzeschwert', en: 'Bronze Sword' },
    beschreibung: {
      de: 'Eine gegossene, am Amboss gehärtete Bronzeklinge mit Parierstange. Drei Schnitte in Folge, schwer geführt ein Rundumhieb.',
      en: 'A cast bronze blade hardened on the anvil, with a crossguard. Three cuts in a row, a sweep all around when swung heavy.',
    },
    stufe: T1,
    waffe: { klasse: 'schwert', schadensart: 'hieb', schaden: schaden(T1, 'schwert'), ...SCHWERT, reichweite: SCHWERT.reichweite + BRONZE_REICHWEITE, kombo: [...SCHWERT.kombo], schwer: 'rundumhieb' },
    tauschwert: 48,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: WAFFEN_SFX.hieb },
  }),
  waffe({
    id: 'bronzekampfaxt',
    name: { de: 'Bronzekampfaxt', en: 'Bronze Battle Axe' },
    beschreibung: {
      de: 'Ein bartförmiges Bronzeblatt an einem Eschenschaft. Schwer geführt bricht sie Rüstung auf; Bäume fällt sie halb so gut wie eine Axt.',
      en: 'A bearded bronze blade on an ash haft. Swung heavy it breaks armour; it fells trees half as well as an axe.',
    },
    stufe: T1,
    werkzeug: { art: 'axt', abbaukraft: BALANCE.tools.miningPowerByTier[T1] as number },
    waffe: { klasse: 'axt', schadensart: 'hieb', schaden: schaden(T1, 'axt'), ...AXT, reichweite: AXT.reichweite + BRONZE_REICHWEITE, schwer: 'ruestungsbruch' },
    tauschwert: 46,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: WAFFEN_SFX.hieb },
  }),
  waffe({
    id: 'bronzestreitkolben',
    name: { de: 'Bronzestreitkolben', en: 'Bronze Mace' },
    beschreibung: {
      de: 'Ein gerippter Bronzekopf auf einem Holzschaft. Schlägt dumpf, lässt lange taumeln und betäubt nicht selten.',
      en: 'A flanged bronze head on a wooden haft. Strikes blunt, staggers long and not seldom stuns.',
    },
    stufe: T1,
    // §19.3 "Betäubung": the flanges ring a head more often than bone (one blow in five, 1,5 s).
    waffe: { klasse: 'keule', schadensart: 'wucht', schaden: schaden(T1, 'keule'), ...KEULE, stagger: 0.7, zustand: { id: 'betaeubt', chance: 0.2, sekunden: 1.5 } },
    tauschwert: 44,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: WAFFEN_SFX.wucht },
  }),
  waffe({
    id: 'bronzespeer',
    name: { de: 'Bronzespeer', en: 'Bronze Spear' },
    beschreibung: {
      de: 'Eine gegossene Bronzespitze mit Tülle auf einem langen Schaft. Hält Gegner auf Abstand; schwer geführt wird er geworfen und bleibt liegen, wo er landet.',
      en: 'A cast bronze point with a socket on a long shaft. Keeps foes at a distance; swung heavy it is thrown and stays where it lands.',
    },
    stufe: T1,
    waffe: { klasse: 'speer', schadensart: 'stich', schaden: schaden(T1, 'speer'), ...SPEER, reichweite: SPEER.reichweite + BRONZE_REICHWEITE, schwer: 'wurf' },
    tauschwert: 32,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: WAFFEN_SFX.stich },
  }),
  waffe({
    id: 'bronzedolch',
    name: { de: 'Bronzedolch', en: 'Bronze Dagger' },
    beschreibung: {
      de: 'Ein schmaler Bronzedolch mit garnumwickeltem Griff. Schnell, von hinten beim Schleichen dreifach, und die Wunde blutet oft nach.',
      en: 'A slender bronze dagger with a yarn-wrapped grip. Fast, threefold from behind while sneaking, and the wound often bleeds.',
    },
    stufe: T1,
    waffe: { klasse: 'dolch', schadensart: 'stich', schaden: schaden(T1, 'dolch'), ...DOLCH, zustand: { id: 'blutung', chance: 0.3, sekunden: 5 } },
    tauschwert: 18,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: WAFFEN_SFX.stich },
  }),
  waffe({
    id: 'bronzezweihaender',
    name: { de: 'Bronzezweihänder', en: 'Bronze Greatsword' },
    beschreibung: {
      de: 'Eine mannshohe Bronzeklinge für beide Hände. Breit und langsam; schwer geführt mäht sie rundum. Die Fackel hängt dabei am Gürtel.',
      en: 'A man-high bronze blade for both hands. Broad and slow; swung heavy it mows all around. The torch hangs on the belt meanwhile.',
    },
    stufe: T1,
    waffe: { klasse: 'zweihand', schadensart: 'hieb', schaden: schaden(T1, 'zweihand'), ...ZWEIHAND, reichweite: ZWEIHAND.reichweite + BRONZE_REICHWEITE, bogen: 150, wucht: 4, schwer: 'rundumhieb' },
    tauschwert: 80,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: WAFFEN_SFX.hieb },
  }),
  waffe({
    id: 'bronzegrossaxt',
    name: { de: 'Bronzegroßaxt', en: 'Bronze Great Axe' },
    beschreibung: {
      de: 'Ein breites, doppelt geschwungenes Bronzeblatt an einem Langschaft. Schwer geführt bricht sie Rüstung auf. Die Fackel hängt dabei am Gürtel.',
      en: 'A broad, double-curved bronze blade on a long haft. Swung heavy it breaks armour. The torch hangs on the belt meanwhile.',
    },
    stufe: T1,
    // A tenth slower than the greatsword: the weight sits at the head.
    waffe: { klasse: 'zweihand', schadensart: 'hieb', schaden: schaden(T1, 'zweihand'), ...ZWEIHAND, tempo: 1.1, ausdauer: 20, stagger: 0.6, schwer: 'ruestungsbruch' },
    tauschwert: 76,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: WAFFEN_SFX.hieb },
  }),
  waffe({
    id: 'bronzekriegshammer',
    name: { de: 'Bronzekriegshammer', en: 'Bronze War Hammer' },
    beschreibung: {
      de: 'Ein schwerer Bronzeblock mit Dorn an einem Langschaft. Der langsamste Schlag – er wirft zurück, lässt lange taumeln und betäubt oft. Die Fackel hängt dabei am Gürtel.',
      en: 'A heavy bronze block with a spike on a long haft. The slowest blow – it throws back, staggers long and often stuns. The torch hangs on the belt meanwhile.',
    },
    stufe: T1,
    // A fifth slower than the greatsword, 0,9 s of stagger and a stun in one blow of three (2 s).
    waffe: { klasse: 'zweihand', schadensart: 'wucht', schaden: schaden(T1, 'zweihand'), ...ZWEIHAND, bogen: 120, tempo: 1.2, ausdauer: 22, stagger: 0.9, zustand: { id: 'betaeubt', chance: 0.3, sekunden: 2 } },
    tauschwert: 76,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: WAFFEN_SFX.wucht },
  }),
  waffe({
    id: 'kompositbogen',
    name: { de: 'Kompositbogen', en: 'Composite Bow' },
    beschreibung: {
      de: 'Holz, Knochen und Sehnen, mit Harz verleimt: stärker und weiter als der Kurzbogen, schneller wieder gespannt.',
      en: 'Wood, bone and sinew glued with resin: stronger and farther-reaching than the short bow, drawn again sooner.',
    },
    stufe: T1,
    // 14 tiles at 560 px/s, recovers in 0,8 s instead of 0,9 s.
    waffe: { klasse: 'bogen', schadensart: 'stich', schaden: schaden(T1, 'bogen'), reichweite: 224, bogen: FERN_BOGEN, tempo: 0.8, ausdauer: 6, stagger: 0.1, wucht: 1, geschoss: { geschwindigkeit: 560 } },
    tauschwert: 19,
    sounds: { aufheben: ITEM_SFX.holz, benutzen: WAFFEN_SFX.bogen },
  }),
  waffe({
    id: 'armbrust',
    name: { de: 'Armbrust', en: 'Crossbow' },
    beschreibung: {
      de: 'Ein Bogen aus Bronze quer auf einem Holzschaft, mit Abzug. Ein Druck schießt den geladenen Bolzen, der nächste lädt nach (1,5 s). Schießt hart und ruhig.',
      en: 'A bronze bow set across a wooden stock, with a trigger. One press shoots the loaded bolt, the next reloads (1.5 s). Shoots hard and steady.',
    },
    stufe: T1,
    // 16 tiles at 640 px/s: the flattest, fastest shot; impact 3 knocks a wolf back.
    waffe: { klasse: 'armbrust', schadensart: 'stich', schaden: schaden(T1, 'armbrust'), reichweite: 256, bogen: FERN_BOGEN, tempo: 0.8, ausdauer: 4, stagger: 0.25, wucht: 3, geschoss: { geschwindigkeit: 640 } },
    tauschwert: 25,
    sounds: { aufheben: ITEM_SFX.holz, benutzen: WAFFEN_SFX.armbrust },
  }),
]);
