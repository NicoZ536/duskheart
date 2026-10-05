/**
 * M6-Gate, second picture review (ui-inventar): the tooltip kept clear of the rims of the panels behind it (ADR-0177), but
 * not of what they show inside. Its upper edge ran two pixels under the divider below "Stats" – the 1-px line and the
 * tooltip's dark outline paired into a double rule – and the "N" of "None" in the stats panel stood on its right outline,
 * the stem and the outline merging into one thick stroke. `placeTooltip` now keeps clear of the panels' lines and text
 * too, and counts a parchment frame's rim by the rows it draws.
 *
 * Coordinates are design px of ui-inventar at 1920 × 1080 (read from the screen with `readObstacles`), step 1.
 */
import { describe, expect, it } from 'vitest';
import { rasterRows } from '../../../assets-src/lib/sprite';
import { UI_GRAFIK_QUELLEN } from '../../../assets-src/ui/index';
import { UI_GRAFIKEN } from '../../../src/generated/ui';
import { FRAME_ARTEN, frameNotch, frameRim, frameRimInk, frameTileSize } from '../../../src/ui/kit';
import { breaksWord, FONT_BOX, FONT_INK, fontInk, glyphBox, glyphInk, wordInk, type MeasuredChar } from '../../../src/ui/tooltip/obstacles';
import { placeTooltip, type TooltipGlyph, type TooltipObstacles } from '../../../src/ui/tooltip/place';

const VIEW = { width: 480, height: 270 };
const GAP = 3;
const MARGIN = 2;
/** The raspberries' slot and their tooltip (200 × 201). */
const ANCHOR = { left: 227, top: 35, width: 20, height: 20 };
const TIP = { width: 200, height: 201 };

/** Equipment and inventory in wood, the stats panel on parchment (its rim: the two rows it draws). */
const FRAMES = [
  { rect: { left: 4, top: 14, width: 106, height: 145 }, rim: 7 },
  { rect: { left: 113, top: 14, width: 227, height: 183 }, rim: 7 },
  { rect: { left: 343, top: 14, width: 133, height: 226 }, rim: 2 },
];
/** The dividers under the headings of the stats panel ("Stats", "Temperature", "Protection"). */
const LINES = [31, 120, 185].map((top) => ({ left: 348, top, width: 123, height: 1 }));

/** A run of glyphs of `width` px each (ink, without the letter spacing after it) from `left` with `rows`. */
function run(left: number, count: number, width: number, rows: readonly [number, number]): TooltipGlyph[] {
  return Array.from({ length: count }, (_, i) => ({ left: left + i * (width + 1), right: left + i * (width + 1) + width, top: rows[0], bottom: rows[1] }));
}

/**
 * Text of the stats panel near the tooltip: the heading "Stats", the value of health ("100/100", its "/" at 451 – one
 * letter spacing right of the tooltip's edge at 450), the label of the last row and its value "None" (the "N" at 450).
 */
const GLYPHS: TooltipGlyph[] = [
  ...run(348, 5, 4, [22, 29]),
  ...run(436, 3, 4, [36, 43]),
  { left: 451, right: 455, top: 35, bottom: 44 },
  ...run(456, 3, 4, [36, 43]),
  ...run(348, 13, 4, [226, 235]),
  { left: 450, right: 455, top: 226, bottom: 233 },
  ...run(456, 3, 4, [228, 233]),
];

const ALL: TooltipObstacles = { frames: FRAMES, clear: 2, lines: LINES, lineClear: 3, glyphs: GLYPHS, spacing: 1, shift: 8 };

