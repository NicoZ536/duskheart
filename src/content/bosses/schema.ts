/**
 * Bosses (docs/SPIEL.md §22 "Boss-Framework", MASTERPROMPT §20.2; ADR-0207; strand F, collection `bosses`, §C "Bosse"): a
 * boss in its arena with access, at least three phases (thresholds by health share, weak points, attacks as data – areas with
 * a telegraph, summons, arena effects – and resistance overrides), unique loot, trophy and heart shard. The zod schema
 * producing `BossDef` is strand F's; the validator rule `boss` checks sprite clips, arena, phases, loot, title card and music.
 */
import { z } from 'zod';
import { BOSS_BALANCE } from '../balance/bosses';
import { DAMAGE_TYPE_IDS, type DamageTypeId } from '../balance/combat';
import { idSchema, localizedTextSchema, refSchema, type LocalizedText } from '../schema/common';

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
  /** Additive (F): impact class 1–5 of the hit (hitstop, knockback); absent = `BOSS_DEFAULT_WUCHT`. */
  readonly wucht?: number;
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

// ---------------------------------------------------------------------------------------------
// zod (strand F, M7-32): the collection `bosses` (src/content/index.ts) parses its records with `bossSchema`.
// ---------------------------------------------------------------------------------------------

/** Id prefix of a boss's multi-part sprite (`boss_<id>`, assets-src/sprites/bosse/). */
export const BOSS_SPRITE_PREFIX = 'boss_';
/** The sprite of boss `id`. */
export function bossSpriteId(id: string): string {
  return `${BOSS_SPRITE_PREFIX}${id}`;
}
/** Impact class of a boss's area hit without its own (`wucht`): a heavy blow, short of the heaviest. */
export const BOSS_DEFAULT_WUCHT = 4;
/** Impact classes 1–5 (`BALANCE.combat.impact`). */
const WUCHT_MIN = 1;
const WUCHT_MAX = 5;
/** A full circle [°]. */
const FULL_CIRCLE_DEG = 360;
/** Resistances −1 … 1 (0,5 halves, −1 doubles). */
const resistance = z.number().min(-1).max(1);

const attackBase = {
  id: idSchema,
  gewicht: z.number().positive(),
  abklingSekunden: z.number().min(0),
  /** The sprite clip of the attack (`<clip>` of `boss_<id>`, wind-up and blow). */
  clip: idSchema,
};

export const bossAreaAttackSchema = z
  .object({
    ...attackBase,
    art: z.literal('flaeche'),
    form: z.enum(BOSS_AREA_SHAPES),
    schaden: z.number().positive(),
    schadensart: z.enum(DAMAGE_TYPE_IDS),
    telegraphSekunden: z.number().min(BOSS_BALANCE.telegraphMinSeconds, { message: `every boss attack telegraphs at least ${BOSS_BALANCE.telegraphMinSeconds} s (§4.6)` }),
    reichweitePx: z.number().positive(),
    breitePx: z.number().positive().optional(),
    winkelGrad: z.number().positive().max(FULL_CIRCLE_DEG).optional(),
    anzahl: z.number().int().min(1).optional(),
    wucht: z.number().int().min(WUCHT_MIN).max(WUCHT_MAX).optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if ((a.form === 'linie' || a.form === 'kreis' || a.form === 'ring') && a.breitePx === undefined) issue('breitePx', `a ${a.form} names its width (breitePx)`);
    if (a.form === 'kegel' && a.winkelGrad === undefined) issue('winkelGrad', 'a cone names its angle (winkelGrad)');
    if (a.form === 'ring' && (a.breitePx ?? 0) > a.reichweitePx) issue('breitePx', 'a ring is narrower than its outer radius');
    if ((a.anzahl ?? 1) > 1 && a.form === 'linie' && a.winkelGrad === undefined) issue('winkelGrad', 'a fan of lines names the angle it spreads over (winkelGrad)');
  }) satisfies z.ZodType<BossAreaAttackDef>;

