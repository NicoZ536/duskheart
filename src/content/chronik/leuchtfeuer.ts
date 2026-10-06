/**
 * Chronicle rules of strand F (docs/SPIEL.md §22, §23; M7-32 … M7-37): a warden woken and defeated, a beacon lit, what the
 * first beacon taught, a heart shard used, the first journey in the light.
 */
import type { ChronicleRuleInput } from './schema';

/** What the first beacon teaches, as a diary line each (one per unlock of §23.1 LF1). */
const LF1_LEHREN: readonly (readonly [string, string, string])[] = [
  ['lf1_lumen_werkbank', 'Das Leuchtfeuer lehrte mich die Lumen-Werkbank.', 'The beacon taught me the Lumen workbench.'],
  ['lf1_lumen_laterne', 'Das Leuchtfeuer lehrte mich die Lumen-Laterne.', 'The beacon taught me the Lumen lantern.'],
  ['lf1_wegsteine', 'Das Leuchtfeuer lehrte mich, Wegsteine zu setzen.', 'The beacon taught me to set waystones.'],
  ['lf1_glutkern', 'Das Leuchtfeuer schenkte mir einen Glutkern für mein Herdfeuer.', 'The beacon gave me an ember core for my hearth.'],
];

export const CHRONICLE_RULES_F: readonly ChronicleRuleInput[] = [
  {
    id: 'chronik_boss_erwacht',
    ereignis: 'bossAwakened',
    art: 'kampf',
    text: { de: '{boss} erwachte, als ich seine Arena betrat.', en: '{boss} woke as I stepped into its arena.' },
    platzhalter: { boss: 'boss' },
    einmalig: true,
  },
  {
    id: 'chronik_boss_besiegt',
    ereignis: 'bossDefeated',
    art: 'kampf',
    text: { de: 'Ich habe {boss} besiegt.', en: 'I defeated {boss}.' },
    platzhalter: { boss: 'boss' },
  },
  {
    id: 'chronik_leuchtfeuer_entzuendet',
    ereignis: 'beaconLit',
    art: 'welt',
    text: { de: 'Das Leuchtfeuer Nr. {beacon} brennt wieder – das Land ringsum heilt.', en: 'Beacon no. {beacon} burns again – the land around it heals.' },
    platzhalter: { beacon: 'zahl' },
  },
  ...LF1_LEHREN.map(([unlock, de, en]): ChronicleRuleInput => ({ id: `chronik_${unlock}`, ereignis: 'unlockGranted', wo: { unlock }, art: 'wissen', text: { de, en } })),
  {
    id: 'chronik_herzsplitter',
    ereignis: 'shardUsed',
    wo: { art: 'herz' },
    art: 'tagebuch',
    text: { de: 'Ein Herzsplitter fügte sich in mein Herz – {gesamt} bisher.', en: 'A heart shard joined my heart – {gesamt} so far.' },
    platzhalter: { gesamt: 'zahl' },
  },
  {
    id: 'chronik_reise_erste',
    ereignis: 'travelled',
    art: 'tagebuch',
    text: { de: 'Zum ersten Mal trug mich das Licht von Feuer zu Feuer.', en: 'For the first time the light carried me from fire to fire.' },
    einmalig: true,
  },
];
