/**
 * Player settings (MASTERPROMPT §29 Einstellungen/Barrierefreiheit, §26 HUD
 * modes, §27 audio buses, §6.3 quality levels). Stored separately from saves
 * in localStorage (§28); the storage object is injected so this module runs
 * headless and never touches DOM globals.
 */
import { z } from 'zod';
import { serializedBindingsSchema } from './input/bindings';

/** Current persisted format version. Bump together with a migration in `SETTINGS_MIGRATIONS`. */
export const SETTINGS_VERSION = 1;
/** localStorage key. */
export const SETTINGS_STORAGE_KEY = 'duskhearth.settings';

// ---------------------------------------------------------------------------
// Choices and ranges (shared by the schema, the settings screen and i18n keys)

export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];
export const SCALE_MODES = ['sharp', 'pixelPerfect'] as const;
export const FPS_LIMITS = [0, 30, 60, 120, 144, 165] as const;
export const SHADOW_MODES = ['sun', 'hard', 'soft'] as const;
export const WATER_MODES = ['simple', 'noReflection', 'full'] as const;
export const WEATHER_PARTICLE_MODES = ['reduced', 'full'] as const;
export const MAX_LIGHT_COUNTS = [32, 64, 128, 256] as const;
export const ACTIVATION_MODES = ['hold', 'toggle'] as const;
export const HUD_MODES = ['full', 'contextual', 'minimal'] as const;
export const LANGUAGES = ['de', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const COLORBLIND_MODES = ['none', 'protanopia', 'deuteranopia', 'tritanopia'] as const;
export const UI_SCALES = ['auto', 1, 2, 3, 4] as const;

/** Discrete choices per setting path ("section.field"); each value has an i18n key `settings.<path>.<value>`. */
export const SETTING_CHOICES = {
  'graphics.quality': QUALITY_LEVELS,
  'graphics.scaleMode': SCALE_MODES,
  'graphics.fpsLimit': FPS_LIMITS,
  'graphics.shadows': SHADOW_MODES,
  'graphics.water': WATER_MODES,
  'graphics.weatherParticles': WEATHER_PARTICLE_MODES,
  'graphics.maxLights': MAX_LIGHT_COUNTS,
  'controls.sprintMode': ACTIVATION_MODES,
  'controls.sneakMode': ACTIVATION_MODES,
  'controls.blockMode': ACTIVATION_MODES,
  'game.hudMode': HUD_MODES,
  language: LANGUAGES,
  'accessibility.colorblind': COLORBLIND_MODES,
  'accessibility.uiScale': UI_SCALES,
} as const satisfies Record<string, readonly (string | number)[]>;

export interface SettingRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** Slider ranges per setting path. */
export const SETTING_RANGES = {
  'graphics.lightBands': { min: 6, max: 10, step: 1 }, // §6.1: 6–10 light bands
  'audio.master': { min: 0, max: 1, step: 0.05 },
  'audio.music': { min: 0, max: 1, step: 0.05 },
  'audio.sfx': { min: 0, max: 1, step: 0.05 },
  'audio.ambience': { min: 0, max: 1, step: 0.05 },
  'audio.ui': { min: 0, max: 1, step: 0.05 },
  'controls.mouseSensitivity': { min: 0.25, max: 3, step: 0.05 },
  'controls.stickSensitivity': { min: 0.25, max: 3, step: 0.05 },
  'controls.stickDeadzone': { min: 0.05, max: 0.5, step: 0.01 },
  'game.autosaveMinutes': { min: 1, max: 10, step: 1 }, // §28: default every 3 min
  'accessibility.textScale': { min: 1, max: 2, step: 0.1 },
  'accessibility.screenshake': { min: 0, max: 1, step: 0.05 }, // §29: 0–100 %
  'accessibility.gameSpeed': { min: 0.5, max: 1, step: 0.05 }, // §29: 50–100 %
} as const satisfies Record<string, SettingRange>;

function range(path: keyof typeof SETTING_RANGES): z.ZodNumber {
  const r = SETTING_RANGES[path];
  return z.number().min(r.min).max(r.max);
}
function literals<const T extends readonly (string | number)[]>(values: T): z.ZodType<T[number]> {
  return z.custom<T[number]>((v) => (values as readonly unknown[]).includes(v));
}

// ---------------------------------------------------------------------------
// Schema

export const graphicsSchema = z.object({
  quality: z.enum(QUALITY_LEVELS),
  /** True once the first-start benchmark chose the quality level. */
  autoDetected: z.boolean(),
  lightBanding: z.boolean(),
  lightBands: range('graphics.lightBands').int(),
  dither: z.boolean(),
  scaleMode: z.enum(SCALE_MODES),
  /** 0 = unlimited (display refresh rate). */
  fpsLimit: literals(FPS_LIMITS),
  vsync: z.boolean(),
  crt: z.boolean(),
  bloom: z.boolean(),
  fog: z.boolean(),
  godRays: z.boolean(),
  weatherParticles: z.enum(WEATHER_PARTICLE_MODES),
  shadows: z.enum(SHADOW_MODES),
  /** Radiance-cascade GI; only effective at quality "ultra". */
  gi: z.boolean(),
  water: z.enum(WATER_MODES),
  maxLights: literals(MAX_LIGHT_COUNTS),
  particleLights: z.boolean(),
  /** Halve the light buffer dynamically when frames drop (§6.3). */
  adaptiveLightBuffer: z.boolean(),
});

export const audioSchema = z.object({
  master: range('audio.master'),
  music: range('audio.music'),
  sfx: range('audio.sfx'),
  ambience: range('audio.ambience'),
  ui: range('audio.ui'),
  subtitles: z.boolean(),
  visualSoundCues: z.boolean(),
});

export const controlsSchema = z.object({
  /** Binding overrides (only actions that differ from the defaults). */
  bindings: serializedBindingsSchema,
  mouseSensitivity: range('controls.mouseSensitivity'),
  stickSensitivity: range('controls.stickSensitivity'),
  stickDeadzone: range('controls.stickDeadzone'),
  sprintMode: z.enum(ACTIVATION_MODES),
  sneakMode: z.enum(ACTIVATION_MODES),
  blockMode: z.enum(ACTIVATION_MODES),
  vibration: z.boolean(),
  aimAssist: z.boolean(),
});

export const gameSettingsSchema = z.object({
  hudMode: z.enum(HUD_MODES),
  damageNumbers: z.boolean(),
  hints: z.boolean(),
  funkeComments: z.boolean(),
  autosaveMinutes: range('game.autosaveMinutes').int(),
  developerMode: z.boolean(),
});

export const accessibilitySchema = z.object({
  colorblind: z.enum(COLORBLIND_MODES),
  textScale: range('accessibility.textScale'),
  screenshake: range('accessibility.screenshake'),
  flashReduction: z.boolean(),
  reducedMotion: z.boolean(),
  gameSpeed: range('accessibility.gameSpeed'),
  uiScale: literals(UI_SCALES),
});

export const settingsSchema = z.object({
  graphics: graphicsSchema,
  audio: audioSchema,
  controls: controlsSchema,
  game: gameSettingsSchema,
  language: z.enum(LANGUAGES),
  accessibility: accessibilitySchema,
});

export type Settings = z.output<typeof settingsSchema>;
export type GraphicsSettings = Settings['graphics'];
export type SettingsSection = keyof Settings;

// ---------------------------------------------------------------------------
// Defaults & quality presets (§6.3 table)

type GraphicsDetail = Pick<
  GraphicsSettings,
  'shadows' | 'gi' | 'water' | 'weatherParticles' | 'maxLights' | 'particleLights' | 'bloom' | 'fog' | 'godRays'
>;

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, Readonly<GraphicsDetail>>> = {
  low: { shadows: 'sun', gi: false, water: 'simple', weatherParticles: 'reduced', maxLights: 32, particleLights: false, bloom: true, fog: true, godRays: false },
  medium: { shadows: 'hard', gi: false, water: 'noReflection', weatherParticles: 'full', maxLights: 64, particleLights: false, bloom: true, fog: true, godRays: true },
  high: { shadows: 'soft', gi: false, water: 'full', weatherParticles: 'full', maxLights: 128, particleLights: false, bloom: true, fog: true, godRays: true },
  ultra: { shadows: 'soft', gi: true, water: 'full', weatherParticles: 'full', maxLights: 256, particleLights: true, bloom: true, fog: true, godRays: true },
};

/** Set the quality level and all detail options of its preset. */
export function applyQualityPreset(graphics: GraphicsSettings, quality: QualityLevel): GraphicsSettings {
  return { ...graphics, ...QUALITY_PRESETS[quality], quality };
}

/** Whether GI actually runs (it needs the ultra pipeline). */
export function isGiActive(graphics: GraphicsSettings): boolean {
  return graphics.quality === 'ultra' && graphics.gi;
}

/** "de" unless the first supplied browser language is English. */
export function detectLanguage(navigatorLanguage?: string | readonly string[]): Language {
  const first = typeof navigatorLanguage === 'string' ? navigatorLanguage : navigatorLanguage?.[0];
  return first && /^en\b/i.test(first) ? 'en' : 'de';
}

export interface DefaultSettingsOptions {
  /** `navigator.language` / `navigator.languages`, injected by the caller. */
  readonly navigatorLanguage?: string | readonly string[];
}

export function defaultSettings(opts: DefaultSettingsOptions = {}): Settings {
  return {
    graphics: {
      quality: 'high',
      autoDetected: false,
      lightBanding: true,
      lightBands: 8,
      dither: true,
      scaleMode: 'sharp',
      fpsLimit: 0,
      vsync: true,
      crt: false,
      ...QUALITY_PRESETS.high,
      adaptiveLightBuffer: true,
    },
    audio: { master: 0.8, music: 0.7, sfx: 0.8, ambience: 0.7, ui: 0.6, subtitles: false, visualSoundCues: false },
    controls: {
      bindings: {},
      mouseSensitivity: 1,
      stickSensitivity: 1,
      stickDeadzone: 0.2,
      sprintMode: 'hold',
      // Toggle by default: holding Ctrl while pressing W would trigger the browser's close-tab shortcut.
      sneakMode: 'toggle',
      blockMode: 'hold',
      vibration: true,
      aimAssist: true,
    },
    game: { hudMode: 'full', damageNumbers: true, hints: true, funkeComments: true, autosaveMinutes: 3, developerMode: false },
    language: detectLanguage(opts.navigatorLanguage),
    accessibility: {
      colorblind: 'none',
      textScale: 1,
      screenshake: 1,
      flashReduction: false,
      reducedMotion: false,
      gameSpeed: 1,
      uiScale: 'auto',
    },
  };
}

// ---------------------------------------------------------------------------
// Schema-driven merge: field-by-field validation with fallback

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Merge `patch` onto `base` following the schema: objects are merged key by
 * key, every leaf is validated on its own. Invalid leaves keep the base value
 * and are reported in `issues` as dotted paths. With `reportUnknown`, keys the
 * schema does not know are reported too (typos in `update()`); stored data from
 * older builds may carry retired keys, so loading ignores them silently.
 */
function mergeBySchema(schema: z.ZodType, base: unknown, patch: unknown, path: string, issues: string[], reportUnknown: boolean): unknown {
  if (schema instanceof z.ZodObject && isPlainObject(base)) {
    if (!isPlainObject(patch)) {
      if (patch !== undefined) issues.push(path || '(root)');
      return base;
    }
    const shape = schema.shape as Record<string, z.ZodType>;
    const out: Record<string, unknown> = {};
    for (const [k, fieldSchema] of Object.entries(shape)) {
      const childPath = path ? `${path}.${k}` : k;
      out[k] = k in patch ? mergeBySchema(fieldSchema, base[k], patch[k], childPath, issues, reportUnknown) : base[k];
    }
    if (reportUnknown) {
      for (const k of Object.keys(patch)) if (!(k in shape)) issues.push(path ? `${path}.${k}` : k);
    }
    return out;
  }
  if (patch === undefined) return base;
  const parsed = schema.safeParse(patch);
  if (parsed.success) return parsed.data;
  issues.push(path);
  return base;
}

export interface SettingsMigration {
  /** Version the data has before this migration runs; the result has version `from + 1`. */
  readonly from: number;
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

/** Built-in migrations, ordered by `from`. Version 1 is the first released format. */
export const SETTINGS_MIGRATIONS: readonly SettingsMigration[] = [];

/** Envelope as stored in localStorage. */
interface StoredSettings {
  readonly v: number;
  readonly settings: Settings;
}

export interface SettingsLoadResult {
  readonly settings: Settings;
  /** Dotted paths that were invalid and fell back to defaults ("(root)" for unreadable data). */
  readonly issues: readonly string[];
  /** Version found in storage (0 = nothing stored). */
  readonly storedVersion: number;
}

/** Parse, migrate and validate raw stored text (pure; used by the store and tests). */
export function parseStoredSettings(
  text: string | null,
  defaults: Settings,
  migrations: readonly SettingsMigration[] = SETTINGS_MIGRATIONS,
): SettingsLoadResult {
  if (text === null) return { settings: defaults, issues: [], storedVersion: 0 };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { settings: defaults, issues: ['(root)'], storedVersion: 0 };
  }
  if (!isPlainObject(raw)) return { settings: defaults, issues: ['(root)'], storedVersion: 0 };

  // Unversioned data (bare settings object) is treated as version 1.
  const hasEnvelope = typeof raw.v === 'number' && isPlainObject(raw.settings);
  const storedVersion = hasEnvelope ? (raw.v as number) : 1;
  let data: Record<string, unknown> = hasEnvelope ? (raw.settings as Record<string, unknown>) : raw;
  const issues: string[] = [];
  const ordered = [...migrations].sort((a, b) => a.from - b.from);
  for (let v = storedVersion; v < SETTINGS_VERSION; v++) {
    const m = ordered.find((x) => x.from === v);
    if (!m) continue;
    try {
      data = m.migrate(data);
    } catch {
      issues.push(`(migration ${v})`);
    }
  }
  const merged = mergeBySchema(settingsSchema, defaults, data, '', issues, false);
  const final = settingsSchema.safeParse(merged);
  return final.success ? { settings: final.data, issues, storedVersion } : { settings: defaults, issues: [...issues, '(root)'], storedVersion };
}

// ---------------------------------------------------------------------------
// Store

/** Subset of the Web Storage API (localStorage in the browser, a Map-backed fake in tests). */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SettingsStoreOptions extends DefaultSettingsOptions {
  readonly key?: string;
  readonly migrations?: readonly SettingsMigration[];
  /** Persist automatically after every change (default true). */
  readonly autoSave?: boolean;
  /** Called with storage errors (quota, private mode); never thrown. */
  readonly onError?: (error: unknown) => void;
}

export type SettingsListener = (next: Settings, prev: Settings) => void;

export interface SettingsStore {
  /** Current settings (treat as immutable; changes go through `update`). */
  get(): Settings;
  /** Invalid (and, for `update()`, unknown) paths found by the last `load()` or `update()`. */
  readonly issues: readonly string[];
  /** Re-read from storage (validate, migrate, fall back field by field). */
  load(): Settings;
  /** Write to storage. Returns false if storage is unavailable or failed. */
  save(): boolean;
  /** Deep-merge a partial change; invalid or unknown fields are ignored (see `issues`). */
  update(patch: DeepPartial<Settings>): Settings;
  /** Restore defaults for one section or everything. */
  reset(section?: SettingsSection): Settings;
  subscribe(listener: SettingsListener): () => void;
}

export function createSettingsStore(storage: SettingsStorage | null, opts: SettingsStoreOptions = {}): SettingsStore {
  const key = opts.key ?? SETTINGS_STORAGE_KEY;
  const defaults = defaultSettings(opts);
  const migrations = opts.migrations ?? SETTINGS_MIGRATIONS;
  const autoSave = opts.autoSave ?? true;
  const listeners = new Set<SettingsListener>();
  let current = defaults;
  let issues: readonly string[] = [];

  const reportError = (e: unknown): void => opts.onError?.(e);

  function commit(next: Settings): Settings {
    const prev = current;
    if (JSON.stringify(prev) === JSON.stringify(next)) return current;
    current = next;
    if (autoSave) store.save();
    for (const l of [...listeners]) l(current, prev);
    return current;
  }

  const store: SettingsStore = {
    get: () => current,
    get issues() {
      return issues;
    },
    load() {
      let text: string | null = null;
      try {
        text = storage ? storage.getItem(key) : null;
      } catch (e) {
        reportError(e);
      }
      const result = parseStoredSettings(text, defaults, migrations);
      issues = result.issues;
      const prev = current;
      current = result.settings;
      if (JSON.stringify(prev) !== JSON.stringify(current)) for (const l of [...listeners]) l(current, prev);
      return current;
    },
    save() {
      if (!storage) return false;
      const payload: StoredSettings = { v: SETTINGS_VERSION, settings: current };
      try {
        storage.setItem(key, JSON.stringify(payload));
        return true;
      } catch (e) {
        reportError(e);
        return false;
      }
    },
    update(patch) {
      const found: string[] = [];
      const merged = mergeBySchema(settingsSchema, current, patch, '', found, true);
      issues = found;
      const parsed = settingsSchema.safeParse(merged);
      return parsed.success ? commit(parsed.data) : current;
    },
    reset(section) {
      if (!section) return commit(defaults);
      return commit({ ...current, [section]: defaults[section] });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  store.load();
  return store;
}
