/**
 * Das Bild der Minimap (M3-28) als Puffer aus Palettenindizes: runde Karte im Eisenring (Nieten an den
 * Schrägen), darauf gesetzt die Tageszeit-Scheibe – ein halbrundes Himmelsfenster, in dem Sonne und Mond
 * auf ihrem Bogen über den Horizont ziehen (Sonne von Sonnenaufgang bis -untergang, Mond über die Nacht,
 * in seiner Phase) –, dann die Marker (ferne am Rand) und in der Mitte der Pfeil der Figur.
 *
 * Alles liegt auf ganzen Punkten in Palettenfarben (keine Kantenglättung, keine Drehung von Pixelgrafik):
 * Kreise sind Pixelkreise (d² ≤ r² + r), Symbole werden aus dem Atlas eingesetzt. Die Leinwand ist
 * `MINIMAP_BREITE × MINIMAP_HOEHE` Designpixel groß und wird im DOM ganzzahlig skaliert.
 */
import type { WeatherStateId } from '../../../content/weather';
import { HOURS_PER_DAY as STUNDEN_JE_TAG, MINUTES_PER_HOUR } from '../../../engine/time';
import { farbIndex, rampenStufe } from './palette';
import type { KartenMarker, MarkerArt, MinimapLage } from './lage';
import type { MinimapKarte } from './karte';
import { felderJePunkt, imKreis, neuerMarkerPunkt, projiziereMarker, type ZoomStufe } from './projektion';
import type { SymbolQuelle } from './spriteBild';

/** Radius der runden Karte [Punkte]. */
export const KARTE_RADIUS = 26;
/** Ring um die Karte: Innenschatten, zwei Stufen Eisen, Kontur. */
export const RING_BREITE = 4;
/** Radius des Himmelsfensters der Tageszeit-Scheibe. */
export const SCHEIBE_RADIUS = 10;
/** Bogenradius, auf dem Sonne und Mond laufen (Mittag: ganz im Fenster). */
export const BOGEN_RADIUS = 6;
/** Sockelzeilen der Scheibe unter dem Horizont (Eisen) vor der Kontur. */
const SOCKEL_ZEILEN = 3;

const AUSSEN = KARTE_RADIUS + RING_BREITE;
export const MINIMAP_BREITE = 2 * AUSSEN + 1;
/** Horizontzeile der Scheibe: ihr Rand beginnt in der obersten Zeile der Leinwand. */
export const HORIZONT_Y = SCHEIBE_RADIUS + RING_BREITE;
/**
 * Kartenmitte: Der Sockel der Scheibe (Eisen und Kontur unter dem Horizont) liegt auf dem Ring, seine
 * Konturzeile auf dem Innenschatten des Rings – darunter beginnt die Karte.
 */
export const KARTE_MITTE_X = AUSSEN;
export const KARTE_MITTE_Y = HORIZONT_Y + SOCKEL_ZEILEN + 1 + KARTE_RADIUS + 1;
export const MINIMAP_HOEHE = KARTE_MITTE_Y + AUSSEN + 1;
/** Abstand der Randmarker vom Kartenrand (ihr Mittelpunkt liegt innen, das Symbol ragt in den Ring). */
export const MARKER_RAND = KARTE_RADIUS - 3;

/** Symbol je Marker-Art. */
export const MARKER_SYMBOL: Readonly<Record<MarkerArt, string>> = {
  grab: 'ui_karte_grab',
  startstrand: 'ui_karte_startstrand',
};
export const SPIELER_SYMBOL = 'ui_karte_spieler';
export const SONNE_SYMBOL = 'ui_himmel_sonne';
export const MOND_SYMBOL = 'ui_himmel_mond';

const FARBE = {
  kontur: farbIndex('nacht.1'),
  lippe: farbIndex('nacht.1'),
  eisen: farbIndex('stein.3'),
  niete: farbIndex('stein.5'),
  nieteSchatten: farbIndex('stein.1'),
  nieteMitte: farbIndex('stein.4'),
} as const;

