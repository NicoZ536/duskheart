/**
 * Content-Zählkategorien und Mindestmengen (MASTERPROMPT §C). Die aktuell erzwungenen Zielwerte
 * stehen in `tools/validator/zielwerte.json` (ADR-0007); die Zählregeln beschreibt ADR-0006.
 */
export const CATEGORIES = {
  items: 'Items gesamt (inkl. Bauteile)',
  recipes: 'Rezepte',
  stations: 'Stationen',
  buildParts: 'Bauteile, Möbel, Deko',
  weapons: 'Waffen (alle Stufen)',
  armor: 'Rüstungsteile',
  armorSets: 'Rüstungssets',
  jewelry: 'Schmuck',
  dishes: 'Gerichte & Getränke',
  potions: 'Tränke & Medizin',
  crops: 'Nutzpflanzen',
  trees: 'Baumarten',
  fish: 'Fischarten',
  statusEffects: 'Statuseffekte',
  creatures: 'Kreaturen (ohne Varianten)',
  elites: 'Elites',
  bosses: 'Bosse',
  vaults: 'Gewölbe pro Welt „Mittel“',
  roomTemplates: 'Raumvorlagen',
  puzzleTypes: 'Rätseltypen',
  locationTypes: 'Ortstypen',
  settlers: 'Siedler',
  settlerLines: 'Siedler-Sprüche',
  tablets: 'Erbauer-Tafeln',
  achievements: 'Erfolge',
  perks: 'Perks',
  music: 'Musikstücke',
  sfx: 'Soundeffekte',
} as const;

export type Category = keyof typeof CATEGORIES;
export type Targets = Record<Category, number>;

/** §C – Endwerte. */
export const FINAL: Targets = {
  items: 550, recipes: 380, stations: 30, buildParts: 180, weapons: 80, armor: 48, armorSets: 12, jewelry: 30,
  dishes: 55, potions: 22, crops: 28, trees: 14, fish: 24, statusEffects: 30, creatures: 70, elites: 15, bosses: 9,
  vaults: 24, roomTemplates: 90, puzzleTypes: 14, locationTypes: 18, settlers: 20, settlerLines: 250, tablets: 60,
  achievements: 60, perks: 72, music: 22, sfx: 300,
};
