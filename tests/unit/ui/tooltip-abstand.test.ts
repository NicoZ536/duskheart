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
import { FRAME_ARTEN, frameRim, frameRimInk } from '../../../src/ui/kit';
import { FONT_BOX, FONT_INK, fontInk, glyphBox, glyphInk } from '../../../src/ui/tooltip/obstacles';
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
  it('ui-inventar: drei Pixel unter der Trennlinie, der Fuß zwei über dem Pergamentrand; um das „N“ wächst er nach rechts', () => {
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
