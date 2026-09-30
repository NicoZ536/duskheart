/**
 * The Grünhain creatures of M6-20 … M6-22 (MASTERPROMPT §20.1 "Grünhain: … Eichhörnchen, Glühwürmchen, Frosch · Keiler,
 * Dachs · Wolf (Rudel), Dornling (getarnt), Wespenschwarm"; docs/SPIEL.md §11, §14): one creature group (define.ts
 * `CreatureGroup`) with its creatures, AI profiles (gruenhainKi.ts), loot tables and the entries it adds to the Grünhain spawn
 * table of the core (gruenhainBeute.ts); src/content/creatures/index.ts registers it with one line. Sprites
 * `kreatur_<id>` (assets-src/sprites/kreaturen/, clips and wind-ups binding in docs/ART.md §15.3), sounds
 * src/content/sfx/kreaturen_gruenhain.ts; the validator rule `kreatur` checks the whole of each.
 *
 * **Balance on Normal** (§D; tests/unit/game/kreaturen-gruenhain.test.ts computes every number from the formulas):
 * - The foes are tier 0 and fall to 4–6 hits of each tier-0 one-hander (flint blade 8 cut, stone battle axe 9,2 cut,
 *   clubs 8,8 blunt, stone spear 7,6 pierce; the dagger is the fast class with its own count) through their armour
 *   (R / (R + 50)) and resistances: boar 40 HP, armour 4, weak to the spear (pierce −0,2 – the boar spear); badger 34 HP,
 *   armour 2, its pelt turns a little of a cut; wolf 32 HP; Dornling 36 HP, bark armour 4, thorns turn a little of a thrust,
 *   fire eats it (−0,5); wasp swarm 24 HP – a blade cuts through the swarm (cut and pierce 0,4, blunt 0,3), fire is its bane
 *   (−1).
 * - Their blows against the tier-0 armour (fibre set, R 6: × 50/56) take 8–12 % of the player's 100 HP when normal (the
 *   sting with its poison together) and 20–30 % when heavy and telegraphed: the boar's charge (0,6 s wind-up, 0,2 s run-up),
 *   the wolf's pounce (0,4 s crouch, 0,1 s push-off) and the Dornling's ambush from the bush (0,5 s: the bush shakes, eyes
 *   open). No blow kills from full health, not even a critical one.
 * - The peaceful ones fall to one or two blows (squirrel 8, frog 5, firefly 2 HP).
 *
 * **Behaviour** (profiles in gruenhainKi.ts): squirrel, frog and firefly flee; boar, badger and wasps defend their home
 * (`revier`); wolves hunt as a pack at dusk and night and circle their prey, one going in at a time (M6-18); the Dornling
 * waits camouflaged as a berry bush until its prey is within reach of its ambush (profile `tarnung`, attack `ueberfall`
 * `ausTarnung`), the wasps flee from torches and fire (`scheutFeuer`) and poison with their sting.
 */
import { defineCreatureRecords, type CreatureGroup } from './define';
import { GRUENHAIN_BEUTE, GRUENHAIN_SPAWN } from './gruenhainBeute';
import { GRUENHAIN_PROFILE } from './gruenhainKi';
import { creatureSchema } from './schema';

