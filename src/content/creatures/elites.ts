/**
 * The elites of Grünhain (MASTERPROMPT §20.1 "Elites: seltene, stärkere Varianten mit eigenem Muster"; docs/SPIEL.md §26
 * "Kreaturen M7"; M7-17, strand I): Graufang, the alpha wolf, and the Old Tusker, a boar grown grey and scarred – recoloured
 * and patterned sprites of their kin (assets-src/sprites/kreaturen/graufang.ts, alter_hauer.ts), each with its own AI, loot and
 * essence (`essenz_graufang`, `essenz_alter_hauer`, src/content/creatures/elitesEssenzen.ts; bound at the rune altar, M8-45).
 *
 * **Spawn rule** (src/game/creatures/elites.ts, wired in src/game/setup.ts): the entries below join Grünhain's table with a
 * small weight; an elite appears only in its region's lair chunk, at most one per region, and after its defeat the lair rests
 * `BALANCE.elites.restDays`. Family `elite`: counted as `creatures` and `elites` (§C), kept from peaceful worlds.
 *
 * **Balance on Normal** (§D): tier 1, about three of their kin. Graufang (90 HP) falls to eight blows of a bronze sword; its
 * bite takes 16 of the player's 100 HP (§D "schwerer Treffer 15–25 %"), its leap 30 – telegraphed 0,5 s, after which it
 * circles like a pack leader. The Old Tusker (130 HP, armour 8) charges for 34 after a 0,7-s wind-up and needs a dodge, not a
 * block; a spear still goes deep.
 */
import { BALANCE } from '../balance';
import { defineCreatureRecords, defineSpawnAdditions, type CreatureGroup } from './define';
import { aiProfileSchema, creatureSchema, lootTableSchema } from './schema';

const E = BALANCE.elites;

/** The two elites, validated and frozen. */
export const ELITE_KREATUREN = defineCreatureRecords('creatures', creatureSchema, [
  {
    id: 'graufang',
    name: { de: 'Graufang', en: 'Greyfang' },
    beschreibung: { de: 'Ein Alphawolf mit silbernem Nackenkamm und einer Narbe über dem Auge.', en: 'An alpha wolf with a silver ruff and a scar across one eye.' },
    familie: 'elite',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 1,
    leben: 90,
    // Faster than its pack: a sprint (7 tiles/s) no longer outruns it.
    tempo: { gehen: 2, rennen: 7.2 },
    radius: 7,
    ruestung: 2,
    resistenzen: { frost: 0.3 },
    material: 'fell',
    angriffe: [
      {
        name: 'biss',
        art: 'nahkampf',
        schadensart: 'stich',
        schaden: 16,
        reichweite: 15,
        bogen: 90,
        ausholzeit: 0.4,
        abklingzeit: 1.5,
        gewicht: 1.5,
        wucht: 3,
        stagger: 0.3,
        sound: 'sfx_kreatur_wolf_biss',
      },
      {
        // Crouches like a wolf (0,4 s), pushes off (0,1 s), then the leap: heavier, and it lands a stride further.
        name: 'sprung',
        art: 'sprung',
        schadensart: 'stich',
        schaden: 30,
        reichweite: 44,
        bogen: 70,
        ausholzeit: 0.4,
        anlauf: 0.1,
        abklingzeit: 4.5,
        gewicht: 1,
        wucht: 5,
        stagger: 0.5,
        sound: 'sfx_kreatur_wolf_sprung',
      },
    ],
    ki: 'graufang',
    beute: 'graufang',
    sounds: { laut: 'sfx_kreatur_wolf_laut', treffer: 'sfx_kreatur_wolf_treffer', tod: 'sfx_kreatur_wolf_tod' },
    aktiv: ['daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'feuer',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Der Leitwolf der Grünhain-Wälder: größer als seine Brüder, mit silbernem Nackenkamm und einer Narbe über dem linken Auge. Er jagt in der Dämmerung, wo die Wölfe heulen – und er weicht nicht zurück.',
        en: 'The lead wolf of the Greengrove woods: larger than its brothers, with a silver ruff and a scar over its left eye. It hunts at dusk where the wolves howl – and it does not back down.',
      },
      hinweis: {
        de: 'Sein Sprung reicht weiter als der eines Wolfs: Wenn er sich duckt, roll zur Seite statt zurück. Er gibt nie auf. Besiegt hinterlässt er seine Essenz – danach ist sein Revier für Tage still.',
        en: 'Its leap reaches further than a wolf’s: when it crouches, roll aside instead of back. It never gives up. Defeated it leaves its essence – then its territory falls silent for days.',
      },
    },
  },
  {
    id: 'alter_hauer',
    name: { de: 'Alter Hauer', en: 'Old Tusker' },
    beschreibung: { de: 'Ein ergrauter Keiler mit gebrochenem Hauer und narbiger Schwarte.', en: 'A greying boar with a broken tusk and a scarred hide.' },
    familie: 'elite',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 1,
    leben: 130,
    tempo: { gehen: 1.3, rennen: 6 },
    radius: 9,
    // Its hide is a crust of dried mud and scars.
    ruestung: 8,
    resistenzen: { stich: -0.2, hieb: 0.2 },
    material: 'fell',
    angriffe: [
      {
        // Paws the ground like a boar (0,6 s, the most §19.4 allows with the run-up): the charge carries further and hits harder.
        name: 'ansturm',
        art: 'sprung',
        schadensart: 'wucht',
        schaden: 34,
        reichweite: 52,
        bogen: 60,
        ausholzeit: 0.6,
        anlauf: 0.2,
        abklingzeit: 5,
        gewicht: 1.5,
        wucht: 5,
        stagger: 0.8,
        sound: 'sfx_kreatur_keiler_ansturm',
      },
      {
        name: 'hauer',
        art: 'nahkampf',
        schadensart: 'hieb',
        schaden: 16,
        reichweite: 17,
        bogen: 110,
        ausholzeit: 0.3,
        abklingzeit: 1.8,
        gewicht: 1,
        wucht: 4,
        stagger: 0.4,
        sound: 'sfx_kreatur_keiler_hauer',
      },
    ],
    ki: 'alter_hauer',
    beute: 'alter_hauer',
    sounds: { laut: 'sfx_kreatur_keiler_laut', treffer: 'sfx_kreatur_keiler_treffer', tod: 'sfx_kreatur_keiler_tod' },
    aktiv: ['daemmerung', 'nacht', 'tag'],
    fortbewegung: 'land',
    augen: 'feuer',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Ein uralter Keiler, grau um die Schnauze, ein Hauer abgebrochen, die Schwarte voller Narben und getrocknetem Schlamm. Er duldet niemanden in seinem Wald.',
        en: 'An ancient boar, grey around the snout, one tusk broken, its hide full of scars and dried mud. It tolerates no one in its forest.',
      },
      hinweis: {
        de: 'Blocken hält seinen Ansturm nicht auf – ausweichen! Er scharrt wie ein Keiler, stürmt aber weiter und härter. Ein Speer dringt durch die Schwarte, Klingen gleiten ab. Besiegt hinterlässt er seine Essenz.',
        en: 'Blocking does not stop its charge – dodge! It paws like a boar but charges further and harder. A spear pierces its hide, blades glance off. Defeated it leaves its essence.',
      },
    },
  },
]);

