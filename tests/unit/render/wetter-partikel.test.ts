/**
 * M5-12, the pure part of the weather particles: which particles a weather shows (rain, snow, ash, a sandstorm's sand),
 * the wind they drift with (the direction the fire simulation spreads with), the box of sky around the camera and how
 * many of the pool fall in it, the steady state after a start-over (a frozen picture shows a full sky, splashes and
 * lying snow on the ground layer only), and the lightning: uneven strikes of flash, dark gap and after-flash – or, with
 * flash reduction, one soft pulse at a quarter of the strength.
 */
import { describe, expect, it } from 'vitest';
import { LIGHTNING, PARTICLE_WORLD, weatherParticles } from '../../../src/content/particles';
import { WEATHER_STATES, type WeatherStateId } from '../../../src/content/weather';
import { querwind } from '../../../src/debug/partikelScenarios';
import { KIND_ROWS } from '../../../src/render/particles/kinds';
import { P, PARTICLE_FLOATS, WEATHER_CAPACITY } from '../../../src/render/particles/layout';
import { particleTables } from '../../../src/render/particles/tables';
import {
  createWeatherBox,
  createWeatherChoice,
  initWeatherPool,
  lightningFlash,
  WEATHER_BOX_MARGIN,
  WEATHER_STATE,
  WEATHER_STATE_SLOTS,
  weatherBox,
  weatherChoice,
  weatherCount,
  windVelocity,
  type WeatherLike,
} from '../../../src/render/particles/weather';

function settled(state: WeatherStateId): WeatherLike {
  const s = WEATHER_STATES.find((w) => w.id === state);
  if (s === undefined) throw new Error(state);
  return { state, previous: state, blend: 1, precipitation: s.precipitation, precipitationKind: s.precipitationKind, wind: s.wind };
}

