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
 * Wartezeit auf `scenarioReady` einer Aufnahme [ms] (M7-120): die Chronik-Bilder `ui-chronik-*` brauchten unter Last ≈ 19
 * rund 100 s (ihre Welt wird im Worker erzeugt, die Sitzung läuft bis zum Stand des Bildes vor), 90 s reichten nicht. Das
 * Doppelte des Gemessenen; ein Szenario, das auch so nicht bereit wird, ist ein Fehler des Szenarios.
 */
export const READY_TIMEOUT_MS = 200_000;
/** The most the ready wait stretches on a loaded host (`bereitschaftszeit`): four times, for a load of four runnable tasks per core. */
export const READY_LOAD_FACTOR_MAX = 4;

/**
 * The ready wait on this host [ms] (M7-120): `ms` stretched by the load per core – a scenario's world generation and its
 * simulation to the state of the picture take their share of the cores, and at a 1-minute load of `load` on `cores` cores
 * they get about `cores / load` of one. Stretched at most `READY_LOAD_FACTOR_MAX` times (at load ≈ 20 on four cores the
 * chronicle pictures took over 200 s); a quiet host keeps `ms`.
 */
export function bereitschaftszeit(ms: number, load: number, cores: number): number {
  const factor = load / Math.max(1, cores);
  return Math.round(ms * (factor < 1 ? 1 : factor > READY_LOAD_FACTOR_MAX ? READY_LOAD_FACTOR_MAX : factor));
}
/** Versuche, die Probeseite (die Szenarienliste) zu starten: der erste und einer nach einer Zeitüberschreitung oder einem Neuladen. */
export const START_VERSUCHE = 2;

/** Ob `fehler` Playwrights Zeitüberschreitung ist (`Timeout 90000ms exceeded`). */
export function istZeitueberschreitung(fehler: unknown): boolean {
  const text = fehler instanceof Error ? fehler.message : String(fehler);
  return /timeout \d+ ?ms exceeded/i.test(text);
}

/**
 * Startet die Probeseite mit `start` und wiederholt den Start einmal, wenn er in eine Zeitüberschreitung lief oder die
 * Seite dabei neu geladen wurde (M7-120: unter Last reißt die Probeseite ihr Zeitbudget, und ohne sie fiel die ganze
 * Aufnahme aus); `melden` erfährt davon. Jeder andere Fehler – und der zweite Fehlschlag – geht durch.
 */
export async function mitStartWiederholung<T>(start: () => Promise<T>, melden: (text: string) => void): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await start();
    } catch (e) {
      const neuGeladen = e instanceof StartFehler ? e.neuGeladen : istNeuladenFehler(e);
      const zeit = istZeitueberschreitung(e instanceof StartFehler ? e.ursache : e);
      if (n >= START_VERSUCHE || (!neuGeladen && !zeit)) throw e;
      melden(`shot: Probeseite ${zeit ? 'lief in eine Zeitüberschreitung' : 'wurde neu geladen (Vite)'} – Start wird wiederholt`);
    }
  }
}

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
