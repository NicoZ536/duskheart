/**
 * M3-27: key and button glyphs of the HUD (src/ui/hud/tasten.ts, MASTERPROMPT §26 "automatische
 * Tastensymbole (Xbox, PlayStation, generisch)", "Alles umbelegbar") – keyboard caps with the key's name,
 * the face buttons as the family's symbol, shoulder buttons as short caps, rebinding followed.
 */
import { describe, expect, it } from 'vitest';
import { BindingSet, DEFAULT_BINDINGS, PAD, type Binding } from '../../../src/engine/input/bindings';
import { createI18n } from '../../../src/i18n';
import { KNOPF_SPRITES, tastenName, tastenSymbol } from '../../../src/ui/hud/tasten';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });
const tDe = (k: string, p?: Readonly<Record<string, string | number>>): string => de.t(k, p);
const tEn = (k: string, p?: Readonly<Record<string, string | number>>): string => en.t(k, p);
const pad = (index: number): Binding => ({ kind: 'padButton', index });

describe('Tastensymbole', () => {
  it('Tastatur: Kappe mit dem Namen der Taste (E, Q, Leertaste/Space, Strg+Z)', () => {
    const set = new BindingSet(DEFAULT_BINDINGS);
    const interact = set.primary('interact', 'keyboardMouse');
    if (interact === undefined) throw new Error('interact ohne Tastenbelegung');
    expect(tastenSymbol(interact, 'generic', tDe)).toEqual({ art: 'kappe', text: 'E' });
    expect(tastenSymbol({ kind: 'key', code: 'Space' }, 'generic', tDe)).toEqual({ art: 'kappe', text: 'Leertaste' });
    expect(tastenSymbol({ kind: 'key', code: 'Space' }, 'generic', tEn)).toEqual({ art: 'kappe', text: 'Space' });
    expect(tastenSymbol({ kind: 'key', code: 'KeyZ', ctrl: true }, 'generic', tDe)).toEqual({ art: 'kappe', text: 'Strg+Z' });
  });

  it('Gamepad: A/B/X/Y als Knopf der Familie (Frame = Knopfindex), Name für Bildschirmleser', () => {
    expect(tastenSymbol(pad(PAD.A), 'xbox', tDe)).toEqual({ art: 'knopf', sprite: KNOPF_SPRITES.xbox, frame: 0, name: 'A' });
    expect(tastenSymbol(pad(PAD.Y), 'xbox', tDe)).toEqual({ art: 'knopf', sprite: KNOPF_SPRITES.xbox, frame: 3, name: 'Y' });
    expect(tastenSymbol(pad(PAD.A), 'playstation', tDe)).toEqual({ art: 'knopf', sprite: KNOPF_SPRITES.playstation, frame: 0, name: 'Kreuz' });
    expect(tastenSymbol(pad(PAD.X), 'playstation', tEn)).toEqual({ art: 'knopf', sprite: KNOPF_SPRITES.playstation, frame: 2, name: 'Square' });
    expect(tastenSymbol(pad(PAD.B), 'generic', tDe)).toEqual({ art: 'knopf', sprite: KNOPF_SPRITES.generic, frame: 1, name: 'Rechter Knopf' });
  });

  it('Schultertasten als kurze Kappe je Familie, Steuerkreuz mit vollem Namen', () => {
    expect(tastenSymbol(pad(PAD.RB), 'xbox', tDe)).toEqual({ art: 'kappe', text: 'RB' });
    expect(tastenSymbol(pad(PAD.LB), 'playstation', tDe)).toEqual({ art: 'kappe', text: 'L1' });
    expect(tastenSymbol(pad(PAD.LT), 'generic', tDe)).toEqual({ art: 'kappe', text: 'L2' });
    expect(tastenSymbol(pad(PAD.DPAD_UP), 'xbox', tDe)).toEqual({ art: 'kappe', text: 'Steuerkreuz hoch' });
  });

  it('folgt einer Umbelegung (Interagieren auf F bzw. auf den Y-Knopf)', () => {
    const set = new BindingSet(DEFAULT_BINDINGS, { interact: [{ kind: 'key', code: 'KeyF' }, pad(PAD.Y)] });
    const key = set.primary('interact', 'keyboardMouse');
    const button = set.primary('interact', 'gamepad');
    if (key === undefined || button === undefined) throw new Error('Umbelegung fehlt');
    expect(tastenSymbol(key, 'xbox', tDe)).toEqual({ art: 'kappe', text: 'F' });
    expect(tastenSymbol(button, 'xbox', tDe)).toMatchObject({ art: 'knopf', frame: 3 });
    expect(tastenName(button, 'playstation', tDe)).toBe('Dreieck');
  });
});
