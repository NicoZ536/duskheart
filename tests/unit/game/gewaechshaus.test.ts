/**
 * M7-23 Raumtyp Gewächshaus (MASTERPROMPT §16 "Gewächshaus (Glasdach + Beete: ganzjährig)"; docs/SPIEL.md §20 "Gewächshaus"):
 * mit dem echten Bau- und Raumsystem –
 * - ein Beet (Möbelkategorie `beet`) ist Acker ohne Hacke; in einem Raum vom Typ `gewaechshaus` trägt es das Bit `geschuetzt`,
 *   im Strohdachhaus nicht;
 * - im Winter wächst die Karotte im Gewächshaus, draußen erfriert sie;
 * - eingefroren behält das Beet sein Bit und wächst beim Aufholen genauso;
 * - nimmt man das Beet, ist der Acker fort; ein Bauteil auf dem Acker überbaut ihn.
 */
import { describe, expect, it } from 'vitest';
import { FARM_BED_CATEGORY, FarmingSystem, createFarmPlot, farmSurroundings, withCharges } from '../../../src/game/farming/index';
import { newStack } from '../../../src/game/items/stack';
import { Calendar } from '../../../src/world/calendar';
import type { ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SHIFT } from '../../../src/world/model/coords';
import { bauItemCatalog, bauWelt, hut, type BauWelt } from './bau-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

const catalog = bauItemCatalog();

interface Haus {
  readonly w: BauWelt;
  readonly farming: FarmingSystem;
  active: boolean;
}

/** A closed house (inner tiles (8, 8)–(12, 11)) with `roof`, the farming system wired as in `createSimulation`. */
function haus(roof: string): Haus {
  const w = bauWelt(meadow(24, 24));
  w.spawn(10, 9);
  hut(w, 8, 8, 12, 11, 'wand_holz', 'tuer_holz', roof);
  const h: Haus = { w, farming: null as unknown as FarmingSystem, active: true };
  const chunk = (): ChunkData => w.chunks.get(0, OFFSET >> CHUNK_SHIFT, OFFSET >> CHUNK_SHIFT) as ChunkData;
  const farming = w.sim.addSystem(
    new FarmingSystem(w.sim, {
      world: { chunk: (layer, cx, cy) => w.chunks.get(layer, cx, cy), activeChunks: () => (h.active ? [chunk()] : []), regionAt: () => 0, weather: () => null },
      calendar: new Calendar(w.sim.clock),
      inventory: w.inventory,
      catalog,
      spill: () => undefined,
      surroundings: farmSurroundings(w.rooms, w.building),
    }),
  );
  w.building.addPartListener({
    placed: (s, part, layer, tx, ty) => farming.partPlaced(s, part.category === FARM_BED_CATEGORY, layer, tx, ty, part.w, part.h),
    removed: (s, part, layer, tx, ty) => farming.partRemoved(s, part.category === FARM_BED_CATEGORY, layer, tx, ty),
  });
  w.building.onChange(() => farming.surroundingsChanged());
  farming.useGround((layer, tx, ty) => w.building.groundBuilt(layer, tx, ty));
  (h as { farming: FarmingSystem }).farming = farming;
  return h;
}

function beet(h: Haus, x: number, y: number): ReturnType<typeof createFarmPlot> | null {
  const out = createFarmPlot();
  return h.farming.plotAt(0, OFFSET + x, OFFSET + y, out) ? out : null;
}

/** Sows a carrot on (x, y) and waters it. */
function karotte(h: Haus, x: number, y: number): void {
  const def = catalog.get('saat_karotte');
  expect(h.farming.sowProblem(0, OFFSET + x, OFFSET + y, def)).toBeNull();
  h.farming.sow(h.w.sim, 0, OFFSET + x, OFFSET + y, def);
  h.farming.water(h.w.sim, 0, OFFSET + x, OFFSET + y, withCharges(newStack(catalog.get('giesskanne'), 1), 5));
}

