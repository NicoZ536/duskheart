/**
 * Lesbare Beschriftungen der Debug-Overlays (M6-Gate visual:debug-overlay-labels und Bildmängel des M6-Screenshot-Satzes;
 * MASTERPROMPT §31.5 „UI-Ausrichtung“, §31.6 Overlays; src/render/passes/debugOverlayPass.ts `queueDebugOverlay`,
 * `DebugLabelPlacer`; src/render/debugOverlay.ts `DebugOverlayList`):
 * - jede Geometrie (Punkte, Kegel, Pfadquadrate) liegt unter jeder Beschriftung ihrer Ebene – auch unter der zuerst erzeugten;
 * - eine Namensbeschriftung liegt auf ihrer dunklen Platte, alle ihre Zeilen auf einer Platte ohne Fuge;
 * - ein Wert einer Kachel (Temperatur, Stützabstand) steht mittig in seiner Kachel, umrandet ohne Platte – die Farbe der
 *   Kachel bleibt sichtbar – und wird nie verschoben, auch nicht von der Stapelregel (overlay-stuetzen);
 * - eine Beschriftung, die an ihrem Platz nicht ins Bild passt, entfällt: nichts wird vom Rand hereingerückt, wo die Tafeln
 *   des HUD liegen und ihre Platte anschneiden würden (overlay-raumtemperatur);
 * - Namensbeschriftungen weichen Werten, Marken (Pfadschritte, Ziel, nächster Schritt; debug-pfade) und einander aus
 *   (nach unten versetzt, am unteren Rand nach oben), nicht aber Feldern;
 * - die Werkzeuge des Spielers (Baugeist, Fallenvorschau) liegen auf der Ebene über den Overlays: keine Beschriftung
 *   deckt den Rahmen des Geists (overlay-raumtemperatur).
 */
import { describe, expect, it } from 'vitest';
import { DebugOverlayList, OVERLAY_LAYER } from '../../../src/render/debugOverlay';
import { DEBUG_LABEL, DEBUG_LABEL_PLATE, DebugLabelPlacer, DebugLabelStyle, queueDebugOverlay, type DebugOverlaySink } from '../../../src/render/passes/debugOverlayPass';
import type { Glyph } from '../../../src/render/text/glyphAtlas';
import { TextLayout, type GlyphSource } from '../../../src/render/text/layout';

/** A pixel font of 3 × 5 glyphs on a 4 px advance (space: blank); ink from the block top down (ascent 5). */
const FONT: GlyphSource = {
  metrics: { ascent: 5, descent: 1, lineGap: 2, lineHeight: 8 },
  glyphCode(code: number): Glyph {
    const blank = code === 0x20;
    return { char: String.fromCodePoint(code), advance: 4, offsetX: 0, offsetY: -5, width: blank ? 0 : 3, height: blank ? 0 : 5, atlasX: 0, atlasY: 0 };
  },
};
const PAD = DEBUG_LABEL.outlinePx + DEBUG_LABEL.marginPx;
const O = DEBUG_LABEL.outlinePx;
const GLYPH_W = 3;
const GLYPH_H = 5;
const ADVANCE = 4;
const T = 16;
const W = 322;
const H = 182;
const WHITE = 0xffffffff;

interface Op {
  readonly kind: 'rect' | 'text';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: number;
  readonly text: string;
}

class Recorder implements DebugOverlaySink {
  readonly ops: Op[] = [];
  rect(x: number, y: number, w: number, h: number, color: number): void {
    this.ops.push({ kind: 'rect', x, y, w, h, color, text: '' });
  }
  text(text: string, x: number, y: number): void {
    // The ink box of the fake font's first line (glyphs from the block's left edge and top).
    const first = text.split('\n')[0] ?? '';
    this.ops.push({ kind: 'text', x, y, w: first.length * ADVANCE - (ADVANCE - GLYPH_W), h: GLYPH_H, color: 0, text });
  }
}

function queue(list: DebugOverlayList, originX = 0, originY = 0): Recorder {
  const r = new Recorder();
  queueDebugOverlay(list, originX, originY, W, H, r, FONT, new TextLayout(), new DebugLabelPlacer(), new DebugLabelStyle());
  return r;
}

/** The plates (name label boxes) the recorder got, in order. */
function plates(r: Recorder): Op[] {
  return r.ops.filter((o) => o.kind === 'rect' && o.color === DEBUG_LABEL_PLATE);
}

function texts(r: Recorder): Op[] {
  return r.ops.filter((o) => o.kind === 'text');
}

