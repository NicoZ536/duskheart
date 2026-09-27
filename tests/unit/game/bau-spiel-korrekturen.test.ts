/**
 * Review M4 – das Bauraster im echten Spiel (`createSimulation`) mit den Systemen, die neben ihm stehen:
 * - #6 Schaufel und Hacke graben nicht unter Bauten – Böden, Wände, Türen, Kisten und Blaupausen; daneben schon; unter
 *   einem Boden wird auch nichts zugeschüttet;
 * - #11 Wandmöbel und Lichter teilen keine Kachel: keine Wandlampe über einer Fackel, keine Fackel unter einer Wandlampe –
 *   und nichts geht dabei verloren;
 * - #22 eine Falltür, auf der eine Station oder eine Fackel steht, öffnet nicht.
 */
import { describe, expect, it } from 'vitest';
import type { BuildingSystem } from '../../../src/game/building/system';
import { createHarvestPlan, type GatheringSystem } from '../../../src/game/gathering/system';
import type { LightSystem } from '../../../src/game/light/system';
import type { StationSystem } from '../../../src/game/stations/system';
import { TILE_FLAG_DUG } from '../../../src/world/model/chunk';
import { BUILD_LAYER_INDEX, cellOpen } from '../../../src/world/structures/cells';
import type { Simulation } from '../../../src/game/sim';
import { BAU_SPIEL_TIMEOUT_MS, bauSpiel, eventsOf, rejections } from './bau-spielwelt';

const SHOVEL = { kind: 'schaufel', power: 1, broken: false };
/** A site of 7 × 4 tiles the shovel can dig: open meadow carries scatter, the start beach is a place. */
const DIG_SITE = { w: 7, h: 4 } as const;
const PLAN = createHarvestPlan();

/** Whether the shovel can dig tile (tx, ty) now (a site of such tiles: not the start beach, which is a place). */
function diggable(sim: Simulation, tx: number, ty: number): boolean {
  const gathering = sim.system('gathering') as unknown as GatheringSystem;
  return gathering.planTile(sim, 0, tx, ty, SHOVEL, PLAN) && PLAN.block === null && !PLAN.tooWeak;
}
import { lagerWelt } from './lager-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

