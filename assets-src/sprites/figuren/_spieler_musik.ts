/**
 * Die Spielfigur musiziert (M7-31; MASTERPROMPT §11.4 „Musizieren“; Clip `musizieren_<richtung>`): die Hände halten das
 * Instrument vor dem Körper wie eine Blockflöte – die obere Hand am Mund, die untere vor der Brust –, die Finger wandern
 * (die Hände heben und senken sich um 1 px im Wechsel), der Kopf wiegt sich im Takt, der Rumpf atmet zwischen den Phrasen.
 * Vier Bilder, je zweimal gehalten bei 8 fps (Figuren-Takt 8–12 fps, docs/ART.md §4: Haltephasen als wiederholte Frames) – ein
 * Bild alle 0,25 s, ruhiger als Essen und Trinken; die Figur steht still (die Bewegungssperre des Instruments,
 * src/game/instruments). Von hinten sind die Arme vor dem Körper verborgen, nur das Wiegen des Kopfes bleibt. Keine
 * Frame-Events: das Lied spielt die Audio (src/audio/music).
 *
 * Das Instrument trägt die Haupthand als Hand-Layer (M7-77, `ausruestung_floete`, `ausruestung_laute`,
 * `assets-src/sprites/figuren/instrumente.ts`): seine Clips `musizieren_<richtung>` laufen Position für Position mit dem
 * Körper; die Laute zeigt dieselbe Pose (der Hals liegt in der Haupthand am Mund, der Korpus vor der Brust).
 */
import type { Aktion } from './_spieler_aktionen';
import type { Pose } from './_spieler_rig';

const BEINE = { beinR: ['stand'], beinL: ['stand'] } as const satisfies Pick<Pose, 'beinR' | 'beinL'>;

/** [Kopf-Versatz, Hand rechts, Hand links, Rumpf-Versatz] je Bild. */
const TAKT: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 1, 0],
  [1, 1, 0, 0],
  [0, 0, 1, 1],
  [1, 1, 0, 1],
];

const vorn = TAKT.map(([k, r, l, rumpf]): Pose => ({ ...BEINE, kopf: ['auf', 0, k], rumpf: ['normal', 0, rumpf], armR: ['mund', 0, r], armL: ['brust', 0, l] }));
const hinten = TAKT.map(([k, r, l, rumpf]): Pose => ({ ...BEINE, kopf: ['auf', 0, k], rumpf: ['normal', 0, rumpf], armR: ['mund', 0, r], armL: ['brust', 0, l], folge: 'armeHinten' }));

/** Musizieren (Flöte, Laute). */
const musizieren: Aktion = {
  name: 'musizieren',
  fps: 8,
  loop: true,
  folge: [0, 0, 1, 1, 2, 2, 3, 3],
  events: [],
  vorn,
  hinten,
  profil: vorn,
};

/** Die Aktionen des Musizierens (an `AKTIONEN` in `_spieler_aktionen.ts` angehängt). */
export const AKTIONEN_MUSIK: readonly Aktion[] = [musizieren];
