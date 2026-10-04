/**
 * The creatures of the Salt Coast (MASTERPROMPT §20.1 "Salzküste: Krabbe, Möwe, Robbe · Scherenkrebs, Qualle,
 * Strandräuber (Gezeichnete)"; docs/SPIEL.md §11, §14; M6-23, M6-24): one creature group (define.ts `CreatureGroup`) with
 * its creatures, the AI profiles, loot tables and the spawn table of the coast (salzkuesteDaten.ts); src/content/creatures/
 * index.ts registers it with one line. Sprites `kreatur_<id>` (assets-src/sprites/kreaturen/; clips and wind-ups binding in
 * docs/ART.md §15.3), sounds src/content/sfx/kreaturen_salzkueste.ts; the validator rule `kreatur` checks each whole.
 *
 * **Balance on Normal** (§D; tests/unit/game/kreaturen-salzkueste.test.ts computes every number from the formulas):
 * - The foes are tier 0 and fall to 4–6 hits of each tier-0 one-hander (flint blade 8 cut, stone battle axe 9,2 cut, clubs
 *   8,8 blunt, stone spear 7,6 pierce) through their armour (R / (R + 50)) and resistances: the lobster 30 HP under a shell
 *   of armour 4 that turns a fifth of a cut (the club cracks it: blunt −0,2); the jellyfish 36 HP, a body of water that
 *   swallows a quarter of a blunt blow; the beach raider 36 HP in a leather scrap (armour 2).
 * - Their blows against the tier-0 armour (fibre set, R 6: × 50/56) take 8–12 % of the player's 100 HP when normal (the
 *   sting with its poison together) and 20–30 % when heavy and telegraphed: the lobster's claw slam (0,6 s wind-up). No blow
 *   kills from full health, not even a critical one.
 * - The peaceful ones fall to one or two blows (crab 10 HP in its shell, gull 12); the seal takes five (36 HP of blubber)
 *   and bites back when cornered.
 *
 * **Behaviour** (salzkuesteDaten.ts): crabs scuttle off and pinch when cornered, box traps catch them; gulls fly (they
 *   cross water and the surf), flee and peck back once when struck; seals are amphibians – they lie on the beach and flee
 *   into the sea, biting when cornered; the lobster holds its rock at night and warns before it slams; the jellyfish drifts
 *   in the shallows and stings what wades into it (poison); the beach raiders – Gezeichnete, people the dark has taken –
 *   prowl the coast at dusk and night in pairs, flank their prey, break doors, and swing their flint blades like the
 *   player's own (reach, arc and damage type of the `feuersteinklinge`, which they sometimes drop).
 */
import { WAFFEN } from '../items/waffen';
import { defineCreatureRecords, type CreatureGroup } from './define';
import { SALZKUESTE_BEUTE, SALZKUESTE_PROFILE, SALZKUESTE_SPAWN } from './salzkuesteDaten';
import { creatureSchema } from './schema';

/** The raider's blade: the flint blade of the armoury – the combat system's sword, swung by a Gezeichneter. */
const KLINGE = (() => {
  const w = WAFFEN.find((i) => i.id === 'feuersteinklinge')?.waffe;
  if (w === undefined) throw new Error('salzkueste: the beach raider carries the feuersteinklinge, which is missing');
  return w;
})();

