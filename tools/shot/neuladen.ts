/**
 * Ein Vite-Neuladen mitten in einer Aufnahme (M6-35c; `npm run shot`, MASTERPROMPT §31.5): der Dev-Server lädt die Seite
 * neu, wenn er beim ersten Laden eines Szenarios neue Abhängigkeiten vorbündelt („new dependencies optimized … reloading“)
 * oder eine Quelle sich ändert (ein paralleler `npm run assets` schreibt `src/generated/`). Das Szenario beginnt dann von
 * vorn, die Warteschleife auf `scenarioReady` bricht mit „Execution context was destroyed“ ab oder liest die halb geladene
 * Seite, und das Bild ist verloren oder falsch. Darum zählt das Werkzeug die Navigationen des Hauptframes während einer
 * Aufnahme und wiederholt das Szenario genau einmal, wenn die Seite neu geladen wurde (`mitNeuladenWiederholung`); ein
 * zweites Neuladen ist ein Fehler mit Ursache statt einer Endlosschleife. Der Zähler läuft schon vor `page.goto`
 * (`spielOeffnen`, M6-35e): ein Neuladen während des Starts – Vite bündelt beim ersten Laden vor – ist ein Neuladen, kein
 * misslungener Start des Szenarios. Reine Logik, damit sie ohne Browser getestet ist (tests/unit/tools/shot-neuladen.test.ts).
 */

/** Ergebnis eines Aufnahmeversuchs: die Probleme und ob die Seite währenddessen neu geladen wurde. */
export interface AufnahmeVersuch {
  readonly problems: readonly string[];
  readonly reloaded: boolean;
}

/** Versuche je Aufnahme: der erste und eine Wiederholung nach einem Neuladen. */
export const AUFNAHME_VERSUCHE = 2;

/** Fehlertexte von Playwright, wenn die Seite unter einer laufenden Abfrage navigiert (neu lädt). */
const NEULADEN_FEHLER = [
  /execution context was destroyed/i,
  /most likely because of a navigation/i,
  /frame was detached/i,
  /navigation interrupted/i,
  /navigating frame was detached/i,
  // `page.goto`, während Vite die Seite neu lädt: „Navigation to "…" is interrupted by another navigation to "…"“.
  /is interrupted by another navigation/i,
] as const;

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

/** Ein Zähler der Neuladungen einer Seite (`neuladenZaehlen`). */
export interface Neuladezaehler {
  /** Neuladungen bisher: Navigationen des Hauptframes nach der ersten, dem Start selbst. */
  readonly anzahl: number;
  stop(): void;
}

/**
 * Zählt die Neuladungen von `page`, angehängt vor `page.goto` (M6-35e): die erste Navigation des Hauptframes ist der Start
 * selbst, jede weitere ein Neuladen – auch eines, während das Spiel noch startet.
 */
export function neuladenZaehlen<F>(page: NavigierendeSeite<F>): Neuladezaehler {
  const navigationen = navigationenZaehlen(page);
  return {
    get anzahl() {
      const n = navigationen.anzahl - 1;
      return n > 0 ? n : 0;
    },
    stop() {
      navigationen.stop();
    },
  };
}

/** Ein misslungener Spielstart (`spielOeffnen`): `neuGeladen`, wenn die Seite währenddessen neu geladen wurde. */
export class StartFehler extends Error {
  constructor(
    readonly ursache: unknown,
    readonly neuGeladen: boolean,
  ) {
    super(ursache instanceof Error ? ursache.message : String(ursache));
    this.name = 'StartFehler';
  }
}

/** Was `spielOeffnen` von einer Seite braucht (Playwrights `Page`). */
export interface StartendeSeite<F> extends NavigierendeSeite<F> {
  goto(url: string, options: { timeout: number }): Promise<unknown>;
  waitForFunction(fn: () => boolean, arg: undefined, options: { timeout: number }): Promise<unknown>;
}

/**
 * Wartezeit auf das Laden der Seite und auf `__dh.ready` beim Start [ms] (Vites erstes Umwandeln der Module, Webschrift,
 * Spielatlas, WebGL-Aufwärmen unter SwiftShader – auf einer ausgelasteten Maschine dauert schon das Laden länger als
 * Playwrights 30 s).
 */
export const START_TIMEOUT_MS = 90_000;

/**
 * Öffnet das Spiel unter `url` auf `page` und wartet auf `__dh.ready`; der Neuladezähler läuft dabei von Anfang an (vor
 * `page.goto`, M6-35e) und danach weiter – die Aufnahme fragt ihn am Ende. Misslingt der Start, meldet er sich ab, und
 * `StartFehler.neuGeladen` sagt, ob die Seite währenddessen neu geladen wurde oder Playwright den Abbruch durch eine
 * Navigation meldet (`istNeuladenFehler`): dann ist der Fehlschlag ein Neuladen und kein Fehler des Szenarios.
 */
export async function spielOeffnen<F>(page: StartendeSeite<F>, url: string): Promise<Neuladezaehler> {
  const neuladen = neuladenZaehlen(page);
  try {
    await page.goto(url, { timeout: START_TIMEOUT_MS });
    await page.waitForFunction(() => (window as unknown as { __dh?: { ready?: boolean } }).__dh?.ready === true, undefined, { timeout: START_TIMEOUT_MS });
  } catch (e) {
    neuladen.stop();
    throw new StartFehler(e, neuladen.anzahl > 0 || istNeuladenFehler(e));
  }
  return neuladen;
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
