/**
 * The shadow brood's base family (MASTERPROMPT §20.1 "Schattenbrut (überall nachts und im Untergrund): Schleicher,
 * Kriecher (hält fest), Speier (Fernkampf) … Lichtfresser"; §12.4; docs/SPIEL.md §11, §14; M6-25, M6-26): one creature
 * group (define.ts `CreatureGroup`) with its creatures, the AI profiles, loot tables and the night entries it adds to every
 * biome's spawn table (schattenbrutDaten.ts); src/content/creatures/index.ts registers it with one line. The Nachtmahr
 * (M6-29) stays with the core's reference creatures (kreaturen.ts). Sprites `kreatur_<id>` (assets-src/sprites/kreaturen/,
 * docs/ART.md §15.3), sounds src/content/sfx/kreaturen_schattenbrut.ts; the validator rule `kreatur` checks each whole.
 *
 * **Biome variants** (§20.1 "Schattenbrut-Varianten je Biom über Palette und Modifikator", M6-25b): the base form haunts the
 * tier-0 biomes (Grünhain, the Salt Coast, the root caves); every deeper biome has its variant – a palette row
 * `brut_<name>` (assets-src/paletteRows.ts: rim, glow and eyes in the biome's colour) and multipliers that carry the base
 * form's §D numbers to the biome's tier: health × the tier's weapon damage over tier 0's (still 4–6 blows of that tier's
 * one-handers), damage × the effective health of the tier's armour over tier 0's (still 8–12 % a normal blow), pace a little
 * quicker the deeper the night.
 *
 * **Balance on Normal** (§D; tests/unit/game/schattenbrut-balance.test.ts computes every number from the formulas): tier 0
 * base forms fall to 4–6 hits of each tier-0 one-hander (flint blade 8 cut, stone battle axe 9,2 cut, clubs 8,8 blunt,
 * stone spear 7,6 pierce): Schleicher 32 HP, Kriecher 44, Speier 30, Lichtfresser 40. Light cuts deep into all of them
 * (−0,5; the light eater, fed on it, −0,25), their own shadow hardly (0,8), fire a little more than steel (−0,25). Their
 * blows take 8–12 % of the player's 100 HP through the fibre set (R 6); heavy and telegraphed 20–30 %: the Schleicher's leap
 * and the Kriecher's grab (the blow and the bites of its hold together).
 *
 * **Behaviour** (schattenbrutDaten.ts): all hunt (`jaeger`) and avoid light above 0,5 – except the light eater, which goes
 * where the light is and only shuns the glaring; the Schleicher stalk in pairs and flank; the Kriecher crawls slowly, grabs
 * and holds (`festhalten`: the player cannot move or roll until a hit breaks the hold); the Speier keeps five tiles away and
 * spits a slow, dodgeable glob of poison (a creature shot of the combat system, M6-15b); the light eater's wind-up sucks
 * every torch and lantern within 4 tiles dark (`lichtfressen`, §12.4) and drains Lumen charges.
 */
import { BALANCE } from '../balance';
import { defineCreatureRecords, type CreatureGroup } from './define';
import { SCHATTENBRUT_BEUTE, SCHATTENBRUT_PROFILE, SCHATTENBRUT_SPAWN } from './schattenbrutDaten';
import { creatureSchema, type CreatureInput } from './schema';

/**
 * Armour of a whole set per tier T0–T7 [R] (§D "Rüstungswert je Set: T0 6 · T1 12 · T2 20 · T3 30 · T4 42 · T5 56 · T6 72 ·
 * T7 90"): what a player of that tier wears – the variants' damage keeps its share of the effective health against it.
 */
export const SET_RUESTUNG_JE_STUFE: readonly number[] = [6, 12, 20, 30, 42, 56, 72, 90];

/** Effective health of the player against set armour R [× base health]: (R + K) / K with the armour constant K (§19.3). */
function effektivesLeben(stufe: number): number {
  const k = BALANCE.combat.damage.armorConstant;
  return ((SET_RUESTUNG_JE_STUFE[stufe] as number) + k) / k;
}

