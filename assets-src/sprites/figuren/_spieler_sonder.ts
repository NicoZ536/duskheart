/**
 * Sonderposen der Spielfigur, die sich nicht aus stehenden Teilen setzen lassen (M3-05/M3-06):
 * - **Schwimmen:** Die Figur sinkt ein; unterhalb der Wasserlinie wird der Körper abgeschnitten
 *   (Clip-Variante `swim_<richtung>`), um den Körper liegt ein Wellenring aus Gischt (`w`), der mit dem
 *   Schwimmzug wächst. Die Wasserlinie steht zusätzlich als Sockel `wasserlinie` im Sprite, damit der
 *   Renderer später seine Eintauchmaske daran ausrichten kann (M5-08).
 * - **Rolle:** im Profil überschlägt sich die geduckte Figur (verlustfreie 90°-Drehungen in
 *   Rollrichtung); von vorn und hinten rollt sie sich ein (Haar voraus) und steht kurz kopfüber.
 * - **Liegen** (Schlafen, Tod): eine stehende Pose, verlustfrei um 90° gedreht und auf den Boden gelegt.
 */
import { LEER, bildGespiegelt, bildVerschoben, leeresBild, schneideUnter, teil, type Bild, type Richtung, type Teil } from '../../lib/figure';
import { bildDerPose, bildDerPoseBezug, KOERPER_X, KOERPER_Y, mitFrisur, ZELLE, type Pose } from './_spieler_rig';

// ---------------------------------------------------------------------------------------------
// Schwimmen
// ---------------------------------------------------------------------------------------------

/** Einsinktiefe beim Schwimmen (px) und Wasserlinie im Körperrahmen (vor dem Einsinken: Brust). */
export const SCHWIMM_TIEFE = 5;
const BRUST_Y = 15;
/** Wasserlinie in Zellkoordinaten: darunter ist die Figur verborgen. */
export const WASSERLINIE_Y = KOERPER_Y + BRUST_Y + SCHWIMM_TIEFE;

/** Wellenringe um den Schwimmer (klein, mittel, groß); die Mitte liegt auf der Wasserlinie. */
const RINGE: readonly Teil[] = [
  `....wwwwwwww....
   .www........www.
   w..............w
   .www........www.
   ....wwwwwwww....`,
  `....wwwwwwwwww....
   .www..........www.
   w................w
   .www..........www.
   ....wwwwwwwwww....`,
  `.....wwwwwwwwww.....
   ..www..........www..
   ww................ww
   ..www..........www..
   .....wwwwwwwwww.....`,
].map((r) => {
  const t = teil(r);
  return { ...t, pivot: [t.w / 2, 2] as const };
});

/** Setzt ein Teil nur auf leere Pixel (der Ring liegt hinter dem Körper, vor ihm nur unten). */
function setzeHinter(bild: Bild, t: Teil, x: number, y: number): void {
  t.zeilen.forEach((zeile, ty) => {
    [...zeile].forEach((c, tx) => {
      const px = x - t.pivot[0] + tx;
      const py = y - t.pivot[1] + ty;
      if (c === LEER || px < 0 || py < 0 || px >= bild.w || py >= bild.h) return;
      if ((bild.pixel[py * bild.w + px] ?? LEER) === LEER) bild.pixel[py * bild.w + px] = c;
    });
  });
}

/** Schwimm-Frame: Pose (schon eingesunken), Schnitt an der Wasserlinie, Wellenring `ring` (0–2). */
export function schwimmBild(richtung: Richtung, pose: Pose, ring: number): Bild {
  const bild = bildDerPose(richtung, pose);
  schneideUnter(bild, WASSERLINIE_Y);
  const t = RINGE[ring];
  if (t === undefined) throw new Error(`Spieler: Wellenring ${ring} fehlt`);
  setzeHinter(bild, t, ZELLE / 2, WASSERLINIE_Y);
  return bild;
}

// ---------------------------------------------------------------------------------------------
// Rolle
// ---------------------------------------------------------------------------------------------

/** Hocke, aus der sich die Figur abrollt (Kopf eingezogen, Arme vor). */
const ROLL_HOCKE: Pose = { kopf: ['auf', 0, 4], rumpf: ['normal', 0, 3], armR: ['vor'], armL: ['vor'], beinR: ['hocke'], beinL: ['hocke'] };
/** Eingerollt von vorn bzw. hinten: nur Haar und Rücken sind zu sehen. */
const ROLL_TUCK: Pose = { ...ROLL_HOCKE, kopf: ['nacken', 0, 5] };

// ---------------------------------------------------------------------------------------------
// Drehen nach dem Umriss des Körpers
// ---------------------------------------------------------------------------------------------

/** Pixelpunkt nach einer 90°-Drehung (`cw` im Uhrzeigersinn) eines Bildes w × h. */
function dreh(b: Bild, cw: boolean, x: number, y: number): [number, number] {
  return cw ? [b.h - 1 - y, x] : [y, b.w - 1 - x];
}

