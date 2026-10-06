/**
 * Model of the new-world screen (MASTERPROMPT §29 "Eigene Regler für alles: Friedlich-Schalter, Tageslänge,
 * Jahreszeitenlänge, Weltgröße, Ressourcendichte, Schattenflut-Intervall, Logistik-Realismus"; §26 "Neue Welt (Seed, Größe,
 * Voreinstellung, alle Regler)"; docs/SPIEL.md §25; M7-51). Pure: the form, its rows (each a list of values stepped with
 * left/right like the settings), the summary of the chosen preset (factors and death penalty, §29 table) and the draft the
 * form makes – the immutable config and the world's first commands.
 *
 * The preset sets hunger/thirst, enemy damage and the shadow flood; the three sliders start at "Voreinstellung" and override
 * the preset only once the player moves them (`null` = the preset's, the same in the saved settings).
 */
import { BALANCE, type WorldSizePreset } from '../../../content/balance';
import { DIFFICULTIES, type DeathPenalty, type Difficulty } from '../../../content/balance/death';
import { DAY_LENGTH_OPTIONS, type DayLengthMinutes } from '../../../engine/time';
import type { GameCommand } from '../../../game/commands';
import { RESOURCE_DENSITIES, type ResourceDensity } from '../../../game/worldsettings/types';
import { parseSharedSeed } from '../../../save/dhsave';
import type { WeltEntwurf } from '../../menu/ablauf';
import { rangeValues } from '../pause/settingsRows';

/** The new-world form. */
export interface NeueWeltForm {
  name: string;
  /** The seed as typed (a number or "DH-<seed>-<size>"). */
  seedText: string;
  groesse: WorldSizePreset;
  schwierigkeit: Difficulty;
  friedlich: boolean;
  tageslaenge: DayLengthMinutes;
  jahreszeitenLaenge: number;
  ressourcendichte: ResourceDensity;
  /** Overrides (`null` = the preset's). */
  hungerDurst: number | null;
  gegnerschaden: number | null;
  /** Shadow flood: the preset's, off, or every n-th night. */
  schattenflut: 'voreinstellung' | 'aus' | number;
  logistikRealismus: boolean;
}

/** World sizes in the order the form offers them. */
export const WORLD_SIZE_CHOICES: readonly WorldSizePreset[] = ['small', 'medium', 'large'];

/** The form of a fresh world: Normal, the standard size and day, `seed` suggested, `name` the default name. */
export function neueWeltStandard(seed: number, name: string): NeueWeltForm {
  return {
    name,
    seedText: String(seed),
    groesse: BALANCE.world.defaultSize,
    schwierigkeit: BALANCE.difficulty.newWorldDifficulty,
    friedlich: false,
    tageslaenge: BALANCE.time.defaultDayLengthMinutes,
    jahreszeitenLaenge: BALANCE.calendar.defaultSeasonLengthDays,
    ressourcendichte: 'normal',
    hungerDurst: null,
    gegnerschaden: null,
    schattenflut: 'voreinstellung',
    logistikRealismus: false,
  };
}

/** Longest world name [characters] (the world list shows it on one line). */
export const WORLD_NAME_MAX = 24;

/** What is wrong with the form (i18n keys), empty when it can start. */
export interface NeueWeltFehler {
  readonly name?: string;
  readonly seed?: string;
}

/** The seed of the form (`seedText` read as a number or a shared seed), or null when it is none. */
export function seedAus(form: Pick<NeueWeltForm, 'seedText'>): number | null {
  return parseSharedSeed(form.seedText)?.seed ?? null;
}

/** Checks name and seed. */
export function pruefen(form: NeueWeltForm): NeueWeltFehler {
  const name = form.name.trim();
  return {
    ...(name === '' ? { name: 'ui.newWorld.fehler.name' } : name.length > WORLD_NAME_MAX ? { name: 'ui.newWorld.fehler.nameLang' } : {}),
    ...(seedAus(form) === null ? { seed: 'ui.newWorld.fehler.seed' } : {}),
  };
}

