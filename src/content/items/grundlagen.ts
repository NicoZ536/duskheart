/**
 * The basics made without a station (M3-16; docs/SPIEL.md §6 "Grundlagen ohne Station"; MASTERPROMPT
 * §15.1 "Ohne Station herstellbar: Grundlagen (Faserseil, Steinwerkzeuge, Fackel, Lagerfeuer, Werkbank,
 * Verband, Grasbett, Speer)"): fibre rope, torch, campfire, workbench, bandage, grass bed and stone spear.
 * Their recipes are in src/content/recipes/grundlagen.ts, the stone tools in werkzeuge.ts.
 *
 * - The campfire, the workbench and the grass bed are placed in the world (`platzierbar`): ends in
 *   themselves (`endprodukt`) – a fire to warm up and cook at (§12, §15.4), the first station (§15.2), a
 *   bed that sets the waking point with half the recovery of a real bed (§11.5, `BALANCE.sleep`).
 * - The torch is carried in the off hand (§12.2 "Fackel (Hand/Wand, 6 Tiles, 4 h)").
 * - The bandage stops bleeding when used (`CURES`, src/game/tools): consumed, an end in itself.
 * - The stone spear is the first weapon (§D: T0 base damage × the spear's class factor).
 * - Trade values [trade points]: the ingredients of the recipe plus about a fifth for the work.
 */
import { BALANCE } from '../balance';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Tier of the basics. */
const TIER = 0;
/** Durability of the stone spear [uses] (§D: T0 60). */
const DURABILITY = BALANCE.items.durabilityByTier[TIER] as number;
/** Damage of the stone spear [HP per hit]: T0 base damage × spear factor (§D: 8 × 0,95). */
const SPEAR_DAMAGE = (BALANCE.tools.weaponDamageByTier[TIER] as number) * BALANCE.tools.weaponClassFactor.speer;

/** Handling sound of tools and weapons with a wooden haft. */
const TOOL_HANDLING_SFX = ITEM_SFX.werkzeug;
/** Swing of a weapon or tool. */
const SWING_SFX = 'sfx_werkzeug_schwung';

/** The basics without a station. */
export const GRUNDLAGEN = defineItemGroup('grundlagen', [
  baseItem({
    id: 'faserseil',
    name: { de: 'Faserseil', en: 'Fibre Rope' },
    beschreibung: {
      de: 'Aus Pflanzenfasern gedrehte Schnur. Bindet Steinköpfe an ihre Stiele und hält Eimer und Werkbank zusammen.',
      en: 'Cord twisted from plant fibres. Binds stone heads to their hafts and holds buckets and the workbench together.',
    },
    kategorie: 'rohstoff',
    stufe: TIER,
    tauschwert: 4,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'fackel',
    name: { de: 'Fackel', en: 'Torch' },
    beschreibung: {
      de: 'Ein Zweig mit harzgetränkten Fasern. In der Nebenhand getragen, hält ihr Licht die Dunkelheit auf Abstand.',
      en: 'A twig wrapped in resin-soaked fibres. Carried in the off hand, its light keeps the darkness at bay.',
    },
    kategorie: 'licht',
    stufe: TIER,
    ausruestung: 'nebenhand',
    tauschwert: 7,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'lagerfeuer',
    name: { de: 'Lagerfeuer', en: 'Campfire' },
    beschreibung: {
      de: 'Ein Ring aus Steinen mit Scheiten darin. Aufgestellt wärmt und leuchtet es, solange es Brennstoff hat, und gart Essen.',
      en: 'A ring of stones with logs inside. Set up, it warms and gives light as long as it has fuel, and cooks food.',
    },
    kategorie: 'platzierbar',
    stufe: TIER,
    endprodukt: true,
    tauschwert: 10,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'werkbank',
    name: { de: 'Werkbank', en: 'Workbench' },
    beschreibung: {
      de: 'Ein grober Tisch aus Holz und Stein, mit Seil verzurrt. Aufgestellt die erste Station: an ihr entsteht, was mehr als zwei Hände braucht.',
      en: 'A rough table of wood and stone, lashed with rope. Set up, it is the first station: what needs more than two hands is made at it.',
    },
    kategorie: 'platzierbar',
    stufe: TIER,
    endprodukt: true,
    tauschwert: 26,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'verband',
    name: { de: 'Verband', en: 'Bandage' },
    beschreibung: {
      de: 'Ein Wickel aus Fasern mit zerriebener Schafgarbe. Angelegt stillt er jede Blutung sofort.',
      en: 'A wrap of fibres with crushed yarrow. Applied, it stops any bleeding at once.',
    },
    kategorie: 'medizin',
    stufe: TIER,
    endprodukt: true,
    tauschwert: 7,
    sounds: { aufheben: ITEM_SFX.pflanze, benutzen: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'grasbett',
    name: { de: 'Grasbett', en: 'Grass Bed' },
    beschreibung: {
      de: 'Ein Lager aus Fasern, Laub und Zweigen. Aufgestellt kann man darin die Nacht verschlafen und hier wieder erwachen – erholsam ist es nur halb so sehr wie ein richtiges Bett.',
      en: 'A pallet of fibres, leaves and twigs. Set up, you can sleep through the night in it and wake here again – it is only half as restful as a real bed.',
    },
    kategorie: 'platzierbar',
    stufe: TIER,
    endprodukt: true,
    tauschwert: 30,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'steinspeer',
    name: { de: 'Steinspeer', en: 'Stone Spear' },
    beschreibung: {
      de: 'Eine Feuersteinspitze an einem langen Schaft. Die erste Waffe: hält Angreifer auf Abstand.',
      en: 'A flint point on a long shaft. The first weapon: keeps attackers at a distance.',
    },
    kategorie: 'waffe',
    stufe: TIER,
    haltbarkeit: DURABILITY,
    werte: { schaden: SPEAR_DAMAGE },
    tauschwert: 11,
    sounds: { aufheben: TOOL_HANDLING_SFX, benutzen: SWING_SFX },
  }),
]);

/** Items that cure conditions when used (`player.useItem`): item id → condition ids it ends. */
export const CURES: Readonly<Record<string, readonly string[]>> = {
  // §11.3 "Blutung" (src/content/conditions.ts): "Ein Verband stillt die Blutung sofort."
  verband: ['blutung'],
};