function overlaps(a: Op, b: Op, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/** The ink box of a value's text op widened by its outline. */
function outlined(t: Op): Op {
  return { ...t, x: t.x - O, y: t.y - O, w: t.w + 2 * O, h: t.h + 2 * O };
}

describe('Debug-Overlay: Beschriftungen nach der Geometrie, im Bild, ohne Überdeckung', () => {
  it('jede Geometrie liegt unter jeder Beschriftung, auch wenn die Beschriftung zuerst erzeugt wurde', () => {
    const list = new DebugOverlayList();
    list.label(40, 40, 'simulation', WHITE);
    list.rect(44, 42, 4, 4, 0x00ff00ff);
    list.label(100, 60, 'grazing', WHITE);
    list.rect(104, 62, 2, 2, 0x00ffffff);
    const r = queue(list);
    const firstText = r.ops.findIndex((o) => o.kind === 'text');
    const geometry = r.ops.filter((o) => o.kind === 'rect' && o.color !== DEBUG_LABEL_PLATE);
    expect(geometry).toHaveLength(2);
    for (const g of geometry) expect(r.ops.indexOf(g)).toBeLessThan(firstText);
    // The rects keep their world place (origin 0).
    expect(geometry.map((g) => [g.x, g.y])).toEqual([
      [44, 42],
      [104, 62],
    ]);
  });

  it('jede Namensbeschriftung liegt auf einer Platte, die ihre Tinte samt Umriss umschließt', () => {
    const list = new DebugOverlayList();
    list.label(40, 40, 'resting', WHITE);
    list.label(200, 90, 'roaming', WHITE);
    const r = queue(list);
    const ts = texts(r);
    const ps = plates(r);
    expect(ps).toHaveLength(ts.length);
    ts.forEach((t, i) => {
      const p = ps[i] as Op;
      expect(r.ops.indexOf(p)).toBe(r.ops.indexOf(t) - 1);
      expect(t.x - p.x).toBe(PAD);
      expect(t.y - p.y).toBe(PAD);
      expect(p.x + p.w).toBeGreaterThanOrEqual(t.x + t.w + O);
    });
    // Ungestört bleibt die Beschriftung an ihrem Anker (World → Target).
    expect([ts[0]?.x, ts[0]?.y]).toEqual([40, 40]);
  });

  it('eine zweizeilige Beschriftung (Raumname und Größe) liegt auf einer Platte ohne Fuge, so breit wie ihre längste Zeile (overlay-raeume)', () => {
    const list = new DebugOverlayList();
    list.label(60, 50, 'Bedroom\n20 tiles', WHITE);
    const r = queue(list);
    const ps = plates(r);
    expect(ps).toHaveLength(1);
    expect(texts(r)).toHaveLength(1);
    const p = ps[0] as Op;
    // Both lines: one line pitch plus the last line's ascent and descent, the pad above and below.
    expect(p.h).toBe(FONT.metrics.lineHeight + FONT.metrics.ascent + FONT.metrics.descent + 2 * PAD);
    // The longer line ('20 tiles', 8 glyphs) sets the width.
    expect(p.w).toBe(8 * ADVANCE - (ADVANCE - GLYPH_W) + 2 * PAD);
    expect([p.x, p.y]).toEqual([60 - PAD, 50 - PAD]);
  });

  it('Werte je Kachel stehen mittig in ihrer Kachel, umrandet ohne Platte, im Kachelraster ohne Stapelregel (overlay-stuetzen)', () => {
    const list = new DebugOverlayList();
    // A roof of 5 × 4 tiles: its fields (the theme), then a distance in every tile.
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 5; tx++) list.rect(64 + tx * T, 32 + ty * T, T, T, 0x80c060ff);
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 5; tx++) list.value(64 + tx * T, 32 + ty * T, T, T, ty === 0 || ty === 3 || tx === 0 || tx === 4 ? '1' : '2', WHITE);
    const r = queue(list);
    // No plate darkens the tiles' colour.
    expect(plates(r)).toHaveLength(0);
    const ts = texts(r);
    expect(ts).toHaveLength(20);
    ts.forEach((t, i) => {
      const cx = 64 + (i % 5) * T;
      const cy = 32 + Math.floor(i / 5) * T;
      // Centred: as much room left as right (± 1 px for odd remainders), above as below.
      expect(t.x - cx).toBe(Math.floor((T - GLYPH_W) / 2));
      expect(t.y - cy).toBe(Math.floor((T - GLYPH_H) / 2));
      // Ink and outline inside the tile: nothing reaches into the neighbour tile.
      const b = outlined(t);
      expect(b.x).toBeGreaterThanOrEqual(cx);
      expect(b.y).toBeGreaterThanOrEqual(cy);
      expect(b.x + b.w).toBeLessThanOrEqual(cx + T);
      expect(b.y + b.h).toBeLessThanOrEqual(cy + T);
    });
    // The rows keep the tile pitch (16 px), not label height plus gap.
    const rows = [...new Set(ts.map((t) => t.y))];
    expect(rows.map((y) => y - (rows[0] as number))).toEqual([0, T, 2 * T, 3 * T]);
  });

  it('ein Wert breiter als seine Kachel bleibt auf ihrer Mitte (−29°, overlay-temperatur), auch neben einem anderen Wert', () => {
    const list = new DebugOverlayList();
    list.value(80, 64, T, T, '-29°', WHITE);
    list.value(96, 64, T, T, '-29°', WHITE);
    const r = queue(list);
    const ts = texts(r);
    const ink = 4 * ADVANCE - (ADVANCE - GLYPH_W);
    expect(ts.map((t) => [t.x, t.y])).toEqual([
      [80 + Math.floor((T - ink) / 2), 64 + Math.floor((T - GLYPH_H) / 2)],
      [96 + Math.floor((T - ink) / 2), 64 + Math.floor((T - GLYPH_H) / 2)],
    ]);
  });

  it('Namensbeschriftungen weichen Werten aus; der Wert bleibt in seiner Kachel', () => {
    const list = new DebugOverlayList();
    list.value(96, 64, T, T, '17°', WHITE);
    // A room name whose plate would cover the value.
    list.label(92, 66, 'Bedroom', WHITE);
    const r = queue(list);
    const [value, name] = texts(r) as [Op, Op];
    expect(value.text).toBe('17°');
    expect([value.x - 96, value.y - 64]).toEqual([Math.floor((T - (3 * ADVANCE - 1)) / 2), Math.floor((T - GLYPH_H) / 2)]);
    const plate = plates(r)[0] as Op;
    expect(overlaps(plate, outlined(value), DEBUG_LABEL.gapPx)).toBe(false);
    expect(name.x).toBe(92);
  });

  it('Namensbeschriftungen weichen Marken aus (Pfadschritte, nächster Schritt), nicht aber Feldern (debug-pfade)', () => {
    const list = new DebugOverlayList();
    // A field under everything (a spawn tint) does not push the label.
    list.rect(0, 0, 200, 120, 0x60308040);
    list.label(40, 20, 'grazing', WHITE);
    // A path's goal with its label beside it; the walker's next-step marker right under the label's place.
    list.mark(100, 40, T, 1, 0x80c060ff);
    list.mark(100, 40 + T - 1, T, 1, 0x80c060ff);
    list.mark(100, 40, 1, T, 0x80c060ff);
    list.mark(100 + T - 1, 40, 1, T, 0x80c060ff);
    const next = { kind: 'rect', x: 130, y: 42, w: 6, h: 6, color: 0xf4fbffff, text: '' } as const;
    list.mark(next.x, next.y, next.w, next.h, next.color);
    for (let k = 0; k < 4; k++) list.mark(150 + k * T, 46, 4, 4, 0x80c060ff);
    list.label(100 + T + 3, 40, '6 · simulation', WHITE);
    const r = queue(list);
    const ps = plates(r);
    expect(ps).toHaveLength(2);
    // Over the field: at its anchor.
    expect([ps[0]?.x, ps[0]?.y]).toEqual([40 - PAD, 20 - PAD]);
    // Beside the goal: clear of every mark by the gap – the next-step marker and the step dots stay whole.
    const marks = r.ops.filter((o) => o.kind === 'rect' && o.color !== DEBUG_LABEL_PLATE && o.color !== 0x60308040);
    expect(marks).toHaveLength(9);
    for (const m of marks) expect(overlaps(ps[1] as Op, m, DEBUG_LABEL.gapPx), `${m.x},${m.y}`).toBe(false);
    // Every mark is drawn before the plates (under nothing but geometry).
    for (const m of marks) expect(r.ops.indexOf(m)).toBeLessThan(r.ops.indexOf(ps[0] as Op));
  });

  it('eine Beschriftung, die an ihrem Platz nicht ins Bild passt, entfällt – nichts wird vom Rand hereingerückt, unter die Tafeln des HUD (overlay-raumtemperatur)', () => {
    const list = new DebugOverlayList();
    list.label(1000, -7, '7 · simulation', WHITE); // oben, halb über dem Rand
    list.label(700 + 10, H - 3, 'unten', WHITE); // unten, halb unter dem Rand
    list.label(700 + W - 5, 60, 'rechts', WHITE); // rechts, halb hinaus
    list.label(700 - 30, 60, 'links', WHITE); // links ganz hinaus
    // A value in a tile the bottom edge cuts, and one in the last whole tile above it.
    list.value(700 + 64, H - 8, T, T, '14°', WHITE);
    list.value(700 + 64, H - 1 - T, T, T, '14°', WHITE);
    // One name that just fits at the bottom edge (its plate a gap clear of the picture's border).
    list.label(700 + 120, H - 1 - DEBUG_LABEL.gapPx - PAD - (FONT.metrics.ascent + FONT.metrics.descent), 'Rand', WHITE);
    const r = queue(list, 700, 0);
    expect(texts(r).map((t) => t.text)).toEqual(['14°', 'Rand']);
    // No plate scrap of the dropped ones anywhere, the one that fits at its anchor.
    const ps = plates(r);
    expect(ps).toHaveLength(1);
    expect([ps[0]?.x, ps[0]?.y]).toEqual([120 - PAD, H - 1 - DEBUG_LABEL.gapPx - (FONT.metrics.ascent + FONT.metrics.descent) - 2 * PAD]);
    // The value drawn lies in its tile, its outline inside the picture.
    const v = outlined(texts(r)[0] as Op);
    expect(v.y + v.h).toBeLessThanOrEqual(H - 1);
    expect(v.y).toBeGreaterThanOrEqual(H - 1 - T);
  });

  it('übereinander erzeugte Namensbeschriftungen überdecken einander nicht (gestapelt, am unteren Rand nach oben)', () => {
    for (const y of [50, H - 17]) {
      const list = new DebugOverlayList();
      for (const t of ['roaming', 'resting', 'grazing', 'hunting', '12 · worker']) list.label(120, y, t, WHITE);
      list.label(126, y + 3, 'fleeing', WHITE);
      const r = queue(list);
      const ps = plates(r);
      expect(ps).toHaveLength(6);
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) expect(overlaps(ps[i] as Op, ps[j] as Op), `${y}: ${i} ↔ ${j}`).toBe(false);
        expect((ps[i] as Op).y).toBeGreaterThanOrEqual(1);
        expect((ps[i] as Op).y + (ps[i] as Op).h).toBeLessThanOrEqual(H - 1);
      }
      // At the bottom edge the stack grows upwards.
      if (y > H / 2) expect(Math.min(...ps.map((p) => p.y))).toBeLessThan(y - PAD);
    }
  });

  it('mehr Beschriftungen als Platz: jede bleibt im Bild (die Suche endet, der Pool wächst)', () => {
    const p = new DebugLabelPlacer();
    p.begin(W, H);
    for (let i = 0; i < 100; i++) {
      expect(p.place(2 + ((i * 37) % (W - 24)), 2 + ((i * 11) % (H - 14)), 20, 10)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(2);
      expect(p.y).toBeGreaterThanOrEqual(2);
      expect(p.x + 20).toBeLessThanOrEqual(W - 2);
      expect(p.y + 10).toBeLessThanOrEqual(H - 2);
    }
    expect(p.count).toBe(100);
    // Outside the picture: refused, nothing kept.
    expect(p.place(W - 10, 50, 20, 10)).toBe(false);
    expect(p.count).toBe(100);
  });

  it('der Baugeist liegt über den Overlays: kein Wert und keine Platte deckt seinen Rahmen (overlay-raumtemperatur)', () => {
    const list = new DebugOverlayList();
    expect(list.layer).toBe(OVERLAY_LAYER.tool);
    // The game view queues the ghost first (on the default tool layer) …
    const ghost = { x: 112, y: 48 };
    list.rect(ghost.x, ghost.y, T, T, 0x60a04060);
    list.rect(ghost.x, ghost.y, T, 1, 0x9ac775ff);
    list.rect(ghost.x, ghost.y + T - 1, T, 1, 0x9ac775ff);
    list.rect(ghost.x, ghost.y + 1, 1, T - 2, 0x9ac775ff);
    list.rect(ghost.x + T - 1, ghost.y + 1, 1, T - 2, 0x9ac775ff);
    // … then the overlay on the information layer: the air's field, a temperature in the tile left of the ghost and a
    // room name that reaches over it.
    list.layer = OVERLAY_LAYER.info;
    list.rect(80, 32, 64, 48, 0x2040a040);
    list.value(ghost.x - T, ghost.y, T, T, '14°', WHITE);
    list.label(ghost.x - 4, ghost.y - 10, 'Bedroom', WHITE);
    list.layer = OVERLAY_LAYER.tool;
    const r = queue(list);
    const frame = r.ops.filter((o) => o.color === 0x9ac775ff);
    expect(frame).toHaveLength(4);
    const lastInfo = Math.max(...r.ops.filter((o) => o.kind === 'text' || o.color === DEBUG_LABEL_PLATE || o.color === 0x2040a040).map((o) => r.ops.indexOf(o)));
    for (const f of frame) expect(r.ops.indexOf(f)).toBeGreaterThan(lastInfo);
    // The value stays in its own tile: its outline ends before the ghost's left frame column.
    const v = outlined(texts(r).find((t) => t.text === '14°') as Op);
    expect(v.x + v.w).toBeLessThanOrEqual(ghost.x);
    // `clear` starts the next frame on the tool layer again.
    list.layer = OVERLAY_LAYER.info;
    list.clear();
    expect(list.layer).toBe(OVERLAY_LAYER.tool);
  });
});
