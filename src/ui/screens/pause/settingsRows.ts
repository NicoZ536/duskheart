/**
 * Settings of the pause menu (MASTERPROMPT §29 "Einstellungen", M3-31). The full settings screen
 * comes with M7-55/M7-56; until then the pause menu offers exactly the settings that already take
 * effect in the running game (src/main.tsx applies them live), and nothing else:
 * language, UI scale, game speed, scaling mode, light banding, light bands, dithering, flash and
 * flicker reduction, sprint and sneak hold/toggle.
 *
 * Every row is a choice list; left/right (or clicking the arrows) steps through it – choice lists wrap
 * around, number ranges stop at their ends. Labels and descriptions are the existing `settings.*`
 * texts of the settings schema.
 */
import {
  ACTIVATION_MODES,
  LANGUAGES,
  SCALE_MODES,
  SETTING_RANGES,
  UI_SCALES,
  type DeepPartial,
  type Settings,
  type SettingRange,
} from '../../../engine/settings';
import type { I18n } from '../../../i18n';
import { formatNumber, formatPercent } from '../../../i18n/format';

type Value = string | number | boolean;

/** One settings row. */
export interface SettingRow {
  readonly id: string;
  /** i18n key of the label; the description is `<key>.desc`. */
  readonly labelKey: string;
  /** The values in order. */
  readonly values: readonly Value[];
  /** Whether stepping past an end wraps around (choices) or stops (number ranges). */
  readonly wraps: boolean;
  get(settings: Settings): Value;
  patch(value: Value): DeepPartial<Settings>;
  format(i18n: I18n, value: Value): string;
}

/** The values of a slider range, rounded against floating point drift. */
export function rangeValues(range: SettingRange): number[] {
  const out: number[] = [];
  const steps = Math.round((range.max - range.min) / range.step);
  for (let i = 0; i <= steps; i++) out.push(Math.round((range.min + i * range.step) * 1000) / 1000);
  return out;
}

const onOff = (i18n: I18n, v: Value): string => i18n.t(v === true ? 'common.on' : 'common.off');
const BOOLS: readonly boolean[] = [true, false];

/** The rows in display order. */
export const PAUSE_SETTING_ROWS: readonly SettingRow[] = [
  {
    id: 'language',
    labelKey: 'settings.language',
    values: LANGUAGES,
    wraps: true,
    get: (s) => s.language,
    patch: (v) => ({ language: v as Settings['language'] }),
    format: (i18n, v) => i18n.t(`settings.language.${String(v)}`),
  },
  {
    id: 'uiScale',
    labelKey: 'settings.accessibility.uiScale',
    values: UI_SCALES,
    wraps: true,
    get: (s) => s.accessibility.uiScale,
    patch: (v) => ({ accessibility: { uiScale: v as Settings['accessibility']['uiScale'] } }),
    format: (i18n, v) => i18n.t(`settings.accessibility.uiScale.${String(v)}`),
  },
  {
    id: 'gameSpeed',
    labelKey: 'settings.accessibility.gameSpeed',
    values: rangeValues(SETTING_RANGES['accessibility.gameSpeed']),
    wraps: false,
    get: (s) => s.accessibility.gameSpeed,
    patch: (v) => ({ accessibility: { gameSpeed: v as number } }),
    format: (i18n, v) => formatPercent(i18n.lang, v as number),
  },
  {
    id: 'scaleMode',
    labelKey: 'settings.graphics.scaleMode',
    values: SCALE_MODES,
    wraps: true,
    get: (s) => s.graphics.scaleMode,
    patch: (v) => ({ graphics: { scaleMode: v as Settings['graphics']['scaleMode'] } }),
    format: (i18n, v) => i18n.t(`settings.graphics.scaleMode.${String(v)}`),
  },
  {
    id: 'lightBanding',
    labelKey: 'settings.graphics.lightBanding',
    values: BOOLS,
    wraps: true,
    get: (s) => s.graphics.lightBanding,
    patch: (v) => ({ graphics: { lightBanding: v === true } }),
    format: onOff,
  },
  {
    id: 'lightBands',
    labelKey: 'settings.graphics.lightBands',
    values: rangeValues(SETTING_RANGES['graphics.lightBands']),
    wraps: false,
    get: (s) => s.graphics.lightBands,
    patch: (v) => ({ graphics: { lightBands: v as number } }),
    format: (i18n, v) => formatNumber(i18n.lang, v as number),
  },
  {
    id: 'dither',
    labelKey: 'settings.graphics.dither',
    values: BOOLS,
    wraps: true,
    get: (s) => s.graphics.dither,
    patch: (v) => ({ graphics: { dither: v === true } }),
    format: onOff,
  },
  {
    id: 'flashReduction',
    labelKey: 'settings.accessibility.flashReduction',
    values: BOOLS,
    wraps: true,
    get: (s) => s.accessibility.flashReduction,
    patch: (v) => ({ accessibility: { flashReduction: v === true } }),
    format: onOff,
  },
  {
    id: 'sprintMode',
    labelKey: 'settings.controls.sprintMode',
    values: ACTIVATION_MODES,
    wraps: true,
    get: (s) => s.controls.sprintMode,
    patch: (v) => ({ controls: { sprintMode: v as Settings['controls']['sprintMode'] } }),
    format: (i18n, v) => i18n.t(`settings.controls.sprintMode.${String(v)}`),
  },
  {
    id: 'sneakMode',
    labelKey: 'settings.controls.sneakMode',
    values: ACTIVATION_MODES,
    wraps: true,
    get: (s) => s.controls.sneakMode,
    patch: (v) => ({ controls: { sneakMode: v as Settings['controls']['sneakMode'] } }),
    format: (i18n, v) => i18n.t(`settings.controls.sneakMode.${String(v)}`),
  },
];

/**
 * The value one step (`dir` = +1 / −1) from `current` in `row`. A value that is not in the list (a
 * stored value between two steps) snaps to the nearest one first.
 */
export function stepValue(row: SettingRow, current: Value, dir: 1 | -1): Value {
  const values = row.values;
  let i = values.indexOf(current);
  if (i < 0 && typeof current === 'number') {
    let best = 0;
    values.forEach((v, j) => {
      if (typeof v === 'number' && Math.abs(v - current) < Math.abs((values[best] as number) - current)) best = j;
    });
    i = best;
  }
  if (i < 0) i = 0;
  const next = i + dir;
  if (row.wraps) return values[(next + values.length) % values.length] as Value;
  return values[Math.min(values.length - 1, Math.max(0, next))] as Value;
}