/**
 * Verschiebung, die das um 90° gedrehte Bild `bezug` mit der untersten deckenden Zeile auf `boden` stellt und waagerecht um
 * `mitteX` zentriert (wie `bildGedreht` aus lib/figure.ts).
 */
function drehVersatz(bezug: Bild, cw: boolean, boden: number, mitteX: number): [number, number] | null {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < bezug.h; y++) {
    for (let x = 0; x < bezug.w; x++) {
      if ((bezug.pixel[y * bezug.w + x] ?? LEER) === LEER) continue;
      const [nx, ny] = dreh(bezug, cw, x, y);
      x0 = Math.min(x0, nx);
      x1 = Math.max(x1, nx);
      y1 = Math.max(y1, ny);
    }
  }
  return Number.isFinite(x0) ? [mitteX - Math.floor((x0 + x1 + 1) / 2), boden - y1] : null;
}

/** `b` um 90° gedreht und um `versatz` verschoben (Pixel und Sockel); ohne Versatz leer. */
function gedrehtUm(b: Bild, cw: boolean, versatz: readonly [number, number] | null): Bild {
  const out = leeresBild(b.h, b.w);
  if (versatz === null) return out;
  const [dx, dy] = versatz;
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const c = b.pixel[y * b.w + x] ?? LEER;
      if (c === LEER) continue;
      const [nx, ny] = dreh(b, cw, x, y);
      const tx = nx + dx;
      const ty = ny + dy;
      if (tx >= 0 && ty >= 0 && tx < out.w && ty < out.h) out.pixel[ty * out.w + tx] = c;
    }
  }
  for (const [name, [x, y]] of Object.entries(b.sockel)) {
    const [nx, ny] = dreh(b, cw, x, y);
    out.sockel[name] = [nx + dx, ny + dy];
  }
  return out;
}

/**
 * Eine stehende Pose, `viertel`-mal um 90° gedreht (`cw`) und jedes Mal auf `boden` gestellt und um `mitteX` zentriert – nach
 * dem Umriss des Körpers ohne Frisur (`bildDerPoseBezug`, M7-54): Haare, die über den Kopf hinausreichen, liegen danach auf
 * denselben Pixeln wie im Körper-Frame, statt die Figur zu verschieben. Ohne Frisur ist das genau `bildGedreht` aus
 * lib/figure.ts.
 */
function gedrehtePose(richtung: Richtung, pose: Pose, viertel: number, cw: boolean, boden: number, mitteX: number): Bild {
  let out = bildDerPose(richtung, pose);
  let bezug = mitFrisur() ? bildDerPoseBezug(richtung, pose) : out;
  for (let i = 0; i < viertel; i++) {
    const versatz = drehVersatz(bezug, cw, boden, mitteX);
    const neu = gedrehtUm(out, cw, versatz);
    bezug = bezug === out ? neu : gedrehtUm(bezug, cw, versatz);
    out = neu;
  }
  return out;
}

/**
 * Roll-Frame `phase` (0–2). Profil: die geduckte Figur überschlägt sich in Rollrichtung (verlustfreie
 * 90°-Drehungen: Kopf vorn, unten, hinten). Von vorn/hinten: eingerollt (Haar voraus), kopfüber
 * (Rücken bzw. Bauch sichtbar), wieder eingerollt. Nach links: Spiegelbild der Rolle nach rechts.
 */
export function rollBild(richtung: Richtung, phase: number): Bild {
  if (richtung === 'left') return bildGespiegelt(rollBild('right', phase));
  if (richtung === 'right') return gedrehtePose('right', ROLL_HOCKE, phase + 1, true, ZELLE - 1 - (phase === 0 ? 1 : 0), ZELLE / 2);
  const gegen: Richtung = richtung === 'down' ? 'up' : 'down';
  if (phase === 1) return gedrehtePose(gegen, ROLL_HOCKE, 2, true, ZELLE - 1, ZELLE / 2);
  const tuck = bildDerPose(richtung, ROLL_TUCK);
  return phase === 0 ? tuck : bildVerschoben(tuck, 0, -1);
}

// ---------------------------------------------------------------------------------------------
// Liegen
// ---------------------------------------------------------------------------------------------

/**
 * Liegende Figur aus einer stehenden Pose: von vorn gegen den Uhrzeigersinn (Rückenlage, Kopf links),
 * sonst im Uhrzeigersinn (Kopf in Blickrichtung bzw. rechts); nach links gespiegelt. `hub` hebt die
 * Figur beim Aufprall um 1 px (Nachfedern).
 */
export function liegeBild(richtung: Richtung, pose: Pose, hub = 0): Bild {
  if (richtung === 'left') return bildGespiegelt(liegeBild('right', pose, hub));
  return gedrehtePose(richtung, pose, 1, richtung !== 'down', ZELLE - 1 - hub, KOERPER_X + 8);
}
