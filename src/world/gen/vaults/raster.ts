/**
 * A vault's plan as tiles (docs/SPIEL.md §19 "Innenebene", "Einbettung"; M7-10, M7-11): the box on layer −1 as per-tile arrays –
 * Builder stone wherever no room is (the hull), the rooms' floors, walls and decor, the doorways of the open edges, the walls of
 * the puzzles (kisten maps, the hidden walls' niche), the chests and tablets as objects, the way up. Doors, crates, levers,
 * bowls, bells, hidden walls, key and shard pedestals and the traps are not tiles: they change, so the vault system keeps them
 * (collision overlay, src/game/vaults/) and the game view draws them (src/render/game/vaults.ts).
 *
 * The raster is a pure function of the plan and the content; the underground chunk generator stamps it into layer −1
 * (src/world/gen/underground/chunk.ts), the tests and the vault system read it.
 */
import { DOOR_OFFSET, doorSocketTiles } from '../../../content/dungeons/schema';
import { TILE_FLAG_PLACE, TILE_FLAG_RAMP, type ChunkData } from '../../model/chunk';
import { CHUNK_SIZE } from '../../model/coords';
import { contentWorldIdTables } from '../../model/runtimeIds';
import { contentVaultTilesets, T_ENTRANCE, T_SOCKET, T_WALL, type CompiledTemplate } from './templates';
import type { VaultPlan } from './types';

/** Object of a vault's chest by tier (the places' chests, src/content/places/objekte.ts). */
export function vaultChestObject(tier: number): string {
  return `ort_truhe_${tier}`;
}
/** The tablet and the stairs up (src/content/dungeons/objekte.ts). */
export const VAULT_TABLET_OBJECT = 'ort_erbauer_tafel';
export const VAULT_STAIRS_UP_OBJECT = 'ort_gw_aufgang';
export const VAULT_STAIRS_DOWN_OBJECT = 'ort_gw_abgang';
/** The hole a collapsed floor leaves (trap `einsturzboden`). */
export const VAULT_COLLAPSED_OBJECT = 'ort_gw_einsturz';
/** The object an opened chest becomes (like a place's, src/game/places/system.ts `OPEN_CHEST_OBJECT`). */
export const VAULT_OPEN_CHEST_OBJECT = 'ort_truhe_offen';

/** Tiles of a vault's box. */
export interface VaultRaster {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  /** 1 = Builder stone (the tileset's wall). */
  readonly solid: Uint8Array;
  /** Object id per tile (`null`: none). */
  readonly object: readonly (string | null)[];
  /** Index of the way up (the entrance tile). */
  readonly entrance: number;
  readonly floorTerrain: string;
  readonly wallTerrain: string;
}

const rasters = new WeakMap<VaultPlan, VaultRaster>();

/** The template of a placed room (throws when the content has none: a plan names only content templates). */
export function placedTemplate(tileset: string, template: string): CompiledTemplate {
  const t = contentVaultTilesets().get(tileset)?.byId.get(template);
  if (t === undefined) throw new RangeError(`Vault template ${template} of tileset ${tileset} is not in the content`);
  return t;
}

