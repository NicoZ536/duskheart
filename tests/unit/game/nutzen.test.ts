/**
 * E benutzt Dinge (MASTERPROMPT §11.4 "Interagieren (E)", "Essen/Trinken", "Sitzen (Stühle, Baumstümpfe)",
 * §11.5, §11.6, §12.2, §18; src/game/interaction/uses.ts): neben Drops, Objekten und Tiles bietet die
 * Interaktion Nutzungsziele an – Lagerfeuer (nachlegen, entzünden), aufgestellte Fackel (nehmen), Wasser
 * vor dem Spieler (trinken), Baumstumpf (sitzen, aufstehen), Grab (bergen), Bett (schlafen). Das
 * zuständige System führt es über seinen eigenen Command aus (dieselben Ereignisse und Ablehnungen); ein
 * Druck benutzt genau ein Ziel; der Hinweis nennt Verb, Ding und Grund in beiden Sprachen.
 *
 * Auf der echten Welt (klein, Seed 3: Startstrand mit Meer, Bäume und ein Fluss in der Nähe); Aufbauten
 * (Gegenstände, Teleport, Uhrzeit) über Debug-Commands.
 */
import { describe, expect, it } from 'vitest';
import type { EventArgs } from '../../../src/engine/events';
import type { ActionsSystem } from '../../../src/game/actions/system';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import type { DeathSystem } from '../../../src/game/death/system';
import { createObjectHit, type GatheringSystem } from '../../../src/game/gathering/system';
import { hintText, interactionHint } from '../../../src/game/interaction/hint';
import type { InteractionSystem } from '../../../src/game/interaction/system';
import { fuelSlot } from '../../../src/game/interaction/uses';
import type { InventorySystem } from '../../../src/game/inventory/system';
import type { SlotRef } from '../../../src/game/items/slots';
import type { LightSystem } from '../../../src/game/light/system';
import type { WorldCollision } from '../../../src/game/player/collision';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import type { SleepSystem } from '../../../src/game/sleep/system';
import { createI18n } from '../../../src/i18n/index';
import { WATER_DEPTH_MASK, WATER_FROZEN, WATER_SEA } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';

const CONFIG = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** Farthest the tests look for water and trees [tiles]. */
const SEARCH = 60;
/** Enough ticks for any single use (a sip, a felled tree) to finish. */
const LONG = 400;

type Ev = EventArgs<SimEventMap>;
const DE = createI18n('de', { strict: true });
const EN = createI18n('en', { strict: true });

class UseWorld {
  readonly sim: Simulation = createSimulation(CONFIG);
  events: Ev[] = [];

  constructor() {
    this.run([{ type: 'player.spawn' }], 30);
  }

  sys<T>(id: string): T {
    return this.sim.system(id) as unknown as T;
  }

  get interaction(): InteractionSystem {
    return this.sys('interaction');
  }

  get inventory(): InventorySystem {
    return this.sys('inventory');
  }

  /** Runs `commands` in the first of `ticks` ticks; keeps every event of them. */
  run(commands: readonly GameCommand[] = [], ticks = 1): Ev[] {
    const out: Ev[] = [];
    for (let i = 0; i < ticks; i++) {
      this.sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
      this.sim.events.drain((...e) => out.push(e));
    }
    this.events = out;
    return out;
  }

  of<K extends keyof SimEventMap>(type: K, events: readonly Ev[] = this.events): SimEventMap[K][] {
    return events.filter((e) => e[0] === type).map((e) => e[1] as SimEventMap[K]);
  }

  /** One press of E on tile (tx, ty) (pressed and released), then `ticks − 1` more ticks. */
  press(tx: number, ty: number, ticks = 1): Ev[] {
    const a = this.run([{ type: 'player.interact', on: true, tx, ty }]);
    const b = this.run([{ type: 'player.interact', on: false }], ticks);
    this.events = [...a, ...b];
    return this.events;
  }

