/**
 * M6-35c: lädt Vite die Seite mitten in einer Aufnahme neu, wiederholt `npm run shot` das Szenario genau einmal
 * (tools/shot/neuladen.ts): Navigationen des Hauptframes werden gezählt, ein von der Navigation abgebrochener
 * Playwright-Aufruf gilt als Neuladen (nicht als Fehler des Szenarios), ein zweites Neuladen ist ein Problem mit Ursache.
 * M6-35e: der Zähler hängt schon vor `page.goto` (`spielOeffnen`, von `openGame` in tools/lib/browser.ts benutzt) – ein
 * Neuladen während des Starts ist ein Neuladen, kein misslungener Start.
 */
import { describe, expect, it } from 'vitest';
import {
  AUFNAHME_VERSUCHE,
  istNeuladenFehler,
  mitNeuladenWiederholung,
  navigationenZaehlen,
  neuladenZaehlen,
  spielOeffnen,
  START_TIMEOUT_MS,
  StartFehler,
  type AufnahmeVersuch,
  type NavigierendeSeite,
  type StartendeSeite,
} from '../../../tools/shot/neuladen';

/** Versuche, die der Reihe nach die gegebenen Ergebnisse liefern; zählt die Aufrufe. */
function versuche(...ergebnisse: AufnahmeVersuch[]): { readonly aufrufe: number; versuch(): Promise<AufnahmeVersuch> } {
  let aufrufe = 0;
  return {
    get aufrufe() {
      return aufrufe;
    },
    versuch() {
      const r = ergebnisse[aufrufe] ?? ergebnisse.at(-1);
      aufrufe++;
      if (r === undefined) throw new Error('keine Ergebnisse');
      return Promise.resolve(r);
    },
  };
}

/** Eine Seite mit Haupt- und Unterframe, deren Navigationen der Test auslöst. */
function seite(): NavigierendeSeite<string> & { navigiere(frame: string): void; readonly zuhoerer: number } {
  const listeners = new Set<(frame: string) => void>();
  return {
    mainFrame: () => 'haupt',
    on: (_e, l) => listeners.add(l),
    off: (_e, l) => listeners.delete(l),
    navigiere: (frame) => listeners.forEach((l) => l(frame)),
    get zuhoerer() {
      return listeners.size;
    },
  };
}

describe('npm run shot: Wiederholung nach Vite-Neuladen (M6-35c)', () => {
  it('ohne Neuladen ein Versuch, seine Probleme zählen', async () => {
    const v = versuche({ problems: ['unscharf'], reloaded: false });
    const meldungen: string[] = [];
    expect(await mitNeuladenWiederholung('kampf-tag', () => v.versuch(), (t) => meldungen.push(t))).toEqual(['unscharf']);
    expect(v.aufrufe).toBe(1);
    expect(meldungen).toEqual([]);
  });

  it('nach einem Neuladen wird das Szenario einmal wiederholt; nur das Ergebnis der Wiederholung zählt', async () => {
    const v = versuche({ problems: ['abgebrochen: Execution context was destroyed'], reloaded: true }, { problems: [], reloaded: false });
    const meldungen: string[] = [];
    expect(await mitNeuladenWiederholung('kampf-tag', () => v.versuch(), (t) => meldungen.push(t))).toEqual([]);
    expect(v.aufrufe).toBe(2);
    expect(meldungen).toHaveLength(1);
    expect(meldungen[0]).toContain('kampf-tag');
  });

  it('höchstens eine Wiederholung: lädt auch sie neu, ist das ein Problem mit Ursache (keine Endlosschleife)', async () => {
    const v = versuche({ problems: [], reloaded: true });
    const probleme = await mitNeuladenWiederholung('treffer', () => v.versuch(), () => undefined);
    expect(v.aufrufe).toBe(AUFNAHME_VERSUCHE);
    expect(AUFNAHME_VERSUCHE).toBe(2);
    expect(probleme).toHaveLength(1);
    expect(probleme[0]).toMatch(/neu geladen.*treffer/);
  });

  it('nur Navigationen des Hauptframes zählen; abgemeldet zählt nichts mehr', () => {
    const p = seite();
    const zaehler = navigationenZaehlen(p);
    expect(zaehler.anzahl).toBe(0);
    p.navigiere('iframe');
    expect(zaehler.anzahl).toBe(0);
    p.navigiere('haupt');
    p.navigiere('haupt');
    expect(zaehler.anzahl).toBe(2);
    zaehler.stop();
    expect(p.zuhoerer).toBe(0);
    p.navigiere('haupt');
    expect(zaehler.anzahl).toBe(2);
  });

  it('Abbrüche durch eine Navigation erkennt das Werkzeug, Fehler des Szenarios nicht', () => {
    expect(istNeuladenFehler(new Error('page.waitForFunction: Execution context was destroyed, most likely because of a navigation'))).toBe(true);
    expect(istNeuladenFehler(new Error('page.evaluate: Frame was detached'))).toBe(true);
    expect(istNeuladenFehler('Navigation interrupted by another one')).toBe(true);
    expect(istNeuladenFehler(new Error('page.waitForFunction: Timeout 90000ms exceeded.'))).toBe(false);
    expect(istNeuladenFehler(new Error('Szenario biom-gruenhain-tag braucht Renderer und Sitzung'))).toBe(false);
  });
});

