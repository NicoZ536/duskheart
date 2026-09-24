/**
 * Warteschlange der Benachrichtigungen (M3-29, §26 „gestapelte Aufsammel-Meldungen, Entdeckungen,
 * Warnungen; nie mehr als 4 gleichzeitig“) – rein und zeitgesteuert von außen (`jetzt` in Sekunden der
 * Präsentationsuhr), getestet in `tests/unit/ui/meldungen-warteschlange.test.ts`.
 *
 * Regeln:
 * - Höchstens `max` (4) Meldungen sind sichtbar – ausblendende zählen mit. Weitere warten, nach Vorrang
 *   (Warnung vor Entdeckung vor Aufsammeln) und in Ankunftsfolge.
 * - Aufsammeln stapelt: Dasselbe Item, solange seine Meldung sichtbar ist oder wartet, erhöht nur die
 *   Anzahl („Feuerstein ×3“) und beginnt die Anzeigedauer neu – auch eine schon ausblendende Meldung lebt
 *   wieder auf.
 * - Warnungen und Entdeckungen erscheinen nie doppelt; eine Warnung bleibt nach dem Verschwinden
 *   `warnungSperre` Sekunden still (kein Dauerfeuer, wenn ein Wert an einer Schwelle pendelt).
 * - Wartet etwas Wichtigeres oder Gleichrangiges, blendet die älteste, am wenigsten wichtige Meldung nach
 *   `mindestSichtbar` Sekunden vorzeitig aus – so staut sich nichts.
 * - Ausblenden in drei harten Stufen (Pixelgrafik kennt keine weichen Übergänge, wie die Schadenszahlen
 *   ADR-0014), danach rückt die nächste nach.
 */

/** Art einer Meldung. */
export type MeldungArt = 'aufsammeln' | 'entdeckung' | 'warnung';
export const MELDUNG_ARTEN: readonly MeldungArt[] = ['aufsammeln', 'entdeckung', 'warnung'];

/** Vorrang: höher = wichtiger (wartet kürzer, verdrängt Unwichtigeres). */
export const MELDUNG_VORRANG: Readonly<Record<MeldungArt, number>> = { aufsammeln: 1, entdeckung: 2, warnung: 3 };

export interface MeldungZeiten {
  /** Anzeigedauer je Art nach dem Erscheinen bzw. der letzten Zusammenführung [s]. */
  readonly dauer: Readonly<Record<MeldungArt, number>>;
  /** Einblenden (die Meldung rückt 2 px herein) [s]. */
  readonly einblenden: number;
  /** Ausblendstufen und ihre Dauer [s]. */
  readonly ausblendStufen: number;
  readonly ausblendStufe: number;
  /** Hervorhebung der Anzahl nach einer Zusammenführung [s]. */
  readonly hervorheben: number;
  /** So lange ist eine Meldung mindestens zu sehen, bevor Wartende sie verdrängen [s]. */
  readonly mindestSichtbar: number;
  /** Stille derselben Warnung nach ihrem Verschwinden [s]. */
  readonly warnungSperre: number;
}

/**
 * Zeiten: Aufsammeln 3,5 s (genug für Name und Anzahl, kurz genug für Sammelketten), Entdeckungen und
 * Warnungen 6 s (ein Satz mit Lösungshinweis, §26 „Fehlermeldungen sagen, was fehlt und wie man es löst“).
 */
export const MELDUNG_ZEITEN: MeldungZeiten = {
  dauer: { aufsammeln: 3.5, entdeckung: 6, warnung: 6 },
  einblenden: 0.12,
  ausblendStufen: 3,
  ausblendStufe: 0.15,
  hervorheben: 0.25,
  mindestSichtbar: 1.2,
  warnungSperre: 30,
};

/** §26: nie mehr als vier Meldungen gleichzeitig. */
export const MAX_SICHTBAR = 4;
/** Längste Warteschlange; darüber fallen die ältesten Aufsammel-Meldungen weg (die Taschen zeigen den Rest). */
export const MAX_WARTEND = 16;

/** Was mit einer gemeldeten Meldung geschah. */
export type MeldungErgebnis = 'neu' | 'wartet' | 'gestapelt' | 'verworfen';

/** Eine neue Meldung. `daten` trägt, was die Anzeige braucht (Symbol, Text); die Warteschlange liest es nicht. */
export interface MeldungEingabe<D> {
  readonly art: MeldungArt;
  /** Gleicher Schlüssel = dieselbe Meldung (Aufsammeln: Item-ID, Warnung: Warnungs-ID, Entdeckung: Ort). */
  readonly schluessel: string;
  /** Aufsammeln: Anzahl, beim Stapeln addiert (Standard 1). */
  readonly anzahl?: number;
  readonly daten: D;
}

