/**
 * Rows of the settings screen (MASTERPROMPT §29 "Einstellungen/Barrierefreiheit", §26; docs/SPIEL.md §25; M7-55,
 * M7-56): every key of `src/engine/settings.ts` a player sets, by tab – Grafik, Audio, Steuerung, Spiel, Sprache,
 * Barrierefreiheit. Each row is a list of values stepped with left/right (choices wrap, ranges stop at their ends) and
 * a patch for the settings store; labels and descriptions are the `settings.*` texts of the schema (`<key>.desc`).
 * The key bindings of the controls tab are their own rows (src/ui/screens/einstellungen/belegung.ts).
 *
 * The quality level sets every detail option of its preset at once (`qualityPatch`, §6.3); a single detail option
 * changed afterwards keeps the level's name but no longer its preset (`matchesQualityPreset`), and the row says so.
 */
import {
  ACTIVATION_MODES,
  COLORBLIND_MODES,
  FPS_LIMITS,
  HUD_MODES,
  LANGUAGES,
  matchesQualityPreset,
  MAX_LIGHT_COUNTS,
  QUALITY_LEVELS,
  qualityPatch,
  SCALE_MODES,
  SETTING_RANGES,
  SHADOW_MODES,
  UI_SCALES,
  WATER_MODES,
  WEATHER_PARTICLE_MODES,
  type DeepPartial,
  type Settings,
  type SettingsSection,
} from '../../../engine/settings';
import type { I18n } from '../../../i18n';
import { formatNumber, formatPercent } from '../../../i18n/format';
import { rangeValues, type SettingRow } from '../pause/settingsRows';

/** The tabs in order, each with the settings section it shows and resets. */
export const EINSTELLUNGEN_REITER = [
  { id: 'graphics', abschnitt: 'graphics' },
  { id: 'audio', abschnitt: 'audio' },
  { id: 'controls', abschnitt: 'controls' },
  { id: 'game', abschnitt: 'game' },
  { id: 'language', abschnitt: 'language' },
  { id: 'accessibility', abschnitt: 'accessibility' },
] as const satisfies ReadonlyArray<{ readonly id: string; readonly abschnitt: SettingsSection }>;
export type ReiterId = (typeof EINSTELLUNGEN_REITER)[number]['id'];

type Value = string | number | boolean;
type Section = Exclude<SettingsSection, 'language'>;

/** Reads `section.field` of the settings. */
function lesen(s: Settings, section: Section, field: string): Value {
  return (s[section] as unknown as Record<string, Value>)[field] as Value;
}

/** The patch that sets `section.field` to `v`. */
function setzen(section: Section, field: string, v: Value): DeepPartial<Settings> {
  return { [section]: { [field]: v } } as DeepPartial<Settings>;
}

const onOff = (i18n: I18n, v: Value): string => i18n.t(v === true ? 'common.on' : 'common.off');
const BOOLS: readonly boolean[] = [true, false];

/** A choice row: values with an i18n key `settings.<section>.<field>.<value>`. */
function wahl(section: Section, field: string, values: readonly (string | number)[]): SettingRow {
  return {
    id: `${section}.${field}`,
    labelKey: `settings.${section}.${field}`,
    values,
    wraps: true,
    get: (s) => lesen(s, section, field),
    patch: (v) => setzen(section, field, v),
    format: (i18n, v) => i18n.t(`settings.${section}.${field}.${String(v)}`),
  };
}

/** An on/off row. */
function schalter(section: Section, field: string): SettingRow {
  return {
    id: `${section}.${field}`,
    labelKey: `settings.${section}.${field}`,
    values: BOOLS,
    wraps: true,
    get: (s) => lesen(s, section, field),
    patch: (v) => setzen(section, field, v === true),
    format: onOff,
  };
}

/** A range row (`SETTING_RANGES`), formatted by `format`. */
function bereich(section: Section, field: string, format: (i18n: I18n, v: number) => string): SettingRow {
  const range = SETTING_RANGES[`${section}.${field}` as keyof typeof SETTING_RANGES];
  return {
    id: `${section}.${field}`,
    labelKey: `settings.${section}.${field}`,
    values: rangeValues(range),
    wraps: false,
    get: (s) => lesen(s, section, field),
    patch: (v) => setzen(section, field, v as number),
    format: (i18n, v) => format(i18n, v as number),
  };
}

const prozent = (i18n: I18n, v: number): string => formatPercent(i18n.lang, v);
const faktor = (i18n: I18n, v: number): string => `×${formatNumber(i18n.lang, v, 2)}`;
const zahl = (i18n: I18n, v: number): string => formatNumber(i18n.lang, v);

