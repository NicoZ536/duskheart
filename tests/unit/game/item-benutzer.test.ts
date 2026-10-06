/**
 * Item-Benutzer-Kette (M7-01, docs/SPIEL.md §17 „Haken“, ADR-0207): spätere Systeme hängen ihre Benutzungen an
 * `ToolsSystem.addItemUse`. `player.useItem` fragt sie nach den eingebauten Benutzungen (Essen, Verband, Eimer, Licht, Falle,
 * Erde) in Registrierreihenfolge, nur die, die das Item betreffen (`handles`); der erste, der nicht `pass` sagt, entscheidet –
 * benutzt (keine Ablehnung) oder abgelehnt mit seinem Grund; sagen alle `pass`, bleibt es bei `notUsable` bzw. dem Schlag der
 * Primärtaste. Der Kontext nennt Platz, Stapel, Datensatz, Ziel (genannte Kachel, sonst die gezielte, sonst keins), Tick,
 * ob die Kachel genannt war und ob es die Primärtaste ist – ein gehaltener Datensatz.
 */
import { describe, expect, it } from 'vitest';
import type { ItemDef } from '../../../src/content/schema/item';
import type { ItemUseContext, ItemUseHandler, ItemUseOutcome } from '../../../src/game/tools/itemUses';
import { ToolsSystem } from '../../../src/game/tools/system';
import type { Simulation } from '../../../src/game/sim';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { meadow } from './spieler-testwelt';

const INV_0 = { bereich: 'inventar', index: 0 } as const;

/** A handler that records its calls (a copy of the context) and answers `answer`. */
function handler(id: string, item: string | null, answer: ItemUseOutcome, calls: { id: string; ctx: ItemUseContext; same: ItemUseContext }[]): ItemUseHandler {
  return {
    id,
    handles: (def: ItemDef) => item === null || def.id === item,
    use: (_sim: Simulation, ctx: ItemUseContext) => {
      calls.push({ id, ctx: { ...ctx, target: ctx.target === null ? null : { ...ctx.target } }, same: ctx });
      return answer;
    },
  };
}

function world(aim: { x: number; y: number } | null = null): LifeWorld & { tools: ToolsSystem } {
  const w = lifeWorld(meadow(8, 6));
  const tools = w.sim.addSystem(new ToolsSystem({ player: w.player, inventory: w.inventory, interaction: { aimPoint: aim } }));
  tools.useLife(w.life);
  w.spawn(2, 2);
  return { ...w, tools };
}

function reasons(ev: Map<string, unknown[]>): string[] {
  return (ev.get('commandRejected') ?? []).map((e) => (e as { reason: string }).reason);
}

