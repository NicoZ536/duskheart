/**
 * M3-29 Warteschlange der Benachrichtigungen (src/ui/hud/meldungen/warteschlange.ts): nie mehr als vier
 * sichtbar (ausblendende zählen mit), Aufsammeln stapelt („Feuerstein ×3“, auch wartend und beim
 * Ausblenden), Warnungen und Entdeckungen nie doppelt, Sperre nach einer Warnung, Vorrang beim Warten,
 * Verdrängen nach der Mindestzeit, Ausblenden in drei harten Stufen, begrenzte Warteschlange.
 */
import { describe, expect, it } from 'vitest';
import { MAX_SICHTBAR, MAX_WARTEND, MELDUNG_ZEITEN as Z, MeldungenWarteschlange, type MeldungArt, type MeldungEingabe } from '../../../src/ui/hud/meldungen/warteschlange';

const AUS = Z.ausblendStufen * Z.ausblendStufe;

function m(art: MeldungArt, schluessel: string, anzahl?: number): MeldungEingabe<string> {
  return { art, schluessel, daten: schluessel, ...(anzahl === undefined ? {} : { anzahl }) };
}

function schluessel(q: MeldungenWarteschlange<string>): string[] {
  return q.sichtbar.map((x) => `${x.schluessel}${x.art === 'aufsammeln' ? `×${x.anzahl}` : ''}`);
}

/** Schreitet in kleinen Schritten bis `bis` fort und prüft dabei die Obergrenze. */
function laufe(q: MeldungenWarteschlange<string>, von: number, bis: number): void {
  for (let t = von; t <= bis + 1e-9; t += 0.05) {
    q.aktualisiere(t);
    expect(q.sichtbar.length).toBeLessThanOrEqual(MAX_SICHTBAR);
  }
}

describe('Meldungen: Stapeln', () => {
  it('dasselbe Item stapelt zu einer Meldung und beginnt die Anzeigedauer neu', () => {
    const q = new MeldungenWarteschlange<string>();
    q.melde(m('aufsammeln', 'feuerstein'), 0);
    q.melde(m('aufsammeln', 'holz', 4), 0.5);
    q.melde(m('aufsammeln', 'feuerstein', 2), 1);
    expect(schluessel(q)).toEqual(['feuerstein×3', 'holz×4']);
    const f = q.sichtbar[0];
    expect(f?.bis).toBe(1 + Z.dauer.aufsammeln);
    q.aktualisiere(1.1);
    expect(q.ansicht(f as NonNullable<typeof f>, 1.1).phase).toBe('hervorgehoben');
    q.aktualisiere(1 + Z.hervorheben + 0.01);
    expect(q.ansicht(f as NonNullable<typeof f>, 1 + Z.hervorheben + 0.01).phase).toBe('sichtbar');
  });

  it('eine ausblendende Aufsammel-Meldung lebt beim Stapeln wieder auf', () => {
    const q = new MeldungenWarteschlange<string>();
    q.melde(m('aufsammeln', 'stein'), 0);
    const t = Z.dauer.aufsammeln + Z.ausblendStufe * 1.5;
    q.aktualisiere(t);
    const s = q.sichtbar[0] as NonNullable<(typeof q.sichtbar)[0]>;
    expect(q.ansicht(s, t).phase).toBe('aus');
    q.melde(m('aufsammeln', 'stein'), t);
    q.aktualisiere(t + 0.3);
    expect(q.ansicht(s, t + 0.3)).toEqual({ phase: 'sichtbar', deckkraft: 1 });
    expect(s.anzahl).toBe(2);
  });

  it('wartende Aufsammel-Meldungen stapeln ebenfalls', () => {
    const q = new MeldungenWarteschlange<string>();
    for (const k of ['a', 'b', 'c', 'd']) q.melde(m('aufsammeln', k), 0);
    q.melde(m('aufsammeln', 'e', 2), 0.1);
    q.melde(m('aufsammeln', 'e', 3), 0.2);
    expect(q.wartend).toBe(1);
    laufe(q, 0.2, 20);
    expect(q.sichtbar).toHaveLength(0);
  });
});

