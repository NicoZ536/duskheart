/**
 * The places in a generated world (M7-07 … M7-09; docs/SPIEL.md §18): in a medium world every one of the ten place types of
 * M7 gets a layout, every placement keeps the marks its effect needs, and the generated chunks carry the layout's chests on
 * their chest marks, the tower on the tower's tile, the shrine on the altar. The choice is the same for the same seed.
 * The fixture contribution of the reference save v4 (tools/save/fixtureM7/orte.ts) plays its part by commands in a small world.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../src/content/index';
import { cellsPerSide, maskBytes, revealAll } from '../../src/game/map/formulas';
import { MAP_TERRAIN, MapTerrain } from '../../src/game/map/terrain';
import { createSimulation } from '../../src/game/setup';
import { EMPTY_ORTE_FACTS, FIXTURE_MARKER_NAME, orteFacts, orteFactsSchema, playOrte } from '../../tools/save/fixtureM7/orte';
import type { PlaceDef } from '../../src/content/places/schema';
import { generateChunk } from '../../src/world/gen/chunk';
import { generateWorld } from '../../src/world/gen/world';
import type { ChunkData } from '../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT } from '../../src/world/model/coords';
import { contentWorldIdTables } from '../../src/world/model/runtimeIds';
import { WORLD_TIMEOUT_MS } from '../unit/world/weltgen-hilfen';

const SEED = 20260923;
/** The ten place types of strand B (M7-08, M7-09). */
const TYPES = ['leuchtfeuer', 'aussichtsturm', 'gehoeft', 'schrein', 'naturwunder', 'buddelstelle', 'eremitenhuette', 'brueckenruine', 'friedhof', 'meteoritenkrater'];
/** The mark each effect needs (tools/validator/orte.ts `EFFECT_MARK`). */
const EFFECT_MARK: Readonly<Record<string, string>> = { aussicht: 'aussicht', segen: 'altar', tafel: 'tafel', buddeln: 'buddel', krater: 'erz' };

describe('places in a generated world (Mittel)', () => {
  it(
    'every type of M7 has places, each with the marks of its effect; the chunks carry chests and monuments on their marks',
    () => {
      const w = generateWorld(SEED, 'medium');
      expect(w.report.problems).toEqual([]);
      const ids = contentWorldIdTables();
      const types = new Set(w.placeLayouts.map((p) => p.type));
      for (const t of TYPES) expect(types.has(t as never), t).toBe(true);
      const chunks = new Map<string, ChunkData>();
      const objectAt = (tx: number, ty: number): string | null => {
        const key = `${tx >> CHUNK_SHIFT},${ty >> CHUNK_SHIFT}`;
        let c = chunks.get(key);
        if (c === undefined) {
          c = generateChunk(w, 0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
          chunks.set(key, c);
        }
        const o = c.object[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number;
        return o === 0 ? null : ids.objects.stringId(o);
      };
      let chests = 0;
      for (const p of w.placeLayouts) {
        const def = CONTENT.collection('locationTypes').find(p.type) as PlaceDef | undefined;
        if (def === undefined || !TYPES.includes(p.type)) continue;
        const need = EFFECT_MARK[def.wirkung];
        if (need !== undefined) expect(p.markers.some((m) => m.mark === need), `${p.layout} @${p.slot}: ${need}`).toBe(true);
        for (const m of p.markers) {
          if (m.mark === 'truhe') {
            expect(objectAt(m.tx, m.ty), `${p.layout} chest`).toBe(`ort_truhe_${m.data}`);
            chests++;
          }
          if (m.mark === 'altar') expect(objectAt(m.tx, m.ty)).toBe('ort_schrein');
          if (m.mark === 'erz') expect(objectAt(m.tx, m.ty)).toBe('erz_sternenerz');
        }
      }
      expect(chests).toBeGreaterThan(10);
      // The same seed chooses the same layouts, turns and marks.
      expect(generateWorld(SEED, 'medium').placeLayouts).toEqual(w.placeLayouts);
    },
    WORLD_TIMEOUT_MS * 2,
  );
});

describe('Fixture-Beitrag „Orte & Karte“ (Referenzspielstand v4, tools/save/fixtureM7/orte.ts)', () => {
  it(
    'nur über Befehle: ein Ort entdeckt, eine Truhe offen, gereinigt mit Rückkehr-Tick, die Karte aufgedeckt mit eigenem Marker',
    () => {
      const sim = createSimulation({ seed: 3, worldSize: 'small' });
      expect(orteFacts(sim)).toEqual(EMPTY_ORTE_FACTS);
      sim.step([{ type: 'player.spawn' }]);
      playOrte(sim);
      const facts = orteFactsSchema.parse(orteFacts(sim));
      expect(facts.orte).toHaveLength(1);
      const ort = facts.orte[0];
      expect(ort).toMatchObject({ discovered: true, revealedBy: 'entdeckt', cleansed: true });
      expect(ort?.chestsOpen).toHaveLength(1);
      expect(ort?.returnTick ?? 0).toBeGreaterThan(sim.tick);
      expect(facts.karte.cells).toBeGreaterThan(100);
      expect(facts.karte.markers).toEqual([expect.objectContaining({ symbol: 'eigen_5', name: FIXTURE_MARKER_NAME, layer: 0 })]);
    },
    WORLD_TIMEOUT_MS,
  );
});

describe('Karte: Terrain der aufgedeckten Zellen (src/game/map/terrain.ts)', () => {
  it(
    'Land in der Farbe seines Bioms, Meer vor der Küste, Straßen auf ihren Zellen, Höhlen unter Tage – rein aus der Welt',
    () => {
      const w = generateWorld(SEED, 'small');
      const side = cellsPerSide(w.plan.grid.tiles, 4);
      const t = new MapTerrain(w, side, 4);
      const mask = new Uint8Array(maskBytes(side));
      revealAll(mask, side);
      // Everything at once: the budget covers every cell of the surface.
      expect(t.fill(0, mask, side * side)).toBe(0);
      const kind = t.kind(0);
      const at = (tx: number, ty: number): number => kind[Math.floor(ty / 4) * side + Math.floor(tx / 4)] as number;
      // The start beach is land; the open sea lies at the world's edge.
      expect(at(w.spawn.x, w.spawn.y)).toBeGreaterThanOrEqual(MAP_TERRAIN.land);
      expect([MAP_TERRAIN.sea, MAP_TERRAIN.shallowSea]).toContain(at(2, 2));
      // A road's middle point lies on a road cell (or water it crosses on a bridge).
      const road = w.roads.roads[0];
      if (road !== undefined) {
        const k = Math.floor(road.xs.length / 2);
        expect([MAP_TERRAIN.road, MAP_TERRAIN.deepWater, MAP_TERRAIN.shallowWater]).toContain(at(road.xs[k] as number, road.ys[k] as number));
      }
      // Several biomes, and the same terrain for the same world.
      const biomes = new Set([...kind].filter((k) => k >= MAP_TERRAIN.land));
      expect(biomes.size).toBeGreaterThan(3);
      const again = new MapTerrain(w, side, 4);
      again.fill(0, mask, side * side);
      expect(again.kind(0)).toEqual(kind);
      // Under the surface: caves and rock, a budget per call (the rest stays open).
      const open = t.fill(-1, mask, 64);
      expect(open).toBeGreaterThan(0);
      const cave = t.kind(-1).filter((k) => k === MAP_TERRAIN.cave).length;
      const rock = t.kind(-1).filter((k) => k === MAP_TERRAIN.rock).length;
      expect(cave + rock).toBeGreaterThan(0);
    },
    WORLD_TIMEOUT_MS,
  );
});
