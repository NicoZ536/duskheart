/**
 * Screenshot scenario `ui-handwerk` (M4-32, MASTERPROMPT §31.5): the crafting menu (C) over the start beach at
 * 11:00. The player carries gathered T0 materials and one fibre rope, so the hand recipes are known; three ropes
 * and a torch are queued (the first rope 40 ticks into its work), the stone axe is pinned (`craft.pin`), and the menu shows the
 * stone axe for two pieces – its quality star, the ingredients with what is at hand, the missing rope with its
 * solution hint – with the keyboard focus frame on "2 herstellen". Registered in src/debug/scenarios.ts.
 */
import { befehle, schritte, werkstattSzenario, type WerkstattSzenario } from './szenarioHilfe';

/** Items of the picture (the inventory fills in this order). */
const ITEMS: ReadonlyArray<readonly [string, number]> = [
  ['fasern', 14],
  ['zweig', 6],
  ['stein', 5],
  ['feuerstein', 2],
  ['harz', 2],
  ['holz', 12],
  ['laub', 10],
  ['schafgarbe', 1],
  ['faserseil', 1],
];
/** Ticks the first order has worked at the picture (of 90 for a rope: ≈ 44 %). */
const ARBEIT_TICKS = 40;

export function handwerkSzenario(): WerkstattSzenario {
  return werkstattSzenario({
    name: 'ui-handwerk',
    description:
      'M4-32: Handwerksmenü (C) über dem Startstrand – Rezeptliste der Grundrezepte ohne Station mit Suchfeld, Filter und herstellbarer Menge, angeheftete Steinaxt (Nadel); gewählt die Steinaxt für zwei Stück: Qualitätsstern, Herstelldauer, „Ohne Station“, Zutaten mit Vorrat/Bedarf, „Fehlt: 1× Faserseil – herstellbar ohne Station“, Menge, Herstellen und Anheften; Warteschlange mit drei Faserseilen (Fortschritt) und einer Fackel, Schalter „Aus Kisten“; Fokusrahmen auf „2 herstellen“',
    items: ITEMS,
    schritte: [
      befehle(
        { type: 'craft.start', recipe: 'rezept_faserseil', count: 3 },
        { type: 'craft.start', recipe: 'rezept_fackel', count: 1 },
        { type: 'craft.pin', recipe: 'rezept_steinaxt', on: true },
      ),
      schritte(ARBEIT_TICKS),
    ],
    bildschirm: 'handwerk',
    klicks: ['[data-rezept="rezept_steinaxt"]', '[data-testid="handwerk-mehr"]'],
    fokus: '[data-testid="handwerk-herstellen"]',
  });
}
