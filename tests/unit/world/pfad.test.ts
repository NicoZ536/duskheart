/**
 * M6-16/M6-17 path finding (docs/SPIEL.md §12): A* with jump points is optimal (Dijkstra reference on random grids
 * with levels, ramps, doors, water and light), JPS and plain A* agree, the chunk hierarchy yields valid paths within
 * (1 + ε) of the optimum, and doors, levels, swimmers, fliers and light behave as §19.4 asks. The grids are tile
 * words built by hand (`pfadHilfen.ts`); the pipeline from the collision grid is tested at the end.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { Rng } from '../../../src/engine/rng';
import { BLOCK_ALL, BLOCK_DEEP_WATER, BLOCK_HAZARD, BLOCK_OBJECT, BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL, CollisionGrid, packTileInfo, type CollisionOverlay } from '../../../src/world/collision/tiles';
import { ChunkData, TILE_FLAG_RAMP, WATER_DEPTH_DEEP } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, packChunkId, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { PathTileCache, wordOf } from '../../../src/world/path/cache';
import { PathContext, PathJobBuffers, PathJobRunner, PathSnapshot, decodeAnswer, findPath } from '../../../src/world/path/find';
import { PATH_BLOCK_BITS, PATH_CONNECTOR, PATH_DOOR, PATH_LEVEL_SHIFT, PATH_LIGHT, PATH_LINK, PATH_VOID_WORD, PATH_WATER, PathGrid, createPathResult, moverBlockMask, pathProfile, type PathProfile } from '../../../src/world/path/grid';
import { BORDER_EAST, BORDER_SOUTH, ROUTE_FOUND, ROUTE_NEAREST, borderIndex, type PortalCache } from '../../../src/world/path/hierarchy';
import { GridSearch } from '../../../src/world/path/search';
import { MOVER_CLASSES, type MoverClass, type PathResult } from '../../../src/world/path/types';
import { CHUNK, REF_DIAGONAL, REF_DOOR, REF_INF, REF_STRAIGHT, RefRules, emptyGrid, finishGrid, randomGrid, randomPassable, refDistances, refPathCost } from './pfadHilfen';

/** Runs the tile search (JPS or plain A*) of a grid from (sx, sy) to (gx, gy); returns the result and the search. */
function searchTiles(grid: PathGrid, profile: PathProfile, light: boolean, sx: number, sy: number, gx: number, gy: number, jumps = true): { result: PathResult; cost: number; search: GridSearch } {
  const search = new GridSearch();
  search.jumps = jumps;
  search.bind(grid, profile, light);
  const end = search.search(sx, sy, gx, gy, 1_000_000);
  const result = createPathResult();
  result.status = end === 'found' ? 'found' : 'partial';
  result.steps = search.tracePath(grid, search.end, result);
  result.expanded = search.expanded;
  return { result, cost: end === 'found' ? search.endCost : REF_INF, search };
}

/** A snapshot of a whole grid for `findPath`. */
function snapshotOf(grid: PathGrid, mover: MoverClass, opens: boolean, light: boolean, sx: number, sy: number, gx: number, gy: number, maxNodes = BALANCE.ai.path.maxNodesPerRequest): PathSnapshot {
  const s = new PathSnapshot();
  const g = s.grid;
  g.reset(grid.layer, grid.cx0, grid.cy0, grid.cw, grid.ch);
  g.words.set(grid.words.subarray(0, grid.width * grid.height));
  g.versions.set(grid.versions.subarray(0, grid.cw * grid.ch));
  g.special.set(grid.special.subarray(0, grid.cw * grid.ch));
  s.fromTx = sx + grid.tx0;
  s.fromTy = sy + grid.ty0;
  s.toTx = gx + grid.tx0;
  s.toTy = gy + grid.ty0;
  s.profile = pathProfile(mover, opens);
  s.light = light;
  s.maxNodes = maxNodes;
  return s;
}

const RICH = { chunks: 2, obstacles: 0.18, levels: true, doors: true, water: true, light: true } as const;