/** Deeper biomes of the shadow brood's variants: the palette row, the biomes and the tier they carry the numbers to. */
const VARIANTEN_BIOME: readonly { readonly id: string; readonly biome: readonly string[]; readonly stufe: number; readonly tempo: number }[] = [
  // Tier 1: the moor (sickly green glow) and the deep ground (amber, the colour of the veins).
  { id: 'moor', biome: ['nebelmoor'], stufe: 1, tempo: 1.05 },
  { id: 'tiefe', biome: ['tiefgrund'], stufe: 1, tempo: 1.05 },
  // Tier 2: the frost ridge (a rim of blue ice).
  { id: 'frost', biome: ['frostkamm'], stufe: 2, tempo: 1.1 },
  // Tier 3: the ember sands (dust-brown and sand-pale).
  { id: 'sand', biome: ['glutsand'], stufe: 3, tempo: 1.1 },
  // Tier 4: the ash gorge and the ember veins (a rim of embers).
  { id: 'asche', biome: ['aschenschlund', 'glutadern'], stufe: 4, tempo: 1.15 },
  // Tier 5: the shard grove (prismatic cyan).
  { id: 'scherben', biome: ['scherbenhain'], stufe: 5, tempo: 1.15 },
  // Tier 6: the Nachtherz (black on black, violet eyes).
  { id: 'nachtherz', biome: ['nachtherz'], stufe: 6, tempo: 1.2 },
];

/** Palette row of a variant (assets-src/paletteRows.ts `SCHATTENBRUT_ZEILEN`). */
export function brutZeile(variante: string): string {
  return `brut_${variante}`;
}

/**
 * The biome variants of a shadow brood of tier `basis` (M6-25b): palette row and the multipliers that carry the base's §D
 * numbers to each variant's tier (see module comment).
 */
function varianten(basis: number): NonNullable<CreatureInput['varianten']> {
  const dmg = BALANCE.tools.weaponDamageByTier;
  return VARIANTEN_BIOME.map((v) => ({
    id: v.id,
    palette: brutZeile(v.id),
    biome: [...v.biome],
    leben: (dmg[v.stufe] as number) / (dmg[basis] as number),
    schaden: effektivesLeben(v.stufe) / effektivesLeben(basis),
    tempo: v.tempo,
  }));
}

/** What every shadow brood shares: light cuts deep, its own shadow hardly, fire a little. */
const BRUT_RESISTENZEN = { schatten: 0.8, licht: -0.5, feuer: -0.25, gift: 0.5 } as const;

