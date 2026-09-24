/**
 * Pure numbers of the bag operations (MASTERPROMPT §13.1, §26 "Rechtsklick teilt"; tested in
 * tests/unit/game/inventar.test.ts).
 */

/** Items that move onto a stack of `targetCount` in a slot of `capacity` when `requested` are offered [items]. */
export function transferAmount(targetCount: number, requested: number, capacity: number): number {
  const room = capacity - targetCount;
  return room <= 0 ? 0 : requested < room ? requested : room;
}

/** Items that split off a stack of `count` (the smaller half; 0 for a single item) [items]. */
export function splitAmount(count: number): number {
  return Math.floor(count / 2);
}

/** Hotbar slot after scrolling `delta` notches from `index` over `slots` slots, wrapping around. */
export function scrolledIndex(index: number, delta: number, slots: number): number {
  return (((index + delta) % slots) + slots) % slots;
}
