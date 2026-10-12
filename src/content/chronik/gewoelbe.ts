/**
 * Chronicle rules of strand C (docs/SPIEL.md §19, §23; M7-10 … M7-16, M7-46): the descent into a vault, the first puzzle solved, a
 * secret room behind a cracked wall, the chest that bit, an ember shard taken, a vault conquered, the first Builder tablet read.
 */
import type { ChronicleRuleInput } from './schema';

export const CHRONICLE_RULES_C: readonly ChronicleRuleInput[] = [
  {
    id: 'chronik_gewoelbe_betreten',
    ereignis: 'vaultEntered',
    wo: { erstmals: true },
    art: 'entdeckung',
    text: { de: 'Ich bin in ein Gewölbe der Erbauer hinabgestiegen ({biome}).', en: 'I went down into a vault of the Builders ({biome}).' },
    platzhalter: { biome: 'biom' },
  },
  {
    id: 'chronik_gewoelbe_erstes_raetsel',
    ereignis: 'puzzleSolved',
    art: 'tagebuch',
    text: { de: 'Mein erstes Rätsel der Erbauer gelöst – irgendwo im Stein mahlte eine Tür auf.', en: 'I solved my first puzzle of the Builders – somewhere in the stone a door ground open.' },
    einmalig: true,
  },
  {
    id: 'chronik_gewoelbe_verborgen',
    ereignis: 'vaultHiddenFound',
    art: 'entdeckung',
    text: { de: 'Hinter einer rissigen Wand lag ein verborgener Raum.', en: 'Behind a cracked wall lay a hidden room.' },
    einmalig: true,
  },
  {
    id: 'chronik_gewoelbe_mimik',
    ereignis: 'vaultChestOpened',
    wo: { mimik: true },
    art: 'kampf',
    text: { de: 'Die Truhe hatte Zähne. Jetzt ist sie still – und ihr Inhalt meiner.', en: 'The chest had teeth. Now it is quiet – and what it held is mine.' },
    einmalig: true,
  },
  {
    id: 'chronik_gewoelbe_glutsplitter',
    ereignis: 'vaultShardTaken',
    art: 'entdeckung',
    text: { de: 'Ein Glutsplitter! Seine Wärme kriecht mir in die Finger.', en: 'An ember shard! Its warmth creeps into my fingers.' },
  },
  {
    id: 'chronik_gewoelbe_bezwungen',
    ereignis: 'vaultCompleted',
    art: 'kampf',
    text: { de: 'Ein Gewölbe bezwungen ({biome}): Sein Hüter ist gefallen, die Endtruhe offen.', en: 'A vault conquered ({biome}): its warden has fallen, the end chest is open.' },
    platzhalter: { biome: 'biom' },
  },
  {
    id: 'chronik_gewoelbe_erste_tafel',
    ereignis: 'tabletRead',
    art: 'wissen',
    text: { de: 'Ich habe meine erste Erbauer-Tafel gelesen. Sie erzählen, was geschah.', en: 'I read my first Builder tablet. They tell what happened.' },
    einmalig: true,
  },
];
