/**
 * M5-64: the Salzküste's showcase shows the coast (src/render/world/showcase.ts, `SHOWCASE_COAST`) – beach and surf,
 * not the dune forest inland. The view (≈ 30 × 17 tiles around the window's centre) holds sea cells and the biome's
 * land, its centre is the biome's land within the beach's reach of the sea; the other biomes keep their land-only
 * windows (no sea in the window or its margin). The biome series stands the player where the interaction offers
 * nothing (`nothingInReach`, src/debug/biomScenarios.ts): on the coast's beach no tile has two clear tiles around it,
 * so the reach is measured as the interaction measures it – footprints from their anchor east and north, water tiles.
 */
import { describe, expect, it } from 'vitest';
import { BIOMES } from '../../../src/content/biomes';
import { BALANCE } from '../../../src/content/balance';
import { nothingInReach } from '../../../src/debug/biomScenarios';
import { FOOTPRINT_MAX_TILES, WORLD_OBJECTS } from '../../../src/content/worldObjects';
import { SHOWCASE_COAST, SHOWCASE_WINDOW, surfaceShowcase } from '../../../src/render/world/showcase';
import { GROUND } from '../../../src/world/gen/chunkGround';
import { generateWorld, type GeneratedWorld } from '../../../src/world/gen/world';

/** The worlds of the pictures: the biome series' session (medium) and the world debug scenes' (small). */
const WORLDS: ReadonlyArray<readonly [number, 'small' | 'medium']> = [
  [20260923, 'medium'],
  [20260924, 'small'],
];
/** Half the view [tiles] (480 × 270 px internal). */
const VIEW_HALF = { x: 15, y: 8 } as const;

const worlds = new Map<string, GeneratedWorld>();
function world(seed: number, size: 'small' | 'medium'): GeneratedWorld {
  const key = `${seed}:${size}`;
  let w = worlds.get(key);
  if (w === undefined) {
    w = generateWorld(seed, size);
    worlds.set(key, w);
  }
  return w;
}

function cellOf(w: GeneratedWorld, tx: number, ty: number): number {
  const g = w.plan.grid;
  return Math.floor(ty / g.cellTiles) * g.width + Math.floor(tx / g.cellTiles);
}

/** A world object with the widest footprint (two tiles: the oak, big rocks). */
const WIDE_OBJECT = WORLD_OBJECTS.find((o) => o.footprint.w === FOOTPRINT_MAX_TILES)?.id ?? '';

const isSea = (w: GeneratedWorld, c: number): boolean => w.plan.land[c] !== 1 && (w.plan.region[c] as number) < 0;
const biomeOf = (w: GeneratedWorld, c: number): string | undefined => {
  const r = w.plan.region[c] as number;
  return r < 0 ? undefined : w.plan.regions[r]?.biome;
};

describe('M5-64: das Salzküsten-Schaufenster zeigt Strand und Brandung', { timeout: 120_000 }, () => {
  it('die Salzküste ist ein Küstenbiom', () => {
    expect(SHOWCASE_COAST.biomes).toContain('salzkueste');
    expect(SHOWCASE_COAST.seaMax).toBeLessThanOrEqual((SHOWCASE_WINDOW.cellsW * SHOWCASE_WINDOW.cellsH) / 2);
  });

  for (const [seed, size] of WORLDS) {
    it(`Welt ${seed} (${size}): Meer und Salzküstenland im Bild, die Mitte auf Land in Strandweite des Meeres`, () => {
      const w = world(seed, size);
      const spot = surfaceShowcase(w, 'salzkueste');
      const centre = cellOf(w, spot.tx, spot.ty);
      expect(biomeOf(w, centre)).toBe('salzkueste');
      expect(w.plan.land[centre]).toBe(1);
      let sea = 0;
      let land = 0;
      for (let ty = spot.ty - VIEW_HALF.y; ty <= spot.ty + VIEW_HALF.y; ty++) {
        for (let tx = spot.tx - VIEW_HALF.x; tx <= spot.tx + VIEW_HALF.x; tx++) {
          const c = cellOf(w, tx, ty);
          if (isSea(w, c)) sea++;
          else if (biomeOf(w, c) === 'salzkueste') land++;
          else throw new Error(`fremdes Biom ${biomeOf(w, c) ?? '?'} bei ${tx},${ty}`);
        }
      }
      const tiles = (2 * VIEW_HALF.x + 1) * (2 * VIEW_HALF.y + 1);
      // Sea (surf) and land (beach, dunes) both fill a good part of the picture.
      expect(sea / tiles).toBeGreaterThan(0.1);
      expect(land / tiles).toBeGreaterThan(0.4);
      // The beach (the sand band along the sea, at least `beachTiles − beachVariationTiles` wide) reaches into the view.
      let nearest = Number.POSITIVE_INFINITY;
      for (let ty = spot.ty - VIEW_HALF.y; ty <= spot.ty + VIEW_HALF.y; ty++) {
        for (let tx = spot.tx - VIEW_HALF.x; tx <= spot.tx + VIEW_HALF.x; tx++) {
          const d = w.plan.coastDistance[cellOf(w, tx, ty)] as number;
          if (d >= 0) nearest = Math.min(nearest, d);
        }
      }
      expect(nearest).toBeLessThan(GROUND.beachTiles - GROUND.beachVariationTiles);
      expect(surfaceShowcase(w, 'salzkueste')).toEqual(spot);
    });
  }

  it('die anderen Biome behalten ihr Fenster nur aus eigenem Land (kein Meer in Fenster und Rand)', () => {
    const w = world(20260923, 'medium');
    const g = w.plan.grid;
    const { cellsW, cellsH, margin } = SHOWCASE_WINDOW;
    for (const b of BIOMES) {
      if (b.layer !== 0 || SHOWCASE_COAST.biomes.includes(b.id)) continue;
      let spot;
      try {
        spot = surfaceShowcase(w, b.id);
      } catch {
        continue;
      }
      const wx = Math.round(spot.tx / g.cellTiles - cellsW / 2);
      const wy = Math.round(spot.ty / g.cellTiles - cellsH / 2);
      for (let y = wy - margin; y < wy + cellsH + margin; y++) {
        for (let x = wx - margin; x < wx + cellsW + margin; x++) {
          const c = y * g.width + x;
          expect(w.plan.land[c], `${b.id} ${x},${y}`).toBe(1);
          expect(biomeOf(w, c), `${b.id} ${x},${y}`).toBe(b.id);
        }
      }
    }
  });
});