describe('ToolsSystem.addItemUse (M7-01)', () => {
  it('fragt nur betroffene Halter, in Reihenfolge; der erste, der nicht passt, entscheidet', () => {
    const w = world();
    const calls: { id: string; ctx: ItemUseContext; same: ItemUseContext }[] = [];
    w.tools.addItemUse(handler('fremd', 'holz', 'used', calls));
    w.tools.addItemUse(handler('passt', 'stein', 'pass', calls));
    w.tools.addItemUse(handler('nimmt', 'stein', 'used', calls));
    w.tools.addItemUse(handler('danach', null, { reject: 'outOfReach' }, calls));
    w.inventory.give(w.sim, 'stein', 3);
    const ev = w.run(1, [{ type: 'player.useItem', slot: INV_0 }]);
    expect(reasons(ev)).toEqual([]);
    expect(calls.map((c) => c.id)).toEqual(['passt', 'nimmt']);
    const ctx = calls[1]?.ctx;
    expect(ctx?.slot).toEqual(INV_0);
    expect(ctx?.stack).toEqual({ item: 'stein', count: 3 });
    expect(ctx?.def.id).toBe('stein');
    expect(ctx?.tick).toBe(w.sim.tick - 1);
    expect(ctx?.target).toBeNull();
    expect(ctx?.named).toBe(false);
    expect(ctx?.primary).toBe(false);
    // The handler decides what is used up; the tools system takes nothing itself.
    expect(w.inventory.count('stein')).toBe(3);
  });

  it('eine Ablehnung des Halters ist die Ablehnung des Befehls; sagen alle pass, bleibt notUsable', () => {
    const w = world();
    const calls: { id: string; ctx: ItemUseContext; same: ItemUseContext }[] = [];
    w.tools.addItemUse(handler('weigert', 'stein', { reject: 'outOfReach' }, calls));
    w.inventory.give(w.sim, 'stein', 1);
    expect(reasons(w.run(1, [{ type: 'player.useItem', slot: INV_0 }]))).toEqual(['outOfReach']);
    const v = world();
    v.tools.addItemUse(handler('passt', null, 'pass', []));
    v.inventory.give(v.sim, 'stein', 1);
    expect(reasons(v.run(1, [{ type: 'player.useItem', slot: INV_0 }]))).toEqual(['notUsable']);
  });

  it('die eingebauten Benutzungen gehen vor: Essen erreicht keinen Halter', () => {
    const w = world();
    const calls: { id: string; ctx: ItemUseContext; same: ItemUseContext }[] = [];
    w.tools.addItemUse(handler('alles', null, 'used', calls));
    w.inventory.give(w.sim, 'himbeeren', 2);
    const ev = w.run(1, [{ type: 'player.useItem', slot: INV_0 }]);
    expect(ev.get('activityStarted')).toEqual([expect.objectContaining({ action: 'essen', item: 'himbeeren' })]);
    expect(calls).toEqual([]);
  });

  it('Ziel: die genannte Kachel (named), sonst die gezielte, sonst keins; die Primärtaste wird gemeldet', () => {
    const w = world({ x: 100.5, y: 40.25 });
    const calls: { id: string; ctx: ItemUseContext; same: ItemUseContext }[] = [];
    w.tools.addItemUse(handler('ziel', 'stein', 'used', calls));
    w.inventory.give(w.sim, 'stein', 1);
    w.run(1, [{ type: 'player.useItem', slot: INV_0, tx: 7, ty: 9 }]);
    w.run(1, [{ type: 'player.useItem', slot: INV_0 }]);
    // Into the hand (the selected hotbar slot) for the primary button.
    w.run(1, [{ type: 'inventory.move', from: INV_0, to: { bereich: 'schnellleiste', index: 0 } }]);
    expect(w.inventory.selected()?.item).toBe('stein');
    w.run(1, [{ type: 'player.useItem' }]);
    expect(calls.map((c) => [c.ctx.target, c.ctx.named, c.ctx.primary])).toEqual([
      [{ layer: 0, tx: 7, ty: 9 }, true, false],
      [{ layer: 0, tx: 6, ty: 2 }, false, false],
      [{ layer: 0, tx: 6, ty: 2 }, false, true],
    ]);
    // One held record for every use (no allocation per use).
    expect(new Set(calls.map((c) => c.same)).size).toBe(1);
  });

  it('ohne Zielpunkt kein Ziel; Tote fragen keinen Halter; doppelte Ids sind ein Fehler', () => {
    const w = world();
    const calls: { id: string; ctx: ItemUseContext; same: ItemUseContext }[] = [];
    w.tools.addItemUse(handler('ziel', 'stein', 'used', calls));
    expect(() => w.tools.addItemUse(handler('ziel', null, 'pass', []))).toThrow(/already registered/);
    w.inventory.give(w.sim, 'stein', 1);
    w.run(1, [{ type: 'player.useItem', slot: INV_0 }]);
    expect(calls[0]?.ctx.target).toBeNull();
    w.vit().health = 0;
    expect(reasons(w.run(1, [{ type: 'player.useItem', slot: INV_0 }]))).toEqual(['dead']);
    expect(calls).toHaveLength(1);
  });
});
