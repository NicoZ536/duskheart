/**
 * M5-12 "getrieben vom Wetter der Simulation": the game view's particle filler (src/render/world/particlesScene.ts)
 * reads the weather of the region at the camera – read only – and hands the particle system its kind, amount, wind and
 * thunderstorm; the wind's direction is the one the fire simulation spreads with in that weather period.
 */
import { describe, expect, it } from 'vitest';
import { normalizeSeed } from '../../../src/engine/rng';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import { windDirection } from '../../../src/game/fire/formulas';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import { RenderScene } from '../../../src/render/scene';
import { windVelocity } from '../../../src/render/particles/weather';
import { ParticleSceneFiller } from '../../../src/render/world/particlesScene';
import { createWeatherSample } from '../../../src/world/climate/weather';

const CONFIG = { seed: 1, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** A generated world and a few ticks: more than the default 5 s on a loaded machine. */
const FULL_SIM_TIMEOUT_MS = 120_000;
const TILE = 16;

function step(sim: Simulation, commands: readonly GameCommand[]): void {
  sim.step(commands.map((c) => parseGameCommand(c)));
  sim.events.drain(() => undefined);
}

describe('Wetterpartikel aus dem Wetter der Simulation', () => {
  it(
    'Gewitter an der Kamera: Regen in voller Menge, Blitz, Wind aus Stärke und Richtung der Wetterperiode; darunter kein Himmel',
    () => {
      const sim = createSimulation(CONFIG);
      step(sim, [{ type: 'player.spawn' }]);
      step(sim, [{ type: 'setWeather', state: 'gewitter' }]);
      step(sim, [{ type: 'advanceTime', minutes: 60 }]);
      expect(sim.world.materialized).toBe(true);
      // The camera on the start beach, where the player spawned.
      const spawn = sim.world.generated.spawn;
      const focus = { x: (spawn.x + 0.5) * TILE, y: (spawn.y + 0.5) * TILE };
      const scene = new RenderScene();
      scene.beginFrame(1);
      const filler = new ParticleSceneFiller();
      filler.fill(scene, sim, 0, focus.x, focus.y, false, 0, 0);
      const w = scene.particles.weather;
      const region = sim.world.regionAt(Math.floor(focus.x / TILE), Math.floor(focus.y / TILE));
      const s = sim.world.weather.sample(region, createWeatherSample());
      expect(s.state).toBe('gewitter');
      expect([w.id, w.amount, w.storm, w.sky]).toEqual(['regen', s.precipitation, 1, true]);
      const wind = windVelocity(windDirection(normalizeSeed(sim.config.seed), region, sim.world.weather.periodCount(region)), s.wind, { x: 0, y: 0 });
      expect(w.windX).toBeCloseTo(wind.x, 6);
      expect(w.windY).toBeCloseTo(wind.y, 6);
      expect(Math.hypot(w.windX, w.windY)).toBeGreaterThan(0);
      // Snow: the kind changes with the weather, the lightning stops.
      step(sim, [{ type: 'setWeather', state: 'schneesturm' }]);
      step(sim, [{ type: 'advanceTime', minutes: 60 }]);
      scene.beginFrame(2);
      filler.fill(scene, sim, 0, focus.x, focus.y, false, 0, 0);
      expect([scene.particles.weather.id, scene.particles.weather.storm]).toEqual(['schnee', 0]);
      // Reading changes nothing in the simulation.
      const hash = sim.hashState();
      filler.fill(scene, sim, 0, focus.x, focus.y, false, 0, 0);
      expect(sim.hashState()).toBe(hash);
      // A cave has no sky.
      scene.beginFrame(3);
      filler.fill(scene, sim, -1, focus.x, focus.y, false, 0, 0);
      expect([scene.particles.weather.sky, scene.particles.weather.id]).toEqual([false, null]);
    },
    FULL_SIM_TIMEOUT_MS,
  );
});
