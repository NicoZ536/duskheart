/**
 * Die Kopplungen der Systeme in `createSimulation` (src/game/setup.ts, ADR-0028) auf der echten Welt:
 * - Sammeln und Handwerk geben Erfahrung an die Fertigkeiten (`gathering.setExperience`,
 *   `crafting.useSkills`, §23.2 "EP-Quellen Sammeln/Handwerk");
 * - wer mit einem laufenden Handwerks-Auftrag stirbt, findet dessen reservierte Zutaten im Grab
 *   (`death.onDying` → `crafting.cancelAll`, §11.6 "Grab mit dem Inventar");
 * - jede Tile-Änderung erreicht die Verdeckung der Lichtkarte (`WorldCollision.addChangeListener`, §12.1
 *   "bei Bauänderung invalidiert");
 * - ein brennendes Lagerfeuer wärmt den Spieler (`addHeatSources`, §11.2) und senkt nachts die Furcht (die
 *   Furcht liest die Lichtkarte, §12.3), ohne Feuer steigt sie.
 */
import { describe, expect, it, vi } from 'vitest';
import type { EventArgs } from '../../../src/engine/events';
import type { CraftingSystem } from '../../../src/game/crafting/system';
import type { DeathSystem } from '../../../src/game/death/system';
import type { FearSystem } from '../../../src/game/fear/system';
import { createHarvestPlan, createObjectHit, type GatheringSystem } from '../../../src/game/gathering/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import type { LightSystem } from '../../../src/game/light/system';
import type { WorldCollision } from '../../../src/game/player/collision';
import type { PlayerSystem } from '../../../src/game/player/system';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import type { SkillsSystem } from '../../../src/game/skills/system';
import { TILE_PX } from '../../../src/world/model/coords';

const CONFIG = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
type Ev = EventArgs<SimEventMap>;
/** Farthest the tests look around the start beach [tiles]. */
const SEARCH = 60;

