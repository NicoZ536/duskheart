/**
 * What the hand fights with (docs/SPIEL.md §10 "Angriffe als Daten"; MASTERPROMPT §19.1, §19.2, §D): the attack profile of
 * the item in the hand, resolved from its `waffe` block – or, without one, from the rules of `BALANCE.combat` for tools
 * swung as weapons and for the bare fist. A broken piece (§13.1 "Kaputt = unbenutzbar") is not used: the hand fights
 * bare. Also: which shot a ranged weapon takes (`findAmmo`), what the hand blocks with (`blockOf`) and the routing of
 * the primary button (`primaryRoute`: a use of its own → `player.useItem`, else a blow → `combat.attack`).
 *
 * Profiles are held records refilled per call (no allocation per tick, §30).
 */
import { BALANCE } from '../../content/balance';
import { RANGED_WEAPON_CLASSES, type AmmoWeaponClass, type HeavyAttack, type ThrowEffect } from '../../content/balance/combat';
import type { WeaponClass } from '../../content/balance/tools';
import { CURES } from '../../content/items/grundlagen';
import { BUCKETS } from '../../content/items/werkzeuge';
import { lightKindOfItem } from '../../content/lights';
import type { HitCondition, ItemDef } from '../../content/schema/item';
import { DIG_REFILL_ITEM } from '../../content/terrain';
import type { BagsState } from '../inventory/bags';
import type { ItemCatalog } from '../items/catalog';
import type { ItemStack } from '../items/stack';
import { secondsToTicks, weaponDamage } from './formulas';
import type { DamageType } from './targets';

const C = BALANCE.combat;
const RANGED: ReadonlySet<string> = new Set(RANGED_WEAPON_CLASSES);

/** How a profile attacks: a blow, a shot with ammunition, a throw of the piece itself. */
export type AttackMode = 'nahkampf' | 'munition' | 'wurf';
/** Where a profile comes from. */
export type ProfileSource = 'waffe' | 'werkzeug' | 'faust';

/** The attack profile of the hand (refilled by `resolveProfile`). */
export interface AttackProfile {
  /** The item that attacks (`null`: the bare fist, also for a broken piece). */
  item: string | null;
  source: ProfileSource;
  klasse: WeaponClass;
  mode: AttackMode;
  art: DamageType;
  /** Damage of a light blow or a full shot [HP]. */
  damage: number;
  /** Reach of a blow, or the farthest shot or throw [px]. */
  reach: number;
  /** Swing [°]. */
  arcDeg: number;
  /** Wind-up before a blow lands [ticks] (ranged: none – they draw). */
  windupTicks: number;
  /** Recovery after a blow, shot or throw [ticks]. */
  recoveryTicks: number;
  /** Stamina per blow or shot [points]. */
  stamina: number;
  /** Stagger of the target [s]. */
  staggerSeconds: number;
  /** Impact class 1–5. */
  wucht: number;
  /** Damage factors of the combo (empty: no combo). */
  combo: readonly number[];
  heavy: HeavyAttack;
  condition: HitCondition | null;
  /** Speed of a shot or throw [px/s] (0 for blows). */
  speed: number;
  /** Full draw of a bow, sling or throw [ticks]; 0 for a crossbow and blows. */
  drawTicks: number;
  /** Reload of a crossbow [ticks]; 0 otherwise. */
  reloadTicks: number;
  /** Thrown weapons: effect and burst radius [px]. */
  throwEffect: ThrowEffect | null;
  throwRadius: number;
}

/** A fresh profile (the fist's until resolved). */
export function createAttackProfile(): AttackProfile {
  const p = {} as AttackProfile;
  fistProfile(p);
  return p;
}

/** The ammunition class a weapon class shoots, or `null` for blows and throws. */
export function ammoClassOf(klasse: WeaponClass): AmmoWeaponClass | null {
  return klasse === 'bogen' || klasse === 'armbrust' || klasse === 'schleuder' ? klasse : null;
}

