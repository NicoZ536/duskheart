/**
 * M3-27: the HUD thermometer (src/ui/hud/thermometer.ts, MASTERPROMPT §11.2 "Thermometer mit Trendpfeil")
 * – fill height of the core temperature, the scale marks of the sprite on exactly the rows of the stage
 * thresholds, the channel and bulb the HUD fills lying inside the glass, the trend steps and arrow frames,
 * a liquid colour per stage; and the HUD symbols of assets-src/sprites/ui/hud.ts (sizes, frames).
 */
import { describe, expect, it } from 'vitest';
import hudSprites from '../../../assets-src/sprites/ui/hud';
import { paletteIndex } from '../../../assets-src/palette';
import { BALANCE } from '../../../src/content/balance';
import { TEMPERATURE_STAGES } from '../../../src/content/balance/survival';
import { FUELL_FARBE, fuellHoehe, fuellOben, MARKEN, pfeilOben, THERMO, TREND_RUHIG_CPS, TREND_SCHNELL_CPS, trendFrame, trendStufe } from '../../../src/ui/hud/thermometer';

const sprite = (id: string) => {
  const s = hudSprites.find((x) => x.id === id);
  if (s === undefined) throw new Error(`Sprite ${id} fehlt`);
  return s;
};

describe('Thermometer: Füllung', () => {
  it('2 px je °C ab 28 °C, begrenzt auf die Rinne', () => {
    expect(fuellHoehe(28)).toBe(0);
    expect(fuellHoehe(37)).toBe(18);
    expect(fuellHoehe(20)).toBe(0);
    expect(fuellHoehe(60)).toBe(THERMO.rinne.hoehe);
    expect(fuellHoehe(Number.NaN)).toBe(0);
    expect(fuellOben(37)).toBe(THERMO.rinne.y + THERMO.rinne.hoehe - 18);
  });

  it('jede Stufengrenze aus §11.2 liegt auf einer ganzen Zeile, und dort steht die Marke im Sprite', () => {
    const T = BALANCE.survival.temperature;
    const grenzen = [T.stages.erfrierendBelow, T.stages.unterkuehltBelow, T.stages.frierendBelow, T.coreNormalC, T.stages.erhitztAbove, T.stages.ueberhitztAbove, T.stages.hitzschlagAbove];
    expect(MARKEN.map(([c]) => c).sort((a, b) => a - b)).toEqual([...grenzen].sort((a, b) => a - b));
    const s = sprite(THERMO.sprite);
    expect([s.w, s.h]).toEqual([THERMO.breite, THERMO.hoehe]);
    const frame = s.frames[0];
    if (frame === undefined) throw new Error('kein Frame');
    const markenZeilen = new Set<number>();
    for (let y = 0; y < s.h; y++) if ((frame.index[y * s.w] ?? 0) !== 0 && (frame.index[y * s.w + 1] ?? 0) !== 0) markenZeilen.add(y);
    for (const [c, zeile] of MARKEN) {
      expect(Number.isInteger((c - THERMO.bodenC) * THERMO.pxJeGrad), `${c} °C`).toBe(true);
      expect(fuellOben(c), `${c} °C`).toBe(zeile);
      expect(markenZeilen.has(zeile), `Marke für ${c} °C in Zeile ${zeile}`).toBe(true);
    }
    expect(markenZeilen.size).toBe(MARKEN.length);
  });

  it('Rinne und Kugel sind im Sprite durchsichtig (dort liegen Rinne und Flüssigkeit darunter) und von Glas umgeben', () => {
    const s = sprite(THERMO.sprite);
    const f = s.frames[0];
    if (f === undefined) throw new Error('kein Frame');
    const at = (x: number, y: number): number => f.index[y * s.w + x] ?? 0;
    const { rinne: r, kugel: k } = THERMO;
    for (let y = r.y; y < r.y + r.hoehe; y++) {
      for (let x = r.x; x < r.x + r.breite; x++) expect(at(x, y), `Rinne ${x},${y}`).toBe(0);
      expect(at(r.x - 1, y)).not.toBe(0);
      expect(at(r.x + r.breite, y)).not.toBe(0);
    }
    expect(at(r.x + 1, r.y - 1)).not.toBe(0);
    // The bulb's corners may be glass: at least its middle column is open from top to bottom.
    for (let y = k.y; y < k.y + k.hoehe; y++) expect(at(k.x + 2, y) === 0 || at(k.x + 2, y) === paletteIndex('eis.4')).toBe(true);
    expect(at(k.x + 2, k.y + k.hoehe)).not.toBe(0);
  });

  it('der Trendpfeil sitzt mit seiner Mitte an der Flüssigkeit und bleibt im Thermometer', () => {
    expect(pfeilOben(37)).toBe(fuellOben(37) - 4);
    expect(pfeilOben(60)).toBe(0);
    expect(pfeilOben(10)).toBe(fuellOben(10) - 4);
    for (let c = 20; c <= 50; c += 0.5) expect(pfeilOben(c)).toBeLessThanOrEqual(THERMO.hoehe - 8);
  });
});

