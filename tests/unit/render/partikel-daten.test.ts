/**
 * M5-11: particle kinds, sources and weather particles are data (src/content/particles) – validated, cross-checked and
 * compiled into the GPU kind table and the spawner's source table (src/render/particles/kinds.ts); the shaders get their
 * constants from the same TypeScript (`particleDefines`).
 */
import { describe, expect, it } from 'vitest';
import {
  defineParticles,
  LIGHTNING,
  PARTICLE_EMITTERS,
  PARTICLE_KINDS,
  ParticleDataError,
  WEATHER_PARTICLE_IDS,
  WEATHER_PARTICLES,
  type ParticleEmitterInput,
  type ParticleKindInput,
  type WeatherParticlesInput,
} from '../../../src/content/particles';
import { PARTICLE_KIND_DATA } from '../../../src/content/particles/arten';
import { PARTICLE_EMITTER_DATA } from '../../../src/content/particles/emitter';
import { LIGHTNING_DATA, WEATHER_PARTICLE_DATA } from '../../../src/content/particles/wetter';
import { CONTENT } from '../../../src/content';
import { PALETTE_RAMPS } from '../../../src/generated/palette';
import { paletteRefIndex } from '../../../src/render/palette/rows';
import { particleDefines } from '../../../src/render/particles/defines';
import { ALIGNMENT_CODE, buildEmitterTable, buildKindTable, E, EMITTER_FLOATS, GROUND_CODE, KIND_ROWS, MAX_KINDS, SHAPE_CODE } from '../../../src/render/particles/kinds';
import { SHADERS } from '../../../src/render/shaderLib';
import { encodingDefines } from '../../../src/render/gl/formats';
import { gbufferDefines } from '../../../src/render/gbuffer';
import { spectralDefines } from '../../../src/render/light/spectral';

const kind = (id: string): ParticleKindInput => {
  const k = PARTICLE_KIND_DATA.find((x) => x.id === id);
  if (k === undefined) throw new Error(id);
  return k;
};

