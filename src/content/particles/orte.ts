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
 * - `geysir_dampf`: the column over a geyser's vent – a dense stream of puffs from the rounded top of the sprite's plume,
 *   as wide as it, so the column grows out of the drawn jet without a seam.
 * - `dampfspalt_dampf`: a vent's wisps, a few a second from the crack.
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
];

export const PARTICLE_EMITTERS_ORTE: readonly ParticleEmitterInput[] = [
  // Ten puffs a second from the top of the plume, rising 14–22 px/s: the column stands two to three heads over the cone,
  // its puffs overlapping into one body (fewer leave gaps of bare sand between them).
  { id: 'geysir_dampf', art: 'dampf', rate: 10, flaeche: { form: 'kreis', breite: 6, tiefe: 2 }, hoehe: { min: 0, max: 2 }, tempo: { min: 0, max: 2 }, richtung: 0, streuung: 360, steigen: { min: 14, max: 22 } },
  // Two wisps a second from a vent's crack.
  { id: 'dampfspalt_dampf', art: 'dampfhauch', rate: 2, flaeche: { form: 'rechteck', breite: 4, tiefe: 2 }, hoehe: { min: 0, max: 1 }, tempo: { min: 0, max: 1 }, richtung: 0, streuung: 360, steigen: { min: 6, max: 10 } },
];

/**
 * The places' objects that steam: the geyser from the top of its sprite's plume (row 26 of 64 – 36 px over the anchor at row
 * 62, a pixel west of it where the plume's crown stands), a vent from its crack (row 8 of 16 – 6 px over the anchor at row 14).
 */
export const OBJECT_EMITTERS_ORTE: readonly ObjectEmitterInput[] = [
  { objekt: 'ort_geysir', emitter: 'geysir_dampf', dx: -1, hoehe: 36 },
  { objekt: 'ort_dampfspalt', emitter: 'dampfspalt_dampf', dx: 0, hoehe: 6 },
];
