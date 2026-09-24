/**
 * Der Kompassbalken (M3-28, §25 „optionaler Kompassbalken mit Markern“) als Palettenpuffer: ein schmaler
 * Eisenbalken, der 90° links und rechts der Blickrichtung zeigt – Striche alle 15° (länger alle 45°), die
 * Himmelsrichtungen als Buchstaben (Norden glutrot), darüber ein goldener Zeiger auf die Blickrichtung und
 * die Marker der Welt an ihrer Peilung (außerhalb des Sichtfelds am Rand ihrer Seite).
 */
import type { GlyphAtlas } from '../../../render/text';
import type { KartenMarker, MinimapLage } from './lage';
import { farbIndex, rampenStufe } from './palette';
import { kompassVersatz, peilung, type KompassPunkt } from './projektion';
import { textBreite, zeichneText } from './schrift';
import type { SymbolQuelle } from './spriteBild';
import { MARKER_SYMBOL, setzeSymbol } from './zeichnung';

/** Balkenbreite (ungerade: die Mitte liegt auf einem Punkt) und -höhe [Designpixel]. */
export const KOMPASS_BREITE = 121;
export const KOMPASS_HOEHE = 16;
export const KOMPASS_MITTE = (KOMPASS_BREITE - 1) / 2;
/** Grad links und rechts der Blickrichtung, die der Balken zeigt, und ihre Breite [Punkte]. */
export const KOMPASS_SICHTFELD = 90;
export const KOMPASS_HALBE_BREITE = KOMPASS_MITTE - 4;
/** Zeilen des Balkens: Kontur oben/unten; dazwischen Licht, Grund, Schatten. */
const OBEN = 3;
const UNTEN = 13;
/** Grundlinie der Buchstaben (Versalien füllen den Grund, Zeilen 5–11). */
const GRUNDLINIE = 12;
/** Senkrechte Mitte der Marker-Symbole. */
const MARKER_Y = 8;
const STRICH_GRAD = 15;
const HALB_GRAD = 45;
const VIERTEL_GRAD = 90;
const VOLL_GRAD = 360;

const F = {
  kontur: farbIndex('nacht.1'),
  licht: farbIndex('stein.3'),
  grund: farbIndex('nacht.2'),
  schatten: farbIndex('stein.1'),
  strich: farbIndex('stein.3'),
  strichLang: farbIndex('stein.4'),
  norden: farbIndex('feuer.3'),
  richtung: farbIndex('sand.4'),
  zeiger: farbIndex('laub.4'),
} as const;

const PUNKT: KompassPunkt = { x: 0, amRand: false };

function setze(ziel: Uint8Array, x: number, y: number, v: number): void {
  if (x >= 0 && y >= 0 && x < KOMPASS_BREITE && y < KOMPASS_HOEHE) ziel[y * KOMPASS_BREITE + x] = v;
}

/** Breite der Tinte eines Texts (ohne den Vorschub nach dem letzten Zeichen). */
function tintenBreite(atlas: GlyphAtlas, text: string): number {
  let letzte = 0;
  let stift = 0;
  for (const ch of text) {
    const g = atlas.glyph(ch);
    letzte = stift + g.offsetX + g.width;
    stift += g.advance;
  }
  return Math.max(letzte, 0) || textBreite(atlas, text);
}

/**
 * Zeichnet den Balken für die Blickrichtung `blick` [Grad]. `richtungen` sind die Buchstaben für N, O, S, W
 * (übersetzt); ohne `schrift` (Webschrift lädt noch) bleiben die Hauptrichtungen lange Striche.
 */
