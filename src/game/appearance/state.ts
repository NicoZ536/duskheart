/**
 * Saved state of the appearance (participant `appearance` 1, docs/SPIEL.md §27 "Save-Version 4": "Name, Körperform, Paletten,
 * Frisur"). Saves before M7 have no data: the participant migrates from 0 to the figure as drawn up to M6, not chosen yet.
 * Unknown ids (content removed later) are refused when loading – the integrity check names the field.
 */
import { z } from 'zod';
import { APPEARANCE_PALETTES, BODY_SHAPE_IDS, HAIRSTYLES } from '../../content/appearance/index';
import { BALANCE } from '../../content/balance';
import type { SaveMigration } from '../participant';
import { defaultAppearance } from './formulas';
import type { Appearance } from './types';

/** Id of the system and its save participant. */
export const APPEARANCE_SYSTEM_ID = 'appearance';
/** Data version of the participant. */
export const APPEARANCE_SAVE_VERSION = 1;

function palette(art: 'haut' | 'haar' | 'kleid') {
  const ids = APPEARANCE_PALETTES.filter((p) => p.art === art).map((p) => p.id);
  return z.string().refine((id) => ids.includes(id), { message: `unknown ${art} palette` });
}

/** zod schema of the participant's data. */
export const appearanceSnapshotSchema = z
  .object({
    name: z.string().refine((n) => [...n].length <= BALANCE.appearance.nameMaxChars, { message: 'name too long' }),
    form: z.enum(BODY_SHAPE_IDS),
    haut: palette('haut'),
    frisur: z.string().refine((id) => HAIRSTYLES.some((h) => h.id === id), { message: 'unknown hairstyle' }),
    haar: palette('haar'),
    oberteil: palette('kleid'),
    hose: palette('kleid'),
    gewaehlt: z.boolean(),
  })
  .strict();

/** Saves without the participant (v1–v3) load with the figure as drawn up to M6. */
export const APPEARANCE_MIGRATIONS: readonly SaveMigration[] = [{ from: 0, migrate: () => serializeAppearance(defaultAppearance()) }];

/** Plain copy for the save. */
export function serializeAppearance(a: Readonly<Appearance>): Appearance {
  return { name: a.name, form: a.form, haut: a.haut, frisur: a.frisur, haar: a.haar, oberteil: a.oberteil, hose: a.hose, gewaehlt: a.gewaehlt };
}

/** Validates saved data. Throws `TypeError` naming the offending fields. */
export function parseAppearance(data: unknown): Appearance {
  const parsed = appearanceSnapshotSchema.safeParse(data);
  if (!parsed.success) throw new TypeError(`appearance snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data;
}