describe('JPS auf dem Kachelraster (M6-16)', () => {
  it('findet auf Zufallsrastern mit Ebenen, Rampen, Türen, Wasser und Licht dieselben Kosten wie Dijkstra, Schritt für Schritt gültig', () => {
    let compared = 0;
    let unreachable = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const grid = randomGrid(seed, RICH);
      const rng = new Rng(seed * 31);
      for (const mover of MOVER_CLASSES) {
        for (const opens of [false, true]) {
          const light = mover === 'land' && seed % 2 === 0;
          const rules = new RefRules(grid, mover, opens, light);
          const from = randomPassable(rng, rules);
          const to = randomPassable(rng, rules);
          if (from === null || to === null || (from[0] === to[0] && from[1] === to[1])) continue;
          const ref = refDistances(rules, from[0], from[1]);
          const want = ref[to[1] * grid.width + to[0]] as number;
          const { result, cost } = searchTiles(grid, pathProfile(mover, opens), light, from[0], from[1], to[0], to[1]);
          if (want === REF_INF) {
            unreachable++;
            expect(cost, `seed ${seed} ${mover} ${opens}`).toBe(REF_INF);
            continue;
          }
          compared++;
          expect(cost, `seed ${seed} ${mover} Türen ${opens}`).toBe(want);
          expect(refPathCost(rules, from[0], from[1], result), `seed ${seed} ${mover} Türen ${opens}: Pfad gültig`).toBe(want);
          const last = result.steps - 1;
          expect([result.tiles[2 * last], result.tiles[2 * last + 1]]).toEqual(to);
        }
      }
    }
    expect(compared).toBeGreaterThan(40);
    expect(unreachable).toBeGreaterThan(0);
  });

  it('JPS und A* ohne Sprünge liefern dieselben Kosten, JPS expandiert weniger Knoten', () => {
    let jpsNodes = 0;
    let astarNodes = 0;
    for (let seed = 40; seed < 52; seed++) {
      const grid = randomGrid(seed, { ...RICH, obstacles: 0.08, light: false });
      const rng = new Rng(seed);
      const rules = new RefRules(grid, 'land', true, false);
      const from = randomPassable(rng, rules);
      const to = randomPassable(rng, rules);
      if (from === null || to === null) continue;
      const jps = searchTiles(grid, pathProfile('land', true), false, from[0], from[1], to[0], to[1], true);
      const astar = searchTiles(grid, pathProfile('land', true), false, from[0], from[1], to[0], to[1], false);
      expect(jps.cost).toBe(astar.cost);
      if (jps.cost !== REF_INF) expect(refPathCost(rules, from[0], from[1], jps.result)).toBe(jps.cost);
      jpsNodes += jps.search.expanded;
      astarNodes += astar.search.expanded;
    }
    expect(jpsNodes * 2).toBeLessThan(astarNodes);
  });

  it('offenes Gelände: gerade und diagonale Strecken mit oktiler Länge, ohne Eckenschneiden an Hindernissen', () => {
    const grid = finishGrid(emptyGrid(2));
    const land = pathProfile('land', false);
    const straight = searchTiles(grid, land, false, 2, 5, 40, 5);
    expect(straight.cost).toBe(38 * REF_STRAIGHT);
    const diagonal = searchTiles(grid, land, false, 2, 2, 22, 22);
    expect(diagonal.cost).toBe(20 * REF_DIAGONAL);
    expect(diagonal.result.steps).toBe(20);
    // A single rock at (5, 5): no diagonal step may pass its corners, so (4, 4) → (6, 6) takes four straight steps.
    grid.words[5 * grid.width + 5] = BLOCK_OBJECT;
    finishGrid(grid);
    const around = searchTiles(grid, land, false, 4, 4, 6, 6);
    const rules = new RefRules(grid, 'land', false, false);
    expect(around.cost).toBe(refDistances(rules, 4, 4)[6 * grid.width + 6]);
    expect(around.cost).toBe(4 * REF_STRAIGHT);
    // Two rocks touching diagonally close the gap between them.
    grid.words[4 * grid.width + 6] = BLOCK_OBJECT;
    grid.words[5 * grid.width + 5] = BLOCK_OBJECT;
    finishGrid(grid);
    const r = searchTiles(grid, land, false, 5, 4, 6, 5);
    expect(r.cost).toBeGreaterThan(REF_DIAGONAL);
  });
});

