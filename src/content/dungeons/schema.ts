/**
 * The Builders' vaults (docs/SPIEL.md §19, MASTERPROMPT §21; ADR-0207; strand C – collections `roomTemplates`,
 * `vaultTilesets`, `puzzleTypes`, `vaultTraps`, `tablets`): ASCII room templates of 16 × 16 tiles per cell, the tileset of a
 * biome, the puzzle types with their variants (each solvable by its solver), the vault traps (named apart from the M6 traps
 * `traps`) and the Builder tablets. The zod schemas producing these types are strand C's.
 */
import type { DamageTypeId } from '../balance/combat';
import type { LocalizedText } from '../schema/common';

export const VAULT_ROLES = ['start', 'gang', 'kammer', 'schluessel', 'schloss', 'raetsel', 'falle', 'schatz', 'endkammer'] as const;
export type VaultRole = (typeof VAULT_ROLES)[number];
export const ROOM_SLOTS = ['raetsel', 'falle', 'truhe', 'waechter', 'tafel', 'splitter', 'boss'] as const;
export type RoomSlotKind = (typeof ROOM_SLOTS)[number];

/** ASCII room template (`src/content/dungeons/<tileset>/<id>.ts`): 16 × 16 tiles per cell. */
export interface RoomTemplateDef {
  readonly id: string;
  readonly tileset: string;
  readonly rolle: VaultRole;
  readonly zellen: { readonly b: 1 | 2; readonly t: 1 | 2 };
  /** 16·b chars × 16·t rows; legend of the tileset (`#` wall, `.` floor, `D` door socket …). */
  readonly zeilen: readonly string[];
  readonly tueren: readonly { readonly seite: 'n' | 'o' | 's' | 'w'; readonly zelle: number; readonly versatz: number }[];
  readonly plaetze: readonly { readonly art: RoomSlotKind; readonly tx: number; readonly ty: number }[];
}
export interface VaultTilesetDef {
  readonly id: string;
  readonly biom: string;
  readonly boden: string;
  readonly wand: string;
  readonly legende: Readonly<Record<string, { readonly boden?: string; readonly objekt?: string }>>;
}
/** One puzzle variant; solvable by the solver of its type (unit test per variant). */
export type PuzzleVariantDef =
  | { readonly typ: 'kisten'; readonly id: string; readonly karte: readonly string[] }
  | { readonly typ: 'hebel'; readonly id: string; readonly hebel: number; readonly folge: readonly number[] }
  | { readonly typ: 'feuerschalen'; readonly id: string; readonly schalen: number; readonly folge: readonly number[] }
  | { readonly typ: 'verborgene_wand'; readonly id: string; readonly waende: number; readonly echt: readonly number[] }
  | { readonly typ: 'glocken'; readonly id: string; readonly glocken: number; readonly toene: readonly number[]; readonly folge: readonly number[] };
export interface PuzzleTypeDef {
  readonly id: PuzzleVariantDef['typ'];
  readonly name: LocalizedText;
  readonly beschreibung: LocalizedText;
  readonly hinweis: LocalizedText;
  readonly varianten: readonly PuzzleVariantDef[];
}
export interface VaultTrapDef {
  readonly id: string;
  readonly name: LocalizedText;
  readonly schaden: number;
  readonly schadensart: DamageTypeId;
  /** Warning before it strikes [s] (≥ 0.4, §4.6). */
  readonly telegraphSekunden: number;
  readonly abklingSekunden: number;
  readonly ausloeser: 'platte' | 'naehe' | 'takt';
  /** Rolling stone: back after this many seconds; collapsing floor: stays open (chunk diff). */
  readonly resetSekunden?: number;
  readonly bleibtOffen?: boolean;
  readonly sprite: string;
  readonly sound: string;
}
export interface TabletDef {
  readonly id: string;
  readonly nummer: number;
  readonly titel: LocalizedText;
  readonly text: LocalizedText;
  readonly fundort: { readonly art: 'gewoelbe'; readonly rolle?: VaultRole } | { readonly art: 'ort'; readonly ortstyp: string };
}
