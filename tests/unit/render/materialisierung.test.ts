/**
 * Materialisierung der Schattenbrut (M6-25; docs/SPIEL.md §13 „Tinten-Rauch per Rauschschwelle + violetter Rand … als
 * Sprite-Effekt im G-Buffer-Shader“; src/render/batch/materialize.ts, sprite_gbuffer.frag):
 * - die Rauchschwelle: 0…1, deterministisch, in 2 × 2-Pixel-Clustern (nie Einzelpixel), ihre Clusterzeilen steigen mit der
 *   Zeit wie Rauch; sie wächst in jeder Spalte nach unten (die Brut formt sich vom Boden her und zerfällt von oben, nichts
 *   vom Körper schwebt über der Front – M6-Gate `schattenbrut-materialisierung`);
 * - der Anteil fort gerauchter Pixel wächst stetig mit dem Ausblenden, darüber liegt ein schmaler glühender Rand und auf ihm
 *   in manchen Spalten eine kurze Zunge aus Tinten-Rauch;
 * - das Formen nach dem Erscheinen dauert so lange wie in der Simulation (`BALANCE.creatures.shadowBrood.formSeconds`,
 *   M6-13e): der Körper ist genau in dem Tick ganz, in dem die Brut zu handeln beginnt;
 * - Shader und CPU-Spiegel rechnen dieselbe Formel mit denselben Konstanten, das Flag `materialize` kommt im Instanz-
 *   Datensatz an, und nur geflaggte Sprites rauchen (die übrigen blenden weiter mit dem Bayer-Muster aus).
 * - im Dunkeln bleiben die emissiven Pixel (Augen) und der Rauchsaum Licht: die Tönung zum Schwarz lässt sie aus.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { secondsToTicks } from '../../../src/game/combat/formulas';
import { SHADERS } from '../../../src/render/shaderLib';
import {
  MATERIALIZE,
  formingFade,
  materializeDefines,
  materializePixel,
  smokeBelow,
  smokeFront,
  smokeRimIndex,
  smokeRowShare,
  smokeThreshold,
  smokeTongueIndex,
  smokeTonguePx,
} from '../../../src/render/batch/materialize';
import { SpriteDesc, SpriteList } from '../../../src/render/batch/spriteList';
import { OFFSET, SPRITE_FLAG } from '../../../src/render/batch/spriteLayout';
import { rampIndex } from '../../../src/render/surface/params';

const FRAG = SHADERS['sprite_gbuffer.frag'] ?? '';
const SIZE = 32;

/** What the pixel (x, y) of a 32 × 32 frame at world (x0, y0) shows at fade `fade`, time `t` (no silhouette, no crumb rule). */
function pixel(x: number, y: number, fade: number, t: number, x0: number, y0: number): ReturnType<typeof materializePixel> {
  const wx = x0 + x + 0.5;
  const threshold = smokeThreshold(smokeRowShare(y0 + y + 0.5, y + 0.5, SIZE, t), smokeFront(wx, t));
  return materializePixel(smokeBelow(threshold, fade, SIZE), smokeTonguePx(wx, t), fade);
}

/** Shares of a 32 × 32 frame at world (x0, y0) that are gone, rim and smoke at fade `fade`, time `t`. */
function shares(fade: number, t = 0, x0 = 400, y0 = 200): { weg: number; rand: number; rauch: number } {
  let weg = 0;
  let rand = 0;
  let rauch = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const k = pixel(x, y, fade, t, x0, y0);
      if (k === 'weg') weg++;
      else if (k === 'rand') rand++;
      else if (k === 'rauch') rauch++;
    }
  }
  const n = SIZE * SIZE;
  return { weg: weg / n, rand: rand / n, rauch: rauch / n };
}