describe('Partikeldaten', () => {
  it('Arten, Quellen und Wetterpartikel sind gültig und jede Art wird benutzt', () => {
    expect(PARTICLE_KINDS.length).toBeGreaterThan(0);
    expect(PARTICLE_KINDS.length).toBeLessThanOrEqual(MAX_KINDS);
    expect(WEATHER_PARTICLES.map((w) => w.id).sort()).toEqual([...WEATHER_PARTICLE_IDS].sort());
    const used = new Set<string>();
    for (const e of PARTICLE_EMITTERS) used.add(e.art);
    for (const w of WEATHER_PARTICLES) for (const a of w.arten) used.add(a.art);
    for (const k of PARTICLE_KINDS) if (k.spritzer !== undefined) used.add(k.spritzer);
    expect(PARTICLE_KINDS.filter((k) => !used.has(k.id)).map((k) => k.id)).toEqual([]);
    // Every colour is a colour of the master palette.
    for (const k of PARTICLE_KINDS) for (const c of k.farben) expect(() => paletteRefIndex(c, PALETTE_RAMPS), `${k.id}: ${c}`).not.toThrow();
    expect(() => paletteRefIndex(LIGHTNING.farbe, PALETTE_RAMPS)).not.toThrow();
  });

  it('die Content-Registry führt Arten und Quellen mit Verweisen', () => {
    expect(CONTENT.collection('particleKinds').size).toBe(PARTICLE_KINDS.length);
    expect(CONTENT.collection('particleEmitters').size).toBe(PARTICLE_EMITTERS.length);
    expect(CONTENT.get('particleEmitters', 'brand_funken').art).toBe('funke');
  });

  it('lehnt unbekannte Arten, sich selbst spritzende Spritzer, falsche Anteile und fehlende Wetter ab', () => {
    const emitters: ParticleEmitterInput[] = [...PARTICLE_EMITTER_DATA, { ...(PARTICLE_EMITTER_DATA[0] as ParticleEmitterInput), id: 'kaputt', art: 'gibt_es_nicht' }];
    expect(() => defineParticles(PARTICLE_KIND_DATA, emitters, WEATHER_PARTICLE_DATA, LIGHTNING_DATA)).toThrow(ParticleDataError);
    const loop: ParticleKindInput[] = PARTICLE_KIND_DATA.map((k) => (k.id === 'regenspritzer' ? { ...k, boden: 'spritzen', spritzer: 'regenspritzer' } : k));
    expect(() => defineParticles(loop, PARTICLE_EMITTER_DATA, WEATHER_PARTICLE_DATA, LIGHTNING_DATA)).toThrow(/must not splash itself/);
    const shares: WeatherParticlesInput[] = WEATHER_PARTICLE_DATA.map((w) => (w.id === 'asche' ? { ...w, arten: w.arten.map((a) => ({ ...a, anteil: 0.3 })) } : w));
    expect(() => defineParticles(PARTICLE_KIND_DATA, PARTICLE_EMITTER_DATA, shares, LIGHTNING_DATA)).toThrow(/add up to 1/);
    expect(() => defineParticles(PARTICLE_KIND_DATA, PARTICLE_EMITTER_DATA, WEATHER_PARTICLE_DATA.slice(1), LIGHTNING_DATA)).toThrow(/missing/);
    const noSplash: ParticleKindInput[] = PARTICLE_KIND_DATA.map((k) => (k.id === 'regentropfen' ? { ...k, spritzer: undefined } : k));
    expect(() => defineParticles(noSplash, PARTICLE_EMITTER_DATA, WEATHER_PARTICLE_DATA, LIGHTNING_DATA)).toThrow(/splash kind/);
    const dup = [...PARTICLE_KIND_DATA, kind('funke')];
    expect(() => defineParticles(dup, PARTICLE_EMITTER_DATA, WEATHER_PARTICLE_DATA, LIGHTNING_DATA)).toThrow(/duplicate/);
  });

  it('die Artentabelle enthält jede Art in ihren sieben vec4-Zeilen', () => {
    const t = buildKindTable();
    expect(t.data.length).toBe(MAX_KINDS * KIND_ROWS * 4);
    PARTICLE_KINDS.forEach((k, i) => {
      const o = i * KIND_ROWS * 4;
      const row = (r: number) => Array.from(t.data.subarray(o + r * 4, o + r * 4 + 4));
      expect(row(0)).toEqual([SHAPE_CODE[k.form], k.groesse.min, k.groesse.max, k.wachstum].map(Math.fround));
      expect(row(1)[3]).toBeCloseTo(k.emissiv, 5);
      const colors = k.farben.map((c) => paletteRefIndex(c, PALETTE_RAMPS));
      expect(row(2)).toEqual([0, 1, 2, 3].map((c) => colors[Math.min(c, colors.length - 1)]));
      expect(row(3)[0]).toBe(colors.length);
      expect(row(4)).toEqual([k.schwerkraft, k.widerstand, k.wind, k.wirbel].map(Math.fround));
      expect(row(5)[1]).toBe(GROUND_CODE[k.boden]);
      expect(row(5)[2]).toBe(k.spritzer === undefined ? -1 : t.index(k.spritzer));
      expect(t.lifeMin(i)).toBeCloseTo(k.leben.min, 5);
      expect(t.lifeMax(i)).toBeCloseTo(k.leben.max, 5);
    });
    expect(() => t.index('gibt_es_nicht')).toThrow();
    const many = Array.from({ length: MAX_KINDS + 1 }, (_, i) => ({ ...(PARTICLE_KINDS[0] as (typeof PARTICLE_KINDS)[number]), id: `art_${i}` }));
    expect(() => buildKindTable(many)).toThrow(RangeError);
  });

  it('die Quellentabelle übernimmt Rate, Fläche, Tempo, Richtung (Grad → Bogenmaß) und Ausrichtung', () => {
    const kinds = buildKindTable();
    const t = buildEmitterTable(kinds);
    PARTICLE_EMITTERS.forEach((e, i) => {
      const o = i * EMITTER_FLOATS;
      expect(t.data[o + E.kind]).toBe(kinds.index(e.art));
      expect(t.data[o + E.rate]).toBeCloseTo(e.rate, 4);
      expect(t.data[o + E.round]).toBe(e.flaeche.form === 'kreis' ? 1 : 0);
      expect(t.data[o + E.spread]).toBeCloseTo((e.streuung * Math.PI) / 180, 5);
      expect(t.data[o + E.alignment]).toBe(ALIGNMENT_CODE[e.ausrichtung]);
      expect(t.data[o + E.lifeMin]).toBeCloseTo(kinds.lifeMin(kinds.index(e.art)), 5);
    });
    expect(t.index('lumen_sturm')).toBe(PARTICLE_EMITTERS.findIndex((e) => e.id === 'lumen_sturm'));
  });

  it('jede DH_-Konstante der Partikel-Shader kommt aus TypeScript', () => {
    const known = new Set(Object.keys({ ...particleDefines(), ...encodingDefines(true), ...gbufferDefines(), ...spectralDefines() }));
    const files = Object.keys(SHADERS).filter((f) => f.startsWith('particle_'));
    expect(files.sort()).toEqual([
      'particle_common.glsl',
      'particle_draw.frag',
      'particle_draw.vert',
      'particle_flash.frag',
      'particle_light.frag',
      'particle_light.vert',
      'particle_shimmer.frag',
      'particle_shimmer.vert',
      'particle_update.frag',
      'particle_update.vert',
    ]);
    const used = new Set<string>();
    for (const f of files) for (const m of (SHADERS[f] ?? '').matchAll(/\bDH_[A-Z0-9_]+\b/g)) used.add(m[0]);
    expect([...used].filter((d) => !known.has(d))).toEqual([]);
  });
});
