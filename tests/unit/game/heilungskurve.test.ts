/**
 * The healing curve of the world (M7-35; MASTERPROMPT §4.1 "die Welt heilt sichtbar", §8; docs/SPIEL.md §22 "globale
 * Heilungsstufe je Anzahl entzündeter Leuchtfeuer 0–6 (`BEACON_HEALING[n]`: Sättigung, Wärme, Verderbnis-Skala – monoton
 * steigend, Test)"): every further lit beacon makes the world more saturated and warmer and leaves less corruption; the
 * light wave grows with time and heals what it passes, the corruption of a dark site fades with the distance.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { BEACON_HEALING, healedBy, healingStep, siteCorruption, waveRadiusTiles } from '../../../src/game/beacons/formulas';

const BE = BALANCE.beacons;
const HZ = BALANCE.time.tickHz;

describe('Heilungskurve (BEACON_HEALING 0–6)', () => {
  it('sieben Stufen; Stufe 0 ist die Welt vor M7 (keine Änderung); jede weitere heilt mehr: Sättigung und Wärme steigen, Verderbnis fällt', () => {
    expect(BEACON_HEALING).toHaveLength(7);
    expect(BEACON_HEALING[0]).toEqual({ saettigung: 1, waerme: 0, verderbnis: 1 });
    for (let n = 1; n < BEACON_HEALING.length; n++) {
      const a = BEACON_HEALING[n - 1];
      const b = BEACON_HEALING[n];
      if (a === undefined || b === undefined) throw new Error('step missing');
      expect(b.saettigung, `Stufe ${n}`).toBeGreaterThan(a.saettigung);
      expect(b.waerme, `Stufe ${n}`).toBeGreaterThan(a.waerme);
      expect(b.verderbnis, `Stufe ${n}`).toBeLessThan(a.verderbnis);
    }
    // All six lit: almost no corruption left, never a negative scale.
    const last = BEACON_HEALING[6];
    expect(last?.verderbnis).toBeGreaterThanOrEqual(0);
    expect(last?.verderbnis).toBeLessThan(0.1);
  });

  it('healingStep klemmt auf 0–6', () => {
    expect(healingStep(-1)).toBe(BEACON_HEALING[0]);
    expect(healingStep(1)).toBe(BEACON_HEALING[1]);
    expect(healingStep(9)).toBe(BEACON_HEALING[6]);
  });

  it('die Lichtwelle wächst mit der Zeit und heilt weiche Front für weiche Front; vor dem Entzünden heilt nichts', () => {
    expect(waveRadiusTiles(100, 100)).toBe(0);
    expect(waveRadiusTiles(100, 50)).toBe(0);
    expect(waveRadiusTiles(0, HZ)).toBeCloseTo(BE.waveTilesPerSecond, 10);
    let last = -1;
    for (let t = 0; t <= 20 * HZ; t += HZ / 2) {
      const r = waveRadiusTiles(0, t);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
    // A point 30 tiles out: untouched until the wave arrives, fully healed one front width later, monotone between.
    let h = -1;
    for (let wave = 0; wave <= 30 + BE.waveFrontTiles + 5; wave++) {
      const v = healedBy(wave, 30);
      expect(v).toBeGreaterThanOrEqual(h);
      h = v;
    }
    expect(healedBy(30, 30)).toBe(0);
    expect(healedBy(30 + BE.waveFrontTiles, 30)).toBe(1);
  });

  it('Verderbnis der dunklen Stätte: am stärksten an ihr, monoton fallend, null ab dem Radius', () => {
    expect(siteCorruption(0)).toBe(BE.corruption.strength);
    let c = Number.POSITIVE_INFINITY;
    for (let d = 0; d <= BE.corruption.radiusTiles + 4; d++) {
      const v = siteCorruption(d);
      expect(v).toBeLessThanOrEqual(c);
      expect(v).toBeGreaterThanOrEqual(0);
      c = v;
    }
    expect(siteCorruption(BE.corruption.radiusTiles)).toBe(0);
  });
});
