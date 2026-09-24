/**
 * Posen-Aufbau der Spielfigur (M3-05 … M3-07): Eine Pose nennt je Körperteil die Variante und den
 * Versatz in px; `bildDerPose` setzt die handgezeichneten Teile aus `_spieler_teile.ts` in der
 * Stapelfolge der Blickrichtung zu einem 32×32-Bild zusammen.
 *
 * Körperrahmen (docs/ART.md §3): 16×24 bei Zelle (8, 8), Füße auf der Ankerzeile 31. Kopf 11 Zeilen,
 * Rumpf 10, Beine 3. Rechts = die Seite der Hand (Waffe/Werkzeug, Sockel `hand`), links = Nebenhand
 * (Licht, Sockel `nebenhand`). Von vorn liegt die rechte Seite links im Bild, von hinten rechts, im
 * Profil nach rechts vorn, nach links hinten.
 */
import { leeresBild, setze, teil, type Bild, type Platz, type Richtung, type Teil } from '../../lib/figure';
import { ARME, BEINE, KOEPFE, RUMPFE, type ArmPose, type BeinPose, type KopfVariante, type RumpfVariante } from './_spieler_teile';

/** Zellgröße und Lage des Körperrahmens in der Zelle. */
export const ZELLE = 32;
export const KOERPER_X = 8;
export const KOERPER_Y = 8;
/** Erste Rumpfzeile und Bodenzeile im Körperrahmen. */
export const RUMPF_Y = 11;
export const BODEN_Y = 23;

/** Teil-Angabe: Variante und Versatz [dx, dy] in px. */
export type Angabe<V extends string> = readonly [V, number?, number?];

export interface Pose {
  readonly kopf?: Angabe<KopfVariante>;
  readonly rumpf?: Angabe<RumpfVariante>;
  /** Rechter Arm (Hand) und linker Arm (Nebenhand); Versatz relativ zur Schulter (folgt dem Rumpf). */
  readonly armR: Angabe<ArmPose>;
  readonly armL: Angabe<ArmPose>;
  /** Rechtes und linkes Bein; Versatz relativ zum Boden. */
  readonly beinR: Angabe<BeinPose>;
  readonly beinL: Angabe<BeinPose>;
  /**
   * Stapelfolge-Ausnahmen: `armeHinten` zeichnet die Arme hinter den Rumpf (von hinten: Arme vor dem
   * Körper; im Profil auch den nahen Arm), `armeHinterKopf` legt sie über den Rumpf, aber hinter den
   * Kopf (erhobene Arme neben dem Kopf), `beineVorn` zeichnet die Beine vor den Rumpf (Knie beim Sitzen).
   */
  readonly folge?: 'armeHinten' | 'armeHinterKopf' | 'beineVorn';
}

/**
 * Schulterpunkte im Körperrahmen je Richtung: [rechter Arm, linker Arm]. Das Profil nach links ist das
 * Spiegelbild des Profils nach rechts mit getauschten Rollen (nah ↔ fern) und nutzt dessen Werte.
 */
const SCHULTER: Readonly<Record<'down' | 'up' | 'right', readonly [readonly [number, number], readonly [number, number]]>> = {
  down: [
    [3, 12],
    [12, 12],
  ],
  up: [
    [12, 12],
    [3, 12],
  ],
  right: [
    [7, 12],
    [6, 12],
  ],
};
/** Hüftpunkte (Drehpunkt der Beinsäule auf der Bodenzeile) je Richtung: [rechtes Bein, linkes Bein]. */
const HUEFTE: Readonly<Record<'down' | 'up' | 'right', readonly [number, number]>> = {
  down: [7, 8],
  up: [8, 7],
  right: [7, 4],
};
/** Spiegelachse des Körperrahmens (16 px breit). */
const SPIEGEL_X = 15;

type Seite = 'r' | 'l';

/** Arm-Raster je Richtung und Seite (vorn/hinten/nah/fern ist in `ARME` schon aufgelöst). */
function armTeil(richtung: Richtung, seite: Seite, pose: ArmPose): Teil {
  const t = ARME[richtung][seite][pose];
  if (t === undefined) throw new Error(`Spieler: Armpose ${pose} fehlt für ${richtung}/${seite}`);
  return t;
}

