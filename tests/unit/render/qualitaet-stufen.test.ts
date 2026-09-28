/**
 * M5-25: die Stufentabelle nach MASTERPROMPT §6.3 – Punktlichter 32/64/128/256, Schatten nur Sonne/harte SDF/weiche
 * SDF/weich, GI nur Ultra (Platz bis M13), Wasser vereinfacht/ohne Spiegelung/voll/voll, Wetter/Partikel
 * reduziert/voll/voll/voll + Partikellicht; Bloom und Nebel bleiben auf jeder Stufe an (§6.3 senkt sie nicht);
 * Lichtstrahlen (God Rays) sind bis M13-04 keine Einstellung. Eine Stufe zu wählen bringt ihre Voreinstellung mit.
 */
import { describe, expect, it } from 'vitest';
import {
  applyQualityPreset,
  createSettingsStore,
  defaultSettings,
  isGiActive,
  isQualityLevel,
  matchesQualityPreset,
  QUALITY_DETAIL_KEYS,
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  qualityPatch,
  settingsSchema,
  type QualityLevel,
} from '../../../src/engine/settings';
import { createI18n } from '../../../src/i18n';
import { GI_AVAILABLE, renderQualityFrom } from '../../../src/render/quality/levels';
import { levelChosenAlone } from '../../../src/render/quality/boot';

/** §6.3 "Qualitätsstufen & Robustheit", column by column. */
const TABLE: Readonly<Record<QualityLevel, { lights: number; shadows: string; gi: boolean; water: string; particles: string; particleLights: boolean }>> = {
  low: { lights: 32, shadows: 'sun', gi: false, water: 'simple', particles: 'reduced', particleLights: false },
  medium: { lights: 64, shadows: 'hard', gi: false, water: 'noReflection', particles: 'full', particleLights: false },
  high: { lights: 128, shadows: 'soft', gi: false, water: 'full', particles: 'full', particleLights: false },
  ultra: { lights: 256, shadows: 'soft', gi: true, water: 'full', particles: 'full', particleLights: true },
};

describe('Qualitätsstufen (§6.3)', () => {
  it('vier Stufen in aufsteigender Reihenfolge, Hoch ist der Standard', () => {
    expect(QUALITY_LEVELS).toEqual(['low', 'medium', 'high', 'ultra']);
    expect(defaultSettings().graphics.quality).toBe('high');
    expect(matchesQualityPreset(defaultSettings().graphics)).toBe(true);
    expect(isQualityLevel('ultra')).toBe(true);
    expect(isQualityLevel('hoch')).toBe(false);
    expect(isQualityLevel(undefined)).toBe(false);
  });

  it('jede Stufe setzt genau die Spalten der Tabelle', () => {
    for (const level of QUALITY_LEVELS) {
      const p = QUALITY_PRESETS[level];
      const row = TABLE[level];
      expect(p.maxLights, level).toBe(row.lights);
      expect(p.shadows, level).toBe(row.shadows);
      expect(p.gi, level).toBe(row.gi);
      expect(p.water, level).toBe(row.water);
      expect(p.weatherParticles, level).toBe(row.particles);
      expect(p.particleLights, level).toBe(row.particleLights);
      expect(p.bloom, level).toBe(true);
      expect(p.fog, level).toBe(true);
      expect(Object.keys(p).sort()).toEqual([...QUALITY_DETAIL_KEYS].sort());
    }
  });

  it('Punktlichter verdoppeln sich von Stufe zu Stufe, keine Stufe ist schwächer als die vorige', () => {
    const shadowRank = { sun: 0, hard: 1, soft: 2 } as const;
    const waterRank = { simple: 0, noReflection: 1, full: 2 } as const;
    for (let i = 1; i < QUALITY_LEVELS.length; i++) {
      const a = QUALITY_PRESETS[QUALITY_LEVELS[i - 1] as QualityLevel];
      const b = QUALITY_PRESETS[QUALITY_LEVELS[i] as QualityLevel];
      expect(b.maxLights).toBe(a.maxLights * 2);
      expect(shadowRank[b.shadows]).toBeGreaterThanOrEqual(shadowRank[a.shadows]);
      expect(waterRank[b.water]).toBeGreaterThanOrEqual(waterRank[a.water]);
    }
  });

  it('GI hat seinen Platz: nur Ultra verlangt es, berechnet wird es erst mit M13', () => {
    for (const level of QUALITY_LEVELS) {
      const g = applyQualityPreset(defaultSettings().graphics, level);
      const q = renderQualityFrom({ graphics: g, accessibility: defaultSettings().accessibility });
      expect(q.gi.requested, level).toBe(level === 'ultra');
      expect(q.gi.requested).toBe(isGiActive(g));
      expect(q.gi.available).toBe(false);
    }
    expect(GI_AVAILABLE).toBe(false);
  });

  it('Lichtstrahlen sind keine tote Einstellung: weder im Schema noch in der Tabelle noch in den Texten (kommen mit M13-04)', () => {
    expect(Object.keys(settingsSchema.shape.graphics.shape)).not.toContain('godRays');
    for (const level of QUALITY_LEVELS) expect(Object.keys(QUALITY_PRESETS[level])).not.toContain('godRays');
    for (const lang of ['de', 'en'] as const) expect(createI18n(lang).has('settings.graphics.godRays', lang)).toBe(false);
    // A stored profile from an older build that still carries the key loads without complaint.
    const storage = new Map<string, string>([['duskhearth.settings', JSON.stringify({ v: 1, settings: { graphics: { godRays: true, quality: 'medium' } } })]]);
    const store = createSettingsStore({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v) }, { autoSave: false });
    expect(store.issues).toEqual([]);
    expect(store.get().graphics.quality).toBe('medium');
    expect(Object.keys(store.get().graphics)).not.toContain('godRays');
  });

  it('eine Stufe wählen bringt ihre Voreinstellung mit; einzelne Optionen danach machen sie „angepasst“', () => {
    const store = createSettingsStore(null, { autoSave: false });
    store.update(qualityPatch('low'));
    expect(store.issues).toEqual([]);
    expect(store.get().graphics).toMatchObject({ quality: 'low', ...QUALITY_PRESETS.low });
    expect(matchesQualityPreset(store.get().graphics)).toBe(true);
    store.update({ graphics: { water: 'full' } });
    expect(matchesQualityPreset(store.get().graphics)).toBe(false);
    expect(renderQualityFrom(store.get()).preset).toBe(false);
  });

  it('erkennt, wenn nur die Stufe gewechselt wurde (dann folgt ihre Voreinstellung)', () => {
    const g = defaultSettings().graphics;
    expect(levelChosenAlone({ ...g, quality: 'low' }, g)).toBe(true);
    expect(levelChosenAlone(applyQualityPreset(g, 'low'), g)).toBe(false);
    expect(levelChosenAlone({ ...g, shadows: 'hard' }, g)).toBe(false);
    expect(levelChosenAlone(g, g)).toBe(false);
  });
});
