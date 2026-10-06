/**
 * Commands of the world settings (MASTERPROMPT §29, docs/SPIEL.md §25 "Neue Welt"; M7-51; aggregated by src/game/commands.ts).
 * A new world sends them as its first commands (the new-world screen's choice), the pause menu's world view whenever the
 * player changes one; settings that change the simulation enter it only as commands (docs/SPIEL.md §28 "Determinismus").
 *
 * - `world.setDifficulty {schwierigkeit}`: the preset – kept in the participant `death` (`DeathSystem.setDifficulty`, never
 *   away from Unbarmherzig); refused with `difficultyLocked` in an Unbarmherzig world.
 * - `world.setSettings {…}`: every field optional – `friedlich` (no foes, no shadow brood; the animals stay),
 *   `hungerDurst` and `gegnerschaden` (a factor on the slider of `BALANCE.difficulty`, `null` = the preset's),
 *   `schattenflut` (every n-th night, `null` = none, `'voreinstellung'` = the preset's), `logistikRealismus` (ores and bars
 *   stay out of fast travel), `jahreszeitenLaenge` (days per season, kept by the calendar from today on). In an Unbarmherzig
 *   world only the season length may change; a command touching anything else is refused whole (`difficultyLocked`).
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { DIFFICULTIES } from '../../content/balance/death';
import { onRange } from './formulas';

const D = BALANCE.difficulty;

/** A factor on the slider of `range`, or `null` (the preset's). */
function factor(range: { readonly min: number; readonly max: number; readonly step: number }) {
  return z
    .number()
    .refine((v) => onRange(v, range), { message: `must lie on ${range.min}…${range.max} in steps of ${range.step}` })
    .nullable();
}

export const worldSetDifficultyCommandSchema = z.object({ type: z.literal('world.setDifficulty'), schwierigkeit: z.enum(DIFFICULTIES) }).strict();

export const worldSetSettingsCommandSchema = z
  .object({
    type: z.literal('world.setSettings'),
    friedlich: z.boolean().optional(),
    hungerDurst: factor(D.hungerThirstRange).optional(),
    gegnerschaden: factor(D.enemyDamageRange).optional(),
    schattenflut: z.union([z.literal('voreinstellung'), z.number().int().min(D.shadowFloodRange.min).max(D.shadowFloodRange.max)]).nullable().optional(),
    logistikRealismus: z.boolean().optional(),
    jahreszeitenLaenge: z.number().int().min(BALANCE.calendar.minSeasonLengthDays).max(BALANCE.calendar.maxSeasonLengthDays).optional(),
  })
  .strict();

/** The command schemas of the world settings. */
export const WORLD_SETTINGS_COMMAND_SCHEMAS = [worldSetDifficultyCommandSchema, worldSetSettingsCommandSchema] as const;
