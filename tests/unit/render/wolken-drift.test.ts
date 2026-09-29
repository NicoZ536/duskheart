/**
 * B1 der M5-Prüfung: Wolkenschatten, Nebelbänke, Kaustiken und die kleinen Wellen ziehen um einen über die
 * Präsentationszeit **integrierten** Versatz (`src/render/world/drift.ts`) – ein Windwechsel (Wetterübergang, neue
 * Wetterperiode, Regionsgrenze, reduzierte Bewegung) ändert ihr Tempo, nie ihren Ort. Früher war der Versatz
 * Geschwindigkeit × Gesamtzeit: nach einer Stunde Spiel sprang das Wolkenfeld bei jedem Himmels-Neuberechnen um
 * Hunderte Pixel. Der Versatz bleibt modulo der Periode des Rauschens klein (float32-genau), und das Rauschen
 * wiederholt sich mit genau dieser Periode – der Umbruch zeigt keine Naht. Nach einem Uhrensprung und in einem
 * Standbild, dessen Welt weiterläuft (Szenario), beginnt er bei der geschlossenen Form Geschwindigkeit × Zeit.
 */
import { describe, expect, it } from 'vitest';
import { cloudShade } from '../../../src/render/light/lightMath';
import { CLOUD_OCTAVE_PERIODS, CLOUD_PERIOD_PX, CLOUDS } from '../../../src/render/light/params';
import { cloudOffset } from '../../../src/render/light/skyMath';
import { FOG_LOOK } from '../../../src/render/passes/atmospherePass';
import { RenderScene } from '../../../src/render/scene';
import { DRIFT_CLOCK_HZ, DRIFT_MAX_GAP_SECONDS, DRIFT_UNITS, DriftOffset, driftClock } from '../../../src/render/world/drift';
import { CAUSTICS } from '../../../src/render/water/params';
import { ChunkSignatures } from '../../../src/render/world/signature';
import { SKY_REFRESH_TICKS, SkySceneFiller, type SkyView } from '../../../src/render/world/skyScene';
import type { Simulation } from '../../../src/game/sim';
import { createShadowVector, type ShadowVector } from '../../../src/world/calendar';
import { createWeatherSample, type WeatherSample } from '../../../src/world/climate/weather';
import { BALANCE } from '../../../src/content/balance';
import { MAX_TIME_SCALE } from '../../../src/engine/loop';
import { TILE_PX } from '../../../src/world/model/coords';

/** Shortest way from `a` to `b` on a circle of `period` (the step of a wrapped offset). */
function wrappedStep(a: number, b: number, period: number): number {
  let d = b - a;
  if (d > period / 2) d -= period;
  if (d < -period / 2) d += period;
  return d;
}

