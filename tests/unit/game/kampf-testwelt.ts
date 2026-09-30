/**
 * Test support for the combat tests (zielen, angriff, parade, schaden, waffenklassen, fernkampf, wurfwaffen, schilde,
 * kampf-*): the player test world of spieler-testwelt.ts (hand-drawn chunks) with bags, equipment, the combat system and
 * the player's life systems (experience, conditions), a controllable aim point and wind, recorders for drops and
 * ignitions, and training dummies – a `CombatTargetProvider` of simple bodies that records every hit. Fixture weapons,
 * ammunition, throwables and shields of every class (`probe_*`) are validated with the real item schema.
 */
import { baseItem, defineItemGroup, ITEM_SFX, type ItemSpec } from '../../../src/content/items/define';
import { ITEMS } from '../../../src/content/items/index';
import type { ItemInput } from '../../../src/content/schema/item';
import { NULL_ENTITY, type Entity } from '../../../src/engine/ecs';
import { CombatSystem, createCombatAttack, type CombatAttack } from '../../../src/game/combat/system';
import type { CombatTargetProvider, CombatTeam, CombatantView, DamageType, HitMaterial, HitResult } from '../../../src/game/combat/targets';
import { addPlayerLifeSystems, type PlayerLife } from '../../../src/game/death/life';
import { equipmentModifierSource } from '../../../src/game/equipment/modifiers';
import { EquipmentSystem } from '../../../src/game/equipment/system';
import type { FireCause } from '../../../src/game/fire/events';
import { PlayerBags, withSlot } from '../../../src/game/inventory/bags';
import { selectHotbar } from '../../../src/game/inventory/ops';
import { InventorySystem } from '../../../src/game/inventory/system';
import { ItemCatalog } from '../../../src/game/items/catalog';
import { equipmentRef } from '../../../src/game/items/slots';
import { newStack, type ItemStack } from '../../../src/game/items/stack';
import type { Simulation } from '../../../src/game/sim';
import type { Layer } from '../../../src/world/model/coords';
import { OFFSET, T, testEnvironment, testWorld, type TestWorld } from './spieler-testwelt';

export { OFFSET, T };

function probe(id: string, spec: Omit<ItemSpec, 'id' | 'name' | 'beschreibung' | 'tauschwert' | 'sounds'>): ItemInput {
  return baseItem({ id, name: { de: `Probe ${id}`, en: `Probe ${id}` }, beschreibung: { de: 'Testwaffe.', en: 'Test weapon.' }, tauschwert: 1, sounds: { aufheben: ITEM_SFX.holz }, ...spec });
}

type Waffe = NonNullable<ItemInput['waffe']>;
function weapon(id: string, waffe: Waffe, extra: Partial<Omit<ItemSpec, 'id'>> = {}): ItemInput {
  return probe(id, { kategorie: 'waffe', haltbarkeit: 60, waffe, ...extra });
}
function throwable(id: string, waffe: Waffe): ItemInput {
  return probe(id, { kategorie: 'munition', waffe });
}
function ammo(id: string, munition: NonNullable<ItemInput['munition']>): ItemInput {
  return probe(id, { kategorie: 'munition', munition });
}
function shield(id: string, schild: NonNullable<ItemInput['schild']>): ItemInput {
  return probe(id, { kategorie: 'schild', ausruestung: 'nebenhand', haltbarkeit: 60, schild });
}

