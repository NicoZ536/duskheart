import { describe, expect, it } from 'vitest';
import { BindingSet } from '../../../src/engine/input/bindings';
import {
  QUALITY_PRESETS,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  SETTING_CHOICES,
  SETTING_RANGES,
  applyQualityPreset,
  createSettingsStore,
  defaultSettings,
  detectLanguage,
  isGiActive,
  parseStoredSettings,
  settingsSchema,
  type Settings,
  type SettingsStorage,
} from '../../../src/engine/settings';

class MemoryStorage implements SettingsStorage {
  readonly data = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes++;
    this.data.set(key, value);
  }
}

function stored(storage: MemoryStorage): { v: number; settings: Settings } {
  return JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY) ?? 'null') as { v: number; settings: Settings };
}

describe('settings defaults', () => {
  it('are valid against the schema and follow the spec', () => {
    const d = defaultSettings();
    expect(settingsSchema.safeParse(d).success).toBe(true);
    expect(d.graphics.quality).toBe('high');
    expect(d.graphics.crt).toBe(false);
    expect(d.graphics.maxLights).toBe(128);
    expect(d.game.autosaveMinutes).toBe(3);
    expect(d.game.hudMode).toBe('full');
    expect(d.language).toBe('de');
    expect(d.accessibility.uiScale).toBe('auto');
    expect(d.accessibility.gameSpeed).toBe(1);
    expect(d.controls.bindings).toEqual({});
  });

  it('pick English only for en* browser languages', () => {
    expect(detectLanguage('en-US')).toBe('en');
    expect(detectLanguage(['en-GB', 'de'])).toBe('en');
    expect(detectLanguage('de-AT')).toBe('de');
    expect(detectLanguage('fr')).toBe('de');
    expect(detectLanguage(undefined)).toBe('de');
    expect(detectLanguage('eng')).toBe('de');
    expect(defaultSettings({ navigatorLanguage: 'en' }).language).toBe('en');
  });

  it('quality presets follow the §6.3 table', () => {
    expect(QUALITY_PRESETS.low).toMatchObject({ maxLights: 32, shadows: 'sun', gi: false, weatherParticles: 'reduced' });
    expect(QUALITY_PRESETS.medium).toMatchObject({ maxLights: 64, shadows: 'hard', water: 'noReflection' });
    expect(QUALITY_PRESETS.ultra).toMatchObject({ maxLights: 256, gi: true, particleLights: true });
    const g = applyQualityPreset(defaultSettings().graphics, 'ultra');
    expect(g.quality).toBe('ultra');
    expect(isGiActive(g)).toBe(true);
    expect(isGiActive({ ...g, quality: 'high' })).toBe(false);
  });

  it('choice lists and ranges match the schema', () => {
    const d = defaultSettings() as unknown as Record<string, Record<string, unknown>>;
    for (const path of Object.keys(SETTING_CHOICES)) {
      const [section, field] = path.split('.');
      const value = field ? d[section ?? '']?.[field] : (d as Record<string, unknown>)[section ?? ''];
      expect(SETTING_CHOICES[path as keyof typeof SETTING_CHOICES] as readonly unknown[]).toContain(value);
    }
    for (const [path, r] of Object.entries(SETTING_RANGES)) {
      const [section, field] = path.split('.');
      const value = d[section ?? '']?.[field ?? ''];
      expect(typeof value, path).toBe('number');
      expect(value as number).toBeGreaterThanOrEqual(r.min);
      expect(value as number).toBeLessThanOrEqual(r.max);
    }
  });
});

