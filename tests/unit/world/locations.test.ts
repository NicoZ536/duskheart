/**
 * M2-11 acceptance, places (MASTERPROMPT §9.2.8, §20.2, §21): location slots placed by rules –
 * distance, biome, height, reachability – only placement.
 * - 3 seeds × 3 sizes: the start beach on the south coast, six beacon sites (one per boss biome) and
 *   the Nachtherz, each with its boss arena on the same plateau; Builder vaults 3–4 per biome; every
 *   place type of §21 present in its wanted count; biome, level, islet and coast rules per type;
 *   discs keep their gap and same-type spacing; every disc is flat, dry land of one level without
 *   ramps, fords or lava; a cave mouth per entrance of the underground, at its tile.
 * - Chunks (Klein): every disc carries the place flag and no objects, cave mouths lead down.
 */
import { describe, expect, it } from 'vitest';
import { TILE_FLAG_PLACE, TILE_FLAG_STAIRS, type ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SIZE } from '../../../src/world/model/coords';
import { createTerrainSample } from '../../../src/world/gen/plan/index';
import { sampleBilinear } from '../../../src/world/gen/plan/grid';
import { MAIN_LANDMASS } from '../../../src/world/gen/plan/island';
import { generateChunk } from '../../../src/world/gen/chunk';
import { BEACON_BIOMES, LOCATION_RULES, LOCATION_TYPES, LOCATIONS, type LocationSlot } from '../../../src/world/gen/locations';
import { generateWorld, type GeneratedWorld } from '../../../src/world/gen/world';
import { createSurfaceContext } from '../../../src/world/gen/worldContext';

const SEEDS = [101, 202, 303];
const PRESETS = ['small', 'medium', 'large'] as const;
/** Three worlds of one size (Groß ≈ 0,9 s each) under parallel test load. */
const TIMEOUT_MS = 60_000;
/** Place types of §21 "Weitere Orte (≥ 18 Typen)" plus the Builder vaults. */
const MIN_PLACE_TYPES = 18;
/** Key sites and their arenas (not counted among the §21 types). */
const KEY_TYPES = new Set(['startstrand', 'leuchtfeuer', 'bossarena', 'nachtherz']);
/** Vaults per biome (§21 "Erbauer-Gewölbe: 3–4 pro Biom"). */
const VAULTS_MIN = 3;
const VAULTS_MAX = 4;

/** Tiles of a slot's disc. */
function discTiles(s: LocationSlot): [number, number][] {
  const out: [number, number][] = [];
  const r = Math.floor(s.radius);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= s.radius * s.radius) out.push([s.x + dx, s.y + dy]);
  return out;
}