describe('Meldungen: Obergrenze, Vorrang, Verdrängen', () => {
  it('nie mehr als vier; Warnungen warten vor Entdeckungen vor Aufsammeln', () => {
    const q = new MeldungenWarteschlange<string>();
    for (const k of ['a', 'b', 'c', 'd']) q.melde(m('aufsammeln', k), 0);
    q.melde(m('aufsammeln', 'e'), 0);
    q.melde(m('entdeckung', 'ort'), 0);
    q.melde(m('warnung', 'kalt'), 0);
    expect(q.sichtbar).toHaveLength(4);
    expect(q.wartend).toBe(3);
    // Die älteste Aufsammel-Meldung macht nach der Mindestzeit Platz, die Warnung rückt zuerst nach.
    laufe(q, 0, Z.mindestSichtbar + AUS + 0.05);
    expect(schluessel(q)).toContain('kalt');
    expect(schluessel(q)).not.toContain('ort');
    laufe(q, Z.mindestSichtbar + AUS + 0.05, 2 * (Z.mindestSichtbar + AUS) + 0.1);
    expect(schluessel(q)).toContain('ort');
    laufe(q, 2.8, 30);
    expect(q.sichtbar).toHaveLength(0);
    expect(q.wartend).toBe(0);
  });

  it('gerade Gestapeltes bleibt stehen: verdrängt wird die Meldung mit der ältesten letzten Aktivität', () => {
    const q = new MeldungenWarteschlange<string>();
    for (const k of ['a', 'b', 'c', 'd']) q.melde(m('aufsammeln', k), 0);
    q.melde(m('aufsammeln', 'a'), 1);
    q.melde(m('warnung', 'kalt'), 1);
    laufe(q, 1, 1 + Z.mindestSichtbar + AUS + 0.05);
    expect(schluessel(q)).toEqual(['a×2', 'c×1', 'd×1', 'kalt']);
  });

  it('Warnungen verdrängen keine Warnungen vor ihrer Zeit; Aufsammeln verdrängt keine Warnung', () => {
    const q = new MeldungenWarteschlange<string>();
    for (const k of ['w1', 'w2', 'w3', 'w4']) q.melde(m('warnung', k), 0);
    q.melde(m('aufsammeln', 'holz'), 0);
    laufe(q, 0, Z.dauer.warnung - 0.1);
    expect(schluessel(q)).toEqual(['w1', 'w2', 'w3', 'w4']);
    laufe(q, Z.dauer.warnung - 0.1, Z.dauer.warnung + AUS + 0.1);
    expect(schluessel(q)).toEqual(['holz×1']);
  });

  it('die Warteschlange ist begrenzt; zuerst fallen alte Aufsammel-Meldungen weg', () => {
    const q = new MeldungenWarteschlange<string>();
    for (let i = 0; i < 4; i++) q.melde(m('warnung', `w${i}`), 0);
    q.melde(m('entdeckung', 'ort'), 0);
    for (let i = 0; i < MAX_WARTEND + 5; i++) q.melde(m('aufsammeln', `i${i}`), 0);
    expect(q.wartend).toBe(MAX_WARTEND);
    laufe(q, 0, Z.dauer.warnung + AUS + 0.1);
    expect(schluessel(q)[0]).toBe('ort');
  });
});