describe('Ebenen, Rampen, Türen, Schwimmer, Flieger, Licht (M6-16, M6-17)', () => {
  /** A plateau (level 1) over x 10–29, y 10–29 with a ramp of two tiles at its south edge (x 18–19). */
  function plateau(): PathGrid {
    const grid = emptyGrid(2);
    const w = grid.width;
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) grid.words[y * w + x] = 1 << PATH_LEVEL_SHIFT;
    for (const x of [18, 19]) {
      grid.words[29 * w + x] = (1 << PATH_LEVEL_SHIFT) | PATH_CONNECTOR;
      grid.words[30 * w + x] = PATH_CONNECTOR;
    }
    return finishGrid(grid);
  }

  it('Läufer wechseln die Ebene nur über die Rampe, Verbindungen sind markiert, Flieger fliegen direkt', () => {
    const grid = plateau();
    const w = grid.width;
    expect(grid.words[29 * w + 18]! & PATH_LINK).not.toBe(0);
    expect(grid.words[30 * w + 19]! & PATH_LINK).not.toBe(0);
    // From below the plateau (west) to its middle.
    const land = searchTiles(grid, pathProfile('land', false), false, 5, 20, 20, 20);
    expect(land.cost).not.toBe(REF_INF);
    const tiles: string[] = [];
    for (let i = 0; i < land.result.steps; i++) tiles.push(`${land.result.tiles[2 * i]},${land.result.tiles[2 * i + 1]}`);
    expect(tiles.some((t) => t === '18,29' || t === '19,29')).toBe(true);
    const rules = new RefRules(grid, 'land', false, false);
    expect(land.cost).toBe(refDistances(rules, 5, 20)[20 * w + 20]);
    const flier = searchTiles(grid, pathProfile('flieger', false), false, 5, 20, 20, 20);
    expect(flier.cost).toBe(15 * REF_STRAIGHT);
    expect(land.cost).toBeGreaterThan(flier.cost);
    // Without the ramp the plateau is out of reach for walkers (land creatures never jump down, §11.4).
    for (const x of [18, 19]) {
      grid.words[29 * w + x] = 1 << PATH_LEVEL_SHIFT;
      grid.words[30 * w + x] = 0;
    }
    finishGrid(grid);
    expect(searchTiles(grid, pathProfile('land', false), false, 5, 20, 20, 20).cost).toBe(REF_INF);
    expect(searchTiles(grid, pathProfile('land', false), false, 20, 20, 5, 20).cost).toBe(REF_INF);
    // Two connectors two levels apart do not join: a ramp tile on level 2 next to one on level 0.
    for (let y = 12; y < 18; y++) for (let x = 12; x < 18; x++) grid.words[y * w + x] = 2 << PATH_LEVEL_SHIFT;
    grid.words[17 * w + 12] = (2 << PATH_LEVEL_SHIFT) | PATH_CONNECTOR;
    grid.words[18 * w + 12] = (1 << PATH_LEVEL_SHIFT) | PATH_CONNECTOR;
    grid.words[17 * w + 11] = PATH_CONNECTOR;
    finishGrid(grid);
    expect(searchTiles(grid, pathProfile('land', false), false, 11, 17, 14, 14).cost).toBe(REF_INF);
    expect(searchTiles(grid, pathProfile('land', false), false, 14, 14, 11, 17).cost).toBe(REF_INF);
  });

  it('Flieger überfliegen Klippenwände, Wasser, Lava und Hindernisse, nicht Fels; Schwimmer und Landtiere meiden Lava', () => {
    const grid = emptyGrid(2);
    const w = grid.width;
    // Across x = 20 (y 0–63) in bands: cliff face, lava, objects; deep water in x = 30.
    for (let y = 0; y < 64; y++) {
      grid.words[y * w + 20] = y < 20 ? BLOCK_WALL : y < 40 ? BLOCK_HAZARD : BLOCK_OBJECT;
      grid.words[y * w + 30] = BLOCK_DEEP_WATER | PATH_WATER;
    }
    finishGrid(grid);
    const flier = pathProfile('flieger', false);
    expect(searchTiles(grid, flier, false, 10, 10, 40, 10).cost).toBe(30 * REF_STRAIGHT);
    expect(searchTiles(grid, flier, false, 10, 30, 40, 30).cost).toBe(30 * REF_STRAIGHT);
    expect(searchTiles(grid, flier, false, 10, 50, 40, 50).cost).toBe(30 * REF_STRAIGHT);
    expect(searchTiles(grid, pathProfile('land', false), false, 10, 30, 40, 30).cost).toBe(REF_INF);
    expect(searchTiles(grid, pathProfile('amphibie', false), false, 10, 30, 40, 30).cost).toBe(REF_INF);
    // A lava channel through a lake stops a swimmer.
    const lake = emptyGrid(2);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) lake.words[y * lake.width + x] = PATH_WATER | (x === 32 ? BLOCK_HAZARD : 0);
    finishGrid(lake);
    expect(searchTiles(lake, pathProfile('schwimmer', false), false, 10, 30, 50, 30).cost).toBe(REF_INF);
    // Rock stops the flier as well.
    for (let y = 0; y < 64; y++) grid.words[y * w + 25] = BLOCK_SOLID;
    finishGrid(grid);
    expect(searchTiles(grid, flier, false, 10, 10, 40, 10).cost).toBe(REF_INF);
  });

  it('Türen: Öffner gehen hindurch, wenn der Umweg länger als die Türkosten ist; andere gehen herum oder gar nicht', () => {
    const grid = emptyGrid(2);
    const w = grid.width;
    // A wall across x = 20 from y 0 to 50 with a door at y 10; the wall ends at y 50 (way round below).
    for (let y = 0; y <= 50; y++) grid.words[y * w + 20] = y === 10 ? PATH_DOOR : BLOCK_SOLID;
    finishGrid(grid);
    const opener = searchTiles(grid, pathProfile('land', true), false, 15, 10, 25, 10);
    expect(opener.cost).toBe(10 * REF_STRAIGHT + REF_DOOR);
    const other = searchTiles(grid, pathProfile('land', false), false, 15, 10, 25, 10);
    expect(other.cost).toBe(refDistances(new RefRules(grid, 'land', false, false), 15, 10)[10 * w + 25]);
    expect(other.cost).toBeGreaterThan(opener.cost);
    // Near the end of the wall the way round is shorter than the door's cost: the opener goes round, too.
    const nearEnd = searchTiles(grid, pathProfile('land', true), false, 18, 48, 22, 48);
    expect(nearEnd.cost).toBe(refDistances(new RefRules(grid, 'land', true, false), 18, 48)[48 * w + 22]);
    expect(nearEnd.cost).toBeLessThan(4 * REF_STRAIGHT + REF_DOOR);
    // Closed all the way: only the opener gets through.
    for (let y = 51; y < grid.height; y++) grid.words[y * w + 20] = BLOCK_SOLID;
    finishGrid(grid);
    expect(searchTiles(grid, pathProfile('land', false), false, 15, 10, 25, 10).cost).toBe(REF_INF);
    expect(searchTiles(grid, pathProfile('land', true), false, 15, 10, 25, 10).cost).toBe(10 * REF_STRAIGHT + REF_DOOR);
    // A lone closed door on open ground: no diagonal step cuts past its corner.
    const open = emptyGrid(2);
    open.words[10 * open.width + 10] = PATH_DOOR;
    finishGrid(open);
    expect(searchTiles(open, pathProfile('land', true), false, 9, 10, 10, 11).cost).toBe(2 * REF_STRAIGHT);
    expect(searchTiles(open, pathProfile('land', true), false, 9, 9, 11, 11).cost).toBe(refDistances(new RefRules(open, 'land', true, false), 9, 9)[11 * open.width + 11]);
  });

  it('Schwimmer bleiben im Wasser, Amphibien nehmen beides, Landtiere meiden Tiefwasser', () => {
    const grid = emptyGrid(2);
    const w = grid.width;
    // A lake (x 10–40, y 10–40), deep inside, shallow at its rim.
    for (let y = 10; y <= 40; y++) for (let x = 10; x <= 40; x++) grid.words[y * w + x] = PATH_WATER | (x > 11 && x < 39 && y > 11 && y < 39 ? BLOCK_DEEP_WATER : 0);
    finishGrid(grid);
    const across = [12, 25, 38, 25] as const;
    const swimmer = searchTiles(grid, pathProfile('schwimmer', false), false, ...across);
    expect(swimmer.cost).toBe(26 * REF_STRAIGHT);
    const land = searchTiles(grid, pathProfile('land', false), false, ...across);
    expect(land.cost).toBe(REF_INF);
    const amphibian = searchTiles(grid, pathProfile('amphibie', false), false, 5, 25, 45, 25);
    expect(amphibian.cost).toBe(40 * REF_STRAIGHT);
    const walker = searchTiles(grid, pathProfile('land', false), false, 5, 25, 45, 25);
    expect(walker.cost).toBe(refDistances(new RefRules(grid, 'land', false, false), 5, 25)[25 * w + 45]);
    expect(walker.cost).toBeGreaterThan(amphibian.cost);
    // Swimmers do not leave the water.
    expect(searchTiles(grid, pathProfile('schwimmer', false), false, 25, 25, 5, 5).cost).toBe(REF_INF);
  });

  it('Licht: helle Kacheln sind für Schattenbrut gesperrt, die Startkachel nicht', () => {
    const grid = emptyGrid(2);
    const w = grid.width;
    // A lit disc of radius 6 around (30, 30) – a torch between start and goal.
    for (let y = 24; y <= 36; y++) for (let x = 24; x <= 36; x++) if ((x - 30) ** 2 + (y - 30) ** 2 <= 36) grid.words[y * w + x] = PATH_LIGHT;
    finishGrid(grid);
    const dark = searchTiles(grid, pathProfile('land', false), true, 20, 30, 40, 30);
    expect(dark.cost).toBe(refDistances(new RefRules(grid, 'land', false, true), 20, 30)[30 * w + 40]);
    expect(dark.cost).toBeGreaterThan(20 * REF_STRAIGHT);
    for (let i = 0; i < dark.result.steps; i++) expect(grid.words[(dark.result.tiles[2 * i + 1] as number) * w + (dark.result.tiles[2 * i] as number)]! & PATH_LIGHT).toBe(0);
    expect(searchTiles(grid, pathProfile('land', false), false, 20, 30, 40, 30).cost).toBe(20 * REF_STRAIGHT);
    // Standing in the light, the brood crosses the light it stands in to get out (findPath), but no other light.
    const ctx = new PathContext();
    const out = createPathResult();
    findPath(snapshotOf(grid, 'land', false, true, 30, 30, 45, 30), ctx, out);
    expect(out.status).toBe('found');
    expect(out.steps).toBe(15);
    for (let y = 44; y <= 52; y++) for (let x = 44; x <= 52; x++) if ((x - 48) ** 2 + (y - 48) ** 2 <= 16) grid.words[y * w + x] = PATH_LIGHT;
    finishGrid(grid);
    findPath(snapshotOf(grid, 'land', false, true, 30, 30, 48, 48), ctx, out);
    expect(out.status).toBe('partial');
    const last = out.steps - 1;
    expect((out.tiles[2 * last] as number - 48) ** 2 + (out.tiles[2 * last + 1] as number - 48) ** 2).toBeGreaterThan(16);
  });
});

