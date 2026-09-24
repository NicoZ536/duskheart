/**
 * Geplante Verwendungen (MASTERPROMPT §31.4 „mindestens eine Quelle und eine Verwendung (außer
 * Endprodukten)“, §2.2): Items, die schon eine Quelle haben, deren Verwendung aber erst ein späterer
 * Backlog-Task liefert (Rezepte, Baukosten, Stationen). Jeder Eintrag nennt den Task aus PROGRESS.md
 * und den Zweck.
 *
 * Der Validator (tools/validator/items.ts) erzwingt die Liste in beide Richtungen: Ein Item ohne
 * Verwendung und ohne Eintrag ist ein Fehler; ist der genannte Task abgehakt und das Item hat noch
 * immer keine Verwendung, ebenfalls; ein unbekannter Task oder ein unbekanntes Item auch. Hat ein Item
 * inzwischen eine Verwendung, meldet der Validator den Eintrag als veraltet (Warnung) – dann wird er
 * hier gestrichen. So kann die Liste nur schrumpfen, und keine Verwendung geht verloren.
 */

/** Eine geplante Verwendung. */
export interface GeplanteVerwendung {
  /** Backlog-Task, der die Verwendung liefert (PROGRESS.md). */
  readonly task: string;
  /** Wofür das Item dort gebraucht wird. */
  readonly zweck: string;
}

/** Item-Id → geplante Verwendung. */
export const GEPLANTE_VERWENDUNGEN: Readonly<Record<string, GeplanteVerwendung>> = {
  // Zwischenprodukte und Bronze (M4-10: Bronze aus Kupfer + Zinn, Ziegel, Keramik, Glas).
  kupfererz: { task: 'M4-10', zweck: 'Bronze (Kupfer + Zinn)' },
  zinnerz: { task: 'M4-10', zweck: 'Bronze (Kupfer + Zinn)' },
  lehm: { task: 'M4-10', zweck: 'Ziegel und Keramik aus dem Lehmofen' },
  sand: { task: 'M4-10', zweck: 'Glas aus dem Lehmofen' },
  // Baumaterialien T0–T1 (M4-12: Böden).
  kies: { task: 'M4-12', zweck: 'Kiesboden und Wege' },
  // Munition (M6-07: Giftpfeile).
  fliegenpilz: { task: 'M6-07', zweck: 'Giftpfeile' },
  // Kochen (M7-25: Einlegen mit Salz, §18).
  salz: { task: 'M7-25', zweck: 'Einlegen und Würzen' },
  // Content-Stand M7 (M7-62: Muscheltalismane, Deko Grünhain/Küste, Farm-Bauteile).
  muschel: { task: 'M7-62', zweck: 'Muscheltalisman' },
  blume_rot: { task: 'M7-62', zweck: 'Blumendeko Grünhain' },
  blume_blau: { task: 'M7-62', zweck: 'Blumendeko Grünhain' },
  blume_gelb: { task: 'M7-62', zweck: 'Blumendeko Grünhain' },
  erde: { task: 'M7-62', zweck: 'Beete (Farm-Bauteile)' },
  // Stufe T3 (M8-30: Sprengtopf aus Salpeter, Blendbombe aus Leuchtpilz).
  salpeter: { task: 'M8-30', zweck: 'Sprengtopf' },
  leuchtpilz: { task: 'M8-30', zweck: 'Blendbombe' },
};