/** Fixture weapons of every class, ammunition, the five throwables and three shields (ids `probe_*`). */
export const KAMPF_PROBEN = defineItemGroup('kampf-proben', [
  weapon('probe_schwert', { klasse: 'schwert', schadensart: 'hieb', schaden: 8, reichweite: 20, bogen: 100, tempo: 0.5, ausdauer: 8, stagger: 0.2, wucht: 2, kombo: [1, 1, 1.5], schwer: 'rundumhieb' }),
  weapon('probe_kampfaxt', { klasse: 'axt', schadensart: 'hieb', schaden: 9.2, reichweite: 18, bogen: 90, tempo: 0.65, ausdauer: 10, stagger: 0.25, wucht: 3, schwer: 'ruestungsbruch' }, { werkzeug: { art: 'axt', abbaukraft: 1 } }),
  weapon('probe_keule', { klasse: 'keule', schadensart: 'wucht', schaden: 8.8, reichweite: 18, bogen: 90, tempo: 0.6, ausdauer: 11, stagger: 0.6, wucht: 4 }),
  weapon('probe_dolch', { klasse: 'dolch', schadensart: 'stich', schaden: 4.8, reichweite: 14, bogen: 60, tempo: 0.35, ausdauer: 5, stagger: 0.1, wucht: 1, zustand: { id: 'blutung', chance: 1, sekunden: 5 } }),
  weapon('probe_zweihand', { klasse: 'zweihand', schadensart: 'hieb', schaden: 14.4, reichweite: 24, bogen: 140, tempo: 1, ausdauer: 18, stagger: 0.5, wucht: 5 }),
  weapon('probe_bogen', { klasse: 'bogen', schadensart: 'stich', schaden: 8.8, reichweite: 192, bogen: 10, tempo: 0.9, ausdauer: 6, stagger: 0.1, wucht: 1, geschoss: { geschwindigkeit: 480 } }),
  weapon('probe_armbrust', { klasse: 'armbrust', schadensart: 'stich', schaden: 12.8, reichweite: 256, bogen: 10, tempo: 0.8, ausdauer: 4, stagger: 0.2, wucht: 2, geschoss: { geschwindigkeit: 600 } }),
  weapon('probe_schleuder', { klasse: 'schleuder', schadensart: 'wucht', schaden: 7.2, reichweite: 160, bogen: 10, tempo: 0.7, ausdauer: 5, stagger: 0.15, wucht: 2, geschoss: { geschwindigkeit: 360 } }),
  ammo('probe_pfeil', { fuer: 'bogen', schaden: 2, schadensart: 'stich' }),
  ammo('probe_pfeil_leucht', { fuer: 'bogen', schaden: 0, schadensart: 'stich', licht: { radius: 3, sekunden: 60 } }),
  ammo('probe_pfeil_feuer', { fuer: 'bogen', schaden: 1, schadensart: 'feuer', zustand: { id: 'brennen', chance: 1, sekunden: 4 } }),
  ammo('probe_bolzen', { fuer: 'armbrust', schaden: 3, schadensart: 'stich' }),
  ammo('probe_schleuderstein', { fuer: 'schleuder', schaden: 1, schadensart: 'wucht' }),
  throwable('probe_wurfmesser', { klasse: 'wurf', schadensart: 'stich', schaden: 8, reichweite: 128, bogen: 10, tempo: 0.5, ausdauer: 4, stagger: 0.1, wucht: 1, geschoss: { geschwindigkeit: 420 }, wurf: { wirkung: 'einzel', radius: 0 } }),
  throwable('probe_sprengtopf', { klasse: 'wurf', schadensart: 'wucht', schaden: 20, reichweite: 128, bogen: 10, tempo: 0.8, ausdauer: 6, stagger: 0.5, wucht: 5, geschoss: { geschwindigkeit: 240 }, wurf: { wirkung: 'explosion', radius: 24 } }),
  throwable('probe_brandflasche', { klasse: 'wurf', schadensart: 'feuer', schaden: 6, reichweite: 128, bogen: 10, tempo: 0.8, ausdauer: 6, stagger: 0, wucht: 1, zustand: { id: 'brennen', chance: 1, sekunden: 6 }, geschoss: { geschwindigkeit: 240 }, wurf: { wirkung: 'brand', radius: 20 } }),
  throwable('probe_frostbombe', { klasse: 'wurf', schadensart: 'frost', schaden: 5, reichweite: 128, bogen: 10, tempo: 0.8, ausdauer: 6, stagger: 0, wucht: 1, zustand: { id: 'verlangsamt', chance: 1, sekunden: 8 }, geschoss: { geschwindigkeit: 240 }, wurf: { wirkung: 'frost', radius: 24 } }),
  throwable('probe_blendbombe', { klasse: 'wurf', schadensart: 'licht', schaden: 1, reichweite: 128, bogen: 10, tempo: 0.8, ausdauer: 6, stagger: 0, wucht: 1, zustand: { id: 'geblendet', chance: 1, sekunden: 5 }, geschoss: { geschwindigkeit: 240 }, wurf: { wirkung: 'blendung', radius: 32 } }),
  probe('probe_brustpanzer', { kategorie: 'ruestung', ausruestung: 'brust', ruestungsgewicht: 'mittel', haltbarkeit: 60, werte: { ruestung: 12, feuerresistenz: 0.5 } }),
  shield('probe_holzschild', { blockkraft: 0.4, ausdauerJeSchaden: 1, tempoFaktor: 1 }),
  shield('probe_bronzeschild', { blockkraft: 0.6, ausdauerJeSchaden: 0.8, tempoFaktor: 1 }),
  shield('probe_turmschild', { blockkraft: 0.9, ausdauerJeSchaden: 0.6, tempoFaktor: 0.6 }),
]);

/** The game's items plus the combat fixtures. */
export function kampfCatalog(): ItemCatalog {
  return new ItemCatalog([...ITEMS, ...KAMPF_PROBEN]);
}

