/**
 * Samples of the chronicle, the quests, Funke, the statistics, the achievements, the skills and the bestiary for the
 * presentation (docs/SPIEL.md §30 "`chronik` (7 Reiter) – sampleChronicle, sampleQuests, sampleStats, sampleAchievements,
 * sampleCrafting, Bestiarium", "Aufgaben-Tracker – sampleQuests", "Funke – sampleGuide", "`perkwahl` – sampleSkills"; strand G,
 * M7-41 … M7-48): read-only views into the observers (src/game/{stats,achievements,chronicle,quests,guide}) and the skills,
 * found once and kept.
 *
 * - Every frame (HUD): `quests` (the tracker) and `guide` (Funke and the hint line) fill held records – no allocation.
 * - When a screen opens or its tab changes: `chronicle`, `stats`, `achievements`, `skills`, `bestiary` fill their records with
 *   lists of their own (a few dozen rows, never in the frame path).
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import type { QuestDef } from '../../content/quests/schema';
import { AchievementsSystem } from '../achievements/system';
import { ChronicleSystem } from '../chronicle/system';
import type { ChronicleEntry, KnowledgeState } from '../chronicle/types';
import { BestiarySystem } from '../creatures/bestiary';
import { GuideSystem } from '../guide/system';
import type { GuideSample } from '../guide/types';
import { QuestsSystem } from '../quests/system';
import type { Simulation } from '../sim';
import { xpToNextLevel } from '../skills/formulas';
import { SkillsSystem } from '../skills/system';
import { StatsSystem } from '../stats/system';
import { createTriggerProgress } from '../triggers/progress';

/** One started quest in the tracker and the quest tab. */
export interface QuestRowSample {
  quest: string;
  art: QuestDef['art'];
  /** Running now (started, not finished, not a paused onboarding quest). */
  aktiv: boolean;
  erledigt: boolean;
  /** Index of the current step (the number of steps when finished). */
  schritt: number;
  schritte: number;
  tracked: boolean;
  /** Progress of the current step (`need` 0: not countable). */
  count: number;
  need: number;
  startedTick: number;
}

/** The quests for the HUD's tracker and the quest tab (held; `count` rows are valid). */
export interface QuestSample {
  readonly rows: QuestRowSample[];
  count: number;
  /** Whether the world's onboarding is on. */
  onboarding: boolean;
  /** Tracked running quests. */
  tracked: number;
}

/** A fresh quest sample with room for every quest. */
export function createQuestSample(): QuestSample {
  const rows: QuestRowSample[] = [];
  for (let i = 0; i < BALANCE.quests.questsMax; i++) rows.push({ quest: '', art: 'neben', aktiv: false, erledigt: false, schritt: 0, schritte: 0, tracked: false, count: 0, need: 0, startedTick: 0 });
  return { rows, count: 0, onboarding: true, tracked: 0 };
}

/** The diary and the unlocked knowledge (the lists of the chronicle, oldest first). */
export interface ChronicleSample {
  entries: readonly ChronicleEntry[];
  knowledge: readonly KnowledgeState[];
}

/** One statistic: its total and, for a keyed one, the value per key (largest first). */
export interface StatRowSample {
  readonly stat: string;
  readonly total: number;
  readonly keys: readonly (readonly [string, number])[];
}

/** The statistics and the play times of the milestones [ticks of play; −1 not reached]. */
export interface StatsSample {
  rows: readonly StatRowSample[];
  milestones: readonly { readonly id: string; readonly spielzeit: number }[];
}

/** One achievement: unlocked (and at which play time [ticks of play]) or how far. */
export interface AchievementRowSample {
  readonly id: string;
  readonly unlocked: boolean;
  readonly spielzeit: number;
  readonly count: number;
  readonly need: number;
}

export interface AchievementsSample {
  rows: readonly AchievementRowSample[];
}

/** One skill: level, experience in the level and to the next, its perk choices (`choice` null: open). */
export interface SkillRowSample {
  readonly id: string;
  readonly level: number;
  readonly xp: number;
  readonly xpNext: number;
  readonly perks: readonly { readonly level: number; readonly choice: number | null }[];
}

export interface SkillsSample {
  rows: readonly SkillRowSample[];
  /** The open perk choices, skill order then level (the perk choice screen offers the first). */
  open: readonly { readonly skill: string; readonly level: number }[];
}

/** One creature of the bestiary: the stages it opened and its defeats. */
export interface BestiaryRowSample {
  readonly creature: string;
  readonly gesichtet: boolean;
  readonly resistenzen: boolean;
  readonly beute: boolean;
  readonly kills: number;
}

export interface BestiarySample {
  rows: readonly BestiaryRowSample[];
}

/** Empty records for the screens (filled when they open). */
export function createChronicleSample(): ChronicleSample {
  return { entries: [], knowledge: [] };
}
export function createStatsSample(): StatsSample {
  return { rows: [], milestones: [] };
}
export function createAchievementsSample(): AchievementsSample {
  return { rows: [] };
}
export function createSkillsSample(): SkillsSample {
  return { rows: [], open: [] };
}
export function createBestiarySample(): BestiarySample {
  return { rows: [] };
}

/** Finds the observers, the skills and the bestiary of a simulation once. */
export class ChronikSampler {
  private found = false;
  private questsSystem: QuestsSystem | null = null;
  private guideSystem: GuideSystem | null = null;
  private chronicleSystem: ChronicleSystem | null = null;
  private statsSystem: StatsSystem | null = null;
  private achievementsSystem: AchievementsSystem | null = null;
  private skillsSystem: SkillsSystem | null = null;
  private bestiarySystem: BestiarySystem | null = null;
  private readonly progress = createTriggerProgress();

