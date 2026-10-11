/**
 * Posen-Aufbau der Spielfigur (M3-05 … M3-07): Eine Pose nennt je Körperteil die Variante und den
 * Versatz in px; `bildDerPose` setzt die handgezeichneten Teile aus `_spieler_teile.ts` in der
 * Stapelfolge der Blickrichtung zu einem 32×32-Bild zusammen.
 *
 * Körperrahmen (docs/ART.md §3): 16×24 bei Zelle (8, 8), Füße auf der Ankerzeile 31. Kopf 11 Zeilen,
 * Rumpf 10, Beine 3. Rechts = die Seite der Hand (Waffe/Werkzeug, Sockel `hand`), links = Nebenhand
 * (Licht, Sockel `nebenhand`). Von vorn liegt die rechte Seite links im Bild, von hinten rechts, im
 * Profil nach rechts vorn, nach links hinten.
 *
 * Erweiterungen (M6-10, M6-12): Die Kampfposen der Arme (`_spieler_kampf_teile.ts`) ergänzen die Armtabelle, und
 * `mitUmzeichnung` setzt jede Pose mit umgezeichneten Teilen zusammen – so entstehen die Rüstungs-Layer aus
 * denselben Posen wie der Körper (`assets-src/sprites/ausruestung/_ruestung.ts`): ein Teil, das die Umzeichnung
 * ändert, verdeckt und wird verdeckt wie im Körper-Frame.
 *
 * Körperformen und Frisuren (M7-53, M7-54; docs/SPIEL.md §26): `mitFigur` setzt jede Pose in einer Körperform zusammen
 * (`schmal`, `mittel` = die Figur bis M6, `kraeftig`; `_spieler_formen.ts`: eigener Rumpf je Form, die Schultern – und mit
 * ihnen Arme, Hand-Sockel und alles in den Händen – rücken mit der Rumpfbreite) und optional mit einer Frisur (`KopfStil`:
 * der Kopf je Richtung und Variante mit den Haaren der Frisur). Beine, Kopf und Kopf-Sockel bleiben in jeder Form gleich.
 * Ohne `mitFigur` gilt die M6-Figur (`mittel`, der gezeichnete Kopf) – auch für den Strandräuber aus diesem Rig.
 */
import { leeresBild, setze, teil, type Bild, type Platz, type Richtung, type Teil } from '../../lib/figure';
import { KAMPF_ARME, type KampfArmPose } from './_spieler_kampf_teile';
import { RUMPFE_FORM, SCHULTER_FORM, type KoerperForm } from './_spieler_formen';
import { ARME, BEINE, KOEPFE, type ArmPose, type BeinPose, type KopfVariante, type RumpfVariante } from './_spieler_teile';

/** Zellgröße und Lage des Körperrahmens in der Zelle. */
export const ZELLE = 32;
export const KOERPER_X = 8;
export const KOERPER_Y = 8;
/** Erste Rumpfzeile und Bodenzeile im Körperrahmen. */
export const RUMPF_Y = 11;
export const BODEN_Y = 23;

/** Teil-Angabe: Variante und Versatz [dx, dy] in px. */
export type Angabe<V extends string> = readonly [V, number?, number?];

/** Armposen: die des Alltags (`_spieler_teile.ts`) und die des Kampfs (`_spieler_kampf_teile.ts`). */
export type ArmPoseAlle = ArmPose | KampfArmPose;

/** Welches Körperteil eine Umzeichnung gerade bekommt. */
export interface TeilInfo {
  readonly art: 'kopf' | 'rumpf' | 'arm' | 'bein';
  readonly richtung: Richtung;
  /** Variante bzw. Pose des Teils (`auf`, `normal`, `hoch`, `stand` …). */
  readonly variante: string;
  /** Körperseite von Arm und Bein (r = Hand, l = Nebenhand). */
  readonly seite?: 'r' | 'l';
}

/** Zeichnet ein Teil um (Rüstungs-Layer); ein unverändertes Teil gibt sie unverändert zurück. */
export type TeilUmzeichnung = (t: Teil, info: TeilInfo) => Teil;

let umzeichnung: TeilUmzeichnung | null = null;

/**
 * Frisur des Kopfes (M7-54): der gezeichnete Kopf `t` der Richtung und Variante mit den Haaren einer Frisur – ein größeres
 * Teil, wenn Haare über den Kopf hinausreichen; Drehpunkt und Punkte (`kopf`, `last`) sitzen dabei auf denselben Pixeln des
 * Kopfes wie im gezeichneten Teil.
 */
export type KopfStil = (t: Teil, richtung: Richtung, variante: KopfVariante) => Teil;

/** Körperform und Frisur, in der `bildDerPose` gerade zusammensetzt (`mitFigur`). */
let figurForm: KoerperForm = 'mittel';
let kopfStil: KopfStil | null = null;
let inFigur = false;

/**
 * Führt `f` aus, während jede Pose in der Körperform `form` und mit der Frisur `kopf` (null: der gezeichnete Kopf) entsteht
 * (nicht verschachtelbar; mit `mitUmzeichnung` kombinierbar).
 */
export function mitFigur<T>(figur: { readonly form: KoerperForm; readonly kopf?: KopfStil | null }, f: () => T): T {
  if (inFigur) throw new Error('Spieler: Körperformen lassen sich nicht verschachteln');
  inFigur = true;
  figurForm = figur.form;
  kopfStil = figur.kopf ?? null;
  try {
    return f();
  } finally {
    inFigur = false;
    figurForm = 'mittel';
    kopfStil = null;
  }
}

