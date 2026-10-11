/**
 * Pure rules of the appearance (docs/SPIEL.md §26, M7-52): the appearance of a world that never chose one, the name rule.
 */
import { BALANCE } from '../../content/balance';
import type { Appearance } from './types';

/** The figure as drawn up to M6: shape `mittel`, every first palette, the side parting; no name yet. */
export function defaultAppearance(): Appearance {
  return { name: '', form: 'mittel', haut: 'haut_1', frisur: 'scheitel', haar: 'haar_1', oberteil: 'kleid_1', hose: 'kleid_1', gewaehlt: false };
}

/** Control characters (C0 below `C0_END`, DEL to the end of C1 `C1_END`) never belong in a name: the pixel font has no glyph. */
const C0_END = 0x20;
const DEL = 0x7f;
const C1_END = 0x9f;

/** Whether `name` holds a control character (C0, DEL, C1). */
function hasControl(name: string): boolean {
  for (const ch of name) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < C0_END || (c >= DEL && c <= C1_END)) return true;
  }
  return false;
}

/**
 * Whether `name` is a valid figure name: trimmed, 1–20 characters (`BALANCE.appearance`, counted as code points), no control
 * characters.
 */
export function validName(name: string): boolean {
  const n = [...name].length;
  return name === name.trim() && n >= BALANCE.appearance.nameMinChars && n <= BALANCE.appearance.nameMaxChars && !hasControl(name);
}
