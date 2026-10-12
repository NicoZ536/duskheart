/** Presentation may use the engine's trigonometry: no simulation state depends on its last bit. */
export function wave(t: number): number {
  return Math.sin(t) ** 2 + Math.pow(Math.cos(t), 2);
}
