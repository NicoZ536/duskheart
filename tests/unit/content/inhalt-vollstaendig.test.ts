/**
 * M7-129: the remaining content that the production build still parsed with zod (ADR-0307 "Folgen") is authored complete.
 * - The SFX presets are completed by `completeSfxPreset` and checked against the schema in mode `voll`: zod's result equals
 *   the completed record for every preset of every group, and mode `vertraut` hands out the same records (key order
 *   included) without zod.
 * - The drops of the world objects write their occasion out: `worldObjectDropSchema` and `worldObjectSchema` are checking
 *   schemas (`shapesOutput` false), so the collection reads unchecked in the production build.
 */
import { describe, expect, it } from 'vitest';
import { contentDifference, shapesOutput } from '../../../src/content/check';
import { completeSfxPreset, defineSfxGroup, SFX_DEFAULTS, SFX_GROUPS, SfxGroupError, schlag, sfxPresetSchema, ton, type SfxPresetInput } from '../../../src/content/sfx/index';
import { WORLD_OBJECTS, worldObjectDropSchema, worldObjectSchema } from '../../../src/content/worldObjects';

describe('SFX-Presets vollständig verfasst (M7-129)', () => {
  it('completeSfxPreset equals the schema for every preset, and mode vertraut gives the records of mode voll', () => {
    let presets = 0;
    for (const [group, records] of Object.entries(SFX_GROUPS)) {
      for (const p of records) {
        // The group records are the completed ones: the schema changes nothing about them (zod orders keys by its shape; the
        // game holds the completed record in both modes, so the key order the registries compare is the same – inhalt-vertraut.fast).
        const again = sfxPresetSchema.parse(p);
        expect(contentDifference(again, p), `${group}: ${p.id}`).toBeNull();
        expect(Object.isFrozen(p), `${group}: ${p.id}`).toBe(true);
        presets++;
      }
    }
    expect(presets).toBeGreaterThan(500);
  });

  it('a group defined in mode vertraut holds the same records as in mode voll, frozen, without zod', () => {
    const raw: SfxPresetInput[] = [
      { id: 'sfx_probe_knapp', bus: 'effekte', lautstaerke: 0.5, schichten: [{ quelle: ton('sinus', 440), huelle: schlag(0.01, 0.1) }] },
      {
        id: 'sfx_probe_voll',
        bus: 'ui',
        lautstaerke: 0.3,
        varianten: 3,
        streuung: { tonhoehe: 50 },
        reichweite: 12,
        schichten: [{ quelle: ton('rechteck', 200, 100), huelle: { anschlag: 0.01, abfall: 0.2, halten: 0.5, haltezeit: 0.1, ausklang: 0.1 }, filter: { art: 'tiefpass', frequenz: 2000 }, wiederholung: { anzahl: 3, abstand: 0.1 }, pegel: 0.7 }],
      },
    ];
    const voll = defineSfxGroup('probe', raw, 'voll');
    const vertraut = defineSfxGroup('probe', raw, 'vertraut');
    expect(JSON.stringify(vertraut)).toBe(JSON.stringify(voll));
    expect(vertraut).toStrictEqual(voll);
    expect(Object.isFrozen(vertraut[1]?.schichten[0]?.filter)).toBe(true);
    const full = voll[1] as (typeof voll)[number];
    expect([full.varianten, full.streuung, full.reichweite, full.stimmen, full.sperrzeit]).toEqual([3, { tonhoehe: 50, lautstaerke: 0, klang: 0 }, 12, SFX_DEFAULTS.preset.stimmen, SFX_DEFAULTS.preset.sperrzeit]);
    expect([full.schichten[0]?.start, full.schichten[0]?.gleiten, full.schichten[0]?.huelle.kurve, full.schichten[0]?.filter?.resonanz, full.schichten[0]?.wiederholung]).toEqual([0, 'exponentiell', 2, 0.707, { anzahl: 3, abstand: 0.1, abfall: 1, tonhoehe: 1 }]);
  });

  it('mode voll rejects a preset the schema rejects, and names a completion that differs from the schema', () => {
    const bad: SfxPresetInput = { id: 'sfx_probe_leer', bus: 'effekte', lautstaerke: 0.5, schichten: [] };
    expect(() => defineSfxGroup('probe', [bad], 'voll')).toThrow(SfxGroupError);
    // A completion drifting from the schema's default is caught in mode voll (the probe of M7-129).
    const complete = completeSfxPreset({ id: 'sfx_probe_ton', bus: 'effekte', lautstaerke: 0.5, schichten: [{ quelle: ton('sinus', 440), huelle: schlag(0.01, 0.1) }] });
    expect(contentDifference(sfxPresetSchema.parse(complete), complete)).toBeNull();
    const drifted = { ...complete, stimmen: complete.stimmen + 1 };
    expect(contentDifference(sfxPresetSchema.parse({ id: complete.id, bus: complete.bus, lautstaerke: complete.lautstaerke, schichten: complete.schichten }), drifted)).toEqual(['stimmen']);
  });
});

describe('Welt-Drops ausgeschrieben (M7-129)', () => {
  it('every drop names its occasion; the world-object schemas only check (no default to fill in the production build)', () => {
    expect(shapesOutput(worldObjectDropSchema)).toBe(false);
    expect(shapesOutput(worldObjectSchema)).toBe(false);
    let drops = 0;
    for (const o of WORLD_OBJECTS) {
      for (const d of o.drops ?? []) {
        expect(['abbau', 'roden', 'ernte'], `${o.id}: ${d.item}`).toContain(d.anlass);
        drops++;
      }
    }
    expect(drops).toBeGreaterThan(40);
    expect(worldObjectDropSchema.safeParse({ item: 'holz', min: 1, max: 2 }).success).toBe(false);
  });
});