describe('Thermometer: Trend und Farbe', () => {
  it('Stufen des Trendpfeils nach der Kernänderung [°C/s]', () => {
    expect(trendStufe(0)).toBe(0);
    expect(trendStufe(TREND_RUHIG_CPS / 2)).toBe(0);
    expect(trendStufe(TREND_RUHIG_CPS)).toBe(1);
    expect(trendStufe(-TREND_RUHIG_CPS)).toBe(-1);
    expect(trendStufe(TREND_SCHNELL_CPS)).toBe(2);
    expect(trendStufe(-TREND_SCHNELL_CPS)).toBe(-2);
    // Return to 37 °C inside the band (§11.2 0,01 °C/s) is one arrow, 10 °C of stress two.
    expect(trendStufe(BALANCE.survival.temperature.returnRatePerSecond)).toBe(1);
    expect(trendStufe(-BALANCE.survival.temperature.stressRatePerSecond * 10)).toBe(-2);
    expect(trendStufe(Number.NaN)).toBe(0);
  });

  it('Pfeil-Frames: steigt, steigt schnell, fällt, fällt schnell; ruhig ohne Pfeil', () => {
    expect([trendFrame(1), trendFrame(2), trendFrame(-1), trendFrame(-2), trendFrame(0)]).toEqual([0, 1, 2, 3, null]);
    expect(sprite('ui_hud_trend').frames).toHaveLength(4);
  });

  it('jede Temperaturstufe hat eine Palettenfarbe, kalt anders als warm', () => {
    for (const st of TEMPERATURE_STAGES) expect(paletteIndex(FUELL_FARBE[st])).toBeGreaterThan(0);
    expect(new Set(TEMPERATURE_STAGES.map((st) => FUELL_FARBE[st])).size).toBe(TEMPERATURE_STAGES.length);
  });
});

describe('HUD-Symbole', () => {
  it('Werte-Symbole so hoch wie eine Leiste, Auge mit fünf Stufen, Tastensymbole mit vier Knöpfen', () => {
    for (const id of ['ui_hud_leben', 'ui_hud_ausdauer', 'ui_hud_saettigung', 'ui_hud_durst']) expect([sprite(id).w, sprite(id).h]).toEqual([9, 8]);
    expect(sprite('ui_hud_furcht').frames).toHaveLength(5);
    for (const id of ['ui_taste_xbox', 'ui_taste_ps', 'ui_taste_generisch']) {
      expect([sprite(id).w, sprite(id).h]).toEqual([11, 11]);
      expect(sprite(id).frames).toHaveLength(4);
    }
  });

  it('kleine Ziffern 0–9 gedämpft und hell: 3×5-Glyphe in einer Farbe, ringsum dunkle Kontur, jede Ziffer anders', () => {
    const z = sprite('ui_hud_ziffer');
    expect([z.w, z.h]).toEqual([5, 7]);
    expect(z.frames).toHaveLength(20);
    const kontur = paletteIndex('nacht.0');
    const muster = new Set<string>();
    z.frames.forEach((f, i) => {
      const farbe = paletteIndex(i < 10 ? 'sand.2' : 'sand.4');
      const at = (x: number, y: number): number => f.index[y * z.w + x] ?? 0;
      let glyphe = '';
      for (let y = 0; y < z.h; y++) {
        for (let x = 0; x < z.w; x++) {
          const v = at(x, y);
          const innen = x >= 1 && x <= 3 && y >= 1 && y <= 5;
          // Stroke only inside the 3×5 field, only the digit's colour; everything else is outline or empty.
          if (!innen) expect(v === 0 || v === kontur, `Frame ${i} ${x},${y}`).toBe(true);
          else expect(v === farbe || v === kontur || v === 0, `Frame ${i} ${x},${y}`).toBe(true);
          if (v === farbe) {
            glyphe += '#';
            // Every stroke pixel is framed: no neighbour is empty.
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) expect(at(x + dx, y + dy), `Frame ${i} Kontur bei ${x + dx},${y + dy}`).not.toBe(0);
          } else glyphe += '.';
        }
      }
      muster.add(`${i % 10}:${glyphe}`);
    });
    expect(muster.size).toBe(10);
  });
});
