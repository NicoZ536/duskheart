/**
 * M5-39 (ADR-0049 „Spiegeln nach Sprite“, docs/ART.md „Spiegeln ist nur mit `spiegelbar: true` erlaubt“): the furniture
 * sprites T0–T1 were checked for mirroring – every one without a side-bound detail stands mirrored when the player
 * mirrors it (F in the build mode), the colour variants follow their base; three stay as painted, each for its reason
 * (named in the source): the sundial (the gnomon's painted shadow), the wall mirror (the glint in the glass shows the
 * light's direction) and the trophy board (the coat of arms on its shield).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sprite } from '../../../assets-src/lib/sprite';
import betten from '../../../assets-src/sprites/moebel/betten';
import deko from '../../../assets-src/sprites/moebel/deko';
import lager from '../../../assets-src/sprites/moebel/lager';
import lichter from '../../../assets-src/sprites/moebel/lichter';
import sitzmoebel from '../../../assets-src/sprites/moebel/sitzmoebel';
import tische from '../../../assets-src/sprites/moebel/tische';
import varianten from '../../../assets-src/sprites/moebel/varianten';
import wand from '../../../assets-src/sprites/moebel/wand';

const ALLE: readonly Sprite[] = [...betten, ...deko, ...lager, ...lichter, ...sitzmoebel, ...tische, ...wand, ...varianten];
/** The furniture that keeps its side, and the word its source gives as the reason. */
const SEITENGEBUNDEN: Readonly<Record<string, string>> = {
  obj_uhr_sonne: 'Schatten',
  obj_spiegel_wand: 'Lichtrichtung',
  obj_trophaeenbrett: 'Wappen',
};
const QUELLEN = ['deko', 'wand'].map((f) => readFileSync(join(__dirname, '../../../assets-src/sprites/moebel', `${f}.ts`), 'utf8')).join('\n');

describe('Möbel-Sprites spiegelbar (M5-39)', () => {
  it('alle Möbel ohne seitengebundenes Detail sind spiegelbar, genau drei bleiben wie gemalt', () => {
    const fest = ALLE.filter((s) => !s.spiegelbar).map((s) => s.id);
    expect(fest.sort()).toEqual(Object.keys(SEITENGEBUNDEN).sort());
    expect(ALLE.filter((s) => s.spiegelbar).length).toBeGreaterThanOrEqual(ALLE.length - 3);
  });

  it('jede Ausnahme nennt ihren Grund in der Quelle', () => {
    for (const [id, grund] of Object.entries(SEITENGEBUNDEN)) {
      const item = id.replace(/^obj_/, '');
      const i = QUELLEN.indexOf(`item: '${item}',`);
      expect(i, id).toBeGreaterThanOrEqual(0);
      const zeile = QUELLEN.slice(i, QUELLEN.indexOf('\n', QUELLEN.indexOf('\n', i) + 1));
      expect(zeile, id).toContain('Nicht spiegelbar');
      expect(zeile, id).toContain(grund);
    }
  });

  it('Farbvarianten folgen ihrem Grundsprite', () => {
    for (const v of varianten) {
      const base = ALLE.find((s) => v.id.startsWith(`${s.id}_`) && s !== v);
      expect(base, v.id).toBeDefined();
      expect(v.spiegelbar, v.id).toBe(base?.spiegelbar);
    }
  });
});