function game(): { sim: Simulation; run: (commands?: readonly GameCommand[], ticks?: number) => Ev[]; sys: <T>(id: string) => T; tile: () => { tx: number; ty: number } } {
  const sim = createSimulation(CONFIG);
  const run = (commands: readonly GameCommand[] = [], ticks = 1): Ev[] => {
    const out: Ev[] = [];
    for (let i = 0; i < ticks; i++) {
      sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
      sim.events.drain((...e) => out.push(e));
    }
    return out;
  };
  const sys = <T>(id: string): T => sim.system(id) as unknown as T;
  const tile = (): { tx: number; ty: number } => {
    const at = { x: 0, y: 0 };
    if (!sys<PlayerSystem>('player').position(sim, at)) throw new Error('no player');
    return { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
  };
  run([{ type: 'player.spawn' }], 30);
  return { sim, run, sys, tile };
}

function of<K extends keyof SimEventMap>(events: readonly Ev[], type: K): SimEventMap[K][] {
  return events.filter((e) => e[0] === type).map((e) => e[1] as SimEventMap[K]);
}

describe('Kopplungen von createSimulation', () => {
  it('Sammeln von Hand gibt Sammel-EP, ein fertiges Stück Handwerk-EP', () => {
    const g = game();
    const gathering = g.sys<GatheringSystem>('gathering');
    const hit = createObjectHit();
    const plan = createHarvestPlan();
    const me = g.tile();
    let target: { tx: number; ty: number } | null = null;
    for (let r = 1; r <= SEARCH && target === null; r++) {
      for (let dy = -r; dy <= r && target === null; dy++) {
        for (let dx = -r; dx <= r && target === null; dx++) {
          const tx = me.tx + dx;
          const ty = me.ty + dy;
          if (!gathering.objectAt(0, tx, ty, hit) || hit.tx !== tx || hit.ty !== ty) continue;
          if (gathering.planObject(g.sim, hit, null, plan) && plan.block === null && plan.byHand && g.sys<WorldCollision>('world-collision').grid.tileInfo(0, tx, ty + 1) === 0) target = { tx, ty };
        }
      }
    }
    if (target === null) throw new Error('nothing to pick by hand near the start beach');
    g.run([{ type: 'player.teleport', x: target.tx * TILE_PX + TILE_PX / 2, y: (target.ty + 1) * TILE_PX + TILE_PX / 2, layer: 0 }], 5);
    const picked = g.run([{ type: 'player.interact', on: true, tx: target.tx, ty: target.ty }], 60);
    expect(of(picked, 'harvested')).toHaveLength(1);
    expect(of(picked, 'xpGained').some((x) => x.skill === 'sammeln')).toBe(true);
    expect(g.sys<SkillsSystem>('skills').skill('sammeln').xp).toBeGreaterThan(0);

    g.run([{ type: 'player.interact', on: false }, { type: 'inventory.give', item: 'fasern', count: 3 }]);
    const crafted = g.run([{ type: 'craft.start', recipe: 'rezept_faserseil', count: 1 }], 600);
    expect(of(crafted, 'craftCompleted')).toHaveLength(1);
    expect(of(crafted, 'xpGained').some((x) => x.skill === 'handwerk')).toBe(true);
  });

  it('der Tod mitten im Handwerk: die reservierten Zutaten liegen im Grab', () => {
    const g = game();
    g.run([{ type: 'inventory.give', item: 'fasern', count: 3 }]);
    g.run([{ type: 'craft.start', recipe: 'rezept_faserseil', count: 1 }], 2);
    const crafting = g.sys<CraftingSystem>('crafting');
    expect(crafting.orders).toHaveLength(1);
    expect(g.sys<InventorySystem>('inventory').count('fasern')).toBe(0);
    const died = g.run([{ type: 'death.kill' }], 3);
    expect(of(died, 'craftCancelled')).toEqual([expect.objectContaining({ recipe: 'rezept_faserseil' })]);
    expect(crafting.orders).toEqual([]);
    const graves = g.sys<DeathSystem>('death').state.graves;
    expect(graves).toHaveLength(1);
    expect(graves[0]?.items).toEqual([expect.objectContaining({ item: 'fasern', count: 3 })]);
  });

  it('eine gegrabene Kachel erreicht die Verdeckung der Lichtkarte', () => {
    const g = game();
    const light = g.sys<LightSystem>('light');
    const spy = vi.spyOn(light, 'invalidateTile');
    const gathering = g.sys<GatheringSystem>('gathering');
    const plan = createHarvestPlan();
    const me = g.tile();
    let dig: { tx: number; ty: number } | null = null;
    for (let r = 1; r <= SEARCH && dig === null; r++) {
      for (let dy = -r; dy <= r && dig === null; dy++) {
        for (let dx = -r; dx <= r && dig === null; dx++) {
          const tx = me.tx + dx;
          const ty = me.ty + dy;
          if (gathering.planTile(g.sim, 0, tx, ty, { kind: 'schaufel', power: 1, broken: false }, plan) && plan.block === null && g.sys<WorldCollision>('world-collision').grid.tileInfo(0, tx, ty + 1) === 0) dig = { tx, ty };
        }
      }
    }
    if (dig === null) throw new Error('nothing diggable near the start beach');
    g.run([{ type: 'inventory.give', item: 'steinschaufel', count: 1 }]);
    g.run([{ type: 'player.teleport', x: dig.tx * TILE_PX + TILE_PX / 2, y: (dig.ty + 1) * TILE_PX + TILE_PX / 2, layer: 0 }], 5);
    const dug = g.run([{ type: 'player.interact', on: true, tx: dig.tx, ty: dig.ty }], 300);
    expect(of(dug, 'tileDug')).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith(0, dig.tx, dig.ty);
  });

  it('nachts: am brennenden Lagerfeuer warm und die Furcht sinkt; ohne Feuer steigt sie', () => {
    const night = (withFire: boolean): { heatC: number; fearBefore: number; fearAfter: number } => {
      const g = game();
      g.run([{ type: 'setTime', hour: 22, minute: 0 }, { type: 'fear.set', value: 30 }], 2);
      if (withFire) {
        g.run([{ type: 'inventory.give', item: 'lagerfeuer', count: 1 }, { type: 'inventory.give', item: 'holz', count: 6 }]);
        const inv = g.sys<InventorySystem>('inventory');
        const at = inv.state.schnellleiste.findIndex((s) => s?.item === 'lagerfeuer');
        const from = at >= 0 ? { bereich: 'schnellleiste' as const, index: at } : { bereich: 'inventar' as const, index: inv.state.inventar.findIndex((s) => s?.item === 'lagerfeuer') };
        g.run([{ type: 'inventory.move', from, to: { bereich: 'schnellleiste', index: 4 } }, { type: 'player.selectHotbar', index: 4 }]);
        const me = g.tile();
        let placed: { light: number; tx: number; ty: number } | undefined;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          placed = of(g.run([{ type: 'player.aim', x: (me.tx + dx) * TILE_PX + 8, y: (me.ty + dy) * TILE_PX + 8 }, { type: 'player.useItem' }]), 'lightPlaced')[0];
          if (placed !== undefined) break;
        }
        if (placed === undefined) throw new Error('camp fire could not be placed');
        const wood = inv.state.inventar.findIndex((s) => s?.item === 'holz');
        g.run([{ type: 'light.fuel', light: placed.light, from: wood >= 0 ? { bereich: 'inventar', index: wood } : { bereich: 'schnellleiste', index: inv.state.schnellleiste.findIndex((s) => s?.item === 'holz') } }]);
        expect(of(g.run([{ type: 'light.ignite', tx: placed.tx, ty: placed.ty }]), 'lightIgnited')).toHaveLength(1);
      }
      const fear = g.sys<FearSystem>('fear');
      const fearBefore = fear.state.value;
      g.run([], 600);
      const v = g.sys<PlayerSystem>('player').vitalsOf(g.sim.player);
      return { heatC: v?.heatC ?? 0, fearBefore, fearAfter: fear.state.value };
    };
    const warm = night(true);
    expect(warm.heatC).toBeGreaterThan(10);
    expect(warm.fearAfter).toBeLessThan(warm.fearBefore);
    const dark = night(false);
    expect(dark.heatC).toBe(0);
    expect(dark.fearAfter).toBeGreaterThan(dark.fearBefore);
  });
});