/**
 * A shared seed pasted into the seed field ("DH-<seed>-<size>") also sets the size: returns the form with both, or the
 * form unchanged.
 */
export function seedEinfuegen(form: NeueWeltForm, text: string): NeueWeltForm {
  const shared = parseSharedSeed(text);
  if (shared === null) return { ...form, seedText: text };
  return { ...form, seedText: String(shared.seed), groesse: shared.size ?? form.groesse };
}

/** Factors and death penalty of the chosen preset with the form's overrides (the summary under the presets). */
export interface Voreinstellung {
  readonly hungerDurst: number;
  readonly gegnerschaden: number;
  readonly schattenflut: number | null;
  readonly tod: DeathPenalty;
}

export function voreinstellung(form: NeueWeltForm): Voreinstellung {
  const preset = BALANCE.difficulty.presets[form.schwierigkeit];
  return {
    hungerDurst: form.hungerDurst ?? preset.hungerThirst,
    gegnerschaden: form.gegnerschaden ?? preset.enemyDamage,
    schattenflut: form.schattenflut === 'voreinstellung' ? preset.shadowFloodNights : form.schattenflut === 'aus' ? null : form.schattenflut,
    tod: BALANCE.death.penalties[form.schwierigkeit],
  };
}

type Value = string | number | boolean;

/** One row of the form: values stepped with left/right; `null` in `values` is "Voreinstellung" of a slider. */
export interface NeueWeltZeile {
  readonly id: string;
  readonly labelKey: string;
  readonly values: readonly Value[];
  readonly wraps: boolean;
  get(form: NeueWeltForm): Value;
  set(form: NeueWeltForm, value: Value): NeueWeltForm;
}

/** Marker of "the preset's value" in the slider rows (a value of its own, first in the list). */
export const VOREINSTELLUNG = 'voreinstellung';

function overrideValues(range: { readonly min: number; readonly max: number; readonly step: number }): Value[] {
  return [VOREINSTELLUNG, ...rangeValues(range)];
}

const BOOLS: readonly boolean[] = [false, true];

/** The rows in display order (name and seed are text fields above them). */
export const NEUE_WELT_ZEILEN: readonly NeueWeltZeile[] = [
  {
    id: 'groesse',
    labelKey: 'ui.newWorld.groesse',
    values: WORLD_SIZE_CHOICES,
    wraps: false,
    get: (f) => f.groesse,
    set: (f, v) => ({ ...f, groesse: v as WorldSizePreset }),
  },
  {
    id: 'schwierigkeit',
    labelKey: 'ui.newWorld.schwierigkeit',
    values: DIFFICULTIES,
    wraps: false,
    get: (f) => f.schwierigkeit,
    set: (f, v) => ({ ...f, schwierigkeit: v as Difficulty }),
  },
  {
    id: 'friedlich',
    labelKey: 'ui.newWorld.friedlich',
    values: BOOLS,
    wraps: true,
    get: (f) => f.friedlich,
    set: (f, v) => ({ ...f, friedlich: v === true }),
  },
  {
    id: 'tageslaenge',
    labelKey: 'ui.newWorld.tageslaenge',
    values: DAY_LENGTH_OPTIONS,
    wraps: false,
    get: (f) => f.tageslaenge,
    set: (f, v) => ({ ...f, tageslaenge: v as DayLengthMinutes }),
  },
  {
    id: 'jahreszeitenLaenge',
    labelKey: 'ui.newWorld.jahreszeitenLaenge',
    values: rangeValues({ min: BALANCE.calendar.minSeasonLengthDays, max: BALANCE.calendar.maxSeasonLengthDays, step: 1 }),
    wraps: false,
    get: (f) => f.jahreszeitenLaenge,
    set: (f, v) => ({ ...f, jahreszeitenLaenge: v as number }),
  },
  {
    id: 'ressourcendichte',
    labelKey: 'ui.newWorld.ressourcendichte',
    values: RESOURCE_DENSITIES,
    wraps: false,
    get: (f) => f.ressourcendichte,
    set: (f, v) => ({ ...f, ressourcendichte: v as ResourceDensity }),
  },
  {
    id: 'hungerDurst',
    labelKey: 'ui.newWorld.hungerDurst',
    values: overrideValues(BALANCE.difficulty.hungerThirstRange),
    wraps: false,
    get: (f) => f.hungerDurst ?? VOREINSTELLUNG,
    set: (f, v) => ({ ...f, hungerDurst: v === VOREINSTELLUNG ? null : (v as number) }),
  },
  {
    id: 'gegnerschaden',
    labelKey: 'ui.newWorld.gegnerschaden',
    values: overrideValues(BALANCE.difficulty.enemyDamageRange),
    wraps: false,
    get: (f) => f.gegnerschaden ?? VOREINSTELLUNG,
    set: (f, v) => ({ ...f, gegnerschaden: v === VOREINSTELLUNG ? null : (v as number) }),
  },
  {
    id: 'schattenflut',
    labelKey: 'ui.newWorld.schattenflut',
    values: [VOREINSTELLUNG, 'aus', ...rangeValues(BALANCE.difficulty.shadowFloodRange)],
    wraps: false,
    get: (f) => f.schattenflut,
    set: (f, v) => ({ ...f, schattenflut: v === VOREINSTELLUNG || v === 'aus' ? v : (v as number) }),
  },
  {
    id: 'logistikRealismus',
    labelKey: 'ui.newWorld.logistikRealismus',
    values: BOOLS,
    wraps: true,
    get: (f) => f.logistikRealismus,
    set: (f, v) => ({ ...f, logistikRealismus: v === true }),
  },
];

