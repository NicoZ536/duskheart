/**
 * Kampfposen der Arme (M6-10, MASTERPROMPT §4.5 „Angriff je Waffenklasse 4–6 … mit Smear-Frames“): handgezeichnete
 * Arm-Raster, die `_spieler_rig.ts` neben den Alltagsposen aus `_spieler_teile.ts` kennt. Gleiche Zeichen und
 * Konventionen wie dort: rechter Arm von vorn (liegt links im Bild, Drehpunkt = Schulter innen oben), naher Arm im
 * Profil nach rechts (Drehpunkt = Schulter hinten oben); links, hinten und der ferne Arm entstehen durch Spiegeln und
 * die Schatten-Umfärbung.
 *
 * - `stoss`: Stoß-Smear – der Arm schnellt gestreckt nach vorn, eine helle Bewegungsspur (`T`) läuft den Unterarm
 *   entlang (von vorn: zum Betrachter, verkürzt mit Spur an der Innenkante).
 * - `deckung`: Deckung – von vorn liegt der Unterarm waagerecht vor der Brust (die Waffe quer), im Profil steht er
 *   senkrecht vor dem Gesicht.
 * - `hieb`: waagerechter Hieb-Smear von vorn – der Arm fegt über die Brust, die helle Spur liegt als Bogen über dem Arm.
 * - `quer`: der Arm quer vor dem Körper bis über die andere Seite hinaus (nur von vorn/hinten). Von hinten liegt er hinter
 *   dem Rumpf (`armeHinten`): sichtbar bleiben Unterarm, Faust und Spur jenseits der Silhouette – der Hieb von hinten.
 * - `strecken`: im Profil der ruhig nach vorn gestreckte Arm in Schulterhöhe ohne Spur (Bogenarm, Armbrust im Anschlag).
 * - `ueberkopf` (nur von hinten, M6-Gate): der Hieb nach Norden – der Arm über dem Kopf wie `hoch` (`_spieler_teile.ts`),
 *   die Klinge zeigt vom Betrachter weg über den Kopf und trägt ihren Schmierbogen (`_waffe.ts`: Lage `schmierHinten`).
 *   Quer vor dem Körper (`quer`) lag die Klinge waagerecht auf Brusthöhe: ein Hieb nach Norden las sich als Schlag nach
 *   Westen.
 */
import { gespiegelt, teil, umgezeichnet, type Richtung, type Teil } from '../../lib/figure';
import { ARME } from './_spieler_teile';

/** Die Kampfposen der Arme. */
export type KampfArmPose = 'stoss' | 'deckung' | 'hieb' | 'quer' | 'strecken' | 'ueberkopf';

type KampfArmSatz = Readonly<Partial<Record<KampfArmPose, Teil>>>;

const KAMPF_VORN: KampfArmSatz = {
  stoss: teil(
    `.kk...
     ktbk..
     ktTbk.
     .ktTbk
     ..kSSk
     ..khmk
     ...kk.`,
    [2, 0],
  ),
  deckung: teil(
    `.kk....
     ktbkkk.
     kttTSSk
     .kkkmhk
     ....kk.`,
    [2, 0],
  ),
  hieb: teil(
    `....kkkk..
     .kkkTTTTk.
     ktbkkkkkTk
     kttttttSSk
     .kkkkkkmhk
     .......kk.`,
    [2, 1],
  ),
  quer: teil(
    `.....kkkkkkkkk..
     .kkkkTTTTTTTTTk.
     ktbkkkkkkkkkkkTk
     kttttttttttttSSk
     .kkkkkkkkkkkkmhk
     .............kk.`,
    [2, 1],
  ),
};

const KAMPF_NAH: KampfArmSatz = {
  stoss: teil(
    `ktTk.......
     ktTtkkkkkk.
     .ktTTTTTSSk
     ..kkkkkkmHk
     ........kk.`,
    [0, 0],
  ),
  deckung: teil(
    `......kk.
     .....kSHk
     .....kmSk
     ....ktTk.
     ktTkkTk..
     ktTtTk...
     .ktTk....
     ..kk.....`,
    [0, 4],
  ),
  hieb: teil(
    `.....kkk...
     ....kTTTk..
     ktTk.kkkTk.
     ktTtkkkkkTk
     .ktTTTTTSSk
     ..kkkkkkmHk
     ........kk.`,
    [0, 2],
  ),
  strecken: teil(
    `ktTk.......
     ktTtkkkkkk.
     .kttTTttSSk
     ..kkkkkkmHk
     ........kk.`,
    [0, 0],
  ),
};

/** Ferner Arm im Profil: eine Stufe dunkler (wie `_spieler_teile.ts`), Marke = Nebenhand. */
const FERN_UMFAERBUNG: Readonly<Record<string, string>> = { t: 'b', T: 't', S: 'm', H: 'n', h: 'n' };

function satz(s: KampfArmSatz, f: (t: Teil) => Teil): KampfArmSatz {
  const out: Partial<Record<KampfArmPose, Teil>> = {};
  for (const [k, v] of Object.entries(s) as Array<[KampfArmPose, Teil]>) out[k] = f(v);
  return out;
}

const KAMPF_FERN = satz(KAMPF_NAH, (t) => umgezeichnet(t, FERN_UMFAERBUNG));

/** Der erhobene Waffenarm (`hoch`) einer Richtung: das Raster des Hiebs über den Kopf (`ueberkopf`). */
function armHoch(r: Richtung): Teil {
  const t = ARME[r].r.hoch;
  if (t === undefined) throw new Error(`Spieler: Armpose hoch fehlt für ${r}`);
  return t;
}

/** Kampfposen je Richtung und Körperseite (r = Hand, l = Nebenhand), aufgelöst wie `ARME`. */
export const KAMPF_ARME: Readonly<Record<Richtung, { readonly r: KampfArmSatz; readonly l: KampfArmSatz }>> = {
  down: { r: KAMPF_VORN, l: satz(KAMPF_VORN, (t) => gespiegelt(t)) },
  up: { r: { ...satz(KAMPF_VORN, (t) => gespiegelt(t, false)), ueberkopf: armHoch('up') }, l: satz(satz(KAMPF_VORN, (t) => gespiegelt(t)), (t) => gespiegelt(t, false)) },
  right: { r: KAMPF_NAH, l: KAMPF_FERN },
  left: { r: satz(KAMPF_FERN, (t) => gespiegelt(t)), l: satz(KAMPF_NAH, (t) => gespiegelt(t)) },
};