/** Fills `out` with the bare fist (§D: T0 base × fist factor; `BALANCE.combat.fist`). */
export function fistProfile(out: AttackProfile): AttackProfile {
  const f = C.fist;
  out.item = null;
  out.source = 'faust';
  out.klasse = 'faust';
  out.mode = 'nahkampf';
  out.art = f.schadensart;
  out.damage = weaponDamage(0, 'faust');
  out.reach = f.reichweitePx;
  out.arcDeg = f.bogenGrad;
  meleeTiming(out, f.tempoSekunden);
  out.stamina = f.ausdauer;
  out.staggerSeconds = f.staggerSekunden;
  out.wucht = f.wucht;
  out.combo = NO_COMBO;
  out.heavy = 'schlag';
  out.condition = null;
  out.speed = 0;
  out.drawTicks = 0;
  out.reloadTicks = 0;
  out.throwEffect = null;
  out.throwRadius = 0;
  return out;
}

const NO_COMBO: readonly number[] = Object.freeze([]);

function meleeTiming(out: AttackProfile, tempoSeconds: number): void {
  const total = secondsToTicks(tempoSeconds, 1);
  out.windupTicks = Math.max(1, secondsToTicks(tempoSeconds * C.attack.windupShare));
  out.recoveryTicks = Math.max(0, total - out.windupTicks);
}

/**
 * Fills `out` with the attack profile of `def` held as `stack` (`null`: the empty hand). A weapon uses its `waffe` block; a
 * tool, or a weapon without one, strikes as an improvised weapon (`BALANCE.combat.tool`: its tier's base damage × the tool
 * factor – a weapon's own `werte.schaden` if it has one); anything else, and every broken piece, is the fist.
 */
export function resolveProfile(def: ItemDef | null, stack: ItemStack | null, out: AttackProfile): AttackProfile {
  if (def === null || stack === null || stack.haltbarkeit === 0) return fistProfile(out);
  const w = def.waffe;
  if (w !== undefined) {
    out.item = def.id;
    out.source = 'waffe';
    out.klasse = w.klasse;
    out.art = w.schadensart;
    out.damage = w.schaden;
    out.reach = w.reichweite;
    out.arcDeg = w.bogen;
    out.stamina = w.ausdauer;
    out.staggerSeconds = w.stagger;
    out.wucht = w.wucht;
    out.combo = w.kombo ?? NO_COMBO;
    out.heavy = w.schwer ?? 'schlag';
    out.condition = w.zustand ?? null;
    out.throwEffect = w.wurf?.wirkung ?? null;
    out.throwRadius = w.wurf?.radius ?? 0;
    if (RANGED.has(w.klasse)) {
      out.mode = w.klasse === 'wurf' ? 'wurf' : 'munition';
      const total = secondsToTicks(w.tempo, 1);
      out.windupTicks = 0;
      out.recoveryTicks = Math.max(0, total - secondsToTicks(w.tempo * C.attack.windupShare));
      out.speed = w.geschoss?.geschwindigkeit ?? 0;
      out.drawTicks = w.klasse === 'armbrust' ? 0 : secondsToTicks(w.geschoss?.spannen ?? defaultDraw(w.klasse), 1);
      out.reloadTicks = w.klasse === 'armbrust' ? secondsToTicks(w.geschoss?.nachladen ?? C.ranged.crossbowReloadSeconds, 1) : 0;
    } else {
      out.mode = 'nahkampf';
      meleeTiming(out, w.tempo);
      out.speed = 0;
      out.drawTicks = 0;
      out.reloadTicks = 0;
    }
    return out;
  }
  if (def.werkzeug === undefined && def.kategorie !== 'waffe') return fistProfile(out);
  const t = C.tool;
  const kind = def.werkzeug?.art ?? '';
  out.item = def.id;
  out.source = 'werkzeug';
  out.klasse = t.classes[kind] ?? 'keule';
  out.mode = 'nahkampf';
  out.art = t.headTypes[kind] ?? t.schadensart;
  out.damage = def.werte?.schaden ?? weaponDamage(def.stufe, 'schwert') * t.damageFactor;
  out.reach = t.reichweitePx;
  out.arcDeg = t.bogenGrad;
  meleeTiming(out, t.tempoSekunden);
  out.stamina = t.ausdauer;
  out.staggerSeconds = t.staggerSekunden;
  out.wucht = t.wucht;
  out.combo = NO_COMBO;
  out.heavy = 'schlag';
  out.condition = null;
  out.speed = 0;
  out.drawTicks = 0;
  out.reloadTicks = 0;
  out.throwEffect = null;
  out.throwRadius = 0;
  return out;
}

