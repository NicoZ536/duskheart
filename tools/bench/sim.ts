/**
 * Headless-Simulationsszenarien (Node). Budget §30: Simulation ≤ 3 ms pro Tick.
 * Grenzwerte enthalten eine Sicherheitsmarge für geteilte CI-Maschinen (Faktor 1,5).
 */
import { ColumnStore, Ecs } from '../../src/engine/ecs';
import { Rng } from '../../src/engine/rng';
import { SpatialHash } from '../../src/engine/spatialHash';
import { percentile, type Metric, type SimScenario } from './stats';

const SIM_BUDGET_MS = 3;
const MARGIN = 1.5;

/** ECS-Grundlast: 6 000 Entitäten mit Position/Velocity bewegen und im Hash-Grid aktualisieren (§30 „bis 6 000 Sprites“). */
const ecsMovement: SimScenario = {
  name: 'sim:ecs-6000-bewegung',
  run(): Metric[] {
    const ecs = new Ecs();
    const pos = ecs.registerComponent('pos', new ColumnStore({ x: 'f32', y: 'f32', vx: 'f32', vy: 'f32' }, 8192));
    const grid = new SpatialHash(64);
    const rng = new Rng(42);
    for (let i = 0; i < 6000; i++) {
      const e = ecs.create();
      const row = pos.add(e);
      pos.columns.x[row] = rng.float(0, 4096);
      pos.columns.y[row] = rng.float(0, 4096);
      pos.columns.vx[row] = rng.float(-40, 40);
      pos.columns.vy[row] = rng.float(-40, 40);
    }
    const samples: number[] = [];
    const dt = 1 / 60;
    for (let tick = 0; tick < 600; tick++) {
      const t0 = performance.now();
      const { x, y, vx, vy } = pos.columns;
      const ents = pos.entities;
      for (let i = 0; i < pos.size; i++) {
        let nx = (x[i] ?? 0) + (vx[i] ?? 0) * dt;
        let ny = (y[i] ?? 0) + (vy[i] ?? 0) * dt;
        if (nx < 0 || nx > 4096) vx[i] = -(vx[i] ?? 0);
        if (ny < 0 || ny > 4096) vy[i] = -(vy[i] ?? 0);
        nx = Math.min(4096, Math.max(0, nx));
        ny = Math.min(4096, Math.max(0, ny));
        x[i] = nx;
        y[i] = ny;
        const e = ents[i] ?? 0;
        grid.upsert(e, nx - 4, ny - 4, nx + 4, ny + 4);
      }
      samples.push(performance.now() - t0);
    }
    return [{ metric: 'tick p95', value: percentile(samples.slice(60), 95), limit: SIM_BUDGET_MS * MARGIN, unit: 'ms' }];
  },
};

export const SIM_SCENARIOS: SimScenario[] = [ecsMovement];