  tile(): { tx: number; ty: number } {
    const at = { x: 0, y: 0 };
    if (!this.sys<PlayerSystem>('player').position(this.sim, at)) throw new Error('no player');
    return { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
  }

  /** Puts the player on the centre of tile (tx, ty) and lets it settle. */
  goto(tx: number, ty: number): void {
    this.run([{ type: 'player.teleport', x: tx * TILE_PX + TILE_PX / 2, y: ty * TILE_PX + TILE_PX / 2, layer: 0 }], 5);
  }

  /** Aims at tile (tx, ty) and lets the focus follow. */
  aim(tx: number, ty: number): void {
    this.run([{ type: 'player.aim', x: tx * TILE_PX + TILE_PX / 2, y: ty * TILE_PX + TILE_PX / 2 }], 2);
  }

  /** Gives one `item` and puts it into the hand (hotbar slot `index`). */
  inHand(item: string, index: number): void {
    this.run([{ type: 'inventory.give', item, count: 1 }]);
    const from = this.slotOf(item);
    if (from.bereich !== 'schnellleiste' || from.index !== index) this.run([{ type: 'inventory.move', from, to: { bereich: 'schnellleiste', index } }]);
    this.run([{ type: 'player.selectHotbar', index }]);
    if (this.inventory.selected()?.item !== item) throw new Error(`${item} is not in the hand`);
  }

  slotOf(item: string): SlotRef {
    const bags = this.inventory.state;
    for (const bereich of ['schnellleiste', 'inventar'] as const) {
      const index = bags[bereich].findIndex((s) => s?.item === item);
      if (index >= 0) return { bereich, index };
    }
    throw new Error(`${item} not in the bags`);
  }

  /** Whether (tx, ty) is open, dry land the player can stand on. */
  land(tx: number, ty: number): boolean {
    return this.sys<WorldCollision>('world-collision').grid.tileInfo(0, tx, ty) === 0;
  }

  water(tx: number, ty: number): number {
    const chunk = this.sys<WorldCollision>('world-collision').chunks.get(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    return chunk === undefined ? 0 : (chunk.water[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number);
  }

  /** The nearest water tile matching `accept` that has land beside it: the water and the land tile. */
  shore(accept: (water: number) => boolean): { water: { tx: number; ty: number }; land: { tx: number; ty: number } } {
    const me = this.tile();
    for (let r = 1; r <= SEARCH; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = me.tx + dx;
          const ty = me.ty + dy;
          const w = this.water(tx, ty);
          if ((w & WATER_DEPTH_MASK) === 0 || !accept(w)) continue;
          for (const [nx, ny] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ] as const) {
            if (this.land(tx + nx, ty + ny)) return { water: { tx, ty }, land: { tx: tx + nx, ty: ty + ny } };
          }
        }
      }
    }
    throw new Error('no such water near the start beach');
  }

  /** Hint line of the focus in `lang`. */
  hint(lang: 'de' | 'en'): string {
    const h = interactionHint(this.interaction.focus);
    if (h === null) return '';
    const i18n = lang === 'de' ? DE : EN;
    return hintText(h, lang, (k, p) => i18n.t(k, p));
  }
}

/** A world with a camp fire placed next to the player; returns the fire's tile and id. */
function withCampFire(w: UseWorld): { tx: number; ty: number; id: number } {
  w.inHand('lagerfeuer', 3);
  const me = w.tile();
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    w.aim(me.tx + dx, me.ty + dy);
    const placed = w.of('lightPlaced', w.run([{ type: 'player.useItem' }]));
    if (placed.length > 0) return { tx: me.tx + dx, ty: me.ty + dy, id: (placed[0] as { light: number }).light };
  }
  throw new Error('camp fire could not be placed');
}

