/**
 * Saved state of the world settings (participant `world-settings`, docs/SPIEL.md §27 "Save-Version 4"): peaceful, the
 * factor overrides, the shadow flood interval and logistics realism. The difficulty stays in `death`, the season length in
 * the calendar. Saves before M7 have no data: the participant migrates from 0 to the settings nobody changed (§27 "leer =
 * keine Überschreibung, nicht friedlich, Schattenflut nach Voreinstellung, Logistik aus").
 */
import { z } from 'zod';
import type { SaveMigration } from '../participant';
import { defaultWorldSettings } from './formulas';
import type { WorldSettings } from './types';

/** Id of the system and its save participant. */
export const WORLD_SETTINGS_SYSTEM_ID = 'world-settings';
/** Data version of the participant. */
export const WORLD_SETTINGS_SAVE_VERSION = 1;

const factor = z.number().positive().finite().nullable();

/** zod schema of the participant's data. */
export const worldSettingsSnapshotSchema = z
  .object({
    peaceful: z.boolean(),
    hungerThirst: factor,
    enemyDamage: factor,
    shadowFloodNights: z.union([z.literal('voreinstellung'), z.number().int().positive()]).nullable(),
    logisticsRealism: z.boolean(),
  })
  .strict();

/** Saves without the participant (v1–v3) load with the settings nobody changed. */
export const WORLD_SETTINGS_MIGRATIONS: readonly SaveMigration[] = [{ from: 0, migrate: () => defaultWorldSettings() }];

/** Plain copy for the save. */
export function serializeWorldSettings(s: Readonly<WorldSettings>): WorldSettings {
  return { peaceful: s.peaceful, hungerThirst: s.hungerThirst, enemyDamage: s.enemyDamage, shadowFloodNights: s.shadowFloodNights, logisticsRealism: s.logisticsRealism };
}

/** Validates saved data. Throws `TypeError` naming the offending fields. */
export function parseWorldSettings(data: unknown): WorldSettings {
  const parsed = worldSettingsSnapshotSchema.safeParse(data);
  if (!parsed.success) throw new TypeError(`world-settings snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data;
}
