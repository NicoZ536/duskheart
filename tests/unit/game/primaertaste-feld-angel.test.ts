/**
 * Die Primärtaste für Saat, Setzling, Dünger, Gießkanne und Angel (M7-85; docs/SPIEL.md §10 „Eingabe“, §20 „Handlungen“,
 * „Angeln“; MASTERPROMPT §26 „LMB/RT“): bisher wirkten sie nur über E – die Primärtaste schlug mit ihnen zu. Jetzt führt
 * `primaryRoute` die Feld-Items zu `player.useItem` (das Item-Benutzer-Glied des Felds sät, pflanzt, düngt und gießt auf der
 * gezielten Kachel in Reichweite) und die Angel zu `reel`: der Druck benutzt sie (`player.useItem`: Auswerfen auf den
 * Zielpunkt, eine Leine in der Luft oder im Warten wird leer eingeholt), solange die Taste gehalten wird, hält `fishing.reel`
 * die Rolle (Anhauen des Bisses, Drill). Geprüft auf der echten Welt (`createSimulation`) mit dem echten Eingabeweg: Tasten →
 * `InputCommandTranslator` mit der Hand-Sonde der Sitzung → Befehle → Simulation.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CommandQueue } from '../../../src/engine/commands';
import type { EventArgs } from '../../../src/engine/events';
import { BindingSet } from '../../../src/engine/input/bindings';
import { ActionReader } from '../../../src/engine/input/reader';
import { InputState } from '../../../src/engine/input/state';
import { combatInputProbe } from '../../../src/game/combat/sample';
import { primaryRoute } from '../../../src/game/combat/weapons';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import { createFarmPlot } from '../../../src/game/farming/index';
import { canCharges, withCharges, type FarmingSystem } from '../../../src/game/farming/system';
import type { FishingSystem } from '../../../src/game/fishing/system';
import { InputCommandTranslator } from '../../../src/game/input';
import { withSlot } from '../../../src/game/inventory/bags';
import { selectHotbar } from '../../../src/game/inventory/ops';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { newStack } from '../../../src/game/items/stack';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import { WATER_DEPTH_MASK, WATER_FROZEN } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';

type Ev = EventArgs<SimEventMap>;
const CONFIG = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;

function of<K extends keyof SimEventMap>(events: readonly Ev[], type: K): SimEventMap[K][] {
  return events.filter((e) => e[0] === type).map((e) => e[1] as SimEventMap[K]);
}

/** The game on the real world, with the input path of the session (keys → translator with the hand probe → commands). */
function game() {
  const sim: Simulation = createSimulation(CONFIG);
  const sys = <T>(id: string): T => sim.system(id) as unknown as T;
  const step = (commands: readonly GameCommand[] = [], ticks = 1): Ev[] => {
    const out: Ev[] = [];
    for (let i = 0; i < ticks; i++) {
      sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
      sim.events.drain((...e) => out.push(e));
    }
    return out;
  };
  step([{ type: 'player.spawn' }], 30);
  const player = sys<PlayerSystem>('player');
  const inventory = sys<InventorySystem>('inventory');
  const input = new InputState();
  const reader = new ActionReader(input, new BindingSet());
  const translator = new InputCommandTranslator();
  translator.useProbe(combatInputProbe(sim, inventory, player));
  const queue = new CommandQueue<GameCommand>();
  /** One frame of input and one tick: the translator's commands go into the step. */
  const frame = (extra: readonly GameCommand[] = []): { sent: GameCommand[]; events: Ev[] } => {
    reader.update();
    translator.translate(reader, queue, 'player');
    input.endFrame();
    const sent: GameCommand[] = [];
    queue.drainForTick(0, (c) => sent.push(c));
    return { sent, events: step([...extra, ...sent]) };
  };
  const feet = (): { x: number; y: number } => {
    const p = { x: 0, y: 0 };
    if (!player.position(sim, p)) throw new Error('no player');
    return p;
  };
  /** Puts `count` of `item` (a watering can with `charges`) into hotbar slot 0 and selects it. */
  const hold = (item: string, count = 1, charges = 0): void => {
    const stack = newStack(inventory.bags.catalog.get(item), count);
    const sel = selectHotbar(withSlot(inventory.state, { bereich: 'schnellleiste', index: 0 }, charges > 0 ? withCharges(stack, charges) : stack), 0);
    if (!sel.ok) throw new Error('could not select the hotbar slot');
    inventory.bags.replace(sel.state);
  };
  return { sim, sys, step, frame, input, feet, hold, inventory };
}

