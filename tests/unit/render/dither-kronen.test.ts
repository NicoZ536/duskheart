/**
 * M5-18 „Blätterdach und Dächer: Kreis-Dither-Ausblendung um den Spieler (final)“: crowns and roofs in front of the
 * player open in a circle – fully see-through in its core, dissolving outwards in a Bayer ring anchored to the world
 * (the pattern does not swim with the camera) –, and the circle irises open when something starts to cover the player
 * (src/render/surface/rules.ts `canopyKeeps`, `irisStep`, `irisEase`; sprite_gbuffer.frag, gbufferPass.ts). A still picture
 * is final only once the circle stands (`SurfaceSceneFiller.irisAtRest`, part of `GameWorldScene.ready`).
 */
import { describe, expect, it } from 'vitest';
import { SHADERS } from '../../../src/render/shaderLib';
import { canopyKeeps, irisEase, irisStep } from '../../../src/render/surface/rules';
import { SURFACE_PARAMS } from '../../../src/render/surface/params';
import { SurfaceSceneFiller, SurfaceView } from '../../../src/render/world/surfaceScene';
import { RenderScene } from '../../../src/render/scene';
import type { Simulation } from '../../../src/game/sim';

const C = SURFACE_PARAMS.canopy;

/** A simulation stand-in with what the surface reads: a still clock, a summer day, calm weather, no chunks. */
function stillSim(): Simulation {
  const sample = (_r: number, out: { wind: number; blend: number; precipitation: number; precipitationKind: string }) => {
    out.wind = 0;
    out.blend = 1;
    out.precipitation = 0;
    out.precipitationKind = 'keiner';
    return out;
  };
  return {
    config: { seed: 1 },
    clock: { tick: 3600, ticksPerGameMinute: 60, dayFraction: 0.5 },
    world: {
      materialized: true,
      calendar: { today: { seasonIndex: 1, dayOfSeason: 4, seasonLengthDays: 7 }, daylight: 1, season: 'sommer' },
      regionAt: () => 0,
      weather: { sample, periodCount: () => 1 },
      temperature: { temperatureAt: () => 12 },
      chunks: { get: () => undefined },
    },
  } as unknown as Simulation;
}

/** Share of the pixels of a 4 × 4 cell kept at relative distance `d`. */
function kept(d: number): number {
  let n = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (canopyKeeps(d, x, y)) n++;
  return n / 16;
}

describe('Kreis-Dither um den Spieler', () => {
  it('Kern ganz durchsichtig, Ring zerfällt nach außen, außerhalb bleibt alles', () => {
    for (let d = 0; d <= C.core; d += 0.05) expect(kept(d)).toBe(0);
    expect(kept(1)).toBe(1);
    expect(kept(1.5)).toBe(1);
    let last = 0;
    for (let d = C.core; d < 1; d += 0.02) {
      const k = kept(d);
      expect(k).toBeGreaterThanOrEqual(last);
      last = k;
    }
    expect(kept((C.core + 1) / 2)).toBeGreaterThan(0);
    expect(kept((C.core + 1) / 2)).toBeLessThan(1);
  });

  it('das Muster hängt an der Welt: dieselbe Weltstelle, dieselbe Entscheidung', () => {
    const d = (C.core + 1) / 2;
    for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) expect(canopyKeeps(d, x + 400, y - 64)).toBe(canopyKeeps(d, x, y));
    const src = SHADERS['sprite_gbuffer.frag'] ?? '';
    expect(src).toContain('if (d < 1.0 && smoothstep(DH_FADE_CORE, 1.0, d) < bayer4(floor(uOrigin + q))) discard;');
  });

  it('der Kreis öffnet sich in openSeconds und schließt, sobald nichts mehr deckt', () => {
    let open = 0;
    const dt = 1 / 60;
    let frames = 0;
    while (open < 1 && frames < 1000) {
      open = irisStep(open, true, dt);
      frames++;
    }
    // One frame of rounding either way.
    expect(Math.abs(frames - C.openSeconds / dt)).toBeLessThanOrEqual(1);
    expect(irisStep(1, true, dt)).toBe(1);
    expect(irisStep(0.6, false, dt)).toBe(0);
    // A frozen clock (screenshots) opens it in fixed steps.
    expect(irisStep(0, true, 0)).toBe(C.frozenStep);
    expect(irisStep(0, true, Number.NaN)).toBe(C.frozenStep);
  });

  it('eingeschwungen: schnell am Anfang, sanft am Ende, 0 und 1 fest', () => {
    expect(irisEase(0)).toBe(0);
    expect(irisEase(1)).toBe(1);
    expect(irisEase(0.5)).toBeCloseTo(0.5, 9);
    expect(irisEase(0.9) - irisEase(0.8)).toBeLessThan(irisEase(0.5) - irisEase(0.4));
    const pass = SHADERS['world/terrain.frag'];
    expect(pass).toBeDefined();
  });

  it('ein Standbild ist erst fertig, wenn der Kreis steht (eingefrorene Uhr: frozenStep je Frame)', () => {
    const filler = new SurfaceSceneFiller();
    const scene = new RenderScene();
    const sim = stillSim();
    // The screenshot clock stands still: every frame shows the same presentation time.
    const frame = (covering: number): void => {
      scene.beginFrame(41.3);
      filler.fill(scene, sim, null, new SurfaceView().set(0, 800, 800, 480, 270, true, 800, 808, 41.3, covering));
    };
    expect(filler.irisAtRest(0)).toBe(true);
    // A crown covers the figure: the circle needs 1 / frozenStep frames to open, and only then stands.
    const frames = Math.ceil(1 / C.frozenStep);
    expect(frames).toBeGreaterThan(1);
    for (let i = 0; i < frames; i++) {
      expect(filler.irisAtRest(1)).toBe(false);
      frame(1);
    }
    expect(filler.irisAtRest(1)).toBe(true);
    expect(scene.surface.canopyOpen).toBe(1);
    frame(1);
    expect(filler.irisAtRest(1)).toBe(true);
    // Nothing covers it any more: the next frame shuts the circle.
    expect(filler.irisAtRest(0)).toBe(false);
    frame(0);
    expect(filler.irisAtRest(0)).toBe(true);
    expect(scene.surface.canopyOpen).toBe(0);
  });
});
