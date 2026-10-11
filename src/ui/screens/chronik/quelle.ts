/**
 * The chronicle's source (docs/SPIEL.md §30 "je `modell.ts` rein … + `quelle.ts` über `GameSession.sample…`"; M7-41): samples
 * what a tab needs from the session (`UiChronik` of the bridge, and the crafting sample for the recipe book) into records held
 * by the screen, then hands them to the tab's pure model. Sampled when the screen opens, when the tab changes and when the
 * simulation reports a change the open tab shows (a quest step, a diary entry, knowledge, an achievement, a perk). Following a
 * quest and the onboarding switch report no event: while the quest tab is open the screen asks every frame whether the
 * quests moved (`aufgabenGeaendert`, the HUD tracker's signature over a held sample – no allocation).
 */
import { createAchievementsSample, createBestiarySample, createChronicleSample, createQuestSample, createSkillsSample, createStatsSample } from '../../../game/samples/chronik';
import { createCraftingSample } from '../../../game/samples/werkstatt';
import type { I18n } from '../../../i18n';
import type { UiBridge } from '../../bridge';
import { aufgabenSignatur } from '../../hud/aufgaben/modell';
import {
  aufgabenAnsicht,
  bestiariumAnsicht,
  erfolgeAnsicht,
  herbariumAnsicht,
  rezeptAnsicht,
  statistikAnsicht,
  wissenAnsicht,
  type AufgabenAnsicht,
  type BestiariumZeile,
  type ChronikReiter,
  type ErfolgeAnsicht,
  type HerbariumAnsicht,
  type RezeptGruppe,
  type StatistikAnsicht,
  type WissenEintrag,
} from './modell';

/** What one tab shows. */
export type ChronikInhalt =
  | { readonly reiter: 'aufgaben'; readonly ansicht: AufgabenAnsicht }
  | { readonly reiter: 'bestiarium'; readonly ansicht: readonly BestiariumZeile[] }
  | { readonly reiter: 'herbarium'; readonly ansicht: HerbariumAnsicht }
  | { readonly reiter: 'wissen'; readonly ansicht: readonly WissenEintrag[] }
  | { readonly reiter: 'rezepte'; readonly ansicht: readonly RezeptGruppe[] }
  | { readonly reiter: 'statistik'; readonly ansicht: StatistikAnsicht }
  | { readonly reiter: 'erfolge'; readonly ansicht: ErfolgeAnsicht };

/** The simulation events after which the open tab is read again. */
export const CHRONIK_EREIGNISSE = ['questStarted', 'questStepCompleted', 'questCompleted', 'chronicleEntryAdded', 'knowledgeUnlocked', 'achievementUnlocked', 'perkChosen', 'skillLevelUp', 'recipeDiscovered', 'bestiaryUnlocked'] as const;

/** The samples of the screen (held while it is open). */
export class ChronikQuelle {
  private readonly quests = createQuestSample();
  private readonly chronicle = createChronicleSample();
  private readonly stats = createStatsSample();
  private readonly achievements = createAchievementsSample();
  private readonly skills = createSkillsSample();
  private readonly bestiary = createBestiarySample();
  private readonly crafting = createCraftingSample();
  /** The quests' signature when the quest tab was last read or checked. */
  private signatur = Number.NaN;

  constructor(
    private readonly bridge: UiBridge,
    private readonly i18n: I18n,
  ) {}

  /** What tab `reiter` shows now (null without the chronicle's samples). */
  lesen(reiter: ChronikReiter): ChronikInhalt | null {
    const q = this.bridge.chronik;
    if (q === null) return null;
    const lang = this.i18n.lang;
    switch (reiter) {
      case 'aufgaben': {
        const quests = q.sampleQuests(this.quests);
        this.signatur = aufgabenSignatur(quests);
        return { reiter, ansicht: aufgabenAnsicht(quests, q.sampleChronicle(this.chronicle), lang) };
      }
      case 'bestiarium':
        return { reiter, ansicht: bestiariumAnsicht(q.sampleBestiary(this.bestiary), lang) };
      case 'herbarium':
        return { reiter, ansicht: herbariumAnsicht(q.sampleStats(this.stats), lang) };
      case 'wissen':
        return { reiter, ansicht: wissenAnsicht(q.sampleChronicle(this.chronicle), lang) };
      case 'rezepte': {
        const w = this.bridge.werkstatt;
        if (w !== null) w.sampleCrafting(this.crafting);
        const sichtbar = w === null ? new Set<string>() : this.crafting.sichtbar;
        return { reiter, ansicht: rezeptAnsicht(sichtbar, lang, this.i18n.t('ui.chronik.rezepte.hand')) };
      }
      case 'statistik':
        return { reiter, ansicht: statistikAnsicht(q.sampleStats(this.stats), q.sampleSkills(this.skills), lang) };
      case 'erfolge':
        return { reiter, ansicht: erfolgeAnsicht(q.sampleAchievements(this.achievements), lang) };
    }
  }

  /** Whether the quests moved since the quest tab was last read (followed, onboarding switched, a step, progress); per frame. */
  aufgabenGeaendert(): boolean {
    const q = this.bridge.chronik;
    if (q === null) return false;
    const s = aufgabenSignatur(q.sampleQuests(this.quests));
    if (s === this.signatur) return false;
    this.signatur = s;
    return true;
  }
}
