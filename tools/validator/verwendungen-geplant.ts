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
  // Stufe T3 (M8-30: Sprengtopf aus Salpeter).
  salpeter: { task: 'M8-30', zweck: 'Sprengtopf' },
  // Strang I (M7-17): die Essenzen der Elites bindet der Runenaltar (M8-45).
  essenz_graufang: { task: 'M8-45', zweck: 'Runenaltar: Essenz binden' },
  essenz_alter_hauer: { task: 'M8-45', zweck: 'Runenaltar: Essenz binden' },
  // Stufe T3 (M8-30: Stahlherstellung – Sternenerz aus Meteoritenkratern und Lumenregen als Legierung; Strang B, M7-09).
  sternenerz: { task: 'M8-30', zweck: 'Sternenstahl-Legierung' },
  // Strang C (M7-15): die Essenz des Wurzelhüters (Mini-Boss der Grünhain-Gewölbe) – Essenzen werden in M8-45 verarbeitet.
  essenz_wurzelhueter: { task: 'M8-45', zweck: 'Essenz-Verarbeitung (Mini-Boss-Essenzen)' },
};