describe('E am Lagerfeuer und an der Fackel', () => {
  it('ein kaltes Feuer: nachlegen (bester Brennstoff), dann entzünden; ohne Brennstoff und voll blockiert – je ein Druck', () => {
    const w = new UseWorld();
    const fire = withCampFire(w);
    w.run([{ type: 'player.selectHotbar', index: 0 }]);
    // Empty bags: the fire wants fuel, and E says what is missing.
    w.aim(fire.tx, fire.ty);
    expect(w.interaction.focus).toMatchObject({ kind: 'use', action: 'nachlegen', subject: 'lagerfeuer', block: 'keinBrennstoff' });
    expect(w.hint('de')).toBe('Nachlegen: Lagerfeuer – kein Brennstoff in den Taschen – sammle Holz oder Zweige');
    expect(w.hint('en')).toBe('Add fuel: Campfire – no fuel in your bags – gather wood or twigs');
    expect(w.of('commandRejected', w.press(fire.tx, fire.ty))).toEqual([{ type: 'player.interact', reason: 'keinBrennstoff', tick: expect.any(Number) }]);
    // Twigs and wood: E puts the longest-burning fuel on (wood, 45 s each) – as many as fit.
    w.run([
      { type: 'inventory.give', item: 'zweig', count: 3 },
      { type: 'inventory.give', item: 'holz', count: 5 },
    ]);
    expect(w.inventory.state.inventar[fuelSlot(w.inventory)?.index ?? -1]?.item).toBe('holz');
    w.aim(fire.tx, fire.ty);
    expect(w.interaction.focus).toMatchObject({ kind: 'use', action: 'nachlegen', block: null });
    expect(w.hint('de')).toBe('Nachlegen: Lagerfeuer');
    const fed = w.of('fireFueled', w.press(fire.tx, fire.ty));
    expect(fed).toEqual([expect.objectContaining({ light: fire.id, item: 'holz', count: 5 })]);
    expect(w.inventory.count('holz')).toBe(0);
    // Fuel on a cold fire: E lights it.
    w.aim(fire.tx, fire.ty);
    expect(w.interaction.focus).toMatchObject({ action: 'entzuenden', block: null });
    expect(w.hint('en')).toBe('Light: Campfire');
    expect(w.of('lightIgnited', w.press(fire.tx, fire.ty))).toHaveLength(1);
    expect(w.sys<LightSystem>('light').placed(fire.id)?.fire?.lit).toBe(true);
    // Burning, twigs in the bags: E feeds it; wood in the hand would go first.
    w.aim(fire.tx, fire.ty);
    expect(w.interaction.focus).toMatchObject({ action: 'nachlegen', block: null });
    expect(w.of('fireFueled', w.press(fire.tx, fire.ty))).toEqual([expect.objectContaining({ item: 'zweig', count: 3 })]);
    // Full: 6 minutes at most (§15.4).
    w.run([{ type: 'inventory.give', item: 'holz', count: 20 }]);
    w.aim(fire.tx, fire.ty);
    w.press(fire.tx, fire.ty);
    w.aim(fire.tx, fire.ty);
    expect(w.interaction.focus).toMatchObject({ action: 'nachlegen', block: 'feuerVoll' });
    expect(w.of('commandRejected', w.press(fire.tx, fire.ty))).toEqual([expect.objectContaining({ type: 'player.interact', reason: 'feuerVoll' })]);
  });

  it('gehaltenes E benutzt nur ein Ziel: ein Nachlegen, kein Weiterarbeiten am nächsten Ding', () => {
    const w = new UseWorld();
    const fire = withCampFire(w);
    w.run([{ type: 'inventory.give', item: 'zweig', count: 20 }]);
    w.aim(fire.tx, fire.ty);
    const held = w.run([{ type: 'player.interact', on: true, tx: fire.tx, ty: fire.ty }], 120);
    expect(w.of('fireFueled', held)).toHaveLength(1);
    expect(w.of('actionStarted', held)).toEqual([]);
    expect(w.interaction.holding).toBe(false);
  });

  it('eine aufgestellte Fackel nimmt E zurück in die Taschen', () => {
    const w = new UseWorld();
    w.inHand('fackel', 2);
    const me = w.tile();
    let torch: { light: number; tx: number; ty: number } | null = null;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      w.aim(me.tx + dx, me.ty + dy);
      const placed = w.of('lightPlaced', w.run([{ type: 'player.useItem' }]));
      if (placed.length > 0) {
        torch = placed[0] as { light: number; tx: number; ty: number };
        break;
      }
    }
    if (torch === null) throw new Error('torch could not be placed');
    w.aim(torch.tx, torch.ty);
    expect(w.interaction.focus).toMatchObject({ kind: 'use', action: 'nehmen', subject: 'fackel', block: null });
    expect(w.hint('de')).toBe('Nehmen: Fackel');
    const taken = w.press(torch.tx, torch.ty);
    expect(w.of('lightRemoved', taken)).toEqual([expect.objectContaining({ light: torch.light, reason: 'genommen' })]);
    expect(w.inventory.count('fackel')).toBe(1);
  });
});

