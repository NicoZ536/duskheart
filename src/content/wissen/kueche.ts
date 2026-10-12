/**
 * Knowledge entries of strand E (Wissen tab; docs/SPIEL.md §21, §23; M7-25 … M7-30): the kitchen's stations, meal effects and
 * boredom, spoilage and its containers, water and the rain collector, potions and medicine, the kitchen and the dining hall.
 */
import type { KnowledgeInput } from '../chronik/schema';

export const KNOWLEDGE_E: readonly KnowledgeInput[] = [
  {
    id: 'wissen_kochen',
    titel: { de: 'Kochen', en: 'Cooking' },
    text: {
      de: 'Am Lagerfeuer brätst du am Spieß, im Kessel kochst du Suppen und Eintopf – er braucht ein Feuer direkt daneben und Wasser in Reichweite. Der Backofen backt Brot und Kuchen, die Räucherkammer räuchert Fisch, das Trockengestell trocknet Fleisch, die Mühle mahlt Mehl, das Gärfass macht Wein und Bier. Rohes Fleisch vergiftet in drei von zehn Fällen.',
      en: 'At the camp fire you roast on a spit, in the cauldron you cook soups and stew – it needs a fire right beside it and water within reach. The oven bakes bread and cakes, the smokehouse smokes fish, the drying rack dries meat, the mill grinds flour, the fermenting barrel makes wine and beer. Raw meat poisons three times in ten.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'besitz', item: 'kessel', anzahl: 1 },
  },
  {
    id: 'wissen_mahlzeiten',
    titel: { de: 'Mahlzeiten', en: 'Meals' },
    text: {
      de: 'Gekochte Gerichte geben neben Sättigung Wirkungen: gestärkt, ausdauernd, erquickt. Höchstens zwei wirken zugleich – eine dritte verdrängt die älteste. Dieselbe Speise ab dem dritten Stück am Tag sättigt nur halb; der Überdruss klingt in zwei Tagen ab. Salziges macht Durst, Kuchen und warme Suppen trösten gegen die Furcht.',
      en: 'Cooked dishes give effects besides filling you: fortified, enduring, refreshed. At most two work at once – a third pushes out the oldest. The same dish from the third piece a day only half fills you; the boredom fades over two days. Salty food makes you thirsty, cakes and warm soups comfort you against fear.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'mealEaten' },
  },
  {
    id: 'wissen_verderb',
    titel: { de: 'Verderb', en: 'Spoilage' },
    text: {
      de: 'Essen verliert Stunde um Stunde Frische, bis seine Haltbarkeit erschöpft ist: frisch, alt, faulig – dann wird es zu Verdorbenem, gut für den Kompost. Im Vorratsfass verdirbt es ein Viertel langsamer, im Lager ein Zehntel, im Eiskeller fünfmal langsamer. Draußen im Winter hält es doppelt so lange, in heißen Ländern verdirbt es schneller.',
      en: 'Food loses freshness hour by hour until its shelf life runs out: fresh, old, rotten – then it becomes spoiled food, good for the compost. In a pantry barrel it spoils a quarter slower, in a store room a tenth slower, in an ice cellar five times slower. Outdoors in winter it keeps twice as long, in hot lands it spoils faster.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'foodSpoiled' },
  },
  {
    id: 'wissen_wasser',
    titel: { de: 'Sauberes Wasser', en: 'Clean Water' },
    text: {
      de: 'Flüsse und Seen sind ungefiltert: jeder Schluck kann Fieber bringen, im Nebelmoor jeder zweite. Quellen sind sauber. Abgekochtes Wasser im Eimer und Regen aus dem Regensammler sind es auch – der Sammler füllt sich jeden Morgen mit dem Regen des Vortags. Der Trinkschlauch fasst fünf Schlucke für unterwegs; Schnee schmilzt im Eimer am Feuer.',
      en: 'Rivers and lakes are unfiltered: every sip can bring fever, in the Mistmoor one in two. Springs are clean. Boiled water in a bucket and rain from the rain collector are too – the collector fills every morning with the previous day’s rain. The water skin holds five sips for the road; snow melts in a bucket at the fire.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'waterDrunk' },
  },
  {
    id: 'wissen_traenke',
    titel: { de: 'Tränke und Medizin', en: 'Potions and Medicine' },
    text: {
      de: 'Am Kräutertisch entstehen der Heiltrank (sofort Leben und Heilung), das Gegengift (gegen Vergiftung), der Fiebertee, die Wundsalbe (stillt Blutungen), Wärme- und Kühltrank. Tränke wirken neben den Mahlzeiten und verdrängen keine.',
      en: 'The herb table makes the healing draught (instant health and healing), the antidote (against poisoning), the fever tea, the wound salve (stops bleeding), warming and cooling draughts. Potions work beside meals and push none out.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'besitz', item: 'kraeutertisch', anzahl: 1 },
  },
  {
    id: 'wissen_kueche_raum',
    titel: { de: 'Küche und Speisesaal', en: 'Kitchen and Dining Hall' },
    text: {
      de: 'Ein Raum mit Kessel oder Backofen, einer Kiste und einem Tisch ist eine Küche: Ihre Kochstationen arbeiten 20 % schneller, und was dort entsteht, wirkt 10 % stärker. Ein Raum mit Tisch und zwei Stühlen ist ein Speisesaal: Wer dort isst, verliert zusätzlich Furcht.',
      en: 'A room with a cauldron or oven, a chest and a table is a kitchen: its cooking stations work 20% faster, and what is made there works 10% better. A room with a table and two chairs is a dining hall: eating there eases fear as well.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'raum', raumtyp: 'kueche' },
  },
];
