/**
 * Die Spielfigur musiziert (M7-31; MASTERPROMPT §11.4 „Musizieren“; Clip `musizieren_<richtung>`): die Hände halten das
 * Instrument vor dem Körper wie eine Blockflöte – die obere Hand am Mund, die untere vor der Brust –, die Finger wandern
 * (die Hände heben und senken sich um 1 px im Wechsel), der Kopf wiegt sich im Takt, der Rumpf atmet zwischen den Phrasen.
 * Vier Bilder, 4 fps, Schleife – ruhiger als Essen und Trinken; die Figur steht still (die Bewegungssperre des Instruments,
 * src/game/instruments). Von hinten sind die Arme vor dem Körper verborgen, nur das Wiegen des Kopfes bleibt. Keine Frame-Events: das Lied spielt die Audio (src/audio/music).
 *
 * Das Instrument selbst trägt die Figur noch nicht als Hand-Layer (Flöte und Laute sind Rohstoff-Kategorie ohne
 * `ausruestung_<id>`); die Laute zeigt dieselbe Pose.
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
  fps: 4,
  loop: true,
  folge: [0, 1, 2, 3],
  events: [],
  vorn,
  hinten,
  profil: vorn,
};

/** Die Aktionen des Musizierens (an `AKTIONEN` in `_spieler_aktionen.ts` angehängt). */
export const AKTIONEN_MUSIK: readonly Aktion[] = [musizieren];