/** Was die gespielte Seite beim Start tut: Navigationen des Hauptframes während `goto` und während des Wartens, dann gelingt oder misslingt es. */
interface StartSkript {
  readonly beimGoto: number;
  readonly beimWarten: number;
  readonly gotoFehler?: Error;
  readonly wartenFehler?: Error;
}

/** Eine Seite, die beim Start nach `skript` navigiert; zeichnet die Aufrufe auf. */
function startendeSeite(skript: StartSkript): StartendeSeite<string> & { navigiere(frame: string): void; readonly zuhoerer: number; readonly aufrufe: string[] } {
  const p = seite();
  const aufrufe: string[] = [];
  return {
    mainFrame: p.mainFrame,
    on: p.on,
    off: p.off,
    navigiere: p.navigiere,
    get zuhoerer() {
      return p.zuhoerer;
    },
    aufrufe,
    goto(url, options) {
      aufrufe.push(`goto ${url} ${options.timeout}`);
      for (let i = 0; i < skript.beimGoto; i++) p.navigiere('haupt');
      return skript.gotoFehler === undefined ? Promise.resolve(null) : Promise.reject(skript.gotoFehler);
    },
    waitForFunction(_fn, _arg, options) {
      aufrufe.push(`warten ${options.timeout}`);
      for (let i = 0; i < skript.beimWarten; i++) p.navigiere('haupt');
      return skript.wartenFehler === undefined ? Promise.resolve(true) : Promise.reject(skript.wartenFehler);
    },
  };
}

/** Der Fehler, mit dem `spielOeffnen` scheitert (oder null, wenn der Start gelingt). */
async function startFehler(page: StartendeSeite<string>): Promise<StartFehler | null> {
  try {
    await spielOeffnen(page, 'http://127.0.0.1/?debug=1');
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(StartFehler);
    return e as StartFehler;
  }
}

const ZEITUEBERSCHREITUNG = new Error('page.waitForFunction: Timeout 90000ms exceeded.');