/** The quality level: its whole preset at once; "(angepasst)" once a detail option left the preset. */
const QUALITAET: SettingRow = {
  id: 'graphics.quality',
  labelKey: 'settings.graphics.quality',
  values: QUALITY_LEVELS,
  wraps: true,
  get: (s) => s.graphics.quality,
  patch: (v) => qualityPatch(v as Settings['graphics']['quality']),
  format: (i18n, v) => i18n.t(`settings.graphics.quality.${String(v)}`),
};

/** Whether the quality row shows "angepasst": a detail option differs from the level's preset. */
export function qualitaetAngepasst(s: Settings): boolean {
  return !matchesQualityPreset(s.graphics);
}

/** The rows of each tab in display order (the key bindings follow the controls rows, belegung.ts). */
export const EINSTELLUNGEN_ZEILEN: Readonly<Record<ReiterId, readonly SettingRow[]>> = {
  graphics: [
    QUALITAET,
    schalter('graphics', 'lightBanding'),
    bereich('graphics', 'lightBands', zahl),
    schalter('graphics', 'dither'),
    wahl('graphics', 'scaleMode', SCALE_MODES),
    wahl('graphics', 'fpsLimit', FPS_LIMITS),
    schalter('graphics', 'crt'),
    schalter('graphics', 'bloom'),
    schalter('graphics', 'fog'),
    wahl('graphics', 'weatherParticles', WEATHER_PARTICLE_MODES),
    wahl('graphics', 'shadows', SHADOW_MODES),
    schalter('graphics', 'gi'),
    wahl('graphics', 'water', WATER_MODES),
    wahl('graphics', 'maxLights', MAX_LIGHT_COUNTS),
    schalter('graphics', 'particleLights'),
    schalter('graphics', 'adaptiveLightBuffer'),
  ],
  audio: [
    bereich('audio', 'master', prozent),
    bereich('audio', 'music', prozent),
    bereich('audio', 'sfx', prozent),
    bereich('audio', 'ambience', prozent),
    bereich('audio', 'ui', prozent),
    schalter('audio', 'subtitles'),
    schalter('audio', 'visualSoundCues'),
  ],
  controls: [
    bereich('controls', 'mouseSensitivity', faktor),
    bereich('controls', 'stickSensitivity', faktor),
    bereich('controls', 'stickDeadzone', prozent),
    wahl('controls', 'sprintMode', ACTIVATION_MODES),
    wahl('controls', 'sneakMode', ACTIVATION_MODES),
    wahl('controls', 'blockMode', ACTIVATION_MODES),
    schalter('controls', 'vibration'),
    schalter('controls', 'aimAssist'),
  ],
  game: [
    wahl('game', 'hudMode', HUD_MODES),
    schalter('game', 'compassBar'),
    schalter('game', 'damageNumbers'),
    schalter('game', 'hints'),
    schalter('game', 'funkeComments'),
    {
      ...bereich('game', 'autosaveMinutes', zahl),
      format: (i18n, v) => i18n.t('settings.game.autosaveMinutes.value', { count: v as number }),
    },
    schalter('game', 'developerMode'),
  ],
  language: [
    {
      id: 'language',
      labelKey: 'settings.language',
      values: LANGUAGES,
      wraps: true,
      get: (s) => s.language,
      patch: (v) => ({ language: v as Settings['language'] }),
      format: (i18n, v) => i18n.t(`settings.language.${String(v)}`),
    },
  ],
  accessibility: [
    wahl('accessibility', 'colorblind', COLORBLIND_MODES),
    bereich('accessibility', 'textScale', faktor),
    bereich('accessibility', 'screenshake', prozent),
    schalter('accessibility', 'flashReduction'),
    schalter('accessibility', 'reducedMotion'),
    bereich('accessibility', 'gameSpeed', prozent),
    wahl('accessibility', 'uiScale', UI_SCALES),
  ],
};

/** Every row of every tab (tests: each settings key a player sets has its row). */
export function alleZeilen(): SettingRow[] {
  return EINSTELLUNGEN_REITER.flatMap((r) => [...EINSTELLUNGEN_ZEILEN[r.id]]);
}

/** The row `id` of any tab, or undefined. */
export function zeileMitId(id: string): SettingRow | undefined {
  for (const r of EINSTELLUNGEN_REITER) {
    const row = EINSTELLUNGEN_ZEILEN[r.id].find((z) => z.id === id);
    if (row !== undefined) return row;
  }
  return undefined;
}

/** The tab `dir` steps from `id` (wrapping). */
export function naechsterReiter(id: ReiterId, dir: 1 | -1): ReiterId {
  const i = EINSTELLUNGEN_REITER.findIndex((r) => r.id === id);
  const n = EINSTELLUNGEN_REITER.length;
  return (EINSTELLUNGEN_REITER[(i + dir + n) % n] as (typeof EINSTELLUNGEN_REITER)[number]).id;
}