/** A training dummy: a body of the dummy provider. */
export interface Dummy {
  readonly entity: Entity;
  team: CombatTeam;
  layer: number;
  level: number;
  x: number;
  y: number;
  radius: number;
  facing: number;
  health: number;
  maxHealth: number;
  armor: number;
  resist: Record<DamageType, number>;
  invulnerable: boolean;
  blockSinceTick: number;
  blockPower: number;
  aware: boolean;
  material: HitMaterial;
  /** Every hit applied to it (copies). */
  readonly hits: HitResult[];
}

/** Training dummies as combatants (the provider records every hit; health falls, never below 0). */
export class DummyTargets implements CombatTargetProvider {
  readonly id = 'attrappen';
  readonly list: Dummy[] = [];

  add(sim: Simulation, props: Partial<Omit<Dummy, 'entity' | 'hits'>> & { x: number; y: number }): Dummy {
    const d: Dummy = {
      entity: sim.ecs.create(),
      team: 'feind',
      layer: 0,
      level: 0,
      radius: 6,
      facing: 0,
      health: 100,
      maxHealth: 100,
      armor: 0,
      resist: { hieb: 0, stich: 0, wucht: 0, feuer: 0, frost: 0, gift: 0, licht: 0, schatten: 0 },
      invulnerable: false,
      blockSinceTick: -1,
      blockPower: 0,
      aware: true,
      material: 'fell',
      hits: [],
      ...props,
    };
    this.list.push(d);
    return d;
  }

  queryCircle(_sim: Simulation, layer: number, x: number, y: number, r: number, out: Entity[]): void {
    for (const d of this.list) {
      const reach = r + d.radius;
      if (d.layer === layer && (d.x - x) ** 2 + (d.y - y) ** 2 <= reach * reach) out.push(d.entity);
    }
  }

  view(_sim: Simulation, entity: Entity, out: CombatantView): boolean {
    const d = this.list.find((x) => x.entity === entity);
    if (d === undefined) return false;
    out.entity = d.entity;
    out.team = d.team;
    out.layer = d.layer;
    out.level = d.level;
    out.x = d.x;
    out.y = d.y;
    out.radius = d.radius;
    out.facing = d.facing;
    out.health = d.health;
    out.maxHealth = d.maxHealth;
    out.armor = d.armor;
    Object.assign(out.resist, d.resist);
    out.invulnerable = d.invulnerable;
    out.blockSinceTick = d.blockSinceTick;
    out.blockPower = d.blockPower;
    out.material = d.material;
    return true;
  }

  aware(_sim: Simulation, entity: Entity): boolean {
    return this.list.find((x) => x.entity === entity)?.aware ?? true;
  }

  applyHit(_sim: Simulation, entity: Entity, hit: HitResult): void {
    const d = this.list.find((x) => x.entity === entity);
    if (d === undefined) return;
    d.hits.push({ ...hit });
    d.health = Math.max(0, d.health - hit.amount);
  }
}

/** A drop the combat system handed to the drop system. */
export interface Landed {
  readonly stack: ItemStack;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
}

/** The world of a combat test. */
export interface KampfWelt extends TestWorld {
  readonly combat: CombatSystem;
  readonly inventory: InventorySystem;
  readonly equipment: EquipmentSystem;
  readonly life: PlayerLife;
  readonly dummies: DummyTargets;
  /** The aim point (`player.aim` of the interaction), or `null`. */
  aim: { x: number; y: number } | null;
  /** The aim as the interaction offers it (`aimPoint`). */
  readonly aimSource: { readonly aimPoint: { x: number; y: number } | null };
  /** Wind acceleration [px/s²]. */
  readonly wind: { x: number; y: number };
  readonly landed: Landed[];
  readonly ignited: { layer: Layer; tx: number; ty: number; cause: FireCause }[];
  /** Puts `count` of `item` into hotbar slot `index` and selects it. */
  hold(item: string, count?: number, index?: number): void;
  /** Puts `count` of `item` into the first free inventory slot. */
  pack(item: string, count?: number): void;
  /** Wears `item` in the off hand. */
  offhand(item: string): void;
  /** Wears `item` in equipment slot `slot`. */
  wear(item: string, slot: Parameters<typeof equipmentRef>[0]): void;
  /** Aims at the point `dx`, `dy` [px] from the player's feet. */
  aimBy(dx: number, dy: number): void;
  /** A training dummy `dx`, `dy` [px] from the player's feet. */
  dummy(dx: number, dy: number, props?: Partial<Omit<Dummy, 'entity' | 'hits' | 'x' | 'y'>>): Dummy;
  /** A creature's attack from `from` (a dummy) on the player, resolved now; returns the hit. */
  strikePlayer(from: Dummy, attack?: Partial<CombatAttack>): HitResult | null;
}