describe('Meldungen: Entdoppeln und Sperre', () => {
  it('Warnung: gleiche verlängert, nach dem Verschwinden 30 s Ruhe, danach wieder', () => {
    const q = new MeldungenWarteschlange<string>();
    q.melde(m('warnung', 'hunger'), 0);
    q.melde(m('warnung', 'hunger'), 2);
    expect(q.sichtbar).toHaveLength(1);
    expect(q.sichtbar[0]?.bis).toBe(2 + Z.dauer.warnung);
    const ende = 2 + Z.dauer.warnung + AUS;
    laufe(q, 2, ende + 0.05);
    expect(q.sichtbar).toHaveLength(0);
    q.melde(m('warnung', 'hunger'), ende + 1);
    q.aktualisiere(ende + 1);
    expect(q.sichtbar).toHaveLength(0);
    q.melde(m('warnung', 'hunger'), ende + Z.warnungSperre + 1);
    q.aktualisiere(ende + Z.warnungSperre + 1);
    expect(schluessel(q)).toEqual(['hunger']);
  });

  it('`melde` sagt, was geschah: neu, wartet, gestapelt, verworfen', () => {
    const q = new MeldungenWarteschlange<string>();
    expect(q.melde(m('warnung', 'a'), 0)).toBe('neu');
    expect(q.melde(m('warnung', 'a'), 0)).toBe('verworfen');
    expect(q.melde(m('aufsammeln', 'holz'), 0)).toBe('neu');
    expect(q.melde(m('aufsammeln', 'holz'), 0)).toBe('gestapelt');
    q.melde(m('warnung', 'b'), 0);
    q.melde(m('warnung', 'c'), 0);
    expect(q.melde(m('entdeckung', 'ort'), 0)).toBe('wartet');
  });

  it('Entdeckungen erscheinen nie doppelt, auch nicht wartend', () => {
    const q = new MeldungenWarteschlange<string>();
    for (const k of ['a', 'b', 'c', 'd']) q.melde(m('warnung', k), 0);
    q.melde(m('entdeckung', 'ort'), 0);
    q.melde(m('entdeckung', 'ort'), 0.5);
    expect(q.wartend).toBe(1);
    const r = new MeldungenWarteschlange<string>();
    r.melde(m('entdeckung', 'ort'), 0);
    r.melde(m('entdeckung', 'ort'), 1);
    expect(r.sichtbar).toHaveLength(1);
  });
});

describe('Meldungen: Ein- und Ausblenden', () => {
  it('hereinrücken, stehen, drei harte Ausblendstufen, dann weg', () => {
    const q = new MeldungenWarteschlange<string>();
    q.melde(m('entdeckung', 'ort'), 10);
    const e = q.sichtbar[0] as NonNullable<(typeof q.sichtbar)[0]>;
    expect(q.ansicht(e, 10)).toEqual({ phase: 'ein', deckkraft: 1 });
    expect(q.ansicht(e, 10 + Z.einblenden + 0.001)).toEqual({ phase: 'sichtbar', deckkraft: 1 });
    const bis = 10 + Z.dauer.entdeckung;
    expect([0, 1, 2].map((k) => q.ansicht(e, bis + k * Z.ausblendStufe + 0.01).deckkraft)).toEqual([0.75, 0.5, 0.25]);
    expect(q.aktualisiere(bis + AUS - 0.01)).toBe(true);
    expect(q.sichtbar).toHaveLength(1);
    q.aktualisiere(bis + AUS);
    expect(q.sichtbar).toHaveLength(0);
  });

  it('`aktualisiere` meldet Änderungen nur, wenn sich etwas Sichtbares ändert', () => {
    const q = new MeldungenWarteschlange<string>();
    expect(q.aktualisiere(0)).toBe(false);
    q.melde(m('aufsammeln', 'holz'), 0);
    expect(q.aktualisiere(0)).toBe(true);
    expect(q.aktualisiere(0.05)).toBe(false);
    expect(q.aktualisiere(Z.einblenden + 0.01)).toBe(true);
    expect(q.aktualisiere(1)).toBe(false);
    q.melde(m('aufsammeln', 'holz'), 1);
    expect(q.aktualisiere(1.01)).toBe(true);
    q.leere();
    expect(q.sichtbar).toHaveLength(0);
  });
});
