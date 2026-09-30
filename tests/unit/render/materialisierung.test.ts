/**
 * Materialisierung der Schattenbrut (M6-25; docs/SPIEL.md §13 „Tinten-Rauch per Rauschschwelle + violetter Rand … als
 * Sprite-Effekt im G-Buffer-Shader“; src/render/batch/materialize.ts, sprite_gbuffer.frag):
 * - die Rauchschwelle: 0…1, deterministisch, in 2 × 2-Pixel-Clustern (nie Einzelpixel), steigt mit der Zeit wie Rauch,
 *   oben früher als unten (die Brut formt sich vom Boden her und zerfällt von oben);
 * - der Anteil fort gerauchter Pixel wächst stetig mit dem Ausblenden, darüber liegt ein schmaler glühender Rand;
 * - das Formen nach dem Erscheinen dauert `formSeconds`;
 * - Shader und CPU-Spiegel rechnen dieselbe Formel mit denselben Konstanten, das Flag `materialize` kommt im Instanz-
 *   Datensatz an, und nur geflaggte Sprites rauchen (die übrigen blenden weiter mit dem Bayer-Muster aus).
 * - im Dunkeln bleiben die emissiven Pixel (Augen) und der Rauchsaum Licht: die Tönung zum Schwarz lässt sie aus.
 */
import { describe, expect, it } from 'vitest';
import { SHADERS } from '../../../src/render/shaderLib';
import { MATERIALIZE, formingFade, materializeDefines, materializePixel, smokeRimIndex, smokeThreshold } from '../../../src/render/batch/materialize';
import { SpriteDesc, SpriteList } from '../../../src/render/batch/spriteList';
import { OFFSET, SPRITE_FLAG } from '../../../src/render/batch/spriteLayout';
import { rampIndex } from '../../../src/render/surface/params';

const FRAG = SHADERS['sprite_gbuffer.frag'] ?? '';
const SIZE = 32;

/** Shares of a 32 × 32 frame at world (x0, y0) that are gone and rim at fade `fade`, time `t`. */
function shares(fade: number, t = 0, x0 = 400, y0 = 200): { weg: number; rand: number } {
  let weg = 0;
  let rand = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const k = materializePixel(smokeThreshold(x0 + x + 0.5, y0 + y + 0.5, (y + 0.5) / SIZE, t), fade);
      if (k === 'weg') weg++;
      else if (k === 'rand') rand++;
    }
  }
  return { weg: weg / (SIZE * SIZE), rand: rand / (SIZE * SIZE) };
}

describe('Rauchschwelle (materialize.ts)', () => {
  it('liegt in 0…1 und ist deterministisch', () => {
    for (let i = 0; i < 500; i++) {
      const x = (i * 37) % 900;
      const y = (i * 53) % 700;
      const v = smokeThreshold(x, y, (i % 32) / 32, i * 0.01);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(smokeThreshold(x, y, (i % 32) / 32, i * 0.01)).toBe(v);
    }
  });

  it('bildet Cluster von 2 × 2 Pixeln: Nachbarn einer Zelle in derselben Zeile teilen die Schwelle', () => {
    for (let x = 0; x < 64; x += MATERIALIZE.cellPx) {
      const a = smokeThreshold(x + 0.5, 100.5, 0.5, 0);
      const b = smokeThreshold(x + 1.5, 100.5, 0.5, 0);
      expect(b).toBe(a);
    }
  });

  it('steigt wie Rauch: das Muster zieht mit der Zeit nach oben', () => {
    const rise = MATERIALIZE.risePxPerSecond;
    for (let i = 0; i < 50; i++) {
      const x = 10 + i * 3;
      const y = 50 + i * 2;
      expect(smokeThreshold(x, y, 0.5, 1)).toBeCloseTo(smokeThreshold(x, y + rise, 0.5, 0), 10);
    }
  });

  it('oben früher als unten: die Brut zerfällt von oben und formt sich vom Boden her', () => {
    let top = 0;
    let bottom = 0;
    for (let x = 0; x < 256; x++) {
      top += smokeThreshold(x, 40, 0.05, 0);
      bottom += smokeThreshold(x, 40, 0.95, 0);
    }
    expect(top).toBeLessThan(bottom);
  });

  it('der fort gerauchte Anteil wächst stetig mit dem Ausblenden; darüber ein schmaler glühender Rand', () => {
    expect(shares(0)).toEqual({ weg: 0, rand: 0 });
    expect(shares(1.01).weg).toBe(1);
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
    expect(mid.rand).toBeLessThan(0.3);
  });

  it('das Formen nach dem Erscheinen dauert formSeconds', () => {
    const hz = 60;
    expect(formingFade(0, hz)).toBe(1);
    expect(formingFade(Math.round(MATERIALIZE.formSeconds * hz), hz)).toBe(0);
    expect(formingFade(1000, hz)).toBe(0);
    const half = formingFade(Math.round((MATERIALIZE.formSeconds * hz) / 2), hz);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
  });
});

describe('Shader und Instanz-Datensatz', () => {
  it('der Shader rechnet dieselbe Formel mit den Konstanten von materializeDefines', () => {
    expect(FRAG).toContain('const uint FLAG_MATERIALIZE = 32u;');
    expect(FRAG).toContain('float n = clusterNoise(world + vec2(0.0, seconds * DH_SMOKE_RISE), DH_SMOKE_WAVELENGTH, DH_SMOKE_DETAIL, DH_SMOKE_CELL, DH_SMOKE_SALT);');
    expect(FRAG).toContain('return n * (1.0 - DH_SMOKE_HEIGHT_WEIGHT) + rowShare * DH_SMOKE_HEIGHT_WEIGHT;');
    expect(FRAG).toContain('float threshold = smokeThreshold(world, local.y / float(vRect.w), uWeather.z);');
    expect(FRAG).toContain('if (threshold < fade) discard;');
    expect(FRAG).toContain('rim = threshold < fade + DH_SMOKE_EDGE;');
    // Only unflagged sprites dither with the Bayer pattern.
    expect(FRAG).toContain('if (!smoke) {\n    if (float(vMisc.w) / 255.0 > bayer4(vec2(p))) discard;\n  }');
    const used = new Set([...FRAG.matchAll(/DH_SMOKE_[A-Z_]+/g)].map((m) => m[0]));
    const defines = materializeDefines();
    for (const d of used) expect(defines[d], d).toBeDefined();
    expect(Number(defines['DH_SMOKE_RISE'])).toBe(MATERIALIZE.risePxPerSecond);
    expect(Number(defines['DH_SMOKE_EDGE'])).toBe(MATERIALIZE.edge);
    expect(defines['DH_SMOKE_RIM_INDEX']).toBe(`${rampIndex('verderb', 3)}`);
    expect(smokeRimIndex()).toBe(rampIndex('verderb', 3));
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