describe('Orts-Slots (3 Seeds × 3 Größen)', () => {
  for (const preset of PRESETS) {
    describe(preset, () => {
      const worlds: GeneratedWorld[] = SEEDS.map((seed) => generateWorld(seed, preset));

      it('Startstrand an der Südküste, 6 Leuchtfeuer-Stätten und das Nachtherz mit Boss-Arenen', () => {
        for (const w of worlds) {
          const { plan } = w;
          const L = w.locations;
          const start = L.filter((s) => s.type === 'startstrand');
          expect(start).toHaveLength(1);
          const beach = start[0] as LocationSlot;
          expect(beach.level).toBe(0);
          expect(beach.landmass).toBe(MAIN_LANDMASS);
          expect(sampleBilinear(plan.grid, plan.coastDistance, beach.x + 0.5, beach.y + 0.5)).toBeLessThanOrEqual(LOCATIONS.startCoastTiles);
          // South: below the centre of the main island's land.
          let sumY = 0;
          let cells = 0;
          for (let c = 0; c < plan.grid.count; c++) {
            if (plan.landmass[c] !== MAIN_LANDMASS) continue;
            sumY += Math.floor(c / plan.grid.width) + 0.5;
            cells++;
          }
          expect(beach.y).toBeGreaterThan((sumY / cells) * plan.grid.cellTiles);
          expect(w.spawn).toEqual({ x: beach.x, y: beach.y });
          const beacons = L.filter((s) => s.type === 'leuchtfeuer');
          expect(beacons.map((s) => s.variant)).toEqual([...BEACON_BIOMES]);
          for (const s of beacons) {
            expect(s.biome).toBe(s.variant);
            expect(s.landmass).toBe(MAIN_LANDMASS);
            expect(s.region).not.toBe(plan.start);
          }
          const core = L.filter((s) => s.type === 'nachtherz');
          expect(core).toHaveLength(1);
          expect(core[0]?.region).toBe(plan.core);
          for (const s of [...beacons, ...core]) {
            const arena = L[s.link] as LocationSlot;
            expect(arena.type).toBe('bossarena');
            expect(arena.link).toBe(s.id);
            expect(arena.variant).toBe(s.type === 'nachtherz' ? 'nachtherz' : s.variant);
            expect(arena.level).toBe(s.level);
            expect(arena.biome).toBe(s.biome);
            expect(arena.landmass).toBe(s.landmass);
            // A short walk apart, never overlapping.
            const d = Math.hypot(arena.x - s.x, arena.y - s.y);
            expect(d).toBeGreaterThanOrEqual(s.radius + arena.radius + LOCATIONS.arenaGapTiles);
            expect(arena.radius).toBeGreaterThanOrEqual(Math.floor((s.type === 'nachtherz' ? LOCATIONS.finaleRadius : LOCATIONS.arenaRadius) * LOCATIONS.fallbackRadiusFactor));
          }
        }
      }, TIMEOUT_MS);

      it('jeder Ortstyp in gewünschter Zahl, Gewölbe 3–4 je Biom, Regeln je Typ', () => {
        for (const w of worlds) {
          const L = w.locations;
          const types = new Set(L.map((s) => s.type));
          expect(types).toEqual(new Set(LOCATION_TYPES));
          expect([...types].filter((t) => !KEY_TYPES.has(t)).length).toBeGreaterThanOrEqual(MIN_PLACE_TYPES);
          for (const [type, c] of Object.entries(w.report.locations.counts)) {
            expect(c.placed, type).toBe(c.wanted);
            expect(L.filter((s) => s.type === type)).toHaveLength(c.wanted);
          }
          const vaults = new Map<string, number>();
          for (const s of L) if (s.type === 'gewoelbe') vaults.set(s.biome, (vaults.get(s.biome) ?? 0) + 1);
          for (const biome of LOCATION_RULES.gewoelbe?.biomes ?? []) {
            expect(vaults.get(biome) ?? 0, biome).toBeGreaterThanOrEqual(VAULTS_MIN);
            expect(vaults.get(biome) ?? 0, biome).toBeLessThanOrEqual(VAULTS_MAX);
          }
          expect(vaults.has('nachtherz')).toBe(false);
          for (const s of L) {
            const rule = LOCATION_RULES[s.type];
            if (rule === undefined) continue;
            const biomes = rule.variants?.filter((v) => v.id === s.variant).map((v) => v.biome) ?? rule.biomes;
            expect(biomes, `${s.type} ${s.id}`).toContain(s.biome);
            expect(s.level).toBeGreaterThanOrEqual(rule.minLevel);
            if (!rule.islets) expect(s.landmass).toBe(MAIN_LANDMASS);
            if (rule.coastTiles > 0) expect(w.plan.coastDistance[Math.floor(s.y / w.plan.grid.cellTiles) * w.plan.grid.width + Math.floor(s.x / w.plan.grid.cellTiles)]).toBeLessThanOrEqual(rule.coastTiles);
          }
          // The three natural wonders, one of each.
          expect(L.filter((s) => s.type === 'naturwunder').map((s) => s.variant).sort()).toEqual(['geysirfeld', 'kristallbogen', 'uraltbaum']);
        }
      }, TIMEOUT_MS);

      it('Abstände: Lücke zwischen allen Scheiben, Mindestabstand je Typ', () => {
        for (const w of worlds) {
          const L = w.locations;
          for (let i = 0; i < L.length; i++) {
            const a = L[i] as LocationSlot;
            for (let j = i + 1; j < L.length; j++) {
              const b = L[j] as LocationSlot;
              const d = Math.hypot(a.x - b.x, a.y - b.y);
              expect(d, `${a.type} ${a.id} – ${b.type} ${b.id}`).toBeGreaterThanOrEqual(a.radius + b.radius + LOCATIONS.gapTiles);
              const rule = LOCATION_RULES[a.type];
              if (a.type === b.type && rule !== undefined) expect(d, `${a.type} ${a.id} – ${b.id}`).toBeGreaterThanOrEqual(Math.floor(rule.spacing * LOCATIONS.relaxedSpacingFactor));
            }
          }
        }
      }, TIMEOUT_MS);

      it('jede Scheibe ist flaches, trockenes Land einer Höhe ohne Rampen, Furten, Lava', () => {
        for (const w of worlds) {
          const ctx = createSurfaceContext(w.plan);
          const s = createTerrainSample();
          const bad: string[] = [];
          for (const slot of w.locations) {
            if (slot.type === 'brueckenruine') continue;
            const r = slot.type === 'hoehleneingang' ? LOCATIONS.caveCheckRadius : slot.radius;
            for (const [x, y] of discTiles({ ...slot, radius: r })) {
              const t = ctx.terrain.sample(x, y, s);
              if (!t.land || t.level !== slot.level || t.water !== 0 || t.flags !== 0 || ctx.lavaAt(x, y)) bad.push(`${slot.type} ${slot.id} @ ${x},${y}`);
            }
          }
          expect(bad).toEqual([]);
        }
      }, TIMEOUT_MS);

      it('ein Höhleneingang je Eingang des Untergrunds, genau an dessen Kachel', () => {
        for (const w of worlds) {
          const entrances = w.underground.links.filter((l) => l.kind === 'eingang');
          const mouths = w.locations.filter((s) => s.type === 'hoehleneingang');
          expect(mouths).toHaveLength(entrances.length);
          expect(mouths.length).toBeGreaterThan(0);
          for (const e of entrances) {
            const m = mouths.find((s) => s.link === e.id);
            expect(m).toBeDefined();
            expect([m?.x, m?.y]).toEqual([e.tx, e.ty]);
          }
          expect(w.report.locations.caveMouths).toBe(entrances.length);
        }
      }, TIMEOUT_MS);
    });
  }
});