describe('Review M4 im echten Spiel', { timeout: BAU_SPIEL_TIMEOUT_MS }, () => {
  it('#6: keine Schaufel unter Boden, Wand, Tür, Kiste und Blaupause – daneben schon; E gräbt dort nicht', () => {
    const g = bauSpiel(diggable, DIG_SITE);
    const gathering = g.sys<GatheringSystem>('gathering');
    const dig = (x: number, y: number): string | null => {
      const t = g.at(x, y);
      expect(gathering.planTile(g.sim, 0, t.tx, t.ty, SHOVEL, PLAN), `${x},${y}`).toBe(true);
      return PLAN.block;
    };
    const built = [
      [0, 0, 'boden_holz'],
      [2, 0, 'wand_holz'],
      [4, 0, 'tuer_holz'],
      [6, 0, 'kiste_holz'],
    ] as const;
    for (const [x, y, part] of built) expect(g.build(part, x, y), part).toEqual([]);
    expect(rejections(g.run([{ type: 'build.blueprint', part: 'wand_stein', ...g.at(0, 2) }]))).toEqual([]);
    for (const [x, y] of built) expect(dig(x, y), `${x},${y}`).toBe('builtOver');
    expect(dig(0, 2)).toBe('builtOver');
    // Beside them the ground is open (the whole site could be dug before).
    expect(dig(3, 2)).toBeNull();
    // With the shovel in hand, E on the floor digs nothing: the floor stays, the ground under it is not dug.
    g.hold('steinschaufel');
    g.stand(0, 1);
    const ev = g.run([{ type: 'player.interact', on: true, ...g.at(0, 0) }], 240);
    g.run([{ type: 'player.interact', on: false }]);
    expect([eventsOf(ev, 'tileDug'), eventsOf(ev, 'harvestHit')]).toEqual([[], []]);
    const { chunk, i } = g.chunkAt(0, 0);
    expect(((chunk.flags[i] as number) & TILE_FLAG_DUG) === 0).toBe(true);
    expect(g.sys<BuildingSystem>('building').partAt(0, 'boden', g.at(0, 0).tx, g.at(0, 0).ty)?.id).toBe('boden_holz');
  });

  it('#6: unter einem Boden auf gegrabenem Grund wird nichts zugeschüttet', () => {
    const g = bauSpiel(diggable, DIG_SITE);
    const gathering = g.sys<GatheringSystem>('gathering');
    g.hold('steinschaufel');
    g.stand(1, 2);
    const t = g.at(1, 1);
    g.run([{ type: 'player.interact', on: true, ...t }], 240);
    g.run([{ type: 'player.interact', on: false }]);
    const { chunk, i } = g.chunkAt(1, 1);
    expect(((chunk.flags[i] as number) & TILE_FLAG_DUG) !== 0).toBe(true);
    expect(gathering.refillable(g.sim, 0, t.tx, t.ty)).not.toBeNull();
    expect(g.build('boden_holz', 1, 1)).toEqual([]);
    expect(gathering.refillable(g.sim, 0, t.tx, t.ty)).toBeNull();
  });

  it('#11: keine Wandlampe über einer Fackel, keine Fackel unter einer Wandlampe – beide bleiben in den Taschen', () => {
    const g = bauSpiel();
    const light = g.sys<LightSystem>('light');
    const building = g.sys<BuildingSystem>('building');
    expect(g.build('wand_holz', 3, 2)).toEqual([]);
    expect(g.build('wand_holz', 7, 2)).toEqual([]);
    g.stand(5, 5);
    // A torch on the tile in front of the first wall (it hangs on the wall face).
    const torch = g.at(3, 3);
    g.give('fackel', 1);
    expect(rejections(g.run([{ type: 'light.place', from: g.slotOf('fackel'), tx: torch.tx, ty: torch.ty }]))).toEqual([]);
    expect(light.lightAt(0, torch.tx, torch.ty)?.kind).toBe('fackel');
    expect(g.build('harzlampe_wand', 3, 3)).toEqual(['blocked']);
    expect(building.partAt(0, 'wandobjekt', torch.tx, torch.ty)).toBeUndefined();
    expect([g.count('harzlampe_wand'), light.lightAt(0, torch.tx, torch.ty)?.kind]).toEqual([1, 'fackel']);
    // A wall lamp in front of the second wall: no torch goes under it.
    expect(g.build('harzlampe_wand', 7, 3)).toEqual([]);
    const lamp = g.at(7, 3);
    expect(light.lightAt(0, lamp.tx, lamp.ty)?.kind).toBe('harzlampe_wand');
    g.give('fackel', 1);
    const before = g.count('fackel');
    expect(rejections(g.run([{ type: 'light.place', from: g.slotOf('fackel'), tx: lamp.tx, ty: lamp.ty }]))).toEqual(['tileTaken']);
    expect([g.count('fackel'), light.lightAt(0, lamp.tx, lamp.ty)?.kind]).toEqual([before, 'harzlampe_wand']);
  });

  it('#22: eine Falltür, auf der eine Fackel oder eine Station steht, öffnet nicht; frei schon', () => {
    const g = bauSpiel();
    const building = g.sys<BuildingSystem>('building');
    const stations = g.sys<StationSystem>('stations');
    const floor = (x: number, y: number): number => building.structures.cell(0, BUILD_LAYER_INDEX.boden, g.at(x, y).tx, g.at(x, y).ty);
    for (const x of [2, 5, 8]) expect(g.build('falltuer_holz', x, 2), `trapdoor ${x}`).toEqual([]);
    g.stand(5, 5);
    g.give('fackel', 1);
    expect(rejections(g.run([{ type: 'light.place', from: g.slotOf('fackel'), ...g.at(2, 2) }]))).toEqual([]);
    g.give('werkbank', 1);
    expect(rejections(g.run([{ type: 'station.place', from: g.slotOf('werkbank'), ...g.at(5, 2) }]))).toEqual([]);
    expect(stations.stationAt(0, g.at(5, 2).tx, g.at(5, 2).ty)).toBeDefined();
    for (const x of [2, 5]) {
      expect(rejections(g.run([{ type: 'build.door', ...g.at(x, 2) }])), `trapdoor ${x}`).toEqual(['carriesLoad']);
      expect(cellOpen(floor(x, 2)), `trapdoor ${x}`).toBe(false);
    }
    expect(rejections(g.run([{ type: 'build.door', ...g.at(8, 2) }]))).toEqual([]);
    expect(cellOpen(floor(8, 2))).toBe(true);
  });
});

describe('#6 die Hacke auf bebautem Boden', () => {
  it('kein Feld unter einem Boden oder einer Blaupause; daneben schon (Grundanspruch des Bauraster)', () => {
    const w = lagerWelt(meadow(30, 20), { x: 10, y: 10 });
    // The claim createSimulation registers.
    w.gathering.addGroundClaims((layer, tx, ty) => w.building.groundBuilt(layer, tx, ty));
    const hoe = { kind: 'hacke', power: 1, broken: false };
    const plan = createHarvestPlan();
    const till = (x: number, y: number): string | null => {
      expect(w.gathering.planTile(w.sim, 0, OFFSET + x, OFFSET + y, hoe, plan), `${x},${y}`).toBe(true);
      return plan.block;
    };
    expect([till(8, 8), till(12, 8), till(10, 8)]).toEqual([null, null, null]);
    expect(w.build('boden_holz', 8, 8)).toBeNull();
    expect(w.rejection(w.act({ type: 'build.blueprint', part: 'tisch_holz', tx: OFFSET + 12, ty: OFFSET + 8 }))).toBeNull();
    expect([till(8, 8), till(12, 8), till(13, 8), till(10, 8)]).toEqual(['builtOver', 'builtOver', 'builtOver', null]);
    // A roof hangs above the ground: it claims nothing.
    expect(w.building.groundBuilt(0, OFFSET + 10, OFFSET + 8)).toBe(false);
  });
});