/** Ob gerade eine Frisur den Kopf ersetzt (die Sonderposen drehen dann nach dem Umriss ohne Frisur, `bildDerPoseBezug`). */
export function mitFrisur(): boolean {
  return kopfStil !== null;
}

/**
 * Dieselbe Pose ohne Frisur und ohne Umzeichnung in der aktuellen Körperform – der Körper-Frame, nach dessen Umriss die
 * Sonderposen (Liegen, Rolle) drehen: eine Frisur, die über den Kopf hinausreicht, verschiebt die Drehung nicht gegen den
 * Körper (die Haare landen auf denselben Pixeln wie ohne sie).
 */
export function bildDerPoseBezug(richtung: Richtung, pose: Pose): Bild {
  const u = umzeichnung;
  const k = kopfStil;
  umzeichnung = null;
  kopfStil = null;
  try {
    return bildDerPose(richtung, pose);
  } finally {
    umzeichnung = u;
    kopfStil = k;
  }
}

/** Führt `f` aus, während jede Pose ihre Teile durch `u` umgezeichnet zusammensetzt (nicht verschachtelbar). */
export function mitUmzeichnung<T>(u: TeilUmzeichnung, f: () => T): T {
  if (umzeichnung !== null) throw new Error('Spieler: Umzeichnungen lassen sich nicht verschachteln');
  umzeichnung = u;
  try {
    return f();
  } finally {
    umzeichnung = null;
  }
}

function umgezeichnet(t: Teil, info: TeilInfo): Teil {
  return umzeichnung === null ? t : umzeichnung(t, info);
}

export interface Pose {
  readonly kopf?: Angabe<KopfVariante>;
  readonly rumpf?: Angabe<RumpfVariante>;
  /** Rechter Arm (Hand) und linker Arm (Nebenhand); Versatz relativ zur Schulter (folgt dem Rumpf). */
  readonly armR: Angabe<ArmPoseAlle>;
  readonly armL: Angabe<ArmPoseAlle>;
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

/** Hüftpunkte (Drehpunkt der Beinsäule auf der Bodenzeile) je Richtung: [rechtes Bein, linkes Bein]. */
const HUEFTE: Readonly<Record<'down' | 'up' | 'right', readonly [number, number]>> = {
  down: [7, 8],
  up: [8, 7],
  right: [7, 4],
};
/** Spiegelachse des Körperrahmens (16 px breit). */
const SPIEGEL_X = 15;

type Seite = 'r' | 'l';

/** Arm-Raster je Richtung und Seite (vorn/hinten/nah/fern ist in `ARME` und `KAMPF_ARME` schon aufgelöst). */
function armTeil(richtung: Richtung, seite: Seite, pose: ArmPoseAlle): Teil {
  const t = ARME[richtung][seite][pose as ArmPose] ?? KAMPF_ARME[richtung][seite][pose as KampfArmPose];
  if (t === undefined) throw new Error(`Spieler: Armpose ${pose} fehlt für ${richtung}/${seite}`);
  return umgezeichnet(t, { art: 'arm', richtung, variante: pose, seite });
}

function beinTeil(richtung: Richtung, seite: Seite, pose: BeinPose): Teil {
  const t = BEINE[richtung][seite][pose];
  if (t === undefined) throw new Error(`Spieler: Beinpose ${pose} fehlt für ${richtung}/${seite}`);
  return umgezeichnet(t, { art: 'bein', richtung, variante: pose, seite });
}

/**
 * Setzt eine Pose zusammen. Versätze `dx` zählen im Profil nach vorn (nach links also negativ im
 * Bild), damit eine Pose-Tabelle für beide Profile gilt.
 */
export function bildDerPose(richtung: Richtung, pose: Pose): Bild {
  const [kv, kdx = 0, kdy = 0] = pose.kopf ?? ['auf'];
  const [rv, rdx = 0, rdy = 0] = pose.rumpf ?? ['normal'];
  const kopfGezeichnet = KOEPFE[richtung][kv];
  const rumpfRoh = RUMPFE_FORM[figurForm][richtung][rv];
  if (kopfGezeichnet === undefined) throw new Error(`Spieler: Kopf ${kv} fehlt für ${richtung}`);
  if (rumpfRoh === undefined) throw new Error(`Spieler: Rumpf ${rv} fehlt für ${richtung}`);
  const kopfRoh = kopfStil === null ? kopfGezeichnet : kopfStil(kopfGezeichnet, richtung, kv);
  const kopf = umgezeichnet(kopfRoh, { art: 'kopf', richtung, variante: kv });
  const rumpf = umgezeichnet(rumpfRoh, { art: 'rumpf', richtung, variante: rv });
  const links = richtung === 'left';
  const geo = links ? 'right' : richtung;
  // Nach links spielt der rechte Körperteil die Rolle des fernen (im Profil nach rechts: links).
  const rolle = (s: Seite): 0 | 1 => ((s === 'r') !== links ? 0 : 1);
  const mx = (x: number): number => (links ? SPIEGEL_X - x : x);
  const at = (t: Teil, x: number, y: number): Platz => ({ teil: t, x: KOERPER_X + x, y: KOERPER_Y + y });
  const arm = (seite: Seite): Platz => {
    const [p, dx = 0, dy = 0] = seite === 'r' ? pose.armR : pose.armL;
    const [sx, sy] = SCHULTER_FORM[figurForm][geo][rolle(seite)];
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
