/**
 * What mending a damaged build part costs (MASTERPROMPT §16.6 "Flächenreparatur", §13.1 "Reparatur … anteilige
 * Materialkosten"; M4-25): the share `BALANCE.building.repair.materialShare` of the part's materials (the
 * ingredients of the recipe that makes its item, `MaterialBook`), scaled by the hit points it lacks – a part at half
 * its hit points costs half of that – and rounded up per material, so every repair costs at least one piece of each
 * material it touches. Pure functions; the building system's `build.repair` pays and mends.
 */
import type { ItemAmount, PartMaterial } from './materials';

/**
 * Items that mend a part of `materials` (per piece) from `hp` to `maxHp` hit points with the material share `share`
 * [items]; empty when nothing is missing. An item listed twice (a group of a recipe that resolves to an item the recipe
 * also names) is one material: its pieces are added up before rounding, and it appears once, where it first appeared –
 * so paying the cost never counts the same item twice.
 */
export function repairCost(materials: readonly PartMaterial[], hp: number, maxHp: number, share: number): ItemAmount[] {
  if (maxHp <= 0 || hp >= maxHp) return [];
  const missing = (maxHp - Math.max(0, hp)) / maxHp;
  const perPiece = new Map<string, number>();
  for (const m of materials) perPiece.set(m.item, (perPiece.get(m.item) ?? 0) + m.perPiece);
  const out: ItemAmount[] = [];
  for (const [item, pieces] of perPiece) {
    const count = Math.ceil(pieces * share * missing);
    if (count > 0) out.push({ item, count });
  }
  return out;
}
