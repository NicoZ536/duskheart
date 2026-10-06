/**
 * The Zweigling (docs/SPIEL.md §22 "Beschwörung (`spawnOwned` von `zweigling`, Besitzer `boss:<id>`)", §29 "Diener-Kreatur
 * `zweigling`"; MASTERPROMPT §20.2 Borkenvater "beschworene Zweiglinge"; M7-34): a servant of the Borkenvater – a knot of
 * twigs and bark that the corrupted tree tears from its own roots. It lives in no spawn table: it only rises in the arena,
 * owned by its boss (`CreatureSystem.spawnOwned`), and crumbles when the fight resets or the boss falls
 * (`despawnOwned`). One creature group (define.ts `CreatureGroup`) with its profile and loot; src/content/creatures/index.ts
 * registers it with one line. Sprite `kreatur_zweigling` (assets-src/sprites/kreaturen/zweigling.ts), sounds
 * src/content/sfx/boss.ts.
 *
 * **Balance on Normal** (§D): tier 1 like its master's arena; it falls to two hits of a bronze one-hander (bronze sword 12
 * cut, 22 HP, no armour) – a nuisance that splits the player's attention, not a second boss. Its scratch takes 8 of the
 * player's 100 HP through tier-1 armour (R 12: × 50/62 ≈ 6,5 %, §D "normaler Treffer 8–12 %" of a lightly armoured player),
 * telegraphed 0,4 s. Fire eats the dry twigs (−0,5); it is a night hunter of the arena with ember eyes.
 */
import { defineCreatureRecords, type CreatureGroup } from './define';
import { aiProfileSchema, creatureSchema, lootTableSchema } from './schema';

/** The Zweigling, validated and frozen. */
export const ZWEIGLING_KREATUREN = defineCreatureRecords('creatures', creatureSchema, [
  {
    id: 'zweigling',
    name: { de: 'Zweigling', en: 'Twigling' },
    beschreibung: { de: 'Ein Knäuel aus Zweigen und Borke, vom Borkenvater aus den eigenen Wurzeln gerissen.', en: 'A tangle of twigs and bark, torn by the Barkfather from its own roots.' },
    familie: 'gegner',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 1,
    leben: 22,
    tempo: { gehen: 2.4, rennen: 4.2 },
    radius: 6,
    ruestung: 0,
    // Dry twigs: a flame eats them.
    resistenzen: { feuer: -0.5 },
    material: 'holz',
    angriffe: [
      {
        // It rears up on its root legs and rakes with its twig claws.
        name: 'kratzer',
        art: 'nahkampf',
        schadensart: 'hieb',
        schaden: 8,
        reichweite: 14,
        bogen: 100,
        ausholzeit: 0.4,
        abklingzeit: 1.6,
        gewicht: 1,
        wucht: 2,
        stagger: 0.2,
        sound: 'sfx_boss_zweigling_kratzer',
      },
    ],
    ki: 'zweigling',
    beute: 'zweigling',
    sounds: { laut: 'sfx_boss_zweigling_laut', treffer: 'sfx_boss_zweigling_treffer', tod: 'sfx_boss_zweigling_tod' },
    aktiv: ['tag', 'daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'feuer',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Wenn der Borkenvater die Wurzeln aus dem Boden reißt, kriechen sie heraus: Zweigknäuel mit glimmenden Astlöchern als Augen. Sie leben nur, solange ihr Herr kämpft.',
        en: 'When the Barkfather tears its roots from the ground, they crawl out: tangles of twigs with glowing knotholes for eyes. They live only as long as their master fights.',
      },
      hinweis: {
        de: 'Zwei Hiebe zerbrechen einen Zweigling, eine Fackel oder ein Feuerpfeil noch schneller. Halte sie dir vom Leib, aber verliere den Borkenvater nicht aus den Augen.',
        en: 'Two blows break a twigling, a torch or a fire arrow even faster. Keep them off you, but never lose sight of the Barkfather.',
      },
    },
  },
]);

/** Its AI: it rushes the player and fights until it breaks; leashed to the arena (`spawnOwned` sets the arena's leash). */
export const ZWEIGLING_PROFILE = defineCreatureRecords('aiProfiles', aiProfileSchema, [
  {
    id: 'zweigling',
    haltung: 'aggressiv',
    sicht: 12,
    gehoer: 1,
    fluchtDistanz: 0,
    mut: 0,
    // The arena's radius (12 tiles) keeps it at its master's feet.
    leine: 12,
    streifen: 3,
    gewichte: { ruhen: 1, grasen: 0, umherstreifen: 2 },
    untersuchen: 3,
    gedaechtnis: 12,
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: null,
    unerbittlich: false,
  },
]);

/** What a broken Zweigling leaves: a drop of bark resin now and then, sticks of dead wood. */
export const ZWEIGLING_BEUTE = defineCreatureRecords('lootTables', lootTableSchema, [
  {
    id: 'zweigling',
    ziehungen: [0, 1],
    beute: [{ item: 'borkenharz', gewicht: 1, anzahl: [1, 1] }],
    zerlegen: [],
  },
]);

/** The Zweigling group (registered in src/content/creatures/index.ts). */
export const ZWEIGLING_GRUPPE: CreatureGroup = {
  id: 'zweigling',
  kreaturen: ZWEIGLING_KREATUREN,
  profile: ZWEIGLING_PROFILE,
  beute: ZWEIGLING_BEUTE,
  spawnTabellen: [],
  spawnZusaetze: [],
};
