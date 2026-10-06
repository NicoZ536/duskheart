/**
 * Instruments, the net and what it catches (M7-31; MASTERPROMPT §11.4 "Musizieren", §12.2 "Glühwürmchenglas 3 · 2 Tage ·
 * kostenlos, schwach", §12.3 "Musizieren (Flöte, Laute) −2/s im Umkreis", §14 "Netz (Insekten, Glühwürmchen …)";
 * docs/SPIEL.md §24, §29 – strand A):
 *
 * - **Flöte** `floete` and **Laute** `laute` (block `instrument`): played from the hand or with `instrument.play`, they
 *   calm the fear of everyone around (src/game/instruments). The flute knows `lied_1`, `lied_2`, the lute `lied_3`, `lied_4`
 *   (src/content/music/lieder.ts). Made at the workbench from wood, resin and sinew; nothing uses them up.
 * - **Netz** `netz` (tool kind `netz`): swung over the meadow it catches fireflies from a swarm and crickets from the grass.
 * - **Grille** `grille` (block `koeder`, strand D's fishing): a cricket from the grass at night – a bait carp and perch take.
 * - **Glühwürmchen** `gluehwuermchen`: a firefly in a twist of cloth – the fill and fuel of the firefly jar.
 * - **Glühwürmchenglas** `gluehwuermchenglas`: furniture light (`MOEBEL_LICHTER`-style, behaviour `lampe`, behind glass):
 *   radius 3, weak, one firefly glows for 48 game hours (§12.2 "2 Tage"). Built at the workbench with three fireflies in
 *   it; refilled with fireflies like a lamp with resin.
 */
import type { z } from 'zod';
import { defineBuildParts } from '../buildParts';
import type { lightKindSchema } from '../lights';
import { moebelLichtSchema, type MoebelLicht } from './moebel';
import { BALANCE } from '../balance';
import { deepFreeze } from '../freeze';
import { baseItem, defineItemGroup } from './define';

/** Durability of the net [swings]: a T0 tool (§D). */
const NET_DURABILITY = BALANCE.items.durabilityByTier[0] as number;
/** Handling sounds of the new items (src/content/sfx/instrumente.ts). */
const SFX = {
  floete: 'sfx_musik_floete_aufheben',
  laute: 'sfx_musik_laute_aufheben',
  netz: 'sfx_netz_aufheben',
  insekt: 'sfx_item_insekt',
  glas: 'sfx_glas_aufheben',
} as const;

/** Instruments, the net and its catch. */
export const INSTRUMENTE = defineItemGroup('instrumente', [
  baseItem({
    id: 'floete',
    name: { de: 'Holzflöte', en: 'Wooden Flute' },
    beschreibung: {
      de: 'Ein ausgehöhlter Ast mit sechs Grifflöchern, das Mundstück mit Harz geglättet. Wer spielt, steht still – und wer zuhört, fürchtet sich weniger (−2 Furcht/s im Umkreis). Kennt das Wiegenlied und die Wanderweise.',
      en: 'A hollowed branch with six finger holes, its mouthpiece smoothed with resin. Whoever plays stands still – and whoever listens is less afraid (−2 fear/s around). Knows the Lullaby and the Wayfarer’s Tune.',
    },
    kategorie: 'rohstoff',
    instrument: { lieder: ['lied_1', 'lied_2'] },
    // Played, never used up: no recipe or part takes it.
    endprodukt: true,
    tauschwert: 14,
    sounds: { aufheben: SFX.floete },
  }),
  baseItem({
    id: 'laute',
    name: { de: 'Laute', en: 'Lute' },
    beschreibung: {
      de: 'Ein bauchiger Holzkörper, vier Saiten aus gedrehter Sehne. Wer spielt, steht still – und wer zuhört, fürchtet sich weniger (−2 Furcht/s im Umkreis). Kennt das Herdlied und den Abendstern.',
      en: 'A round-bellied wooden body with four strings of twisted sinew. Whoever plays stands still – and whoever listens is less afraid (−2 fear/s around). Knows the Hearth Song and the Evening Star.',
    },
    kategorie: 'rohstoff',
    instrument: { lieder: ['lied_3', 'lied_4'] },
    endprodukt: true,
    tauschwert: 30,
    sounds: { aufheben: SFX.laute },
  }),
  baseItem({
    id: 'netz',
    name: { de: 'Kescher', en: 'Bug Net' },
    beschreibung: {
      de: 'Ein Netz aus Fasern auf einem Zweigring, an einem langen Stiel. Durch einen Glühwürmchenschwarm geschwungen fängt es ein paar Lichter – drei je Schwarm und Nacht –, durchs Gras nachts eine Grille.',
      en: 'A net of fibres on a ring of twigs, on a long handle. Swept through a swarm of fireflies it catches a few lights – three per swarm and night –, through the grass at night a cricket.',
    },
    kategorie: 'werkzeug',
    werkzeug: { art: 'netz', abbaukraft: 1 },
    haltbarkeit: NET_DURABILITY,
    tauschwert: 8,
    sounds: { aufheben: SFX.netz, benutzen: 'sfx_netz_schwung' },
  }),
  baseItem({
    id: 'grille',
    name: { de: 'Grille', en: 'Cricket' },
    beschreibung: {
      de: 'Eine Feldgrille aus dem nächtlichen Gras, in einem Blatt verwahrt. Als Köder in den Taschen: Karpfen und Barsch beißen eher.',
      en: 'A field cricket from the grass at night, kept in a leaf. As bait in your bags: carp and perch bite sooner.',
    },
    kategorie: 'rohstoff',
    // Caught with the net in the grass (src/game/instruments): the grass terrain is its source (`graben:` is the kind of
    // terrain sources until a kind of its own for the net exists).
    quellen: ['graben:gras'],
    koeder: { biss: 1.4, fische: ['karpfen', 'barsch'] },
    // Taken by the next cast (block `koeder`, strand D): no recipe or part takes it.
    endprodukt: true,
    tauschwert: 1,
    sounds: { aufheben: SFX.insekt },
  }),
  baseItem({
    id: 'gluehwuermchen',
    name: { de: 'Glühwürmchen', en: 'Firefly' },
    beschreibung: {
      de: 'Ein Glühwürmchen, in ein Stück Stoff geschlagen, das sacht durch die Falten leuchtet. Im Glühwürmchenglas glüht es zwei Tage lang.',
      en: 'A firefly wrapped in a scrap of cloth, glowing softly through the folds. In a firefly jar it glows for two days.',
    },
    kategorie: 'rohstoff',
    // Netted from a swarm of the creature `gluehwuermchen` (the swarm stays, src/game/instruments).
    quellen: ['drop:gluehwuermchen'],
    tauschwert: 2,
    sounds: { aufheben: SFX.insekt },
  }),
  baseItem({
    id: 'gluehwuermchenglas',
    name: { de: 'Glühwürmchenglas', en: 'Firefly Jar' },
    beschreibung: {
      de: 'Ein Glas voller Glühwürmchen unter einem Deckel aus Zweigen. Leuchtet drei Kacheln weit, schwach und grün; ein Glühwürmchen glüht zwei Tage, Regen schadet ihm nicht.',
      en: 'A jar full of fireflies under a lid of twigs. Lights three tiles around, faint and green; one firefly glows for two days, and rain does it no harm.',
    },
    kategorie: 'bauteil',
    tauschwert: 12,
    sounds: { aufheben: SFX.glas },
  }),
]);

