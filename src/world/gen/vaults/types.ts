/**
 * Vault plans of the generated world (docs/SPIEL.md §19 "Generator", ADR-0207; strand C): the generator's step `gewoelbe`
 * builds one plan per vault slot – graph grammar (start → rooms → keys and locks → puzzles → end chamber), embedding of the
 * room templates in a grid of 16 × 16-tile cells inside a reserved box on layer −1, and the placing of puzzles, traps,
 * chests, guards, tablets and the ember shard. `GeneratedWorld.vaults` – a pure function of seed, size and content; never saved.
 */
import type { VaultRole } from '../../../content/dungeons/schema';
import type { QuarterTurn } from '../places/types';

/** Chest tier of a room by its depth (0 = no chest). */
export type ChestTier = 0 | 1 | 2 | 3;

export const VAULT_EDGE_KINDS = ['offen', 'schloss', 'raetsel', 'verborgen'] as const;
export type VaultEdgeKind = (typeof VAULT_EDGE_KINDS)[number];
export interface VaultNode {
  readonly id: number;
  readonly role: VaultRole;
  /** Steps from the start (chest tier grows with it). */
  readonly depth: number;
  /** Door id the key lying here opens, or −1. */
  readonly keyFor: number;
  readonly puzzle: { readonly type: string; readonly variant: string } | null;
  readonly traps: readonly string[];
  readonly chestTier: ChestTier;
  readonly guards: readonly string[];
  readonly tablet: string | null;
  readonly shard: boolean;
}
export interface VaultEdge {
  readonly a: number;
  readonly b: number;
  readonly kind: VaultEdgeKind;
  readonly door: number;
}
export interface VaultGraph {
  readonly nodes: readonly VaultNode[];
  readonly edges: readonly VaultEdge[];
  readonly start: number;
  readonly end: number;
}
export interface VaultGrammarParams {
  readonly minRooms: number;
  readonly maxRooms: number;
  /** ≥ 4 for the Grünhain vault nearest the start beach (§32), else 1. */
  readonly minPuzzleTypes: number;
  readonly puzzleTypes: readonly string[];
  readonly trapTypes: readonly string[];
  readonly hiddenWallChance: number;
}
/** The pure grammar (unit test: 100 seeds solvable, every key reachable before its lock). */
export type VaultGrammar = (seed: number, slot: number, params: VaultGrammarParams) => VaultGraph;
export interface PlacedRoom {
  readonly node: number;
  readonly template: string;
  readonly cellX: number;
  readonly cellY: number;
  readonly rotation: QuarterTurn;
  readonly x0: number;
  readonly y0: number;
}
export interface VaultDoorPlan {
  readonly id: number;
  readonly tx: number;
  readonly ty: number;
  readonly kind: Exclude<VaultEdgeKind, 'offen'>;
  readonly puzzle: number;
}
export interface VaultPuzzlePlan {
  readonly id: number;
  readonly node: number;
  readonly type: string;
  readonly variant: string;
  readonly parts: readonly { readonly role: string; readonly tx: number; readonly ty: number }[];
}
export interface VaultTrapPlan {
  readonly id: number;
  readonly type: string;
  readonly tx: number;
  readonly ty: number;
  readonly dir: QuarterTurn;
}
export interface VaultChestPlan {
  readonly id: number;
  readonly tier: Exclude<ChestTier, 0>;
  readonly tx: number;
  readonly ty: number;
  readonly loot: string;
  readonly mimic: boolean;
}
export interface VaultGuardPlan {
  readonly creature: string;
  readonly tx: number;
  readonly ty: number;
  readonly boss: boolean;
}
export interface VaultPlan {
  readonly slot: number;
  readonly biome: string;
  readonly tileset: string;
  /** Reserved box on layer −1 [tiles]; the underground plan keeps out of it. */
  readonly box: { readonly x0: number; readonly y0: number; readonly w: number; readonly h: number };
  readonly entrance: { readonly tx: number; readonly ty: number };
  readonly graph: VaultGraph;
  readonly rooms: readonly PlacedRoom[];
  readonly doors: readonly VaultDoorPlan[];
  readonly puzzles: readonly VaultPuzzlePlan[];
  readonly traps: readonly VaultTrapPlan[];
  readonly chests: readonly VaultChestPlan[];
  readonly guards: readonly VaultGuardPlan[];
  readonly tablets: readonly { readonly tablet: string; readonly tx: number; readonly ty: number }[];
  /** Ember shard place (12 reserved over all vaults of the world), or null. */
  readonly shard: { readonly tx: number; readonly ty: number } | null;
}
