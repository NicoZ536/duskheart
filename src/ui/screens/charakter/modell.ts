/**
 * The character creation's form (MASTERPROMPT §26 "Charaktererstellung (Name, Körperform, Haut-/Haarpaletten,
 * Kleidungsfarben)"; docs/SPIEL.md §25 "Boot-Ablauf", §26 "Aussehen"; M7-52): the name and one choice per row – body shape,
 * skin, hairstyle, hair colour, the colours of top and trousers – stepped with left/right through the entries of the content
 * collections (`bodyShapes`, `hairstyles`, `appearancePalettes`), wrapping round. The form becomes the world's first command
 * `appearance.set` (src/game/appearance/commands.ts), checked by the same rule as the simulation (`validName`).
 */
import { APPEARANCE_PALETTES, BODY_SHAPE_IDS, BODY_SHAPES, HAIRSTYLES, type AppearancePaletteKind } from '../../../content/appearance/index';
import type { LocalizedText } from '../../../content/schema/common';
import { BALANCE } from '../../../content/balance';
import { validName } from '../../../game/appearance/formulas';
import type { GameCommand } from '../../../game/commands';

/** The choice of the character creation (ids of the content collections). */
export interface CharakterForm {
  readonly name: string;
  readonly form: string;
  readonly haut: string;
  readonly frisur: string;
  readonly haar: string;
  readonly oberteil: string;
  readonly hose: string;
}

/** The rows of the form in order (each a field of `CharakterForm`). */
export const CHARAKTER_FELDER = ['form', 'haut', 'frisur', 'haar', 'oberteil', 'hose'] as const;
export type CharakterFeld = (typeof CHARAKTER_FELDER)[number];

/** Longest name [characters] (`BALANCE.appearance.nameMaxChars`). */
export const NAME_MAX = BALANCE.appearance.nameMaxChars;

/** A choosable entry of a row: its id and its name DE/EN. */
export interface Wahl {
  readonly id: string;
  readonly name: LocalizedText;
}

const palettes = (art: AppearancePaletteKind): readonly Wahl[] => APPEARANCE_PALETTES.filter((p) => p.art === art);

/** The entries of each row. */
export const WAHLEN: Readonly<Record<CharakterFeld, readonly Wahl[]>> = {
  form: BODY_SHAPES,
  haut: palettes('haut'),
  frisur: HAIRSTYLES,
  haar: palettes('haar'),
  oberteil: palettes('kleid'),
  hose: palettes('kleid'),
};

/** The figure as drawn up to M6 with the given name: `mittel`, the first of every palette, the side parting. */
export function charakterStandard(name: string): CharakterForm {
  const first = (f: CharakterFeld): string => WAHLEN[f][0]?.id ?? '';
  return { name, form: 'mittel', haut: first('haut'), frisur: first('frisur'), haar: first('haar'), oberteil: first('oberteil'), hose: first('hose') };
}

/** The form with row `feld` stepped by `dir` (wrapping round). */
export function schritt(form: CharakterForm, feld: CharakterFeld, dir: 1 | -1): CharakterForm {
  const list = WAHLEN[feld];
  const i = list.findIndex((w) => w.id === form[feld]);
  const next = list[(((i < 0 ? 0 : i) + dir) % list.length + list.length) % list.length];
  return next === undefined ? form : { ...form, [feld]: next.id };
}

/** The entry chosen in row `feld`, or null. */
export function gewaehlt(form: CharakterForm, feld: CharakterFeld): Wahl | null {
  return WAHLEN[feld].find((w) => w.id === form[feld]) ?? null;
}

/** The i18n key of what is wrong with the name, or null (trimmed, 1–20 characters, no control characters). */
export function namensFehler(name: string): string | null {
  const n = name.trim();
  if (n.length === 0) return 'ui.charakter.fehler.leer';
  return validName(n) ? null : 'ui.charakter.fehler.ungueltig';
}

/** The world's first command for the form (the name trimmed); null while the name is wrong. */
export function aussehenBefehl(form: CharakterForm): GameCommand | null {
  const shape = BODY_SHAPE_IDS.find((f) => f === form.form);
  if (namensFehler(form.name) !== null || shape === undefined) return null;
  return { type: 'appearance.set', name: form.name.trim(), form: shape, haut: form.haut, frisur: form.frisur, haar: form.haar, oberteil: form.oberteil, hose: form.hose };
}
