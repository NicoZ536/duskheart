/**
 * Textgröße (Barrierefreiheit §29 „Textgröße“, Einstellung `accessibility.textScale` 1,0–2,0) für
 * Pixelschrift: Die Schrift ist nur in ganzen Vielfachen ihrer nativen Größe scharf (ADR-0013/-0015). Die
 * Einstellung wird deshalb auf ganze Bildschirmpixel je Schriftpixel abgerundet – nie kleiner als die
 * UI-Skalierung selbst. Bei UI-Skalierung 2 (zwei Bildschirmpixel je Designpixel) wird Text ab 1,5 drei und
 * ab 2,0 vier Pixel je Schriftpixel groß; bei 1× ab 2,0 doppelt so groß.
 */
import { UI_SCALE_VAR } from '../../theme';

/** Toleranz der Rundung (Produkte wie 3 × 1,1 sind in Gleitkomma nicht exakt). */
const EPSILON = 1e-6;
/** Grenzen der Einstellung (src/engine/settings.ts `accessibility.textScale`). */
export const TEXTGROESSE_MIN = 1;
export const TEXTGROESSE_MAX = 2;

/**
 * Faktor, mit dem Schriftgröße und Zeilenhöhe (in Designpixeln × `--dh-ui-scale`) multipliziert werden:
 * `geraetepixel` ist die Zahl der Bildschirmpixel je Designpixel (`--dh-ui-scale` × devicePixelRatio),
 * `textgroesse` die Einstellung. Ergebnis ≥ 1; Schriftpixel liegen danach immer auf ganzen Bildschirmpixeln.
 */
export function textFaktor(geraetepixel: number, textgroesse: number): number {
  const d = Math.max(1, Math.round(Number.isFinite(geraetepixel) ? geraetepixel : 1));
  const t = Math.min(TEXTGROESSE_MAX, Math.max(TEXTGROESSE_MIN, Number.isFinite(textgroesse) ? textgroesse : TEXTGROESSE_MIN));
  return Math.max(d, Math.floor(d * t + EPSILON)) / d;
}

/** Bildschirmpixel je Designpixel am Element (`--dh-ui-scale` ist die CSS-Länge eines Designpixels). */
export function geraetepixelAm(el: Element, devicePixelRatio: number): number {
  const v = Number.parseFloat(getComputedStyle(el).getPropertyValue(UI_SCALE_VAR));
  const css = Number.isFinite(v) && v > 0 ? v : 1;
  return Math.max(1, Math.round(css * (devicePixelRatio > 0 ? devicePixelRatio : 1)));
}