/** The value one step (`dir`) from the current one of `row` (choices wrap where `wraps`, ranges stop at their ends). */
export function schritt(row: NeueWeltZeile, form: NeueWeltForm, dir: 1 | -1): NeueWeltForm {
  const values = row.values;
  const i = Math.max(0, values.indexOf(row.get(form)));
  const next = i + dir;
  const at = row.wraps ? (next + values.length) % values.length : Math.min(values.length - 1, Math.max(0, next));
  return row.set(form, values[at] as Value);
}

/**
 * The commands of the world's first tick: `world.setSettings` with every setting that differs from a world nobody changed,
 * then `world.setDifficulty` unless Normal – in this order, so Unbarmherzig takes the settings before it locks them.
 */
export function startBefehle(form: NeueWeltForm): GameCommand[] {
  const out: GameCommand[] = [];
  const settings: Record<string, unknown> = {};
  if (form.friedlich) settings.friedlich = true;
  if (form.hungerDurst !== null) settings.hungerDurst = form.hungerDurst;
  if (form.gegnerschaden !== null) settings.gegnerschaden = form.gegnerschaden;
  if (form.schattenflut !== 'voreinstellung') settings.schattenflut = form.schattenflut === 'aus' ? null : form.schattenflut;
  if (form.logistikRealismus) settings.logistikRealismus = true;
  if (form.jahreszeitenLaenge !== BALANCE.calendar.defaultSeasonLengthDays) settings.jahreszeitenLaenge = form.jahreszeitenLaenge;
  if (Object.keys(settings).length > 0) out.push({ type: 'world.setSettings', ...settings } as GameCommand);
  if (form.schwierigkeit !== 'normal') out.push({ type: 'world.setDifficulty', schwierigkeit: form.schwierigkeit });
  return out;
}

/** The draft of the form (`pruefen` must have passed): config, name, the commands of the step `welt`. */
export function entwurfAus(form: NeueWeltForm, worldId: string): WeltEntwurf {
  const seed = seedAus(form);
  if (seed === null) throw new Error('entwurfAus: the seed is invalid (check the form first)');
  return {
    worldId,
    name: form.name.trim(),
    config: { seed, worldSize: form.groesse, dayLengthMinutes: form.tageslaenge, resourceDensity: form.ressourcendichte },
    commands: { welt: startBefehle(form) },
  };
}