/** Himmel je Tagesphase: Himmel, Horizontband, Hügel; `bedeckt`: Varianten bei geschlossener Wolkendecke. */
const HIMMEL = {
  tag: { himmel: farbIndex('eis.2'), horizont: farbIndex('eis.3'), huegel: farbIndex('gras.2') },
  tagBedeckt: { himmel: farbIndex('stein.4'), horizont: farbIndex('stein.5'), huegel: farbIndex('gras.1') },
  morgen: { himmel: farbIndex('nacht.4'), horizont: farbIndex('laub.3'), huegel: farbIndex('nacht.2') },
  abend: { himmel: farbIndex('verderb.1'), horizont: farbIndex('feuer.2'), huegel: farbIndex('nacht.1') },
  nacht: { himmel: farbIndex('wasser.0'), horizont: farbIndex('wasser.1'), huegel: farbIndex('nacht.1') },
  finstermond: { himmel: farbIndex('nacht.0'), horizont: farbIndex('verderb.0'), huegel: farbIndex('nacht.1') },
} as const;
const STERN = farbIndex('eis.3');
/** Sterne im Nachthimmel [dx, dy] relativ zur Horizontmitte (feste Lage, nicht zufällig). */
const STERNE: readonly (readonly [number, number])[] = [
  [-6, -7],
  [-2, -9],
  [3, -6],
  [7, -4],
  [-8, -3],
  [5, -9],
];
/** Wetter, bei dem der Himmel zu ist (keine Sterne, grauer Tag). */
const BEDECKT: ReadonlySet<WeatherStateId> = new Set(['bewoelkt', 'nebel', 'niesel', 'regen', 'gewitter', 'schnee', 'schneesturm', 'sandsturm', 'ascheregen']);
/** Hügelsilhouette am Horizont: Zeile dy = −1 für diese dx-Bereiche (dy = 0 ist ganz Hügel). */
const HUEGEL: readonly (readonly [number, number])[] = [
  [-9, -5],
  [2, 7],
];
/** Sichtbarkeit der Gestirne: Anteil des Bogens vor Aufgang bzw. nach Untergang, in dem sie noch gezeichnet werden. */
const BOGEN_UEBERSTAND = 0.25;

type Himmel = (typeof HIMMEL)[keyof typeof HIMMEL];

/** Tagesphase einer Uhrzeit [h] (wie `dayPhaseAt` des Kalenders, aus den Tageszeiten der Lage). */
export function tagesphase(l: MinimapLage, stunde: number): 'nacht' | 'morgendaemmerung' | 'tag' | 'abenddaemmerung' {
  if (stunde < l.morgenBeginn || stunde >= l.nachtBeginn) return 'nacht';
  if (stunde < l.sonnenaufgang) return 'morgendaemmerung';
  if (stunde < l.sonnenuntergang) return 'tag';
  return 'abenddaemmerung';
}

function himmelVon(l: MinimapLage, stunde: number): Himmel {
  const bedeckt = l.wetter !== null && BEDECKT.has(l.wetter);
  switch (tagesphase(l, stunde)) {
    case 'tag':
      return bedeckt ? HIMMEL.tagBedeckt : HIMMEL.tag;
    case 'morgendaemmerung':
      return HIMMEL.morgen;
    case 'abenddaemmerung':
      return HIMMEL.abend;
    default:
      return l.mondphase === 0 ? HIMMEL.finstermond : HIMMEL.nacht;
  }
}

/** Lage eines Gestirns auf seinem Bogen: Versatz zur Horizontmitte [Punkte], oder `null` (unter dem Horizont). */
export interface GestirnPunkt {
  x: number;
  y: number;
}

/**
 * Wo das Gestirn steht, das von `auf` bis `unter` [h] über den Himmel zieht (über Mitternacht erlaubt):
 * Aufgang links am Horizont, höchster Stand oben, Untergang rechts. Kurz davor und danach liegt es unter
 * dem Horizont (vom Fenster abgeschnitten); sonst `false`.
 */
