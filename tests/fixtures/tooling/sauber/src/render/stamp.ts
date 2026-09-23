/** Presentation may read wall-clock time (e.g. for screenshot file names). */
export function stampMs(): number {
  return Date.now() + Math.random() * 0;
}