/** A combat test world on `rows` (default: an open meadow of 40 × 20 tiles), the player spawned at map tile (x, y). */
export function kampfWelt(rows: readonly string[] = meadow(40, 20), spawnAt: { x: number; y: number } = { x: 10, y: 10 }, seed = 1): KampfWelt {
  const w = testWorld(rows, testEnvironment(), seed);
  const catalog = kampfCatalog();
  const bags = new PlayerBags(catalog);
  const inventory = w.sim.addSystem(new InventorySystem(bags));
  const equipment = w.sim.addSystem(new EquipmentSystem(bags));
  w.influences.addModifierSource(equipmentModifierSource(equipment));
  const landed: Landed[] = [];
  const ignited: KampfWelt['ignited'] = [];
  const wind = { x: 0, y: 0 };
  const aimSource = { aimPoint: null as { x: number; y: number } | null };
  const combat = w.sim.addSystem(
    new CombatSystem(w.sim, {
      player: w.player,
      motion: w.motion,
      inventory,
      equipment,
      vitals: w.vitals,
      collision: w.collision,
      interaction: aimSource,
      drops: {
        spawn: (_s, stack, layer, x, y) => {
          landed.push({ stack, layer, x, y });
          return NULL_ENTITY;
        },
      },
      fire: {
        ignite: (_s, layer, tx, ty, cause) => {
          ignited.push({ layer, tx, ty, cause });
          return true;
        },
      },
      cheats: w.cheats,
      environment: {
        wind: (_s, _layer, _x, _y, out) => {
          out.x = wind.x;
          out.y = wind.y;
        },
      },
    }),
  );
  w.player.addMotionHold(combat.motionHold);
  w.player.addFacingSource(combat.facingSource);
  w.influences.addModifierSource(combat.modifierSource);
  const life = addPlayerLifeSystems(w.sim, {
    components: w.components,
    influences: w.influences,
    motion: w.motion,
    collision: w.collision,
    player: w.player,
    inventory,
    equipment,
    landing: () => undefined,
    cheats: w.cheats,
    environment: { lightAt: () => 1, night: () => false, beach: () => ({ tx: OFFSET + 1, ty: OFFSET + 1 }) },
  });
  combat.useLife(life);
  const dummies = new DummyTargets();
  combat.addTargetProvider(dummies);
  const k: KampfWelt = {
    ...w,
    combat,
    inventory,
    equipment,
    life,
    dummies,
    get aim() {
      return aimSource.aimPoint;
    },
    set aim(p) {
      aimSource.aimPoint = p;
    },
    aimSource,
    wind,
    landed,
    ignited,
    hold(item, count = 1, index = 0) {
      const next = withSlot(inventory.state, { bereich: 'schnellleiste', index }, newStack(catalog.get(item), count));
      const sel = selectHotbar(next, index);
      if (!sel.ok) throw new Error('could not select the hotbar slot');
      inventory.bags.replace(sel.state);
    },
    pack(item, count = 1) {
      const index = inventory.state.inventar.findIndex((s) => s === null);
      inventory.bags.replace(withSlot(inventory.state, { bereich: 'inventar', index }, newStack(catalog.get(item), count)));
    },
    offhand(item) {
      inventory.bags.replace(withSlot(inventory.state, equipmentRef('nebenhand'), newStack(catalog.get(item), 1)));
    },
    wear(item, slot) {
      inventory.bags.replace(withSlot(inventory.state, equipmentRef(slot), newStack(catalog.get(item), 1)));
    },
    aimBy(dx, dy) {
      const p = w.pos();
      aimSource.aimPoint = { x: Math.floor(p.x + dx), y: Math.floor(p.y + dy) };
    },
    dummy(dx, dy, props = {}) {
      const p = w.pos();
      return dummies.add(w.sim, { x: p.x + dx, y: p.y + dy, ...props });
    },
    strikePlayer(from, attack = {}) {
      const a = { ...createCombatAttack(), team: from.team, damage: 10, fromX: from.x, fromY: from.y, ...attack };
      return combat.resolve(w.sim, from.entity, w.sim.player, a);
    },
  };
  k.spawn(spawnAt.x, spawnAt.y);
  return k;
}

/** An open meadow of `w × h` tiles. */
export function meadow(w: number, h: number): string[] {
  return Array.from({ length: h }, () => '.'.repeat(w));
}

/** Events of type `type` in an event map of `run`. */
export function eventsOf<T = Record<string, unknown>>(events: Map<string, unknown[]>, type: string): T[] {
  return (events.get(type) ?? []) as T[];
}

/** Runs ticks until `pred` holds (at most `max`); returns the ticks run. */
export function runUntil(k: KampfWelt, pred: () => boolean, max: number): number {
  for (let i = 0; i < max; i++) {
    if (pred()) return i;
    k.run(1);
  }
  if (pred()) return max;
  throw new Error(`condition not reached within ${max} ticks`);
}