export function gestirnAufBogen(stunde: number, auf: number, unter: number, out: GestirnPunkt): boolean {
  const dauer = (((unter - auf) % STUNDEN_JE_TAG) + STUNDEN_JE_TAG) % STUNDEN_JE_TAG;
  if (dauer === 0) return false;
  // Stunden seit dem Aufgang; kurz vor dem Aufgang als negative Zeit (das Gestirn steigt von unten ein).
  let t = (((stunde - auf) % STUNDEN_JE_TAG) + STUNDEN_JE_TAG) % STUNDEN_JE_TAG;
  if (t > STUNDEN_JE_TAG - BOGEN_UEBERSTAND * dauer) t -= STUNDEN_JE_TAG;
  const anteil = t / dauer;
  if (anteil < -BOGEN_UEBERSTAND || anteil > 1 + BOGEN_UEBERSTAND) return false;
  const winkel = Math.PI * (1 - anteil);
  // `+ 0` macht aus −0 eine 0 (Rundung kleiner negativer Werte).
  out.x = Math.round(BOGEN_RADIUS * Math.cos(winkel)) + 0;
  out.y = Math.round(-BOGEN_RADIUS * Math.sin(winkel)) + 0;
  return true;
}

const GESTIRN: GestirnPunkt = { x: 0, y: 0 };

/** Setzt `indizes` (w×h) mit dem Bezugspunkt auf (x, y) in `ziel`; `maske(px, py)` darf Punkte ausschließen. */
export function setzeSymbol(ziel: Uint8Array, breite: number, hoehe: number, indizes: Uint8Array, w: number, h: number, x: number, y: number, maske?: (px: number, py: number) => boolean): void {
  for (let sy = 0; sy < h; sy++) {
    const py = y + sy;
    if (py < 0 || py >= hoehe) continue;
    for (let sx = 0; sx < w; sx++) {
      const v = indizes[sy * w + sx] ?? 0;
      if (v === 0) continue;
      const px = x + sx;
      if (px < 0 || px >= breite || (maske !== undefined && !maske(px, py))) continue;
      ziel[py * breite + px] = v;
    }
  }
}

function symbol(ziel: Uint8Array, s: SymbolQuelle, id: string, frame: number, mx: number, my: number, maske?: (px: number, py: number) => boolean): void {
  const m = s.mass(id);
  const idx = s.indizes(id, frame);
  if (m === null || idx === null) return;
  setzeSymbol(ziel, MINIMAP_BREITE, MINIMAP_HOEHE, idx, m.breite, m.hoehe, mx - m.ankerX, my - m.ankerY, maske);
}

/** Band eines Punkts im Ring um einen Kreis mit Radius r: −1 innen, 0 … n−1 Ringband, n außen. */
function ringBand(dx: number, dy: number, r: number, n: number): number {
  if (imKreis(dx, dy, r)) return -1;
  for (let k = 0; k < n; k++) if (imKreis(dx, dy, r + k + 1)) return k;
  return n;
}

/** Eisenfarbe mit Fase: oben links hell, unten rechts dunkel, dazwischen Grundton; Band 2 eine Stufe dunkler. */
function eisen(dx: number, dy: number, band: number, radius: number): number {
  const s = dx + dy;
  const fase = radius / 2;
  const stufe = s < -fase ? 1 : s > fase ? -1 : 0;
  return rampenStufe(FARBE.eisen, stufe - (band === 2 ? 1 : 0));
}

let rahmenCache: Uint8Array | null = null;

