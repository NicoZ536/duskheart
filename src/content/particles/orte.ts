/**
 * Particles of the places (MASTERPROMPT §6.2 "Emitter als Daten", §21 "Naturwunder (… Geysirfeld …)"; docs/SPIEL.md §18
 * "Naturwunder"; M7-123): the steam of the Geysirfeld. World objects have no clips – the geyser's column and the vents' wisps
 * rise as particles from sources bound to the objects (`OBJECT_EMITTERS_ORTE`), placed by the presentation for every such
 * object in view (src/render/world/objectEmitters.ts). The geyser's sprite keeps only the low plume over its vent
 * (assets-src/sprites/orte/geysir.ts); the column above it is these puffs.
 *
 * - `dampf`: a puff of steam – white at birth (the sprite's steam `eis.4`) for its first half, then cooling through `eis.3`
 *   to `eis.2` (the blue-grey of the older puffs gives the column its shadow side against pale sand), swelling to about two
 *   and a half times its size and fading; it rises by itself (hot), curls slowly and leans with the wind less than smoke (the
 *   jet carries it up). Lit by the scene, not glowing: steam is no light.
 * - `dampfhauch`: the thin wisp of a steam vent – a pixel or two that widen and fade within two seconds.
 * - `geysirkern` (M7-141): the core of the geyser's jet – white blobs shot straight up out of the vent that slow and fade
 *   within half a second, so many that they stand as one white pillar over the cone.
 * - `geysirstrahl` (M7-141): a drop of the spray – a white streak while it shoots up, a dot at the top of its arc, a
 *   blue-white streak falling back around the cone, splashing on the sinter (`regenspritzer`).
 * - `dampfschwall` (M7-141): the billow over an eruption – a larger puff than `dampf`, born along the jet, swelling and
 *   rising high above it.
 * - `geysir_dampf`: the column over a geyser's vent – a dense stream of puffs from the rounded top of the sprite's plume,
 *   as wide as it, so the column grows out of the drawn jet without a seam.
 * - `geysir_saeule`, `geysir_fontaene`, `geysir_schwall` (M7-141): the eruption – the pillar of the jet, its spray falling
 *   back around the cone and the billow of steam over it.
 * - `dampfspalt_dampf`: a vent's wisps, a few a second from the crack.
 *
 * The geyser's rhythm (M7-141, `rhythmus` of its binding): a cycle of 24–36 s per geyser – the column lazes at a third of
 * its rate, swells for 4 s, erupts for 6 s (the jet, its spray and the billow swell in and die out over 0.8 s each) and settles over
 * 5 s; the rest is calm. Two geysers of a field stand at different points of their cycles (the phase comes from the tile).
 */
import type { ObjectEmitterInput, ParticleEmitterInput, ParticleKindInput } from './schema';

export const PARTICLE_KINDS_ORTE: readonly ParticleKindInput[] = [
  {
    // Steam: a white puff that rises by itself, swells, cools to grey-blue and fades – about 60 px of column in its life.
    id: 'dampf',
    form: 'scheibe',
    groesse: { min: 4, max: 7 },
    wachstum: 2.5,
    farben: ['eis.4', 'eis.4', 'eis.3', 'eis.2'],
    deckung: { start: 0.95, ende: 0 },
    emissiv: 0,
    flackern: 0,
    leben: { min: 2.2, max: 3.4 },
    schwerkraft: -6,
    widerstand: 0.7,
    wind: 0.6,
    wirbel: 5,
    wirbelTakt: 0.5,
    boden: 'vergehen',
  },
  {
    // A steam vent's wisp: a pixel or two that widen and fade within two seconds, like a torch's smoke but white.
    id: 'dampfhauch',
    form: 'scheibe',
    groesse: { min: 1, max: 2 },
    wachstum: 2.5,
    farben: ['eis.4', 'eis.3'],
    deckung: { start: 0.7, ende: 0 },
    emissiv: 0,
    flackern: 0,
    leben: { min: 1.2, max: 2 },
    schwerkraft: -5,
    widerstand: 0.9,
    wind: 1,
    wirbel: 4,
    wirbelTakt: 0.6,
    boden: 'vergehen',
  },
  {
    // The core of the jet (M7-141): a white blob of 3–4 px shot up out of the vent at 125–150 px/s against 230 px/s², swelling a
    // little and fading to two thirds within about half a second – 40–50 px up, where the spray and the billow take over.
    // Lit, not glowing (water is no light).
    id: 'geysirkern',
    form: 'scheibe',
    groesse: { min: 3, max: 4 },
    wachstum: 1.4,
    farben: ['eis.4', 'eis.4', 'eis.4', 'eis.3'],
    deckung: { start: 1, ende: 0.6 },
    emissiv: 0,
    flackern: 0,
    leben: { min: 0.42, max: 0.58 },
    schwerkraft: 230,
    widerstand: 0.3,
    wind: 0.15,
    wirbel: 2,
    wirbelTakt: 1.5,
    boden: 'vergehen',
  },
  {
    // A drop of the spray (M7-141): a 1-px streak along its flight – white as it shoots up, a dot at the top of its arc,
    // blue-white as it falls back and splashes on the sinter. Thrown 115–160 px/s up against 230 px/s² it peaks 29–56 px
    // over the plume, drifts 8–26 px/s outwards and lands around the cone within 1.3–1.6 s; lit, not glowing.
    id: 'geysirstrahl',
    form: 'strich',
    groesse: { min: 1, max: 1 },
    wachstum: 1,
    strich: { faktor: 0.05, min: 1, max: 7 },
    farben: ['eis.4', 'eis.4', 'eis.3', 'wasser.4'],
    deckung: { start: 1, ende: 0.8 },
    emissiv: 0,
    flackern: 0,
    leben: { min: 1.6, max: 2 },
    schwerkraft: 230,
    widerstand: 0.2,
    wind: 0.3,
    wirbel: 3,
    wirbelTakt: 1,
    boden: 'spritzen',
    spritzer: 'regenspritzer',
  },
  {
    // The billow of an eruption (M7-141): a large white puff born along the jet that swells to twice its size, rises high and
    // cools to blue-grey like the column's puffs – the cloud that stands over the geyser while it blows.
    id: 'dampfschwall',
    form: 'scheibe',
    groesse: { min: 6, max: 10 },
    wachstum: 2.2,
    farben: ['eis.4', 'eis.4', 'eis.3', 'eis.2'],
    deckung: { start: 0.95, ende: 0 },
    emissiv: 0,
    flackern: 0,
    leben: { min: 2.6, max: 3.8 },
    schwerkraft: -8,
    widerstand: 0.8,
    wind: 0.5,
    wirbel: 6,
    wirbelTakt: 0.4,
    boden: 'vergehen',
  },
];

