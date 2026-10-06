/**
 * Events of the bosses (aggregated into `SimEventMap`; docs/SPIEL.md §17 "Ereignisse zwischen Strängen", §22, §30): the HUD shows
 * the title card and the health bar with its phase marks, the music switches to the boss theme and plays the stinger, the
 * renderer marks the telegraphed areas on the ground and plays the boss's clips, the chronicle and statistics count.
 *
 * - `bossAwakened {boss}`: the boss woke (title card 3 s, arena sealed).
 * - `bossPhaseChanged {boss, phase}`: a phase began (a short invulnerable transition).
 * - `bossTelegraph {boss, angriff, ticks, flaeche, x, y, angle}`: an attack winds up for `ticks`; `flaeche` is its area
 *   (`linie`, `kreis`, `kegel`, `ring`) or `beschwoerung`/`arena`; (x, y) the locked aim, `angle` the direction.
 * - `bossAttack {boss, angriff, x, y, angle}`: the attack lands (roots burst, servants rise, the storm or the fire breaks).
 * - `bossDefeated {boss, dauerTicks}`: the boss fell after `dauerTicks` of fight; loot, trophy and heart shard lie at its place.
 * - `bossReset {boss, grund}`: the fight ended without a victor – the player died (`tod`) or left the arena (`verlassen`), or
 *   the console reset it (`debug`): full health, servants gone, arena open.
 * Refused commands raise `commandRejected` with a `BossRejectReason` (texts `ui.boss.reject.<reason>`).
 */

/** Why a boss fight ended without a victor. */
export const BOSS_RESET_REASONS = ['tod', 'verlassen', 'debug'] as const;
/** One reason of a reset. */
export type BossResetReason = (typeof BOSS_RESET_REASONS)[number];

/** The area of a telegraph: an area shape, a summon or an arena effect. */
export type BossTelegraphArea = 'linie' | 'kreis' | 'kegel' | 'ring' | 'beschwoerung' | 'arena';

/**
 * Why a boss command had no effect: `unknownBoss`; `noArena` – the world has no arena for it; `notInArena` – the player is
 * not in its arena; `noSummoning` – it wakes by entering, not at an altar; `missingItem` – the summoning item is not in the
 * bags; `awake` / `asleep` / `defeated` – it is in another state; `noPhase` – no such phase.
 */
export const BOSS_REJECT_REASONS = ['unknownBoss', 'noArena', 'notInArena', 'noSummoning', 'missingItem', 'awake', 'asleep', 'defeated', 'noPhase', 'noPlayer'] as const;
/** One reason a boss command was refused. */
export type BossRejectReason = (typeof BOSS_REJECT_REASONS)[number];

export interface BossEventMap {
  bossAwakened: { readonly boss: string; readonly x: number; readonly y: number; readonly tick: number };
  bossPhaseChanged: { readonly boss: string; readonly phase: number; readonly tick: number };
  bossTelegraph: { readonly boss: string; readonly angriff: string; readonly ticks: number; readonly flaeche: BossTelegraphArea; readonly x: number; readonly y: number; readonly angle: number; readonly tick: number };
  bossAttack: { readonly boss: string; readonly angriff: string; readonly x: number; readonly y: number; readonly angle: number; readonly tick: number };
  bossDefeated: { readonly boss: string; readonly dauerTicks: number; readonly x: number; readonly y: number; readonly tick: number };
  bossReset: { readonly boss: string; readonly grund: BossResetReason; readonly tick: number };
}

/** Event names of `BossEventMap`. */
export const BOSS_EVENT_TYPES = ['bossAwakened', 'bossPhaseChanged', 'bossTelegraph', 'bossAttack', 'bossDefeated', 'bossReset'] as const satisfies ReadonlyArray<keyof BossEventMap>;

/** Sounds of the boss fight (src/content/sfx/boss.ts); the area telegraph is the creatures' rumble (`TELEGRAPH_SFX.flaeche`). */
export const BOSS_SFX = {
  awake: 'sfx_boss_erwachen',
  phase: 'sfx_boss_phase',
  root: 'sfx_boss_wurzel',
  summon: 'sfx_boss_beschwoeren',
  storm: 'sfx_boss_sturm',
  burn: 'sfx_boss_brand',
  fall: 'sfx_boss_fall',
} as const;
