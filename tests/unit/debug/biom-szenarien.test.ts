/**
 * M5-29 Biom-Serie (src/debug/biomScenarios.ts): jedes Oberflächenbiom des Weltgenerators hat seine drei Bilder
 * Tag, Dämmerung und Nacht, registriert in der Szenarienliste; die Uhrzeiten kommen aus dem Kalender der Jahreszeit
 * (Dämmerung 45 min nach dem Sonnenuntergang).
 */
import { describe, expect, it } from 'vitest';
import { BIOMES } from '../../../src/content/biomes';
import { biomPictureMinute, biomScenarios } from '../../../src/debug/biomScenarios';
import { findScenario } from '../../../src/debug/scenarios';
import { dayTimes } from '../../../src/world/calendar';

describe('Biom-Serie M5-29', () => {
  it('drei Bilder je Oberflächenbiom, jedes registriert', () => {
    const surface = BIOMES.filter((b) => b.layer === 0).map((b) => b.id);
    expect(surface.length).toBeGreaterThanOrEqual(8);
    const names = biomScenarios().map((s) => s.name);
    expect(names).toHaveLength(surface.length * 3);
    for (const id of surface) {
      for (const t of ['tag', 'daemmerung', 'nacht']) {
        const name = `biom-${id}-${t}`;
        expect(names).toContain(name);
        expect(findScenario(name)?.name).toBe(name);
      }
    }
  });

  it('Uhrzeiten nach dem Kalender: Tag 12:00, Dämmerung 45 min nach Sonnenuntergang, Nacht 23:00', () => {
    expect(biomPictureMinute('sommer', 'tag')).toBe(12 * 60);
    expect(biomPictureMinute('fruehling', 'daemmerung')).toBe(18 * 60 + 45);
    expect(biomPictureMinute('sommer', 'daemmerung')).toBe(20 * 60 + 15);
    expect(biomPictureMinute('winter', 'daemmerung')).toBe(17 * 60 + 15);
    for (const season of ['fruehling', 'sommer', 'herbst', 'winter'] as const) {
      const t = dayTimes(season);
      const dusk = biomPictureMinute(season, 'daemmerung') / 60;
      expect(dusk).toBeGreaterThan(t.sunset);
      expect(dusk).toBeLessThan(t.duskEnd);
      expect(biomPictureMinute(season, 'nacht') / 60).toBeGreaterThanOrEqual(t.duskEnd);
    }
  });
});
