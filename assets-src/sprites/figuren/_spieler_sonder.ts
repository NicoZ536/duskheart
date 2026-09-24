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
import { LEER, bildGedreht, bildGespiegelt, bildVerschoben, schneideUnter, teil, type Bild, type Richtung, type Teil } from '../../lib/figure';
import { bildDerPose, KOERPER_X, KOERPER_Y, ZELLE, type Pose } from './_spieler_rig';

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

/** Um `viertel` × 90° im Uhrzeigersinn gedreht und auf den Boden gestellt (Mitte der Zelle). */
function gedreht(b: Bild, viertel: number, hub: number): Bild {
  let out = b;
  for (let i = 0; i < viertel; i++) out = bildGedreht(out, true, ZELLE - 1 - hub, ZELLE / 2);
  return out;
}

/**
 * Roll-Frame `phase` (0–2). Profil: die geduckte Figur überschlägt sich in Rollrichtung (verlustfreie
 * 90°-Drehungen: Kopf vorn, unten, hinten). Von vorn/hinten: eingerollt (Haar voraus), kopfüber
 * (Rücken bzw. Bauch sichtbar), wieder eingerollt. Nach links: Spiegelbild der Rolle nach rechts.
 */
export function rollBild(richtung: Richtung, phase: number): Bild {
  if (richtung === 'left') return bildGespiegelt(rollBild('right', phase));
  if (richtung === 'right') return gedreht(bildDerPose('right', ROLL_HOCKE), phase + 1, phase === 0 ? 1 : 0);
  const gegen: Richtung = richtung === 'down' ? 'up' : 'down';
  if (phase === 1) return gedreht(bildDerPose(gegen, ROLL_HOCKE), 2, 0);
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
  const stehend = bildDerPose(richtung, pose);
  return bildGedreht(stehend, richtung !== 'down', ZELLE - 1 - hub, KOERPER_X + 8);
}
