/**
 * Chronicle rules of strand G (docs/SPIEL.md §23 "Tagebuch"; M7-41 … M7-47): achievements and quests written into the diary –
 * the moment Spark (Funke) first speaks, every quest done, every achievement.
 */
import type { ChronicleRuleInput } from './schema';

export const CHRONICLE_RULES_G_KERN: readonly ChronicleRuleInput[] = [
  {
    id: 'chronik_erfolg',
    ereignis: 'achievementUnlocked',
    art: 'tagebuch',
    text: { de: 'Erfolg errungen: {achievement}.', en: 'Achievement earned: {achievement}.' },
    platzhalter: { achievement: 'erfolg' },
  },
  {
    id: 'chronik_aufgabe_erfuellt',
    ereignis: 'questCompleted',
    art: 'tagebuch',
    text: { de: 'Erfüllt: {quest}.', en: 'Completed: {quest}.' },
    platzhalter: { quest: 'aufgabe' },
  },
  {
    id: 'chronik_funke_erwacht',
    ereignis: 'questStepCompleted',
    wo: { quest: 'hq_sechs_feuer_1', schritt: 'funke_erwacht' },
    art: 'tagebuch',
    text: { de: 'Am Morgen sprach die Glut in meiner Laterne. Sie nennt sich Funke.', en: 'In the morning the ember in my lantern spoke. It calls itself Spark.' },
    einmalig: true,
  },
];
