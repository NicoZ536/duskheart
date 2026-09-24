/**
 * Palettenzugriff der Minimap (M3-28): Die Karte, ihr Rahmen, die Tageszeit-Scheibe und die Symbole
 * entstehen als Puffer aus Palettenindizes (1…64, 0 = durchsichtig) und werden erst beim Zeichnen in
 * Farben der Master-Palette übersetzt – dieselben Farben wie im Spielatlas, ohne Zwischentöne und damit
 * pixelscharf (MASTERPROMPT §4.3, §26).
 */
import { PALETTE_ROWS } from '../../../generated/atlas';
import { PALETTE_HEX, PALETTE_RAMPS } from '../../../generated/palette';
import { parseHexColor } from '../../../render/palette/lut';
import { paletteRefIndex } from '../../../render/palette/rows';

/** Palettenindex „durchsichtig“ (wie im Spielatlas). */
export const DURCHSICHTIG = 0;
/** Anzahl der Einträge einer Index-Tabelle (0 … 64). */
export const PALETTE_EINTRAEGE = PALETTE_HEX.length + 1;

const DECKEND = 0xff;
const BYTE_BITS = 8;
const KANAL_G = BYTE_BITS;
const KANAL_B = 2 * BYTE_BITS;
const KANAL_A = 3 * BYTE_BITS;

/** Palettenindex (1…64) einer Referenz `rampe.stufe`. */
export function farbIndex(ref: string): number {
  return paletteRefIndex(ref, PALETTE_RAMPS);
}

/** `#rrggbb` eines Palettenindex (1…64). */
export function farbHex(index: number): string {
  const hex = PALETTE_HEX[index - 1];
  if (hex === undefined) throw new RangeError(`Minimap: Palettenindex ${index} gibt es nicht`);
  return hex;
}

/** Rampe und Stufe jedes Palettenindex (für `rampenStufe`). */
const RAMPE_VON: readonly { readonly start: number; readonly groesse: number }[] = (() => {
  const out: { start: number; groesse: number }[] = [{ start: 0, groesse: 1 }];
  let start = 1;
  for (const r of PALETTE_RAMPS) {
    for (let i = 0; i < r.size; i++) out.push({ start, groesse: r.size });
    start += r.size;
  }
  return out;
})();

/** Der Index `stufen` Stufen heller (+) oder dunkler (−) in derselben Rampe, an den Rampenenden begrenzt. */
export function rampenStufe(index: number, stufen: number): number {
  const r = RAMPE_VON[index];
  if (r === undefined || index === DURCHSICHTIG) return index;
  const stufe = Math.min(r.groesse - 1, Math.max(0, index - r.start + stufen));
  return r.start + stufe;
}

/**
 * Palettenzeile `id` (z. B. `biom_salzkueste`) als Tabelle Index → Index (Eintrag 0 bleibt 0), oder `null`,
 * wenn es die Zeile nicht gibt.
 */
export function zeilenTabelle(id: string): Uint8Array | null {
  const row = PALETTE_ROWS.find((r) => r.id === id);
  if (row === undefined) return null;
  const out = new Uint8Array(PALETTE_EINTRAEGE);
  row.map.forEach((ziel, i) => (out[i + 1] = ziel));
  return out;
}

/** Ob `Uint32Array`-Schreibzugriffe auf RGBA-Puffer in Little-Endian-Reihenfolge landen. */
const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;

/**
 * Farbe je Palettenindex als 32-Bit-Wort für einen RGBA-Puffer (`ImageData.data` als `Uint32Array`),
 * Eintrag 0 durchsichtig: Ein Pixel wird mit einer einzigen Zuweisung gesetzt.
 */
export const PALETTE_RGBA32: Uint32Array = (() => {
  const out = new Uint32Array(PALETTE_EINTRAEGE);
  PALETTE_HEX.forEach((hex, i) => {
    const [r, g, b] = parseHexColor(hex);
    out[i + 1] = LITTLE_ENDIAN
      ? ((DECKEND << KANAL_A) | (b << KANAL_B) | (g << KANAL_G) | r) >>> 0
      : ((r << KANAL_A) | (g << KANAL_B) | (b << KANAL_G) | DECKEND) >>> 0;
  });
  return out;
})();

/** Übersetzt Palettenindizes in RGBA (`ziel` hat dieselbe Pixelzahl wie `indizes`). */
export function indizesNachRgba(indizes: Uint8Array, ziel: Uint32Array): void {
  const n = Math.min(indizes.length, ziel.length);
  for (let i = 0; i < n; i++) ziel[i] = PALETTE_RGBA32[indizes[i] ?? 0] ?? 0;
}

/**
 * Farben der HUD-Schilder als CSS-Variablen (Inline-Stil der Wurzel): Die Stylesheets nennen keine eigenen
 * Farbwerte (ADR-0010), die Palette bleibt die einzige Quelle.
 */
export function hudFarbVariablen(): Record<string, string> {
  return {
    '--dh-hud-grund': farbHex(farbIndex('nacht.2')),
    '--dh-hud-kontur': farbHex(farbIndex('nacht.1')),
    '--dh-hud-licht': farbHex(farbIndex('nacht.4')),
    '--dh-hud-schatten': farbHex(farbIndex('nacht.0')),
    '--dh-hud-gold': farbHex(farbIndex('feuer.4')),
    '--dh-hud-hervor': farbHex(farbIndex('laub.4')),
  };
}