function defaultDraw(klasse: WeaponClass): number {
  if (klasse === 'bogen') return C.ranged.bowDrawSeconds;
  if (klasse === 'schleuder') return C.ranged.slingDrawSeconds;
  return C.ranged.throwDrawSeconds;
}

/** Bag areas searched for ammunition, in order: the hotbar (a conscious choice), then the inventory and the backpack. */
const AMMO_AREAS = ['schnellleiste', 'inventar', 'rucksackfach'] as const;

/** The first ammunition in the bags that `klasse` shoots (item id), or `null`. */
export function findAmmo(bags: BagsState, catalog: ItemCatalog, klasse: AmmoWeaponClass): string | null {
  for (const area of AMMO_AREAS) {
    const slots = bags[area];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i] ?? null;
      if (s === null) continue;
      if (catalog.get(s.item).munition?.fuer === klasse) return s.item;
    }
  }
  return null;
}

/** What a hand blocks with: power 0–1, stamina per absorbed point, walking tempo while blocking. */
export interface BlockProfile {
  /** `block` (shield, weapon, fists), `ziel` (a ranged weapon: aiming, no block). */
  kind: 'block' | 'ziel';
  power: number;
  staminaPerDamage: number;
  tempo: number;
  /** The shield that blocks (`null`: the hand). */
  shield: string | null;
}

/** A fresh block profile. */
export function createBlockProfile(): BlockProfile {
  return { kind: 'block', power: 0, staminaPerDamage: 0, tempo: 1, shield: null };
}

/**
 * What the player blocks with (docs/SPIEL.md §10 "mit Schild blocken, ohne Schild mit Nahkampfwaffe parieren/abwehren, mit
 * Fernwaffe zielen"): a working shield in the off hand (its `schild` block; without one its `werte.blockkraft` at the weapon's
 * stamina), else a ranged weapon in the hand aims, else a melee weapon or tool blocks with `weaponPower`, the bare hand with
 * `fistPower`.
 */
export function blockOf(hand: AttackProfile, offhand: ItemDef | null, offhandStack: ItemStack | null, out: BlockProfile): BlockProfile {
  const B = C.block;
  out.tempo = B.moveFactor;
  out.shield = null;
  if (offhand !== null && offhandStack !== null && offhand.kategorie === 'schild' && offhandStack.haltbarkeit !== 0) {
    const s = offhand.schild;
    out.kind = 'block';
    out.power = s?.blockkraft ?? offhand.werte?.blockkraft ?? B.weaponPower;
    out.staminaPerDamage = s?.ausdauerJeSchaden ?? B.staminaPerDamage;
    out.tempo = B.moveFactor * (s?.tempoFaktor ?? 1);
    out.shield = offhand.id;
    return out;
  }
  if (hand.mode !== 'nahkampf') {
    out.kind = 'ziel';
    out.power = 0;
    out.staminaPerDamage = 0;
    out.tempo = C.aimMode.moveFactor;
    return out;
  }
  out.kind = 'block';
  out.power = hand.source === 'faust' ? B.fistPower : B.weaponPower;
  out.staminaPerDamage = B.staminaPerDamage;
  return out;
}

/** Where the primary button (LMB/RT) goes: an item with a use of its own is used, anything else strikes. */
export type PrimaryRoute = 'use' | 'combat';

/**
 * The route of the primary button for the item in the hand (docs/SPIEL.md §10 "Eingabe"): food, the bandage and other
 * cures, a full bucket, a torch or camp fire to set up and earth to fill are used (`player.useItem`); a weapon, a tool,
 * the empty hand – and anything else without a use of its own – strike (`combat.attack`).
 */
export function primaryRoute(def: ItemDef | null): PrimaryRoute {
  if (def === null) return 'combat';
  if (def.essbar !== undefined || CURES[def.id] !== undefined || def.id === DIG_REFILL_ITEM) return 'use';
  if (BUCKETS.some((b) => b.full === def.id)) return 'use';
  const light = lightKindOfItem(def.id);
  if (light !== undefined && light.moebel === undefined) return 'use';
  return 'combat';
}
