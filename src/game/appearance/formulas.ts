/**
 * Pure rules of the appearance (docs/SPIEL.md §26, M7-52): the appearance of a world that never chose one, the name rule.
 */
import { BALANCE } from '../../content/balance';
import type { Appearance } from './types';

/** The figure as drawn up to M6: shape `mittel`, every first palette, the side parting; no name yet. */
export function defaultAppearance(): Appearance {
  return { name: '', form: 'mittel', haut: 'haut_1', frisur: 'scheitel', haar: 'haar_1', oberteil: 'kleid_1', hose: 'kleid_1', gewaehlt: false };
}

/** Control characters (C0, DEL, C1) never belong in a name: the pixel font has no glyph and lists would break. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

/**
 * Whether `name` is a valid figure name: trimmed, 1–20 characters (`BALANCE.appearance`, counted as code points), no control
 * characters.
 */
export function validName(name: string): boolean {
  const n = [...name].length;
  return name === name.trim() && n >= BALANCE.appearance.nameMinChars && n <= BALANCE.appearance.nameMaxChars && !CONTROL.test(name);
}