export function zeichneKompass(ziel: Uint8Array, blick: number, l: MinimapLage, marker: readonly KartenMarker[], s: SymbolQuelle, schrift: GlyphAtlas | null, richtungen: readonly string[]): void {
  ziel.fill(0);
  for (let x = 0; x < KOMPASS_BREITE; x++) {
    const rand = x === 0 || x === KOMPASS_BREITE - 1;
    for (let y = OBEN; y <= UNTEN; y++) {
      const v = rand || y === OBEN || y === UNTEN ? F.kontur : y === OBEN + 1 ? F.licht : y === UNTEN - 1 ? F.schatten : F.grund;
      setze(ziel, x, y, v);
    }
  }
  // Enden abgeschrägt: je eine Eckfase.
  for (const x of [0, KOMPASS_BREITE - 1]) {
    setze(ziel, x, OBEN, 0);
    setze(ziel, x, UNTEN, 0);
  }
  for (let grad = 0; grad < VOLL_GRAD; grad += STRICH_GRAD) {
    const p = kompassVersatz(grad, blick, KOMPASS_HALBE_BREITE, KOMPASS_SICHTFELD, PUNKT);
    if (p.amRand) continue;
    const x = KOMPASS_MITTE + p.x;
    if (grad % VIERTEL_GRAD === 0) {
      const text = richtungen[grad / VIERTEL_GRAD] ?? '';
      const farbe = grad === 0 ? F.norden : F.richtung;
      if (schrift !== null && text !== '') zeichneText(ziel, KOMPASS_BREITE, KOMPASS_HOEHE, schrift, text, x - Math.floor(tintenBreite(schrift, text) / 2), GRUNDLINIE, farbe);
      else for (let y = OBEN + 2; y <= UNTEN - 2; y++) setze(ziel, x, y, farbe);
    } else if (grad % HALB_GRAD === 0) {
      for (let y = UNTEN - 4; y <= UNTEN - 2; y++) setze(ziel, x, y, F.strichLang);
    } else {
      setze(ziel, x, UNTEN - 2, F.strich);
    }
  }
  if (l.vorhanden) {
    for (const m of marker) {
      if (m.ebene !== l.ebene) continue;
      const p = kompassVersatz(peilung(l.x, l.y, m.x, m.y), blick, KOMPASS_HALBE_BREITE, KOMPASS_SICHTFELD, PUNKT);
      const id = MARKER_SYMBOL[m.art];
      const mass = s.mass(id);
      const idx = s.indizes(id);
      if (mass === null || idx === null) continue;
      setzeSymbol(ziel, KOMPASS_BREITE, KOMPASS_HOEHE, idx, mass.breite, mass.hoehe, KOMPASS_MITTE + p.x - mass.ankerX, MARKER_Y - mass.ankerY);
    }
  }
  // Zeiger: goldenes Dreieck über der Mitte (Licht links), Spitze in der Oberkante des Balkens.
  for (let dx = -3; dx <= 3; dx++) setze(ziel, KOMPASS_MITTE + dx, 0, F.kontur);
  for (let zeile = 1; zeile <= OBEN; zeile++) {
    const halb = OBEN - zeile;
    setze(ziel, KOMPASS_MITTE - halb - 1, zeile, F.kontur);
    setze(ziel, KOMPASS_MITTE + halb + 1, zeile, F.kontur);
    for (let dx = -halb; dx <= halb; dx++) setze(ziel, KOMPASS_MITTE + dx, zeile, dx < 0 ? rampenStufe(F.zeiger, 1) : dx > 0 ? rampenStufe(F.zeiger, -1) : F.zeiger);
  }
}

/**
 * Nähert die angezeigte Blickrichtung `aktuell` der Ziel-Richtung `ziel` um höchstens `schritt` Grad an
 * (kürzester Weg); liefert den neuen Winkel in [0, 360).
 */
export function dreheZu(aktuell: number, ziel: number, schritt: number): number {
  let d = (((ziel - aktuell) % VOLL_GRAD) + VOLL_GRAD) % VOLL_GRAD;
  if (d > VOLL_GRAD / 2) d -= VOLL_GRAD;
  const n = Math.abs(d) <= schritt ? ziel : aktuell + Math.sign(d) * schritt;
  return ((n % VOLL_GRAD) + VOLL_GRAD) % VOLL_GRAD;
}