/** Rasterizes a plan (cached per plan object). */
export function vaultRaster(plan: VaultPlan): VaultRaster {
  const cached = rasters.get(plan);
  if (cached !== undefined) return cached;
  const { x0, y0, w, h } = plan.box;
  const set = contentVaultTilesets().get(plan.tileset);
  if (set === undefined) throw new RangeError(`Vault tileset ${plan.tileset} is not in the content`);
  const solid = new Uint8Array(w * h).fill(1);
  const object: (string | null)[] = new Array<string | null>(w * h).fill(null);
  const inBox = (tx: number, ty: number): number => (tx < x0 || ty < y0 || tx >= x0 + w || ty >= y0 + h ? -1 : (ty - y0) * w + (tx - x0));
  for (const r of plan.rooms) {
    const t = placedTemplate(plan.tileset, r.template);
    for (let y = 0; y < t.h; y++) {
      for (let x = 0; x < t.w; x++) {
        const i = inBox(r.x0 + x, r.y0 + y);
        if (i < 0) continue;
        const k = t.kind[y * t.w + x] as number;
        // Sockets stay wall unless an edge uses them (below).
        solid[i] = k === T_WALL || k === T_SOCKET ? 1 : 0;
        object[i] = t.object[y * t.w + x] ?? null;
        if (k === T_ENTRANCE) object[i] = VAULT_STAIRS_UP_OBJECT;
      }
    }
  }
  // Doorways: every edge opens the sockets on both sides (a closed door or a hidden wall lies on them as an overlay).
  for (const opening of doorways(plan)) for (const [tx, ty] of opening) {
    const i = inBox(tx, ty);
    if (i >= 0) solid[i] = 0;
  }
  for (const p of plan.puzzles) for (const s of p.solid) {
    const i = inBox(s.tx, s.ty);
    if (i >= 0) solid[i] = 1;
  }
  for (const c of plan.chests) {
    const i = inBox(c.tx, c.ty);
    if (i >= 0 && !c.mimic) object[i] = vaultChestObject(c.tier);
  }
  for (const t of plan.tablets) {
    const i = inBox(t.tx, t.ty);
    if (i >= 0) object[i] = VAULT_TABLET_OBJECT;
  }
  const raster: VaultRaster = { x0, y0, w, h, solid, object, entrance: inBox(plan.entrance.tx, plan.entrance.ty), floorTerrain: set.tileset.boden, wallTerrain: set.tileset.wand };
  rasters.set(plan, raster);
  return raster;
}

/** The socket tiles each edge of the plan opens (both rooms' sides), as absolute tiles. */
export function doorways(plan: VaultPlan): (readonly [number, number])[][] {
  const out: (readonly [number, number])[][] = [];
  for (const d of plan.openings) out.push(d.tiles.map((t) => [t.tx, t.ty] as const));
  return out;
}

/** The socket tiles of door socket `d` of a placed room, absolute. */
export function socketTilesAt(room: { readonly x0: number; readonly y0: number }, t: CompiledTemplate, seite: 'n' | 'o' | 's' | 'w', zelle: number): [number, number][] {
  return doorSocketTiles({ seite, zelle, versatz: DOOR_OFFSET }, t.def.zellen.b, t.def.zellen.t).map(([x, y]) => [room.x0 + x, room.y0 + y]);
}

/**
 * Stamps the part of a vault's box that lies in `chunk` (layer −1; the underground chunk generator, last): Builder stone and
 * floor, decor, chests and tablets, the biome of the entrance (tileset, tint), no water; `TILE_FLAG_PLACE` on every box tile,
 * `TILE_FLAG_RAMP` on the way up. Nothing when the box misses the chunk.
 */
export function stampVault(chunk: ChunkData, plan: VaultPlan): void {
  const { x0, y0, w, h } = plan.box;
  const bx = chunk.cx * CHUNK_SIZE;
  const by = chunk.cy * CHUNK_SIZE;
  if (x0 >= bx + CHUNK_SIZE || y0 >= by + CHUNK_SIZE || x0 + w <= bx || y0 + h <= by) return;
  const tables = contentWorldIdTables();
  const r = vaultRaster(plan);
  const wall = tables.terrain.runtimeId(r.wallTerrain);
  const floor = tables.terrain.runtimeId(r.floorTerrain);
  const biome = tables.biomes.runtimeId(plan.biome);
  for (let ty = Math.max(by, y0); ty < Math.min(by + CHUNK_SIZE, y0 + h); ty++) {
    for (let tx = Math.max(bx, x0); tx < Math.min(bx + CHUNK_SIZE, x0 + w); tx++) {
      const t = (ty - by) * CHUNK_SIZE + (tx - bx);
      const i = (ty - y0) * w + (tx - x0);
      const o = r.object[i] ?? null;
      chunk.solid[t] = r.solid[i] === 1 ? wall : 0;
      chunk.ground[t] = floor;
      chunk.water[t] = 0;
      chunk.biome[t] = biome;
      chunk.object[t] = o === null ? 0 : tables.objects.runtimeId(o);
      chunk.flags[t] = i === r.entrance ? TILE_FLAG_RAMP | TILE_FLAG_PLACE : TILE_FLAG_PLACE;
    }
  }
}
