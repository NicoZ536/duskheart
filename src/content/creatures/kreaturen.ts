/**
 * The creatures (MASTERPROMPT §20.1 "Jede Kreatur: Sprites und Animationen aller Zustände, Sounds, KI-Profil,
 * Beutetabelle, Bestiarium-Eintrag DE/EN"; docs/SPIEL.md §11, §14; M6-19, M6-29). Every record says what the creature
 * system needs: stats on Normal (§D), attacks whose wind-up matches the wind-up frames of the sprite `kreatur_<id>`
 * (assets-src/sprites/kreaturen/, docs/ART.md "Kreaturen (M6)"), the AI profile (profile.ts), the loot table of the same
 * id (beute.ts), the sounds (src/content/sfx/kreaturen.ts) and the bestiary texts. The validator rule `kreatur`
 * (tools/validator/kreaturen.ts) checks sprite clips, wind-ups, sounds, profile, loot and texts.
 *
 * The first three are the reference for every creature that follows:
 * - **Hase** (Grünhain, peaceful, 16 px): quick, flees at a few tiles; carved: meat, hide, bones, sinew. Traps catch it.
 * - **Reh** (Grünhain, peaceful, 32 px): flees early, kicks back when hit and cornered (`tritt`, 0,4 s wind-up = four
 *   frames at 10 fps to the strike); carved: much meat, hides, bones, sinew, fat and – from a buck – antlers.
 * - **Wachtel** (Grünhain, peaceful, 16 px): a ground bird in small coveys, flutters up when flushed; carved: fowl and
 *   feathers. Traps catch it. Not in winter (it leaves, spawn table).
 * And the **Nachtmahr** (shadow brood, 64 px, M6-29): the creature fear 100 summons (§12.3); it hunts until glaring light
 * or defeat, stamps (area, 0,7 s wind-up) and charges (0,6 s wind-up, 0,2 s run-up), and leaves Lumen shards.
 *
 * Health on Normal (§D "normale Gegner einer Stufe fallen nach 4–6 Treffern mit stufengerechter Einhandwaffe", T0 8 HP ×
 * class): a hare falls to one or two blows, a deer to four, the Nachtmahr – an elite-strength threat (×4) – to about twenty.
 */
import { defineCreatureRecords } from './define';
import { creatureSchema } from './schema';