function beinTeil(richtung: Richtung, seite: Seite, pose: BeinPose): Teil {
  const t = BEINE[richtung][seite][pose];
  if (t === undefined) throw new Error(`Spieler: Beinpose ${pose} fehlt für ${richtung}/${seite}`);
  return t;
}

/**
 * Setzt eine Pose zusammen. Versätze `dx` zählen im Profil nach vorn (nach links also negativ im
 * Bild), damit eine Pose-Tabelle für beide Profile gilt.
 */
export function bildDerPose(richtung: Richtung, pose: Pose): Bild {
  const [kv, kdx = 0, kdy = 0] = pose.kopf ?? ['auf'];
  const [rv, rdx = 0, rdy = 0] = pose.rumpf ?? ['normal'];
  const kopf = KOEPFE[richtung][kv];
  const rumpf = RUMPFE[richtung][rv];
  if (kopf === undefined) throw new Error(`Spieler: Kopf ${kv} fehlt für ${richtung}`);
  if (rumpf === undefined) throw new Error(`Spieler: Rumpf ${rv} fehlt für ${richtung}`);
  const links = richtung === 'left';
  const geo = links ? 'right' : richtung;
  // Nach links spielt der rechte Körperteil die Rolle des fernen (im Profil nach rechts: links).
  const rolle = (s: Seite): 0 | 1 => ((s === 'r') !== links ? 0 : 1);
  const mx = (x: number): number => (links ? SPIEGEL_X - x : x);
  const at = (t: Teil, x: number, y: number): Platz => ({ teil: t, x: KOERPER_X + x, y: KOERPER_Y + y });
  const arm = (seite: Seite): Platz => {
    const [p, dx = 0, dy = 0] = seite === 'r' ? pose.armR : pose.armL;
    const [sx, sy] = SCHULTER[geo][rolle(seite)];
    return at(armTeil(richtung, seite, p), mx(sx + rdx + dx), sy + rdy + dy);
  };
  const bein = (seite: Seite): Platz => {
    const [p, dx = 0, dy = 0] = seite === 'r' ? pose.beinR : pose.beinL;
    return at(beinTeil(richtung, seite, p), mx(HUEFTE[geo][rolle(seite)] + dx), BODEN_Y + dy);
  };
  // Köpfe sind je Richtung eigens gezeichnet (Drehpunkt links oben): nur der Versatz wird gespiegelt.
  const k = at(kopf, links ? -kdx : kdx, kdy);
  const r = at(rumpf, mx(rdx), RUMPF_Y + rdy);
  let folge: readonly Platz[];
  if (richtung === 'down' || richtung === 'up') {
    const [ar, al, br, bl] = [arm('r'), arm('l'), bein('r'), bein('l')];
    folge = {
      normal: [br, bl, r, k, ar, al],
      armeHinten: [ar, al, br, bl, r, k],
      armeHinterKopf: [br, bl, r, ar, al, k],
      beineVorn: [r, br, bl, k, ar, al],
    }[pose.folge ?? 'normal'];
  } else {
    // Profil: fern = die Seite hinter dem Körper (nach rechts: links; nach links: rechts).
    const nah: Seite = links ? 'l' : 'r';
    const fern: Seite = nah === 'r' ? 'l' : 'r';
    const [an, af, bn, bf] = [arm(nah), arm(fern), bein(nah), bein(fern)];
    folge = {
      normal: [af, bf, bn, r, k, an],
      armeHinten: [af, bf, bn, an, r, k],
      armeHinterKopf: [af, bf, bn, r, an, k],
      beineVorn: [af, r, bf, bn, k, an],
    }[pose.folge ?? 'normal'];
  }
  const bild = leeresBild(ZELLE, ZELLE);
  for (const p of folge) setze(bild, p);
  // Hängt der Rumpf tiefer als der Kopf, füllt der Kragen die Halslücke (Welle der Idle-Atmung, M1-22).
  const kragen = teil(rumpf.zeilen[0] ?? '', [rumpf.pivot[0], 0]);
  for (let dy = kdy; dy < rdy; dy++) setze(bild, at(kragen, mx(rdx), RUMPF_Y + dy));
  if (rdy > kdy) setze(bild, k);
  return bild;
}
