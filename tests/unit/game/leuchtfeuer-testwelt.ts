/**
 * Test support for the boss, beacon, unlock, shard and travel tests (boss-framework, leuchtfeuer, heilungskurve, splitter,
 * schnellreise and their roundtrips; strand F, M7-32 … M7-37): the creature test world of kreatur-testwelt.ts (hand-drawn
 * chunks, player, bags, combat, the player's life, creatures with the content's Zweigling) plus the systems of strand F wired
 * as in `createSimulation` – bosses on a drawn arena, beacons on a drawn site with one healing region, the unlock registry,
 * shards and fast travel (hearths as a list the test fills, logistics realism as a switch).
 *
 * The arena: a circle of `ARENA_RADIUS` tiles around drawn tile `ARENA` (the boss on its centre, the way out to the south);
 * the beacon site: drawn tile `SITE`, south of the arena. Map coordinates are relative to `OFFSET` (spieler-testwelt.ts).
 */
import type { BossDef } from '../../../src/content/bosses/schema';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import { BeaconsSystem } from '../../../src/game/beacons/system';
import { siteAt, type BeaconWorld } from '../../../src/game/beacons/sites';
import { fallbackBurnTiles, type ArenaGeometry } from '../../../src/game/bosses/arena';
import { BossesSystem } from '../../../src/game/bosses/system';
import type { ItemStack } from '../../../src/game/items/stack';
import { ShardsSystem, vitalsHealer } from '../../../src/game/shards/index';
import type { Simulation } from '../../../src/game/sim';
import { TravelSystem, type HearthTravelTarget } from '../../../src/game/travel/system';
import { UnlocksSystem } from '../../../src/game/unlocks/system';
import { TILE_PX, type Layer } from '../../../src/world/model/coords';
import { kreaturWelt, meadow, OFFSET, T, type KreaturWelt } from './kreatur-testwelt';

export { OFFSET, T, meadow };

/** Centre of the drawn arena (map tile). */
export const ARENA = { x: 30, y: 20 } as const;
/** Radius of the drawn arena [tiles]. */
export const ARENA_RADIUS = 9;
/** The drawn beacon site (map tile): south of the arena, outside its rim. */
export const SITE = { x: 30, y: 40 } as const;
/** Width and height of the drawn meadow [tiles]. */
export const MAP = { w: 60, h: 52 } as const;

/** The arena geometry of the drawn map (world tiles). */
export function drawnArena(): ArenaGeometry {
  const cx = OFFSET + ARENA.x;
  const cy = OFFSET + ARENA.y;
  return {
    layer: 0,
    cx,
    cy,
    radiusTiles: ARENA_RADIUS,
    bossX: (cx + 1 / 2) * TILE_PX,
    bossY: (cy + 1 / 2) * TILE_PX,
    outX: 0,
    outY: 1,
    burnTiles: fallbackBurnTiles(cx, cy, ARENA_RADIUS),
  };
}

/** A drop the systems handed to the drop system. */
export interface Dropped {
  readonly stack: ItemStack;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
}

/** The world of a strand-F test. */
export interface LeuchtfeuerWelt extends KreaturWelt {
  readonly bosses: BossesSystem;
  readonly beacons: BeaconsSystem;
  readonly unlocks: UnlocksSystem;
  readonly shards: ShardsSystem;
  readonly travel: TravelSystem;
  /** Drops of the bosses and the beacons (loot, the ember core that did not fit). */
  readonly dropped: Dropped[];
  /** The burning hearths fast travel sees (the test fills it). */
  readonly hearths: HearthTravelTarget[];
  /** The world setting "Logistik-Realismus". */
  logistics: boolean;
  /** Puts the player on drawn tile (x, y) (teleport, one tick); returns the events of that tick. */
  goTo(x: number, y: number): Map<string, unknown[]>;
  /** The `commandRejected` reasons of an event map. */
  rejections(events: Map<string, unknown[]>): string[];
}

/**
 * A strand-F test world on a meadow of `MAP` tiles, the player on drawn tile `spawnAt`; `bosses` replaces the content's
 * bosses (fixtures), `arena: false` leaves the world without an arena (the generated world before it is there).
 */
