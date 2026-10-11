/**
 * Saved state of the vaults (participant `vaults`, data version 1; docs/SPIEL.md §19, §27): one `VaultState` per entered vault –
 * doors, chests, hidden walls, keys and the shard taken, the puzzles' encoded states, the traps' timers, the guards risen and the
 * mini-boss defeated. A vault nobody entered has no entry: everything else is the world generator's plan. Collapsed floors and
 * opened chests are chunk changes (saved with the chunk diffs).
 */
import { z } from 'zod';
import type { VaultState } from './types';

/** "Ready" in `trapReadyTick` and "not warning" in `trapArmedTick`. */
export const TRAP_READY = -1;
/** A trap that struck for good (a collapsed floor: it stays a hole). */
export const TRAP_SPENT = -2;

/** A fresh state of the vault in `slot` with `puzzles` puzzles (their initial encoded states) and `traps` traps. */
export function newVaultState(slot: number, puzzles: readonly (readonly number[])[], traps: number): VaultState {
  return {
    slot,
    entered: false,
    completed: false,
    doorsOpen: 0,
    chestsOpened: 0,
    hiddenFound: 0,
    keysTaken: 0,
    puzzles: puzzles.map((p) => [...p]),
    trapReadyTick: new Array<number>(traps).fill(TRAP_READY),
    bossDefeated: false,
    shardTaken: false,
    guardsRisen: false,
    trapArmedTick: new Array<number>(traps).fill(TRAP_READY),
    puzzleReadyTick: new Array<number>(puzzles.length).fill(0),
    hint: [],
  };
}

const bits = z.number().int().min(0);
const tick = z.number().int().min(TRAP_SPENT);

export const vaultStateSchema = z
  .object({
    slot: z.number().int().min(0),
    entered: z.boolean(),
    completed: z.boolean(),
    doorsOpen: bits,
    chestsOpened: bits,
    hiddenFound: bits,
    keysTaken: bits,
    puzzles: z.array(z.array(z.number().int())),
    trapReadyTick: z.array(tick),
    bossDefeated: z.boolean(),
    shardTaken: z.boolean(),
    guardsRisen: z.boolean(),
    trapArmedTick: z.array(tick),
    puzzleReadyTick: z.array(z.number().int().min(0)),
    hint: z.union([z.tuple([]), z.tuple([z.number().int().min(0), z.number().int().min(0)])]),
  })
  .strict()
  .refine((s) => s.trapArmedTick.length === s.trapReadyTick.length, { message: 'one warning tick per trap', path: ['trapArmedTick'] })
  .refine((s) => s.puzzleReadyTick.length === s.puzzles.length, { message: 'one ready tick per puzzle', path: ['puzzleReadyTick'] });

/** Snapshot of the participant: the entered vaults in slot order. */
export const vaultsSnapshotSchema = z.object({ vaults: z.array(vaultStateSchema) }).strict();
export type VaultsSnapshot = z.output<typeof vaultsSnapshotSchema>;

/** Copies a state (snapshots never share arrays with the live state). */
export function copyVaultState(s: Readonly<VaultState>): VaultState {
  return {
    slot: s.slot,
    entered: s.entered,
    completed: s.completed,
    doorsOpen: s.doorsOpen,
    chestsOpened: s.chestsOpened,
    hiddenFound: s.hiddenFound,
    keysTaken: s.keysTaken,
    puzzles: s.puzzles.map((p) => [...p]),
    trapReadyTick: [...s.trapReadyTick],
    bossDefeated: s.bossDefeated,
    shardTaken: s.shardTaken,
    guardsRisen: s.guardsRisen,
    trapArmedTick: [...s.trapArmedTick],
    puzzleReadyTick: [...s.puzzleReadyTick],
    hint: [...s.hint],
  };
}