  private find(sim: Simulation): void {
    if (this.found) return;
    this.found = true;
    for (const s of sim.systems) {
      if (s instanceof QuestsSystem) this.questsSystem = s;
      else if (s instanceof GuideSystem) this.guideSystem = s;
      else if (s instanceof ChronicleSystem) this.chronicleSystem = s;
      else if (s instanceof StatsSystem) this.statsSystem = s;
      else if (s instanceof AchievementsSystem) this.achievementsSystem = s;
      else if (s instanceof SkillsSystem) this.skillsSystem = s;
      else if (s instanceof BestiarySystem) this.bestiarySystem = s;
    }
  }

  /** The started quests (every frame for the tracker; no allocation). */
  quests(sim: Simulation, out: QuestSample): QuestSample {
    this.find(sim);
    const q = this.questsSystem;
    out.count = 0;
    out.tracked = 0;
    if (q === null) return out;
    out.onboarding = q.onboarding;
    for (let i = 0; i < q.runs.length && out.count < out.rows.length; i++) {
      const run = q.runs[i];
      const s = run?.state ?? null;
      if (run === undefined || s === null) continue;
      const row = out.rows[out.count++] as QuestRowSample;
      row.quest = run.def.id;
      row.art = run.def.art;
      row.aktiv = q.active(run);
      row.erledigt = s.status === 'erledigt';
      row.schritt = s.status === 'erledigt' ? run.def.schritte.length : s.step;
      row.schritte = run.def.schritte.length;
      row.tracked = row.aktiv && s.tracked;
      row.startedTick = s.startedTick;
      q.stepProgress(sim, run, this.progress);
      row.count = this.progress.count;
      row.need = this.progress.need;
      if (row.tracked) out.tracked++;
    }
    return out;
  }

  /** What Funke and the hint line show (every frame; no allocation). */
  guide(sim: Simulation, out: GuideSample): GuideSample {
    this.find(sim);
    const g = this.guideSystem;
    if (g === null) {
      out.funke = null;
      out.dialog = null;
      out.hint = null;
      out.tick = sim.tick;
      return out;
    }
    return g.sample(sim.tick, out);
  }

  /** The diary and the knowledge (the chronicle's tabs). */
  chronicle(sim: Simulation, out: ChronicleSample): ChronicleSample {
    this.find(sim);
    const c = this.chronicleSystem;
    out.entries = c === null ? [] : c.entries();
    out.knowledge = c === null ? [] : c.knowledge();
    return out;
  }

  /** Every statistic of the content with its total and keys, and the milestones. */
  stats(sim: Simulation, out: StatsSample): StatsSample {
    this.find(sim);
    const st = this.statsSystem;
    out.rows = CONTENT.collection('stats')
      .values()
      .map((def) => {
        const keys: [string, number][] = [];
        st?.forEachKey(def.id, (key, value) => keys.push([key, value]));
        keys.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
        return { stat: def.id, total: st?.value(def.id) ?? 0, keys };
      });
    out.milestones = CONTENT.collection('milestones')
      .values()
      .map((m) => ({ id: m.id, spielzeit: st?.milestoneTime(m.id) ?? -1 }));
    return out;
  }

  /** Every achievement: unlocked or how far. */
  achievements(sim: Simulation, out: AchievementsSample): AchievementsSample {
    this.find(sim);
    const a = this.achievementsSystem;
    const zeiten = new Map((a?.unlocked() ?? []).map((s) => [s.id, s.spielzeit]));
    out.rows = (a?.defs ?? CONTENT.collection('achievements').values()).map((def) => {
      const zeit = zeiten.get(def.id);
      if (a !== null) a.progress(sim, def, this.progress);
      else {
        this.progress.count = 0;
        this.progress.need = 0;
      }
      return { id: def.id, unlocked: zeit !== undefined, spielzeit: zeit ?? -1, count: this.progress.count, need: this.progress.need };
    });
    return out;
  }

  /** Every skill with its level, experience and perk choices; the open choices. */
  skills(sim: Simulation, out: SkillsSample): SkillsSample {
    this.find(sim);
    const k = this.skillsSystem;
    if (k === null) {
      out.rows = [];
      out.open = [];
      return out;
    }
    const open: { skill: string; level: number }[] = [];
    out.rows = k.defs.map((def) => {
      const s = k.skill(def.id);
      for (const p of s.perks) if (p.choice === null) open.push({ skill: def.id, level: p.level });
      return { id: def.id, level: s.level, xp: s.xp, xpNext: s.level >= BALANCE.skills.maxLevel ? 0 : xpToNextLevel(s.level), perks: s.perks.map((p) => ({ level: p.level, choice: p.choice })) };
    });
    out.open = open;
    return out;
  }

  /** Every creature of the content with what the player knows of it. */
  bestiary(sim: Simulation, out: BestiarySample): BestiarySample {
    this.find(sim);
    const b = this.bestiarySystem;
    out.rows = CONTENT.collection('creatures')
      .values()
      .map((c) => {
        const st = b?.stages(c.id);
        return { creature: c.id, gesichtet: st?.gesichtet ?? false, resistenzen: st?.resistenzen ?? false, beute: st?.beute ?? false, kills: b?.entry(c.id).kills ?? 0 };
      });
    return out;
  }
}
