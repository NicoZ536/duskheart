/**
 * Raw materials of tier T0 (M3-04; docs/SPIEL.md §6 "Rohstoffe T0"; MASTERPROMPT §14): wood, stone,
 * soil, ore, fibres, herbs, coastal finds and wildflowers. Their world sources are the `drops` of the
 * world objects (src/content/worldObjects.ts); dug materials declare `graben:<terrain>`. Burn times
 * come from `BALANCE.items.burnSeconds` (§15.4).
 */
import { BALANCE } from '../balance';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

const BURN = BALANCE.items.burnSeconds;

/** Raw materials T0. */
export const ROHSTOFFE = defineItemGroup('rohstoffe', [
  // Wood and what grows on it.
  baseItem({
    id: 'holz',
    name: { de: 'Holz', en: 'Wood' },
    beschreibung: {
      de: 'Scheite aus gefällten Bäumen und gerodeten Stümpfen. Brennt lange im Feuer und ist der Grundstoff für Werkzeuge, Feuerstellen und Bauten.',
      en: 'Logs from felled trees and cleared stumps. Burns long in a fire and is the base material for tools, fire pits and buildings.',
    },
    kategorie: 'rohstoff',
    brennwert: BURN.holz,
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'zweig',
    name: { de: 'Zweig', en: 'Twig' },
    beschreibung: {
      de: 'Dünne Äste aus Falllaub, Sträuchern und gefällten Bäumen. Dient als Stiel und als Anzündholz.',
      en: 'Thin branches from leaf litter, shrubs and felled trees. Serves as a handle and as kindling.',
    },
    kategorie: 'rohstoff',
    brennwert: BURN.zweig,
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'rinde',
    name: { de: 'Rinde', en: 'Bark' },
    beschreibung: {
      de: 'Borke, beim Fällen von Bäumen abgeschält. Hält ein Feuer eine Weile in Gang.',
      en: 'Bark peeled off when felling trees. Keeps a fire going for a while.',
    },
    kategorie: 'rohstoff',
    brennwert: BURN.rinde,
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'harz',
    name: { de: 'Harz', en: 'Resin' },
    beschreibung: {
      de: 'Klebriger Saft von Kiefern und Tannen, beim Fällen und Roden gewonnen. Hält Fackeln am Brennen und klebt, was halten soll.',
      en: 'Sticky sap of pines and firs, gathered when felling them or clearing their stumps. Keeps torches burning and glues what has to hold.',
    },
    kategorie: 'rohstoff',
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'laub',
    name: { de: 'Laub', en: 'Leaves' },
    beschreibung: {
      de: 'Trockene Blätter aus Falllaub, Sträuchern und gefällten Bäumen. Fängt sofort Feuer und brennt rasch herunter.',
      en: 'Dry leaves from leaf litter, shrubs and felled trees. Catches fire at once and burns down quickly.',
    },
    kategorie: 'rohstoff',
    brennwert: BURN.laub,
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'treibholz',
    name: { de: 'Treibholz', en: 'Driftwood' },
    beschreibung: {
      de: 'Vom Meer gebleichtes Holz, an den Stränden der Salzküste angespült. Trocken genug, um wie Holz zu brennen.',
      en: 'Wood bleached by the sea and washed up on the beaches of the Saltcoast. Dry enough to burn like wood.',
    },
    kategorie: 'rohstoff',
    brennwert: BURN.treibholz,
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  // Stone and soil.
  baseItem({
    id: 'stein',
    name: { de: 'Stein', en: 'Stone' },
    beschreibung: {
      de: 'Handliche Steine, zwischen Kieseln aufgelesen oder mit der Spitzhacke aus Felsen geschlagen. Grundstoff für Steinwerkzeuge und Feuerstellen.',
      en: 'Handy stones, picked up among pebbles or broken from rocks with a pickaxe. Base material for stone tools and fire pits.',
    },
    kategorie: 'rohstoff',
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'feuerstein',
    name: { de: 'Feuerstein', en: 'Flint' },
    beschreibung: {
      de: 'Harter Stein mit scharfen Bruchkanten, ab und zu zwischen Kieseln und in Felsen zu finden. Daraus werden Klingen, Spitzen und Funken.',
      en: 'Hard stone with sharp fracture edges, found now and then among pebbles and in rocks. It makes blades, points and sparks.',
    },
    kategorie: 'rohstoff',
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'kies',
    name: { de: 'Kies', en: 'Gravel' },
    beschreibung: {
      de: 'Grober Steinschutt aus Felsen und Kieseln. Befestigt Wege und Böden.',
      en: 'Coarse rubble from rocks and pebbles. Firms up paths and floors.',
    },
    kategorie: 'rohstoff',
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'sand',
    name: { de: 'Sand', en: 'Sand' },
    beschreibung: {
      de: 'Mit der Schaufel an Stränden und in Dünen gegraben. Im Ofen geschmolzen wird er zu Glas.',
      en: 'Dug with a shovel on beaches and in dunes. Melted in a kiln it turns into glass.',
    },
    kategorie: 'rohstoff',
    tauschwert: 1,
    quellen: ['graben:sand', 'graben:duenengras'],
    sounds: { aufheben: ITEM_SFX.erde },
  }),
  baseItem({
    id: 'lehm',
    name: { de: 'Lehm', en: 'Clay' },
    beschreibung: {
      de: 'Zäher Boden aus den Lehmnestern der Wurzelhöhlen, mit der Schaufel gegraben. Wird zu Ziegeln und Keramik gebrannt.',
      en: 'Stiff soil from the clay pockets of the Rootcaves, dug with a shovel. Fired into bricks and pottery.',
    },
    kategorie: 'rohstoff',
    tauschwert: 2,
    quellen: ['graben:lehm'],
    sounds: { aufheben: ITEM_SFX.erde },
  }),
  baseItem({
    id: 'erde',
    name: { de: 'Erde', en: 'Soil' },
    beschreibung: {
      de: 'Mit der Schaufel aus Wiesen und offenem Boden gegraben. Füllt Beete und Pflanzkübel.',
      en: 'Dug with a shovel from meadows and bare ground. Fills garden beds and planters.',
    },
    kategorie: 'rohstoff',
    tauschwert: 1,
    quellen: ['graben:gras', 'graben:erde'],
    sounds: { aufheben: ITEM_SFX.erde },
  }),
  // Ores (§13.2: copper and tin open with T0 tools, saltpetre needs mining power 2).
  baseItem({
    id: 'kupfererz',
    name: { de: 'Kupfererz', en: 'Copper Ore' },
    beschreibung: {
      de: 'Grünlich schimmerndes Erz aus Kupfervorkommen im Grünhain und in den Wurzelhöhlen. Mit Zinnerz geschmolzen ergibt es Bronze.',
      en: 'Greenish ore from copper deposits in the Greengrove and the Rootcaves. Smelted with tin ore it makes bronze.',
    },
    kategorie: 'rohstoff',
    tauschwert: 4,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
  baseItem({
    id: 'zinnerz',
    name: { de: 'Zinnerz', en: 'Tin Ore' },
    beschreibung: {
      de: 'Graues, schweres Erz aus Zinnvorkommen im Grünhain und in den Wurzelhöhlen. Mit Kupfererz geschmolzen ergibt es Bronze.',
      en: 'Grey, heavy ore from tin deposits in the Greengrove and the Rootcaves. Smelted with copper ore it makes bronze.',
    },
    kategorie: 'rohstoff',
    tauschwert: 4,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
  baseItem({
    id: 'salpeter',
    name: { de: 'Salpeter', en: 'Saltpetre' },
    beschreibung: {
      de: 'Weiße Kristallkruste aus den Salpetervorkommen der Wurzelhöhlen; erst eine Bronzespitzhacke bricht sie. Grundstoff für Sprengtöpfe.',
      en: 'White crystal crust from the saltpetre deposits of the Rootcaves; only a bronze pickaxe breaks it. Base material for blast pots.',
    },
    kategorie: 'rohstoff',
    stufe: 1,
    raritaet: 'ungewoehnlich',
    tauschwert: 6,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
  // Plants.
  baseItem({
    id: 'fasern',
    name: { de: 'Pflanzenfasern', en: 'Plant Fibres' },
    beschreibung: {
      de: 'Zähe Halme aus Fasergras, Strandhafer und Grasbüscheln, mit der Hand gerupft. Zu Seil gedreht halten sie Werkzeuge zusammen.',
      en: 'Tough stalks pulled by hand from fibre grass, marram grass and grass tufts. Twisted into rope they hold tools together.',
    },
    kategorie: 'rohstoff',
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'schafgarbe',
    name: { de: 'Schafgarbe', en: 'Yarrow' },
    beschreibung: {
      de: 'Heilkraut mit weißen Dolden, im Sommer und Herbst zwischen den Wildkräutern des Grünhains. Stillt Blutungen – gut für Verbände.',
      en: 'Medicinal herb with white umbels, found among the wild herbs of the Greengrove in summer and autumn. Stanches bleeding – good for bandages.',
    },
    kategorie: 'rohstoff',
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'wegerich',
    name: { de: 'Wegerich', en: 'Plantain' },
    beschreibung: {
      de: 'Breitblättriges Heilkraut, von Frühling bis Herbst zwischen den Wildkräutern. Kühlt Wunden und Stiche – Grundstoff für Salben.',
      en: 'Broad-leaved medicinal herb, found among the wild herbs from spring to autumn. Soothes wounds and stings – the base of salves.',
    },
    kategorie: 'rohstoff',
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'fliegenpilz',
    name: { de: 'Fliegenpilz', en: 'Fly Agaric' },
    beschreibung: {
      de: 'Roter Pilz mit weißen Tupfen aus Pilzgruppen in Wald, Moor und Höhle, im Sommer und Herbst. Giftig – nicht essen! Taugt als Pfeilgift.',
      en: 'Red mushroom with white spots from mushroom clusters in woods, bogs and caves, in summer and autumn. Poisonous – do not eat! Makes arrow poison.',
    },
    kategorie: 'rohstoff',
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.pilz },
  }),
  baseItem({
    id: 'leuchtpilz',
    name: { de: 'Leuchtpilz', en: 'Glowcap' },
    beschreibung: {
      de: 'Schwach leuchtender Pilz aus den Wurzelhöhlen. Nicht essbar, doch sein Licht lässt sich einfangen – etwa in Blendbomben.',
      en: 'Faintly glowing mushroom from the Rootcaves. Not edible, but its light can be captured – in flash bombs, for one.',
    },
    kategorie: 'rohstoff',
    raritaet: 'ungewoehnlich',
    tauschwert: 5,
    sounds: { aufheben: ITEM_SFX.pilz },
  }),
  baseItem({
    id: 'blume_rot',
    name: { de: 'Klatschmohn', en: 'Corn Poppy' },
    beschreibung: {
      de: 'Rote Wildblume der Sommerwiesen. Schmückt das Heim und färbt rot.',
      en: 'Red wildflower of summer meadows. Brightens a home and dyes things red.',
    },
    kategorie: 'rohstoff',
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'blume_blau',
    name: { de: 'Kornblume', en: 'Cornflower' },
    beschreibung: {
      de: 'Blaue Wildblume, blüht von Sommer bis Herbst. Schmückt das Heim und färbt blau.',
      en: 'Blue wildflower that blooms from summer to autumn. Brightens a home and dyes things blue.',
    },
    kategorie: 'rohstoff',
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'blume_gelb',
    name: { de: 'Butterblume', en: 'Buttercup' },
    beschreibung: {
      de: 'Gelbe Wildblume, blüht in Frühling und Sommer. Schmückt das Heim und färbt gelb.',
      en: 'Yellow wildflower that blooms in spring and summer. Brightens a home and dyes things yellow.',
    },
    kategorie: 'rohstoff',
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  // Coast (§9.3 Salzküste).
  baseItem({
    id: 'salz',
    name: { de: 'Salz', en: 'Salt' },
    beschreibung: {
      de: 'Salzkruste, von den Küstenfelsen der Salzküste gekratzt. Würzt Speisen und macht sie haltbar.',
      en: 'Salt crust scraped off the coastal rocks of the Saltcoast. Seasons food and preserves it.',
    },
    kategorie: 'rohstoff',
    tauschwert: 4,
    sounds: { aufheben: ITEM_SFX.erde },
  }),
  baseItem({
    id: 'muschel',
    name: { de: 'Muschel', en: 'Seashell' },
    beschreibung: {
      de: 'Leere Schalen von den Stränden der Salzküste. Glatt und hübsch – gut für Talismane.',
      en: 'Empty shells from the beaches of the Saltcoast. Smooth and pretty – good for talismans.',
    },
    kategorie: 'rohstoff',
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.muschel },
  }),
]);
