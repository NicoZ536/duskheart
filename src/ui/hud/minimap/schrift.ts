/**
 * Pixelschrift in Leinwänden des HUD (Kompassbalken, M3-28): dieselben gebackenen Glyphen wie die
 * weltnahe UI (`GlyphAtlas`, ADR-0013/-0016 – harte Alphaschwelle, ganze Pixel), hier als Palettenpunkte in
 * einen Indexpuffer gesetzt. So stehen Buchstaben pixelgenau im Balken, ohne DOM-Text über einer Leinwand
 * auf halbe Pixel zentrieren zu müssen.
 */
import { createCanvasRasterizer, GlyphAtlas, INK } from '../../../render/text';
import { loadUiFont, UI_FONT } from '../../font';

const JE_DOKUMENT = new WeakMap<Document, Promise<GlyphAtlas>>();

/** Der Glyphenatlas der UI-Schrift für `doc` (wartet auf die Webschrift; einmal je Dokument). */
export function hudSchrift(doc: Document): Promise<GlyphAtlas> {
  let p = JE_DOKUMENT.get(doc);
  if (p === undefined) {
    p = loadUiFont(doc.fonts).then(() => new GlyphAtlas(UI_FONT, createCanvasRasterizer(UI_FONT)));
    JE_DOKUMENT.set(doc, p);
  }
  return p;
}

/** Laufweite von `text` [px] (Summe der Vorschübe). */
export function textBreite(atlas: GlyphAtlas, text: string): number {
  let w = 0;
  for (const ch of text) w += atlas.glyph(ch).advance;
  return w;
}

/**
 * Setzt `text` mit dem Stift bei `x` und der Grundlinie bei `grundlinie` in `ziel` (Palettenindizes,
 * `breite × hoehe`), jede Glyphenfarbe `farbe`.
 */
export function zeichneText(ziel: Uint8Array, breite: number, hoehe: number, atlas: GlyphAtlas, text: string, x: number, grundlinie: number, farbe: number): void {
  // Erst backen (der Atlas kann dabei wachsen), dann seine Pixel lesen.
  atlas.ensure(text);
  const px = atlas.pixels;
  const aw = atlas.width;
  let stift = x;
  for (const ch of text) {
    const g = atlas.glyph(ch);
    for (let gy = 0; gy < g.height; gy++) {
      const zy = grundlinie + g.offsetY + gy;
      if (zy < 0 || zy >= hoehe) continue;
      for (let gx = 0; gx < g.width; gx++) {
        if ((px[(g.atlasY + 1 + gy) * aw + g.atlasX + 1 + gx] ?? 0) !== INK) continue;
        const zx = stift + g.offsetX + gx;
        if (zx >= 0 && zx < breite) ziel[zy * breite + zx] = farbe;
      }
    }
    stift += g.advance;
  }
}
