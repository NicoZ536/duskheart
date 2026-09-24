/**
 * M3-33 "Schema-Test der Presets": every SFX preset is valid data (zod), ids follow docs/SPIEL.md §5, the
 * schema refuses broken recipes, and every SFX id the game refers to – the sound tables of the game
 * modules, item `sounds`, condition `sound`s, the footsteps of every ground, the hits of every harvest
 * material – has its preset.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { FOOTSTEP_MATERIALS } from '../../../src/content/terrain';
import {
  SFX_GROUPS,
  SFX_MAX_SECONDS,
  SFX_PRESETS,
  SfxGroupError,
  defineSfxGroup,
  footstepSfxId,
  schlag,
  sfxConventionIds,
  sfxPresetSchema,
  sfxPresetSeconds,
  ton,
  type SfxPresetInput,
} from '../../../src/content/sfx/index';
import { SFX_ID_PATTERN } from '../../../src/content/schema/item';
import { GATHERING_SFX } from '../../../src/game/gathering/events';
import { HARVEST_MATERIALS } from '../../../src/game/gathering/rules';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const IDS = new Set(SFX_PRESETS.map((p) => p.id));

/** A valid minimal preset to break in the refusal tests. */
function base(): SfxPresetInput {
  return { id: 'sfx_test_ton', bus: 'effekte', lautstaerke: 0.5, schichten: [{ quelle: ton('sinus', 440), huelle: schlag(0.01, 0.1) }] };
}

/** Every `.ts` file below `dir`. */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('SFX-Presets: Schema', () => {
  it('liefert mindestens 60 Presets in Gruppen, jede Id einmal', () => {
    expect(SFX_PRESETS.length).toBeGreaterThanOrEqual(60);
    expect(IDS.size).toBe(SFX_PRESETS.length);
    expect(Object.values(SFX_GROUPS).reduce((n, g) => n + g.length, 0)).toBe(SFX_PRESETS.length);
  });

  it('jedes Preset besteht das Schema erneut unverändert und trägt eine Id sfx_<bereich>_<name>', () => {
    for (const p of SFX_PRESETS) {
      expect(p.id, p.id).toMatch(SFX_ID_PATTERN);
      const again = sfxPresetSchema.safeParse(p);
      expect(again.success, p.id).toBe(true);
      expect(again.data).toEqual(p);
      expect(Object.isFrozen(p)).toBe(true);
    }
  });

  it('One-Shots bleiben unter der Höchstdauer, Schleifen haben ihre Länge', () => {
    for (const p of SFX_PRESETS) {
      const s = sfxPresetSeconds(p);
      if (p.schleife === undefined) {
        expect(s, p.id).toBeGreaterThan(0.02);
        expect(s, p.id).toBeLessThanOrEqual(SFX_MAX_SECONDS);
      } else expect(s, p.id).toBe(p.schleife.dauer);
    }
  });

  it('Untertitel sind zweisprachig, Warnungen und schlechte Zustände haben welche (§27 Barrierefreiheit)', () => {
    for (const p of SFX_PRESETS) {
      if (p.untertitel === undefined) continue;
      expect(p.untertitel.de.trim(), p.id).not.toBe('');
      expect(p.untertitel.en.trim(), p.id).not.toBe('');
    }
    const important = [
      'sfx_spieler_magenknurren',
      'sfx_spieler_keuchen',
      'sfx_spieler_zittern',
      'sfx_spieler_ertrinken',
      'sfx_spieler_knochenbruch',
      'sfx_inventar_voll',
      'sfx_tod_erloschen',
      'sfx_baum_aufprall',
      'sfx_furcht_nachtmahr',
      'sfx_zustand_blutung',
      'sfx_zustand_vergiftung',
      'sfx_zustand_brennen',
    ];
    for (const id of important) expect(SFX_PRESETS.find((p) => p.id === id)?.untertitel, id).toBeDefined();
  });

  it('lehnt kaputte Rezepte ab', () => {
    const bad: Array<[string, unknown]> = [
      ['Id ohne Bereich', { ...base(), id: 'sfx_ton' }],
      ['Id in Großbuchstaben', { ...base(), id: 'sfx_Test_ton' }],
      ['keine Schicht', { ...base(), schichten: [] }],
      ['sieben Schichten', { ...base(), schichten: Array.from({ length: 7 }, () => base().schichten[0]) }],
      ['unbekannter Bus', { ...base(), bus: 'lautsprecher' }],
      ['Lautstärke über 1', { ...base(), lautstaerke: 1.5 }],
      ['Frequenz über der Obergrenze', { ...base(), schichten: [{ quelle: ton('sinus', 20000), huelle: schlag(0.01, 0.1) }] }],
      ['Tastgrad auf Sinus', { ...base(), schichten: [{ quelle: { art: 'welle', form: 'sinus', frequenz: 440, tastgrad: 0.25 }, huelle: schlag(0.01, 0.1) }] }],
      ['Hüllkurve ohne Länge', { ...base(), schichten: [{ quelle: ton('sinus', 440), huelle: schlag(0, 0) }] }],
      ['One-Shot länger als 4 s', { ...base(), schichten: [{ quelle: ton('sinus', 440), huelle: schlag(0.01, 4.5) }] }],
      ['unbekanntes Feld', { ...base(), hall: 0.5 }],
      ['Untertitel nur deutsch', { ...base(), untertitel: { de: 'Ton', en: '' } }],
      ['zu viele Varianten', { ...base(), varianten: 9 }],
      ['FM-Seitenbänder über Nyquist (Aliasing)', { ...base(), schichten: [{ quelle: { art: 'fm', frequenz: 920, verhaeltnis: 3.3, index: 6 }, huelle: schlag(0.01, 0.1) }] }],
    ];
    for (const [label, preset] of bad) expect(sfxPresetSchema.safeParse(preset).success, label).toBe(false);
    expect(sfxPresetSchema.safeParse(base()).success).toBe(true);
  });

  it('defineSfxGroup nennt Gruppe und Preset und verbietet doppelte Ids', () => {
    expect(() => defineSfxGroup('probe', [{ ...base(), lautstaerke: 3 }])).toThrow(/probe.*sfx_test_ton.*lautstaerke/);
    expect(() => defineSfxGroup('probe', [base(), base()])).toThrow(SfxGroupError);
  });

  it('die Registry zählt jedes Preset als §C-Kategorie sfx', () => {
    // Registered in src/content/index.ts; the validator enforces tools/validator/zielwerte.json.
    expect(CONTENT.countsByCategory().sfx).toBe(SFX_PRESETS.length);
  });
});