/** The next dawn: the world tick (surroundings) and, for an active chunk, the day. */
function morgen(h: Haus): void {
  const perDay = h.w.sim.clock.ticksPerDay;
  h.w.sim.skipTicks(perDay - (h.w.sim.tick % perDay));
  if (!h.active) return;
  h.farming.worldTick(h.w.sim);
  h.farming.dailyTick(h.w.sim, h.w.sim.clock.day);
}

describe('Raumtyp Gewächshaus', () => {
  it('ein Beet unter dem Glasdach macht den Raum zum Gewächshaus und trägt das Bit „geschützt“ – unter Stroh nicht', () => {
    const glas = haus('dach_glas');
    expect(glas.w.build('probe_moebel_beet', 8, 8)).toBeNull();
    expect(glas.w.roomAt(10, 9)?.type?.id).toBe('gewaechshaus');
    glas.farming.worldTick(glas.w.sim);
    expect(beet(glas, 8, 8)).toMatchObject({ sheltered: true, crop: '', fertility: 50 });
    const stroh = haus('dach_stroh');
    expect(stroh.w.build('probe_moebel_beet', 8, 8)).toBeNull();
    stroh.farming.worldTick(stroh.w.sim);
    expect(stroh.w.roomAt(10, 9)?.type).toBeNull();
    expect(beet(stroh, 8, 8)?.sheltered).toBe(false);
  });

  it('im Winter wächst die Karotte im Gewächshaus, draußen erfriert sie; eingefroren genauso', () => {
    const results: unknown[] = [];
    for (const frozen of [false, true]) {
      const h = haus('dach_glas');
      expect(h.w.build('probe_moebel_beet', 8, 8)).toBeNull();
      h.farming.tilled(h.w.sim, 0, OFFSET + 4, OFFSET + 16, true);
      h.farming.worldTick(h.w.sim);
      // Winter: day 22 on.
      h.w.sim.skipTicks(21 * h.w.sim.clock.ticksPerDay - h.w.sim.tick);
      expect(new Calendar(h.w.sim.clock).seasonOfDay(h.w.sim.clock.day)).toBe('winter');
      karotte(h, 8, 8);
      karotte(h, 4, 16);
      const from = h.w.sim.tick;
      if (frozen) h.active = false;
      morgen(h);
      morgen(h);
      if (frozen) {
        const chunk = h.w.chunks.get(0, OFFSET >> CHUNK_SHIFT, OFFSET >> CHUNK_SHIFT) as ChunkData;
        h.farming.catchUp(chunk, from, h.w.sim.tick);
      }
      const inside = beet(h, 8, 8);
      const outside = beet(h, 4, 16);
      expect(inside, frozen ? 'eingefroren' : 'aktiv').toMatchObject({ crop: 'karotte', stage: 1, dead: false, sheltered: true });
      expect(outside).toMatchObject({ crop: 'karotte', dead: true, sheltered: false });
      results.push([inside, outside]);
    }
    expect(results[1]).toEqual(results[0]);
  });

  it('nimmt man das Beet, ist der Acker fort; ein Bauteil auf dem Acker überbaut ihn', () => {
    const h = haus('dach_glas');
    expect(h.w.build('probe_moebel_beet', 8, 8)).toBeNull();
    expect(beet(h, 8, 8)).not.toBeNull();
    h.w.act({ type: 'build.remove', tx: OFFSET + 8, ty: OFFSET + 8, ebene: 'objekt' });
    expect(beet(h, 8, 8)).toBeNull();
    h.farming.tilled(h.w.sim, 0, OFFSET + 11, OFFSET + 10, true);
    expect(beet(h, 11, 10)).not.toBeNull();
    expect(h.w.build('probe_moebel_kiste', 11, 10)).toBeNull();
    expect(beet(h, 11, 10)).toBeNull();
  });
});