export const bossSummonSchema = z
  .object({ ...attackBase, art: z.literal('beschwoerung'), kreatur: refSchema, anzahl: z.number().int().min(1), maxGleichzeitig: z.number().int().min(1) })
  .strict()
  .refine((a) => a.anzahl <= a.maxGleichzeitig, { message: 'a summon never brings more servants than may stand at once' }) satisfies z.ZodType<BossSummonDef>;

export const bossArenaEffectSchema = z
  .object({ ...attackBase, art: z.literal('arena'), effekt: z.enum(BOSS_ARENA_EFFECTS), sekunden: z.number().positive() })
  .strict() satisfies z.ZodType<BossArenaEffectDef>;

export const bossAttackSchema = z.union([bossAreaAttackSchema, bossSummonSchema, bossArenaEffectSchema]);

export const bossWeakPointSchema = z.object({ id: idSchema, dx: z.number(), dy: z.number(), radiusPx: z.number().positive() }).strict() satisfies z.ZodType<BossWeakPointDef>;

export const bossPhaseSchema = z
  .object({
    id: idSchema,
    abLebensanteil: z.number().gt(0).max(1),
    verwundbar: z.enum(['koerper', 'schwachstellen']),
    schwachstellen: z.array(bossWeakPointSchema).min(1).optional(),
    angriffe: z.array(bossAttackSchema).min(1),
    resistenzen: z.partialRecord(z.enum(DAMAGE_TYPE_IDS), resistance).optional(),
    tempo: z.number().positive(),
    uebergangSekunden: z.number().min(0),
  })
  .strict()
  .superRefine((p, ctx) => {
    if ((p.verwundbar === 'schwachstellen') !== (p.schwachstellen !== undefined)) ctx.addIssue({ code: 'custom', path: ['schwachstellen'], message: 'exactly a phase vulnerable at its weak points names them' });
    const ids = p.angriffe.map((a) => a.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['angriffe'], message: 'attack ids are unique within a phase' });
  }) satisfies z.ZodType<BossPhaseDef>;

export const bossSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    titel: localizedTextSchema,
    beschreibung: localizedTextSchema,
    biom: refSchema,
    arena: refSchema,
    zugang: z.discriminatedUnion('art', [z.object({ art: z.literal('betreten') }).strict(), z.object({ art: z.literal('beschwoerung'), item: refSchema }).strict()]),
    leben: z.number().positive(),
    ruestung: z.number().min(0),
    resistenzen: z.record(z.enum(DAMAGE_TYPE_IDS), resistance),
    radiusPx: z.number().positive(),
    sprite: idSchema,
    musik: idSchema,
    phasen: z.array(bossPhaseSchema).min(1),
    beute: z
      .object({
        einzigartig: z.array(refSchema),
        trophaee: refSchema,
        herzsplitter: refSchema,
        weitere: z.array(z.object({ item: refSchema, anzahl: z.tuple([z.number().int().min(1), z.number().int().min(1)]).refine(([a, b]) => b >= a, { message: 'max ≥ min' }) }).strict()),
      })
      .strict(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if (b.sprite !== bossSpriteId(b.id)) issue('sprite', `the sprite of a boss is ${bossSpriteId(b.id)}`);
    const first = b.phasen[0];
    if (first !== undefined && first.abLebensanteil !== 1) issue('phasen', 'the first phase begins at full health (abLebensanteil 1)');
    for (let i = 1; i < b.phasen.length; i++) {
      if ((b.phasen[i] as BossPhaseDef).abLebensanteil >= (b.phasen[i - 1] as BossPhaseDef).abLebensanteil) issue('phasen', 'each phase begins below the share of the one before');
    }
    const ids = b.phasen.map((p) => p.id);
    if (new Set(ids).size !== ids.length) issue('phasen', 'phase ids are unique');
  }) satisfies z.ZodType<BossDef>;
/** One boss as written in the content files. */
export type BossInput = z.input<typeof bossSchema>;
