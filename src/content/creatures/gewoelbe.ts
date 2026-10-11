/**
 * The vault creatures (MASTERPROMPT §20.1 "Erbauer-Konstrukte", §21 "Gewölbe … Mimik-Truhen, Fallengeister, Mini-Boss";
 * docs/SPIEL.md §26 "Gewölbe-Gegner (M7-15, Strang C, weil sie nur im Gewölbe leben)", §29; M7-15): the mimic chest, the trap
 * spirit, the first Builder construct and the root warden, the mini-boss of the Grünhain vaults. They live in no spawn table:
 * the vaults raise them as owned creatures (`spawnOwned`, owner `gewoelbe:<slot>`, src/game/vaults/system.ts) – the mimic on its
 * chest, the trap spirit in a trap room, constructs in chambers, the warden in the end chamber. Sprites
 * assets-src/sprites/kreaturen/{mimik_truhe,fallengeist,erbauer_konstrukt_1,wurzelhueter}.ts, sounds src/content/sfx/gewoelbe.ts.
 *
 * **Balance on Normal** (§D, tier 1 – the Grünhain vaults are reached with copper and bronze): the mimic bites from its
 * disguise for 14 (≈ 11 % through tier-1 armour), the spirit's chill 10, the construct's fist 16 slowly telegraphed (0.7 s), the
 * warden's root lash 20 and its stomp 18 in a ring (0.8 s each). Constructs shrug off blades (stich 0.5, hieb 0.3) but crack under
 * blunt blows (wucht −0.4) – the player learns to switch weapons; the warden and the mimic are wood (fire −0.4 / −0.3), the
 * spirit is a wisp of cold light (frost 0.6, licht −0.5: a Lumen weapon cuts it). Life: mimic 40, spirit 28, construct 60,
 * warden 260 (five to seven bronze blows a minute of fight with its servants – a mini-boss, not a boss).
 */
import { defineCreatureRecords, type CreatureGroup } from './define';
import { aiProfileSchema, creatureSchema, lootTableSchema } from './schema';

