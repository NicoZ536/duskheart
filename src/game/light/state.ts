/**
 * State of the light system (MASTERPROMPT §12.2; M3-22): the carried light (the torch in the off hand or
 * on the belt) and the lights placed in the world (torches on stakes and walls, camp fires). Saved by
 * the participant `light`.
 *
 * Burning is analytic: a torch keeps its remaining burn time as of tick `at` together with the rain of the
 * interval since (`rain`, sampled at world ticks), a fire its fuel and embers as of `at`. Advancing to any
 * later tick is linear (formulas.ts), so a light in a frozen chunk catches up exactly like one that ticked.
 */
import { z } from 'zod';
import { TORCH_MOUNTS } from '../../content/balance/light';
import { idSchema } from '../../content/schema/common';
import { slotRefSchema } from '../inventory/commands';
import type { SlotRef } from '../items/slots';
import type { Layer } from '../../world/model/coords';

/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;

/** Rain over a torch (§10): dry, rain (burns twice as fast), heavy rain (also 5 % per minute to go out). */
export const RAIN_CLASSES = ['trocken', 'regen', 'starkregen'] as const;
/** One rain class. */
export type RainClass = (typeof RAIN_CLASSES)[number];

/** Where a placed light stands: a torch on its stake or on a wall, a fire on the ground. */
export const PLACED_MOUNTS = [...TORCH_MOUNTS, 'boden'] as const;
/** One placement. */
export type PlacedMount = (typeof PLACED_MOUNTS)[number];

/** Where the carried light hangs (§12.2 Nebenhand-Regel): in the off hand, or on the belt (−40 % radius). */
export const CARRY_MODES = ['hand', 'guertel'] as const;
/** One carry mode. */
export type CarryMode = (typeof CARRY_MODES)[number];

/** A burning (or put out) torch. */
export interface TorchBurn {
  lit: boolean;
  /** Remaining burn time at normal speed [ticks] as of `at` (a fresh torch: 4 game hours). */
  rest: number;
  /** Tick the state is advanced to. */
  at: number;
  /** Rain over the torch since `at` (sampled at the last world tick). */
  rain: RainClass;
  /** Ticks this torch burned in heavy rain; every full minute rolls the chance to go out once. */
  heavyTicks: number;
}

/** A camp fire's fuel. */
export interface FireBurn {
  lit: boolean;
  /** Fuel left [ticks] as of `at` (at most 6 minutes, §15.4). */
  fuel: number;
  /** Embers left after the fuel ran out [ticks] as of `at`; fuel added while they glow rekindles the fire. */
  embers: number;
  /** The fire has burned once (it shows ash rather than fresh logs when cold). */
  burned: boolean;
  /** Tick the state is advanced to. */
  at: number;
}

/** A light placed in the world. */
export interface PlacedLight {
  /** Running number, unique within the world (≥ 1; 0 is the carried light). */
  readonly id: number;
  /** Light kind (src/content/lights.ts). */
  readonly kind: string;
  readonly layer: Layer;
  readonly tx: number;
  readonly ty: number;
  readonly mount: PlacedMount;
  /** Torches: their burn. */
  torch: TorchBurn | null;
  /** Fires: their fuel. */
  fire: FireBurn | null;
}

/** The light the player carries (the torch in the off hand or on the belt). */
export interface CarriedLight {
  /** Bag slot of the item. */
  ref: SlotRef;
  readonly item: string;
  readonly kind: string;
  /** The burn time the item brought into the hand (its stack data), `null` for a fresh torch – how it is found again when it leaves the hand. */
  readonly startRest: number | null;
  /** Number of this carried torch (the heavy-rain rolls of every torch are their own). */
  readonly serial: number;
  mode: CarryMode;
  readonly burn: TorchBurn;
}

/** Everything the light system keeps. */
export interface LightState {
  /** Id of the next placed light. */
  nextId: number;
  /** Serial of the last torch that came into the hand. */
  handSerial: number;
  /** Placed lights, ascending id. */
  placed: PlacedLight[];
  carried: CarriedLight | null;
}

/** State of a new world: nothing placed, nothing carried. */
export function createLightState(): LightState {
  return { nextId: 1, handSerial: 0, placed: [], carried: null };
}

const tick = z.number().int().min(0);
const torchBurnSchema = z.object({ lit: z.boolean(), rest: tick, at: tick, rain: z.enum(RAIN_CLASSES), heavyTicks: tick }).strict();
const fireBurnSchema = z.object({ lit: z.boolean(), fuel: tick, embers: tick, burned: z.boolean(), at: tick }).strict();

const placedLightSchema = z
  .object({
    id: z.number().int().min(1),
    kind: idSchema,
    layer: z.number().int().min(LAYER_MIN).max(0),
    tx: z.number().int(),
    ty: z.number().int(),
    mount: z.enum(PLACED_MOUNTS),
    torch: torchBurnSchema.nullable(),
    fire: fireBurnSchema.nullable(),
  })
  .strict()
  .superRefine((l, ctx) => {
    if ((l.torch === null) === (l.fire === null)) ctx.addIssue({ code: 'custom', path: ['torch'], message: 'a placed light is either a torch or a fire' });
    if ((l.fire !== null) !== (l.mount === 'boden')) ctx.addIssue({ code: 'custom', path: ['mount'], message: 'fires stand on the ground, torches on a stake or a wall' });
  });

const carriedLightSchema = z
  .object({
    ref: slotRefSchema,
    item: idSchema,
    kind: idSchema,
    startRest: tick.nullable(),
    serial: z.number().int().min(1),
    mode: z.enum(CARRY_MODES),
    burn: torchBurnSchema,
  })
  .strict();

/** Saved light state (participant `light`, version 1). */
export const lightStateSchema = z
  .object({
    nextId: z.number().int().min(1),
    handSerial: z.number().int().min(0),
    placed: z.array(placedLightSchema),
    carried: carriedLightSchema.nullable(),
  })
  .strict()
  .superRefine((s, ctx) => {
    for (let i = 0; i < s.placed.length; i++) {
      const l = s.placed[i] as { id: number };
      if (l.id >= s.nextId) ctx.addIssue({ code: 'custom', path: ['placed', i, 'id'], message: 'id must be below nextId' });
      if (i > 0 && (s.placed[i - 1] as { id: number }).id >= l.id) ctx.addIssue({ code: 'custom', path: ['placed', i, 'id'], message: 'placed lights must be in ascending id order' });
    }
    if (s.carried !== null && s.carried.serial > s.handSerial) ctx.addIssue({ code: 'custom', path: ['carried', 'serial'], message: 'serial must not exceed handSerial' });
  });

/** A deep copy of a torch burn. */
export function copyTorchBurn(b: TorchBurn): TorchBurn {
  return { lit: b.lit, rest: b.rest, at: b.at, rain: b.rain, heavyTicks: b.heavyTicks };
}

/** A deep copy of a fire burn. */
export function copyFireBurn(f: FireBurn): FireBurn {
  return { lit: f.lit, fuel: f.fuel, embers: f.embers, burned: f.burned, at: f.at };
}

/** A deep copy of the light state (plain JSON data). */
export function copyLightState(s: LightState): LightState {
  return {
    nextId: s.nextId,
    handSerial: s.handSerial,
    placed: s.placed.map((l) => ({ ...l, torch: l.torch === null ? null : copyTorchBurn(l.torch), fire: l.fire === null ? null : copyFireBurn(l.fire) })),
    carried: s.carried === null ? null : { ...s.carried, ref: { ...s.carried.ref }, burn: copyTorchBurn(s.carried.burn) },
  };
}
