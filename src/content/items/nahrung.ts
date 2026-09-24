/**
 * Raw food of tier T0 (M3-04; docs/SPIEL.md §6; MASTERPROMPT §14, §18): berries, mushrooms, fruit,
 * nuts, wild garlic and kelp – gathered from bushes, plants, fruit trees and the beach. All of it is
 * raw food of low value (§18 "roh (geringer Wert)"): satiation and thirst [points of 100] per piece,
 * a fraction of what cooked dishes give. Shelf life from `BALANCE.items.shelfLifeDays` (§18 "Beeren 3").
 */
import { BALANCE } from '../balance';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

const SHELF = BALANCE.items.shelfLifeDays;

/** Raw food T0. */
export const NAHRUNG = defineItemGroup('nahrung', [
  baseItem({
    id: 'himbeeren',
    name: { de: 'Himbeeren', en: 'Raspberries' },
    beschreibung: {
      de: 'Süße Beeren vom Beerenstrauch, reif im Sommer. Stillen ein wenig Hunger und Durst, verderben aber schnell.',
      en: 'Sweet berries from the berry bush, ripe in summer. Ease hunger and thirst a little, but spoil quickly.',
    },
    kategorie: 'nahrung',
    frische: SHELF.beeren,
    essbar: { saettigung: 4, durst: 3 },
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.frucht },
  }),
  baseItem({
    id: 'blaubeeren',
    name: { de: 'Blaubeeren', en: 'Blueberries' },
    beschreibung: {
      de: 'Dunkle Beeren vom Beerenstrauch, reif in Sommer und Herbst. Stillen ein wenig Hunger und Durst, verderben aber schnell.',
      en: 'Dark berries from the berry bush, ripe in summer and autumn. Ease hunger and thirst a little, but spoil quickly.',
    },
    kategorie: 'nahrung',
    frische: SHELF.beeren,
    essbar: { saettigung: 4, durst: 3 },
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.frucht },
  }),
  baseItem({
    id: 'walderdbeeren',
    name: { de: 'Walderdbeeren', en: 'Wild Strawberries' },
    beschreibung: {
      de: 'Winzige, duftende Beeren vom Beerenstrauch, schon im Frühling reif. Stillen ein wenig Hunger und Durst.',
      en: 'Tiny, fragrant berries from the berry bush, ripe as early as spring. Ease hunger and thirst a little.',
    },
    kategorie: 'nahrung',
    frische: SHELF.beeren,
    essbar: { saettigung: 3, durst: 3 },
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.frucht },
  }),
  baseItem({
    id: 'steinpilz',
    name: { de: 'Steinpilz', en: 'Porcini' },
    beschreibung: {
      de: 'Kräftiger Speisepilz aus Wald und Moor, im Sommer und Herbst. Roh essbar, gekocht besser.',
      en: 'Hearty edible mushroom from woods and bogs, in summer and autumn. Edible raw, better cooked.',
    },
    kategorie: 'nahrung',
    frische: SHELF.pilze,
    essbar: { saettigung: 6, durst: 0 },
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.pilz },
  }),
  baseItem({
    id: 'pfifferling',
    name: { de: 'Pfifferling', en: 'Chanterelle' },
    beschreibung: {
      de: 'Goldgelber Speisepilz aus Pilzgruppen in Wald, Moor und Höhle, im Sommer und Herbst. Roh essbar, gekocht besser.',
      en: 'Golden edible mushroom from mushroom clusters in woods, bogs and caves, in summer and autumn. Edible raw, better cooked.',
    },
    kategorie: 'nahrung',
    frische: SHELF.pilze,
    essbar: { saettigung: 4, durst: 0 },
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.pilz },
  }),
  baseItem({
    id: 'baerlauch',
    name: { de: 'Bärlauch', en: 'Wild Garlic' },
    beschreibung: {
      de: 'Würzige Blätter zwischen den Wildkräutern, nur im Frühling. Roh essbar und eine gute Würze.',
      en: 'Pungent leaves among the wild herbs, only in spring. Edible raw and a fine seasoning.',
    },
    kategorie: 'nahrung',
    frische: SHELF.blattkraut,
    essbar: { saettigung: 3, durst: 1 },
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'apfel',
    name: { de: 'Apfel', en: 'Apple' },
    beschreibung: {
      de: 'Reift im Herbst am Apfelbaum. Saftig, sättigend und lange haltbar.',
      en: 'Ripens on the apple tree in autumn. Juicy, filling and long-lasting.',
    },
    kategorie: 'nahrung',
    frische: SHELF.kernobst,
    essbar: { saettigung: 8, durst: 5 },
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.frucht },
  }),
  baseItem({
    id: 'kirsche',
    name: { de: 'Kirschen', en: 'Cherries' },
    beschreibung: {
      de: 'Reifen im Sommer am Kirschbaum. Süß und saftig, verderben aber schnell.',
      en: 'Ripen on the cherry tree in summer. Sweet and juicy, but spoil quickly.',
    },
    kategorie: 'nahrung',
    frische: SHELF.steinobst,
    essbar: { saettigung: 4, durst: 3 },
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.frucht },
  }),
  baseItem({
    id: 'birne',
    name: { de: 'Birne', en: 'Pear' },
    beschreibung: {
      de: 'Reift im Herbst am Birnbaum. Saftig, sättigend und lange haltbar.',
      en: 'Ripens on the pear tree in autumn. Juicy, filling and long-lasting.',
    },
    kategorie: 'nahrung',
    frische: SHELF.kernobst,
    essbar: { saettigung: 8, durst: 6 },
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.frucht },
  }),
  baseItem({
    id: 'walnuss',
    name: { de: 'Walnuss', en: 'Walnut' },
    beschreibung: {
      de: 'Fällt im Herbst vom Walnussbaum. Nahrhaft und in der Schale monatelang haltbar – ein Vorrat für den Winter.',
      en: 'Falls from the walnut tree in autumn. Nourishing and keeps for months in its shell – a store for winter.',
    },
    kategorie: 'nahrung',
    frische: SHELF.nuesse,
    essbar: { saettigung: 6, durst: 0 },
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.frucht },
  }),
  baseItem({
    id: 'tang',
    name: { de: 'Tang', en: 'Kelp' },
    beschreibung: {
      de: 'An den Strand der Salzküste gespülter Seetang. Essbar, aber salzig – er macht Durst und verdirbt rasch.',
      en: 'Seaweed washed up on the beaches of the Saltcoast. Edible but salty – it makes you thirsty and rots quickly.',
    },
    kategorie: 'nahrung',
    frische: SHELF.seetang,
    essbar: { saettigung: 3, durst: -3 },
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
]);
