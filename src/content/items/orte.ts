/**
 * Items of the places and world events (docs/SPIEL.md §18, §29; M7-09, M7-39; strand B): the star ore of the meteorite
 * craters and of the Lumen rain's meteorites. Its uses come with the star steel of a later milestone (planned use,
 * tools/validator/verwendungen-geplant.ts).
 */
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

export const ORTE_ITEMS = defineItemGroup('orte', [
  baseItem({
    id: 'sternenerz',
    name: { de: 'Sternenerz', en: 'Star Ore' },
    beschreibung: {
      de: 'Dunkles, glasig geschmolzenes Metall aus einem Meteoriten, kühl wie Nachtluft. Es braucht eine eiserne Spitzhacke – und eine Esse, die heißer brennt als alles, was du kennst.',
      en: 'Dark metal melted to glass in a meteorite, cool as night air. It takes an iron pickaxe – and a forge hotter than anything you know.',
    },
    kategorie: 'rohstoff',
    stufe: 2,
    raritaet: 'selten',
    tauschwert: 30,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
]);