describe('npm run shot: Neuladen während des Starts (M6-35e)', () => {
  it('der Neuladezähler zählt die Navigation des Starts nicht, jede weitere schon', () => {
    const p = seite();
    const zaehler = neuladenZaehlen(p);
    expect(zaehler.anzahl).toBe(0);
    p.navigiere('haupt');
    expect(zaehler.anzahl).toBe(0);
    p.navigiere('iframe');
    expect(zaehler.anzahl).toBe(0);
    p.navigiere('haupt');
    expect(zaehler.anzahl).toBe(1);
    zaehler.stop();
    expect(p.zuhoerer).toBe(0);
  });

  it('ein Neuladen während des Wartens auf das Spiel zählt als Neuladen, auch wenn der Start danach in eine Zeitüberschreitung läuft', async () => {
    const page = startendeSeite({ beimGoto: 1, beimWarten: 1, wartenFehler: ZEITUEBERSCHREITUNG });
    const fehler = await startFehler(page);
    expect(fehler?.neuGeladen).toBe(true);
    expect(fehler?.ursache).toBe(ZEITUEBERSCHREITUNG);
    expect(fehler?.message).toContain('Timeout');
    // Der Zähler ist abgemeldet; der Start lief in der Reihenfolge goto, warten.
    expect(page.zuhoerer).toBe(0);
    expect(page.aufrufe).toEqual([`goto http://127.0.0.1/?debug=1 ${START_TIMEOUT_MS}`, `warten ${START_TIMEOUT_MS}`]);
  });

  it('ein Neuladen schon während page.goto zählt (der Zähler hängt vor goto)', async () => {
    const fehler = await startFehler(startendeSeite({ beimGoto: 2, beimWarten: 0, wartenFehler: ZEITUEBERSCHREITUNG }));
    expect(fehler?.neuGeladen).toBe(true);
  });

  it('goto, von Vites Neuladen unterbrochen, ist ein Neuladen (Playwrights Meldung), auch ohne zweite Navigation', async () => {
    const unterbrochen = new Error('page.goto: Navigation to "http://127.0.0.1/?debug=1" is interrupted by another navigation to "http://127.0.0.1/?debug=1"');
    expect(istNeuladenFehler(unterbrochen)).toBe(true);
    const fehler = await startFehler(startendeSeite({ beimGoto: 1, beimWarten: 0, gotoFehler: unterbrochen }));
    expect(fehler?.neuGeladen).toBe(true);
  });

  it('ohne Neuladen ist eine Zeitüberschreitung ein Fehler des Szenarios', async () => {
    const fehler = await startFehler(startendeSeite({ beimGoto: 1, beimWarten: 0, wartenFehler: ZEITUEBERSCHREITUNG }));
    expect(fehler?.neuGeladen).toBe(false);
  });

  it('nach gelungenem Start zählt der Zähler weiter: ein Neuladen während des Starts und eines während der Aufnahme', async () => {
    const page = startendeSeite({ beimGoto: 1, beimWarten: 1 });
    const zaehler = await spielOeffnen(page, 'http://127.0.0.1/?debug=1&scenario=kampf-tag');
    expect(zaehler.anzahl).toBe(1);
    page.navigiere('haupt');
    expect(zaehler.anzahl).toBe(2);
    zaehler.stop();
    expect(page.zuhoerer).toBe(0);
    // Ein ruhiger Start: kein Neuladen.
    const ruhig = await spielOeffnen(startendeSeite({ beimGoto: 1, beimWarten: 0 }), 'http://127.0.0.1/?debug=1');
    expect(ruhig.anzahl).toBe(0);
    ruhig.stop();
  });

  it('die Aufnahme wiederholt einen Start, der neu geladen wurde (StartFehler.neuGeladen als Versuchsergebnis)', async () => {
    let starts = 0;
    const versuch = async (): Promise<AufnahmeVersuch> => {
      starts++;
      const page = startendeSeite(starts === 1 ? { beimGoto: 1, beimWarten: 1, wartenFehler: ZEITUEBERSCHREITUNG } : { beimGoto: 1, beimWarten: 0 });
      try {
        const zaehler = await spielOeffnen(page, 'http://127.0.0.1/?debug=1');
        zaehler.stop();
        return { problems: [], reloaded: zaehler.anzahl > 0 };
      } catch (e) {
        return { problems: [`Start fehlgeschlagen: ${String(e)}`], reloaded: e instanceof StartFehler && e.neuGeladen };
      }
    };
    expect(await mitNeuladenWiederholung('kampf-tag', versuch, () => undefined)).toEqual([]);
    expect(starts).toBe(2);
  });
});