describe('settings store', () => {
  it('works without storage (private mode)', () => {
    const store = createSettingsStore(null);
    expect(store.get()).toEqual(defaultSettings());
    expect(store.save()).toBe(false);
    store.update({ audio: { music: 0.2 } });
    expect(store.get().audio.music).toBe(0.2);
  });

  it('roundtrips through storage', () => {
    const storage = new MemoryStorage();
    const a = createSettingsStore(storage);
    a.update({ graphics: { quality: 'low', fpsLimit: 144 }, language: 'en', accessibility: { uiScale: 3 } });
    expect(stored(storage).v).toBe(SETTINGS_VERSION);
    const b = createSettingsStore(storage);
    expect(b.get()).toEqual(a.get());
    expect(b.get().graphics.fpsLimit).toBe(144);
    expect(b.issues).toEqual([]);
  });

  it('deep update merges nested fields and keeps the rest', () => {
    const store = createSettingsStore(null);
    const before = store.get();
    store.update({ controls: { sprintMode: 'toggle' }, game: { autosaveMinutes: 5 } });
    const after = store.get();
    expect(after.controls.sprintMode).toBe('toggle');
    expect(after.controls.sneakMode).toBe(before.controls.sneakMode);
    expect(after.controls.vibration).toBe(before.controls.vibration);
    expect(after.game.autosaveMinutes).toBe(5);
    expect(after.game.hints).toBe(before.game.hints);
    expect(after.graphics).toEqual(before.graphics);
  });

  it('ignores invalid fields in an update and reports them', () => {
    const store = createSettingsStore(null);
    store.update({ audio: { master: 3, music: 0.5 }, game: { autosaveMinutes: 2.5 } } as never);
    expect(store.get().audio.master).toBe(0.8);
    expect(store.get().audio.music).toBe(0.5);
    expect(store.get().game.autosaveMinutes).toBe(3);
    expect([...store.issues].sort()).toEqual(['audio.master', 'game.autosaveMinutes']);
  });

  it('reports unknown paths in an update (typos) but ignores retired keys in storage', () => {
    const store = createSettingsStore(null);
    const before = store.get();
    store.update({ audio: { mastr: 0.1 }, gfx: { quality: 'low' } } as never);
    expect(store.get()).toEqual(before);
    expect([...store.issues].sort()).toEqual(['audio.mastr', 'gfx']);

    const storage = new Map<string, string>();
    storage.set('duskhearth.settings', JSON.stringify({ v: 1, settings: { audio: { master: 0.3, retired: true }, oldSection: {} } }));
    const loaded = createSettingsStore({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) });
    expect(loaded.get().audio.master).toBe(0.3);
    expect(loaded.issues).toEqual([]);
  });

  it('falls back field by field on corrupt storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        settings: {
          graphics: { quality: 'insane', crt: true, fpsLimit: 75 },
          audio: 'loud',
          language: 'en',
          accessibility: { textScale: 1.5, gameSpeed: 0.1 },
          unknownSection: { x: 1 },
        },
      }),
    );
    const store = createSettingsStore(storage);
    const s = store.get();
    const d = defaultSettings();
    expect(s.graphics.quality).toBe(d.graphics.quality);
    expect(s.graphics.crt).toBe(true);
    expect(s.graphics.fpsLimit).toBe(d.graphics.fpsLimit);
    expect(s.audio).toEqual(d.audio);
    expect(s.language).toBe('en');
    expect(s.accessibility.textScale).toBe(1.5);
    expect(s.accessibility.gameSpeed).toBe(1);
    expect([...store.issues].sort()).toEqual(['accessibility.gameSpeed', 'audio', 'graphics.fpsLimit', 'graphics.quality']);
    expect(settingsSchema.safeParse(s).success).toBe(true);
  });

  it('survives unreadable JSON and throwing storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, '{not json');
    expect(createSettingsStore(storage).get()).toEqual(defaultSettings());
    expect(createSettingsStore(storage).issues).toEqual(['(root)']);

    const errors: unknown[] = [];
    const broken: SettingsStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = createSettingsStore(broken, { onError: (e) => errors.push(e) });
    expect(store.get()).toEqual(defaultSettings());
    expect(store.save()).toBe(false);
    expect(errors).toHaveLength(2);
  });

  it('keeps binding overrides and sanitizes invalid ones', () => {
    const storage = new MemoryStorage();
    const bindings = new BindingSet();
    bindings.rebind('roll', { kind: 'key', code: 'KeyV' }, { replace: { kind: 'key', code: 'Space' } });
    const store = createSettingsStore(storage);
    store.update({ controls: { bindings: bindings.serialize() } });
    const reloaded = createSettingsStore(storage);
    expect(BindingSet.deserialize(reloaded.get().controls.bindings).get('roll')).toContainEqual({ kind: 'key', code: 'KeyV' });

    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ v: 1, settings: { controls: { bindings: { roll: [{ kind: 'bogus' }], nope: [], settlers: [] } } } }),
    );
    // Garbage-only lists fall back to the default; an intentionally empty list stays unbound.
    expect(createSettingsStore(storage).get().controls.bindings).toEqual({ settlers: [] });
  });

  it('replaces the bindings record on update instead of merging it', () => {
    const store = createSettingsStore(null);
    store.update({ controls: { bindings: { roll: [{ kind: 'key', code: 'KeyV' }] } } });
    store.update({ controls: { bindings: {} } });
    expect(store.get().controls.bindings).toEqual({});
  });

  it('notifies subscribers only on real changes and supports unsubscribe', () => {
    const store = createSettingsStore(null);
    const seen: Array<[number, number]> = [];
    const off = store.subscribe((next, prev) => seen.push([next.audio.music, prev.audio.music]));
    store.update({ audio: { music: 0.3 } });
    store.update({ audio: { music: 0.3 } });
    off();
    store.update({ audio: { music: 0.4 } });
    expect(seen).toEqual([[0.3, 0.7]]);
  });

  it('resets one section or everything', () => {
    const storage = new MemoryStorage();
    const store = createSettingsStore(storage);
    store.update({ audio: { master: 0.1 }, game: { hints: false } });
    store.reset('audio');
    expect(store.get().audio.master).toBe(0.8);
    expect(store.get().game.hints).toBe(false);
    store.reset();
    expect(store.get()).toEqual(defaultSettings());
    expect(stored(storage).settings).toEqual(defaultSettings());
  });

  it('respects autoSave=false', () => {
    const storage = new MemoryStorage();
    const store = createSettingsStore(storage, { autoSave: false });
    store.update({ audio: { sfx: 0.1 } });
    expect(storage.writes).toBe(0);
    expect(store.save()).toBe(true);
    expect(storage.writes).toBe(1);
  });

  it('runs migrations for older versions and accepts unversioned data', () => {
    const legacy = JSON.stringify({ v: 0, settings: { lang: 'en', audio: { master: 0.5 } } });
    const result = parseStoredSettings(legacy, defaultSettings(), [
      {
        from: 0,
        migrate: (data) => {
          const { lang, ...rest } = data;
          return { ...rest, language: lang };
        },
      },
    ]);
    expect(result.storedVersion).toBe(0);
    expect(result.settings.language).toBe('en');
    expect(result.settings.audio.master).toBe(0.5);

    const bare = parseStoredSettings(JSON.stringify({ language: 'en' }), defaultSettings());
    expect(bare.settings.language).toBe('en');
    expect(bare.storedVersion).toBe(1);

    const failing = parseStoredSettings(legacy, defaultSettings(), [
      {
        from: 0,
        migrate: () => {
          throw new Error('broken');
        },
      },
    ]);
    expect(failing.issues).toContain('(migration 0)');
    expect(failing.settings.audio.master).toBe(0.5);
  });
});
