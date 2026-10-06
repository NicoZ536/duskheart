/**
 * Die Spielfigur angelt (M7-24, Strang D; MASTERPROMPT §14 „Angeln“; Clip `angeln_<richtung>`): beide Hände halten den
 * Rutengriff vor dem Bauch – die Haupthand vorn am Griff, die Nebenhand an der Schnurwicklung darüber –, die Rute selbst,
 * ihre Biegung und die Schnur zeichnet `src/render/game/fishing.ts` von der Hand zur Pose (die Haupthand trägt beim Angeln
 * keinen Hand-Layer). Die Hände wippen im Wechsel um 1 px (das Einholen, der Zug des Fischs), Kopf und Rumpf atmen
 * zusammen. Vier Bilder, 4 fps, Schleife; die Figur steht. Von hinten liegen die Arme vor dem Körper verborgen.
 * Keine Frame-Events: Wurf, Biss und Drill klingen über die Ereignisse der Simulation (src/audio/eventMap.ts).
 *
 * Wie `_spieler_musik.ts` an `AKTIONEN` in `_spieler_aktionen.ts` anzuhängen (Strang I übernimmt die Figur, docs/M7-STRAENGE.md);
 * bis dahin fällt die Figur beim Angeln auf `idle` zurück (`playerFigure.ts`, `available`).
 */
import type { Aktion } from './_spieler_aktionen';
import type { Pose } from './_spieler_rig';

const BEINE = { beinR: ['stand'], beinL: ['stand'] } as const satisfies Pick<Pose, 'beinR' | 'beinL'>;

/** [Kopf-Versatz, Hand rechts, Hand links, Rumpf-Versatz] je Bild: Kopf und Rumpf atmen zusammen, die Hände kurbeln im Wechsel. */
const ZUG: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 1, 0],
  [0, 1, 0, 0],
  [1, 0, 1, 1],
  [1, 1, 0, 1],
];

const vorn = ZUG.map(([k, r, l, rumpf]): Pose => ({ ...BEINE, kopf: ['auf', 0, k], rumpf: ['normal', 0, rumpf], armR: ['vor', 0, r], armL: ['brust', 0, l] }));
const hinten = ZUG.map(([k, r, l, rumpf]): Pose => ({ ...BEINE, kopf: ['auf', 0, k], rumpf: ['normal', 0, rumpf], armR: ['vor', 0, r], armL: ['brust', 0, l], folge: 'armeHinten' }));

/** Angeln (Wurf, Warten, Biss, Drill). */
const angeln: Aktion = {
  name: 'angeln',
  fps: 4,
  loop: true,
  folge: [0, 1, 2, 3],
  events: [],
  vorn,
  hinten,
  profil: vorn,
};

/** Die Aktionen des Angelns (an `AKTIONEN` in `_spieler_aktionen.ts` anzuhängen). */
export const AKTIONEN_ANGELN: readonly Aktion[] = [angeln];
