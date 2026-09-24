/**
 * The HUD thermometer (MASTERPROMPT §11.2 "HUD: Thermometer mit Trendpfeil; Tooltip mit gefühlter
 * Temperatur und Einflüssen", §26; M3-27): geometry of the sprite `ui_hud_thermometer`
 * (assets-src/sprites/ui/hud.ts), the fill height of the core temperature, the trend step of the arrow and
 * the colour of the liquid per temperature stage. The sprite is glass and outline only; the HUD lays the
 * dark channel and the coloured liquid under it on whole design pixels.
 */
import type { TemperatureStage } from '../../content/balance/survival';
import { BALANCE } from '../../content/balance';

/** Sprite geometry [design px] (see the raster in assets-src/sprites/ui/hud.ts). */
export const THERMO = {
  sprite: 'ui_hud_thermometer',
  breite: 10,
  hoehe: 38,
  /** The channel inside the tube: columns 4–6, rows 1–30 (row 30 is the lowest). */
  rinne: { x: 4, y: 1, breite: 3, hoehe: 30 },
  /** The bulb's inside (always filled): columns 3–7, rows 31–36. */
  kugel: { x: 3, y: 31, breite: 5, hoehe: 6 },
  /** Core temperature at the bottom of the channel [°C]. */
  bodenC: 28,
  /** Channel pixels per °C: every stage threshold of §11.2 (33, 35, 36, 38, 39, 40.5 °C) lands on a whole pixel. */
  pxJeGrad: 2,
} as const;

/** Rows of the sprite's scale marks per threshold [°C → row of the mark] (kept in sync by a unit test). */
export const MARKEN: ReadonlyArray<readonly [number, number]> = [
  [40.5, 6],
  [39, 9],
  [38, 11],
  [37, 13],
  [36, 15],
  [35, 17],
  [33, 21],
];

/** Filled channel pixels for `coreC` (0 … channel height). */
export function fuellHoehe(coreC: number): number {
  if (!Number.isFinite(coreC)) return 0;
  const h = Math.round((coreC - THERMO.bodenC) * THERMO.pxJeGrad);
  return Math.min(THERMO.rinne.hoehe, Math.max(0, h));
}

/** Top row of the liquid in the sprite for `coreC` (the row just below the channel when nothing is filled). */
export function fuellOben(coreC: number): number {
  return THERMO.rinne.y + THERMO.rinne.hoehe - fuellHoehe(coreC);
}

/** Below this core change the thermometer is steady [°C/s] (the bridge rounds the rate to 0.001). */
export const TREND_RUHIG_CPS = 0.001;
/**
 * From this core change the arrow doubles [°C/s]: 10 °C of stress (§11.2 "0,002 °C/s × Stress") – a
 * night without fire or a desert noon. The return to 37 °C inside the band (0,01 °C/s) stays one arrow.
 */
export const TREND_SCHNELL_CPS = 0.02;

/** Size of the trend arrow `ui_hud_trend` [design px]. */
export const TREND_B = 7;
export const TREND_H = 8;

/** Top of the trend arrow [design px]: its middle at the surface of the liquid, inside the thermometer's height. */
export function pfeilOben(coreC: number): number {
  return Math.min(THERMO.hoehe - TREND_H, Math.max(0, fuellOben(coreC) - Math.floor(TREND_H / 2)));
}

/** Trend step of the arrow: −2 falls fast, −1 falls, 0 steady, 1 rises, 2 rises fast. */
export type TrendStufe = -2 | -1 | 0 | 1 | 2;

export function trendStufe(rateCps: number): TrendStufe {
  if (!Number.isFinite(rateCps)) return 0;
  const a = Math.abs(rateCps);
  if (a < TREND_RUHIG_CPS) return 0;
  const schnell = a >= TREND_SCHNELL_CPS;
  if (rateCps > 0) return schnell ? 2 : 1;
  return schnell ? -2 : -1;
}

/** Frame of the sprite `ui_hud_trend` for a step (steady: none). */
export function trendFrame(stufe: TrendStufe): number | null {
  switch (stufe) {
    case 1:
      return 0;
    case 2:
      return 1;
    case -1:
      return 2;
    case -2:
      return 3;
    case 0:
      return null;
  }
}

/** Colour of the liquid per stage (palette references): ice blues below, glowing reds above. */
export const FUELL_FARBE: Readonly<Record<TemperatureStage, string>> = {
  erfrierend: 'eis.4',
  unterkuehlt: 'eis.2',
  frierend: 'eis.1',
  normal: 'feuer.2',
  erhitzt: 'feuer.3',
  ueberhitzt: 'feuer.4',
  hitzschlag: 'feuer.5',
};

/** Colour of the empty channel (dark glass). */
export const RINNE_FARBE = 'nacht.0';

/** Normal core temperature [°C] (§11.1). */
export const KERN_NORMAL_C = BALANCE.survival.temperature.coreNormalC;
