/**
 * Lesbare Beschriftungen der Debug-Overlays (M6-Gate visual:debug-overlay-labels; MASTERPROMPT §31.5 „UI-Ausrichtung“,
 * §31.6 Overlays; src/render/passes/debugOverlayPass.ts `queueDebugOverlay`, `DebugLabelPlacer`):
 * - jede Geometrie (Punkte, Kegel, Pfadquadrate) liegt unter jeder Beschriftung – auch unter der zuerst erzeugten;
 * - jede Beschriftung liegt auf ihrer dunklen Platte, ganz im Bild (auch mit dem Anker am oder jenseits des Rands);
 * - übereinander erzeugte Beschriftungen überdecken einander nicht (nach unten versetzt, am unteren Rand nach oben).
 */
import { describe, expect, it } from 'vitest';
import { DebugOverlayList } from '../../../src/render/debugOverlay';
import { DEBUG_LABEL, DEBUG_LABEL_PLATE, DebugLabelPlacer, DebugLabelStyle, queueDebugOverlay, type DebugOverlaySink } from '../../../src/render/passes/debugOverlayPass';
import type { Glyph } from '../../../src/render/text/glyphAtlas';
import { TextLayout, type GlyphSource } from '../../../src/render/text/layout';

/** A pixel font of 3 × 5 glyphs on a 4 px advance (space: blank). */
const FONT: GlyphSource = {
  metrics: { ascent: 5, descent: 1, lineGap: 2, lineHeight: 8 },
  glyphCode(code: number): Glyph {
    const blank = code === 0x20;
    return { char: String.fromCodePoint(code), advance: 4, offsetX: 0, offsetY: -5, width: blank ? 0 : 3, height: blank ? 0 : 5, atlasX: 0, atlasY: 0 };
  },
};
const PAD = DEBUG_LABEL.outlinePx + DEBUG_LABEL.marginPx;
const W = 322;
const H = 182;

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
    // Width and height of the fake font's ink.
    this.ops.push({ kind: 'text', x, y, w: text.length * 4 - 1, h: 6, color: 0, text });
  }
}

function queue(list: DebugOverlayList, originX = 0, originY = 0): Recorder {
  const r = new Recorder();
  queueDebugOverlay(list, originX, originY, W, H, r, FONT, new TextLayout(), new DebugLabelPlacer(), new DebugLabelStyle());
  return r;
}

/** The plates (label boxes) the recorder got, in order. */
function plates(r: Recorder): Op[] {
  return r.ops.filter((o, i) => o.kind === 'rect' && r.ops[i + 1]?.kind === 'text');
}

