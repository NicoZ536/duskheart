/**
 * The spawn rule of the elites (MASTERPROMPT §20.1 "Elites: seltene, stärkere Varianten"; docs/SPIEL.md §26 "Kreaturen M7":
 * "seltene Spawnregel je Biom (höchstens einer je Region, nach Sieg … Ruhe)"; M7-17, strand I). Elites come from the spawn
 * tables like every animal (src/content/creatures/elites.ts adds them to Grünhain's with a small weight); this rule – a spawn
 * veto of the creature system (`CreatureSystem.addSpawnBlocker`) and a death listener (`onDeath`), wired in
 * src/game/setup.ts – keeps them rare and alone:
 *
 * - **The lair.** Every weather region of the surface has one lair chunk: of the chunks whose centre tile lies in the region,
 *   the one with the smallest hash of world seed and chunk coordinates (found once per world, `lairs`). An elite appears only
 *   there – first population or regrowth of that chunk; nowhere else, never underground.
 * - **One per region.** While an elite lives at home in the lair – active (`CreatureSystem.store`) or frozen in the lair's
 *   stock – no second one appears there; so a region never holds two.
 * - **Rest after a victory.** When an elite dies, its lair's regrowth clock (`ChunkStock.regrowTick`, saved by the participant
 *   `creatures`) moves to `BALANCE.elites.restDays` after its death: nothing grows back in the lair for that long – the
 *   territory falls silent – and with it no new elite. No participant of its own: the rest lives in the creatures' saved
 *   stock, the lairs follow from seed and regions.
 * Deterministic: only seed, regions, the creature store and the stocks decide; a frozen lair's catch-up sees its own stock as
 * it grows (a → c equals a → b → c).
 */
import { BALANCE } from '../../content/balance';
import { HOURS_PER_DAY } from '../../engine/time';
import type { WorldSizePreset } from '../../content/balance';
import { CREATURES } from '../../content/creatures/index';
import { CHUNK_SHIFT, CHUNK_SIZE, packChunkId, type Layer } from '../../world/model/coords';
import type { Simulation } from '../sim';
import type { SpawnBlocker } from './owned';
import type { ChunkStock, CreatureState } from './state';

/** Ids of the creatures of family `elite`. */
export const ELITE_IDS: ReadonlySet<string> = new Set(CREATURES.filter((c) => c.familie === 'elite').map((c) => c.id));

/** What the rule reads of the creature system. */
export interface EliteCreatures {
  readonly store: { readonly size: number; valueAt(i: number): CreatureState };
  readonly population: { readonly stocks: ReadonlyMap<number, ChunkStock>; stockOf(layer: Layer, cx: number, cy: number, tick: number): ChunkStock };
}

/** Dependencies of the rule. */
export interface EliteRuleDeps {
  readonly seed: number;
  readonly worldSize: WorldSizePreset;
  /** Weather region of a surface tile (`SimWorld.regionAt`). */
  readonly regionAt: (tx: number, ty: number) => number;
}

/** Hash of a chunk for the choice of the lair (32-bit mix of seed and coordinates). */
export function lairHash(seed: number, cx: number, cy: number): number {
  let h = (seed ^ 0x2545f491) >>> 0;
  h = Math.imul(h ^ (cx * 0x9e3779b1), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (cy * 0xc2b2ae35), 0x27d4eb2f) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

export class EliteSpawnRule {
  /** Region → its lair chunk (packed, layer 0); built on first use. */
  private lairByRegion: Map<number, number> | null = null;
  /** Lair chunks (packed). */
  private lairSet: Set<number> | null = null;

  constructor(
    private readonly creatures: EliteCreatures,
    private readonly deps: EliteRuleDeps,
  ) {}

  /** The spawn veto: an elite only in the lair of its region, only while none lives there (`CreatureSystem.addSpawnBlocker`). */
  readonly blocker: SpawnBlocker = (_sim, layer, tx, ty, family) => family === 'elite' && this.blocks(layer, tx, ty);

  /** The death listener (`CreatureSystem.onDeath`): the lair of a fallen elite rests. */
  readonly onDeath = (sim: Simulation, creature: string): void => {
    if (!ELITE_IDS.has(creature)) return;
    const tick = sim.eventTick;
    const rest = Math.round(BALANCE.elites.restDays * HOURS_PER_DAY * sim.clock.ticksPerGameHour);
    const store = this.creatures.store;
    for (let i = 0; i < store.size; i++) {
      const s = store.valueAt(i);
      // The one that just fell (its health is 0 until the next flush removes it).
      if (s.creature !== creature || s.health > 0) continue;
      const stock = this.creatures.population.stockOf(s.layer, s.homeCx, s.homeCy, tick);
      if (stock.regrowTick < tick + rest) stock.regrowTick = tick + rest;
    }
  };

  /** The lair chunk (packed, layer 0) of the region of chunk (cx, cy), or −1 outside the world's regions. */
  lairOf(cx: number, cy: number): number {
    const region = this.deps.regionAt((cx << CHUNK_SHIFT) + (CHUNK_SIZE >> 1), (cy << CHUNK_SHIFT) + (CHUNK_SIZE >> 1));
    return this.lairs().get(region) ?? -1;
  }

  /** Whether chunk (cx, cy) of the surface is its region's lair. */
  isLair(cx: number, cy: number): boolean {
    return this.lairOf(cx, cy) === packChunkId(0, cx, cy);
  }

  /** Whether an elite lives at home in lair chunk (cx, cy) – active or in its frozen stock. */
  occupied(cx: number, cy: number): boolean {
    const store = this.creatures.store;
    for (let i = 0; i < store.size; i++) {
      const s = store.valueAt(i);
      if (s.layer === 0 && s.homeCx === cx && s.homeCy === cy && s.health > 0 && ELITE_IDS.has(s.creature)) return true;
    }
    const stock = this.creatures.population.stocks.get(packChunkId(0, cx, cy));
    if (stock !== undefined) for (const m of stock.members) if (m.health > 0 && ELITE_IDS.has(m.creature)) return true;
    return false;
  }

  private blocks(layer: Layer, tx: number, ty: number): boolean {
    if (layer !== 0) return true;
    const cx = tx >> CHUNK_SHIFT;
    const cy = ty >> CHUNK_SHIFT;
    return !this.isLair(cx, cy) || this.occupied(cx, cy);
  }

  /** Region → lair chunk, computed once: per region the chunk with the smallest `lairHash` whose centre lies in it. */
  private lairs(): Map<number, number> {
    if (this.lairByRegion !== null) return this.lairByRegion;
    const chunks = BALANCE.world.sizeTiles[this.deps.worldSize] >> CHUNK_SHIFT;
    const best = new Map<number, { hash: number; id: number }>();
    for (let cy = 0; cy < chunks; cy++) {
      for (let cx = 0; cx < chunks; cx++) {
        const region = this.deps.regionAt((cx << CHUNK_SHIFT) + (CHUNK_SIZE >> 1), (cy << CHUNK_SHIFT) + (CHUNK_SIZE >> 1));
        const hash = lairHash(this.deps.seed, cx, cy);
        const known = best.get(region);
        if (known === undefined || hash < known.hash) best.set(region, { hash, id: packChunkId(0, cx, cy) });
      }
    }
    this.lairByRegion = new Map([...best].map(([r, b]) => [r, b.id]));
    this.lairSet = new Set(this.lairByRegion.values());
    return this.lairByRegion;
  }

  /** Every lair chunk (packed, layer 0) of the world (tests, the debug view). */
  allLairs(): ReadonlySet<number> {
    this.lairs();
    return this.lairSet ?? new Set();
  }
}
