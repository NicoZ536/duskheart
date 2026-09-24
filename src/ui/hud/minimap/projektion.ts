/**
 * Geometrie der Minimap und des Kompassbalkens (M3-28): Zoomstufen, das auf ganze Kartenpunkte gerastete
 * Zentrum, Marker-Projektion auf die runde Karte (Marker außerhalb werden auf den Rand gezogen) und die
 * Peilung für den Kompassbalken. Rein und ohne DOM – `tests/unit/ui/minimap-projektion.test.ts`.
 *
 * Koordinaten: Welt in Kacheln (x nach Osten, y nach Süden), Karte in Punkten relativ zur Mitte (dieselben
 * Achsen), Peilung in Grad im Uhrzeigersinn ab Norden (0 = N, 90 = O, 180 = S, 270 = W).
 */

/** Kacheln je Kartenpunkt der Zoomstufen 0 (nah) … 3 (weit). */
export const ZOOM_FELDER_JE_PUNKT = [0.5, 1, 2, 4] as const;
export type ZoomStufe = 0 | 1 | 2 | 3;
/** Zoomstufe beim Start: ein Punkt je Kachel. */
export const ZOOM_STANDARD: ZoomStufe = 1;
/** Nächste und weiteste Stufe. */
export const ZOOM_NAH: ZoomStufe = 0;
export const ZOOM_WEIT: ZoomStufe = 3;

const VOLLKREIS = 360;
const HALBKREIS = 180;
const ACHTEL = 45;
const RICHTUNGEN = 8;

/** Zoomstufe aus einer beliebigen Zahl (gerundet und auf 0…3 begrenzt). */
export function zoomStufe(n: number): ZoomStufe {
  const r = Math.round(Number.isFinite(n) ? n : ZOOM_STANDARD);
  return Math.min(ZOOM_WEIT, Math.max(ZOOM_NAH, r)) as ZoomStufe;
}

/** Kacheln je Punkt einer Zoomstufe. */
export function felderJePunkt(z: ZoomStufe): number {
  return ZOOM_FELDER_JE_PUNKT[z];
}

/**
 * Das Kartenzentrum, auf ganze Kartenpunkte gerastet: Die Karte rollt in ganzen Punkten und jeder Punkt
 * zeigt immer dieselben Kacheln (kein Flimmern der verkleinerten Stufen beim Laufen).
 */
export function kartenZentrum(felder: number, fjp: number): number {
  return Math.floor(felder / fjp) * fjp;
}

/** Versatz [Punkte] einer Weltposition `felder` [Kacheln] vom gerasterten Zentrum `zentrum`. */
export function kartenVersatz(felder: number, zentrum: number, fjp: number): number {
  return Math.floor((felder - zentrum) / fjp);
}

/** Ob der Punkt (dx, dy) in der runden Karte mit Radius `r` liegt (Pixelkreis ohne Zacken: d² ≤ r² + r). */
export function imKreis(dx: number, dy: number, r: number): boolean {
  return dx * dx + dy * dy <= r * r + r;
}

/** Ergebnis einer Projektion auf die Karte. */
export interface MarkerPunkt {
  /** Versatz von der Kartenmitte [Punkte]. */
  x: number;
  y: number;
  /** Der Marker liegt außerhalb und wurde auf den Rand gezogen. */
  amRand: boolean;
}

export function neuerMarkerPunkt(): MarkerPunkt {
  return { x: 0, y: 0, amRand: false };
}

/**
 * Projiziert einen Marker an Weltposition (mx, my) [Kacheln] auf die Karte um das Spielerzentrum (zx, zy)
 * [Kacheln] mit `fjp` Kacheln je Punkt. Liegt er außerhalb des Radius `rand`, wird er entlang seiner
 * Richtung auf den Rand gezogen (`amRand`) – so zeigt die Karte auch ferne Marker an.
 */
export function projiziereMarker(mx: number, my: number, zx: number, zy: number, fjp: number, rand: number, out: MarkerPunkt): MarkerPunkt {
  const dx = kartenVersatz(mx, kartenZentrum(zx, fjp), fjp);
  const dy = kartenVersatz(my, kartenZentrum(zy, fjp), fjp);
  if (imKreis(dx, dy, rand)) {
    out.x = dx;
    out.y = dy;
    out.amRand = false;
    return out;
  }
  const laenge = Math.sqrt(dx * dx + dy * dy);
  let s = rand / laenge;
  let x = Math.round(dx * s);
  let y = Math.round(dy * s);
  // Rundung kann einen Punkt über den Kreis schieben: so lange nach innen, bis er darin liegt.
  while (!imKreis(x, y, rand)) {
    s *= (rand - 0.5) / rand;
    x = Math.round(dx * s);
    y = Math.round(dy * s);
  }
  out.x = x;
  out.y = y;
  out.amRand = true;
  return out;
}

/** Normiert einen Winkel auf [0, 360). */
export function normiereGrad(grad: number): number {
  const g = grad % VOLLKREIS;
  return g < 0 ? g + VOLLKREIS : g;
}

/** Peilung [Grad, 0 = Norden, im Uhrzeigersinn] von (zx, zy) nach (mx, my) (Kacheln, y nach Süden). */
export function peilung(zx: number, zy: number, mx: number, my: number): number {
  return normiereGrad((Math.atan2(mx - zx, -(my - zy)) * HALBKREIS) / Math.PI);
}

/** Himmelsrichtung 0…7 (N, NO, O, SO, S, SW, W, NW) einer Peilung. */
export function himmelsrichtung(grad: number): number {
  return Math.round(normiereGrad(grad) / ACHTEL) % RICHTUNGEN;
}

/** Winkel von `blick` nach `grad` im Bereich (−180, 180]. */
export function relativerWinkel(grad: number, blick: number): number {
  const d = normiereGrad(grad - blick);
  return d > HALBKREIS ? d - VOLLKREIS : d;
}

/** Lage eines Zeichens auf dem Kompassbalken. */
export interface KompassPunkt {
  /** Versatz von der Balkenmitte [Punkte], ganzzahlig. */
  x: number;
  /** Außerhalb des Sichtfelds: an den Rand gezogen. */
  amRand: boolean;
}

/**
 * Lage einer Peilung `grad` auf dem Kompassbalken, der `sichtfeld` Grad links und rechts der Blickrichtung
 * `blick` über `halbeBreite` Punkte zeigt. Außerhalb liegt das Zeichen am Rand der jeweiligen Seite.
 */
export function kompassVersatz(grad: number, blick: number, halbeBreite: number, sichtfeld: number, out: KompassPunkt): KompassPunkt {
  const rel = relativerWinkel(grad, blick);
  const amRand = Math.abs(rel) > sichtfeld;
  const begrenzt = amRand ? Math.sign(rel) * sichtfeld : rel;
  out.x = Math.round((begrenzt / sichtfeld) * halbeBreite);
  out.amRand = amRand;
  return out;
}