describe('Primärtaste: Wege der Hand (primaryRoute)', () => {
  const catalog = contentItemCatalog();
  it('Saat, Setzling, Dünger und Gießkanne werden benutzt, die Angel benutzt und rollt, Werkzeuge schlagen weiter zu', () => {
    for (const id of ['saat_karotte', 'saat_weizen', 'setzling_eiche', 'kompost', 'knochenmehl', 'giesskanne']) expect(primaryRoute(catalog.get(id)), id).toBe('use');
    expect(primaryRoute(catalog.get('angel_holz'))).toBe('reel');
    for (const id of ['steinaxt', 'steinspitzhacke', 'holz']) expect(primaryRoute(catalog.get(id)), id).toBe('combat');
  });

  it('die Angel: Druck = player.useItem + fishing.reel an, gehalten nichts, Loslassen = fishing.reel aus; ein Tipp in einem Frame sendet alle drei', () => {
    const g = game();
    g.hold('angel_holz');
    g.input.mouseButtonDown(0);
    expect(g.frame().sent).toEqual([{ type: 'player.useItem' }, { type: 'fishing.reel', on: true }]);
    expect(g.frame().sent).toEqual([]);
    g.input.mouseButtonUp(0);
    expect(g.frame().sent).toEqual([{ type: 'fishing.reel', on: false }]);
    g.input.mouseButtonDown(0);
    g.input.mouseButtonUp(0);
    expect(g.frame().sent).toEqual([{ type: 'player.useItem' }, { type: 'fishing.reel', on: true }, { type: 'fishing.reel', on: false }]);
  });
});

describe('Primärtaste auf dem Feld (echte Welt)', () => {
  /** A plot on a tile right beside the player, aimed at. */
  function plotBeside(g: ReturnType<typeof game>): { tx: number; ty: number } {
    const farming = g.sys<FarmingSystem>('farming');
    const at = g.feet();
    const tx = Math.floor(at.x / TILE_PX) + 1;
    const ty = Math.floor(at.y / TILE_PX);
    farming.tilled(g.sim, 0, tx, ty, true);
    expect(farming.isPlot(0, tx, ty)).toBe(true);
    g.step([{ type: 'player.aim', x: tx * TILE_PX + TILE_PX / 2, y: ty * TILE_PX + TILE_PX / 2 }]);
    return { tx, ty };
  }

  it('Saat: die Primärtaste sät auf das gezielte Beet (ein Korn verbraucht), ein zweiter Druck dort bleibt still', () => {
    const g = game();
    const { tx, ty } = plotBeside(g);
    g.hold('saat_karotte', 3);
    g.input.mouseButtonDown(0);
    const { sent, events } = g.frame();
    g.input.mouseButtonUp(0);
    g.frame();
    expect(sent).toEqual([{ type: 'player.useItem' }]);
    expect(of(events, 'cropPlanted')).toEqual([expect.objectContaining({ tx, ty, crop: 'karotte' })]);
    expect(of(events, 'attackWindup')).toEqual([]);
    expect(g.inventory.count('saat_karotte')).toBe(2);
    const plot = createFarmPlot();
    expect(g.sys<FarmingSystem>('farming').plotAt(0, tx, ty, plot)).toBe(true);
    // The plot is sown: a second press there finds nothing to do and stays silent (no refusal, no blow).
    g.input.mouseButtonDown(0);
    const again = g.frame().events;
    g.input.mouseButtonUp(0);
    g.frame();
    expect(of(again, 'cropPlanted')).toEqual([]);
    expect(of(again, 'commandRejected')).toEqual([]);
    expect(g.inventory.count('saat_karotte')).toBe(2);
  });

  it('Gießkanne: die Primärtaste gießt das gezielte Beet (eine Ladung weniger)', () => {
    const g = game();
    const { tx, ty } = plotBeside(g);
    g.hold('giesskanne', 1, 3);
    const can = g.inventory.selected();
    const before = can === null ? 0 : canCharges(can);
    expect(before).toBe(3);
    g.input.mouseButtonDown(0);
    const { sent, events } = g.frame();
    g.input.mouseButtonUp(0);
    g.frame();
    expect(sent).toEqual([{ type: 'player.useItem' }]);
    expect(of(events, 'plotWatered')).toEqual([expect.objectContaining({ tx, ty, item: 'giesskanne' })]);
    expect(of(events, 'attackWindup')).toEqual([]);
    const after = g.inventory.selected();
    expect(after === null ? -1 : canCharges(after)).toBe(before - 1);
  });
});