export interface Meldung<D> {
  readonly id: number;
  readonly art: MeldungArt;
  readonly schluessel: string;
  anzahl: number;
  daten: D;
  /** Erscheinen [s]. */
  seit: number;
  /** Letzte Zusammenführung [s] (Hervorhebung der Anzahl). */
  gestapelt: number;
  /** Beginn des Ausblendens [s]. */
  bis: number;
  /** Zuletzt gemeldete Anzeigestufe (erkennt Änderungen in `aktualisiere`). */
  stufe: number;
}

/** Wie eine Meldung gerade aussieht. */
export interface MeldungAnsicht {
  /** Rückt herein, steht, hebt die Anzahl hervor oder blendet aus. */
  readonly phase: 'ein' | 'sichtbar' | 'hervorgehoben' | 'aus';
  /** Deckkraft in harten Stufen (1, ¾, ½, ¼). */
  readonly deckkraft: number;
}

/** Letzte Aktivität einer Meldung: Erscheinen oder Stapeln [s]. */
function aktivitaet(m: Meldung<unknown>): number {
  return Math.max(m.seit, m.gestapelt);
}

export class MeldungenWarteschlange<D> {
  private readonly aktiv: Meldung<D>[] = [];
  private readonly warten: Meldung<D>[] = [];
  private readonly gesperrt = new Map<string, number>();
  private naechsteId = 1;
  /** Seit dem letzten `aktualisiere` angenommene Meldungen (auch gestapelte). */
  private neu = false;

  constructor(
    private readonly zeiten: MeldungZeiten = MELDUNG_ZEITEN,
    readonly max = MAX_SICHTBAR,
  ) {}

  /** Sichtbare Meldungen, älteste zuerst (auch ausblendende). */
  get sichtbar(): readonly Meldung<D>[] {
    return this.aktiv;
  }

  /** Wartende Meldungen. */
  get wartend(): number {
    return this.warten.length;
  }

  /** Nimmt eine Meldung an: zeigt, stapelt, reiht ein oder verwirft sie (Doppel, Sperre). */
  melde(e: MeldungEingabe<D>, jetzt: number): MeldungErgebnis {
    const n = Math.max(1, Math.floor(e.anzahl ?? 1));
    this.neu = true;
    const gleich = (m: Meldung<D>): boolean => m.art === e.art && m.schluessel === e.schluessel;
    const sichtbar = this.aktiv.find(gleich);
    const wartend = this.warten.find(gleich);
    if (e.art === 'aufsammeln') {
      if (sichtbar !== undefined) {
        sichtbar.anzahl += n;
        sichtbar.daten = e.daten;
        sichtbar.gestapelt = jetzt;
        sichtbar.bis = jetzt + this.zeiten.dauer.aufsammeln;
        return 'gestapelt';
      }
      if (wartend !== undefined) {
        wartend.anzahl += n;
        wartend.daten = e.daten;
        return 'gestapelt';
      }
    } else {
      if (sichtbar !== undefined) {
        // Eine Warnung, die weiter zutrifft, bleibt länger stehen; Entdeckungen gibt es nur einmal.
        if (e.art === 'warnung' && jetzt < sichtbar.bis) sichtbar.bis = jetzt + this.zeiten.dauer.warnung;
        return 'verworfen';
      }
      if (wartend !== undefined) return 'verworfen';
      const ende = this.gesperrt.get(e.schluessel);
      if (e.art === 'warnung' && ende !== undefined && jetzt - ende < this.zeiten.warnungSperre) return 'verworfen';
    }
    const m: Meldung<D> = { id: this.naechsteId++, art: e.art, schluessel: e.schluessel, anzahl: n, daten: e.daten, seit: jetzt, gestapelt: -Infinity, bis: jetzt + this.zeiten.dauer[e.art], stufe: -1 };
    if (this.aktiv.length < this.max) {
      this.aktiv.push(m);
      return 'neu';
    }
    this.reiheEin(m);
    this.macheRaum(jetzt);
    return 'wartet';
  }

