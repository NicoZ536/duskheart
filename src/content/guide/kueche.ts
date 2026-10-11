/**
 * Funke comments and context hints of strand E (docs/SPIEL.md §21, §23; M7-25 … M7-30): the cauldron needs a fire beside it,
 * raw meat, boredom, spoiled food and the pantry barrel, unfiltered water and boiling, the rain collector, the herb table.
 */
import type { GuideHintInput } from './schema';

export const GUIDE_HINTS_E: readonly GuideHintInput[] = [
  {
    id: 'hinweis_kessel_feuer',
    kanal: 'hinweis',
    text: { de: 'Der Kessel kocht nur über Feuer: Stell ein Lagerfeuer oder einen Kamin direkt daneben.', en: 'The cauldron only cooks over a fire: put a camp fire or a fireplace right beside it.' },
    ausloeser: { art: 'besitz', item: 'kessel', anzahl: 1 },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_kueche_roh',
    kanal: 'funke',
    text: { de: 'Roh gegessen? Das rächt sich oft. Brat das Fleisch am Feuer, dann bleibt der Magen ruhig.', en: 'Eaten raw? That often backfires. Roast the meat at a fire and your stomach stays calm.' },
    ausloeser: { art: 'ereignis', ereignis: 'mealEaten', wo: { roh: true } },
    prioritaet: 2,
    einmalig: true,
  },
  {
    id: 'hinweis_kueche_ueberdruss',
    kanal: 'hinweis',
    text: { de: 'Schon wieder dasselbe? Ab dem dritten Stück am Tag sättigt es nur halb – wechsle die Speisen.', en: 'The same again? From the third piece a day it only half fills you – vary your meals.' },
    ausloeser: { art: 'ereignis', ereignis: 'mealEaten', wo: { ueberdruss: 0.5 } },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_kueche_verdorben',
    kanal: 'funke',
    text: { de: 'Puh, da ist etwas verdorben! Im Vorratsfass, im Lager oder im Eiskeller hält Essen länger.', en: 'Phew, something has spoiled! In a pantry barrel, a store room or an ice cellar food keeps longer.' },
    ausloeser: { art: 'ereignis', ereignis: 'foodSpoiled' },
    prioritaet: 2,
    einmalig: true,
  },
  {
    id: 'hinweis_wasser_abkochen',
    kanal: 'hinweis',
    text: { de: 'Fluss- und Seewasser kann Fieber bringen. Koch es im Eimer am Feuer ab oder sammle Regen.', en: 'River and lake water can bring fever. Boil it in a bucket at the fire or collect rain.' },
    ausloeser: { art: 'ereignis', ereignis: 'waterDrunk', wo: { fever: true } },
    prioritaet: 2,
    einmalig: true,
  },
  {
    id: 'hinweis_regensammler',
    kanal: 'hinweis',
    text: { de: 'Der Regensammler füllt sich morgens mit dem Regen des Tages – nur unter freiem Himmel.', en: 'The rain collector fills each morning with the day’s rain – only under the open sky.' },
    ausloeser: { art: 'ereignis', ereignis: 'collectorPlaced' },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'hinweis_kraeutertisch',
    kanal: 'hinweis',
    text: { de: 'Am Kräutertisch mischst du Heiltrank, Gegengift, Fiebertee und Wundsalbe aus Kräutern und Wasser.', en: 'At the herb table you mix healing draught, antidote, fever tea and wound salve from herbs and water.' },
    ausloeser: { art: 'besitz', item: 'kraeutertisch', anzahl: 1 },
    prioritaet: 1,
    einmalig: true,
  },
];