describe('Rauchschwelle (materialize.ts)', () => {
  it('liegt in 0…1 und ist deterministisch', () => {
    for (let i = 0; i < 500; i++) {
      const x = (i * 37) % 900;
      const front = smokeFront(x, i * 0.01);
      const v = smokeThreshold((i % 32) / 32, front);
      expect(front).toBeGreaterThanOrEqual(0);
      expect(front).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(smokeThreshold((i % 32) / 32, smokeFront(x, i * 0.01))).toBe(v);
    }
  });

  it('bildet Spalten von 2 Pixeln: die beiden Spalten eines Clusters teilen Front und Zunge', () => {
    for (let x = 0; x < 64; x += MATERIALIZE.cellPx) {
      for (const t of [0, 0.37, 1.13]) {
        expect(smokeFront(x + 1.5, t)).toBe(smokeFront(x + 0.5, t));
        expect(smokeTonguePx(x + 1.5, t)).toBe(smokeTonguePx(x + 0.5, t));
      }
    }
  });

  it('steigt wie Rauch: die Clusterzeilen ziehen mit der Zeit nach oben', () => {
    const rise = MATERIALIZE.risePxPerSecond;
    for (let i = 0; i < 50; i++) {
      const y = 50 + i * 2.5;
      expect(smokeRowShare(y, 10.5, SIZE, 1)).toBeCloseTo(smokeRowShare(y + rise, 10.5, SIZE, 0), 10);
    }
  });

  it('wächst in jeder Spalte nach unten: der Körper einer Spalte ist ein Lauf vom Fuß bis zur Front, nichts schwebt darüber', () => {
    // Every pixel of every column; the steps against the order are collected and checked in one expect (M6-93).
    const fehler: string[] = [];
    for (const t of [0, 0.37, 1.13]) {
      for (let x = 0; x < 96; x++) {
        let last = -1;
        for (let y = 0; y < SIZE; y++) {
          const v = smokeThreshold(smokeRowShare(300 + y + 0.5, y + 0.5, SIZE, t), smokeFront(500 + x + 0.5, t));
          if (!(v >= last)) fehler.push(`t ${t} Spalte ${x} Zeile ${y}: Schwelle ${v} < ${last}`);
          last = v;
        }
        // Down the column the pixel shows nothing, then the tongue, the rim, the body – never in another order.
        const order = { weg: 0, rauch: 1, rand: 2, koerper: 3 } as const;
        for (const fade of [0.2, 0.5, 0.8]) {
          let rank = 0;
          for (let y = 0; y < SIZE; y++) {
            const r = order[pixel(x, y, fade, t, 500, 300)];
            if (!(r >= rank)) fehler.push(`t ${t} Spalte ${x} Zeile ${y} Blende ${fade}: Rang ${r} < ${rank}`);
            rank = r;
          }
        }
      }
    }
    expect(fehler).toEqual([]);
  });

  it('der Rand ist eine Clusterzeile dick, die Zunge null bis zwei Clusterzeilen', () => {
    for (let x = 0; x < 96; x++) {
      const rows = { rand: 0, rauch: 0 };
      for (let y = 0; y < SIZE; y++) {
        const k = pixel(x, y, 0.55, 0.4, 700, 120);
        if (k === 'rand') rows.rand++;
        if (k === 'rauch') rows.rauch++;
      }
      expect(rows.rand).toBeLessThanOrEqual(MATERIALIZE.rimPx);
      expect(rows.rauch).toBeLessThanOrEqual(smokeTonguePx(700 + x + 0.5, 0.4));
      expect(rows.rauch).toBeLessThanOrEqual(MATERIALIZE.tonguePx);
      expect(rows.rauch % MATERIALIZE.cellPx).toBe(0);
    }
  });

  it('die Front ist wellig und trägt Rauchzungen: kein gerader Balken über die ganze Breite', () => {
    // Over 48 px of a row of columns at mid fade the front stands at several heights and some columns carry a tongue.
    for (const t of [0, 0.4, 0.9]) {
      const fronts = new Set<number>();
      let tongues = 0;
      for (let x = 0; x < 48; x += MATERIALIZE.cellPx) {
        let top = SIZE;
        for (let y = SIZE - 1; y >= 0; y--) if (pixel(x, y, 0.55, t, 900, 64) === 'rand') top = y;
        fronts.add(top);
        if (smokeTonguePx(900 + x + 0.5, t) > 0) tongues++;
      }
      expect(fronts.size).toBeGreaterThanOrEqual(3);
      expect(tongues).toBeGreaterThan(0);
      expect(tongues).toBeLessThan(48 / MATERIALIZE.cellPx);
    }
  });

  it('die Front bleibt nahe einer Höhenlinie: über die Breite eines Körpers liegen ihre Spalten höchstens 8 px auseinander', () => {
    // The body rises as a whole with a wavy edge: across 16 px (a brood's width) the rim's rows lie within 8 px of each
    // other (`heightWeight` 0,8 on a 32 px frame; at 0,35 single columns ran ahead as strips over the whole frame).
    let widest = 0;
    for (const t of [0, 0.4, 0.9, 1.7]) {
      for (let x0 = 0; x0 < 400; x0 += 16) {
        let top = SIZE;
        let bottom = -1;
        for (let x = x0; x < x0 + 16; x += MATERIALIZE.cellPx) {
          let row = -1;
          for (let y = 0; y < SIZE && row < 0; y++) if (pixel(x, y, 0.55, t, 1200, 90) === 'rand') row = y;
          if (row < 0) continue;
          top = Math.min(top, row);
          bottom = Math.max(bottom, row);
        }
        if (bottom >= 0) widest = Math.max(widest, bottom - top);
      }
    }
    expect(widest).toBeLessThanOrEqual(8);
    expect(widest).toBeGreaterThanOrEqual(2);
  });

  it('der fort gerauchte Anteil wächst stetig mit dem Ausblenden; darüber ein schmaler glühender Rand und wenig Rauch', () => {
    expect(shares(0)).toEqual({ weg: 0, rand: 0, rauch: 0 });
    expect(shares(1.4).weg).toBe(1);
    let last = 0;
    for (let f = 0.05; f <= 1; f += 0.05) {
      const s = shares(f);
      expect(s.weg).toBeGreaterThanOrEqual(last);
      last = s.weg;
    }
    const mid = shares(0.5);
    expect(mid.weg).toBeGreaterThan(0.2);
    expect(mid.weg).toBeLessThan(0.8);
    expect(mid.rand).toBeGreaterThan(0.03);
    expect(mid.rand).toBeLessThan(0.1);
    expect(mid.rauch).toBeGreaterThan(0);
    expect(mid.rauch).toBeLessThan(mid.rand * 2);
  });

  it('das Formen nach dem Erscheinen dauert formSeconds der Simulation', () => {
    const hz = BALANCE.time.tickHz;
    const formTicks = Math.round(BALANCE.creatures.shadowBrood.formSeconds * hz);
    expect(formingFade(0, hz)).toBe(1);
    expect(formingFade(formTicks, hz)).toBe(0);
    expect(formingFade(1000, hz)).toBe(0);
    const half = formingFade(Math.round(formTicks / 2), hz);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    // The presentation keeps no span of its own.
    expect(Object.keys(MATERIALIZE)).not.toContain('formSeconds');
  });

  it('gleiche Dauer wie die Simulation: ganz genau in dem Tick, in dem die Brut zu handeln beginnt (M6-13e)', () => {
    // The simulation's rule (src/game/creatures/system.ts `FORM_TICKS`): it acts from `secondsToTicks(formSeconds, 1)` on.
    const acts = secondsToTicks(BALANCE.creatures.shadowBrood.formSeconds, 1);
    const hz = BALANCE.time.tickHz;
    expect(formingFade(acts, hz)).toBe(0);
    expect(formingFade(acts - 1, hz)).toBeGreaterThan(0);
    // Between two ticks (the frame's alpha) it is still forming until the last.
    expect(formingFade(acts - 0.5, hz)).toBeGreaterThan(0);
    // Every tick of the span lowers the smoke by the same step: 1 / span.
    for (let t = 1; t <= acts; t++) expect(formingFade(t - 1, hz) - formingFade(t, hz)).toBeCloseTo(1 / acts, 12);
  });
});