/** The four vault creatures, validated and frozen. */
export const GEWOELBE_KREATUREN = defineCreatureRecords('creatures', creatureSchema, [
  {
    id: 'mimik_truhe',
    name: { de: 'Mimik-Truhe', en: 'Mimic Chest' },
    beschreibung: { de: 'Eine Truhe, die keine ist: Holz, Eisenbänder – und Zähne unter dem Deckel.', en: 'A chest that is none: wood, iron bands – and teeth under the lid.' },
    familie: 'gegner',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 1,
    leben: 40,
    tempo: { gehen: 1.4, rennen: 3.4 },
    radius: 7,
    ruestung: 10,
    resistenzen: { feuer: -0.3, stich: 0.2 },
    material: 'holz',
    angriffe: [
      {
        // From its disguise: the lid flies open and snaps shut on whoever reaches for it.
        name: 'biss',
        art: 'nahkampf',
        schadensart: 'stich',
        schaden: 14,
        reichweite: 16,
        bogen: 90,
        ausholzeit: 0.5,
        abklingzeit: 1.6,
        gewicht: 1,
        wucht: 3,
        stagger: 0.3,
        ausTarnung: true,
        sound: 'sfx_gewoelbe_mimik_biss',
      },
      {
        // Awake: it hops after the player and snaps again.
        name: 'schnappen',
        art: 'nahkampf',
        schadensart: 'stich',
        schaden: 10,
        reichweite: 14,
        bogen: 80,
        ausholzeit: 0.4,
        abklingzeit: 1.4,
        gewicht: 1,
        wucht: 2,
        stagger: 0.2,
        sound: 'sfx_gewoelbe_mimik_biss',
      },
    ],
    ki: 'mimik_truhe',
    beute: 'mimik_truhe',
    sounds: { laut: 'sfx_gewoelbe_mimik_laut', treffer: 'sfx_gewoelbe_mimik_treffer', tod: 'sfx_gewoelbe_mimik_tod' },
    aktiv: ['tag', 'daemmerung', 'nacht'],
    fortbewegung: 'land',
    // Glutaugen im Spalt unter dem Deckel – getarnt (Clip `tarnung`, Deckel zu) zeigt das Sprite keine, sie ist eine Truhe.
    augen: 'feuer',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Die Erbauer schützten ihre Schätze mit allem, was sie hatten – auch mit Truhen, die beißen. In der Tiefe der Gewölbe wartet die Mimik still, bis eine Hand nach ihrem Deckel greift.',
        en: 'The Builders guarded their treasures with everything they had – even with chests that bite. Deep in the vaults the mimic waits in silence until a hand reaches for its lid.',
      },
      hinweis: {
        de: 'Eine Truhe ohne Staub auf dem Deckel ist verdächtig. Schlag zuerst zu, bevor du sie öffnest – ein Hieb auf den Deckel weckt sie, ohne dass sie dich packt.',
        en: 'A chest without dust on its lid is suspicious. Strike first before you open it – a blow on the lid wakes it without it catching you.',
      },
    },
  },
  {
    id: 'fallengeist',
    name: { de: 'Fallengeist', en: 'Trap Spirit' },
    beschreibung: { de: 'Ein kalter Lichtfaden, der die Fallen der Erbauer bewacht und Eindringlinge hineinlockt.', en: 'A cold thread of light that keeps the Builders’ traps and lures intruders into them.' },
    familie: 'gegner',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 1,
    leben: 28,
    tempo: { gehen: 1.8, rennen: 3.8 },
    radius: 5,
    ruestung: 0,
    resistenzen: { frost: 0.6, hieb: 0.2, licht: -0.5 },
    material: 'schatten',
    angriffe: [
      {
        // It flows through the player: a chill that numbs.
        name: 'kaelte',
        art: 'nahkampf',
        schadensart: 'frost',
        schaden: 10,
        reichweite: 14,
        bogen: 120,
        ausholzeit: 0.5,
        abklingzeit: 1.8,
        gewicht: 1,
        wucht: 1,
        stagger: 0.1,
        sound: 'sfx_gewoelbe_geist_kaelte',
      },
    ],
    ki: 'fallengeist',
    beute: 'fallengeist',
    sounds: { laut: 'sfx_gewoelbe_geist_laut', treffer: 'sfx_gewoelbe_geist_treffer', tod: 'sfx_gewoelbe_geist_tod' },
    aktiv: ['tag', 'daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'eis',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Fallengeister sind keine Toten: Die Erbauer haben sie aus dem kalten Licht ihrer Mechanismen gesponnen. Sie schweben über den Druckplatten und warten, bis jemand ihnen folgt.',
        en: 'Trap spirits are no dead: the Builders spun them from the cold light of their mechanisms. They hover above the pressure plates, waiting for someone to follow them.',
      },
      hinweis: {
        de: 'Lauf ihm nicht nach – er führt dich über die Platten. Lass ihn kommen und schlag mit Lumen zu.',
        en: 'Do not chase it – it leads you over the plates. Let it come and strike with Lumen.',
      },
    },
  },
  {
    id: 'erbauer_konstrukt_1',
    name: { de: 'Erbauer-Konstrukt', en: 'Builder Construct' },
    beschreibung: { de: 'Ein Wächter aus Stein und Bronze, der seit Jahrhunderten dieselbe Runde geht.', en: 'A warden of stone and bronze that has walked the same round for centuries.' },
    familie: 'gegner',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 1,
    leben: 60,
    tempo: { gehen: 1.2, rennen: 2.6 },
    radius: 7,
    ruestung: 25,
    resistenzen: { stich: 0.5, hieb: 0.3, wucht: -0.4, gift: 1 },
    material: 'stein',
    angriffe: [
      {
        // The stone fist rises slowly – and comes down hard.
        name: 'faust',
        art: 'nahkampf',
        schadensart: 'wucht',
        schaden: 16,
        reichweite: 16,
        bogen: 90,
        ausholzeit: 0.7,
        abklingzeit: 2,
        gewicht: 1,
        wucht: 4,
        stagger: 0.4,
        sound: 'sfx_gewoelbe_konstrukt_faust',
      },
    ],
    ki: 'erbauer_konstrukt_1',
    beute: 'erbauer_konstrukt_1',
    sounds: { laut: 'sfx_gewoelbe_konstrukt_laut', treffer: 'sfx_gewoelbe_konstrukt_treffer', tod: 'sfx_gewoelbe_konstrukt_tod' },
    aktiv: ['tag', 'daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'feuer',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Die Konstrukte der ersten Reihe sind schlicht: ein Steinleib, Gelenke aus Bronze, im Brustkorb ein Funke Glut. Sie gehorchen einem Befehl, den niemand mehr zurücknehmen kann.',
        en: 'The constructs of the first series are simple: a body of stone, joints of bronze, an ember in the chest. They obey an order nobody can take back any more.',
      },
      hinweis: {
        de: 'Klingen gleiten an ihm ab – nimm Hammer oder Keule. Seine Faust holt langsam aus: weich zur Seite und schlag in die Lücke.',
        en: 'Blades glance off it – take a hammer or a club. Its fist rises slowly: roll aside and strike into the gap.',
      },
    },
  },
  {
    id: 'wurzelhueter',
    name: { de: 'Wurzelhüter', en: 'Root Warden' },
    beschreibung: { de: 'Ein Erbauerwächter, den die Wurzeln des Grünhains überwuchert und in Besitz genommen haben.', en: 'A Builder warden that the roots of the Greenwood overgrew and took for their own.' },
    familie: 'gegner',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 64,
    stufe: 1,
    leben: 260,
    tempo: { gehen: 1.1, rennen: 2.4 },
    radius: 14,
    ruestung: 15,
    resistenzen: { feuer: -0.4, hieb: -0.2, stich: 0.3, gift: 0.5 },
    material: 'holz',
    angriffe: [
      {
        // A root arm lashes across the chamber.
        name: 'peitsche',
        art: 'nahkampf',
        schadensart: 'hieb',
        schaden: 20,
        reichweite: 30,
        bogen: 120,
        ausholzeit: 0.8,
        abklingzeit: 2.2,
        gewicht: 2,
        wucht: 4,
        stagger: 0.4,
        sound: 'sfx_gewoelbe_hueter_peitsche',
      },
      {
        // It stamps: roots burst from the floor in a ring around it.
        name: 'stampfen',
        art: 'flaeche',
        schadensart: 'wucht',
        schaden: 18,
        reichweite: 40,
        bogen: 360,
        ausholzeit: 0.8,
        abklingzeit: 3,
        gewicht: 1,
        wucht: 5,
        stagger: 0.5,
        flaeche: { radius: 40 },
        sound: 'sfx_gewoelbe_hueter_stampfen',
      },
    ],
    ki: 'wurzelhueter',
    beute: 'wurzelhueter',
    sounds: { laut: 'sfx_gewoelbe_hueter_laut', treffer: 'sfx_gewoelbe_hueter_treffer', tod: 'sfx_gewoelbe_hueter_tod' },
    aktiv: ['tag', 'daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'feuer',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Einst war er ein Konstrukt wie die anderen. Dann fanden die Wurzeln den Weg in seine Gelenke, und die Glut in seiner Brust nährt jetzt einen Wald. Er hütet die Endkammer der Grünhain-Gewölbe.',
        en: 'Once it was a construct like the others. Then the roots found their way into its joints, and the ember in its chest now feeds a forest. It guards the end chamber of the Greenwood vaults.',
      },
      hinweis: {
        de: 'Feuer frisst das Holz, Klingen das Wurzelwerk. Wenn er stampft, bricht der Boden um ihn auf – geh auf Abstand, solange er ausholt.',
        en: 'Fire eats the wood, blades the roots. When it stamps, the floor bursts around it – keep your distance while it winds up.',
      },
    },
  },
]);