describe('findPath: Teilpfade, Knotengrenze, Worker-Nachricht (M6-16)', () => {
  it('ein unerreichbares Ziel ergibt den Teilpfad zum nächsten Knoten, eine eingeschlossene Figur „none“', () => {
    const grid = emptyGrid(2);
    const w = grid.width;
    // The goal (50, 20) sits in a closed box.
    for (let y = 16; y <= 24; y++) for (let x = 46; x <= 54; x++) if (y === 16 || y === 24 || x === 46 || x === 54) grid.words[y * w + x] = BLOCK_SOLID;
    finishGrid(grid);
    const ctx = new PathContext();
    const out = createPathResult();
    findPath(snapshotOf(grid, 'land', false, false, 10, 20, 50, 20), ctx, out);
    expect(out.status).toBe('partial');
    const lx = out.tiles[2 * (out.steps - 1)] as number;
    const ly = out.tiles[2 * (out.steps - 1) + 1] as number;
    // A tile right outside the box: five tiles from the goal, nearer is impossible.
    expect(Math.max(Math.abs(lx - 50), Math.abs(ly - 20))).toBe(5);
    expect(Math.min(Math.abs(lx - 50), Math.abs(ly - 20))).toBe(0);
    expect(refPathCost(new RefRules(grid, 'land', false, false), 10, 20, out)).not.toBe(REF_INF);
    // Walled in on all sides: nothing nearer than the start.
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) if (y !== 2 || x !== 2) grid.words[y * w + x] = BLOCK_SOLID;
    finishGrid(grid);
    findPath(snapshotOf(grid, 'land', false, false, 2, 2, 50, 50), ctx, out);
    expect(out.status).toBe('none');
    expect(out.steps).toBe(0);
  });

  it('die Knotengrenze beendet die Suche mit einem Teilpfad', () => {
    const grid = randomGrid(7, { chunks: 2, obstacles: 0.3, levels: false, doors: false, water: false, light: false });
    const rules = new RefRules(grid, 'land', false, false);
    const ctx = new PathContext();
    const out = createPathResult();
    findPath(snapshotOf(grid, 'land', false, false, 1, 1, 62, 62, 20), ctx, out);
    expect(out.expanded).toBeLessThanOrEqual(20);
    expect(['partial', 'none']).toContain(out.status);
    if (out.steps > 0) expect(refPathCost(rules, 1, 1, out)).not.toBe(REF_INF);
  });

  it('Worker-Nachricht: kodierter Schnappschuss ergibt im Runner dasselbe Ergebnis wie im Hauptthread – in denselben Puffern hin und zurück', () => {
    // One message for every request, as the path service's pool reuses it: the arrays move to the runner and come back
    // with the answer (structured clone with transfer, like a message port), the next snapshot is written into them.
    const buffers = new PathJobBuffers();
    const runner = new PathJobRunner();
    let compared = 0;
    for (let seed = 60; seed < 68; seed++) {
      const grid = randomGrid(seed, { ...RICH, chunks: seed % 2 === 0 ? 3 : 2 });
      const rng = new Rng(seed);
      const rules = new RefRules(grid, 'land', true, true);
      const from = randomPassable(rng, rules);
      const to = randomPassable(rng, rules);
      if (from === null || to === null) continue;
      const snap = snapshotOf(grid, 'land', true, true, from[0], from[1], to[0], to[1]);
      const local = createPathResult();
      findPath(snap, new PathContext(), local);
      const sent = buffers.encode(snap);
      const words = sent.words.buffer;
      const there = structuredClone(sent, { transfer: buffers.transfer });
      // Moved, not copied: the sender's arrays are detached.
      expect(words.byteLength).toBe(0);
      const { result, transfer } = runner.run(there);
      const back = structuredClone(result, { transfer });
      const answer = createPathResult();
      decodeAnswer(back, answer);
      expect(answer.status).toBe(local.status);
      expect(answer.steps).toBe(local.steps);
      expect(answer.expanded).toBe(local.expanded);
      expect(Array.from(answer.tiles.subarray(0, answer.steps * 2))).toEqual(Array.from(local.tiles.subarray(0, local.steps * 2)));
      buffers.adopt(back);
      expect(buffers.transfer.map((b) => b.byteLength)).toEqual([back.head.byteLength, back.versions.byteLength, back.special.byteLength, back.words.byteLength, back.tiles.byteLength]);
      compared++;
    }
    expect(compared).toBeGreaterThan(4);
  });
});