describe('M5-64: Standplatz der Biom-Serie ohne Interaktionsziel in Reichweite', () => {
  /** A meadow on level 0 with the given objects (anchor → id) and water tiles. */
  function world(objects: ReadonlyArray<readonly [number, number, string]>, water: ReadonlyArray<readonly [number, number]> = []) {
    const obj = new Map(objects.map(([x, y, id]) => [`${x},${y}`, id]));
    const wet = new Set(water.map(([x, y]) => `${x},${y}`));
    return {
      groundAt: (x: number, y: number) => ({ terrain: 'gras', level: 0, water: wet.has(`${x},${y}`), solid: false }),
      objectAt: (x: number, y: number) => obj.get(`${x},${y}`) ?? '',
    };
  }
  const reach = BALANCE.interaction.reachTiles;

  it('die Reichweite ist die der Interaktion (1,5 Kacheln von den Füßen bis zum Rand des Ziels)', () => {
    expect(reach).toBe(1.5);
    expect(nothingInReach(world([]), 0, 0)).toBe(true);
    // A one-tile plant two tiles west: its edge 1.5 tiles from the feet – in reach; one row further down it is not.
    expect(nothingInReach(world([[-2, 0, 'pflanze_strandhafer']]), 0, 0)).toBe(false);
    expect(nothingInReach(world([[-2, 1, 'pflanze_strandhafer']]), 0, 0)).toBe(true);
    expect(nothingInReach(world([[2, 2, 'pflanze_strandhafer']]), 0, 0)).toBe(true);
    // Water (a drink target) likewise.
    expect(nothingInReach(world([], [[0, 2]]), 0, 0)).toBe(false);
    expect(nothingInReach(world([], [[1, 2]]), 0, 0)).toBe(true);
  });

  it('ein Objekt mit breiter Grundfläche reicht von seinem Anker nach Osten in die Reichweite', () => {
    const wide = WIDE_OBJECT;
    expect(wide).not.toBe('');
    // Anchored three tiles west, two wide: its east edge lies 1.5 tiles from the feet – as close as a plant two tiles west.
    expect(nothingInReach(world([[-3, 0, wide]]), 0, 0)).toBe(false);
    expect(nothingInReach(world([[-4, 0, wide]]), 0, 0)).toBe(true);
    // East of the player the anchor itself must be two tiles away.
    expect(nothingInReach(world([[2, 0, wide]]), 0, 0)).toBe(false);
    expect(nothingInReach(world([[3, 0, wide]]), 0, 0)).toBe(true);
  });

  it('die Nachbarn müssen offen und auf derselben Stufe sein; fehlt ein Chunk, ist die Antwort offen', () => {
    const cliff = { ...world([]), groundAt: (x: number, y: number) => ({ terrain: 'gras', level: x === 1 && y === 0 ? 1 : 0, water: false, solid: false }) };
    expect(nothingInReach(cliff, 0, 0)).toBe(false);
    const missing = { ...world([]), groundAt: (x: number) => (x > 2 ? null : { terrain: 'gras', level: 0, water: false, solid: false }) };
    expect(nothingInReach(missing, 0, 0)).toBeNull();
  });
});
