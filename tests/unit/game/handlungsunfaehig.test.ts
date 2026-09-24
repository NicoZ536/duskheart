/**
 * M3-Gate: Wer tot ist oder schläft, handelt nicht (MASTERPROMPT §11.5 „Schlaf“, §11.6 „Tod“). In der
 * ganzen Simulation (`createSimulation`) fällt ein Schlafender oder eine Leiche keinen Baum, benutzt nichts,
 * stellt kein Licht auf, zündet keins an, stellt nichts her, und der Magnet zieht nichts in ihre Taschen;
 * jeder abgelehnte Befehl nennt den Grund (`asleep`, `dead`). Eine Bewegungstaste weckt, danach wirkt E wieder.
 */
import { describe, expect, it } from 'vitest';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import type { DeathSystem } from '../../../src/game/death/system';
import type { DropSystem } from '../../../src/game/drops/system';
import { createObjectHit, type GatheringSystem } from '../../../src/game/gathering/system';
import type { InteractionSystem } from '../../../src/game/interaction/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import type { SleepSystem } from '../../../src/game/sleep/system';
import { TILE_PX } from '../../../src/world/model/coords';

/** Welt mit Kiefern nahe dem Startstrand (dieselbe wie der Tag-1-Test). */
const CONFIG = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** Suchradius um den Startstrand für einen Baum [Kacheln]. */
const SEARCH = 40;
/** So lange hält der Test E [Ticks]: mehr als die 5 Axthiebe eines Grünhain-Baums (2,5 s, §D). */
const HOLD_TICKS = 240;

interface Probe {
  readonly sim: Simulation;
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  readonly interaction: InteractionSystem;
  readonly sleep: SleepSystem;
  readonly drops: DropSystem;
  /** Kachel des Spielers (unter einem Baum) und das Grasbett, das dort liegt, solange `bed` gilt. */
  readonly tile: { readonly tx: number; readonly ty: number };
  bed: boolean;
  send(cmd: GameCommand): void;
  /** Tickt `n` Mal; liefert die Ereignistypen und die Ablehnungen `typ:grund`. */
  run(n: number): string[];
}

/** Spieler unter einem Baum, Steinaxt in der Hand, Fackel und Fasern in den Taschen, ein Grasbett unter sich. */
function probe(): Probe {
  const sim = createSimulation(CONFIG);
  const events: string[] = [];
  const step = (n: number): string[] => {
    events.length = 0;
    for (let i = 0; i < n; i++) {
      sim.step();
      sim.events.drain((type, payload) => {
        const p = payload as { type?: string; reason?: string };
        events.push(type === 'commandRejected' ? `${p.type ?? ''}:${p.reason ?? ''}` : type);
      });
    }
    return [...events];
  };
  const send = (cmd: GameCommand): void => sim.commands.push(parseGameCommand(cmd));
  const player = sim.system('player') as unknown as PlayerSystem;
  const gathering = sim.system('gathering') as unknown as GatheringSystem;
  send({ type: 'player.spawn' });
  step(1);
  const at = { x: 0, y: 0 };
  player.position(sim, at);
  const px = Math.floor(at.x / TILE_PX);
  const py = Math.floor(at.y / TILE_PX);
  const hit = createObjectHit();
  let tree: { tx: number; ty: number } | null = null;
  for (let r = 1; r < SEARCH && tree === null; r++) {
    for (let dy = -r; dy <= r && tree === null; dy++) {
      for (let dx = -r; dx <= r && tree === null; dx++) {
        if (gathering.objectAt(0, px + dx, py + dy, hit) && hit.rule?.standing?.action === 'faellen' && hit.tx === px + dx && hit.ty === py + dy) tree = { tx: hit.tx, ty: hit.ty };
      }
    }
  }
  if (tree === null) throw new Error('kein Baum nahe dem Startstrand');
  const tile = { tx: tree.tx, ty: tree.ty + 1 };
  send({ type: 'player.teleport', x: tile.tx * TILE_PX + TILE_PX / 2, y: tile.ty * TILE_PX + TILE_PX / 2, layer: 0 });
  step(1);
  const sleep = sim.system('sleep') as unknown as SleepSystem;
  const p: Probe = {
    sim,
    player,
    inventory: sim.system('inventory') as unknown as InventorySystem,
    interaction: sim.system('interaction') as unknown as InteractionSystem,
    sleep,
    drops: sim.system('drops') as unknown as DropSystem,
    tile,
    bed: true,
    send,
    run: step,
  };
  sleep.addSleepPlaces((_s, layer, tx, ty) => (p.bed && tx === tile.tx && ty === tile.ty ? { kind: 'grasbett', x: tile.tx * TILE_PX + TILE_PX / 2, y: tile.ty * TILE_PX + TILE_PX / 2, layer, comfort: 0, bedroom: false } : null));
  for (const [item, count] of [['steinaxt', 1], ['fackel', 1], ['fasern', 6]] as const) send({ type: 'inventory.give', item, count });
  step(1);
  send({ type: 'player.selectHotbar', index: 0 });
  step(2);
  return p;
}

