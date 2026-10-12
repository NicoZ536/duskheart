/** Engine trigonometry and powers in the game simulation: their last bits differ between JS engines (M7-76). */
export function facingVector(angle: number, out: { x: number; y: number }): void {
  out.x = Math.cos(angle);
  out.y = Math.sin(angle);
}

export function falloff(distance: number, exponent: number): number {
  return Math.pow(distance, exponent);
}

export function squared(value: number): number {
  return value ** 2;
}