describe('E am Wasser', () => {
  it('Süßwasser vor dem Spieler: ein Schluck; das Meer ist zu salzig; Ufer ohne Blick aufs Wasser bieten nichts an', () => {
    const w = new UseWorld();
    const sea = w.shore((water) => (water & WATER_SEA) !== 0 && (water & WATER_FROZEN) === 0);
    w.goto(sea.land.tx, sea.land.ty);
    w.aim(sea.water.tx, sea.water.ty);
    expect(w.interaction.focus).toMatchObject({ kind: 'use', action: 'trinken', subject: 'meerwasser', block: 'salzwasser' });
    expect(w.hint('de')).toBe('Trinken: Meerwasser – zu salzig – trink aus einem Fluss, einem See oder einer Quelle');
    expect(w.of('commandRejected', w.press(sea.water.tx, sea.water.ty))).toEqual([expect.objectContaining({ type: 'player.interact', reason: 'salzwasser' })]);
    // Aiming at the land behind the player: the sea beside it is no target (water only ahead or aimed).
    w.aim(sea.land.tx * 2 - sea.water.tx, sea.land.ty * 2 - sea.water.ty);
    expect(w.interaction.focus.kind === 'use' && w.interaction.focus.action === 'trinken' && w.interaction.focus.tx === sea.water.tx && w.interaction.focus.ty === sea.water.ty).toBe(false);

    const river = w.shore((water) => (water & (WATER_SEA | WATER_FROZEN)) === 0);
    w.goto(river.land.tx, river.land.ty);
    w.aim(river.water.tx, river.water.ty);
    expect(w.interaction.focus).toMatchObject({ kind: 'use', action: 'trinken', block: null });
    expect(['suesswasser', 'quellwasser']).toContain(w.interaction.focus.subject);
    const sip = w.press(river.water.tx, river.water.ty, LONG);
    expect(w.of('activityStarted', sip)).toEqual([expect.objectContaining({ action: 'trinken' })]);
    expect(w.of('waterDrunk', sip)).toHaveLength(1);
  });
});

