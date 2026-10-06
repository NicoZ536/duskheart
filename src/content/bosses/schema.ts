/**
 * Bosses (docs/SPIEL.md §22 "Boss-Framework", MASTERPROMPT §20.2; ADR-0207; strand F, collection `bosses`, §C "Bosse"): a
 * boss in its arena with access, at least three phases (thresholds by health share, weak points, attacks as data – areas with
 * a telegraph, summons, arena effects – and resistance overrides), unique loot, trophy and heart shard. The zod schema
 * producing `BossDef` is strand F's; the validator rule `boss` checks sprite clips, arena, phases, loot, title card and music.
 */
import type { DamageTypeId } from '../balance/combat';
import type { LocalizedText } from '../schema/common';

export const BOSS_AREA_SHAPES = ['linie', 'kreis', 'kegel', 'ring'] as const;
export type BossAreaShape = (typeof BOSS_AREA_SHAPES)[number];
export const BOSS_ARENA_EFFECTS = ['blaettersturm', 'arena_brennt'] as const;
export type BossArenaEffect = (typeof BOSS_ARENA_EFFECTS)[number];
export interface BossAttackBase {
  readonly id: string;
  readonly gewicht: number;
  readonly abklingSekunden: number;
  readonly clip: string;
}
/** Telegraphed area attack (≥ 0.4 s warning, §4.6); damage as a share check: no hit above `BALANCE.bosses.maxHitShare` of max health. */
export interface BossAreaAttackDef extends BossAttackBase {
  readonly art: 'flaeche';
  readonly form: BossAreaShape;
  readonly schaden: number;
  readonly schadensart: DamageTypeId;
  readonly telegraphSekunden: number;
  readonly reichweitePx: number;
  readonly breitePx?: number;
  readonly winkelGrad?: number;
  readonly anzahl?: number;
}
export interface BossSummonDef extends BossAttackBase {
  readonly art: 'beschwoerung';
  readonly kreatur: string;
  readonly anzahl: number;
  readonly maxGleichzeitig: number;
}
export interface BossArenaEffectDef extends BossAttackBase {
  readonly art: 'arena';
  readonly effekt: BossArenaEffect;
  readonly sekunden: number;
}
export type BossAttackDef = BossAreaAttackDef | BossSummonDef | BossArenaEffectDef;
/** Weak point relative to the boss centre [px] (phase 2 of the Borkenvater: glowing knots). */
export interface BossWeakPointDef {
  readonly id: string;
  readonly dx: number;
  readonly dy: number;
  readonly radiusPx: number;
}
export interface BossPhaseDef {
  readonly id: string;
  /** Phase begins at or below this share of max health (first phase 1). */
  readonly abLebensanteil: number;
  readonly verwundbar: 'koerper' | 'schwachstellen';
  readonly schwachstellen?: readonly BossWeakPointDef[];
  readonly angriffe: readonly BossAttackDef[];
  /** Resistance overrides (phase 3: fire −1 = ×2). */
  readonly resistenzen?: Readonly<Partial<Record<DamageTypeId, number>>>;
  readonly tempo: number;
  /** Invulnerable transition [s]. */
  readonly uebergangSekunden: number;
}
export interface BossDef {
  readonly id: string;
  readonly name: LocalizedText;
  /** Title card (3 s). */
  readonly titel: LocalizedText;
  readonly beschreibung: LocalizedText;
  readonly biom: string;
  /** Arena layout (`placeLayouts`, type `bossarena`). */
  readonly arena: string;
  readonly zugang: { readonly art: 'betreten' } | { readonly art: 'beschwoerung'; readonly item: string };
  readonly leben: number;
  readonly ruestung: number;
  readonly resistenzen: Readonly<Record<DamageTypeId, number>>;
  readonly radiusPx: number;
  /** Multi-part sprite `boss_<id>` (≥ 8 own clips, validator rule `boss`). */
  readonly sprite: string;
  readonly musik: string;
  readonly phasen: readonly BossPhaseDef[];
  readonly beute: {
    readonly einzigartig: readonly string[];
    readonly trophaee: string;
    readonly herzsplitter: string;
    readonly weitere: readonly { readonly item: string; readonly anzahl: readonly [number, number] }[];
  };
}