/** Der unbewegliche Rahmen: Kartenring mit Nieten, Scheibenrand und Sockel (einmal berechnet). */
export function minimapRahmen(): Uint8Array {
  if (rahmenCache !== null) return rahmenCache;
  const out = new Uint8Array(MINIMAP_BREITE * MINIMAP_HOEHE);
  const setze = (x: number, y: number, v: number): void => {
    if (x >= 0 && y >= 0 && x < MINIMAP_BREITE && y < MINIMAP_HOEHE) out[y * MINIMAP_BREITE + x] = v;
  };
  // Kartenring.
  for (let y = 0; y < MINIMAP_HOEHE; y++) {
    for (let x = 0; x < MINIMAP_BREITE; x++) {
      const dx = x - KARTE_MITTE_X;
      const dy = y - KARTE_MITTE_Y;
      const b = ringBand(dx, dy, KARTE_RADIUS, RING_BREITE);
      if (b === 0) setze(x, y, FARBE.lippe);
      else if (b === 1 || b === 2) setze(x, y, eisen(dx, dy, b, KARTE_RADIUS));
      else if (b === RING_BREITE - 1) setze(x, y, FARBE.kontur);
    }
  }
  // Nieten auf den Schrägen: drei Punkte je Niete, Glanz oben links, Schatten unten rechts.
  const n = Math.round((KARTE_RADIUS + 2) / Math.SQRT2) - 1;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const pts: [number, number][] = [
        [sx * n, sy * n],
        [sx * (n + 1), sy * n],
        [sx * n, sy * (n + 1)],
      ];
      const minX = Math.min(...pts.map((p) => p[0]));
      const minY = Math.min(...pts.map((p) => p[1]));
      for (const [px, py] of pts) {
        const v = px === minX && py === minY ? FARBE.niete : px !== minX && py !== minY ? FARBE.nieteSchatten : FARBE.nieteMitte;
        setze(KARTE_MITTE_X + px, KARTE_MITTE_Y + py, v);
      }
    }
  }
  // Scheibe: Rand um das Himmelsfenster (nur oberhalb des Horizonts), Sockel darunter.
  const aussen = SCHEIBE_RADIUS + RING_BREITE;
  for (let dy = -aussen; dy <= SOCKEL_ZEILEN + 1; dy++) {
    for (let dx = -aussen; dx <= aussen; dx++) {
      const x = KARTE_MITTE_X + dx;
      const y = HORIZONT_Y + dy;
      if (dy <= 0) {
        const b = ringBand(dx, dy, SCHEIBE_RADIUS, RING_BREITE);
        if (b === -1) setze(x, y, 0);
        else if (b === 0) setze(x, y, FARBE.lippe);
        else if (b === 1 || b === 2) setze(x, y, eisen(dx, dy, b, SCHEIBE_RADIUS));
        else if (b === RING_BREITE - 1) setze(x, y, FARBE.kontur);
      } else if (Math.abs(dx) === aussen || dy === SOCKEL_ZEILEN + 1) {
        setze(x, y, FARBE.kontur);
      } else if (Math.abs(dx) < aussen) {
        // Sockel: oben Licht, unten Schatten, an den Enden je eine Niete.
        const basis = dy === 1 ? rampenStufe(FARBE.eisen, 1) : dy === SOCKEL_ZEILEN ? rampenStufe(FARBE.eisen, -1) : FARBE.eisen;
        const niete = Math.abs(dx) === aussen - 2 && dy === 2;
        setze(x, y, niete ? FARBE.niete : basis);
      }
    }
  }
  rahmenCache = out;
  return out;
}

/** Ob (x, y) im Himmelsfenster liegt (Halbkreis über dem Horizont). */
function imFenster(x: number, y: number): boolean {
  const dy = y - HORIZONT_Y;
  return dy <= 0 && imKreis(x - KARTE_MITTE_X, dy, SCHEIBE_RADIUS);
}

