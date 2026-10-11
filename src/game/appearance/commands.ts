/**
 * Command of the appearance (docs/SPIEL.md §26, M7-52; aggregated by src/game/commands.ts): `appearance.set {name, form, haut,
 * frisur, haar, oberteil, hose}` – the character creation's choice, the first command of a new world. Every id names an entry
 * of its content collection (`bodyShapes`, `hairstyles`) or a palette of the right kind (`APPEARANCE_PALETTES`); the name is trimmed, 1–20
 * characters without control characters. Once chosen the appearance stays (`appearanceLocked`).
 */
import { z } from 'zod';
import { BODY_SHAPE_IDS } from '../../content/appearance/schema';
import { HAIRSTYLES, palettesOf } from '../../content/appearance/index';
import { validName } from './formulas';

/** Ids of one palette kind as a zod enum. */
function palette(art: 'haut' | 'haar' | 'kleid') {
  const ids = palettesOf(art).map((p) => p.id);
  return z.string().refine((id) => ids.includes(id), { message: `a ${art} palette: ${ids.join(', ')}` });
}

const hairstyleIds = HAIRSTYLES.map((h) => h.id);

export const appearanceSetCommandSchema = z
  .object({
    type: z.literal('appearance.set'),
    name: z.string().refine(validName, { message: 'a name of 1–20 characters, trimmed, without control characters' }),
    form: z.enum(BODY_SHAPE_IDS),
    haut: palette('haut'),
    frisur: z.string().refine((id) => hairstyleIds.includes(id), { message: `a hairstyle: ${hairstyleIds.join(', ')}` }),
    haar: palette('haar'),
    oberteil: palette('kleid'),
    hose: palette('kleid'),
  })
  .strict();

/** The command schemas of the appearance. */
export const APPEARANCE_COMMAND_SCHEMAS = [appearanceSetCommandSchema] as const;