/** The shadow brood's base family, validated and frozen. */
export const SCHATTENBRUT_KREATUREN = defineCreatureRecords('creatures', creatureSchema, [
  {
    id: 'schleicher',
    name: { de: 'Schleicher', en: 'Stalker' },
    beschreibung: { de: 'Schattenbrut, die in Paaren jagt und aus dem Dunkel springt.', en: 'Shadow brood that hunts in pairs and leaps from the dark.' },
    familie: 'schattenbrut',
    team: 'schattenbrut',
    biome: [],
    groesse: 32,
    stufe: 0,
    leben: 32,
    tempo: { gehen: 2.2, rennen: 5.2 },
    radius: 6,
    ruestung: 0,
    resistenzen: BRUT_RESISTENZEN,
    material: 'schatten',
    angriffe: [
      {
        name: 'klaue',
        art: 'nahkampf',
        schadensart: 'hieb',
        schaden: 11,
        reichweite: 14,
        bogen: 100,
        ausholzeit: 0.4,
        abklingzeit: 1.4,
        gewicht: 2,
        wucht: 2,
        stagger: 0.2,
        sound: 'sfx_kreatur_schleicher_klaue',
      },
      {
        // The heavy blow: it crouches for 0,5 s, then lunges the last tile and a half.
        name: 'sprung',
        art: 'sprung',
        schadensart: 'stich',
        schaden: 26,
        reichweite: 24,
        bogen: 60,
        ausholzeit: 0.5,
        abklingzeit: 5,
        gewicht: 1,
        wucht: 3,
        stagger: 0.3,
        sound: 'sfx_kreatur_schleicher_sprung',
      },
    ],
    ki: 'schleicher',
    beute: 'schleicher',
    sounds: { laut: 'sfx_kreatur_schleicher_laut', treffer: 'sfx_kreatur_schleicher_treffer', tod: 'sfx_kreatur_schleicher_tod' },
    aktiv: ['daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'eis',
    fangbar: false,
    varianten: varianten(0),
    bestiarium: {
      text: {
        de: 'Ein Leib aus Tintenrauch auf vier dünnen Läufen, nur die kalten Augen sind fest. Schleicher kommen zu zweit: der eine zeigt sich, der andere kommt von der Seite.',
        en: 'A body of ink smoke on four thin legs; only the cold eyes are solid. Stalkers come in pairs: one shows itself, the other comes from the side.',
      },
      hinweis: {
        de: 'Duckt er sich, springt er – rolle zur Seite. Licht hält ihn fern, gleißendes verbrennt ihn. Er lässt Lumen-Scherben zurück.',
        en: 'When it crouches, it leaps – roll aside. Light keeps it away, glaring light burns it. It leaves Lumen shards behind.',
      },
    },
  },
  {
    id: 'kriecher',
    name: { de: 'Kriecher', en: 'Crawler' },
    beschreibung: { de: 'Kriechende Schattenbrut, die packt und nicht mehr loslässt.', en: 'Crawling shadow brood that grabs and does not let go.' },
    familie: 'schattenbrut',
    team: 'schattenbrut',
    biome: [],
    groesse: 32,
    stufe: 0,
    leben: 44,
    tempo: { gehen: 1, rennen: 2.6 },
    radius: 7,
    ruestung: 0,
    resistenzen: BRUT_RESISTENZEN,
    material: 'schatten',
    angriffe: [
      {
        // The heavy blow: 0,5 s the maw gapes, then it grabs – and holds for up to 2,5 s, biting.
        name: 'packen',
        art: 'nahkampf',
        schadensart: 'schatten',
        schaden: 11,
        reichweite: 14,
        bogen: 90,
        ausholzeit: 0.5,
        abklingzeit: 4,
        gewicht: 1,
        wucht: 2,
        stagger: 0.2,
        festhalten: { sekunden: 2.5, schadenProSekunde: 5, bisse: 5 },
        sound: 'sfx_kreatur_kriecher_packen',
      },
    ],
    ki: 'kriecher',
    beute: 'kriecher',
    sounds: { laut: 'sfx_kreatur_kriecher_laut', treffer: 'sfx_kreatur_kriecher_treffer', tod: 'sfx_kreatur_kriecher_tod' },
    aktiv: ['daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'verderb',
    fangbar: false,
    varianten: varianten(0),
    bestiarium: {
      text: {
        de: 'Er schiebt sich flach über den Boden, langsam wie Nebel, und wartet im Dunkel neben dem Weg. Was er einmal gepackt hat, hält er fest und nagt.',
        en: 'It pushes itself flat across the ground, slow as mist, and waits in the dark beside the path. What it has grabbed it holds and gnaws.',
      },
      hinweis: {
        de: 'Lauf ihm davon, er ist langsam. Hält er dich, schlag zu – jeder Treffer lässt ihn los. Er lässt Lumen-Scherben zurück.',
        en: 'Outrun it, it is slow. If it holds you, strike – every hit makes it let go. It leaves Lumen shards behind.',
      },
    },
  },
  {
    id: 'speier',
    name: { de: 'Speier', en: 'Spitter' },
    beschreibung: { de: 'Schattenbrut mit glühendem Giftsack, die aus der Ferne spuckt.', en: 'Shadow brood with a glowing venom sac that spits from afar.' },
    familie: 'schattenbrut',
    team: 'schattenbrut',
    biome: [],
    groesse: 32,
    stufe: 0,
    leben: 30,
    tempo: { gehen: 1.6, rennen: 3.6 },
    radius: 6,
    ruestung: 0,
    resistenzen: BRUT_RESISTENZEN,
    material: 'schatten',
    angriffe: [
      {
        // 0,5 s the sac swells and glows, then a slow glob of poison flies six tiles (a creature shot, M6-15b).
        name: 'spucken',
        art: 'fernkampf',
        schadensart: 'gift',
        schaden: 8,
        reichweite: 96,
        bogen: 30,
        ausholzeit: 0.5,
        abklingzeit: 2.6,
        gewicht: 1,
        wucht: 1,
        stagger: 0.1,
        geschoss: { geschwindigkeit: 150, sprite: 'geschoss_spucken' },
        zustand: { id: 'vergiftung', chance: 0.5, sekunden: 4 },
        sound: 'sfx_kreatur_speier_spucken',
      },
    ],
    ki: 'speier',
    beute: 'speier',
    sounds: { laut: 'sfx_kreatur_speier_laut', treffer: 'sfx_kreatur_speier_treffer', tod: 'sfx_kreatur_speier_tod' },
    aktiv: ['daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'eis',
    fangbar: false,
    varianten: varianten(0),
    bestiarium: {
      text: {
        de: 'Auf dem Rücken trägt er einen Sack, der von innen glimmt. Er hält Abstand, bläht den Sack und spuckt einen Klumpen Gift, der im Flug leuchtet.',
        en: 'On its back it carries a sac that glows from within. It keeps its distance, swells the sac and spits a lump of poison that glows in flight.',
      },
      hinweis: {
        de: 'Der Klumpen ist langsam: weiche aus, rolle, oder blocke ihn mit dem Schild. Geh auf ihn zu – im Nahkampf ist er hilflos. Er lässt Lumen-Scherben zurück.',
        en: 'The lump is slow: dodge, roll, or catch it on your shield. Close in – in melee it is helpless. It leaves Lumen shards behind.',
      },
    },
  },
  {
    id: 'lichtfresser',
    name: { de: 'Lichtfresser', en: 'Light Eater' },
    beschreibung: { de: 'Schwebende Schattenbrut, die Fackeln und Laternen aussaugt.', en: 'Floating shadow brood that sucks torches and lanterns dark.' },
    familie: 'schattenbrut',
    team: 'schattenbrut',
    biome: [],
    groesse: 32,
    stufe: 0,
    leben: 40,
    tempo: { gehen: 1.4, rennen: 3.4 },
    radius: 7,
    ruestung: 0,
    // It feeds on light: light hurts it less than its kin.
    resistenzen: { ...BRUT_RESISTENZEN, licht: -0.25 },
    material: 'schatten',
    angriffe: [
      {
        // 0,6 s the maw opens and draws the light in, 0,1 s the sparks stream into it: every torch and lantern within
        // 4 tiles goes out (§12.4), Lumen lights lose a charge; the ring on the ground shows how far it reaches.
        name: 'saugen',
        art: 'flaeche',
        schadensart: 'schatten',
        schaden: 9,
        reichweite: 4,
        bogen: 360,
        ausholzeit: 0.6,
        anlauf: 0.1,
        abklingzeit: 8,
        gewicht: 1,
        wucht: 1,
        stagger: 0.1,
        flaeche: { radius: 64 },
        lichtfressen: { radiusTiles: 4, lumen: 1 },
        sound: 'sfx_kreatur_lichtfresser_saugen',
      },
      {
        name: 'schlag',
        art: 'nahkampf',
        schadensart: 'schatten',
        schaden: 10,
        reichweite: 16,
        bogen: 100,
        ausholzeit: 0.4,
        abklingzeit: 1.8,
        gewicht: 1,
        wucht: 2,
        stagger: 0.2,
        sound: 'sfx_kreatur_lichtfresser_schlag',
      },
    ],
    ki: 'lichtfresser',
    beute: 'lichtfresser',
    sounds: { laut: 'sfx_kreatur_lichtfresser_laut', treffer: 'sfx_kreatur_lichtfresser_treffer', tod: 'sfx_kreatur_lichtfresser_tod' },
    aktiv: ['daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'eis',
    fangbar: false,
    varianten: varianten(0),
    bestiarium: {
      text: {
        de: 'Ein schwebender Schemen mit einem Schlund, wo ein Gesicht sein sollte. Er scheut das Licht nicht – er sucht es, zieht es in sich hinein, bis nur noch Dunkel bleibt.',
        en: 'A floating shape with a maw where a face should be. It does not shun the light – it seeks it and draws it in until only dark remains.',
      },
      hinweis: {
        de: 'Öffnet sich sein Schlund, erlischt jede Fackel im Kreis um ihn. Schlag ihn, bevor er saugt – ein Treffer bricht es ab – oder bleib außerhalb des Rings. Er lässt mehr Lumen-Scherben zurück als seine Brut.',
        en: 'When its maw opens, every torch in the ring around it goes out. Strike before it feeds – a hit breaks it off – or stay outside the ring. It leaves more Lumen shards than its kin.',
      },
    },
  },
]);

/** The shadow brood group (M6-25, M6-26): its base family, profiles and loot, and its nights in every biome's table. */
export const SCHATTENBRUT_GRUPPE: CreatureGroup = {
  id: 'schattenbrut',
  kreaturen: SCHATTENBRUT_KREATUREN,
  profile: SCHATTENBRUT_PROFILE,
  beute: SCHATTENBRUT_BEUTE,
  spawnTabellen: [],
  spawnZusaetze: SCHATTENBRUT_SPAWN,
};