describe('DriftOffset: integrierter, umbrechender Versatz in ganzen Zahlen', () => {
  /** Drift clock of presentation time `t` [s]. */
  const at = (t: number): number => driftClock(t);

  it('ein Windwechsel mitten im Lauf bewegt das Feld stetig weiter – die geschlossene Form sprang', () => {
    const period = CLOUD_PERIOD_PX;
    const d = new DriftOffset(period, period);
    const dt = 1 / 60;
    let t = 3600;
    d.setVelocity(3, 0);
    d.advance(at(t), 0);
    let last = d.xPx;
    let biggest = 0;
    for (let i = 0; i < 600; i++) {
      t += dt;
      // Half way the wind jumps from calm to a gale (a new weather period at the region border).
      if (i === 300) d.setVelocity(22, -11);
      d.advance(at(t), 0);
      biggest = Math.max(biggest, Math.abs(wrappedStep(last, d.xPx, period)));
      last = d.xPx;
    }
    // At most a gale's step per frame (a drift clock tick and a unit of rounding on top).
    expect(biggest).toBeLessThanOrEqual(22 * (dt + 1 / DRIFT_CLOCK_HZ) + 1 / DRIFT_UNITS);
    // The closed form of before would have jumped by Δv · t in that frame.
    expect((22 - 3) * 3600).toBeGreaterThan(60_000);
    // Whole units within half a period of 0 (exact in the shader's 32-bit floats).
    for (const v of [d.x, d.y]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual((-period / 2) * DRIFT_UNITS);
      expect(v).toBeLessThan((period / 2) * DRIFT_UNITS);
    }
  });

  it('integriert genau: nach einer Minute bei 60 Hz liegt das Feld bei Geschwindigkeit × Zeit, bis auf eine Einheit', () => {
    const d = new DriftOffset(FOG_LOOK.tileMid, FOG_LOOK.tileMid, FOG_LOOK.layerDrift[2]);
    d.setVelocity(7.3, 1.2);
    const t0 = 12.5;
    d.advance(at(t0), 0);
    for (let i = 1; i <= 3600; i++) d.advance(at(t0 + i / 60), 0);
    const k = FOG_LOOK.layerDrift[2];
    const expectX = (Math.round(7.3 * k * DRIFT_UNITS) * at(t0 + 60)) / DRIFT_CLOCK_HZ;
    const expectY = (Math.round(1.2 * k * DRIFT_UNITS) * at(t0 + 60)) / DRIFT_CLOCK_HZ;
    const periodUnits = FOG_LOOK.tileMid * DRIFT_UNITS;
    expect(Math.abs(wrappedStep(expectX % periodUnits, d.x, periodUnits))).toBeLessThanOrEqual(1);
    expect(Math.abs(wrappedStep(expectY % periodUnits, d.y, periodUnits))).toBeLessThanOrEqual(1);
  });

  it('beginnt bei Geschwindigkeit × Zeit: vor dem ersten Frame, nach einem Uhrsprung zurück und nach einer langen Lücke', () => {
    const d = new DriftOffset(1000, 1000);
    d.setVelocity(7, 3);
    d.advance(at(10), 0);
    expect([d.xPx, d.yPx]).toEqual([70, 30]);
    // Integrated over a normal frame.
    d.setVelocity(20, 0);
    d.advance(at(10.5), 0);
    expect(d.xPx).toBe(80);
    expect(d.yPx).toBe(30);
    // The clock runs back (a loaded game on a fresh clock): the closed form.
    d.advance(at(2), 0);
    expect(d.xPx).toBe(40);
    expect(d.yPx).toBe(0);
    // A gap longer than the loop ever advances in a frame (the field was not shown): the closed form, wrapped.
    expect(DRIFT_MAX_GAP_SECONDS).toBeCloseTo((BALANCE.time.maxCatchUpSteps * MAX_TIME_SCALE) / BALANCE.time.tickHz, 12);
    d.advance(at(60), 0);
    expect(d.xPx).toBe((20 * 60) % 1000);
    // Sleep at ×30 (the longest step of the loop) still integrates.
    d.setVelocity(1, 0);
    d.advance(at(60 + DRIFT_MAX_GAP_SECONDS), 0);
    expect(d.xPx).toBeCloseTo(200 + DRIFT_MAX_GAP_SECONDS, 1);
  });

  it('Standbild: gleiche Zeit ohne neuen Tick behält den Versatz; gleiche Zeit mit neuem Tick (Szenario) nimmt die geschlossene Form', () => {
    const d = new DriftOffset(4096, 0);
    const t = at(41.25);
    d.setVelocity(3, 0);
    d.advance(t, 100);
    expect(d.xPx).toBe(3 * 41.25);
    // A frame rate above the tick rate: the clock and the simulation stand – nothing moves, whatever the velocity.
    d.setVelocity(22, 0);
    d.advance(t, 100);
    expect(d.xPx).toBe(3 * 41.25);
    // The clock frozen for a screenshot while the scenario steps the world (the forced weather's wind): the picture
    // shows the drift of its time under the wind it ends with – the same in every run.
    d.advance(t, 101);
    expect(d.xPx).toBe(22 * 41.25);
    // The wind computed a frame after the step (the sky's refresh): the picture still takes it while the clock stands.
    d.setVelocity(9, 0);
    d.advance(t, 101);
    expect(d.xPx).toBe(9 * 41.25);
    // The clock runs again: integrated from there.
    d.advance(at(41.75), 101);
    expect(d.xPx).toBe(9 * 41.75);
    // An axis without a period does not drift.
    d.setVelocity(9, 5);
    d.advance(at(42.75), 101);
    expect(d.yPx).toBe(0);
  });

  it('Perioden sind ganze Einheiten und passen in kleine ganze Zahlen; alles andere wird abgewiesen', () => {
    expect(() => new DriftOffset(CLOUD_PERIOD_PX, CLOUD_PERIOD_PX)).not.toThrow();
    expect(() => new DriftOffset(CAUSTICS.cellPx * CAUSTICS.layerScale * CAUSTICS.periodCells, 1)).not.toThrow();
    expect(() => new DriftOffset(10.01, 1)).toThrow(/ganzes Vielfaches/);
    expect(() => new DriftOffset(100_000, 1)).toThrow(/zu lang/);
  });

  it('um 0 gelegt: ein Feld, das weniger als eine halbe Periode gezogen ist, liegt bei Geschwindigkeit × Zeit – auch rückwärts', () => {
    const d = new DriftOffset(1000, 1000);
    d.setVelocity(-6, 6);
    d.advance(at(41.25), 0);
    expect([d.xPx, d.yPx]).toEqual([-247.5, 247.5]);
    // Past half a period the offset wraps to the other side.
    d.advance(at(90), 0);
    expect(d.xPx).toBe(-540 + 1000);
    expect(d.yPx).toBe(540 - 1000);
  });

  it('die Wolken wiederholen sich in keiner Welt: ihre Periode ist länger als die größte Welt', () => {
    const largest = Math.max(...Object.values(BALANCE.world.sizeTiles)) * TILE_PX;
    expect(CLOUD_PERIOD_PX).toBeGreaterThan(largest);
    for (const p of [FOG_LOOK.tileLow, FOG_LOOK.tileMid, FOG_LOOK.tileHigh, CLOUD_PERIOD_PX]) expect(Number.isInteger(p * DRIFT_UNITS)).toBe(true);
  });

  it('das Wolkenrauschen wiederholt sich mit der Periode des Versatzes: der Umbruch zeigt keine Naht', () => {
    for (let k = 0; k < 3; k++) {
      const scale = k === 0 ? 1 : (CLOUDS.octaveScales[k - 1] ?? 0);
      // Whole lattice periods per octave.
      expect(CLOUD_OCTAVE_PERIODS[k]).toBe(Math.round(CLOUDS.periodCells * scale));
      expect(Math.abs(CLOUDS.periodCells * scale - (CLOUD_OCTAVE_PERIODS[k] ?? 0))).toBeLessThan(1e-9);
    }
    for (const [x, y] of [
      [12, 34],
      [500, 9000],
      [17_000, 260],
      [3333, 17_590],
    ] as const) {
      for (const cover of [0.3, 0.8]) {
        expect(cloudShade(x, y, cover, CLOUD_PERIOD_PX - 7.25, 3.5)).toBeCloseTo(cloudShade(x, y, cover, -7.25, 3.5 - CLOUD_PERIOD_PX), 9);
        expect(cloudShade(x + CLOUD_PERIOD_PX, y, cover, 0, 0)).toBeCloseTo(cloudShade(x, y, cover, 0, 0), 9);
      }
    }
  });
});

