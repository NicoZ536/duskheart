/**
 * Room templates as grids (docs/SPIEL.md §19 "Einbettung"; M7-10, M7-11): the ASCII templates of the content (`roomTemplates`,
 * src/content/dungeons/<tileset>/) compiled once into per-tile arrays – wall, floor, door socket, the way up, the tileset's
 * decor objects – and their slots by kind. Templates are never turned (rotation 0): every side of every cell carries a socket in
 * its middle, so any two rooms whose cells touch meet with their doors (src/content/dungeons/schema.ts `DOOR_OFFSET`).
 */
import { CONTENT } from '../../../content/index';
import { ROOM_CELL_TILES, ROOM_DOOR, ROOM_ENTRANCE, ROOM_FLOOR, ROOM_WALL, type RoomSlotKind, type RoomTemplateDef, type VaultRole, type VaultTilesetDef } from '../../../content/dungeons/schema';

/** Tile kinds of a compiled template. */
export const T_WALL = 0;
export const T_FLOOR = 1;
export const T_SOCKET = 2;
export const T_ENTRANCE = 3;

export interface CompiledTemplate {
  readonly def: RoomTemplateDef;
  readonly w: number;
  readonly h: number;
  /** `T_*` per tile, row-major. */
  readonly kind: Uint8Array;
  /** Decor object id per tile (`null`: none). */
  readonly object: readonly (string | null)[];
  /** Whether the decor object of a tile blocks (pillars, statues). */
  readonly blocking: Uint8Array;
  /** Slots by kind, in template order. */
  readonly slots: ReadonlyMap<RoomSlotKind, readonly { readonly tx: number; readonly ty: number }[]>;
  /** Sides with a socket per cell: `has(seite, zelle)`. */
  hasSocket(seite: 'n' | 'o' | 's' | 'w', zelle: number): boolean;
}

/** Compiles one template with the legend of its tileset. */
export function compileTemplate(def: RoomTemplateDef, tileset: VaultTilesetDef, blockingOf: (object: string) => boolean): CompiledTemplate {
  const w = def.zellen.b * ROOM_CELL_TILES;
  const h = def.zellen.t * ROOM_CELL_TILES;
  const kind = new Uint8Array(w * h);
  const object: (string | null)[] = new Array<string | null>(w * h).fill(null);
  const blocking = new Uint8Array(w * h);
  def.zeilen.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row.charAt(x);
      const i = y * w + x;
      if (ch === ROOM_WALL) kind[i] = T_WALL;
      else if (ch === ROOM_DOOR) kind[i] = T_SOCKET;
      else if (ch === ROOM_ENTRANCE) kind[i] = T_ENTRANCE;
      else if (ch === ROOM_FLOOR) kind[i] = T_FLOOR;
      else {
        const cell = tileset.legende[ch];
        if (cell === undefined) throw new RangeError(`Room template ${def.id}: "${ch}" is not in the legend of tileset ${tileset.id}`);
        kind[i] = T_FLOOR;
        object[i] = cell.objekt ?? null;
        if (cell.objekt !== undefined && blockingOf(cell.objekt)) blocking[i] = 1;
      }
    }
  });
  const slots = new Map<RoomSlotKind, { tx: number; ty: number }[]>();
  for (const p of def.plaetze) {
    const list = slots.get(p.art) ?? [];
    list.push({ tx: p.tx, ty: p.ty });
    slots.set(p.art, list);
  }
  const sockets = new Set(def.tueren.map((d) => `${d.seite}${d.zelle}`));
  return { def, w, h, kind, object, blocking, slots, hasSocket: (seite, zelle) => sockets.has(`${seite}${zelle}`) };
}

/** The compiled templates of one tileset by role (content order), built once. */
export interface TilesetTemplates {
  readonly tileset: VaultTilesetDef;
  readonly byRole: ReadonlyMap<VaultRole, readonly CompiledTemplate[]>;
  readonly byId: ReadonlyMap<string, CompiledTemplate>;
}

let compiled: ReadonlyMap<string, TilesetTemplates> | null = null;

/** Every tileset of the content with its compiled templates (by tileset id). */
export function contentVaultTilesets(): ReadonlyMap<string, TilesetTemplates> {
  if (compiled !== null) return compiled;
  const objects = CONTENT.collection('worldObjects');
  const blockingOf = (id: string): boolean => objects.find(id)?.blocking ?? false;
  const out = new Map<string, TilesetTemplates>();
  for (const tileset of CONTENT.collection('vaultTilesets').values()) {
    const byRole = new Map<VaultRole, CompiledTemplate[]>();
    const byId = new Map<string, CompiledTemplate>();
    for (const def of CONTENT.collection('roomTemplates').values()) {
      if (def.tileset !== tileset.id) continue;
      const t = compileTemplate(def, tileset, blockingOf);
      byId.set(def.id, t);
      const list = byRole.get(def.rolle) ?? [];
      list.push(t);
      byRole.set(def.rolle, list);
    }
    out.set(tileset.id, { tileset, byRole, byId });
  }
  compiled = out;
  return out;
}

/** The tileset of a biome, or undefined (a vault of that biome has no plan yet). */
export function tilesetOfBiome(biome: string): TilesetTemplates | undefined {
  for (const t of contentVaultTilesets().values()) if (t.tileset.biom === biome) return t;
  return undefined;
}
