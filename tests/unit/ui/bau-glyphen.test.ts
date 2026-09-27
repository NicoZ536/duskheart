/**
 * M4-38 (MASTERPROMPT §26 "automatische Tastensymbole", "LMB setzen, RMB drehen"): the build mode's and the HUD's
 * hint lines use the glyph sprites of the world's hints – the mouse with its lit button (`hinweis_maus_links`,
 * `hinweis_maus_rechts`), the key cap `hinweis_taste` stretched as a nine-slice around the key's name; buttons without
 * a sprite (middle mouse button, side buttons) get a short name in a cap, gamepad buttons keep their family's symbol.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import HINWEISE from '../../../assets-src/sprites/icons/hinweise';
import { TRANSPARENT, type Sprite } from '../../../assets-src/lib/sprite';
import { BindingSet, DEFAULT_BINDINGS, PAD, type Binding } from '../../../src/engine/input/bindings';
import { SPRITES } from '../../../src/generated/atlas';
import { createI18n } from '../../../src/i18n';
import { hinweisGlyphe, KAPPE_RAND, KAPPE_SPRITE, MAUS_PX, MAUS_SPRITES } from '../../../src/ui/hud/bau/glyphen';
import { KNOPF_SPRITES } from '../../../src/ui/hud/tasten';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });
const tDe = (k: string, p?: Readonly<Record<string, string | number>>): string => de.t(k, p);
const tEn = (k: string, p?: Readonly<Record<string, string | number>>): string => en.t(k, p);

function primary(set: BindingSet, action: Parameters<BindingSet['primary']>[0], device: 'keyboardMouse' | 'gamepad'): Binding {
  const b = set.primary(action, device);
  if (b === undefined) throw new Error(`${action} ohne Belegung`);
  return b;
}

describe('Hinweis-Glyphen (M4-38)', () => {
  it('„LMB setzen, RMB drehen": die Maus mit der leuchtenden Taste, der Name für Bildschirmleser daneben', () => {
    const set = new BindingSet(DEFAULT_BINDINGS);
    expect(hinweisGlyphe(primary(set, 'attack', 'keyboardMouse'), 'generic', tDe)).toEqual({ art: 'maus', sprite: 'hinweis_maus_links', name: expect.any(String) });
    expect(hinweisGlyphe(primary(set, 'block', 'keyboardMouse'), 'generic', tDe)).toMatchObject({ art: 'maus', sprite: 'hinweis_maus_rechts' });
    const links = hinweisGlyphe({ kind: 'mouse', button: 0 }, 'generic', tDe);
    expect(links.art === 'maus' && links.name.length > 0).toBe(true);
  });

  it('Tasten als Kappe mit Namen (R, F, Strg+Z), die Mitteltaste und die Seitentasten kurz in einer Kappe', () => {
    const set = new BindingSet(DEFAULT_BINDINGS);
    expect(hinweisGlyphe(primary(set, 'rotate', 'keyboardMouse'), 'generic', tDe)).toEqual({ art: 'kappe', text: 'R' });
    expect(hinweisGlyphe(primary(set, 'mirror', 'keyboardMouse'), 'generic', tDe)).toEqual({ art: 'kappe', text: 'F' });
    expect(hinweisGlyphe(primary(set, 'undo', 'keyboardMouse'), 'generic', tDe)).toEqual({ art: 'kappe', text: 'Strg+Z' });
    expect(hinweisGlyphe(primary(set, 'undo', 'keyboardMouse'), 'generic', tEn)).toEqual({ art: 'kappe', text: 'Ctrl+Z' });
    expect(hinweisGlyphe(primary(set, 'pipette', 'keyboardMouse'), 'generic', tDe)).toEqual({ art: 'kappe', text: 'Mitte' });
    expect(hinweisGlyphe({ kind: 'mouse', button: 1 }, 'generic', tEn)).toEqual({ art: 'kappe', text: 'MMB' });
    expect(hinweisGlyphe({ kind: 'mouse', button: 3 }, 'generic', tDe)).toEqual({ art: 'kappe', text: 'M4' });
    expect(hinweisGlyphe({ kind: 'mouse', button: 4 }, 'generic', tDe)).toEqual({ art: 'kappe', text: 'M5' });
  });

  it('Gamepad: die Knöpfe der Familie bleiben (X drehen, Y spiegeln, B rückgängig)', () => {
    const set = new BindingSet(DEFAULT_BINDINGS);
    expect(hinweisGlyphe(primary(set, 'rotate', 'gamepad'), 'xbox', tDe)).toEqual({ art: 'knopf', sprite: KNOPF_SPRITES.xbox, frame: 2, name: 'X' });
    expect(hinweisGlyphe(primary(set, 'mirror', 'gamepad'), 'playstation', tDe)).toMatchObject({ art: 'knopf', sprite: KNOPF_SPRITES.playstation, frame: 3 });
    expect(hinweisGlyphe({ kind: 'padButton', index: PAD.B }, 'generic', tDe)).toMatchObject({ art: 'knopf', frame: 1 });
    expect(hinweisGlyphe(primary(set, 'attack', 'gamepad'), 'xbox', tDe)).toEqual({ art: 'kappe', text: 'RT' });
  });

  it('die Glyphen-Sprites liegen im Atlas in der Größe, in der die Zeilen sie zeigen', () => {
    for (const id of [KAPPE_SPRITE, ...Object.values(MAUS_SPRITES)]) {
      const s = (SPRITES as Readonly<Record<string, { readonly size: readonly [number, number] }>>)[id as string];
      expect(s, id).toBeDefined();
      expect(s?.size).toEqual([MAUS_PX, MAUS_PX]);
    }
  });

  it('die Neun-Teilung der Kappe trifft das Sprite: die gedehnte Mitte ist eine Farbe, Rand und Schattierung bleiben', () => {
    const kappe = (HINWEISE as readonly Sprite[]).find((s) => s.id === KAPPE_SPRITE);
    if (kappe === undefined) throw new Error('hinweis_taste fehlt');
    const px = kappe.frames[0]?.index;
    if (px === undefined) throw new Error('hinweis_taste ohne Frame');
    const at = (x: number, y: number): number => px[y * kappe.w + x] as number;
    const face = at(KAPPE_RAND.links, KAPPE_RAND.oben);
    expect(face).not.toBe(TRANSPARENT);
    // The cap only grows in width (its height stays 16 design px, see the stylesheet test): every row repeats one
    // colour across the stretched columns, the face in the middle rows, border and lip in the top and bottom slices.
    for (let y = 0; y < kappe.h; y++) {
      const mid = y >= KAPPE_RAND.oben && y < kappe.h - KAPPE_RAND.unten;
      for (let x = KAPPE_RAND.links; x < kappe.w - KAPPE_RAND.rechts; x++) expect(at(x, y), `${x},${y}`).toBe(mid ? face : at(KAPPE_RAND.links, y));
    }
    // The top slice holds the upper border, the side slices the left and right border.
    expect(at(KAPPE_RAND.links, KAPPE_RAND.oben - 2)).not.toBe(TRANSPARENT);
    expect(at(KAPPE_RAND.links - 2, KAPPE_RAND.oben)).not.toBe(TRANSPARENT);
    expect(at(kappe.w - KAPPE_RAND.rechts + 1, KAPPE_RAND.oben)).not.toBe(TRANSPARENT);
    // The shaded lower lip lies in the bottom slice.
    expect(at(KAPPE_RAND.links, kappe.h - KAPPE_RAND.unten)).not.toBe(face);
  });

  it('das Stylesheet schneidet die Kappe mit denselben Rändern', () => {
    const css = readFileSync(new URL('../../../src/ui/hud/bau/glyphe.css', import.meta.url), 'utf8');
    const { oben, rechts, unten, links } = KAPPE_RAND;
    expect(css).toContain(`border-image-slice: ${oben} ${rechts} ${unten} ${links} fill;`);
    const px = (n: number): string => `calc(${n}px * var(--dh-ui-scale))`;
    expect(css).toContain(`border-width: ${px(oben)} ${px(rechts)} ${px(unten)} ${px(links)};`);
    expect(css).toContain('image-rendering: pixelated;');
    // Fixed height of the sprite: the side slices are never stretched.
    expect(css).toMatch(/\.dh-glyphe--kappe \{[^}]*\n {2}height: calc\(16px \* var\(--dh-ui-scale\)\);/);
  });
});
