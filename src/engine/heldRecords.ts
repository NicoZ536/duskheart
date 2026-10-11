/**
 * Held records whose fields take fractional numbers every frame or tick (§30 "keine Allokationen in Hot-Loops"; M7-78,
 * ADR-0222 "Bruchzahl-Felder starten mit DOUBLE_FIELD").
 *
 * An object literal shares its hidden class with every literal of the same keys in the program: `{ x: 0, y: 0 }` with the
 * zod schemas' `{ x: z.number(), y: z.number() }` among them, whose fields hold objects – so V8 lets those fields hold any
 * value, and every fractional number stored into one is boxed anew (16 B a store). A class has a hidden class of its own;
 * its fields start as fractional numbers (`DOUBLE_FIELD`), so V8 lays them out as number fields that a store updates in
 * place – also in code that is not optimised.
 */

/** First value of a fractional field: a double from the start. */
export const DOUBLE_FIELD = Number.NaN;

/** A point [world px] that a sampler overwrites in place (`PlayerSystem.position` and the like). */
export class HeldPoint {
  x = DOUBLE_FIELD;
  y = DOUBLE_FIELD;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
}
