/** Squares as products and powers in comments or text are fine in the simulation: x ** 2 here is a comment (M7-76). */
export function squared(value: number): number {
  return value * value;
}

/** Text mentioning the engine's trigonometry is data, not a call. */
export const ENGINE_TRIG = 'Math.sin(a) ** 2 + Math.cos(a) ** 2';
export const POW_CALL = /Math\.pow\(/;
