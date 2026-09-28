/**
 * M5-33 (MASTERPROMPT §4.4 „Klippen in Höhenstufen … klar lesbar“, §4.5): the cliff walls of every biome group are
 * natural rock faces, not dry-stone masonry, and the plateau edge carries a light rim – checked on the tilesets
 * themselves (assets-src/sprites/terrain/klippe_*.ts through `_klippe.ts`):
 * - no thin crevice line runs across a face (a masonry course);
 * - every face has vertical cracks or strata: dark runs of at least four rows;
 * - the two faces of a group differ, and the groups differ from each other (their own strata);
 * - at a south edge the first row below the plateau is lighter than the row under it (light rim over the edge's
 *   shadow) in every column;
 * - the side faces run vertically (no horizontal block joints across them).
 */
import { describe, expect, it } from 'vitest';
import { flatPalette } from '../../../assets-src/palette';
import type { Sprite, SpriteFrame } from '../../../assets-src/lib/sprite';
import gruen from '../../../assets-src/sprites/terrain/klippe_gruen';
import stein from '../../../assets-src/sprites/terrain/klippe_stein';
import sand from '../../../assets-src/sprites/terrain/klippe_sand';
import asche from '../../../assets-src/sprites/terrain/klippe_asche';
import kristall from '../../../assets-src/sprites/terrain/klippe_kristall';
import hoehle from '../../../assets-src/sprites/terrain/klippe_hoehle';
import { blobIndex, KLIPPE_FRAME, MASKE_VOLL, NB, UEBERGANG, WAND_SPALTE, WAND_ZEILE, wandFrame } from '../../../src/world/autotile';

const TILE = 16;
const GROUPS: ReadonlyArray<readonly [string, Sprite]> = [
  ['gruen', gruen],
  ['stein', stein],
  ['sand', sand],
  ['asche', asche],
  ['kristall', kristall],
  ['hoehle', hoehle],
];
const PALETTE = flatPalette();

/** Relative luminance of palette index `i` (1…64). */
function luminance(i: number): number {
  const hex = PALETTE[i - 1] ?? '#000000';
  const [r, g, b] = [1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function frameOf(s: Sprite, f: number): SpriteFrame {
  const frame = s.frames[f];
  if (frame === undefined) throw new Error(`${s.id}: Frame ${f} fehlt`);
  return frame;
}

/** The two middle faces (no wall ends, no foot): the face and its variant. */
function faces(s: Sprite): SpriteFrame[] {
  return [frameOf(s, wandFrame(UEBERGANG.keiner, WAND_ZEILE.mitte, WAND_SPALTE.mitte)), frameOf(s, KLIPPE_FRAME.wandVariante + WAND_ZEILE.mitte)];
}

/** Pixels of a face darker than `share` of its median luminance (0.6: the cracks and fractures; 0.75: with the grooves). */
function darker(f: SpriteFrame, share: number): boolean[] {
  const lum = Array.from(f.index, (i) => luminance(i));
  const median = [...lum].sort((a, b) => a - b)[lum.length >> 1] ?? 0;
  return lum.map((l) => l < median * share);
}

/** Share of row `y` that is dark. */
function rowShare(dark: readonly boolean[], y: number): number {
  let n = 0;
  for (let x = 0; x < TILE; x++) if (dark[(((y % TILE) + TILE) % TILE) * TILE + x] === true) n++;
  return n / TILE;
}

describe('Klippenwände als natürliche Felsflächen (M5-33)', () => {
  it.each(GROUPS)('%s: keine Fuge läuft als Mauerlage quer über die Fläche', (_name, s) => {
    // A masonry course: a thin line of crevice across (almost) the whole width with open rock above and below it.
    // Bands of darker rock (the strata of the sandstone) are thick and do not count.
    for (const f of faces(s)) {
      const c = darker(f, 0.6);
      for (let y = 0; y < TILE; y++) {
        const course = rowShare(c, y) >= 0.75 && rowShare(c, y - 1) < 0.5 && rowShare(c, y + 1) < 0.5;
        expect(course, `Reihe ${y}`).toBe(false);
      }
    }
  });

  it.each(GROUPS)('%s: senkrechte Risse oder Schichten – dunkle Läufe über mindestens vier Reihen', (_name, s) => {
    for (const f of faces(s)) {
      const c = darker(f, 0.75);
      let runs = 0;
      for (let x = 0; x < TILE; x++) {
        let run = 0;
        let best = 0;
        for (let y = 0; y < TILE; y++) {
          run = c[y * TILE + x] === true ? run + 1 : 0;
          best = Math.max(best, run);
        }
        if (best >= 4) runs++;
      }
      expect(runs).toBeGreaterThanOrEqual(1);
    }
  });

  it('beide Fassungen einer Gruppe unterscheiden sich, jede Gruppe hat ihre eigene Fläche', () => {
    const keys = GROUPS.map(([, s]) => faces(s).map((f) => Array.from(f.index).join(',')));
    for (const [a, b] of keys) expect(a).not.toBe(b);
    // The faces as patterns (tones ranked within the face): no two groups share one.
    const patterns = GROUPS.map(([, s]) => {
      const f = faces(s)[0] as SpriteFrame;
      const tones = [...new Set(Array.from(f.index))].sort((a, b) => luminance(a) - luminance(b));
      return Array.from(f.index, (i) => tones.indexOf(i)).join('');
    });
    // The cave rock is the Grünhain rock turned round with other tones (a mirrored face), not the same face.
    expect(new Set(patterns).size).toBe(GROUPS.length);
  });

  it.each(GROUPS)('%s: an der Südkante liegt über dem Schatten der Kante eine Lichtkante', (_name, s) => {
    // Plateau tile whose southern neighbours are lower: the rim draws the lip below the plateau surface.
    const rim = frameOf(s, KLIPPE_FRAME.kante + blobIndex(MASKE_VOLL & ~(NB.S | NB.SE | NB.SW)));
    let lit = 0;
    for (let x = 0; x < TILE; x++) {
      let y = 0;
      while (y < TILE && rim.index[y * TILE + x] === 0) y++;
      const kante = rim.index[y * TILE + x] ?? 0;
      const darunter = rim.index[(y + 1) * TILE + x] ?? 0;
      expect(kante, `Spalte ${x}`).toBeGreaterThan(0);
      if (luminance(kante) > luminance(darunter)) lit++;
    }
    expect(lit).toBe(TILE);
  });

  it.each(GROUPS)('%s: die Seitenflächen der Wandenden laufen senkrecht (keine Blockfugen quer)', (_name, s) => {
    const end = frameOf(s, wandFrame(UEBERGANG.keiner, WAND_ZEILE.mitte, WAND_SPALTE.links));
    // Columns 1…4 of the left end are the side face: no row of it is darker than the rows above and below at once in
    // all four columns (a horizontal joint).
    const side = (x: number, y: number): number => luminance(end.index[y * TILE + x] ?? 0);
    for (let y = 1; y < TILE - 1; y++) {
      let joint = true;
      for (let x = 1; x <= 4; x++) if (!(side(x, y) < side(x, y - 1) && side(x, y) < side(x, y + 1))) joint = false;
      expect(joint, `Reihe ${y}`).toBe(false);
    }
  });
});