/** Shared AI traits of the vault creatures: no doors broken, no light shunned, never relentless. */
const WAECHTER = { schuetztSich: false, brichtTueren: false, meidetLicht: null, unerbittlich: false } as const;

/** Their AI: guards of a room – they keep to it (the vaults set the leash, `BALANCE.vaults.guardLeashTiles`). */
export const GEWOELBE_PROFILE = defineCreatureRecords('aiProfiles', aiProfileSchema, [
  {
    id: 'mimik_truhe',
    haltung: 'aggressiv',
    sicht: 4,
    gehoer: 0.5,
    fluchtDistanz: 0,
    mut: 0,
    leine: 6,
    streifen: 2,
    gewichte: { ruhen: 6, grasen: 0, umherstreifen: 0.5 },
    untersuchen: 2,
    gedaechtnis: 8,
    // The reveal is the sprite's clip `erwachen` (6 positions at 10 fps); half a minute in peace and it is a chest again.
    tarnung: { erwachen: 0.6, tarnenNach: 30 },
    ...WAECHTER,
  },
  {
    id: 'fallengeist',
    haltung: 'jaeger',
    sicht: 12,
    gehoer: 1.5,
    fluchtDistanz: 0,
    mut: 0.5,
    leine: 10,
    streifen: 6,
    gewichte: { ruhen: 1, grasen: 0, umherstreifen: 3 },
    untersuchen: 6,
    gedaechtnis: 12,
    ...WAECHTER,
  },
  {
    id: 'erbauer_konstrukt_1',
    haltung: 'aggressiv',
    sicht: 10,
    gehoer: 1,
    fluchtDistanz: 0,
    mut: 1,
    leine: 10,
    streifen: 4,
    gewichte: { ruhen: 2, grasen: 0, umherstreifen: 2 },
    untersuchen: 4,
    gedaechtnis: 15,
    ...WAECHTER,
  },
  {
    id: 'wurzelhueter',
    haltung: 'aggressiv',
    sicht: 14,
    gehoer: 1.5,
    fluchtDistanz: 0,
    mut: 1,
    leine: 12,
    streifen: 3,
    gewichte: { ruhen: 3, grasen: 0, umherstreifen: 1 },
    untersuchen: 5,
    gedaechtnis: 30,
    ...WAECHTER,
  },
]);