/** Their AI: the wolf's pack tactics and the boar's wallow, both bolder, without retreat. */
export const ELITE_PROFILE = defineCreatureRecords('aiProfiles', aiProfileSchema, [
  {
    id: 'graufang',
    haltung: 'aggressiv',
    sicht: 16,
    gehoer: 1.8,
    fluchtDistanz: 0,
    // It never gives up (a wolf flees badly wounded).
    mut: 1,
    leine: 36,
    streifen: 12,
    gewichte: { ruhen: 2, grasen: 0, umherstreifen: 3 },
    untersuchen: 8,
    gedaechtnis: 16,
    // The leader's ring: it circles with the wolves of its night and goes in first.
    rudel: { ringTiles: 3.5, angreiferZugleich: 1 },
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: null,
    unerbittlich: false,
  },
  {
    id: 'alter_hauer',
    haltung: 'revier',
    sicht: 11,
    gehoer: 1.3,
    fluchtDistanz: 8,
    mut: 1,
    leine: 22,
    streifen: 8,
    gewichte: { ruhen: 3, grasen: 4, umherstreifen: 1 },
    untersuchen: 5,
    gedaechtnis: 10,
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: null,
    unerbittlich: false,
  },
]);

/** Their loot: always the essence, and the carcass of their kin, richer. */
export const ELITE_BEUTE = defineCreatureRecords('lootTables', lootTableSchema, [
  {
    id: 'graufang',
    ziehungen: [1, 1],
    beute: [{ item: 'essenz_graufang', gewicht: 1, anzahl: [1, 1] }],
    zerlegen: [
      { item: 'wildfleisch_roh', chance: 1, anzahl: [2, 3] },
      { item: 'fell', chance: 1, anzahl: [2, 3] },
      { item: 'knochen', chance: 1, anzahl: [1, 2] },
      { item: 'sehnen', chance: 1, anzahl: [1, 2] },
      { item: 'wolfszahn', chance: 1, anzahl: [2, 3] },
    ],
  },
  {
    id: 'alter_hauer',
    ziehungen: [1, 1],
    beute: [{ item: 'essenz_alter_hauer', gewicht: 1, anzahl: [1, 1] }],
    zerlegen: [
      { item: 'wildfleisch_roh', chance: 1, anzahl: [5, 7] },
      { item: 'fell', chance: 1, anzahl: [2, 3] },
      { item: 'knochen', chance: 1, anzahl: [3, 4] },
      { item: 'fett', chance: 1, anzahl: [3, 4] },
      { item: 'keilerhauer', chance: 1, anzahl: [1, 1] },
    ],
  },
]);

/** Grünhain's table: rare, the wolf at dusk and night, the boar at every hour (`BALANCE.elites.spawnWeight`). */
export const ELITE_SPAWN = defineSpawnAdditions('spawnTables', [
  {
    biom: 'gruenhain',
    tag: [{ kreatur: 'alter_hauer', gewicht: E.spawnWeight, gruppe: [1, 1] }],
    nacht: [
      { kreatur: 'graufang', gewicht: E.spawnWeight, gruppe: [1, 1] },
      { kreatur: 'alter_hauer', gewicht: E.spawnWeight, gruppe: [1, 1] },
    ],
  },
]);

/** The elites' group (src/content/creatures/index.ts registers it with one line). */
export const ELITE_GRUPPE: CreatureGroup = { id: 'elites', kreaturen: ELITE_KREATUREN, profile: ELITE_PROFILE, beute: ELITE_BEUTE, spawnTabellen: [], spawnZusaetze: ELITE_SPAWN };
