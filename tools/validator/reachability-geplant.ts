/**
 * Geplante Erreichbarkeit (M3-38; MASTERPROMPT §13.2, §31.4): Items, deren Weltquelle schon existiert,
 * deren Werkzeug aber erst ein späterer Backlog-Task liefert – z. B. ein Erz, das eine Spitzhacke höherer
 * Abbaukraft verlangt, deren Rezept erst mit dem Boss-Drop der Stufe kommt. Jeder Eintrag nennt den Task
 * aus PROGRESS.md und den Grund.
 *
 * Der Erreichbarkeitsgraph (reachability.ts) erzwingt die Liste in beide Richtungen wie die geplanten
 * Verwendungen: Eine Waise ohne Eintrag ist ein Fehler; ist der genannte Task abgehakt und das Item noch
 * immer nicht erreichbar, ebenfalls; ein unbekannter Task oder ein unbekanntes Item auch. Ist ein Item
 * inzwischen erreichbar, meldet der Graph den Eintrag als veraltet (Warnung). So kann die Liste nur
 * schrumpfen.
 */

/** Eine geplante Erreichbarkeit. */
export interface GeplanteErreichbarkeit {
  /** Backlog-Task, der die fehlende Voraussetzung liefert (PROGRESS.md). */
  readonly task: string;
  /** Was fehlt. */
  readonly grund: string;
}

/** Item-Id → geplante Erreichbarkeit. */
export const GEPLANTE_ERREICHBARKEIT: Readonly<Record<string, GeplanteErreichbarkeit>> = {
  // Salpeter-Adern der Wurzelhöhlen haben Härte 2 (src/content/ores.ts); die Bronzespitzhacke (Abbaukraft 2) entsteht mit dem Kernholz des Borkenvaters.
  salpeter: { task: 'M7-34', grund: 'Salpeter (Härte 2) braucht die Bronzespitzhacke' },
};