/** Zeichnet das Himmelsfenster: Himmel, Sterne, Sonne/Mond, Hügel am Horizont. */
export function zeichneHimmel(ziel: Uint8Array, l: MinimapLage, s: SymbolQuelle): void {
  const stunde = l.minute / MINUTES_PER_HOUR;
  const h = himmelVon(l, stunde);
  const nacht = h === HIMMEL.nacht || h === HIMMEL.finstermond;
  const bedeckt = l.wetter !== null && BEDECKT.has(l.wetter);
  for (let dy = -SCHEIBE_RADIUS; dy <= 0; dy++) {
    for (let dx = -SCHEIBE_RADIUS; dx <= SCHEIBE_RADIUS; dx++) {
      if (!imKreis(dx, dy, SCHEIBE_RADIUS)) continue;
      ziel[(HORIZONT_Y + dy) * MINIMAP_BREITE + KARTE_MITTE_X + dx] = dy >= -2 ? h.horizont : h.himmel;
    }
  }
  if (nacht && !bedeckt) {
    // Finstermond: nur die hellsten drei Sterne.
    const anzahl = l.mondphase === 0 ? STERNE.length / 2 : STERNE.length;
    for (let i = 0; i < anzahl; i++) {
      const st = STERNE[i];
      if (st !== undefined) ziel[(HORIZONT_Y + st[1]) * MINIMAP_BREITE + KARTE_MITTE_X + st[0]] = STERN;
    }
  }
  // Tagsüber nur die Sonne, nachts nur der Mond; in den Dämmerungen stehen beide tief am Horizont.
  const phase = tagesphase(l, stunde);
  const p = GESTIRN;
  if (phase !== 'nacht' && gestirnAufBogen(stunde, l.sonnenaufgang, l.sonnenuntergang, p)) {
    symbol(ziel, s, SONNE_SYMBOL, 0, KARTE_MITTE_X + p.x, HORIZONT_Y + p.y, imFenster);
  }
  if (phase !== 'tag' && gestirnAufBogen(stunde, l.sonnenuntergang, l.sonnenaufgang, p)) {
    symbol(ziel, s, MOND_SYMBOL, l.mondphase, KARTE_MITTE_X + p.x, HORIZONT_Y + p.y, imFenster);
  }
  // Hügel vor den Gestirnen: Auf- und Untergang verschwinden hinter dem Horizont.
  for (let dx = -SCHEIBE_RADIUS; dx <= SCHEIBE_RADIUS; dx++) {
    if (imKreis(dx, 0, SCHEIBE_RADIUS)) ziel[HORIZONT_Y * MINIMAP_BREITE + KARTE_MITTE_X + dx] = h.huegel;
  }
  for (const [a, b] of HUEGEL) {
    for (let dx = a; dx <= b; dx++) ziel[(HORIZONT_Y - 1) * MINIMAP_BREITE + KARTE_MITTE_X + dx] = h.huegel;
  }
}

/** Füllt die runde Karte mit einer Farbe (ohne Figur: nur Nebel). */
function fuelleKarte(ziel: Uint8Array, farbe: number): void {
  for (let dy = -KARTE_RADIUS; dy <= KARTE_RADIUS; dy++) {
    for (let dx = -KARTE_RADIUS; dx <= KARTE_RADIUS; dx++) {
      if (imKreis(dx, dy, KARTE_RADIUS)) ziel[(KARTE_MITTE_Y + dy) * MINIMAP_BREITE + KARTE_MITTE_X + dx] = farbe;
    }
  }
}

/** Blickrichtung [Grad] → Frame des Spielerpfeils (0 = N … 7 = NW). */
export function pfeilFrame(richtung: number): number {
  return Math.round((((richtung % 360) + 360) % 360) / 45) % 8;
}

const MARKER_PUNKT = neuerMarkerPunkt();

/**
 * Das ganze Bild: Karte (mit `karte` komponiert), Rahmen, Himmel, Marker der Ebene, Spielerpfeil.
 * `ziel` hat `MINIMAP_BREITE × MINIMAP_HOEHE` Einträge.
 */
export function zeichneMinimap(ziel: Uint8Array, karte: MinimapKarte, l: MinimapLage, zoom: ZoomStufe, marker: readonly KartenMarker[], s: SymbolQuelle): void {
  ziel.fill(0);
  if (l.vorhanden) karte.komponiere(l.ebene, l.x, l.y, zoom, KARTE_RADIUS, ziel, MINIMAP_BREITE, KARTE_MITTE_X, KARTE_MITTE_Y);
  else fuelleKarte(ziel, karte.nebel);
  const rahmen = minimapRahmen();
  for (let i = 0; i < ziel.length; i++) {
    const v = rahmen[i] ?? 0;
    if (v !== 0) ziel[i] = v;
  }
  zeichneHimmel(ziel, l, s);
  if (!l.vorhanden) return;
  const fjp = felderJePunkt(zoom);
  for (const m of marker) {
    if (m.ebene !== l.ebene) continue;
    const p = projiziereMarker(m.x, m.y, l.x, l.y, fjp, MARKER_RAND, MARKER_PUNKT);
    symbol(ziel, s, MARKER_SYMBOL[m.art], 0, KARTE_MITTE_X + p.x, KARTE_MITTE_Y + p.y);
  }
  symbol(ziel, s, SPIELER_SYMBOL, pfeilFrame(l.richtung), KARTE_MITTE_X, KARTE_MITTE_Y);
}