describe('Hierarchie über Chunk-Portale (HPA*, M6-16)', () => {
  /**
   * Allowed excess over the optimum: the portals sit every `portalSpacingTiles` along a border and every leg stays in
   * its chunk, which costs a few per cent (measured over 178 random long paths: median 1,7 %, 90 % ≤ 3,3 %, worst 8,5 %).
   */
  const EPSILON = 0.1;

  it('lange Wege: gültig, höchstens (1 + ε) × optimal, Portalgraph aus dem Cache wiederverwendet', () => {
    const ctx = new PathContext();
    let hierarchical = 0;
    let worst = 0;
    for (let seed = 100; seed < 106; seed++) {
      const grid = randomGrid(seed, { chunks: 4, obstacles: 0.15, levels: true, doors: true, water: true, light: false });
      const rng = new Rng(seed);
      for (const [mover, opens] of [
        ['land', false],
        ['land', true],
        ['amphibie', false],
      ] as const) {
        const rules = new RefRules(grid, mover, opens, false);
        let from: [number, number] | null = null;
        let to: [number, number] | null = null;
        for (let k = 0; k < 50; k++) {
          from = randomPassable(rng, rules);
          to = randomPassable(rng, rules);
          if (from !== null && to !== null && Math.max(Math.abs(from[0] - to[0]), Math.abs(from[1] - to[1])) >= 64) break;
        }
        if (from === null || to === null) continue;
        const want = refDistances(rules, from[0], from[1])[to[1] * grid.width + to[0]] as number;
        const before = ctx.hierarchical;
        const out = createPathResult();
        findPath(snapshotOf(grid, mover, opens, false, from[0], from[1], to[0], to[1]), ctx, out);
        hierarchical += ctx.hierarchical - before;
        if (want === REF_INF) {
          expect(out.status).not.toBe('found');
          continue;
        }
        expect(out.status, `seed ${seed} ${mover}`).toBe('found');
        const cost = refPathCost(rules, from[0], from[1], out);
        expect(cost, `seed ${seed} ${mover}: Pfad gültig`).not.toBe(REF_INF);
        expect(cost).toBeGreaterThanOrEqual(want);
        worst = Math.max(worst, cost / want - 1);
        expect(cost, `seed ${seed} ${mover}`).toBeLessThanOrEqual(want * (1 + EPSILON));
      }
    }
    expect(hierarchical).toBeGreaterThan(8);
    expect(worst).toBeLessThanOrEqual(EPSILON);
    // Areas and border portals depend on chunk versions only: another request over the same chunks builds none of
    // them again, and the same request once more builds nothing at all (distance fields and legs are made on demand).
    const grid = randomGrid(100, { chunks: 4, obstacles: 0.15, levels: true, doors: true, water: true, light: false });
    const out = createPathResult();
    const again = new PathContext();
    const graph = (c: PathContext): number => c.portals.areasBuilt + c.portals.bordersBuilt;
    const all = (c: PathContext): number => graph(c) + c.portals.fieldsBuilt + c.legs.built;
    findPath(snapshotOf(grid, 'land', false, false, 2, 2, 120, 120), again, out);
    expect(graph(again)).toBeGreaterThan(0);
    const afterFirst = all(again);
    findPath(snapshotOf(grid, 'land', false, false, 2, 2, 120, 120), again, out);
    expect(all(again)).toBe(afterFirst);
    const areasAndBorders = graph(again);
    findPath(snapshotOf(grid, 'land', false, false, 3, 2, 120, 121), again, out);
    expect(graph(again)).toBe(areasAndBorders);
  });

  it('Portale: jede Engstelle einer Grenze hat eines, nur an erlaubten Übergängen; Distanzfelder sind die exakten Wege im Chunk', () => {
    const grid = randomGrid(9, { chunks: 3, obstacles: 0.2, levels: true, doors: true, water: false, light: false });
    const profile = pathProfile('land', true);
    const ctx = new PathContext();
    const out = createPathResult();
    // Long requests make the search build the portals and fields of the chunks it touches.
    findPath(snapshotOf(grid, 'land', true, false, 1, 1, 94, 94), ctx, out);
    findPath(snapshotOf(grid, 'land', true, false, 94, 1, 1, 94), ctx, out);
    const cache: PortalCache = ctx.portals;
    const rules = new RefRules(grid, 'land', true, false);
    let borders = 0;
    for (let cy = 0; cy < 3; cy++) {
      for (let cx = 0; cx < 3; cx++) {
        for (const dir of [BORDER_EAST, BORDER_SOUTH]) {
          const nx = dir === BORDER_EAST ? cx + 1 : cx;
          const ny = dir === BORDER_SOUTH ? cy + 1 : cy;
          if (nx >= 3 || ny >= 3) continue;
          const b = cache.borderOf(grid.versions[cy * 3 + cx] as number, grid.versions[ny * 3 + nx] as number, dir, profile.index);
          if (b === undefined) continue;
          borders++;
          // The legal crossings of this border by the reference rules, as runs.
          const legal: boolean[] = [];
          for (let k = 0; k < CHUNK; k++) {
            const ax = dir === BORDER_EAST ? cx * CHUNK + CHUNK - 1 : cx * CHUNK + k;
            const ay = dir === BORDER_EAST ? cy * CHUNK + k : cy * CHUNK + CHUNK - 1;
            legal.push(rules.pass(ax, ay) && rules.step(ax, ay, dir === BORDER_EAST ? 1 : 0, dir === BORDER_SOUTH ? 1 : 0) !== REF_INF);
          }
          const portals = Array.from(b.pos.subarray(0, b.count));
          for (const k of portals) expect(legal[k], `Portal ${cx},${cy} ${dir} bei ${k}`).toBe(true);
          for (let k = 0; k < CHUNK; ) {
            if (!legal[k]) {
              k++;
              continue;
            }
            let e = k;
            while (e < CHUNK && legal[e]) e++;
            expect(portals.some((p) => p >= k && p < e), `Engstelle ${k}–${e - 1} an ${cx},${cy} ${dir}`).toBe(true);
            k = e;
          }
        }
      }
    }
    expect(borders).toBeGreaterThan(4);
    let fields = 0;
    for (let cy = 0; cy < 3; cy++) {
      for (let cx = 0; cx < 3; cx++) {
        const areas = cache.areasOf(grid.versions[cy * 3 + cx] as number, profile.index);
        if (areas === undefined) continue;
        const inChunk = (x: number, y: number): boolean => x >> CHUNK_SHIFT === cx && y >> CHUNK_SHIFT === cy;
        for (let local = 0; local < CHUNK * CHUNK && fields < 12; local++) {
          const b = borderIndex(local);
          const field = b < 0 ? null : areas.fields[b];
          if (field === null || field === undefined) continue;
          const ref = refDistances(rules, cx * CHUNK + (local & CHUNK_MASK), cy * CHUNK + (local >> CHUNK_SHIFT), inChunk);
          for (let other = 0; other < CHUNK * CHUNK; other++) {
            const k = borderIndex(other);
            if (k < 0) continue;
            const want = ref[(cy * CHUNK + (other >> CHUNK_SHIFT)) * grid.width + cx * CHUNK + (other & CHUNK_MASK)] as number;
            const got = field[k] as number;
            expect(want === REF_INF ? got >= 0x3fff_ffff : got === want, `Feld ${local}→${other} in ${cx},${cy}`).toBe(true);
          }
          fields++;
        }
        // Areas: two tiles share an area exactly when they are connected inside the chunk.
        if (rules.pass(cx * CHUNK + 5, cy * CHUNK + 5)) {
          const ref = refDistances(rules, cx * CHUNK + 5, cy * CHUNK + 5, inChunk);
          const own = areas.comp[(5 << CHUNK_SHIFT) | 5] as number;
          for (let local = 0; local < CHUNK * CHUNK; local++) {
            const at = (cy * CHUNK + (local >> CHUNK_SHIFT)) * grid.width + cx * CHUNK + (local & CHUNK_MASK);
            expect(areas.comp[local] === own, `Fläche ${local} in ${cx},${cy}`).toBe((ref[at] as number) !== REF_INF);
          }
        }
      }
    }
    expect(fields).toBeGreaterThan(3);
  });

  it('Engstellen enden am Flächenwechsel: eine Höhenstufe am Rand ohne eigenes Portal wäre vom Portalgraphen abgeschnitten', () => {
    // Two chunks side by side, level 0 except a strip y 29–31 on level 1 on both sides of their border (no ramp).
    const grid = emptyGrid(2, 1);
    const w = grid.width;
    for (let y = 29; y < 32; y++) for (let x = 0; x < 64; x++) grid.words[y * w + x] = 1 << PATH_LEVEL_SHIFT;
    finishGrid(grid);
    const ctx = new PathContext();
    const tiles = ctx.tiles;
    tiles.bind(grid, pathProfile('land', false), false);
    // From the strip in the west chunk to the strip in the east chunk: the portal graph knows the way.
    expect(ctx.hierarchy.route(grid, pathProfile('land', false), tiles, false, 3, 30, 60, 30, 4096)).toBe(ROUTE_FOUND);
    expect(ctx.hierarchy.route(grid, pathProfile('land', false), tiles, false, 3, 10, 60, 10, 4096)).toBe(ROUTE_FOUND);
    // …and between the levels there is none.
    expect(ctx.hierarchy.route(grid, pathProfile('land', false), tiles, false, 3, 10, 60, 30, 4096)).toBe(ROUTE_NEAREST);
  });

  it('Distanzfelder zahlen Türen: der Weg durch die Tür in der Chunkmitte kostet die Türkosten', () => {
    // One chunk (of three) split by a wall at x = 48 with a door at y = 16; its portals lie west and east.
    const grid = emptyGrid(3, 1);
    const w = grid.width;
    for (let y = 0; y < 32; y++) grid.words[y * w + 48] = y === 16 ? PATH_DOOR : BLOCK_SOLID;
    finishGrid(grid);
    const ctx = new PathContext();
    const out = createPathResult();
    findPath(snapshotOf(grid, 'land', true, false, 2, 16, 93, 16), ctx, out);
    expect(out.status).toBe('found');
    const areas = ctx.portals.areasOf(grid.versions[1] as number, pathProfile('land', true).index);
    expect(areas).toBeDefined();
    const rules = new RefRules(grid, 'land', true, false);
    const inChunk = (x: number, y: number): boolean => x >> CHUNK_SHIFT === 1 && y >> CHUNK_SHIFT === 0;
    let checked = 0;
    for (let local = 0; local < CHUNK * CHUNK; local++) {
      const b = borderIndex(local);
      const field = b < 0 ? null : areas?.fields[b];
      if (field === null || field === undefined) continue;
      const ref = refDistances(rules, CHUNK + (local & CHUNK_MASK), local >> CHUNK_SHIFT, inChunk);
      for (let other = 0; other < CHUNK * CHUNK; other++) {
        const k = borderIndex(other);
        if (k < 0) continue;
        const want = ref[(other >> CHUNK_SHIFT) * w + CHUNK + (other & CHUNK_MASK)] as number;
        expect(want === REF_INF ? (field[k] as number) >= 0x3fff_ffff : field[k] === want).toBe(true);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    // The found path goes through the door once and stays within the hierarchy's excess over the optimum.
    let doors = 0;
    for (let i = 0; i < out.steps; i++) if (((grid.words[(out.tiles[2 * i + 1] as number) * w + (out.tiles[2 * i] as number)] as number) & PATH_DOOR) !== 0) doors++;
    expect(doors).toBe(1);
    expect(refPathCost(rules, 2, 16, out)).toBeLessThanOrEqual((refDistances(rules, 2, 16)[16 * w + 93] as number) * 1.1);
  });

  it('Caches ändern kein Ergebnis: warmer und kalter Kontext liefern dieselben Pfade und Knotenzahlen, auch an der Knotengrenze', () => {
    const grid = randomGrid(21, { chunks: 4, obstacles: 0.1, levels: true, doors: true, water: true, light: false });
    const warm = new PathContext();
    const rng = new Rng(21);
    const rules = new RefRules(grid, 'land', false, false);
    let pairs = 0;
    for (let k = 0; k < 30 && pairs < 5; k++) {
      const from = randomPassable(rng, rules);
      const to = randomPassable(rng, rules);
      if (from === null || to === null || Math.max(Math.abs(from[0] - to[0]), Math.abs(from[1] - to[1])) < 64) continue;
      pairs++;
      // The first request fills the warm context's caches; the tighter limits then replay cached legs.
      for (const maxNodes of [4096, 40, 150, 600]) {
        const a = createPathResult();
        const b = createPathResult();
        findPath(snapshotOf(grid, 'land', pairs % 2 === 0, false, from[0], from[1], to[0], to[1], maxNodes), warm, a);
        findPath(snapshotOf(grid, 'land', pairs % 2 === 0, false, from[0], from[1], to[0], to[1], maxNodes), new PathContext(), b);
        expect([a.status, a.steps, a.expanded], `Paar ${pairs}, Grenze ${maxNodes}`).toEqual([b.status, b.steps, b.expanded]);
        expect(Array.from(a.tiles.subarray(0, a.steps * 2))).toEqual(Array.from(b.tiles.subarray(0, b.steps * 2)));
        expect(a.expanded).toBeLessThanOrEqual(maxNodes);
      }
    }
    expect(pairs).toBe(5);
    expect(warm.legs.hits).toBeGreaterThan(5);
  });

  it('ein von Licht versperrtes Wegstück fällt auf die direkte Suche zurück', () => {
    const grid = emptyGrid(4, 2);
    const w = grid.width;
    // A lit band across the window except for a dark gap in the north.
    for (let y = 8; y < grid.height; y++) for (let x = 60; x < 68; x++) grid.words[y * w + x] = PATH_LIGHT;
    finishGrid(grid);
    const ctx = new PathContext();
    const out = createPathResult();
    findPath(snapshotOf(grid, 'land', false, true, 5, 50, 120, 50), ctx, out);
    expect(out.status).toBe('found');
    const rules = new RefRules(grid, 'land', false, true);
    expect(refPathCost(rules, 5, 50, out)).toBe(refDistances(rules, 5, 50)[50 * w + 120]);
  });
});

// ---------------------------------------------------------------------------------------------
// From the collision grid to the tile words
// ---------------------------------------------------------------------------------------------

const IDS = contentWorldIdTables();
const GRAS = IDS.terrain.runtimeId('gras');
const BIRKE = IDS.objects.runtimeId('baum_birke');

/** Chunks of a hand-drawn world. */
class TestChunks {
  readonly map = new Map<number, ChunkData>();
  constructor(size: number) {
    for (let cy = 0; cy < size; cy++) {
      for (let cx = 0; cx < size; cx++) {
        const c = new ChunkData(0, cx, cy);
        c.ground.fill(GRAS);
        this.map.set(packChunkId(0, cx, cy), c);
      }
    }
  }
  get(layer: Layer, cx: number, cy: number): ChunkData | undefined {
    return this.map.get(packChunkId(layer, cx, cy));
  }
  at(tx: number, ty: number): { c: ChunkData; i: number } {
    return { c: this.map.get(packChunkId(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT)) as ChunkData, i: ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK) };
  }
}

describe('Kachelwörter aus dem Kollisionsraster (M6-16)', () => {
  it('die Kollisionskategorien der Pfadwörter sind die Bits der Kollision (der Worker lädt das Kollisionsmodul nicht)', () => {
    expect(PATH_BLOCK_BITS).toBe(BLOCK_ALL);
    expect(PATH_VOID_WORD).toBe(BLOCK_VOID);
    expect(moverBlockMask('land')).toBe(BLOCK_ALL);
    expect(moverBlockMask('schwimmer')).toBe(BLOCK_ALL & ~BLOCK_DEEP_WATER);
    expect(moverBlockMask('amphibie')).toBe(BLOCK_ALL & ~BLOCK_DEEP_WATER);
    expect(moverBlockMask('flieger')).toBe(BLOCK_SOLID | BLOCK_VOID);
    for (const bit of [BLOCK_SOLID, BLOCK_OBJECT, BLOCK_HAZARD, BLOCK_DEEP_WATER, BLOCK_WALL, BLOCK_VOID]) expect(bit & ~PATH_BLOCK_BITS).toBe(0);
  });

  it('Klippen mit Rampe, Wasser, Bäume und Türen landen richtig in den Wörtern; Änderungen erneuern die Version', () => {
    const chunks = new TestChunks(2);
    // Plateau level 1 over y 0–19 (x all), cliff face below its south edge; ramp at x 10–11 on the edge row 19.
    for (let ty = 0; ty < 20; ty++) {
      for (let tx = 0; tx < 64; tx++) {
        const { c, i } = chunks.at(tx, ty);
        c.height[i] = 1;
      }
    }
    for (const tx of [10, 11]) {
      const { c, i } = chunks.at(tx, 19);
      c.flags[i] = TILE_FLAG_RAMP;
    }
    {
      const { c, i } = chunks.at(40, 40);
      c.water[i] = WATER_DEPTH_DEEP;
      const t = chunks.at(41, 40);
      t.c.object[t.i] = BIRKE;
    }
    // A door on (50, 50): the overlay makes it solid like the building's closed door.
    const doorTile = { x: 50, y: 50 };
    let doorOpen = false;
    const overlay: CollisionOverlay = { overlayAt: (_l, tx, ty) => (tx === doorTile.x && ty === doorTile.y && !doorOpen ? BLOCK_SOLID : 0) };
    const grid = new CollisionGrid({ chunks, worldTiles: 64, memo: true, overlay });
    const doors = { closedDoorAt: (_l: Layer, tx: number, ty: number) => tx === doorTile.x && ty === doorTile.y && !doorOpen, mayHaveDoors: () => true };
    const cache = new PathTileCache({ grid: () => grid, doors });
    const window = new PathGrid();
    window.reset(0, 0, 0, 2, 2);
    cache.fill(window, null, 1);
    const word = (x: number, y: number): number => window.words[y * window.width + x] as number;
    expect(word(5, 5) >> PATH_LEVEL_SHIFT & 0b111).toBe(1);
    expect(word(5, 20) & BLOCK_SOLID).toBe(0);
    expect(wordOf(grid.tileInfo(0, 5, 20))).toBe(word(5, 20));
    expect(word(10, 19) & PATH_LINK).not.toBe(0);
    expect(word(10, 20) & PATH_LINK).not.toBe(0);
    expect(word(40, 40) & (BLOCK_DEEP_WATER | PATH_WATER)).toBe(BLOCK_DEEP_WATER | PATH_WATER);
    expect(word(41, 40) & BLOCK_OBJECT).not.toBe(0);
    expect(word(50, 50) & (PATH_DOOR | BLOCK_SOLID)).toBe(PATH_DOOR);
    expect(window.special[0]).toBe(1);
    // A walker gets from the lowland onto the plateau over the ramp.
    const snap = new PathSnapshot();
    snap.grid.reset(0, 0, 0, 2, 2);
    cache.fill(snap.grid, null, 1);
    Object.assign(snap, { fromTx: 30, fromTy: 40, toTx: 30, toTy: 5, profile: pathProfile('land', false), light: false, maxNodes: 4096 });
    const out = createPathResult();
    findPath(snap, new PathContext(), out);
    expect(out.status).toBe('found');
    // Opening the door: reported like the building does, the chunk gets a new version and the word loses the door.
    const v = cache.versionOf(0, 1, 1);
    doorOpen = true;
    grid.invalidateTile(0, 50, 50);
    cache.invalidateTile(0, 50, 50);
    cache.fill(window, null, 2);
    expect(word(50, 50) & (PATH_DOOR | BLOCK_SOLID)).toBe(0);
    expect(cache.versionOf(0, 1, 1)).toBeGreaterThan(v);
    // An unchanged chunk keeps its version; a replaced chunk instance is noticed without a report.
    const v00 = cache.versionOf(0, 0, 0);
    cache.fill(window, null, 3);
    expect(cache.versionOf(0, 0, 0)).toBe(v00);
    const fresh = new ChunkData(0, 0, 0);
    fresh.ground.fill(GRAS);
    chunks.map.set(packChunkId(0, 0, 0), fresh);
    cache.fill(window, null, 4);
    expect(cache.versionOf(0, 0, 0)).toBeGreaterThan(v00);
    // Disallowed chunks are void in the window.
    cache.fill(window, (_l, cx) => cx === 0, 5);
    expect(word(40, 5)).toBe(packTileInfo(0b10_0000, 0));
    expect(window.versions[1]).toBe(0);
  });
});