describe('Wetterpartikel aus dem Wetter', () => {
  it('Regen, Niesel und Gewitter regnen, Schnee und Schneesturm schneien, Ascheregen fällt als Asche, Sandsturm treibt Sand', () => {
    const c = createWeatherChoice();
    const expected: Record<WeatherStateId, string | null> = {
      klar: null,
      bewoelkt: null,
      nebel: null,
      niesel: 'regen',
      regen: 'regen',
      gewitter: 'regen',
      schnee: 'schnee',
      schneesturm: 'schnee',
      hitzewelle: null,
      sandsturm: 'sand',
      ascheregen: 'asche',
      sternschnuppennacht: null,
    };
    for (const s of WEATHER_STATES) {
      weatherChoice(settled(s.id), c);
      expect(c.id, s.id).toBe(expected[s.id]);
      expect(c.amount, s.id).toBeCloseTo(s.id === 'sandsturm' ? 1 : s.precipitation, 6);
      expect(c.storm, s.id).toBe(s.id === 'gewitter' ? 1 : 0);
    }
    // Blending out of a sandstorm: its share is the amount; out of a thunderstorm: the lightning fades with it.
    weatherChoice({ state: 'klar', previous: 'sandsturm', blend: 0.25, precipitation: 0, precipitationKind: 'keiner', wind: 0.8 }, c);
    expect([c.id, c.amount]).toEqual(['sand', 0.75]);
    weatherChoice({ state: 'bewoelkt', previous: 'gewitter', blend: 0.6, precipitation: 0.4, precipitationKind: 'regen', wind: 0.5 }, c);
    expect(c.id).toBe('regen');
    expect(c.storm).toBeCloseTo(0.4, 6);
  });

  it('der Wind weht in eine der acht Richtungen mit der Stärke des Wetters', () => {
    const w = { x: 0, y: 0 };
    const full = PARTICLE_WORLD.windPxPerS;
    expect(windVelocity(0, 1, w)).toEqual({ x: 0, y: -full });
    windVelocity(2, 0.5, w);
    expect([w.x, w.y]).toEqual([full / 2, 0]);
    windVelocity(3, 1, w);
    expect(w.x).toBeCloseTo(full * Math.SQRT1_2, 6);
    expect(w.y).toBeCloseTo(full * Math.SQRT1_2, 6);
    expect(Math.hypot(...Object.values(windVelocity(13, 0.3, w)))).toBeCloseTo(0.3 * full, 6);
  });

  it('Regen fällt im Windwinkel: die Wetter-Szenarien suchen Querwind, sechs der acht Richtungen kreuzen das Bild', () => {
    const w = { x: 0, y: 0 };
    const crossing = Array.from({ length: 8 }, (_, d) => querwind(windVelocity(d, 0.45, w)));
    expect(crossing).toEqual([false, true, true, true, false, true, true, true]);
    expect(querwind({ x: 0, y: 0 })).toBe(false);
    // Rain's breeze slants the streaks by more than 15°, a thunderstorm's gale by about 30°.
    const rain = weatherParticles('regen');
    const fall = (rain.fall.min + rain.fall.max) / 2;
    const angle = (state: WeatherStateId): number => (Math.atan2(settled(state).wind * PARTICLE_WORLD.windPxPerS * rain.wind, fall) * 180) / Math.PI;
    expect(angle('regen')).toBeGreaterThan(15);
    expect(angle('gewitter')).toBeGreaterThan(25);
    expect(angle('gewitter')).toBeLessThan(45);
  });

  it('die Box reicht so weit unter die Sicht, wie die Teilchen fallen; ihre Zahl folgt Menge, Fläche und Qualität', () => {
    const b = weatherBox(480, 270, 200, createWeatherBox());
    expect(b).toEqual({ halfWidth: 240 + WEATHER_BOX_MARGIN, top: -135 - WEATHER_BOX_MARGIN, bottom: 135 + 200 + WEATHER_BOX_MARGIN });
    const rain = weatherParticles('regen');
    const full = weatherCount(rain, 1, b, 1, WEATHER_CAPACITY);
    expect(full).toBe(Math.round((rain.dichte * 2 * b.halfWidth * (b.bottom - b.top)) / 10_000));
    expect(weatherCount(rain, 0.25, b, 1, WEATHER_CAPACITY)).toBe(Math.round(full * 0.25));
    expect(weatherCount(rain, 1, b, PARTICLE_WORLD.reduced.weather, WEATHER_CAPACITY)).toBe(Math.round(full * PARTICLE_WORLD.reduced.weather));
    expect(weatherCount(rain, 1, b, 1, 10)).toBe(10);
    expect(weatherCount(rain, 0, b, 1, WEATHER_CAPACITY)).toBe(0);
  });

  it('nach einem Neustart fällt der Pool im eingeschwungenen Zustand: aktiv, verteilt, gelandet nur auf der Bodenschicht', () => {
    const t = particleTables();
    const out = new Float32Array(WEATHER_CAPACITY * PARTICLE_FLOATS);
    for (const id of ['regen', 'schnee', 'asche', 'sand'] as const) {
      const w = weatherParticles(id);
      const box = weatherBox(480, 270, w.hoehe, createWeatherBox());
      const count = weatherCount(w, 1, box, 1, WEATHER_CAPACITY);
      initWeatherPool(out, 0, WEATHER_CAPACITY, w, t.kinds, count, box, 1000, 2000, 7);
      let landed = 0;
      let falling = 0;
      const layers = new Set<number>();
      const kinds = w.arten.map((a) => t.kinds.index(a.art));
      // Every record is checked; the first violations are reported by record and rule (one `expect` per weather).
      const problems: string[] = [];
      const check = (ok: boolean, i: number, rule: string): void => {
        if (!ok && problems.length < 10) problems.push(`${id} #${i}: ${rule}`);
      };
      for (let i = 0; i < WEATHER_CAPACITY; i++) {
        const o = i * PARTICLE_FLOATS;
        const phase = out[o + P.phase] as number;
        const state = phase - Math.floor(phase / WEATHER_STATE_SLOTS) * WEATHER_STATE_SLOTS;
        const layer = out[o + P.layer] as number;
        layers.add(layer);
        const parallax = w.schichten[layer - 1]?.parallaxe as number;
        const qx = (out[o + P.x] as number) - 1000 * parallax;
        const qy = (out[o + P.y] as number) - 2000 * parallax;
        check(Math.abs(qx) <= box.halfWidth + 1e-3, i, 'x in the box');
        check(qy >= box.top - 1e-3 && qy <= box.bottom + 1e-3, i, 'y in the box');
        if (i >= count) {
          check(state === WEATHER_STATE.idle, i, 'beyond the number: idle');
          continue;
        }
        if (state === WEATHER_STATE.landed) {
          landed++;
          check(parallax === 1, i, 'landed only on the ground layer');
          check(out[o + P.z] === 0, i, 'landed at height 0');
          check((out[o + P.age] as number) <= (out[o + P.life] as number), i, 'landed within its life');
        } else {
          falling++;
          const z = out[o + P.z] as number;
          const fall = -(out[o + P.vz] as number);
          check(state === WEATHER_STATE.falling, i, 'falling');
          check(z >= 0 && z <= w.hoehe, i, 'height within the fall');
          check(fall >= w.fall.min - 1e-3 && fall <= w.fall.max + 1e-3, i, 'falling speed within its range');
          check(kinds.includes(out[o + P.kind] as number), i, 'one of the weather kinds');
        }
      }
      expect(problems).toEqual([]);
      expect(layers.size, id).toBe(w.schichten.length);
      expect(falling, id).toBeGreaterThan(count / 2);
      // Rain splashes and snow and ash lie on the ground layer; the sand is gone when it touches down.
      const ground = t.kinds.data[t.kinds.index(w.arten[0]?.art as string) * KIND_ROWS * 4 + 5 * 4 + 1];
      if (ground === 0) expect(landed, id).toBe(0);
      else expect(landed, id).toBeGreaterThan(0);
    }
    // Deterministic: the same seed gives the same pool.
    const w = weatherParticles('schnee');
    const box = weatherBox(480, 270, w.hoehe, createWeatherBox());
    const a = new Float32Array(WEATHER_CAPACITY * PARTICLE_FLOATS);
    const b = new Float32Array(WEATHER_CAPACITY * PARTICLE_FLOATS);
    initWeatherPool(a, 0, WEATHER_CAPACITY, w, t.kinds, 500, box, 0, 0, 3);
    initWeatherPool(b, 0, WEATHER_CAPACITY, w, t.kinds, 500, box, 0, 0, 3);
    expect(b).toEqual(a);
  });
});

