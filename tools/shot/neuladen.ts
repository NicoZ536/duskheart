/**
 * Ein Vite-Neuladen mitten in einer Aufnahme (M6-35c; `npm run shot`, MASTERPROMPT §31.5): der Dev-Server lädt die Seite
 * neu, wenn er beim ersten Laden eines Szenarios neue Abhängigkeiten vorbündelt („new dependencies optimized … reloading“)
 * oder eine Quelle sich ändert (ein paralleler `npm run assets` schreibt `src/generated/`). Das Szenario beginnt dann von
 * vorn, die Warteschleife auf `scenarioReady` bricht mit „Execution context was destroyed“ ab oder liest die halb geladene
 * Seite, und das Bild ist verloren oder falsch. Darum zählt das Werkzeug die Navigationen des Hauptframes während einer
 * Aufnahme und wiederholt das Szenario genau einmal, wenn die Seite neu geladen wurde (`mitNeuladenWiederholung`); ein
 * zweites Neuladen ist ein Fehler mit Ursache statt einer Endlosschleife. Reine Logik, damit sie ohne Browser getestet ist
 * (tests/unit/tools/shot-neuladen.test.ts).
 */

/** Ergebnis eines Aufnahmeversuchs: die Probleme und ob die Seite währenddessen neu geladen wurde. */
export interface AufnahmeVersuch {
  readonly problems: readonly string[];
  readonly reloaded: boolean;
}

/** Versuche je Aufnahme: der erste und eine Wiederholung nach einem Neuladen. */
export const AUFNAHME_VERSUCHE = 2;

/** Fehlertexte von Playwright, wenn die Seite unter einer laufenden Abfrage navigiert (neu lädt). */
const NEULADEN_FEHLER = [/execution context was destroyed/i, /most likely because of a navigation/i, /frame was detached/i, /navigation interrupted/i, /navigating frame was detached/i] as const;

/** Ob `fehler` der Abbruch einer Abfrage durch eine Navigation der Seite ist (und kein Fehler des Szenarios). */
export function istNeuladenFehler(fehler: unknown): boolean {
  const text = fehler instanceof Error ? fehler.message : String(fehler);
  return NEULADEN_FEHLER.some((m) => m.test(text));
}

/** Was der Zähler von einer Seite braucht (Playwrights `Page`). */
export interface NavigierendeSeite<F> {
  mainFrame(): F;
  on(event: 'framenavigated', listener: (frame: F) => void): unknown;
  off(event: 'framenavigated', listener: (frame: F) => void): unknown;
}

/** Zählt die Navigationen des Hauptframes von `page` ab jetzt (ein Neuladen ist eine); `stop` meldet den Zähler ab. */
export function navigationenZaehlen<F>(page: NavigierendeSeite<F>): { readonly anzahl: number; stop(): void } {
  let anzahl = 0;
  const zaehlen = (frame: F): void => {
    if (frame === page.mainFrame()) anzahl++;
  };
  page.on('framenavigated', zaehlen);
  return {
    get anzahl() {
      return anzahl;
    },
    stop() {
      page.off('framenavigated', zaehlen);
    },
  };
}

/**
 * Führt die Aufnahme `versuch` aus und wiederholt sie einmal, wenn die Seite dabei neu geladen wurde; `melden` erfährt
 * davon. Die Probleme des letzten Versuchs zählen – lädt auch die Wiederholung neu, steht das als Problem dabei.
 */
export async function mitNeuladenWiederholung(name: string, versuch: () => Promise<AufnahmeVersuch>, melden: (text: string) => void): Promise<string[]> {
  for (let n = 1; ; n++) {
    const r = await versuch();
    if (!r.reloaded) return [...r.problems];
    if (n >= AUFNAHME_VERSUCHE) return [...r.problems, `Seite wurde auch in Versuch ${n} neu geladen (Vite) – Szenario „${name}“ nicht stabil aufnehmbar`];
    melden(`shot: ${name} – Seite während der Aufnahme neu geladen (Vite), Szenario wird wiederholt`);
  }
}
