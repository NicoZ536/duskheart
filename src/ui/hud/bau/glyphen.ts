/**
 * Key and mouse glyphs of the hints (MASTERPROMPT §26 "automatische Tastensymbole", M3-10 hint glyphs; M4-38): the
 * glyph sprites of the world's interaction hints (assets-src/sprites/icons/hinweise.ts) in the build mode's and the
 * HUD's hint lines – the empty key cap `hinweis_taste` (the key's name is written into it by the pixel font, the cap
 * stretched as a nine-slice for longer names like "Strg+Z"), the mouse with its left or right button lit
 * (`hinweis_maus_links`, `hinweis_maus_rechts`: "LMB setzen, RMB drehen"). The face buttons of a gamepad keep their
 * own symbols (`tastenSymbol`, src/ui/hud/tasten.ts). Pure, unit-tested (tests/unit/ui/bau-glyphen.test.ts).
 */
import type { Binding, GamepadFamily } from '../../../engine/input/bindings';
import { tastenName, tastenSymbol, type TastenSymbol, type Uebersetze } from '../tasten';

/** The empty key cap (16×16, face x 3–12, y 3–10). */
export const KAPPE_SPRITE = 'hinweis_taste';
/** Nine-slice of the key cap [px]: top, right, bottom, left (the face in between stretches). */
export const KAPPE_RAND = { oben: 3, rechts: 3, unten: 5, links: 3 } as const;
/** Mouse glyphs by button (left 0, right 2); the middle button and the wheel show their name in a cap. */
export const MAUS_SPRITES: Readonly<Partial<Record<number, string>>> = { 0: 'hinweis_maus_links', 2: 'hinweis_maus_rechts' };
/** Size of the mouse glyph sprites [px]. */
export const MAUS_PX = 16;
/** Size of the gamepad button sprites [design px] (assets-src/sprites/ui/hud.ts). */
export const KNOPF_PX = 11;

/** A glyph of the hints: a key cap with a name, a mouse with a lit button, or a gamepad button symbol. */
export type HinweisGlyphe = TastenSymbol | { readonly art: 'maus'; readonly sprite: string; readonly name: string };

/** Short names of the mouse buttons without a sprite, in their cap (the full name is too long for a cap). */
export const MAUS_KURZ: Readonly<Partial<Record<number, string>>> = { 1: 'ui.glyphe.maus.mitte', 3: 'ui.glyphe.maus.zurueck', 4: 'ui.glyphe.maus.vor' };

/** The glyph of binding `b` on a controller of `family` (keyboard and mouse bindings ignore it). */
export function hinweisGlyphe(b: Binding, family: GamepadFamily, t: Uebersetze): HinweisGlyphe {
  if (b.kind === 'mouse') {
    const sprite = MAUS_SPRITES[b.button];
    if (sprite !== undefined) return { art: 'maus', sprite, name: tastenName(b, family, t) };
    const kurz = MAUS_KURZ[b.button];
    if (kurz !== undefined) return { art: 'kappe', text: t(kurz) };
  }
  return tastenSymbol(b, family, t);
}