describe('Blitz', () => {
  const SEED = 991;
  const STEP = 1 / 240;

  function strikes(storm: number, reduced: boolean, from: number, to: number): { starts: number[]; peak: number; values: number[] } {
    const starts: number[] = [];
    const values: number[] = [];
    let before = 0;
    let peak = 0;
    for (let t = from; t < to; t += STEP) {
      const v = lightningFlash(t, SEED, storm, reduced);
      values.push(v);
      if (before === 0 && v > 0) starts.push(t);
      peak = Math.max(peak, v);
      before = v;
    }
    return { starts, peak, values };
  }

  it('ohne Gewitter kein Blitz; mit Gewitter Einschläge im Mittel alle abstand.min … abstand.max Sekunden', () => {
    expect(strikes(0, false, 0, 60).peak).toBe(0);
    const s = strikes(1, false, 0, 600);
    const mean = 600 / s.starts.length;
    expect(mean).toBeGreaterThan(LIGHTNING.abstand.min);
    expect(mean).toBeLessThan(LIGHTNING.abstand.max);
    expect(s.peak).toBeLessThanOrEqual(1);
    expect(s.peak).toBeGreaterThanOrEqual(0.6);
  });

  it('ein Einschlag: voller Blitz, dunkle Pause, abklingender Nachblitz', () => {
    const s = strikes(1, false, 0, 120);
    const at = s.starts[0] as number;
    const first = lightningFlash(at + LIGHTNING.blitz / 2, SEED, 1, false);
    expect(first).toBeGreaterThan(0.5);
    expect(lightningFlash(at + LIGHTNING.blitz + LIGHTNING.pause / 2, SEED, 1, false)).toBe(0);
    const after1 = lightningFlash(at + LIGHTNING.blitz + LIGHTNING.pause + 0.02, SEED, 1, false);
    const after2 = lightningFlash(at + LIGHTNING.blitz + LIGHTNING.pause + LIGHTNING.nachblitz * 0.8, SEED, 1, false);
    expect(after1).toBeCloseTo(first * LIGHTNING.nachblitzStaerke, 1);
    expect(after2).toBeLessThan(after1);
    expect(lightningFlash(at + LIGHTNING.blitz + LIGHTNING.pause + LIGHTNING.nachblitz + 0.01, SEED, 1, false)).toBe(0);
    // Half a storm, half the flash.
    expect(lightningFlash(at + LIGHTNING.blitz / 2, SEED, 0.5, false)).toBeCloseTo(first / 2, 6);
  });

  it('Blitzreduktion: höchstens ein Viertel der Stärke, ein weicher Puls je Einschlag, kein Flackern', () => {
    const s = strikes(1, true, 0, 600);
    expect(s.peak).toBeLessThanOrEqual(LIGHTNING.reduziert + 1e-9);
    expect(s.peak).toBeGreaterThan(0);
    // Each strike rises once and falls once (no dark gap, no second flash).
    let turns = 0;
    let rising = true;
    for (let i = 1; i < s.values.length; i++) {
      const a = s.values[i - 1] as number;
      const b = s.values[i] as number;
      if (a === 0 && b > 0) rising = true;
      if (rising && b < a) {
        rising = false;
        turns++;
      } else if (!rising && b > a && a > 0) throw new Error('reduzierter Blitz steigt wieder an');
    }
    expect(turns).toBe(s.starts.length);
  });
});
