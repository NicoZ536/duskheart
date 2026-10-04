/**
 * M6-35c: lädt Vite die Seite mitten in einer Aufnahme neu, wiederholt `npm run shot` das Szenario genau einmal
 * (tools/shot/neuladen.ts): Navigationen des Hauptframes werden gezählt, ein von der Navigation abgebrochener
 * Playwright-Aufruf gilt als Neuladen (nicht als Fehler des Szenarios), ein zweites Neuladen ist ein Problem mit Ursache.
 */
import { describe, expect, it } from 'vitest';
import { AUFNAHME_VERSUCHE, istNeuladenFehler, mitNeuladenWiederholung, navigationenZaehlen, type AufnahmeVersuch, type NavigierendeSeite } from '../../../tools/shot/neuladen';

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
