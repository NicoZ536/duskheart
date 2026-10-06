/**
 * Pure rules of the map (docs/SPIEL.md §18 "Karte"; M7-49): the cell raster of the reveal, the reveal radius with its height
 * bonus, revealing a disc into a bit mask and the mask's save form (run lengths of its bytes, Base64). Allocation-free except
 * the codec.
 */
import { BALANCE } from '../../content/balance';
import { base64ToBytes, bytesToBase64, rleDecodeU8, rleEncodeU8 } from '../../engine/binary';
import type { Layer } from '../../world/model/coords';
import type { MapMarkerSymbol } from './types';

const M = BALANCE.map;
/** Bits per byte of a mask, the shift from a cell index to its byte and the mask of its bit. */
const BYTE_BITS = 8;
const BYTE_SHIFT = 3;
const BIT_MASK = 7;
/** A byte with every cell set. */
const FULL_BYTE = 0xff;

/** Cells per side of a world of `worldTiles` tiles (the last cell may stick out of the world). */
export function cellsPerSide(worldTiles: number, cellTiles: number = M.cellTiles): number {
  return Math.ceil(worldTiles / cellTiles);
}

/** Bytes of the bit mask of a layer with `side` cells per side. */
export function maskBytes(side: number): number {
  return Math.ceil((side * side) / BYTE_BITS);
}

/** The reveal radius of a player on `layer` at height level `level` [tiles]: 20, plus the height bonus on the surface. */
export function revealRadius(layer: Layer, level: number): number {
  return M.revealRadiusTiles + (layer === 0 && level > 0 ? level * M.heightBonusTiles : 0);
}

/** Whether cell (cx, cy) is set in `mask` (cells outside the raster are not). */
export function cellRevealed(mask: Uint8Array | null, side: number, cx: number, cy: number): boolean {
  if (mask === null || cx < 0 || cy < 0 || cx >= side || cy >= side) return false;
  const i = cy * side + cx;
  return ((mask[i >> BYTE_SHIFT] as number) & (1 << (i & BIT_MASK))) !== 0;
}

/**
 * Sets every cell of `mask` whose centre lies within `radiusTiles` of the centre of tile (tx, ty) (the disc is round at any
 * radius: the cells' centres, not their corners). Returns whether a cell was new.
 */
export function revealDisc(mask: Uint8Array, side: number, cellTiles: number, tx: number, ty: number, radiusTiles: number): boolean {
  const px = tx + 0.5;
  const py = ty + 0.5;
  const r2 = radiusTiles * radiusTiles;
  const half = cellTiles / 2;
  const cx0 = Math.max(0, Math.floor((px - radiusTiles) / cellTiles));
  const cy0 = Math.max(0, Math.floor((py - radiusTiles) / cellTiles));
  const cx1 = Math.min(side - 1, Math.floor((px + radiusTiles) / cellTiles));
  const cy1 = Math.min(side - 1, Math.floor((py + radiusTiles) / cellTiles));
  let changed = false;
  for (let cy = cy0; cy <= cy1; cy++) {
    const dy = cy * cellTiles + half - py;
    const row = cy * side;
    for (let cx = cx0; cx <= cx1; cx++) {
      const dx = cx * cellTiles + half - px;
      if (dx * dx + dy * dy > r2) continue;
      const i = row + cx;
      const byte = i >> BYTE_SHIFT;
      const bit = 1 << (i & BIT_MASK);
      const v = mask[byte] as number;
      if ((v & bit) !== 0) continue;
      mask[byte] = v | bit;
      changed = true;
    }
  }
  return changed;
}

/** Sets every cell of the raster (the debug reveal); the bits past the last cell stay clear. */
export function revealAll(mask: Uint8Array, side: number): void {
  const cells = side * side;
  mask.fill(FULL_BYTE, 0, cells >> BYTE_SHIFT);
  const rest = cells & BIT_MASK;
  if (rest !== 0) mask[cells >> BYTE_SHIFT] = (1 << rest) - 1;
}

/** Number of set cells (tests, statistics). */
export function countRevealed(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    let v = mask[i] as number;
    while (v !== 0) {
      v &= v - 1;
      n++;
    }
  }
  return n;
}

/** The save form of a mask: its bytes run-length encoded (`[count, value]` pairs), as Base64. */
export function encodeMask(mask: Uint8Array): string {
  return bytesToBase64(rleEncodeU8(mask));
}

/** Decodes `encodeMask` into a mask of `bytes` bytes (throws when the length does not match). */
export function decodeMask(text: string, bytes: number): Uint8Array {
  return rleDecodeU8(base64ToBytes(text), bytes);
}

/** A marker's name as it is kept: trimmed, cut to `BALANCE.map.markerNameMax` characters. */
export function markerName(name: string): string {
  return name.trim().slice(0, M.markerNameMax);
}

/** The sprite of each own marker's symbol (assets-src/sprites/ui/karte_marker.ts): flag, tent, cave, ore, chest, skull, drop, star. */
export const MAP_MARKER_SPRITE: Readonly<Record<MapMarkerSymbol, string>> = {
  eigen_1: 'karte_eigen_1',
  eigen_2: 'karte_eigen_2',
  eigen_3: 'karte_eigen_3',
  eigen_4: 'karte_eigen_4',
  eigen_5: 'karte_eigen_5',
  eigen_6: 'karte_eigen_6',
  eigen_7: 'karte_eigen_7',
  eigen_8: 'karte_eigen_8',
};