describe('E am Baumstumpf, am Grab und am Bett', () => {
  it('Baumstumpf: mit der Axt in der Hand wird gerodet, mit leerer Hand gesessen; sitzend steht E wieder auf', () => {
    const w = new UseWorld();
    const gathering = w.sys<GatheringSystem>('gathering');
    // A Grünhain tree near the beach, felled with the stone axe.
    const me = w.tile();
    let tree: { tx: number; ty: number } | null = null;
    for (let r = 2; r <= SEARCH && tree === null; r++) {
      for (let dy = -r; dy <= r && tree === null; dy++) {
        for (let dx = -r; dx <= r && tree === null; dx++) {
          const tx = me.tx + dx;
          const ty = me.ty + dy;
          const hit = createObjectHit();
          if (!gathering.objectAt(0, tx, ty, hit) || hit.rule?.standing?.action !== 'faellen' || hit.tx !== tx || hit.ty !== ty) continue;
          if (w.land(tx, ty + 1) && hit.rule.footprintW === 1) tree = { tx, ty };
        }
      }
    }
    if (tree === null) throw new Error('no tree near the start beach');
    w.inHand('steinaxt', 0);
    w.goto(tree.tx, tree.ty + 1);
    const felled = w.run([{ type: 'player.interact', on: true, tx: tree.tx, ty: tree.ty }], LONG);
    w.run([{ type: 'player.interact', on: false }]);
    expect(w.of('treeFelled', felled)).toHaveLength(1);
    // Axe in the hand: the stump is cleared (the harvest target wins the tie).
    w.aim(tree.tx, tree.ty);
    expect(w.interaction.focus).toMatchObject({ kind: 'object', action: 'roden' });
    // Empty hand: sit down.
    w.run([{ type: 'player.selectHotbar', index: 5 }]);
    w.aim(tree.tx, tree.ty);
    expect(w.interaction.focus).toMatchObject({ kind: 'use', action: 'sitzen', subject: 'baumstumpf', block: null });
    expect(w.hint('de')).toBe('Hinsetzen: Baumstumpf');
    expect(w.of('activityStarted', w.press(tree.tx, tree.ty))).toEqual([expect.objectContaining({ action: 'sitzen' })]);
    expect(w.sys<ActionsSystem>('actions').state.seat).not.toBeNull();
    w.aim(tree.tx, tree.ty);
    expect(w.interaction.focus).toMatchObject({ kind: 'use', action: 'aufstehen' });
    expect(w.hint('en')).toBe('Stand up: Tree Stump');
    expect(w.of('activityFinished', w.press(tree.tx, tree.ty))).toEqual([expect.objectContaining({ action: 'sitzen' })]);
    expect(w.sys<ActionsSystem>('actions').state.seat).toBeNull();
  });

  it('das eigene Grab: E birgt, was in die Taschen passt', () => {
    const w = new UseWorld();
    w.run([{ type: 'inventory.give', item: 'walnuss', count: 4 }]);
    const deathTile = w.tile();
    w.run([{ type: 'death.kill' }], 5);
    w.run([{ type: 'death.respawn', at: 'strand' }], 5);
    const death = w.sys<DeathSystem>('death');
    expect(death.state.graves).toHaveLength(1);
    const grave = death.state.graves[0] as { x: number; y: number };
    const gx = Math.floor(grave.x / TILE_PX);
    const gy = Math.floor(grave.y / TILE_PX);
    expect({ tx: gx, ty: gy }).toEqual(deathTile);
    w.goto(gx, gy + 1);
    w.aim(gx, gy);
    expect(w.interaction.focus).toMatchObject({ kind: 'use', action: 'bergen', subject: 'grab', block: null });
    expect(w.hint('de')).toBe('Bergen: Dein Grab');
    const looted = w.press(gx, gy);
    expect(w.of('graveEmptied', looted)).toHaveLength(1);
    expect(w.inventory.count('walnuss')).toBe(4);
    expect(death.state.graves).toEqual([]);
  });

  it('ein Bett (Schlafplatz eines Anbieters): vor 19 Uhr blockiert, danach legt E den Spieler schlafen', () => {
    const w = new UseWorld();
    const me = w.tile();
    const bed = { tx: me.tx + 1, ty: me.ty };
    const sleep = w.sys<SleepSystem>('sleep');
    sleep.addSleepPlaces((_s, layer, tx, ty) => (tx === bed.tx && ty === bed.ty ? { kind: 'grasbett', x: tx * TILE_PX + TILE_PX / 2, y: ty * TILE_PX + TILE_PX / 2, layer, comfort: 0, bedroom: false } : null));
    w.aim(bed.tx, bed.ty);
    expect(w.interaction.focus).toMatchObject({ kind: 'use', action: 'schlafen', subject: 'grasbett', block: 'nochNichtMuede' });
    expect(w.hint('en')).toBe('Sleep: Grass bed – you are not tired yet – from 7 pm or when exhausted');
    w.run([{ type: 'setTime', hour: 19, minute: 30 }], 2);
    w.aim(bed.tx, bed.ty);
    expect(w.interaction.focus).toMatchObject({ action: 'schlafen', block: null });
    expect(w.of('sleepStarted', w.press(bed.tx, bed.ty))).toEqual([expect.objectContaining({ place: 'grasbett' })]);
    expect(sleep.asleep).toBe(true);
  });
});
