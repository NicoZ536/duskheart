/**
 * Particle sources of the beacons (MASTERPROMPT §8 "Entzünden → die Region heilt sichtbar", §6.2 "Emitter als Daten";
 * docs/SPIEL.md §22 "Partikelsturm", §30 "Neue Emitter als Daten"; strand F, M7-35). Placed by the beacon view
 * (src/render/game/beacons.ts) at the beacon's bowl (60 px above the foot of its sprite; `hoehe` adds to that):
 *
 * - `leuchtfeuer_sturm`: the storm of Lumen motes that climbs out of the bowl while the flame catches and for the first
 *   seconds after (strength from the system's ticks): a turning column, wider and denser than the showcase's `lumen_sturm`
 *   at full strength – the moment the island takes a breath.
 * - `leuchtfeuer_funken`: sparks of the burning beacon, a calm, steady throw (it burns for good, a camp fire flares).
 * - `leuchtfeuer_glut`: embers breathing over the ash once the warden fell (`bereit`) – the bowl waits for the hand.
 */
import type { ParticleEmitterInput } from './schema';

export const PARTICLE_EMITTERS_LEUCHTFEUER: readonly ParticleEmitterInput[] = [
  { id: 'leuchtfeuer_sturm', art: 'lumenfunke', rate: 900, flaeche: { form: 'kreis', breite: 30, tiefe: 12 }, hoehe: { min: 0, max: 4 }, tempo: { min: 8, max: 24 }, richtung: 0, streuung: 50, ausrichtung: 'tangential', steigen: { min: 46, max: 92 } },
  { id: 'leuchtfeuer_funken', art: 'funke', rate: 9, flaeche: { form: 'kreis', breite: 12, tiefe: 5 }, hoehe: { min: 4, max: 12 }, tempo: { min: 3, max: 12 }, richtung: 0, streuung: 360, steigen: { min: 40, max: 80 } },
  { id: 'leuchtfeuer_glut', art: 'glut', rate: 2.5, flaeche: { form: 'kreis', breite: 14, tiefe: 5 }, hoehe: { min: 0, max: 2 }, tempo: { min: 0, max: 4 }, richtung: 0, streuung: 360, steigen: { min: 4, max: 10 } },
];
