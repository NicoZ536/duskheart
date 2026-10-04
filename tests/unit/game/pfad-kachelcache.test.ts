/**
 * M6-16g Pfad-Kachelcache ohne Allokation je Kachel (§30 „Keine Allokationen in Hot-Loops“): baut der Cache die Wörter
 * eines Chunks (`PathTileCache.fill` → je Kachel `CollisionGrid.info` mit den Überlagerungen der Systeme), fragte er die
 * Überlagerung der Lagerfeuer (Lichtsystem) und der Stationen je Kachel – über Closures, deren Kachelschlüssel mit 16 Bit
 * je Achse über 2^30 lag und bei jeder Abfrage eine Zahl auf dem Heap anlegte (≈ 2,3 B je Kachel). Jetzt sind beide
 * Überlagerungen Klassen und der Schlüssel eine kleine Ganzzahl (13 Bit je Achse, die größte Welt hat 2 048 Kacheln).
 *
 * Geprüft wird in einer Welt mit Lagerfeuern und Stationen: die Überlagerungen melden genau ihre Kacheln – auch an den
 * Rändern der größten Welt, nichts für Kacheln jenseits des Schlüsselbereichs –, die Pfad-Wörter tragen sie, und ein
 * Neuaufbau des Fensters legt < 1 B je Kachel an (Stichproben-Heap-Profil von `node:inspector`).
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { BALANCE } from '../../../src/content/balance';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import type { LightSystem } from '../../../src/game/light/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import type { StationSystem } from '../../../src/game/stations/system';
import { BLOCK_OBJECT } from '../../../src/world/collision/tiles';
import { CHUNK_SHIFT, CHUNK_SIZE, TILE_PX } from '../../../src/world/model/coords';
import { PathGrid } from '../../../src/world/path/grid';

/** Mittlerer Abstand zweier Heap-Stichproben [B]. */
const SAMPLING_INTERVAL = 16;
/** Grenze [B je Kachel]. */
const MAX_BYTES_PER_TILE = 1;
/** Neuaufbauten je Messung (je 5 × 5 Chunks). */
const FILLS = 30;
const WINDOW = 5;

let sim: Simulation;
let tx = 0;
let ty = 0;
const fires: [number, number][] = [
  [3, 0],
  [-3, 2],
  [0, -4],
];
const benches: [number, number][] = [
  [-3, -2],
  [3, 3],
];
/** A torch on its stake: passed, not in the way. */
const torch: [number, number] = [-2, 4];

function run(cmds: readonly GameCommand[] = [], n = 1): void {
  for (let i = 0; i < n; i++) {
    sim.step(i === 0 ? cmds.map((c) => parseGameCommand(c)) : undefined);
    sim.events.drain((type, payload) => {
      if (type === 'commandRejected') throw new Error(`abgelehnt: ${JSON.stringify(payload)}`);
    });
  }
}

function slotOf(item: string): { bereich: 'schnellleiste' | 'inventar' | 'rucksackfach'; index: number } {
  const s = (sim.system('inventory') as unknown as InventorySystem).state as unknown as Record<string, ({ item: string } | null)[]>;
  for (const bereich of ['schnellleiste', 'inventar', 'rucksackfach'] as const) {
    const index = (s[bereich] ?? []).findIndex((x) => x !== null && x.item === item);
    if (index >= 0) return { bereich, index };
  }
  throw new Error(`${item} nicht in den Taschen`);
}

let session: Session;
beforeAll(async () => {
  sim = createSimulation({ seed: 11, worldSize: 'small' });
  run([{ type: 'player.spawn' }], 30);
  const at = { x: 0, y: 0 };
  (sim.system('player') as unknown as PlayerSystem).position(sim, at);
  tx = Math.floor(at.x / TILE_PX);
  ty = Math.floor(at.y / TILE_PX);
  run([{ type: 'inventory.give', item: 'lagerfeuer', count: fires.length }]);
  for (const [dx, dy] of fires) run([{ type: 'light.place', from: slotOf('lagerfeuer'), tx: tx + dx, ty: ty + dy }], 2);
  run([{ type: 'inventory.give', item: 'werkbank', count: benches.length }]);
  for (const [dx, dy] of benches) run([{ type: 'station.place', from: slotOf('werkbank'), tx: tx + dx, ty: ty + dy }], 2);
  run([{ type: 'inventory.give', item: 'fackel', count: 1 }]);
  run([{ type: 'light.place', from: slotOf('fackel'), tx: tx + torch[0], ty: ty + torch[1] }], 2);
  session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
}, 60_000);
afterAll(() => session.disconnect());

