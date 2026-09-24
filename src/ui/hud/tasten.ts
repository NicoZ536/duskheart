/**
 * Key and button glyphs of the HUD (MASTERPROMPT §26 "automatische Tastensymbole (Xbox, PlayStation,
 * generisch)", "Alles umbelegbar"; M3-27): what to draw for the binding of an action on the device used
 * last – a key cap with the key's name for keyboard and mouse, the face buttons of a gamepad as their own
 * symbol (Xbox A/B/X/Y in colour, PlayStation cross/circle/square/triangle, generic: which of four), other
 * buttons as a cap with their short name. Pure, unit-tested (tests/unit/ui/hud-tasten.test.ts).
 */
import { bindingLabel, PAD, type Binding, type GamepadFamily } from '../../engine/input/bindings';

/** A glyph: a cap with text, or a frame of a button sprite. */
export type TastenSymbol =
  | { readonly art: 'kappe'; readonly text: string }
  | { readonly art: 'knopf'; readonly sprite: string; readonly frame: number; readonly name: string };

/** Button sprites per controller family (assets-src/sprites/ui/hud.ts); frames in pad order A/B/X/Y = 0–3. */
export const KNOPF_SPRITES: Readonly<Record<GamepadFamily, string>> = {
  xbox: 'ui_taste_xbox',
  playstation: 'ui_taste_ps',
  generic: 'ui_taste_generisch',
};

/** Short cap text of gamepad buttons that have no symbol, per family (i18n keys for generic names). */
const KURZ: Readonly<Record<GamepadFamily, Readonly<Record<number, string>>>> = {
  xbox: { [PAD.LB]: 'LB', [PAD.RB]: 'RB', [PAD.LT]: 'LT', [PAD.RT]: 'RT', [PAD.LS]: 'LS', [PAD.RS]: 'RS' },
  playstation: { [PAD.LB]: 'L1', [PAD.RB]: 'R1', [PAD.LT]: 'L2', [PAD.RT]: 'R2', [PAD.LS]: 'L3', [PAD.RS]: 'R3' },
  generic: { [PAD.LB]: 'L1', [PAD.RB]: 'R1', [PAD.LT]: 'L2', [PAD.RT]: 'R2', [PAD.LS]: 'L3', [PAD.RS]: 'R3' },
};

/** Translates a label part's i18n key. */
export type Uebersetze = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** The full, translated name of a binding ("E", "Umschalt+E", "A", "Kreuz"): accessible names, tooltips. */
export function tastenName(b: Binding, family: GamepadFamily, t: Uebersetze): string {
  return bindingLabel(b, family)
    .map((p) => ('text' in p ? p.text : t(p.i18n, p.params)))
    .join('+');
}

/** The glyph of binding `b` for a controller of `family`. */
export function tastenSymbol(b: Binding, family: GamepadFamily, t: Uebersetze): TastenSymbol {
  const name = tastenName(b, family, t);
  if (b.kind === 'padButton') {
    if (b.index >= PAD.A && b.index <= PAD.Y) return { art: 'knopf', sprite: KNOPF_SPRITES[family], frame: b.index - PAD.A, name };
    const kurz = KURZ[family][b.index];
    if (kurz !== undefined) return { art: 'kappe', text: kurz };
  }
  return { art: 'kappe', text: name };
}