export const PARTICLE_EMITTERS_ORTE: readonly ParticleEmitterInput[] = [
  // Ten puffs a second from the top of the plume, rising 14–22 px/s: the column stands two to three heads over the cone,
  // its puffs overlapping into one body (fewer leave gaps of bare sand between them).
  { id: 'geysir_dampf', art: 'dampf', rate: 10, flaeche: { form: 'kreis', breite: 6, tiefe: 2 }, hoehe: { min: 0, max: 2 }, tempo: { min: 0, max: 2 }, richtung: 0, streuung: 360, steigen: { min: 14, max: 22 } },
  // The eruption (M7-141): a hundred and forty blobs a second out of the vent, straight up – the white pillar of the jet …
  { id: 'geysir_saeule', art: 'geysirkern', rate: 140, flaeche: { form: 'kreis', breite: 3, tiefe: 1 }, hoehe: { min: 0, max: 2 }, tempo: { min: 0, max: 3 }, richtung: 0, streuung: 360, steigen: { min: 125, max: 150 } },
  // … seventy drops a second thrown up with it that fan out and fall back around the cone (a ring of splashes on the sinter) …
  { id: 'geysir_fontaene', art: 'geysirstrahl', rate: 70, flaeche: { form: 'kreis', breite: 4, tiefe: 2 }, hoehe: { min: 0, max: 4 }, tempo: { min: 8, max: 26 }, richtung: 0, streuung: 360, steigen: { min: 115, max: 160 } },
  // … and ten billows a second from the top of the pillar, rising fast: the cloud over the geyser while it blows.
  { id: 'geysir_schwall', art: 'dampfschwall', rate: 10, flaeche: { form: 'kreis', breite: 8, tiefe: 3 }, hoehe: { min: 24, max: 48 }, tempo: { min: 0, max: 4 }, richtung: 0, streuung: 360, steigen: { min: 26, max: 44 } },
  // Two wisps a second from a vent's crack.
  { id: 'dampfspalt_dampf', art: 'dampfhauch', rate: 2, flaeche: { form: 'rechteck', breite: 4, tiefe: 2 }, hoehe: { min: 0, max: 1 }, tempo: { min: 0, max: 1 }, richtung: 0, streuung: 360, steigen: { min: 6, max: 10 } },
];

/**
 * The places' objects that steam: the geyser from the top of its sprite's plume (row 26 of 64 – 36 px over the anchor at row
 * 62, a pixel west of it where the plume's crown stands) in its rhythm (M7-141, see the module comment), a vent from its
 * crack (row 8 of 16 – 6 px over the anchor at row 14) evenly.
 */
export const OBJECT_EMITTERS_ORTE: readonly ObjectEmitterInput[] = [
  {
    objekt: 'ort_geysir',
    emitter: 'geysir_dampf',
    dx: -1,
    hoehe: 36,
    rhythmus: { periode: { min: 24, max: 36 }, anstieg: 4, ausbruch: 6, abklingen: 5, rampe: 0.8, ruhe: 0.3, ausbruchEmitter: ['geysir_saeule', 'geysir_fontaene', 'geysir_schwall'] },
  },
  { objekt: 'ort_dampfspalt', emitter: 'dampfspalt_dampf', dx: 0, hoehe: 6 },
];