describe('Orte in den Chunks (Klein)', () => {
  it('Ortsflächen tragen das Ortsflag und keine Objekte, Höhleneingänge führen hinab', () => {
    const w = generateWorld(20260924, 'small');
    const n = w.plan.grid.tiles / CHUNK_SIZE;
    const cache = new Map<number, ChunkData>();
    const at = (x: number, y: number): { chunk: ChunkData; i: number } => {
      const key = Math.floor(y / CHUNK_SIZE) * n + Math.floor(x / CHUNK_SIZE);
      let chunk = cache.get(key);
      if (chunk === undefined) {
        chunk = generateChunk(w, 0, Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
        cache.set(key, chunk);
      }
      return { chunk, i: (y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE) };
    };
    const bad: string[] = [];
    for (const slot of w.locations) {
      for (const [x, y] of discTiles(slot)) {
        const { chunk, i } = at(x, y);
        if (((chunk.flags[i] as number) & TILE_FLAG_PLACE) === 0) bad.push(`${slot.type} ${slot.id} @ ${x},${y}: ohne Ortsflag`);
        if (chunk.object[i] !== 0) bad.push(`${slot.type} ${slot.id} @ ${x},${y}: Objekt`);
      }
      if (slot.type === 'hoehleneingang') {
        const { chunk, i } = at(slot.x, slot.y);
        if (((chunk.flags[i] as number) & TILE_FLAG_STAIRS) === 0) bad.push(`Höhleneingang ${slot.id}: kein Abstieg`);
      }
    }
    expect(bad).toEqual([]);
  }, TIMEOUT_MS);
});