describe('SFX-Presets: Abdeckung der Ids', () => {
  it('jede SFX-Id, die src/ außerhalb der Presets nennt, hat ihr Preset', () => {
    const missing: string[] = [];
    const sourceDir = join(ROOT, 'src/content/sfx');
    for (const file of tsFiles(join(ROOT, 'src'))) {
      if (file.startsWith(sourceDir)) continue;
      for (const m of readFileSync(file, 'utf8').matchAll(/(['"`])(sfx_[a-z0-9]+(?:_[a-z0-9]+)+)\1/g)) {
        const id = m[2] ?? '';
        if (!IDS.has(id)) missing.push(`${relative(ROOT, file)}: ${id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('Items und Zustände nennen nur vorhandene Presets', () => {
    for (const item of CONTENT.collection('items').values()) {
      expect(IDS.has(item.sounds.aufheben), item.id).toBe(true);
      if (item.sounds.benutzen !== undefined) expect(IDS.has(item.sounds.benutzen), item.id).toBe(true);
    }
    for (const c of CONTENT.collection('conditions').values()) expect(IDS.has(c.sound), c.id).toBe(true);
  });

  it('Schritte je Untergrund (§27): jedes Bodenmaterial, Holzböden und Waten', () => {
    for (const m of [...FOOTSTEP_MATERIALS, 'holz', 'wasser'] as const) expect(IDS.has(footstepSfxId(m)), m).toBe(true);
    expect(sfxConventionIds()).toEqual(FOOTSTEP_MATERIALS.map((m) => footstepSfxId(m)));
    // Every walkable terrain has a footstep material, hence a step sound.
    for (const t of CONTENT.collection('terrain').values()) if (t.walkable) expect(t.footstep, t.id).not.toBeNull();
  });

  it('Werkzeugtreffer je Material (§14): jedes Erntematerial hat seinen Treffer', () => {
    for (const m of HARVEST_MATERIALS) expect(IDS.has(GATHERING_SFX.hit[m]), m).toBe(true);
  });
});
