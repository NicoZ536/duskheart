/**
 * Palette row construction: a variant row remaps whole ramps onto other ramps (step i of a ramp with
 * n steps → the proportional step of the target ramp), so a green crown becomes autumn-red, frosted
 * or corrupted without new sprites (MASTERPROMPT §4.3).
 */
import { identityRow, PALETTE_SIZE, type PaletteRow } from './lut';

export interface RampInfo {
  readonly name: string;
  readonly size: number;
}

/** First palette index (1-based) of every ramp. */
function rampOffsets(ramps: readonly RampInfo[]): Map<string, RampInfo & { readonly offset: number }> {
  const out = new Map<string, RampInfo & { readonly offset: number }>();
  let offset = 1;
  for (const r of ramps) {
    out.set(r.name, { ...r, offset });
    offset += r.size;
  }
  if (offset - 1 !== PALETTE_SIZE) throw new Error(`Palette: Rampen ergeben ${offset - 1} statt ${PALETTE_SIZE} Farben`);
  return out;
}

/** A row that maps each `from` ramp onto its `to` ramp (`{ gras: 'laub' }`); other colours stay. */
export function rampRemapRow(name: string, ramps: readonly RampInfo[], remaps: Readonly<Record<string, string>>): PaletteRow {
  const offsets = rampOffsets(ramps);
  const map = Array.from(identityRow().map);
  for (const [fromName, toName] of Object.entries(remaps)) {
    const from = offsets.get(fromName);
    const to = offsets.get(toName);
    if (!from || !to) throw new Error(`Palettenzeile ${name}: Rampe ${from ? toName : fromName} fehlt`);
    for (let i = 0; i < from.size; i++) {
      const step = from.size === 1 ? 0 : Math.round((i * (to.size - 1)) / (from.size - 1));
      map[from.offset - 1 + i] = to.offset + step;
    }
  }
  return { name, map };
}

/**
 * Palette index (1…64) of a reference `rampe.stufe` (0-based step, like the sprite legends of
 * docs/RENDER.md §1), e.g. `feuer.2`. Throws for unknown ramps and steps outside the ramp.
 */
export function paletteRefIndex(ref: string, ramps: readonly RampInfo[]): number {
  const dot = ref.indexOf('.');
  const ramp = rampOffsets(ramps).get(ref.slice(0, dot));
  const step = Number(ref.slice(dot + 1));
  if (dot < 0 || ramp === undefined) throw new Error(`Palette: unbekannte Rampe in „${ref}“`);
  if (!Number.isInteger(step) || step < 0 || step >= ramp.size) throw new Error(`Palette: Stufe ${ref.slice(dot + 1)} fehlt in Rampe ${ramp.name}`);
  return ramp.offset + step;
}

/** Colour `#rrggbb` of a reference `rampe.stufe` in the master palette `paletteHex` (64 colours). */
export function paletteRefHex(ref: string, ramps: readonly RampInfo[], paletteHex: readonly string[]): string {
  const hex = paletteHex[paletteRefIndex(ref, ramps) - 1];
  if (hex === undefined) throw new Error(`Palette: ${ref} liegt außerhalb der Palette`);
  return hex;
}
