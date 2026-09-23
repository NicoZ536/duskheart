/** The engine core reads the frame clock (the loop injects it into the simulation). */
export function frameClock(): number {
  return performance.now();
}
