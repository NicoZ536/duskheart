/**
 * Funke comments and context hints of strand C (docs/SPIEL.md §19, §23; M7-10 … M7-18, M7-46): the vault's stairs and its dark,
 * a locked door and its key, a puzzle's door, a wrong step, a trap's warning, the ember shard, the Builder tablets, the research
 * desk and the map table.
 */
import { GEWOELBE_ITEMS } from '../items/gewoelbe';
import { FORSCHUNG_ITEMS } from '../items/forschung';
import type { Trigger } from '../schema/trigger';
import type { GuideHintInput } from './schema';

/** Holding any of `items` (one of the relics, one of the schematics). */
function holdsAny(items: readonly string[]): Trigger {
  return { art: 'eines', von: items.map((item) => ({ art: 'besitz', item, anzahl: 1 })) };
}
const RELICS = GEWOELBE_ITEMS.filter((i) => i.id.startsWith('relikt_')).map((i) => i.id);
const SCHEMATICS = FORSCHUNG_ITEMS.filter((i) => i.bauplan !== undefined).map((i) => i.id);

export const GUIDE_HINTS_C: readonly GuideHintInput[] = [
  {
    id: 'funke_gewoelbe_betreten',
    kanal: 'funke',
    text: { de: 'Ein Gewölbe der Erbauer! Hier unten brennt nur, was du mitbringst – halt die Fackel bereit.', en: 'A vault of the Builders! Down here only what you bring will burn – keep your torch ready.' },
    ausloeser: { art: 'ereignis', ereignis: 'vaultEntered', wo: { erstmals: true } },
    prioritaet: 2,
    einmalig: true,
  },
  {
    id: 'hinweis_gewoelbe_schloss',
    kanal: 'hinweis',
    text: { de: 'Verschlossen. Der Schlüssel dieses Gewölbes liegt hier unten auf einem Sockel.', en: 'Locked. This vault\'s key lies somewhere down here on a pedestal.' },
    ausloeser: { art: 'ereignis', ereignis: 'commandRejected', wo: { reason: 'locked' } },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'hinweis_gewoelbe_raetseltuer',
    kanal: 'hinweis',
    text: { de: 'Diese Tür öffnet sich erst, wenn das Rätsel in ihrem Raum gelöst ist. Der Hinweis steht auf der Stele.', en: 'This door opens only when the puzzle in its room is solved. The hint is on the stele.' },
    ausloeser: { art: 'ereignis', ereignis: 'commandRejected', wo: { reason: 'puzzleClosed' } },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_raetsel_falsch',
    kanal: 'funke',
    text: { de: 'Falsch – alles springt zurück. Schau dir den Hinweis noch einmal an.', en: 'Wrong – everything springs back. Take another look at the hint.' },
    ausloeser: { art: 'ereignis', ereignis: 'puzzleReset' },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_falle_warnung',
    kanal: 'funke',
    text: { de: 'Da glüht etwas! Raus aus der Bahn – Fallen warnen, bevor sie zuschlagen.', en: 'Something is glowing! Out of its path – traps warn before they strike.' },
    ausloeser: { art: 'ereignis', ereignis: 'vaultTrapArmed' },
    prioritaet: 3,
    einmalig: true,
  },
  {
    id: 'hinweis_glutsplitter',
    kanal: 'hinweis',
    text: { de: 'Ein Glutsplitter: Benutze ihn – er geht in dich über und stärkt deine Ausdauer für immer.', en: 'An ember shard: use it – it passes into you and strengthens your stamina for good.' },
    ausloeser: { art: 'ereignis', ereignis: 'vaultShardTaken' },
    prioritaet: 2,
    einmalig: true,
  },
  {
    id: 'hinweis_erbauer_tafel',
    kanal: 'hinweis',
    text: { de: 'Erbauer-Tafeln erzählen, was geschah. Die Chronik bewahrt jede gelesene Tafel unter Wissen.', en: 'Builder tablets tell what happened. The chronicle keeps every tablet you read under Knowledge.' },
    ausloeser: { art: 'ereignis', ereignis: 'tabletRead' },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'hinweis_relikt',
    kanal: 'hinweis',
    text: { de: 'Ein Relikt der Erbauer. Am Forschungspult studiert, wird daraus ein Bauplan.', en: 'A relic of the Builders. Studied at the research desk, it becomes a schematic.' },
    ausloeser: holdsAny(RELICS),
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'hinweis_bauplan',
    kanal: 'hinweis',
    text: { de: 'Ein Bauplan: Benutze ihn, und das Wissen gehört dir – das Rezept steht danach im Handwerk.', en: 'A schematic: use it and the knowledge is yours – the recipe then appears in crafting.' },
    ausloeser: holdsAny(SCHEMATICS),
    prioritaet: 1,
    einmalig: true,
  },
];