  /**
   * Schreitet zur Zeit `jetzt` fort: entfernt Ausgeblendetes, rückt Wartende nach, verdrängt bei Stau.
   * Liefert, ob sich etwas Sichtbares geändert hat (neue, entfernte Meldung oder andere Anzeigestufe).
   */
  aktualisiere(jetzt: number): boolean {
    let geaendert = this.neu;
    this.neu = false;
    const ausblenden = this.zeiten.ausblendStufen * this.zeiten.ausblendStufe;
    for (let i = this.aktiv.length - 1; i >= 0; i--) {
      const m = this.aktiv[i];
      if (m !== undefined && jetzt >= m.bis + ausblenden) {
        this.aktiv.splice(i, 1);
        if (m.art === 'warnung') this.gesperrt.set(m.schluessel, jetzt);
        geaendert = true;
      }
    }
    while (this.aktiv.length < this.max && this.warten.length > 0) {
      const m = this.warten.shift();
      if (m === undefined) break;
      m.seit = jetzt;
      m.bis = jetzt + this.zeiten.dauer[m.art];
      this.aktiv.push(m);
      geaendert = true;
    }
    this.macheRaum(jetzt);
    for (const m of this.aktiv) {
      const stufe = this.stufeVon(m, jetzt);
      if (stufe !== m.stufe) {
        m.stufe = stufe;
        geaendert = true;
      }
    }
    for (const [k, t] of this.gesperrt) if (jetzt - t >= this.zeiten.warnungSperre) this.gesperrt.delete(k);
    return geaendert;
  }

  /** Aussehen einer sichtbaren Meldung zur Zeit `jetzt`. */
  ansicht(m: Meldung<D>, jetzt: number): MeldungAnsicht {
    const stufe = this.stufeVon(m, jetzt);
    const stufen = this.zeiten.ausblendStufen;
    if (stufe <= 0) return { phase: stufe === -2 ? 'ein' : stufe === -1 ? 'hervorgehoben' : 'sichtbar', deckkraft: 1 };
    return { phase: 'aus', deckkraft: 1 - stufe / (stufen + 1) };
  }

  /** Alles verwerfen (Weltwechsel). */
  leere(): void {
    this.aktiv.length = 0;
    this.warten.length = 0;
    this.gesperrt.clear();
  }

  /** −2 hereinrücken, −1 hervorgehoben, 0 stehend, 1…n Ausblendstufe. */
  private stufeVon(m: Meldung<D>, jetzt: number): number {
    if (jetzt >= m.bis) return Math.min(this.zeiten.ausblendStufen, Math.floor((jetzt - m.bis) / this.zeiten.ausblendStufe) + 1);
    if (jetzt - m.seit < this.zeiten.einblenden) return -2;
    if (jetzt - m.gestapelt < this.zeiten.hervorheben) return -1;
    return 0;
  }

  private reiheEin(m: Meldung<D>): void {
    const v = MELDUNG_VORRANG[m.art];
    const i = this.warten.findIndex((w) => MELDUNG_VORRANG[w.art] < v);
    if (i < 0) this.warten.push(m);
    else this.warten.splice(i, 0, m);
    while (this.warten.length > MAX_WARTEND) {
      // Zuerst die älteste wartende Aufsammel-Meldung, sonst die letzte (unwichtigste) der Schlange.
      const alt = this.warten.findIndex((w) => w.art === 'aufsammeln');
      this.warten.splice(alt >= 0 ? alt : this.warten.length - 1, 1);
    }
  }

  /**
   * Bei Stau: Die unwichtigste sichtbare Meldung mit der ältesten letzten Aktivität (Erscheinen oder
   * Stapeln) blendet aus, sobald sie seit dieser Aktivität `mindestSichtbar` stand – gerade Gestapeltes
   * bleibt also stehen.
   */
  private macheRaum(jetzt: number): void {
    const kopf = this.warten[0];
    if (kopf === undefined || this.aktiv.length < this.max) return;
    if (this.aktiv.some((m) => jetzt >= m.bis)) return;
    const vorrang = MELDUNG_VORRANG[kopf.art];
    let opfer: Meldung<D> | null = null;
    for (const m of this.aktiv) {
      const v = MELDUNG_VORRANG[m.art];
      if (v > vorrang) continue;
      if (opfer === null || v < MELDUNG_VORRANG[opfer.art] || (v === MELDUNG_VORRANG[opfer.art] && aktivitaet(m) < aktivitaet(opfer))) opfer = m;
    }
    if (opfer !== null) opfer.bis = Math.min(opfer.bis, Math.max(jetzt, aktivitaet(opfer) + this.zeiten.mindestSichtbar));
  }
}
