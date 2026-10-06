/**
 * Save slots of a world (MASTERPROMPT §28 "die letzten 3 Autosaves rotierend", "Integritätsprüfung, Wiederherstellung aus
 * älterem Autosave bei Korruption"; docs/SPIEL.md §25 "Speicherslots", §29 "Slots `main`, `auto-1`, `auto-2`, `auto-3`";
 * M7-57).
 *
 * - `main` is the player's own save (pause menu "Speichern", leaving for the title); `auto-1 … auto-3` rotate: an autosave
 *   writes into the slot that is missing, else into the oldest of the three.
 * - Loading a world takes its newest slot (`savedAt`), whichever it is; a slot that fails its integrity check (snapshot
 *   hash, every chunk record's hash, readable world record, compatible build) is skipped for the next older one, and the
 *   caller learns which slots were skipped and why (`readNewestIntactSave` in src/save/world.ts).
 */
import { DEFAULT_CHUNK_SLOT } from './store';

/** Slot of the manual save of a world (the chunk records' default slot). */
export const MAIN_SLOT = DEFAULT_CHUNK_SLOT;
/** The rotating autosave slots, in rotation order. */
export const AUTOSAVE_SLOTS = ['auto-1', 'auto-2', 'auto-3'] as const;
/** One autosave slot. */
export type AutosaveSlot = (typeof AUTOSAVE_SLOTS)[number];
/** Every slot a world can have. */
export const SAVE_SLOTS = [MAIN_SLOT, ...AUTOSAVE_SLOTS] as const;

/** A stored slot as the rotation sees it. */
export interface SlotStamp {
  readonly slot: string;
  /** Wall-clock time of the save [epoch ms]. */
  readonly savedAt: number;
}

/** Whether `slot` is one of the rotating autosaves. */
export function isAutosaveSlot(slot: string): slot is AutosaveSlot {
  return (AUTOSAVE_SLOTS as readonly string[]).includes(slot);
}

/** The slot the next autosave writes: the first missing one in rotation order, else the oldest (ties: rotation order). */
export function nextAutosaveSlot(stored: readonly SlotStamp[]): AutosaveSlot {
  let oldest: AutosaveSlot | null = null;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const slot of AUTOSAVE_SLOTS) {
    const s = stored.find((x) => x.slot === slot);
    if (s === undefined) return slot;
    if (s.savedAt < oldestAt) {
      oldest = slot;
      oldestAt = s.savedAt;
    }
  }
  return oldest ?? AUTOSAVE_SLOTS[0];
}

/** The slots in the order loading tries them: newest first (ties: `main` before the autosaves, then rotation order). */
export function slotsNewestFirst(stored: readonly SlotStamp[]): SlotStamp[] {
  const rank = (slot: string): number => {
    const i = (SAVE_SLOTS as readonly string[]).indexOf(slot);
    return i < 0 ? SAVE_SLOTS.length : i;
  };
  return [...stored].sort((a, b) => b.savedAt - a.savedAt || rank(a.slot) - rank(b.slot) || (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
}
