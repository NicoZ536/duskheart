/**
 * Export and import of worlds as `.dhsave` files and seed sharing (MASTERPROMPT §28 "Export/Import als Datei (`.dhsave`,
 * gzip über CompressionStream); Seed teilen"; docs/SPIEL.md §25 "Export/Import"; M7-58).
 *
 * - A `.dhsave` is the gzip of a world dump's text (src/save/dump.ts: canonical JSON with the save version): one slot – the
 *   newest intact one – filed as `main`, with its chunk records (plain) and the world's blobs. Nothing else: no settings,
 *   no other slots.
 * - Importing checks the file (gzip, dump schema, every record of one world, a save version this build reads) and files the
 *   world under a new id beside the player's worlds – an import never replaces a world. The world loads like every save
 *   (migrations, integrity check).
 * - Seed sharing: "DH-<Seed>-<Größe>" (`shareSeedText`), read back by the new-world screen (`parseSharedSeed`; a bare
 *   number is a seed as well).
 */
import { U32_MAX } from '../engine/rng';
import type { WorldSizePreset } from '../content/balance';
import { gunzip, gzip } from './chunkPack';
import { exportWorldSlot, importWorld, parseWorldDumpText, worldDumpText, type WorldDump } from './dump';
import { SaveError } from './registry';
import type { SaveStore, WorldMeta } from './store';

/** File extension of an exported world. */
export const DHSAVE_EXTENSION = '.dhsave';
/** Media type of an exported world (a gzip stream). */
export const DHSAVE_MIME = 'application/gzip';
/** Prefix of a shared seed. */
export const SEED_SHARE_PREFIX = 'DH';
/** World sizes in shared seeds. */
const SHARE_SIZES: readonly WorldSizePreset[] = ['small', 'medium', 'large'];
/** Longest world name kept in a file name [characters]. */
const FILE_NAME_CHARS = 40;

/** The `.dhsave` bytes of a dump: gzip of its text. */
export async function encodeDhsave(dump: WorldDump): Promise<Uint8Array> {
  return gzip(new TextEncoder().encode(worldDumpText(dump)));
}

/** The dump of `.dhsave` bytes, validated. Throws `SaveError` naming what is wrong (no gzip, no dump, newer build …). */
export async function decodeDhsave(bytes: Uint8Array): Promise<WorldDump> {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await gunzip(bytes));
  } catch (err) {
    throw new SaveError(`Not a DUSKHEARTH save file: ${(err as Error).message}`);
  }
  return parseWorldDumpText(text);
}

/** A file name for the export of `meta`: the world's name (letters, digits, dashes) and its seed. */
export function dhsaveFileName(meta: Pick<WorldMeta, 'name' | 'seed'>): string {
  const base = meta.name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, FILE_NAME_CHARS)
    .toLowerCase();
  return `${base === '' ? 'welt' : base}-${meta.seed}${DHSAVE_EXTENSION}`;
}

/** Exports world `worldId` (its newest intact slot) as `.dhsave` bytes with a file name. Throws `SaveError`. */
export async function exportDhsave(store: SaveStore, worldId: string): Promise<{ readonly fileName: string; readonly bytes: Uint8Array; readonly dump: WorldDump }> {
  const dump = await exportWorldSlot(store, worldId);
  return { fileName: dhsaveFileName(dump.world), bytes: await encodeDhsave(dump), dump };
}

/** Where an imported world is filed: a fresh id and its name. */
export interface ImportTarget {
  readonly worldId: string;
  readonly name: string;
}

/**
 * Imports `.dhsave` bytes as a new world: `target` names its id and name – given, or chosen from the file's world meta
 * (the menu takes a fresh id from the world's seed and keeps its name). Throws `SaveError` on a file that is no valid
 * save; nothing is written then.
 */
export async function importDhsave(store: SaveStore, bytes: Uint8Array, target: ImportTarget | ((world: WorldMeta) => ImportTarget)): Promise<WorldMeta> {
  const dump = await decodeDhsave(bytes);
  return importWorld(store, dump, typeof target === 'function' ? target(dump.world) : target);
}

/** The shared text of a seed: "DH-<seed>-<size>" with the size's id (`small`, `medium`, `large`), the same in every language. */
export function shareSeedText(seed: number, size: WorldSizePreset): string {
  return `${SEED_SHARE_PREFIX}-${seed}-${size}`;
}

/** Seed and size of a shared text ("DH-<seed>-<size>", case and spaces ignored), a bare seed (size null), or null. */
export function parseSharedSeed(text: string): { readonly seed: number; readonly size: WorldSizePreset | null } | null {
  const t = text.trim();
  const bare = /^\d+$/.exec(t);
  if (bare !== null) {
    const seed = Number(t);
    return Number.isSafeInteger(seed) && seed <= U32_MAX ? { seed, size: null } : null;
  }
  const m = /^DH-(\d+)-([a-z]+)$/i.exec(t.replace(/\s+/g, ''));
  if (m === null) return null;
  const seed = Number(m[1]);
  const size = (m[2] as string).toLowerCase() as WorldSizePreset;
  if (!Number.isSafeInteger(seed) || seed > U32_MAX || !SHARE_SIZES.includes(size)) return null;
  return { seed, size };
}
