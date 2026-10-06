/**
 * The boss bar's model (MASTERPROMPT §20.2 "Intro-Titelkarte, Bosslebensbalken mit Phasenmarken"; docs/SPIEL.md §30 "Bossbalken mit
 * Phasenmarken, Titelkarte (HUD) – sampleBoss"; M7-32): what the HUD shows of the awake boss – its name, the health share, the
 * marks where a new phase begins (passed ones dimmed), the phase number, and for the first three seconds the title card with
 * the boss's title and the land it guards. Pure: the component (BossBalken.tsx) feeds it the session's sample and the tick.
 */
import { CONTENT } from '../../../content/index';
import type { BossDef } from '../../../content/bosses/schema';
import type { BossSample } from '../../../game/bosses/types';
import type { Lang } from '../../../i18n';

/** One phase mark on the bar. */
export interface PhasenMarke {
  /** Position from the left [share of the bar, 0–1]. */
  readonly anteil: number;
  /** The boss already passed below it. */
  readonly erreicht: boolean;
}

/** What the HUD shows of the awake boss. */
export interface BossAnsicht {
  readonly boss: string;
  readonly name: string;
  /** Health share [0–1]. */
  readonly anteil: number;
  readonly leben: number;
  readonly max: number;
  readonly marken: readonly PhasenMarke[];
  /** Phase number from 1. */
  readonly phase: number;
  /** The title card while it shows (its title and the biome's name), else null. */
  readonly titelkarte: { readonly titel: string; readonly biom: string } | null;
}

/** The boss's content record, or undefined. */
function bossDef(id: string): BossDef | undefined {
  return CONTENT.collection('bosses').find(id) as BossDef | undefined;
}

/** The view of `sample` at `tick` in `lang`, or null without an awake boss. */
export function bossAnsicht(sample: Readonly<BossSample>, tick: number, lang: Lang): BossAnsicht | null {
  if (!sample.active) return null;
  const def = bossDef(sample.boss);
  if (def === undefined) return null;
  const max = sample.maxHealth > 0 ? sample.maxHealth : 1;
  const anteil = Math.max(0, Math.min(1, sample.health / max));
  const biom = CONTENT.collection('biomes').find(def.biom)?.name[lang] ?? def.biom;
  return {
    boss: def.id,
    name: def.name[lang],
    anteil,
    leben: Math.ceil(sample.health),
    max: Math.round(sample.maxHealth),
    marken: sample.phaseMarks.map((m) => ({ anteil: m, erreicht: anteil <= m })),
    phase: sample.phase + 1,
    titelkarte: tick < sample.titleUntilTick ? { titel: def.titel[lang], biom } : null,
  };
}

/** Whether two views show the same (the component re-renders only on a change). */
export function gleicheAnsicht(a: BossAnsicht | null, b: BossAnsicht | null): boolean {
  if (a === null || b === null) return a === b;
  return a.boss === b.boss && a.leben === b.leben && a.max === b.max && a.phase === b.phase && (a.titelkarte === null) === (b.titelkarte === null) && a.name === b.name;
}