describe('Shader und Instanz-Datensatz', () => {
  it('der Shader rechnet dieselbe Formel mit den Konstanten von materializeDefines', () => {
    expect(FRAG).toContain('const uint FLAG_MATERIALIZE = 32u;');
    // The front noise of a column: x and the time only (the same all down the column).
    expect(FRAG).toContain('return clusterNoise(vec2(x, seconds * DH_SMOKE_RISE), DH_SMOKE_WAVELENGTH, DH_SMOKE_DETAIL, DH_SMOKE_CELL, DH_SMOKE_SALT);');
    expect(FRAG).toContain('return rowShare * DH_SMOKE_HEIGHT_WEIGHT + front * (1.0 - DH_SMOKE_HEIGHT_WEIGHT);');
    expect(FRAG).toContain('float n = clusterNoise(vec2(x, seconds * DH_SMOKE_TONGUE_DRIFT), DH_SMOKE_TONGUE_WAVELENGTH, DH_SMOKE_TONGUE_DETAIL, DH_SMOKE_CELL, DH_SMOKE_TONGUE_SALT);');
    expect(FRAG).toContain('return floor(n * (DH_SMOKE_TONGUE_PX / DH_SMOKE_CELL + 1.0)) * DH_SMOKE_CELL;');
    // The threshold per 2 × 2 cluster: the row share of the cluster's centre (`smokeRowShare`), the crumb rule after it.
    expect(FRAG).toContain('float centre = (floor(y / DH_SMOKE_CELL) + 0.5) * DH_SMOKE_CELL;\n  return (localY + centre - y) / height;');
    expect(FRAG).toContain('return smokeThreshold(smokeRowShare(w, float(q.y) + 0.5, height, seconds), smokeFront(w.x, seconds));');
    expect(FRAG).toContain('float threshold = smokeThresholdAt(p, mirrored, height, uWeather.z);');
    expect(FRAG).toContain('float below = (threshold - fade) * height / DH_SMOKE_HEIGHT_WEIGHT;');
    expect(FRAG).toContain('if (below < 0.0 && -below > smokeTongue(world.x, uWeather.z)) discard;');
    expect(FRAG).toContain('rim = threshold < fade + DH_SMOKE_HEIGHT_WEIGHT * DH_SMOKE_RIM_PX / height && !tongue;');
    // Ink, not light: a tongue over an eye does not glow; it takes the dark violet.
    expect(FRAG).toContain('if (tongue) a.g = 0.0;');
    expect(FRAG).toContain('if (tongue) color = paletteColor(uPaletteLut, DH_SMOKE_TONGUE_INDEX, row);');
    // Only unflagged sprites dither with the Bayer pattern.
    expect(FRAG).toContain('if (!smoke) {\n    if (float(vMisc.w) / 255.0 > bayer4(vec2(p))) discard;\n  }');
    const used = new Set([...FRAG.matchAll(/DH_SMOKE_[A-Z_]+/g)].map((m) => m[0]));
    const defines = materializeDefines();
    for (const d of used) expect(defines[d], d).toBeDefined();
    expect(Number(defines['DH_SMOKE_RISE'])).toBe(MATERIALIZE.risePxPerSecond);
    expect(Number(defines['DH_SMOKE_HEIGHT_WEIGHT'])).toBe(MATERIALIZE.heightWeight);
    expect(Number(defines['DH_SMOKE_RIM_PX'])).toBe(MATERIALIZE.rimPx);
    expect(Number(defines['DH_SMOKE_TONGUE_PX'])).toBe(MATERIALIZE.tonguePx);
    expect(defines['DH_SMOKE_RIM_INDEX']).toBe(`${rampIndex('verderb', 3)}`);
    expect(defines['DH_SMOKE_TONGUE_INDEX']).toBe(`${rampIndex('verderb', 1)}`);
    expect(smokeRimIndex()).toBe(rampIndex('verderb', 3));
    expect(smokeTongueIndex()).toBe(rampIndex('verderb', 1));
  });

  it('im Dunkeln bleiben Augen und Rauchsaum Licht: die Tönung zum Schwarz erreicht keine emissiven Pixel', () => {
    // The composite lights emission as albedo × emission: a tinted-black eye would not glow (§12.2).
    expect(FRAG).toContain('if (a.g <= 0.0 && !rim) color = mix(color, vTint.rgb, vTint.a);');
    expect(FRAG).not.toMatch(/^\s*color = mix\(color, vTint\.rgb, vTint\.a\);/m);
  });

  it('das Flag materialize kommt im Instanz-Datensatz an und fällt mit reset() weg', () => {
    expect(SPRITE_FLAG.materialize).toBe(32);
    const list = new SpriteList(4);
    const d = new SpriteDesc();
    d.frame = { x: 0, y: 0, w: 32, h: 32, ax: 16, ay: 28 };
    d.materialize = true;
    d.fade = 0.5;
    list.push(d);
    d.reset();
    d.frame = { x: 0, y: 0, w: 32, h: 32, ax: 16, ay: 28 };
    list.push(d);
    const bytes = new Uint8Array(list.words.buffer);
    const flagsOf = (i: number): number => bytes[i * 48 + OFFSET.misc + 1] as number;
    expect(flagsOf(0) & SPRITE_FLAG.materialize).toBe(SPRITE_FLAG.materialize);
    expect(bytes[OFFSET.misc + 3]).toBe(128);
    expect(flagsOf(1) & SPRITE_FLAG.materialize).toBe(0);
  });
});