describe('Pfad-Kachelcache ohne Allokation je Kachel (M6-16g)', () => {
  it('die Überlagerungen melden genau ihre Kacheln, auch am Rand der größten Welt; die Pfad-Wörter tragen sie', () => {
    const light = (sim.system('light') as unknown as LightSystem).collisionOverlay();
    const stations = (sim.system('stations') as unknown as StationSystem).collisionOverlay();
    for (const [dx, dy] of fires) expect(light.overlayAt(0, tx + dx, ty + dy)).toBe(BLOCK_OBJECT);
    // A workbench is two tiles wide.
    for (const [dx, dy] of benches) for (const o of [0, 1]) expect(stations.overlayAt(0, tx + dx + o, ty + dy)).toBe(BLOCK_OBJECT);
    let objects = 0;
    for (let y = ty - 8; y <= ty + 8; y++) for (let x = tx - 8; x <= tx + 8; x++) objects += (light.overlayAt(0, x, y) | stations.overlayAt(0, x, y)) === BLOCK_OBJECT ? 1 : 0;
    expect(objects).toBe(fires.length + 2 * benches.length);
    const light0 = sim.system('light') as unknown as LightSystem;
    expect(light0.lightAt(0, tx + torch[0], ty + torch[1])?.kind).toBe('fackel');
    expect(light.overlayAt(0, tx + torch[0], ty + torch[1])).toBe(0);
    // Nothing on another layer, nothing beyond the key's span – and the corners of the largest world are tiles of their own.
    expect(light.overlayAt(-1, tx + 3, ty)).toBe(0);
    const edge = BALANCE.world.sizeTiles.large - 1;
    for (const [x, y] of [
      [-1, ty],
      [tx, -1],
      [edge, edge],
      [0, edge],
      [1 << 13, ty],
      [tx + 3, ty + (1 << 13)],
      // Beyond the span a tile would alias one of the next row: the fire at (tx + 3, ty), the bench at (tx − 3, ty − 2).
      [tx + 3 + (1 << 13), ty - 1],
      [tx - 3 + (1 << 13), ty - 3],
    ] as const) {
      expect(light.overlayAt(0, x, y)).toBe(0);
      expect(stations.overlayAt(0, x, y)).toBe(0);
    }
    // The path words of the fires' and benches' tiles are objects.
    const cache = (sim.system('creatures') as unknown as CreatureSystem).paths.tiles;
    const grid = new PathGrid();
    const cx0 = (tx >> CHUNK_SHIFT) - 2;
    const cy0 = (ty >> CHUNK_SHIFT) - 2;
    grid.reset(0, cx0, cy0, WINDOW, WINDOW);
    cache.fill(grid, null, sim.tick);
    const wordAt = (x: number, y: number): number => grid.words[(y - cy0 * CHUNK_SIZE) * grid.width + (x - cx0 * CHUNK_SIZE)] as number;
    for (const [dx, dy] of fires) expect(wordAt(tx + dx, ty + dy) & BLOCK_OBJECT).toBe(BLOCK_OBJECT);
    for (const [dx, dy] of benches) expect(wordAt(tx + dx + 1, ty + dy) & BLOCK_OBJECT).toBe(BLOCK_OBJECT);
  });

  it('ein Neuaufbau des Fensters legt < 1 B je Kachel an', async () => {
    const cache = (sim.system('creatures') as unknown as CreatureSystem).paths.tiles;
    const grid = new PathGrid();
    const ccx = tx >> CHUNK_SHIFT;
    const ccy = ty >> CHUNK_SHIFT;
    let tick = sim.tick;
    const fills = (n: number): void => {
      for (let k = 0; k < n; k++) {
        for (let cy = ccy - 2; cy <= ccy + 2; cy++) for (let cx = ccx - 2; cx <= ccx + 2; cx++) cache.invalidateChunk(0, cx, cy);
        grid.reset(0, ccx - 2, ccy - 2, WINDOW, WINDOW);
        cache.fill(grid, null, ++tick);
      }
    };
    fills(3 * FILLS);
    await session.post('HeapProfiler.collectGarbage');
    await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    fills(FILLS);
    const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
    const alloc = pathAllocation(profile, (f) => f.functionName === 'fill' && /world\/path\/cache\.ts/.test(f.url));
    expect(alloc.inPath / (FILLS * WINDOW * WINDOW * CHUNK_SIZE * CHUNK_SIZE), `Allokation unter fill: ${JSON.stringify(alloc.top)}`).toBeLessThan(MAX_BYTES_PER_TILE);
  }, 60_000);
});
