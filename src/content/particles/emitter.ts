/**
 * Particle sources (M5-11, M5-21; schema in `schema.ts`). The presentation places them each frame where something
 * emits – a burning tile of the fire simulation, a camp fire, a torch – with a strength 0…1 that scales the rate (a young
 * fire sparks less than a full blaze). Directions: degrees clockwise from east on screen (90 = south, 270 = north);
 * `streuung` 360 = every direction.
 */
import type { ParticleEmitterInput } from './schema';

export const PARTICLE_EMITTER_DATA: readonly ParticleEmitterInput[] = [
  // --- A burning tile of the fire simulation (M4-28 → M5-21): per flame spot, strength by the fire's stage -------------
  { id: 'brand_funken', art: 'funke', rate: 14, flaeche: { form: 'kreis', breite: 10, tiefe: 5 }, hoehe: { min: 4, max: 12 }, tempo: { min: 4, max: 22 }, richtung: 0, streuung: 360, steigen: { min: 55, max: 110 } },
  { id: 'brand_glut', art: 'glut', rate: 3, flaeche: { form: 'kreis', breite: 12, tiefe: 6 }, hoehe: { min: 1, max: 6 }, tempo: { min: 0, max: 8 }, richtung: 0, streuung: 360, steigen: { min: 6, max: 18 } },
  { id: 'brand_rauch', art: 'rauch', rate: 5, flaeche: { form: 'kreis', breite: 10, tiefe: 4 }, hoehe: { min: 12, max: 20 }, tempo: { min: 0, max: 4 }, richtung: 0, streuung: 360, steigen: { min: 10, max: 20 } },
  // --- Placed lights of the player (M3-22): a burning camp fire, a lit torch ---------------------------------------------
  { id: 'lagerfeuer_funken', art: 'funke', rate: 16, flaeche: { form: 'kreis', breite: 6, tiefe: 3 }, hoehe: { min: 3, max: 8 }, tempo: { min: 3, max: 14 }, richtung: 0, streuung: 360, steigen: { min: 50, max: 95 } },
  { id: 'lagerfeuer_rauch', art: 'rauch', rate: 3, flaeche: { form: 'kreis', breite: 4, tiefe: 2 }, hoehe: { min: 10, max: 16 }, tempo: { min: 0, max: 3 }, richtung: 0, streuung: 360, steigen: { min: 9, max: 16 } },
  { id: 'lagerfeuer_glut', art: 'glut', rate: 1.5, flaeche: { form: 'kreis', breite: 8, tiefe: 4 }, hoehe: { min: 1, max: 4 }, tempo: { min: 0, max: 5 }, richtung: 0, streuung: 360, steigen: { min: 5, max: 12 } },
  { id: 'fackel_funken', art: 'funke', rate: 1.4, flaeche: { form: 'kreis', breite: 2, tiefe: 1 }, hoehe: { min: 0, max: 2 }, tempo: { min: 2, max: 10 }, richtung: 0, streuung: 360, steigen: { min: 30, max: 60 } },
  { id: 'fackel_rauch', art: 'fackelrauch', rate: 2.5, flaeche: { form: 'kreis', breite: 1, tiefe: 1 }, hoehe: { min: 4, max: 6 }, tempo: { min: 0, max: 2 }, richtung: 0, streuung: 360, steigen: { min: 8, max: 14 } },
  // --- Night and magic: the showcase of the particle system (scene `partikel`) -------------------------------------------
  // A column of lumen motes: born on a small ellipse, thrown sideways around its centre (a quarter turn clockwise) as they
  // shoot up, so the column turns slowly and widens with its height.
  { id: 'lumen_sturm', art: 'lumenfunke', rate: 1900, flaeche: { form: 'kreis', breite: 44, tiefe: 16 }, hoehe: { min: 0, max: 6 }, tempo: { min: 6, max: 18 }, richtung: 0, streuung: 40, ausrichtung: 'tangential', steigen: { min: 40, max: 76 } },
  { id: 'gluehwuermchen_wiese', art: 'gluehwuermchen', rate: 40, flaeche: { form: 'rechteck', breite: 460, tiefe: 150 }, hoehe: { min: 2, max: 26 }, tempo: { min: 2, max: 10 }, richtung: 0, streuung: 360, steigen: { min: -4, max: 4 } },
];