/** The Grünhain creatures, validated and frozen. */
export const GRUENHAIN_KREATUREN = defineCreatureRecords('creatures', creatureSchema, [
  // -------------------------------------------------------------------------------------------
  // Peaceful (M6-20)
  // -------------------------------------------------------------------------------------------
  {
    id: 'eichhoernchen',
    name: { de: 'Eichhörnchen', en: 'Squirrel' },
    beschreibung: { de: 'Flinker Nager der Laubwälder Grünhains.', en: 'A nimble rodent of the Greengrove woods.' },
    familie: 'friedlich',
    team: 'tier',
    biome: ['gruenhain'],
    groesse: 16,
    stufe: 0,
    leben: 8,
    tempo: { gehen: 1.8, rennen: 7.5 },
    radius: 3,
    ruestung: 0,
    resistenzen: {},
    material: 'fell',
    angriffe: [],
    ki: 'eichhoernchen',
    beute: 'eichhoernchen',
    sounds: { laut: 'sfx_kreatur_eichhoernchen_laut', treffer: 'sfx_kreatur_eichhoernchen_treffer', tod: 'sfx_kreatur_eichhoernchen_tod' },
    aktiv: ['tag'],
    fortbewegung: 'land',
    augen: null,
    fangbar: true,
    bestiarium: {
      text: {
        de: 'Huscht durchs Laub und schimpft mit hellem Keckern von den Wurzeln herab. Es sammelt Nüsse für einen Winter, der seit den grauen Tagen länger dauert als früher.',
        en: 'Scurries through the leaves and scolds with a bright chatter from the roots. It gathers nuts for a winter that has lasted longer since the grey days began.',
      },
      hinweis: {
        de: 'Zu flink für jede Waffe – eine Kastenfalle unter den Nussbäumen fängt es. Zerlegt gibt es ein wenig Fleisch und ein kleines Fell.',
        en: 'Too quick for any weapon – a box trap under the nut trees catches it. Carved, it gives a little meat and a small hide.',
      },
    },
  },
  {
    id: 'gluehwuermchen',
    name: { de: 'Glühwürmchen', en: 'Fireflies' },
    beschreibung: { de: 'Leuchtende Käfer der Frühlings- und Sommernächte.', en: 'Glowing beetles of spring and summer nights.' },
    familie: 'friedlich',
    team: 'tier',
    biome: ['gruenhain'],
    groesse: 16,
    stufe: 0,
    leben: 2,
    tempo: { gehen: 0.6, rennen: 2 },
    radius: 3,
    ruestung: 0,
    resistenzen: {},
    material: 'panzer',
    angriffe: [],
    ki: 'gluehwuermchen',
    beute: null,
    ohneBeute: 'Its light goes out with it: a firefly leaves nothing (docs/SPIEL.md §11 "außer Glühwürmchen").',
    sounds: { laut: 'sfx_kreatur_gluehwuermchen_laut', treffer: 'sfx_kreatur_gluehwuermchen_treffer', tod: 'sfx_kreatur_gluehwuermchen_tod' },
    aktiv: ['nacht'],
    // They drift over the grass, bushes and water.
    fortbewegung: 'flieger',
    augen: null,
    fangbar: false,
    bestiarium: {
      text: {
        de: 'In Frühlings- und Sommernächten tanzen sie über den Wiesen – kleine Lichter, die nichts erhellen und doch trösten. Man erzählt, sie seien Funken, die das Urfeuer verstreute, als die Leuchtfeuer erloschen.',
        en: 'On spring and summer nights they dance over the meadows – little lights that brighten nothing and yet give comfort. It is told they are sparks the First Fire scattered when the beacons went out.',
      },
      hinweis: {
        de: 'Sie tun niemandem etwas und lassen nichts zurück: Ihr Licht geht mit ihnen aus. Wer sie sehen will, geht in einer klaren Nacht ohne Fackel über die Wiese.',
        en: 'They harm no one and leave nothing behind: their light goes out with them. Whoever wants to see them walks across the meadow on a clear night without a torch.',
      },
    },
  },
  {
    id: 'frosch',
    name: { de: 'Frosch', en: 'Frog' },
    beschreibung: { de: 'Scheuer Springer an Tümpeln und Bächen.', en: 'A shy jumper by ponds and streams.' },
    familie: 'friedlich',
    team: 'tier',
    biome: ['gruenhain'],
    groesse: 16,
    stufe: 0,
    leben: 5,
    tempo: { gehen: 0.8, rennen: 4 },
    radius: 3,
    ruestung: 0,
    resistenzen: {},
    material: 'fleisch',
    angriffe: [],
    ki: 'frosch',
    beute: 'frosch',
    sounds: { laut: 'sfx_kreatur_frosch_laut', treffer: 'sfx_kreatur_frosch_treffer', tod: 'sfx_kreatur_frosch_tod' },
    aktiv: ['daemmerung', 'nacht'],
    // It hops on land and swims.
    fortbewegung: 'amphibie',
    augen: null,
    fangbar: true,
    bestiarium: {
      text: {
        de: 'Quakt in der Dämmerung am Wasser und springt beim leisesten Schritt davon. Den Winter verschläft er tief im Schlamm.',
        en: 'Croaks by the water at dusk and leaps away at the softest step. It sleeps through the winter deep in the mud.',
      },
      hinweis: {
        de: 'Schleichend kommst du nah genug für einen Schlag. Zerlegt gibt er einen Bissen Fleisch – Froschschenkel über dem Feuer.',
        en: 'Sneaking, you get close enough for a blow. Carved, it gives a mouthful of meat – frog legs over the fire.',
      },
    },
  },
  // -------------------------------------------------------------------------------------------
  // Foes I (M6-21)
  // -------------------------------------------------------------------------------------------
  {
    id: 'keiler',
    name: { de: 'Keiler', en: 'Boar' },
    beschreibung: { de: 'Wehrhafter Keiler, der seine Suhle verteidigt.', en: 'A fierce boar that defends its wallow.' },
    familie: 'gegner',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 0,
    leben: 40,
    tempo: { gehen: 1.4, rennen: 5.5 },
    radius: 8,
    // Thick bristly hide; a spear goes deep (the boar spear).
    ruestung: 4,
    resistenzen: { stich: -0.2 },
    material: 'fell',
    angriffe: [
      {
        // Lowers its head, paws the ground (0,6 s), storms 0,2 s at the locked aim: heavy and telegraphed (§D 20–30 %).
        name: 'ansturm',
        art: 'sprung',
        schadensart: 'wucht',
        schaden: 28,
        reichweite: 40,
        bogen: 60,
        ausholzeit: 0.6,
        anlauf: 0.2,
        abklingzeit: 6,
        gewicht: 1.5,
        wucht: 5,
        stagger: 0.6,
        sound: 'sfx_kreatur_keiler_ansturm',
      },
      {
        // A quick slash of the tusks up close.
        name: 'hauer',
        art: 'nahkampf',
        schadensart: 'hieb',
        schaden: 12,
        reichweite: 16,
        bogen: 100,
        ausholzeit: 0.3,
        abklingzeit: 2,
        gewicht: 1,
        wucht: 3,
        stagger: 0.3,
        sound: 'sfx_kreatur_keiler_hauer',
      },
    ],
    ki: 'keiler',
    beute: 'keiler',
    sounds: { laut: 'sfx_kreatur_keiler_laut', treffer: 'sfx_kreatur_keiler_treffer', tod: 'sfx_kreatur_keiler_tod' },
    aktiv: ['daemmerung', 'nacht', 'tag'],
    fortbewegung: 'land',
    augen: 'feuer',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Wühlt mit gesenktem Kopf im Waldboden und verteidigt seine Suhle gegen jeden, der ihr zu nahe kommt. Bevor er angreift, senkt er den Kopf und scharrt – dann stürmt er los und hört nicht auf, bis er fällt.',
        en: 'Roots in the forest floor with its head down and defends its wallow against anyone who comes too close. Before it attacks it lowers its head and paws the ground – then it charges and does not stop until it falls.',
      },
      hinweis: {
        de: 'Wenn er scharrt, roll zur Seite: Der Ansturm geht nur geradeaus. Ein Speer dringt tief durch seine Schwarte. Zerlegt gibt er viel Fleisch, Fett, Fell und Knochen.',
        en: 'When it paws the ground, roll aside: the charge only goes straight. A spear goes deep through its hide. Carved, it gives much meat, fat, hide and bones.',
      },
    },
  },
  {
    id: 'dachs',
    name: { de: 'Dachs', en: 'Badger' },
    beschreibung: { de: 'Nächtlicher Wühler, der seinen Bau verbissen verteidigt.', en: 'A nocturnal digger that defends its sett tooth and claw.' },
    familie: 'gegner',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 0,
    leben: 34,
    tempo: { gehen: 1.2, rennen: 4 },
    radius: 6,
    // A dense pelt over tough skin.
    ruestung: 2,
    resistenzen: { hieb: 0.1 },
    material: 'fell',
    angriffe: [
      {
        name: 'biss',
        art: 'nahkampf',
        schadensart: 'stich',
        schaden: 11,
        reichweite: 13,
        bogen: 80,
        ausholzeit: 0.4,
        abklingzeit: 1.6,
        gewicht: 1.2,
        wucht: 2,
        stagger: 0.2,
        sound: 'sfx_kreatur_dachs_biss',
      },
      {
        // Rears up and rakes with its digging claws.
        name: 'kratzer',
        art: 'nahkampf',
        schadensart: 'hieb',
        schaden: 10,
        reichweite: 14,
        bogen: 120,
        ausholzeit: 0.4,
        abklingzeit: 2.2,
        gewicht: 1,
        wucht: 2,
        stagger: 0.25,
        sound: 'sfx_kreatur_dachs_kratzer',
      },
    ],
    ki: 'dachs',
    beute: 'dachs',
    sounds: { laut: 'sfx_kreatur_dachs_laut', treffer: 'sfx_kreatur_dachs_treffer', tod: 'sfx_kreatur_dachs_tod' },
    aktiv: ['daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'feuer',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Verlässt seinen Bau erst in der Dämmerung. Wer ihm dort zu nahe kommt, hört ihn fauchen – dann beißt und kratzt er mit einer Wut, die man dem kleinen Körper nicht zutraut.',
        en: 'Leaves its sett only at dusk. Whoever comes too close hears it hiss – then it bites and claws with a fury no one would expect of so small a body.',
      },
      hinweis: {
        de: 'Mach einen Bogen um seinen Bau oder rechne mit Biss und Krallen im schnellen Wechsel. Schwer verwundet zieht er sich zurück. Sein Fett brennt lange, sein Fell ist dicht.',
        en: 'Give its sett a wide berth or expect bite and claws in quick turns. Badly wounded, it retreats. Its fat burns long, its pelt is dense.',
      },
    },
  },
  {
    id: 'wolf',
    name: { de: 'Wolf', en: 'Wolf' },
    beschreibung: { de: 'Grauer Jäger, der im Rudel die Nacht durchstreift.', en: 'A grey hunter roaming the night with its pack.' },
    familie: 'gegner',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 0,
    leben: 32,
    // A sprint (7 tiles/s) just outruns it – for as long as the stamina lasts.
    tempo: { gehen: 1.8, rennen: 6.5 },
    radius: 6,
    ruestung: 0,
    resistenzen: {},
    material: 'fell',
    angriffe: [
      {
        name: 'biss',
        art: 'nahkampf',
        schadensart: 'stich',
        schaden: 11,
        reichweite: 14,
        bogen: 80,
        ausholzeit: 0.4,
        abklingzeit: 1.8,
        gewicht: 1.5,
        wucht: 2,
        stagger: 0.2,
        sound: 'sfx_kreatur_wolf_biss',
      },
      {
        // Crouches (0,4 s), pushes off (0,1 s) and leaps at the locked aim: heavy and telegraphed.
        name: 'sprung',
        art: 'sprung',
        schadensart: 'stich',
        schaden: 24,
        reichweite: 36,
        bogen: 70,
        ausholzeit: 0.4,
        anlauf: 0.1,
        abklingzeit: 5,
        gewicht: 1,
        wucht: 4,
        stagger: 0.4,
        sound: 'sfx_kreatur_wolf_sprung',
      },
    ],
    ki: 'wolf',
    beute: 'wolf',
    sounds: { laut: 'sfx_kreatur_wolf_laut', treffer: 'sfx_kreatur_wolf_treffer', tod: 'sfx_kreatur_wolf_tod' },
    aktiv: ['daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'feuer',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Jagt in der Dämmerung und nachts im Rudel. Die Wölfe kreisen ihre Beute ein; immer nur einer greift an, während die anderen dir in den Rücken wollen. Ihr Heulen trägt weit über die Wiesen.',
        en: 'Hunts in packs at dusk and by night. The wolves circle their prey; only one attacks at a time while the others try to get behind you. Their howl carries far across the meadows.',
      },
      hinweis: {
        de: 'Halte eine Wand oder ein Feuer im Rücken und behalte den Kreis im Blick. Duckt sich einer, springt er gleich – ausweichen oder blocken. Ein schwer verwundeter Wolf gibt auf.',
        en: 'Keep a wall or a fire at your back and watch the circle. When one crouches, it is about to leap – dodge or block. A badly wounded wolf gives up.',
      },
    },
  },
  // -------------------------------------------------------------------------------------------
  // Foes II (M6-22)
  // -------------------------------------------------------------------------------------------
  {
    id: 'dornling',
    name: { de: 'Dornling', en: 'Thornling' },
    beschreibung: { de: 'Dornenbusch mit Augen, der auf Beute lauert.', en: 'A thornbush with eyes that lies in wait for prey.' },
    familie: 'gegner',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 0,
    leben: 36,
    tempo: { gehen: 0.8, rennen: 2.5 },
    radius: 8,
    // Bark; thorns and leaves turn a little of a thrust; fire eats its wood.
    ruestung: 4,
    resistenzen: { stich: 0.1, feuer: -0.5 },
    material: 'holz',
    angriffe: [
      {
        // A thorn vine whips out of the leaves.
        name: 'peitsche',
        art: 'nahkampf',
        schadensart: 'hieb',
        schaden: 11,
        reichweite: 22,
        bogen: 100,
        ausholzeit: 0.5,
        abklingzeit: 2,
        gewicht: 1,
        wucht: 2,
        stagger: 0.3,
        sound: 'sfx_kreatur_dornling_peitsche',
      },
      {
        // From the bush: the leaves shake, the eyes open (0,5 s), then it bursts at its prey – heavy and telegraphed.
        name: 'ueberfall',
        art: 'nahkampf',
        schadensart: 'stich',
        schaden: 26,
        reichweite: 20,
        bogen: 140,
        ausholzeit: 0.5,
        abklingzeit: 8,
        gewicht: 1,
        wucht: 4,
        stagger: 0.5,
        ausTarnung: true,
        sound: 'sfx_kreatur_dornling_ueberfall',
      },
    ],
    ki: 'dornling',
    beute: 'dornling',
    sounds: { laut: 'sfx_kreatur_dornling_laut', treffer: 'sfx_kreatur_dornling_treffer', tod: 'sfx_kreatur_dornling_tod' },
    aktiv: ['tag', 'daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'feuer',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Sieht aus wie ein Beerenstrauch, bis du ihm zu nahe kommst. Dann bebt das Laub, eine dunkle Höhle mit glühenden Augen öffnet sich, und Dornenranken schnellen nach dir. Die Alten sagen, die Nacht habe ihn gesät.',
        en: 'Looks like a berry bush until you come too close. Then the leaves shake, a dark hollow with glowing eyes opens and thorn vines lash out at you. The old ones say the night sowed it.',
      },
      hinweis: {
        de: 'Ein Strauch, wo eben keiner stand, ist verdächtig – ein Pfeil oder Wurf weckt ihn aus sicherer Entfernung, bevor er dich überfällt. Bebt das Laub, geh zurück. Feuer frisst sein Holz.',
        en: 'A bush where none stood before is suspicious – an arrow or a throw wakes it from a safe distance before it ambushes you. When the leaves shake, step back. Fire eats its wood.',
      },
    },
  },
  {
    id: 'wespenschwarm',
    name: { de: 'Wespenschwarm', en: 'Wasp Swarm' },
    beschreibung: { de: 'Wütender Schwarm, der sein Nest mit Giftstacheln verteidigt.', en: 'An angry swarm that defends its nest with venomous stings.' },
    familie: 'gegner',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 0,
    leben: 24,
    tempo: { gehen: 1.5, rennen: 5 },
    radius: 7,
    ruestung: 0,
    // A swarm: blades cut through it, a blow scatters only some; fire is its bane, poison it shrugs off.
    resistenzen: { hieb: 0.4, stich: 0.4, wucht: 0.3, feuer: -1, gift: 0.8 },
    material: 'panzer',
    angriffe: [
      {
        // The swarm draws together (0,5 s), then stings – with poison half the time (1 HP/s for 4 s).
        name: 'stechen',
        art: 'nahkampf',
        schadensart: 'stich',
        schaden: 8,
        reichweite: 12,
        bogen: 140,
        ausholzeit: 0.5,
        abklingzeit: 1.6,
        gewicht: 1,
        wucht: 1,
        stagger: 0.1,
        zustand: { id: 'vergiftung', chance: 0.5, sekunden: 4 },
        sound: 'sfx_kreatur_wespenschwarm_stechen',
      },
    ],
    ki: 'wespenschwarm',
    beute: 'wespenschwarm',
    sounds: { laut: 'sfx_kreatur_wespenschwarm_laut', treffer: 'sfx_kreatur_wespenschwarm_treffer', tod: 'sfx_kreatur_wespenschwarm_tod' },
    // Wasps sleep in their nest at night.
    aktiv: ['tag', 'daemmerung'],
    fortbewegung: 'flieger',
    augen: null,
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Ein Schwarm aus Wut und Stacheln, der sein graues Papiernest gegen alles verteidigt, was ihm zu nahe kommt. Ihr Gift brennt noch lange nach dem Stich.',
        en: 'A swarm of fury and stings that defends its grey paper nest against anything that comes too close. Their poison burns long after the sting.',
      },
      hinweis: {
        de: 'Rauch vertreibt sie: Mit einer brennenden Fackel in der Hand oder neben einem Feuer halten sie Abstand. Klingen schneiden durch den Schwarm hindurch – Feuer trifft ihn am besten.',
        en: 'Smoke drives them off: with a burning torch in hand or beside a fire they keep their distance. Blades cut right through the swarm – fire hits it best.',
      },
    },
  },
]);

/** The group of the Grünhain creatures (registered in src/content/creatures/index.ts `CREATURE_GROUPS`). */
export const GRUENHAIN_GRUPPE: CreatureGroup = {
  id: 'gruenhain',
  kreaturen: GRUENHAIN_KREATUREN,
  profile: GRUENHAIN_PROFILE,
  beute: GRUENHAIN_BEUTE,
  // The Grünhain table belongs to the core (hare, deer, quail); this group adds its creatures to it.
  spawnTabellen: [],
  spawnZusaetze: GRUENHAIN_SPAWN,
};