/**
 * What they leave (one draw for the small ones, docs/SPIEL.md §11; nothing the world offers for gathering, ADR-0105): the mimic
 * a bronze nail or two (its iron bands; its chest's own loot spills where it stood, src/game/vaults/), the spirit a Lumen shard,
 * the construct copper or bronze from its joints, the warden its essence (Verwendung M8-45) – always.
 */
export const GEWOELBE_BEUTE = defineCreatureRecords('lootTables', lootTableSchema, [
  { id: 'mimik_truhe', ziehungen: [1, 1], beute: [{ item: 'nagel_bronze', gewicht: 1, anzahl: [2, 4] }], zerlegen: [] },
  { id: 'fallengeist', ziehungen: [1, 1], beute: [{ item: 'lumen_scherbe', gewicht: 1, anzahl: [1, 1] }], zerlegen: [] },
  {
    id: 'erbauer_konstrukt_1',
    ziehungen: [1, 1],
    beute: [
      { item: 'kupferbarren', gewicht: 3, anzahl: [1, 1] },
      { item: 'bronzebarren', gewicht: 1, anzahl: [1, 1] },
    ],
    zerlegen: [],
  },
  { id: 'wurzelhueter', ziehungen: [1, 1], beute: [{ item: 'essenz_wurzelhueter', gewicht: 1, anzahl: [1, 1] }], zerlegen: [] },
]);

/** The vault group (registered in src/content/creatures/index.ts). */
export const GEWOELBE_GRUPPE: CreatureGroup = {
  id: 'gewoelbe',
  kreaturen: GEWOELBE_KREATUREN,
  profile: GEWOELBE_PROFILE,
  beute: GEWOELBE_BEUTE,
  spawnTabellen: [],
  spawnZusaetze: [],
};
