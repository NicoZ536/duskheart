/**
 * Content-Mindestmengen (MASTERPROMPT §C) und Zwischenziele je Meilenstein (ADR-0004).
 * Der Validator erzwingt die Ziele des aktuellen Meilensteins aus PROGRESS.md.
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

const ZERO: Targets = Object.fromEntries(Object.keys(FINAL).map((k) => [k, 0])) as Targets;

/** Zwischenziele: jeder Meilenstein erbt die Werte des vorherigen und erhöht einzelne Kategorien. */
const STEPS: Array<[string, Partial<Targets>]> = [
  ['M0', {}],
  ['M1', {}],
  ['M2', { trees: 6 }],
  ['M3', { items: 60, statusEffects: 30, trees: 8 }],
  ['M4', { items: 150, recipes: 90, stations: 12, buildParts: 60 }],
  ['M5', {}],
  ['M6', { items: 190, weapons: 24, creatures: 18, elites: 3, sfx: 60 }],
  ['M7', { items: 260, recipes: 150, stations: 18, buildParts: 80, weapons: 28, armor: 8, armorSets: 2, jewelry: 6, dishes: 16, potions: 6, crops: 10, trees: 10, fish: 8, creatures: 22, elites: 4, bosses: 1, vaults: 4, roomTemplates: 24, puzzleTypes: 6, locationTypes: 10, tablets: 12, achievements: 15, perks: 72, music: 4, sfx: 120 }],
  ['M8', { items: 360, recipes: 230, stations: 24, buildParts: 110, weapons: 44, armor: 20, armorSets: 5, jewelry: 14, dishes: 30, potions: 14, crops: 18, trees: 12, fish: 14, creatures: 42, elites: 8, bosses: 4, vaults: 12, roomTemplates: 50, puzzleTypes: 10, locationTypes: 14, tablets: 28, achievements: 30, music: 10, sfx: 180 }],
  ['M9', { items: 390, recipes: 260, buildParts: 140, settlers: 20, settlerLines: 250, achievements: 38, music: 12, sfx: 210 }],
  ['M10', { items: 470, recipes: 320, stations: 28, buildParts: 150, weapons: 62, armor: 36, armorSets: 9, jewelry: 22, dishes: 45, potions: 18, crops: 24, trees: 14, fish: 20, creatures: 58, elites: 12, bosses: 6, vaults: 20, roomTemplates: 75, puzzleTypes: 13, locationTypes: 17, tablets: 44, achievements: 46, music: 16, sfx: 250 }],
  ['M11', { items: 500, recipes: 345, stations: 30, buildParts: 175 }],
  ['M12', { ...FINAL, music: 20, sfx: 280 }],
  ['M13', { ...FINAL }],
  ['M14', { ...FINAL }],
];

export function targetsFor(milestone: string): Targets {
  let acc: Targets = { ...ZERO };
  for (const [m, delta] of STEPS) {
    acc = { ...acc, ...delta };
    if (m === milestone) return acc;
  }
  throw new Error(`Unbekannter Meilenstein ${milestone}`);
}