/** E gehalten: die Ereignisse, dann losgelassen. */
function holdE(p: Probe): string[] {
  p.send({ type: 'player.interact', on: true });
  const events = p.run(HOLD_TICKS);
  p.send({ type: 'player.interact', on: false });
  p.run(1);
  return events;
}

/** Was ein Schlafender oder eine Leiche versucht – Fackel aufstellen (Primärtaste), Licht umschalten, ein Faserseil herstellen; liefert die Ablehnungen. */
function deeds(p: Probe): string[] {
  const torch = p.inventory.state.schnellleiste.findIndex((s) => s?.item === 'fackel');
  p.send({ type: 'player.selectHotbar', index: torch });
  p.send({ type: 'player.aim', x: (p.tile.tx + 1) * TILE_PX + TILE_PX / 2, y: p.tile.ty * TILE_PX + TILE_PX / 2 });
  p.run(1);
  p.send({ type: 'player.useItem' });
  p.send({ type: 'light.toggle' });
  p.send({ type: 'craft.start', recipe: 'rezept_faserseil', count: 1 });
  return p.run(1).filter((e) => e.includes(':'));
}

describe('Tot oder im Schlaf handelt der Spieler nicht', () => {
  it('im Schlaf: E fällt keinen Baum (kein Fokus, Grund „asleep“), Benutzen, Licht und Handwerk warten; eine Bewegungstaste weckt, dann fällt E den Baum', () => {
    const p = probe();
    p.send({ type: 'setTime', hour: 20, minute: 0 });
    p.run(1);
    p.send({ type: 'sleep.start', tx: p.tile.tx, ty: p.tile.ty });
    p.run(2);
    expect(p.sleep.asleep).toBe(true);
    p.bed = false;
    p.run(1);
    expect(p.player.incapacity(p.sim)).toBe('asleep');
    expect(p.interaction.focus.kind).toBe('none');
    const asleep = holdE(p);
    expect(asleep).toContain('player.interact:asleep');
    expect(asleep).not.toContain('harvestHit');
    expect(asleep).not.toContain('treeFelled');
    expect(deeds(p)).toEqual(['player.useItem:asleep', 'light.toggle:asleep', 'craft.start:asleep']);
    expect(p.sleep.asleep).toBe(true);
    // Eine Bewegungstaste weckt; danach arbeitet E wieder.
    const axe = p.inventory.state.schnellleiste.findIndex((s) => s?.item === 'steinaxt');
    p.send({ type: 'player.selectHotbar', index: axe });
    p.send({ type: 'player.move', dx: 0, dy: -1 });
    p.run(1);
    p.send({ type: 'player.move', dx: 0, dy: 0 });
    p.run(2);
    expect(p.sleep.asleep).toBe(false);
    expect(p.player.incapacity(p.sim)).toBeNull();
    expect(holdE(p)).toContain('treeFelled');
  });

  it('tot: E, Benutzen, Licht und Handwerk werden mit „dead“ abgelehnt, und der Magnet zieht nichts in die Taschen der Leiche', () => {
    const p = probe();
    p.bed = false;
    (p.sim.system('death') as unknown as DeathSystem).setDifficulty('entspannt');
    p.send({ type: 'death.kill' });
    p.run(2);
    expect(p.player.incapacity(p.sim)).toBe('dead');
    expect(p.interaction.focus.kind).toBe('none');
    const dead = holdE(p);
    expect(dead).toContain('player.interact:dead');
    expect(dead).not.toContain('harvestHit');
    expect(deeds(p)).toEqual(['player.useItem:dead', 'light.toggle:dead', 'craft.start:dead']);
    // Ein Feuerstein fällt neben die Leiche: er bleibt liegen.
    const at = { x: 0, y: 0 };
    p.player.position(p.sim, at);
    p.drops.spawn(p.sim, newStack(contentItemCatalog().get('feuerstein'), 1), 0, at.x, at.y);
    p.run(180);
    expect(p.drops.count).toBe(1);
    expect(p.inventory.count('feuerstein')).toBe(0);
  });
});