describe('Tooltip: Abstand zu Trennlinien und Text der überdeckten Tafeln', () => {
  it('ui-inventar: drei Pixel unter der Trennlinie, der Fuß zwei über dem Pergamentrand; um das „N“ wächst er nach rechts (Glyphenregel)', () => {
    // The glyph rule of ADR-0201 alone (no words, 1-px steps, reach 8) – what the second fix wave did, and what the third
    // picture review found wanting: the edge at 455 leaves "100" of "100/100" and "one" of "None".
    const p = placeTooltip(ANCHOR, TIP, VIEW, GAP, MARGIN, 1, ALL);
    expect(p.top).toBe(35);
    expect(p.top - (31 + 1)).toBe(3);
    // The parchment's rim starts at 238 (240 − 2 drawn rows): two rows of parchment under the tooltip.
    expect(238 - (p.top + TIP.height)).toBe(2);
    // The right edge at 450 stood on the "N" (450 … 455): 5 px wider, the "N" covered, "one" one spacing away.
    expect(p.left).toBe(250);
    expect(p.width).toBe(205);
  });

  it('der Mangel: ohne Linien und Text liegt die Oberkante zwei Pixel unter der Linie und das „N“ am Umriss', () => {
    const rimsOnly = { frames: FRAMES, clear: 2 };
    const p = placeTooltip({ ...ANCHOR, top: 34 }, TIP, VIEW, GAP, MARGIN, 1, rimsOnly);
    expect(p).toEqual({ left: 250, top: 34, flipped: false });
    // With the lines the 2-px gap is too little: down to 3.
    expect(placeTooltip({ ...ANCHOR, top: 34 }, TIP, VIEW, GAP, MARGIN, 1, { ...rimsOnly, lines: LINES, lineClear: 3 }).top).toBe(35);
  });

  it('der Pergamentrand zählt mit den Zeilen, die er zeichnet: mit seinem ganzen 9-Slice-Rand fände sich innen kein Platz', () => {
    // Rim 3 (its third row is parchment fill): 201 rows do not fit between line + 3 and rim − 2; the nearest free
    // height lies 10 rows further down, under the panel's foot.
    const slice = FRAMES.map((f, i) => (i === 2 ? { ...f, rim: 3 } : f));
    const far = placeTooltip(ANCHOR, TIP, VIEW, GAP, MARGIN, 1, { ...ALL, frames: slice });
    expect(far.top).toBeGreaterThanOrEqual(45);
    expect(placeTooltip(ANCHOR, TIP, VIEW, GAP, MARGIN, 1, ALL).top).toBe(35);
  });

  it('Ober- und Unterkante schneiden keine Textzeile und halten zwei Pixel zu Text außerhalb; Text darunter ist bedeckt', () => {
    const tip = { width: 100, height: 40 };
    // A row of glyphs at 50 … 57 under the tooltip's columns.
    const glyphs = run(150, 10, 4, [50, 57]);
    const o: TooltipObstacles = { frames: [], clear: 2, glyphs, spacing: 1, shift: 8 };
    const at = (top: number) => placeTooltip({ left: 120, top, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, o).top;
    // The upper edge on the row (cuts it) or one row under it: up to 50 (covers it) or down to 59 (two rows clear).
    expect(at(53)).toBe(50);
    expect(at(58)).toBe(59);
    // Above the row the glyphs are covered: free.
    expect(at(45)).toBe(45);
    // The lower edge (top + 40) mirrored: on the row → up to 48 (two rows clear above it) or down to 57 (covers it).
    expect(at(14)).toBe(17);
    expect(at(10)).toBe(8);
    expect(at(8)).toBe(8);
    // A row beside the tooltip's columns does not count.
    expect(placeTooltip({ left: 120, top: 53, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, { ...o, glyphs: run(300, 5, 4, [50, 57]) }).top).toBe(53);
  });

  it('Trennlinien: auf der Linie oder bis zu zwei Pixel daneben weicht er aus, ab drei bleibt er', () => {
    const tip = { width: 100, height: 40 };
    const o: TooltipObstacles = { frames: [], clear: 2, lines: [{ left: 100, top: 60, width: 200, height: 1 }], lineClear: 3 };
    const at = (top: number) => placeTooltip({ left: 120, top, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, o).top;
    for (const top of [58, 59, 60, 61, 62, 63]) expect([57, 64]).toContain(at(top));
    expect(at(64)).toBe(64);
    expect(at(57)).toBe(57);
    // A line beside the tooltip's columns (here 123 … 223) does not count.
    expect(placeTooltip({ left: 100, top: 60, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, { ...o, lines: [{ left: 300, top: 60, width: 100, height: 1 }] }).top).toBe(60);
    // The lower edge (top + 40) likewise.
    expect([17, 24]).toContain(at(20));
  });

  it('die ferne Seitenkante: wer einen Buchstaben anschneidet oder berührt, wächst bis hinter ihn; eine Laufweite Abstand genügt', () => {
    const tip = { width: 100, height: 40 };
    const o = (glyphs: TooltipGlyph[]): TooltipObstacles => ({ frames: [], clear: 2, glyphs, spacing: 1, shift: 8 });
    const place = (glyphs: TooltipGlyph[]) => placeTooltip({ left: 20, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, o(glyphs));
    // The right edge lies at 143.
    expect(place(run(144, 3, 4, [55, 62]))).toEqual({ left: 43, top: 50, flipped: false });
    // Touching (glyph from 143) or cut (from 141): grows to the end of that glyph's ink.
    expect(place(run(143, 3, 4, [55, 62])).width).toBe(104);
    expect(place(run(141, 3, 4, [55, 62])).width).toBe(102);
    // A glyph in rows the tooltip does not cover does not count.
    expect(place(run(143, 3, 4, [120, 127])).width).toBeUndefined();
    // Not within reach (a run of wide glyphs without a gap of a letter spacing): the tooltip keeps its width.
    expect(place([{ left: 140, right: 160, top: 55, bottom: 62 }]).width).toBeUndefined();
    // Nothing within reach is free: the least growth that cuts the fewest glyphs – 2 px clear the first glyph, the wide
    // one stays cut at every width.
    expect(
      place([
        { left: 141, right: 145, top: 55, bottom: 62 },
        { left: 140, right: 160, top: 70, bottom: 77 },
      ]).width,
    ).toBe(102);
  });

  it('die nahe Kante bleibt beim Anker; links vom Anker wächst er nach links', () => {
    const tip = { width: 100, height: 40 };
    const o = (glyphs: TooltipGlyph[]): TooltipObstacles => ({ frames: [], clear: 2, glyphs, spacing: 1, shift: 8 });
    // A glyph cut by the near (left) edge at 43 changes nothing: moving it would bare the anchor's own panel.
    expect(placeTooltip({ left: 20, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, o(run(41, 1, 4, [55, 62])))).toEqual({ left: 43, top: 50, flipped: false });
    // Flipped (no room on the right): the far edge is the left one, at 297, on a glyph of 294 … 298: the tooltip grows
    // 3 px leftwards and covers it; the right edge stays 3 px from the anchor.
    const p = placeTooltip({ left: 400, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, o([{ left: 294, right: 298, top: 55, bottom: 62 }]));
    expect(p.flipped).toBe(true);
    expect(p.left).toBe(294);
    expect(p.width).toBe(103);
    expect(p.left + (p.width ?? 0)).toBe(397);
    // A glyph left of the far edge keeps its spacing: one ending (with ink) at 296 is one spacing from 297 – free; one
    // ending at 297 touches the outline – covered by growing 4 px.
    expect(placeTooltip({ left: 400, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, o([{ left: 292, right: 296, top: 55, bottom: 62 }])).width).toBeUndefined();
    expect(placeTooltip({ left: 400, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, o([{ left: 293, right: 297, top: 55, bottom: 62 }]))).toEqual({ left: 293, top: 50, flipped: true, width: 104 });
  });

  it('wachsen nur, solange Ober- und Unterkante frei bleiben, und nie über den Bildschirmrand', () => {
    const tip = { width: 100, height: 40 };
    // Growing to 104 (the only width within reach that clears the glyphs) would bring a rim starting at column 144 into the
    // tooltip's columns, 1 px under its lower edge (90): not that width – the tooltip keeps its own.
    const frames = [{ rect: { left: 144, top: 91, width: 100, height: 100 }, rim: 7 }];
    const p = placeTooltip({ left: 20, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, { frames, clear: 2, glyphs: run(143, 3, 4, [55, 62]), spacing: 1, shift: 8 });
    expect(p).toEqual({ left: 43, top: 50, flipped: false });
    // Without the rim it grows.
    expect(placeTooltip({ left: 20, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, { frames: [], clear: 2, glyphs: run(143, 3, 4, [55, 62]), spacing: 1, shift: 8 }).width).toBe(104);
    // At the screen edge (right edge 478 = 480 − margin): no room to grow.
    const q = placeTooltip({ left: 355, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, { frames: [], clear: 2, glyphs: [{ left: 476, right: 480, top: 55, bottom: 62 }], spacing: 1, shift: 8 });
    expect(q.left + tip.width).toBe(478);
    expect(q.width).toBeUndefined();
  });

  it('die Rahmen bleiben die stärkere Regel: lassen Linien und Text keine Höhe frei, gelten die Rahmen allein', () => {
    const tip = { width: 100, height: 200 };
    const frames = [{ rect: { left: 100, top: 30, width: 300, height: 240 }, rim: 7 }];
    // Text rows every 12 px over the whole height (no position clears them all) and the frame's rim under the anchor.
    const glyphs = Array.from({ length: 22 }, (_, i) => run(150, 3, 4, [i * 12, i * 12 + 9])).flat();
    const p = placeTooltip({ left: 120, top: 33, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, { frames, clear: 2, glyphs, spacing: 1, shift: 0 });
    // The rims alone: the upper edge leaves the rim 30 … 37 (+2) – up to 28 or down to 39, whichever is nearer.
    expect(p.top).toBe(28);
  });
});

/**
 * M6-Gate, third picture review (ui-inventar, ui-inventar-ruestung): the far edge cut at glyph boundaries – "100/100" read
 * as "100", "None" as "one"; it grew by odd pixels – the iron frame's centred edge tiles (rivets) fell half a pixel off the
 * grid; and the "/" of "100/100" showed through the frame's transparent corner pixel. The text of the stats panel right of
 * x 430 as `readObstacles` reads it in ui-inventar (design px, en-US, 1920 × 1080): glyphs (ink) and words.
 */
const VALUE_GLYPHS: TooltipGlyph[] = (
  [
    [35, 44, [[451, 455]]],
    [36, 43, [[437, 440], [441, 445], [446, 450], [457, 460], [461, 465], [466, 470]]],
    [47, 56, [[451, 455]]],
    [48, 55, [[437, 440], [441, 445], [446, 450], [457, 460], [461, 465], [466, 470]]],
    [60, 67, [[457, 460], [461, 465], [466, 470]]],
    [72, 79, [[457, 460], [461, 465], [466, 470]]],
    [84, 91, [[458, 462], [463, 470]]],
    [96, 103, [[466, 470]]],
    [124, 127, [[461, 464]]],
    [125, 132, [[437, 441], [442, 446], [451, 455], [465, 470]]],
    [131, 132, [[448, 449]]],
    [137, 144, [[440, 445], [467, 470]]],
    [139, 144, [[446, 450], [451, 455], [456, 461], [462, 466]]],
    [148, 151, [[461, 464]]],
    [149, 156, [[442, 446], [451, 455], [465, 470]]],
    [155, 156, [[448, 449]]],
    [160, 163, [[461, 464]]],
    [161, 168, [[432, 435], [436, 440], [446, 450], [451, 455], [465, 470]]],
    [164, 165, [[441, 446]]],
    [176, 183, [[427, 431], [442, 446], [447, 450]]],
    [178, 183, [[432, 436], [437, 441], [451, 455], [456, 460]]],
    [190, 197, [[466, 470]]],
    [202, 209, [[466, 470]]],
    [214, 221, [[466, 470]]],
    [226, 233, [[450, 455]]],
    [228, 233, [[456, 460], [461, 465], [466, 470]]],
  ] as const
).flatMap(([top, bottom, cols]) => cols.map(([left, right]) => ({ left, right, top, bottom })));
/** "100/100" ×2, "100" ×2, "0%", "0", "37.0 °C", "Normal", "8.3 °C", "12–26", "°C", "protection", "0" ×3, "None". */
const VALUE_WORDS: TooltipGlyph[] = (
  [
    [437, 35, 470, 44],
    [437, 47, 470, 56],
    [457, 60, 470, 67],
    [457, 72, 470, 79],
    [458, 84, 470, 91],
    [466, 96, 470, 103],
    [437, 124, 470, 132],
    [440, 137, 470, 144],
    [442, 148, 470, 156],
    [432, 161, 455, 168],
    [461, 160, 470, 168],
    [412, 176, 460, 185],
    [466, 190, 470, 197],
    [466, 202, 470, 209],
    [466, 214, 470, 221],
    [450, 226, 470, 233],
  ] as const
).map(([left, top, right, bottom]) => ({ left, top, right, bottom }));
/** The obstacles of ui-inventar as the tooltip reads them now: words, 2-px steps, reach 24, the iron frame's 1-px notch. */
const NOW: TooltipObstacles = { ...ALL, glyphs: [...GLYPHS.filter((g) => g.left < 430), ...VALUE_GLYPHS], words: VALUE_WORDS, shift: 24, widthStep: 2, notch: 1 };

/** The words of `words` in the rows [`top`, `bottom`) that a far edge at `x` cuts (neither wholly left of it with one spacing nor under it). */
function cutWords(x: number, top: number, bottom: number, words: readonly TooltipGlyph[]): TooltipGlyph[] {
  return words.filter((w) => w.top < bottom && w.bottom > top && x > w.left - 1 && x < w.right);
}

describe('Tooltip: Werte ganz oder gar nicht, Nieten auf dem Raster, Eckkerbe', () => {
  it('ui-inventar: die ferne Kante schneidet keinen Wert – er deckt die Wertespalte ganz (220 breit, gerade)', () => {
    const p = placeTooltip(ANCHOR, TIP, VIEW, GAP, MARGIN, 1, NOW);
    expect(p).toEqual({ left: 250, top: 35, flipped: false, width: 220 });
    const right = p.left + (p.width ?? 0);
    expect(cutWords(right, p.top, p.top + TIP.height, VALUE_WORDS)).toEqual([]);
    // Every value of the column lies under it; the panel keeps four columns of parchment before its rim (474).
    expect(VALUE_WORDS.filter((w) => w.left >= 430).every((w) => w.right <= right)).toBe(true);
    expect(474 - right).toBe(4);
    // The round-3 edge (455) and the natural one (450) cut values: "100/100", "37.0 °C", "Normal", "None" …
    expect(cutWords(455, 35, 236, VALUE_WORDS).length).toBeGreaterThanOrEqual(5);
    expect(cutWords(450, 35, 236, VALUE_WORDS).length).toBeGreaterThanOrEqual(5);
  });

  it('der Mangel: an Glyphengrenzen und um ungerade Pixel – ohne Wörter bleibt „100“ und „one“, 205 breit', () => {
    const glyphRule = placeTooltip(ANCHOR, TIP, VIEW, GAP, MARGIN, 1, { ...NOW, words: undefined, widthStep: 1, shift: 8, notch: 0 });
    expect(glyphRule.width).toBe(205);
    expect(cutWords(455, 35, 236, VALUE_WORDS).map((w) => w.top)).toEqual(expect.arrayContaining([35, 47, 226]));
  });

  it('wächst nur in Schritten von zwei Pixeln: die Breite bleibt gerade', () => {
    const tip = { width: 100, height: 40 };
    // A glyph from 141 to 145 under the right edge (143): clean at 145 (+2) – and at +3 with 1-px steps, not on the grid.
    const glyphs = [{ left: 141, right: 145, top: 55, bottom: 62 }, { left: 147, right: 151, top: 55, bottom: 62 }];
    const at = (widthStep: number) => placeTooltip({ left: 20, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, { frames: [], clear: 2, glyphs, spacing: 1, shift: 8, widthStep });
    expect(at(1).width).toBe(102);
    expect(at(2).width).toBe(102);
    // Clean only at odd growth (+3: one spacing before the glyph from 147): on the 2-px grid the nearest clean width lies
    // beyond that glyph (+8).
    const odd = [{ left: 140, right: 146, top: 55, bottom: 62 }, { left: 147, right: 150, top: 55, bottom: 62 }];
    const at2 = (widthStep: number) => placeTooltip({ left: 20, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, { frames: [], clear: 2, glyphs: odd, spacing: 1, shift: 8, widthStep });
    expect(at2(1).width).toBe(103);
    expect(at2(2).width).toBe(108);
    for (const w of [at(2).width, at2(2).width]) expect(((w ?? 100) - 100) % 2).toBe(0);
  });

  it('Wörter ganz oder gar nicht: er wächst über ein angeschnittenes Wort hinweg, sonst so wenige wie möglich', () => {
    const tip = { width: 100, height: 40 };
    const place = (glyphs: TooltipGlyph[], words: TooltipGlyph[], shift = 24) =>
      placeTooltip({ left: 20, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, { frames: [], clear: 2, glyphs, words, spacing: 1, shift, widthStep: 2 });
    // A word of four glyphs 134 … 153 whose letter boundary lies under the edge (glyph to 143, the next from 144): the glyph
    // rule alone keeps the width, the word rule covers the whole word (+10 → 153).
    const word = run(134, 4, 4, [55, 62]);
    expect(place(word, []).width).toBeUndefined();
    expect(place(word, [{ left: 134, right: 153, top: 55, bottom: 62 }]).width).toBe(110);
    // A word starting one spacing right of the edge is free; one touching it is covered (+9, on the grid +10).
    expect(place(run(144, 2, 4, [55, 62]), [{ left: 144, right: 153, top: 55, bottom: 62 }]).width).toBeUndefined();
    expect(place(run(143, 2, 4, [55, 62]), [{ left: 143, right: 152, top: 55, bottom: 62 }]).width).toBe(110);
    // A word in rows beside the tooltip's (it spans 50 … 90) does not count; words without glyphs count all the same.
    expect(place(run(134, 4, 4, [120, 127]), [{ left: 134, right: 153, top: 120, bottom: 127 }]).width).toBeUndefined();
    expect(place([], [{ left: 134, right: 153, top: 55, bottom: 62 }]).width).toBe(110);
    // Out of reach (a long word): no width is free of it – the tooltip keeps its own (no glyph cut there either).
    expect(place(run(124, 12, 4, [55, 62]), [{ left: 124, right: 183, top: 55, bottom: 62 }]).width).toBeUndefined();
    // Two words, one coverable within reach: covered, the other stays cut (fewer cut words beat less growth).
    const two = [...run(134, 4, 4, [55, 62]), ...run(99, 20, 4, [70, 77])];
    expect(place(two, [{ left: 134, right: 153, top: 55, bottom: 62 }, { left: 99, right: 198, top: 70, bottom: 77 }]).width).toBe(110);
    // A cut glyph weighs more than a cut word: at +2 no glyph but a word is cut, at +4 a glyph but no word – +2.
    const glyphs = [{ left: 141, right: 145, top: 55, bottom: 62 }, { left: 146, right: 150, top: 70, bottom: 77 }];
    expect(place(glyphs, [{ left: 130, right: 146, top: 55, bottom: 62 }], 4).width).toBe(102);
  });

  it('die Eckkerbe des Rahmens zeigt, was darunter liegt: ein Zeichen dort ist nicht bedeckt', () => {
    const tip = { width: 100, height: 40 };
    // A glyph wholly under the tooltip but in its top-right corner pixel (column 142, row 50): the tooltip moves up a row.
    const glyphs = [{ left: 139, right: 143, top: 50, bottom: 57 }];
    const at = (notch: number) => placeTooltip({ left: 20, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, { frames: [], clear: 2, glyphs, spacing: 1, shift: 0, notch });
    expect(at(0).top).toBe(50);
    expect(at(1).top).toBe(49);
    // In the bottom-left corner likewise (row 89, column 43): up or down out of the corner.
    const low = [{ left: 43, right: 47, top: 82, bottom: 90 }];
    const q = placeTooltip({ left: 20, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, { frames: [], clear: 2, glyphs: low, spacing: 1, shift: 0, notch: 1 });
    expect(q.top + tip.height === 90).toBe(false);
    // ui-inventar: the round-3 width (205) put the "/" of "100/100" (451 … 455, from row 35) under the top-right notch.
    expect(VALUE_GLYPHS.some((g) => g.top === 35 && g.left < 455 && g.right > 454)).toBe(true);
    const glyphRule = { ...NOW, words: undefined, widthStep: 1, shift: 8 };
    expect(placeTooltip(ANCHOR, TIP, VIEW, GAP, MARGIN, 1, { ...glyphRule, notch: 0 }).width).toBe(205);
    expect(placeTooltip(ANCHOR, TIP, VIEW, GAP, MARGIN, 1, { ...glyphRule, notch: 1 }).width).not.toBe(205);
  });

  it('die ferne Kante zählt die Kerben ihrer Ecken auch beim Wachsen (gespiegelt links vom Anker)', () => {
    const tip = { width: 100, height: 40 };
    // No height is free of the rows (text every 9 rows) – the edges keep the rims alone; the far corner then decides.
    const rows = Array.from({ length: 30 }, (_, i) => [...run(60, 1, 4, [i * 9, i * 9 + 7]), ...run(350, 1, 4, [i * 9, i * 9 + 7])]).flat();
    // A glyph from 141 to 143 in rows 50 … 57 at the right edge (143) of a tooltip at top 50: covered, but in the notch.
    const corner = { left: 141, right: 143, top: 50, bottom: 57 };
    const o = (notch: number): TooltipObstacles => ({ frames: [], clear: 2, glyphs: [...rows, corner], spacing: 1, shift: 8, widthStep: 2, notch });
    expect(placeTooltip({ left: 20, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, o(0)).width).toBeUndefined();
    expect(placeTooltip({ left: 20, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, o(1)).width).toBe(102);
    // Flipped: the far edge is the left one (297); a glyph at 297 … 299 in its top-left notch → 2 px further left.
    const flippedCorner = { left: 297, right: 299, top: 50, bottom: 57 };
    const f = placeTooltip({ left: 400, top: 50, width: 20, height: 20 }, tip, VIEW, GAP, MARGIN, 1, { ...o(1), glyphs: [...rows, flippedCorner] });
    expect(f.flipped).toBe(true);
    expect(f.width).toBe(102);
    expect(f.left).toBe(295);
  });
});

describe('Tooltip: Wörter aus den gemessenen Zeichen', () => {
  const ch = (left: number, width: number, ink: boolean, breaks = false, bottom = 16): MeasuredChar => ({
    box: { left, top: bottom - 16, right: left + width, bottom },
    ink: ink ? { left, top: bottom - 11, right: left + width - 1, bottom: bottom - 4 } : null,
    breaks,
  });
  it('trennt an brechenden Leerzeichen, an Lücken und Zeilenwechseln; geschützte Leerzeichen und Zeichen ohne Tinte verbinden', () => {
    // "100/100": one word; "Normal None": two; "37.0 °C" with a no-break space: one.
    expect(wordInk([0, 5, 10, 15, 20, 25, 30].map((x) => ch(x, 5, true)))).toEqual([{ left: 0, top: 5, right: 34, bottom: 12 }]);
    expect(wordInk([ch(0, 5, true), ch(5, 5, true), ch(10, 5, false, true), ch(15, 5, true)])).toHaveLength(2);
    expect(wordInk([ch(0, 5, true), ch(5, 5, false), ch(10, 5, true)])).toEqual([{ left: 0, top: 5, right: 14, bottom: 12 }]);
    // Abutting boxes from two elements join; a gap (label and value of a row) or another line splits.
    expect(wordInk([ch(0, 5, true), ch(5.25, 5, true)])).toHaveLength(1);
    expect(wordInk([ch(0, 5, true), ch(8, 5, true)])).toHaveLength(2);
    expect(wordInk([ch(0, 5, true), ch(5, 5, true, false, 28)])).toHaveLength(2);
    // A breaking space with ink of its own (U+1680 OGHAM SPACE MARK) separates the words and belongs to neither.
    expect(wordInk([ch(0, 5, true), ch(5, 5, true, true), ch(10, 5, true)])).toEqual([
      { left: 0, top: 5, right: 4, bottom: 12 },
      { left: 10, top: 5, right: 14, bottom: 12 },
    ]);
    expect(breaksWord('\u1680')).toBe(true);
    // A word without shown ink is none; a breaking space at the start or end changes nothing.
    expect(wordInk([ch(0, 5, false), ch(5, 5, false)])).toEqual([]);
    expect(wordInk([ch(0, 5, false, true), ch(5, 5, true), ch(10, 5, false, true)])).toHaveLength(1);
    expect(breaksWord(' ')).toBe(true);
    expect(breaksWord('\n')).toBe(true);
    for (const nb of ['\u00a0', '\u2007', '\u202f', 'x', '/', '°']) expect(breaksWord(nb), nb).toBe(false);
  });
});

describe('Tooltip: Kacheln des Rahmens auf ganzen Pixeln', () => {
  it('Breite auf-, Höhe abgerundet, bis die mittige Randkachel auf ganzen Pixeln beginnt', () => {
    const g = UI_GRAFIKEN.rahmen_eisen;
    // The edges repeat (border-image-repeat: repeat centres the tiles, tools/assets/ui-step.ts).
    expect(g.kanten).toBe('wiederholen');
    const tile = g.width - g.slice[1] - g.slice[3];
    for (let size = 40; size <= 330; size++) {
      const w = frameTileSize('eisen', 'width', size, true);
      const h = frameTileSize('eisen', 'height', size, false);
      expect([size, size + 1]).toContain(w);
      expect([size, size - 1]).toContain(h);
      // The first whole tile starts (edge − tile) / 2 into the edge: a whole pixel.
      expect(Number.isInteger((w - g.slice[1] - g.slice[3] - tile) / 2), `width ${size}`).toBe(true);
      expect(Number.isInteger((h - g.slice[0] - g.slice[2] - tile) / 2), `height ${size}`).toBe(true);
    }
    // ui-inventar: 205 × 201 (round 3) → neither; 200 and 220 wide, 200 high are on the grid; growing by 2 keeps it.
    expect(frameTileSize('eisen', 'width', 205, true)).toBe(206);
    expect(frameTileSize('eisen', 'height', 201, false)).toBe(200);
    expect(frameTileSize('eisen', 'width', 220, true)).toBe(220);
    expect(frameTileSize('eisen', 'width', 222, true)).toBe(222);
  });

  it('die Eckkerbe jedes Rahmens: das kleinste Quadrat je Ecke, das alle durchsichtigen Eckpixel enthält (aus den Quellrastern)', () => {
    for (const art of FRAME_ARTEN) {
      const q = UI_GRAFIK_QUELLEN.find((x) => x.id === `rahmen_${art}`);
      expect(q, art).toBeDefined();
      if (q === undefined) continue;
      const rows = rasterRows(q.raster);
      const slice = typeof q.slice === 'number' ? q.slice : (q.slice?.[0] ?? 0);
      const size = rows.length;
      let notch = 0;
      // Transparent pixels in each corner slice: their farthest distance from the corner along either axis.
      for (const [fx, fy] of [[false, false], [true, false], [false, true], [true, true]] as const)
        for (let y = 0; y < slice; y++)
          for (let x = 0; x < slice; x++) {
            const c = rows[fy ? size - 1 - y : y]?.[fx ? size - 1 - x : x];
            if (c === '.') notch = Math.max(notch, x + 1, y + 1);
          }
      expect(frameNotch(art), art).toBe(notch);
    }
    expect(frameNotch('eisen')).toBe(1);
  });
});

describe('Tooltip: Rand und Schrift der Tafeln', () => {
  it('Pergament zeichnet zwei Randzeilen, Holz und Eisen ihren ganzen 9-Slice-Rand (aus den Quellrastern)', () => {
    for (const art of FRAME_ARTEN) {
      const q = UI_GRAFIK_QUELLEN.find((g) => g.id === `rahmen_${art}`);
      expect(q, art).toBeDefined();
      if (q === undefined) continue;
      const rows = rasterRows(q.raster);
      const slice = typeof q.slice === 'number' ? q.slice : (q.slice?.[0] ?? 0);
      const width = rows[0]?.length ?? 0;
      // The fill: the character at the middle of the graphic.
      const fill = rows[Math.floor(rows.length / 2)]?.[Math.floor(width / 2)];
      // Rows of the edge (between the corners) that are not mostly fill, from the top and from the bottom.
      const rim = (order: readonly string[]): number => {
        let n = 0;
        for (const row of order.slice(0, slice)) {
          const edge = row.slice(slice, width - slice);
          if ([...edge].filter((c) => c === fill).length * 2 > edge.length) break;
          n++;
        }
        return n;
      };
      expect(frameRimInk(art), art).toBe(Math.max(rim(rows), rim([...rows].reverse())));
      expect(frameRimInk(art)).toBeLessThanOrEqual(frameRim(art));
    }
    expect(frameRimInk('pergament')).toBe(2);
  });

  it('Tinte eines Zeichens: Versalien und Ziffern 7 Zeilen, Akzente 10, Unterlängen 2, Leerzeichen ohne Tinte', () => {
    expect(glyphInk('N', 6)).toEqual({ left: 0, right: 5, above: 7, below: 0 });
    expect(glyphInk('g', 5)).toEqual({ left: 0, right: 4, above: 7, below: 2 });
    expect(glyphInk('Ä', 6)?.above).toBe(10);
    expect(glyphInk('/', 5)).toEqual({ left: 0, right: 4, above: FONT_INK.accent, below: FONT_INK.descent });
    expect(glyphInk(' ', 5)).toBeNull();
    expect(glyphInk('­', 0)).toBeNull();
    // Without a document (or before the font is loaded) the font's own ink falls back to these rules.
    expect(fontInk('N', 6)).toEqual(glyphInk('N', 6));
  });

  it('aus dem Kasten eines Zeichens (Range) wird seine Tinte in Bildschirmpunkten', () => {
    // "N" of "None" at scale 4: box 1800 … 1824 × 884 … 948 (16 font px high, baseline 12 below its top).
    const box = { left: 1800, top: 884, right: 1824, bottom: 948 };
    expect((box.bottom - box.top) / (FONT_BOX.ascent + FONT_BOX.descent)).toBe(4);
    expect(glyphBox(box, { left: 0, right: 5, above: 7, below: 0 })).toEqual({ left: 1800, right: 1820, top: 904, bottom: 932 });
    expect(glyphBox(box, null)).toBeNull();
    expect(glyphBox({ ...box, bottom: box.top }, { left: 0, right: 5, above: 7, below: 0 })).toBeNull();
  });
});