/** The Salt Coast creatures, validated and frozen. */
export const SALZKUESTE_KREATUREN = defineCreatureRecords('creatures', creatureSchema, [
  // -------------------------------------------------------------------------------------------
  // Salzküste I: peaceful (M6-23)
  // -------------------------------------------------------------------------------------------
  {
    id: 'krabbe',
    name: { de: 'Krabbe', en: 'Crab' },
    beschreibung: { de: 'Seitwärts huschender Strandbewohner mit kräftigen Scheren.', en: 'A sideways-scuttling beach dweller with strong claws.' },
    familie: 'friedlich',
    team: 'tier',
    biome: ['salzkueste'],
    groesse: 16,
    stufe: 0,
    leben: 10,
    tempo: { gehen: 1.2, rennen: 4.5 },
    radius: 4,
    ruestung: 0,
    // Its shell turns a little of a cut and a thrust; a blunt blow cracks it.
    resistenzen: { hieb: 0.2, stich: 0.1, wucht: -0.2 },
    material: 'panzer',
    angriffe: [
      {
        name: 'kneifen',
        art: 'nahkampf',
        schadensart: 'stich',
        schaden: 6,
        reichweite: 10,
        bogen: 90,
        ausholzeit: 0.4,
        abklingzeit: 1.6,
        gewicht: 1,
        wucht: 1,
        stagger: 0.1,
        sound: 'sfx_kreatur_krabbe_kneifen',
      },
    ],
    ki: 'krabbe',
    beute: 'krabbe',
    sounds: { laut: 'sfx_kreatur_krabbe_laut', treffer: 'sfx_kreatur_krabbe_treffer', tod: 'sfx_kreatur_krabbe_tod' },
    aktiv: ['tag', 'daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: null,
    fangbar: true,
    bestiarium: {
      text: {
        de: 'Lebt zwischen Tang und Treibholz und huscht seitwärts davon, sobald ein Schatten auf sie fällt. In die Enge getrieben, hebt sie beide Scheren und kneift zu.',
        en: 'Lives among kelp and driftwood and scuttles sideways the moment a shadow falls on it. Cornered, it raises both claws and pinches.',
      },
      hinweis: {
        de: 'Eine Kastenfalle am Strand fängt sie mühelos. Ein stumpfer Schlag knackt den Panzer besser als eine Klinge. Zerlegt gibt sie Krebsfleisch.',
        en: 'A box trap on the beach catches it with ease. A blunt blow cracks the shell better than a blade. Carved, it gives crab meat.',
      },
    },
  },
  {
    id: 'moewe',
    name: { de: 'Möwe', en: 'Gull' },
    beschreibung: { de: 'Kreischender Segler über Brandung und Dünen.', en: 'A screeching glider over surf and dunes.' },
    familie: 'friedlich',
    team: 'tier',
    biome: ['salzkueste'],
    groesse: 32,
    stufe: 0,
    leben: 12,
    tempo: { gehen: 2, rennen: 6 },
    radius: 5,
    ruestung: 0,
    resistenzen: {},
    material: 'fleisch',
    angriffe: [
      {
        name: 'picken',
        art: 'nahkampf',
        schadensart: 'stich',
        schaden: 5,
        reichweite: 12,
        bogen: 80,
        ausholzeit: 0.4,
        abklingzeit: 2,
        gewicht: 1,
        wucht: 1,
        stagger: 0.1,
        sound: 'sfx_kreatur_moewe_picken',
      },
    ],
    ki: 'moewe',
    beute: 'moewe',
    sounds: { laut: 'sfx_kreatur_moewe_laut', treffer: 'sfx_kreatur_moewe_treffer', tod: 'sfx_kreatur_moewe_tod' },
    aktiv: ['tag', 'daemmerung'],
    fortbewegung: 'flieger',
    augen: null,
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Sie segelt über der Brandung und ruft, als lache sie über die Welt. Wo das Meer Tote anspült, sind die Möwen zuerst da.',
        en: 'It glides above the surf and cries as if it laughed at the world. Where the sea washes up the dead, the gulls come first.',
      },
      hinweis: {
        de: 'Sie fliegt über Wasser und Klippen davon – ein Pfeil holt sie ein. Getroffen und bedrängt hackt sie einmal zurück. Zerlegt gibt sie Geflügel und viele Federn.',
        en: 'It flies off over water and cliffs – an arrow catches it. Struck and pressed, it pecks back once. Carved, it gives fowl and many feathers.',
      },
    },
  },
  {
    id: 'robbe',
    name: { de: 'Robbe', en: 'Seal' },
    beschreibung: { de: 'Schwerer Schwimmer, der sich an den Strand schiebt.', en: 'A heavy swimmer that heaves itself onto the beach.' },
    familie: 'friedlich',
    team: 'tier',
    biome: ['salzkueste'],
    groesse: 32,
    stufe: 0,
    leben: 36,
    tempo: { gehen: 0.9, rennen: 2.6 },
    radius: 7,
    ruestung: 0,
    // Blubber soaks up a blunt blow.
    resistenzen: { wucht: 0.2 },
    material: 'fleisch',
    angriffe: [
      {
        name: 'biss',
        art: 'nahkampf',
        schadensart: 'stich',
        schaden: 10,
        reichweite: 13,
        bogen: 90,
        ausholzeit: 0.4,
        abklingzeit: 2.2,
        gewicht: 1,
        wucht: 2,
        stagger: 0.2,
        sound: 'sfx_kreatur_robbe_biss',
      },
    ],
    ki: 'robbe',
    beute: 'robbe',
    sounds: { laut: 'sfx_kreatur_robbe_laut', treffer: 'sfx_kreatur_robbe_treffer', tod: 'sfx_kreatur_robbe_tod' },
    aktiv: ['tag', 'daemmerung', 'nacht'],
    fortbewegung: 'amphibie',
    augen: null,
    fangbar: false,
    bestiarium: {
      text: {
        de: 'An Land ein schwerfälliger Sack voll Speck, im Wasser pfeilschnell. Sie döst auf dem warmen Sand und flieht bei Gefahr ins Meer; wer ihr den Weg abschneidet, bekommt ihre Zähne zu spüren.',
        en: 'On land a clumsy sack of blubber, in the water quick as an arrow. It dozes on the warm sand and flees into the sea at danger; whoever cuts off its way feels its teeth.',
      },
      hinweis: {
        de: 'Stell dich zwischen sie und das Wasser, aber nicht zu nah. Ihr Speck dämpft Keulenschläge. Zerlegt gibt sie viel Fett, Fell, Knochen und Sehnen.',
        en: 'Step between it and the water, but not too close. Its blubber softens club blows. Carved, it gives much fat, hide, bones and sinew.',
      },
    },
  },
  // -------------------------------------------------------------------------------------------
  // Salzküste II: foes (M6-24)
  // -------------------------------------------------------------------------------------------
  {
    id: 'scherenkrebs',
    name: { de: 'Scherenkrebs', en: 'Clawed Lobster' },
    beschreibung: { de: 'Gepanzerter Nachträuber der Felsen am Wasser.', en: 'An armoured night hunter of the rocks by the water.' },
    familie: 'gegner',
    team: 'tier',
    biome: ['salzkueste'],
    groesse: 32,
    stufe: 0,
    leben: 30,
    tempo: { gehen: 1.2, rennen: 3.2 },
    radius: 7,
    ruestung: 4,
    // The shell turns a fifth of a cut and a tenth of a thrust; a club cracks it; boiled, it goes red.
    resistenzen: { hieb: 0.2, stich: 0.1, wucht: -0.2, feuer: -0.25 },
    material: 'panzer',
    angriffe: [
      {
        name: 'kneifen',
        art: 'nahkampf',
        schadensart: 'stich',
        schaden: 11,
        reichweite: 14,
        bogen: 90,
        ausholzeit: 0.4,
        abklingzeit: 1.6,
        gewicht: 2,
        wucht: 2,
        stagger: 0.2,
        sound: 'sfx_kreatur_scherenkrebs_kneifen',
      },
      {
        // The heavy blow: the great claw rises for 0,6 s, then slams down.
        name: 'scherenschlag',
        art: 'nahkampf',
        schadensart: 'wucht',
        schaden: 28,
        reichweite: 18,
        bogen: 110,
        ausholzeit: 0.6,
        abklingzeit: 5,
        gewicht: 1,
        wucht: 4,
        stagger: 0.5,
        sound: 'sfx_kreatur_scherenkrebs_scherenschlag',
      },
    ],
    ki: 'scherenkrebs',
    beute: 'scherenkrebs',
    sounds: { laut: 'sfx_kreatur_scherenkrebs_laut', treffer: 'sfx_kreatur_scherenkrebs_treffer', tod: 'sfx_kreatur_scherenkrebs_tod' },
    aktiv: ['daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'eis',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Tagsüber schläft er in Felsspalten, nachts verteidigt er sein Stück Ufer. Seine Augen glimmen kalt über dem Wasser, lange bevor man die Scheren sieht.',
        en: 'By day it sleeps in rock clefts; at night it defends its stretch of shore. Its eyes glint cold above the water long before one sees the claws.',
      },
      hinweis: {
        de: 'Hebt er die große Schere, tritt zurück oder rolle – der Schlag ist schwer. Eine Keule knackt den Panzer, Klingen gleiten ab. Zerlegt gibt er reichlich Krebsfleisch.',
        en: 'When it raises the great claw, step back or roll – the slam is heavy. A club cracks the shell, blades glance off. Carved, it gives plenty of crab meat.',
      },
    },
  },
  {
    id: 'qualle',
    name: { de: 'Feuerqualle', en: 'Fire Jellyfish' },
    beschreibung: { de: 'Glimmender Schirm im flachen Wasser mit nesselnden Fäden.', en: 'A glimmering bell in the shallows with stinging threads.' },
    familie: 'gegner',
    team: 'tier',
    biome: ['salzkueste'],
    groesse: 32,
    stufe: 0,
    leben: 36,
    tempo: { gehen: 0.5, rennen: 1.2 },
    radius: 6,
    ruestung: 0,
    // A body of water: a blunt blow sinks into it; poison is its own; heat curdles it.
    resistenzen: { wucht: 0.25, gift: 1, feuer: -0.5 },
    material: 'fleisch',
    angriffe: [
      {
        name: 'nesseln',
        art: 'nahkampf',
        schadensart: 'gift',
        schaden: 7,
        reichweite: 12,
        bogen: 360,
        ausholzeit: 0.5,
        abklingzeit: 1.8,
        gewicht: 1,
        wucht: 1,
        stagger: 0.1,
        zustand: { id: 'vergiftung', chance: 0.6, sekunden: 4 },
        sound: 'sfx_kreatur_qualle_nesseln',
      },
    ],
    ki: 'qualle',
    // Slain, its body runs out into the sand; the stinging threads of its bell stay (salzkuesteDaten.ts).
    beute: 'qualle',
    sounds: { laut: 'sfx_kreatur_qualle_laut', treffer: 'sfx_kreatur_qualle_treffer', tod: 'sfx_kreatur_qualle_tod' },
    aktiv: ['tag', 'daemmerung', 'nacht'],
    fortbewegung: 'schwimmer',
    // It floats high in the shallows: bell and stinging threads stay above the waterline, only the threads' tips (the lowest
    // 4 of the 26 px of its cell above its feet) hang in the water – the threads are the danger one has to see (§4.6).
    wasserlinie: 0.15,
    // Its glowing rim and threads are what the dark shows of it.
    augen: 'eis',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Sie treibt im flachen Wasser, wo man am liebsten watet. Ihr Schirm glimmt nachts kalt blau; wer sie streift, spürt ihre Fäden noch lange.',
        en: 'It drifts in the shallows, just where one likes to wade. Its bell glows cold blue at night; whoever brushes it feels its threads for a long time.',
      },
      hinweis: {
        de: 'Meide ihren Schimmer im Wasser. Wenn sich ihr Schirm zusammenzieht, nesselt sie rundum – Gift folgt. Feuer lässt sie gerinnen, stumpfe Schläge versinken in ihr.',
        en: 'Avoid its glimmer in the water. When its bell draws together, it stings all around – poison follows. Fire curdles it, blunt blows sink into it.',
      },
    },
  },
  {
    id: 'strandraeuber',
    name: { de: 'Strandräuber', en: 'Beach Raider' },
    beschreibung: { de: 'Ein Gezeichneter, den die Dunkelheit an die Küste trieb.', en: 'One of the Marked, driven to the coast by the dark.' },
    familie: 'gegner',
    team: 'feind',
    biome: ['salzkueste'],
    groesse: 32,
    stufe: 0,
    leben: 36,
    tempo: { gehen: 1.6, rennen: 4.2 },
    radius: 5,
    ruestung: 2,
    resistenzen: { schatten: 0.25, licht: -0.25 },
    material: 'fleisch',
    angriffe: [
      {
        // The flint blade's cut: its reach, swing, damage type, stagger and impact (the combat system's sword).
        name: 'hieb',
        art: 'nahkampf',
        schadensart: KLINGE.schadensart,
        schaden: 12,
        reichweite: KLINGE.reichweite,
        bogen: KLINGE.bogen,
        ausholzeit: 0.5,
        abklingzeit: 1.4,
        gewicht: 1,
        wucht: KLINGE.wucht,
        stagger: KLINGE.stagger,
        sound: 'sfx_kreatur_strandraeuber_hieb',
      },
    ],
    ki: 'strandraeuber',
    beute: 'strandraeuber',
    sounds: { laut: 'sfx_kreatur_strandraeuber_laut', treffer: 'sfx_kreatur_strandraeuber_treffer', tod: 'sfx_kreatur_strandraeuber_tod' },
    aktiv: ['daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'verderb',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Einst Fischer und Strandgänger, dann hat die Nacht sie gezeichnet: graue Haut, violett glimmende Augen, kein Wort mehr. Sie ziehen zu zweit durch die Dämmerung und nehmen, was das Licht nicht schützt.',
        en: 'Once fishers and beachcombers, then the night marked them: grey skin, eyes glimmering violet, not a word left. They roam the dusk in pairs and take what the light does not guard.',
      },
      hinweis: {
        de: 'Sie fechten wie du mit Feuersteinklingen – pariere den Hieb, wenn der Arm zurückfährt. Sie flankieren zu zweit und brechen Türen auf. Manchmal lassen sie ihre Klinge fallen.',
        en: 'They fight like you with flint blades – parry the cut when the arm draws back. They flank in pairs and break doors. Sometimes they drop their blade.',
      },
    },
  },
]);

/** The Salt Coast group (M6-23, M6-24): its creatures, their profiles and loot, and the coast's spawn table. */
export const SALZKUESTE_GRUPPE: CreatureGroup = {
  id: 'salzkueste',
  kreaturen: SALZKUESTE_KREATUREN,
  profile: SALZKUESTE_PROFILE,
  beute: SALZKUESTE_BEUTE,
  spawnTabellen: SALZKUESTE_SPAWN,
  spawnZusaetze: [],
};