/** The firefly jar as a build part: a small floor light (furniture category `licht`), its glass breaks like glass. */
export const INSTRUMENTE_BAUTEILE = defineBuildParts('instrumente', [{ id: 'gluehwuermchenglas', art: 'moebel', material: 'glas', kategorie: 'licht' }]);

/**
 * The light of the firefly jar (§12.2 "Glühwürmchenglas | 3 | 2 Tage | kostenlos, schwach"): behaviour `lampe` with the
 * firefly as its fuel – 48 game hours a piece, holds two – behind glass (rain does not reach it), barely flickering,
 * weak (0,45: a third of a camp fire's brightness), the cold green of the firefly sprites.
 */
export const INSTRUMENTE_LICHTER: readonly MoebelLicht[] = deepFreeze([
  moebelLichtSchema.parse({
    item: 'gluehwuermchenglas',
    name: { de: 'Glühwürmchenglas', en: 'Firefly Jar' },
    sprite: 'obj_gluehwuermchenglas',
    verhalten: 'lampe',
    radius: 3,
    intensitaet: 0.45,
    flackern: 0.05,
    farbe: 'gras.5',
    montage: 'boden',
    brennstoff: 'gluehwuermchen',
    stundenJeEinheit: 48,
    vorrat: 2,
    wetterfest: true,
    sounds: { an: 'sfx_glas_oeffnen', aus: 'sfx_glas_schliessen', brennen: 'sfx_glas_glimmen' },
  }),
]);

/** Height of the jar's glow above its sprite's anchor [px] (the `licht` socket of `obj_gluehwuermchenglas`). */
export const GLAS_LICHT_HOEHE_PX = 6;

/** The light kind of the firefly jar for src/content/lights.ts (a furniture light like the lamps of M4-19). */
export function instrumentLightKinds(): z.input<typeof lightKindSchema>[] {
  const jar = INSTRUMENTE.find((i) => i.id === 'gluehwuermchenglas');
  return INSTRUMENTE_LICHTER.map((l) => ({
    id: l.item,
    name: l.name,
    beschreibung: jar?.beschreibung ?? l.name,
    verhalten: l.verhalten,
    gegenstand: l.item,
    getragen: false,
    farbe: l.farbe,
    sprites: {},
    sounds: l.sounds,
    moebel: {
      radius: l.radius,
      intensitaet: l.intensitaet,
      flackern: l.flackern,
      montage: l.montage,
      flammeHoehePx: GLAS_LICHT_HOEHE_PX,
      wetterfest: l.wetterfest,
      ...(l.brennstoff === undefined ? {} : { brennstoff: l.brennstoff }),
      ...(l.stundenJeEinheit === undefined ? {} : { stundenJeEinheit: l.stundenJeEinheit }),
      ...(l.vorrat === undefined ? {} : { vorrat: l.vorrat }),
    },
  }));
}
