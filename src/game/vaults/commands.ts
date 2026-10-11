/**
 * Commands of the vaults (docs/SPIEL.md §19; M7-10 … M7-16, M7-46), aggregated by src/game/commands.ts. In play the player uses
 * a vault's things with E (the interaction system's use targets, src/game/vaults/uses.ts, issue these commands).
 *
 * - `vault.enter {vault}`: down the stairs of the vault in slot `vault` (the player stands at its entrance on the surface).
 * - `vault.leave {vault}`: up the stairs of its start room (the player stands at them on layer −1).
 * - `vault.use {tx, ty}`: the thing on tile (tx, ty) of layer −1 – a lever, a bowl (a burning light in the hand), a bell, a
 *   puzzle's inscription, a cracked wall, a locked door (the vault's key in the bags), a chest, a key or the ember shard on its
 *   pedestal, the reset rune of a crate puzzle, a tablet.
 * - `vault.push {tx, ty}`: pushes the crate on tile (tx, ty) one tile away from the player (who stands beside it).
 * - `tablet.read {tablet}`: reads a Builder tablet (the vault's or a place's mark; the console reads any).
 */
import { z } from 'zod';

const slotSchema = z.number().int().min(0);
const tileSchema = z.number().int().min(0);

export const vaultEnterCommandSchema = z.object({ type: z.literal('vault.enter'), vault: slotSchema }).strict();
export const vaultLeaveCommandSchema = z.object({ type: z.literal('vault.leave'), vault: slotSchema }).strict();
export const vaultUseCommandSchema = z.object({ type: z.literal('vault.use'), tx: tileSchema, ty: tileSchema }).strict();
export const vaultPushCommandSchema = z.object({ type: z.literal('vault.push'), tx: tileSchema, ty: tileSchema }).strict();
export const tabletReadCommandSchema = z.object({ type: z.literal('tablet.read'), tablet: z.string().regex(/^tafel_\d{2}$/) }).strict();

/** Schemas of the vault commands (aggregated by `gameCommandSchema`). */
export const VAULT_COMMAND_SCHEMAS = [vaultEnterCommandSchema, vaultLeaveCommandSchema, vaultUseCommandSchema, vaultPushCommandSchema, tabletReadCommandSchema] as const;
