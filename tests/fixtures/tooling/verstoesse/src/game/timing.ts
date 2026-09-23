/** High-resolution clock in a game system (time must come through the loop). */
export function measure(): number {
  return performance.now();
}