describe('Primärtaste mit der Angel (echte Welt)', () => {
  /** Stands the player on a dry tile near the start beach with open water within the cast reach, aims at it; the water's centre. */
  function shore(g: ReturnType<typeof game>): { x: number; y: number } {
    const reach = BALANCE.fishing.castReachTiles;
    const at = g.feet();
    const ptx = Math.floor(at.x / TILE_PX);
    const pty = Math.floor(at.y / TILE_PX);
    let found: { stand: { tx: number; ty: number }; water: { tx: number; ty: number } } | null = null;
    const waterAt = (tx: number, ty: number): number => {
      const chunk = g.sim.world.chunks.get(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
      return chunk === undefined ? -1 : (chunk.water[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number);
    };
    for (let r = 0; r <= 40 && found === null; r++) {
      for (let dy = -r; dy <= r && found === null; dy++) {
        for (let dx = -r; dx <= r && found === null; dx++) {
          const tx = ptx + dx;
          const ty = pty + dy;
          if (waterAt(tx, ty) !== 0) continue;
          const wx = tx + Math.floor(reach) - 1;
          const w = waterAt(wx, ty);
          if (w > 0 && (w & WATER_DEPTH_MASK) !== 0 && (w & WATER_FROZEN) === 0) found = { stand: { tx, ty }, water: { tx: wx, ty } };
        }
      }
    }
    if (found === null) throw new Error('no dry tile with open water in cast reach near the start');
    g.step([{ type: 'player.teleport', x: found.stand.tx * TILE_PX + TILE_PX / 2, y: found.stand.ty * TILE_PX + TILE_PX / 2, layer: 0 }], 5);
    const water = { x: found.water.tx * TILE_PX + TILE_PX / 2, y: found.water.ty * TILE_PX + TILE_PX / 2 };
    g.step([{ type: 'player.aim', x: water.x, y: water.y }]);
    return water;
  }

  it('Auswerfen auf das gezielte Wasser, gehalten durch den Biss, loslassen und neu drücken hakt an, gehalten drillt', () => {
    const g = game();
    const fishing = g.sys<FishingSystem>('fishing');
    const water = shore(g);
    g.hold('angel_holz');
    g.input.mouseButtonDown(0);
    const cast = g.frame();
    expect(of(cast.events, 'fishCast')).toEqual([expect.objectContaining({ x: water.x, y: water.y })]);
    expect(of(cast.events, 'attackWindup')).toEqual([]);
    expect(fishing.reeling).toBe(true);
    // Held through the flight and the wait: the bite comes while the reel is held – it must be let go and pressed again.
    let bite = false;
    for (let i = 0; i < 60 * 120 && !bite; i++) bite = of(g.frame().events, 'fishBite').length > 0;
    expect(bite).toBe(true);
    expect(fishing.phase).toBe('biss');
    g.input.mouseButtonUp(0);
    g.frame();
    expect(fishing.reeling).toBe(false);
    g.input.mouseButtonDown(0);
    const hooked = g.frame().events;
    g.frame();
    expect(of(hooked, 'fishHooked').length + of(g.frame().events, 'fishHooked').length).toBe(1);
    expect(fishing.phase).toBe('drill');
    expect(fishing.reeling).toBe(true);
    g.input.mouseButtonUp(0);
    g.frame();
    expect(fishing.reeling).toBe(false);
  });

  it('eine wartende Leine holt der Druck leer ein; an trockenem Land bleibt der Druck still', () => {
    const g = game();
    const fishing = g.sys<FishingSystem>('fishing');
    shore(g);
    g.hold('angel_holz');
    // A tap casts (the reel on and off in the same frame); a press while the float waits reels the line in empty.
    g.input.mouseButtonDown(0);
    g.input.mouseButtonUp(0);
    expect(of(g.frame().events, 'fishCast')).toHaveLength(1);
    for (let i = 0; i < 60 && fishing.phase !== 'warten'; i++) g.frame();
    expect(fishing.phase).toBe('warten');
    g.input.mouseButtonDown(0);
    const reeled = g.frame().events;
    g.input.mouseButtonUp(0);
    g.frame();
    expect(of(reeled, 'castEnded')).toEqual([expect.objectContaining({ grund: 'eingeholt' })]);
    expect(of(reeled, 'fishCast')).toEqual([]);
    expect(fishing.phase).toBe('aus');
    // At the player's own (dry) tile: nothing to cast at, no refusal, no blow.
    const at = g.feet();
    g.step([{ type: 'player.aim', x: at.x, y: at.y }]);
    g.input.mouseButtonDown(0);
    const dry = g.frame().events;
    g.input.mouseButtonUp(0);
    g.frame();
    expect(of(dry, 'fishCast')).toEqual([]);
    expect(of(dry, 'commandRejected')).toEqual([]);
    expect(of(dry, 'attackWindup')).toEqual([]);
    expect(fishing.phase).toBe('aus');
  });
});