export function leuchtfeuerWelt(options: { spawnAt?: { x: number; y: number }; bosses?: readonly BossDef[]; arena?: boolean; seed?: number } = {}): LeuchtfeuerWelt {
  const spawnAt = options.spawnAt ?? { x: SITE.x, y: SITE.y + 3 };
  const k = kreaturWelt(meadow(MAP.w, MAP.h), spawnAt, options.seed ?? 1, 'inhalt');
  const dropped: Dropped[] = [];
  const drops = {
    spawn: (_s: Simulation, stack: ItemStack, layer: number, x: number, y: number) => {
      dropped.push({ stack, layer, x, y });
      return NULL_ENTITY;
    },
  };
  const arena = options.arena === false ? null : drawnArena();
  const bosses = k.sim.addSystem(
    new BossesSystem({ player: k.player, collision: k.collision, combat: k.combat, creatures: k.creatures, drops, inventory: k.inventory, catalog: k.inventory.bags.catalog, arenas: () => arena, ...(options.bosses === undefined ? {} : { bosses: options.bosses }) }),
  );
  k.creatures.addSpawnBlocker((_s, layer, tx, ty) => bosses.arenaAt(layer, tx, ty) !== null);
  const site = siteAt(0, OFFSET + SITE.x, OFFSET + SITE.y);
  const world: BeaconWorld = {
    site: (biome) => (biome === 'gruenhain' ? site : null),
    regions: [{ x: site.tx, y: site.ty - 10, biome: 'gruenhain' }],
    regionAt: () => 0,
  };
  const unlocks = new UnlocksSystem();
  const beacons = k.sim.addSystem(new BeaconsSystem({ player: k.player, inventory: k.inventory, collision: k.collision, drops, unlocks, bosses, world: () => world }));
  k.sim.addSystem(unlocks);
  k.creatures.addSpawnBlocker((_s, layer, tx, ty, family) => family === 'schattenbrut' && beacons.inZone(layer, tx, ty));
  const shards = k.sim.addSystem(new ShardsSystem({ inventory: k.inventory, heal: vitalsHealer(k.components, k.influences) }));
  k.influences.addModifierSource(shards.modifierSource());
  const hearths: HearthTravelTarget[] = [];
  const teleport = k.player.commands['player.teleport'];
  if (teleport === undefined) throw new Error('no player.teleport');
  const travel = k.sim.addSystem(
    new TravelSystem({
      player: k.player,
      inventory: k.inventory,
      collision: k.collision,
      combat: k.combat,
      bosses,
      beacons,
      hearths: () => hearths,
      teleport: (s, x, y, layer) => teleport(s, { type: 'player.teleport', x, y, layer }, s.eventTick),
    }),
  );
  const switches = { logistics: false };
  travel.useLogistics(() => switches.logistics);
  const life = k.life;
  bosses.useLife({ enemyDamage: () => 1, dead: () => life.death.dead, fright: (s, amount) => life.fear.spike(s, amount, 'sichtung'), condition: (s, id) => void life.conditions.apply(s, id) });
  beacons.useLife({ dead: () => life.death.dead, condition: (s, id) => void life.conditions.apply(s, id) });
  travel.useLife({ dead: () => life.death.dead });
  life.death.addArenaSpots((s, x, y, layer) => bosses.arenaSpot(s, x, y, layer as Layer));
  life.death.addBeacons((s) => beacons.respawnSpots(s));
  const w: LeuchtfeuerWelt = Object.assign(k, {
    bosses,
    beacons,
    unlocks,
    shards,
    travel,
    dropped,
    hearths,
    logistics: false,
    goTo(x: number, y: number): Map<string, unknown[]> {
      const c = k.centre(x, y);
      const ev = k.run(1, [{ type: 'player.teleport', x: c.x, y: c.y, layer: 0 }]);
      if (ev.has('commandRejected')) throw new Error(`teleport refused: ${JSON.stringify(ev.get('commandRejected'))}`);
      return ev;
    },
    rejections(events: Map<string, unknown[]>): string[] {
      return ((events.get('commandRejected') ?? []) as { reason: string }[]).map((r) => r.reason);
    },
  });
  // `Object.assign` would read the accessor once: define it on the world itself.
  Object.defineProperty(w, 'logistics', {
    get: () => switches.logistics,
    set: (on: boolean) => {
      switches.logistics = on;
    },
  });
  return w;
}