/** A simulation stand-in for the sky filler: a summer late morning, one weather region whose wind the test sets. */
function skySim(state: { tick: number; weather: WeatherSample; period: number }): Simulation {
  const sun: ShadowVector = { ...createShadowVector(), dirX: -0.4, dirY: -0.9, length: 0.5, elevationDeg: 50, strength: 1 };
  return {
    get tick() {
      return state.tick;
    },
    config: { seed: 7 },
    systems: [],
    world: {
      materialized: true,
      regionAt: () => 0,
      weather: { sample: (_region: number, out: WeatherSample) => Object.assign(out, state.weather), periodCount: () => state.period },
      calendar: {
        daylight: 1,
        clock: { minuteOfDay: 660 },
        sun: (out: ShadowVector) => Object.assign(out, sun),
        moon: (out: ShadowVector) => Object.assign(out, createShadowVector()),
      },
    },
  } as unknown as Simulation;
}

function skyView(): SkyView {
  return { layer: 0, left: 0, top: 0, right: 480, bottom: 270, chunks: { get: () => undefined }, signatures: new ChunkSignatures() };
}

describe('SkySceneFiller: Wolken und Nebel ziehen stetig, auch wenn der Wind wechselt', () => {
  it('ein Wetterübergang von Flaute zu Sturm nach einer Stunde Spiel: das Feld zieht je Frame höchstens mit seiner Höchstgeschwindigkeit', () => {
    const state = { tick: 216_000, weather: { ...createWeatherSample(), cloudCover: 0.8, wind: 0, lightFactor: 0.85 }, period: 3 };
    const sim = skySim(state);
    const filler = new SkySceneFiller();
    const scene = new RenderScene();
    const view = skyView();
    const dt = 1 / 60;
    let time = 3600;
    const frame = (): void => {
      scene.beginFrame(time);
      scene.env.wind = state.weather.wind * 1.2;
      filler.fill(scene, sim, view, 240, 135, time, 256);
    };
    frame();
    const top = { x: scene.sky.clouds.offsetX, y: scene.sky.clouds.offsetY };
    // The fog's offsets in px (the scene holds whole 1/DRIFT_UNITS px).
    const fog = Float64Array.from(scene.sky.fogDrift, (v) => v / DRIFT_UNITS);
    let cloudStep = 0;
    let fogStep = 0;
    // At most the top speed over a frame, a drift clock tick and a unit of rounding on top.
    const slack = (speed: number): number => speed * (dt + 1 / DRIFT_CLOCK_HZ) + 2 / DRIFT_UNITS;
    const cloudMax = slack(CLOUDS.speedPxPerSecond);
    const fogMax = slack(Math.hypot(FOG_LOOK.creep + 1.2 * FOG_LOOK.wind, FOG_LOOK.creep * FOG_LOOK.creepSouth) * Math.max(...FOG_LOOK.layerDrift));
    // A 45-s weather blend from calm to storm, then a new weather period (another wind direction).
    for (let i = 1; i <= 60 * 60; i++) {
      state.tick++;
      time += dt;
      state.weather.wind = Math.min(1, i / (45 * 60));
      if (i === 50 * 60) state.period++;
      frame();
      const c = scene.sky.clouds;
      cloudStep = Math.max(cloudStep, Math.hypot(wrappedStep(top.x, c.offsetX, CLOUD_PERIOD_PX), wrappedStep(top.y, c.offsetY, CLOUD_PERIOD_PX)));
      top.x = c.offsetX;
      top.y = c.offsetY;
      const tiles = [FOG_LOOK.tileLow, FOG_LOOK.tileMid, FOG_LOOK.tileHigh];
      for (let k = 0; k < 3; k++) {
        const period = tiles[k] ?? 1;
        const nx = (scene.sky.fogDrift[2 * k] ?? 0) / DRIFT_UNITS;
        const ny = (scene.sky.fogDrift[2 * k + 1] ?? 0) / DRIFT_UNITS;
        fogStep = Math.max(fogStep, Math.hypot(wrappedStep(fog[2 * k] ?? 0, nx, period), wrappedStep(fog[2 * k + 1] ?? 0, ny, period)));
        expect(nx).toBeGreaterThanOrEqual(-period / 2);
        expect(nx).toBeLessThan(period / 2);
        fog[2 * k] = nx;
        fog[2 * k + 1] = ny;
      }
      expect(c.offsetX).toBeGreaterThanOrEqual(-CLOUD_PERIOD_PX / 2);
      expect(c.offsetX).toBeLessThan(CLOUD_PERIOD_PX / 2);
    }
    // The sky was computed again every SKY_REFRESH_TICKS ticks with a new wind – and nothing jumped.
    expect(SKY_REFRESH_TICKS).toBeLessThan(60);
    expect(cloudStep).toBeGreaterThan(0);
    expect(cloudStep).toBeLessThanOrEqual(cloudMax);
    expect(fogStep).toBeGreaterThan(0);
    expect(fogStep).toBeLessThanOrEqual(fogMax);
    // The field moves downwind at the storm's speed now.
    const v = { offsetX: 0, offsetY: 0 };
    cloudOffset(1, 0, 1, 1, v);
    expect(Math.abs(v.offsetX)).toBeCloseTo(CLOUDS.speedPxPerSecond, 9);
  });

  it('Szenario-Standbild: die Uhr steht, die Welt macht Schritte – das Bild zeigt Geschwindigkeit × Zeit unter dem letzten Wind', () => {
    const state = { tick: 10, weather: { ...createWeatherSample(), cloudCover: 0.8, wind: 0.1, lightFactor: 0.85 }, period: 1 };
    const sim = skySim(state);
    const filler = new SkySceneFiller();
    const scene = new RenderScene();
    const view = skyView();
    const time = 41.3;
    const frame = (): void => {
      scene.beginFrame(time);
      scene.env.wind = state.weather.wind * 1.2;
      filler.fill(scene, sim, view, 240, 135, time, 256);
    };
    frame();
    // The scenario forces its weather and steps the world; the clock stays frozen.
    state.weather.wind = 0.9;
    state.period = 2;
    state.tick++;
    frame();
    frame();
    /** The closed form velocity × time [px] of a field of `period` px (velocity in whole units per second, wrapped). */
    const closed = (v: number, period: number): number => {
      const q = Math.round(v * DRIFT_UNITS) * driftClock(time);
      const p = period * DRIFT_UNITS * DRIFT_CLOCK_HZ;
      const units = Math.floor((((q % p) + p) % p) / DRIFT_CLOCK_HZ);
      const whole = period * DRIFT_UNITS;
      return (units >= whole / 2 ? units - whole : units) / DRIFT_UNITS;
    };
    const velocity = { offsetX: 0, offsetY: 0 };
    const len = Math.hypot(scene.sky.windX, scene.sky.windY);
    cloudOffset(scene.sky.windX / len, scene.sky.windY / len, 0.9, 1, velocity);
    expect(Math.hypot(velocity.offsetX, velocity.offsetY)).toBeCloseTo(CLOUDS.calmSpeedPxPerSecond + 0.9 * (CLOUDS.speedPxPerSecond - CLOUDS.calmSpeedPxPerSecond), 9);
    expect(scene.sky.clouds.offsetX).toBe(closed(velocity.offsetX, CLOUD_PERIOD_PX));
    expect(scene.sky.clouds.offsetY).toBe(closed(velocity.offsetY, CLOUD_PERIOD_PX));
    // The fog's banks likewise: creep and the last wind × the frozen time, each layer at its share, wrapped to its tile.
    const vx = FOG_LOOK.creep + 0.9 * 1.2 * FOG_LOOK.wind;
    expect((scene.sky.fogDrift[2] ?? 0) / DRIFT_UNITS).toBe(closed(vx * FOG_LOOK.layerDrift[1], FOG_LOOK.tileMid));
  });
});