/** Every creature, validated and frozen. */
export const CREATURES = defineCreatureRecords('creatures', creatureSchema, [
  {
    id: 'hase',
    name: { de: 'Hase', en: 'Hare' },
    beschreibung: { de: 'Scheues Kleinwild der Wiesen Grünhains.', en: 'Shy small game of the Greengrove meadows.' },
    familie: 'friedlich',
    team: 'tier',
    biome: ['gruenhain'],
    groesse: 16,
    stufe: 0,
    leben: 10,
    tempo: { gehen: 1.5, rennen: 7.5 },
    radius: 4,
    ruestung: 0,
    resistenzen: {},
    material: 'fell',
    angriffe: [],
    ki: 'hase',
    beute: 'hase',
    sounds: { laut: 'sfx_kreatur_hase_laut', treffer: 'sfx_kreatur_hase_treffer', tod: 'sfx_kreatur_hase_tod' },
    aktiv: ['daemmerung', 'nacht', 'tag'],
    fortbewegung: 'land',
    augen: null,
    fangbar: true,
    bestiarium: {
      text: {
        de: 'Grast am Waldrand und in hohem Gras, am liebsten in der Dämmerung. Hört dich lange, bevor es dich sieht, und schlägt mit den Läufen Alarm, ehe es davonschnellt.',
        en: 'Grazes at the edge of the wood and in tall grass, most of all at dusk. Hears you long before it sees you and drums a warning with its legs before it bolts.',
      },
      hinweis: {
        de: 'Zu schnell für die Verfolgung: schleich dich an oder stell eine Schlinge auf seinen Wechsel. Zerlegt gibt er Fleisch, Fell, Knochen und Sehnen.',
        en: 'Too fast to chase: sneak up on it or set a snare on its run. Carved, it gives meat, hide, bones and sinew.',
      },
    },
  },
  {
    id: 'reh',
    name: { de: 'Reh', en: 'Roe Deer' },
    beschreibung: { de: 'Wachsames Wild der Lichtungen, das sich zu wehren weiß.', en: 'Watchful game of the clearings that knows how to defend itself.' },
    familie: 'friedlich',
    team: 'tier',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 0,
    leben: 30,
    tempo: { gehen: 1.6, rennen: 7 },
    radius: 7,
    ruestung: 0,
    resistenzen: {},
    material: 'fell',
    angriffe: [
      {
        name: 'tritt',
        art: 'nahkampf',
        schadensart: 'wucht',
        schaden: 8,
        reichweite: 14,
        bogen: 100,
        ausholzeit: 0.4,
        abklingzeit: 2.5,
        gewicht: 1,
        wucht: 3,
        stagger: 0.3,
        sound: 'sfx_kreatur_reh_tritt',
      },
    ],
    ki: 'reh',
    beute: 'reh',
    sounds: { laut: 'sfx_kreatur_reh_laut', treffer: 'sfx_kreatur_reh_treffer', tod: 'sfx_kreatur_reh_tod' },
    aktiv: ['daemmerung', 'tag', 'nacht'],
    fortbewegung: 'land',
    augen: null,
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Äst in kleinen Sprüngen auf Lichtungen. Bei Gefahr bellt es heiser – das Schrecken – und flieht in weiten Fluchten. Ein verwundetes, in die Enge getriebenes Reh steigt und tritt mit den Vorderläufen.',
        en: 'Browses in small groups in clearings. At danger it gives a hoarse bark and flees in long bounds. A wounded deer driven into a corner rears and kicks with its forelegs.',
      },
      hinweis: {
        de: 'Pfeile holen es ein, bevor es flieht. Weiche dem Tritt aus, wenn es sich aufbäumt. Ein Rehbock trägt manchmal ein Geweih.',
        en: 'Arrows catch it before it flees. Dodge the kick when it rears up. A roe buck sometimes carries antlers.',
      },
    },
  },
  {
    id: 'wachtel',
    name: { de: 'Wachtel', en: 'Quail' },
    beschreibung: { de: 'Kleiner Bodenvogel, der in Grünhains Wiesen ruft.', en: 'A small ground bird calling in the Greengrove meadows.' },
    familie: 'friedlich',
    team: 'tier',
    biome: ['gruenhain'],
    groesse: 16,
    stufe: 0,
    leben: 6,
    tempo: { gehen: 1.2, rennen: 5 },
    radius: 3,
    ruestung: 0,
    resistenzen: {},
    material: 'fleisch',
    angriffe: [],
    ki: 'wachtel',
    beute: 'wachtel',
    sounds: { laut: 'sfx_kreatur_wachtel_laut', treffer: 'sfx_kreatur_wachtel_treffer', tod: 'sfx_kreatur_wachtel_tod' },
    aktiv: ['tag', 'daemmerung'],
    fortbewegung: 'land',
    augen: null,
    fangbar: true,
    bestiarium: {
      text: {
        de: 'Lebt versteckt im hohen Gras und verrät sich nur durch ihren dreisilbigen Ruf. Aufgescheucht schwirrt sie ein Stück weit dicht über dem Boden davon. Im Winter zieht sie fort.',
        en: 'Lives hidden in the tall grass and betrays itself only by its three-note call. Flushed, it whirs a short way off just above the ground. In winter it leaves.',
      },
      hinweis: {
        de: 'Eine Kastenfalle im Gras fängt sie sicherer als jede Waffe. Zerlegt gibt sie Geflügel und Federn für Pfeile.',
        en: 'A box trap in the grass catches it more surely than any weapon. Carved, it gives fowl and feathers for arrows.',
      },
    },
  },
  {
    id: 'nachtmahr',
    name: { de: 'Nachtmahr', en: 'Nightmare' },
    beschreibung: { de: 'Die Gestalt gewordene Angst, die kommt, wenn die Furcht vollkommen ist.', en: 'Fear given shape, which comes when dread is complete.' },
    familie: 'schattenbrut',
    team: 'schattenbrut',
    biome: [],
    groesse: 64,
    stufe: 1,
    leben: 180,
    tempo: { gehen: 2.5, rennen: 6.2 },
    radius: 12,
    ruestung: 10,
    resistenzen: { schatten: 0.8, licht: -0.5, feuer: -0.25, gift: 0.5 },
    material: 'schatten',
    angriffe: [
      {
        name: 'stampfen',
        art: 'flaeche',
        schadensart: 'wucht',
        schaden: 22,
        reichweite: 18,
        bogen: 360,
        ausholzeit: 0.7,
        abklingzeit: 3.5,
        gewicht: 1,
        wucht: 4,
        stagger: 0.5,
        flaeche: { radius: 28 },
        sound: 'sfx_kreatur_nachtmahr_stampfen',
      },
      {
        name: 'ansturm',
        art: 'sprung',
        schadensart: 'schatten',
        schaden: 16,
        reichweite: 40,
        bogen: 70,
        ausholzeit: 0.6,
        anlauf: 0.2,
        abklingzeit: 5,
        gewicht: 1.5,
        wucht: 4,
        stagger: 0.4,
        zustand: { id: 'erschuettert', chance: 0.5, sekunden: 6 },
        sound: 'sfx_kreatur_nachtmahr_ansturm',
      },
    ],
    ki: 'nachtmahr',
    beute: 'nachtmahr',
    sounds: { laut: 'sfx_kreatur_nachtmahr_laut', treffer: 'sfx_kreatur_nachtmahr_treffer', tod: 'sfx_kreatur_nachtmahr_tod' },
    aktiv: ['tag', 'daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'verderb',
    fangbar: false,
    bestiarium: {
      text: {
        de: 'Wer die Furcht ganz an sich heranlässt, ruft ihn. Er kommt aus der dunkelsten Richtung, bricht durch Türen und lässt nicht ab – nur gleißendes Licht vertreibt ihn.',
        en: 'Whoever lets fear take them wholly calls it. It comes from the darkest direction, breaks through doors and does not let go – only glaring light drives it off.',
      },
      hinweis: {
        de: 'Lauf zum hellsten Feuer oder stell dich ihm. Licht schneidet tief in ihn, Schatten kaum. Wenn er stampft, tritt aus dem Kreis; wenn er sich duckt, rollt zur Seite.',
        en: 'Run to the brightest fire or face it. Light cuts deep into it, shadow hardly at all. When it stamps, step out of the ring; when it crouches, roll aside.',
      },
    },
  },
]);