function overlaps(a: Op, b: Op): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('Debug-Overlay: Beschriftungen nach der Geometrie, im Bild, ohne Überdeckung', () => {
  it('jede Geometrie liegt unter jeder Beschriftung, auch wenn die Beschriftung zuerst erzeugt wurde', () => {
    const list = new DebugOverlayList();
    list.label(40, 40, 'simulation', 0xffffffff);
    list.rect(44, 42, 4, 4, 0x00ff00ff);
    list.label(100, 60, 'grazing', 0xffffffff);
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

  it('jede Beschriftung liegt auf einer Platte, die ihre Tinte samt Umriss umschließt', () => {
    const list = new DebugOverlayList();
    list.label(40, 40, 'resting', 0xffffffff);
    list.label(200, 90, 'roaming', 0xffffffff);
    const r = queue(list);
    const texts = r.ops.filter((o) => o.kind === 'text');
    const ps = plates(r);
    expect(ps).toHaveLength(texts.length);
    texts.forEach((t, i) => {
      const p = ps[i] as Op;
      expect(p.color).toBe(DEBUG_LABEL_PLATE);
      expect(t.x - p.x).toBe(PAD);
      expect(t.y - p.y).toBe(PAD);
      expect(p.x + p.w).toBeGreaterThanOrEqual(t.x + t.w + DEBUG_LABEL.outlinePx);
    });
    // Ungestört bleibt die Beschriftung an ihrem Anker (World → Target, minus Platte).
    expect([texts[0]?.x, texts[0]?.y]).toEqual([40, 40]);
  });

  it('Anker am oder jenseits des Bildrands: die Beschriftung wird ganz ins Bild gerückt', () => {
    const list = new DebugOverlayList();
    list.label(1000, -7, '7 · simulation', 0xffffffff); // oben, halb über dem Rand (debug-pfade)
    list.label(700 - 10, H - 3, 'links unten', 0xffffffff);
    list.label(700 + W - 5, 60, 'rechts', 0xffffffff);
    const r = queue(list, 700, 0);
    // The ink with its outline lies inside the picture (target minus its 1 px border).
    const texts = r.ops.filter((o) => o.kind === 'text');
    expect(texts).toHaveLength(3);
    for (const t of texts) {
      expect(t.x - DEBUG_LABEL.outlinePx).toBeGreaterThanOrEqual(1);
      expect(t.y - DEBUG_LABEL.outlinePx).toBeGreaterThanOrEqual(1);
      expect(t.x + t.w + DEBUG_LABEL.outlinePx).toBeLessThanOrEqual(W - 1);
      expect(t.y + t.h + DEBUG_LABEL.outlinePx).toBeLessThanOrEqual(H - 1);
    }
    for (const p of plates(r)) {
      expect(p.x).toBeGreaterThanOrEqual(1 + DEBUG_LABEL.gapPx);
      expect(p.y).toBeGreaterThanOrEqual(1 + DEBUG_LABEL.gapPx);
      expect(p.x + p.w).toBeLessThanOrEqual(W - 1 - DEBUG_LABEL.gapPx);
      expect(p.y + p.h).toBeLessThanOrEqual(H - 1 - DEBUG_LABEL.gapPx);
    }
  });

  it('Anker weiter als eine Kachel außerhalb des Bildes: keine Beschriftung am Rand (ihr Ding ist nicht im Bild)', () => {
    const list = new DebugOverlayList();
    list.label(-DEBUG_LABEL.reachPx - 1, 50, 'resting', 0xffffffff);
    list.label(100, H + DEBUG_LABEL.reachPx + 1, 'roaming', 0xffffffff);
    list.label(W + 40, -30, 'grazing', 0xffffffff);
    list.label(-DEBUG_LABEL.reachPx, 50, 'am Rand', 0xffffffff);
    const r = queue(list);
    expect(r.ops.filter((o) => o.kind === 'text').map((o) => o.text)).toEqual(['am Rand']);
  });

  it('übereinander erzeugte Beschriftungen überdecken einander nicht (gestapelt, am unteren Rand nach oben)', () => {
    for (const y of [50, H - 12]) {
      const list = new DebugOverlayList();
      for (const t of ['roaming', 'resting', 'grazing', 'hunting', '12 · worker']) list.label(120, y, t, 0xffffffff);
      list.label(126, y + 3, 'fleeing', 0xffffffff);
      const r = queue(list);
      const ps = plates(r);
      expect(ps).toHaveLength(6);
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) expect(overlaps(ps[i] as Op, ps[j] as Op), `${y}: ${i} ↔ ${j}`).toBe(false);
        expect((ps[i] as Op).y + (ps[i] as Op).h).toBeLessThanOrEqual(H - 1);
      }
    }
  });

  it('mehr Beschriftungen als Platz: jede bleibt im Bild (die Suche endet, der Pool wächst)', () => {
    const p = new DebugLabelPlacer();
    p.begin(W, H);
    for (let i = 0; i < 100; i++) {
      p.place((i * 37) % W, (i * 11) % H, 20, 10);
      expect(p.x).toBeGreaterThanOrEqual(2);
      expect(p.y).toBeGreaterThanOrEqual(2);
      expect(p.x + 20).toBeLessThanOrEqual(W - 2);
      expect(p.y + 10).toBeLessThanOrEqual(H - 2);
    }
    expect(p.count).toBe(100);
  });
});
