/**
 * M5-24 „Outline für Interaktion (final)“ (MASTERPROMPT §4.6 „1-px-Outline in Akzentfarbe (Shader)“): the outline pass
 * draws the accent colour of the UI's nearest palette step around everything flagged, and a glint of the accent's next
 * lighter step runs diagonally along it – anchored to the world, a slow run, never a blink, standing still with
 * reduced motion (src/render/passes/outlinePass.ts, shaders/outline.frag; the rule's mirror `outlineGlint`).
 */
import { describe, expect, it } from 'vitest';
import { SHADERS } from '../../../src/render/shaderLib';
import { outlineColors } from '../../../src/render/passes/outlinePass';
import { outlineGlint } from '../../../src/render/surface/rules';
import { SURFACE_PARAMS, surfaceDefines } from '../../../src/render/surface/params';
import { surfaceSettingsFrom } from '../../../src/render/surface/settings';
import { defaultSettings } from '../../../src/engine/settings';
import { PALETTE_RAMPS } from '../../../src/generated/palette';

const E = SURFACE_PARAMS.effects;

/** Ramp and step of palette index `i` (1…64). */
function rampOf(i: number): { ramp: number; step: number } {
  let start = 1;
  for (let r = 0; r < PALETTE_RAMPS.length; r++) {
    const size = PALETTE_RAMPS[r]?.size ?? 0;
    if (i < start + size) return { ramp: r, step: i - start };
    start += size;
  }
  throw new Error(`Palettenindex ${i}`);
}

describe('Interaktions-Outline mit Glanz', () => {
  it('Akzent und Glanz: dieselbe Rampe, der Glanz eine Stufe heller', () => {
    const { accent, glint } = outlineColors();
    const a = rampOf(accent);
    const g = rampOf(glint);
    expect(g.ramp).toBe(a.ramp);
    expect(g.step).toBe(a.step + 1);
  });

  it('der Glanz belegt den Anteil Breite/Abstand der Umrisspixel – schmale Bänder, kein Blinken', () => {
    let on = 0;
    let n = 0;
    for (let y = 0; y < 90; y++) {
      for (let x = 0; x < 180; x++) {
        n++;
        if (outlineGlint(x, y, 0.37)) on++;
      }
    }
    expect(Math.abs(on / n - E.outlineGlintWidthPx / E.outlineGlintSpacingPx)).toBeLessThan(0.006);
    expect(E.outlineGlintWidthPx / E.outlineGlintSpacingPx).toBeLessThan(0.15);
  });

  it('weltfest und wandernd: nach einer Periode dasselbe Muster, dazwischen um die Zeit verschoben', () => {
    for (let x = -20; x < 20; x++) {
      expect(outlineGlint(x, 7, 0.3 + E.outlineGlintSeconds)).toBe(outlineGlint(x, 7, 0.3));
      // Along the diagonal the band sits where it sat a moment before, moved on by the distance of that moment.
      const dt = E.outlineGlintSeconds / E.outlineGlintSpacingPx;
      expect(outlineGlint(x + 1, 7, 0.3 + dt)).toBe(outlineGlint(x, 7, 0.3));
    }
  });

  it('der Shader rechnet dieselbe Regel mit denselben Zahlen; Reduzierte Bewegung hält ihn an', () => {
    const src = SHADERS['outline.frag'] ?? '';
    expect(src).toContain('float v = (world.x + world.y) / DH_GLINT_SPACING - uTime / DH_GLINT_SECONDS;');
    expect(src).toContain('return fract(v) < DH_GLINT_WIDTH / DH_GLINT_SPACING;');
    const d = surfaceDefines();
    expect(Number(d['DH_GLINT_SPACING'])).toBe(E.outlineGlintSpacingPx);
    expect(Number(d['DH_GLINT_SECONDS'])).toBe(E.outlineGlintSeconds);
    const s = defaultSettings();
    expect(surfaceSettingsFrom(s).motionScale).toBe(1);
    s.accessibility.reducedMotion = true;
    expect(surfaceSettingsFrom(s).motionScale).toBeLessThan(1);
  });
});
