/**
 * What the build mode says while a tool is in use (src/ui/screens/bau/werkzeugStatus.ts; MASTERPROMPT §16.6
 * "100 % zurück in den ersten 30 s, danach 60 %", §26 "Fehlermeldungen sagen, was fehlt und wie man es löst"; Review
 * M4 #1): the status line and the short text over the cursor for dismantling, upgrading and repairing – the refund with
 * the seconds left or the late share with its items, the new piece and its cost, the repair's cost, and every refusal
 * in the target's own words – in German and English, the percentages from the balance.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { createI18n } from '../../../src/i18n';
import { BuildGhost, type ToolTarget } from '../../../src/render/game/ghost';
import { werkzeugBefund, werkzeugText, type WerkzeugBefund, type ZielInfo } from '../../../src/ui/screens/bau/werkzeugStatus';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });

function ziel(o: Partial<ZielInfo>): ZielInfo {
  return { art: 'bauteil', piece: 'wand_holz', blueprint: false, refund: 'ganz', secondsLeft: 18, items: [], reason: null, to: null, ...o };
}
function abbauen(ziele: ZielInfo[]): WerkzeugBefund {
  return { tool: 'abbauen', ziele, neu: null, reparatur: null };
}

describe('Abbauen: was zurückkommt', () => {
  it('„100 % zurück (noch 18 s)“ in den ersten 30 s, danach „60 % zurück“ mit den Items; eine Blaupause nichts; eine Fackel ganz', () => {
    const ganz = werkzeugText(de, abbauen([ziel({})]));
    expect(ganz).toEqual({ status: 'Holzwand abbauen – 100 % zurück (noch 18 s).', warnung: false, label: '100 % zurück (noch 18 s)' });
    expect(werkzeugText(en, abbauen([ziel({})])).label).toBe('100 % back (18 s left)');
    const spaet = werkzeugText(de, abbauen([ziel({ refund: 'anteilig', secondsLeft: 0, items: [{ item: 'brett', count: 1 }] })]));
    expect(spaet).toEqual({ status: 'Holzwand abbauen – 60 % zurück: 1× Brett.', warnung: false, label: '60 % zurück' });
    expect(BALANCE.building.refund.lateShare).toBe(0.6);
    // A share that rounds down to nothing says so.
    expect(werkzeugText(de, abbauen([ziel({ piece: 'saeule_holz', refund: 'anteilig', secondsLeft: 0 })])).status).toContain('zu wenig für ein ganzes Stück');
    expect(werkzeugText(de, abbauen([ziel({ blueprint: true, refund: 'keine' })]))).toMatchObject({ status: 'Blaupause Holzwand entfernen – sie kostete nichts.', label: 'Nichts zurück' });
    expect(werkzeugText(de, abbauen([ziel({ art: 'licht', piece: 'fackel' })]))).toMatchObject({ status: 'Fackel nehmen – kommt ganz zurück in die Taschen.', label: 'Ganz zurück' });
    expect(werkzeugText(de, abbauen([]))).toMatchObject({ status: 'Abbauen: zeig auf ein Bauteil, eine Station oder eine Fackel.', label: null });
  });

  it('abgelehnt: der Grund des Ziels in seinen Worten, kurz über dem Zeiger – Bauteil, Station, Licht', () => {
    expect(werkzeugText(de, abbauen([ziel({ reason: 'tooFar' })]))).toEqual({ status: de.t('ui.build.reject.tooFar'), warnung: true, label: 'Zu weit' });
    expect(werkzeugText(de, abbauen([ziel({ art: 'station', piece: 'werkbank', reason: 'outOfReach' })])).status).toBe(de.t('ui.station.reject.outOfReach'));
    expect(werkzeugText(en, abbauen([ziel({ art: 'licht', piece: 'lagerfeuer', reason: 'notTakeable' })]))).toEqual({ status: 'A fire cannot be picked up.', warnung: true, label: 'Stays' });
  });

  it('eine Fläche: wie viele, wie viele ganz und zu 60 %, Blaupausen, was alles zusammen zurückkommt; was bleibt, mit Grund', () => {
    const brett = (count: number) => [{ item: 'brett', count }];
    const t = werkzeugText(de, abbauen([ziel({}), ziel({ refund: 'anteilig', items: brett(1) }), ziel({ refund: 'anteilig', items: brett(2) }), ziel({ blueprint: true, refund: 'keine' })]));
    expect(t).toEqual({ status: '4 Teile abbauen: 1 ganz, 2 zu 60 %, 1 Blaupause. Zurück: 1× Holzwand, 3× Brett.', warnung: false, label: '4 abbauen' });
    // Only blueprints and shares too small for a whole piece: nothing to sum up.
    expect(werkzeugText(de, abbauen([ziel({ blueprint: true, refund: 'keine' }), ziel({ piece: 'saeule_holz', refund: 'anteilig' })])).status).toBe('2 Teile abbauen: 1 zu 60 %, 1 Blaupause.');
    const teils = werkzeugText(en, abbauen([ziel({}), ziel({ reason: 'tooFar' })]));
    expect(teils.status).toBe(`Dismantle 1 piece: 1 whole. Back: 1× Wooden Wall. The rest stays: ${en.t('ui.build.reject.tooFar')}`);
  });
});

describe('Aufwerten und Reparieren', () => {
  it('Aufwerten: „Holzwand » Steinwand – kostet 1× Steinwand; Holzwand: …“, mehrere zusammen, ohne Ziel und ohne gewähltes Teil ein Hinweis', () => {
    const eins = werkzeugText(de, { tool: 'aufwerten', ziele: [ziel({ to: 'wand_stein', refund: 'anteilig', secondsLeft: 0, items: [{ item: 'brett', count: 1 }] })], neu: 'wand_stein', reparatur: null });
    expect(eins).toEqual({ status: 'Holzwand » Steinwand – kostet 1× Steinwand; Holzwand: 60 % zurück: 1× Brett.', warnung: false, label: '» Steinwand' });
    const drei = werkzeugText(en, { tool: 'aufwerten', ziele: [ziel({ to: 'wand_stein' }), ziel({ to: 'wand_stein' }), ziel({ to: 'wand_stein', reason: 'noMaterial' })], neu: 'wand_stein', reparatur: null });
    expect(drei.status).toBe(`2 of 3 » Stone Wall · ${en.t('ui.build.reject.noMaterial')}`);
    // Several: what the replaced parts give back together.
    expect(werkzeugText(de, { tool: 'aufwerten', ziele: [ziel({ to: 'wand_stein' }), ziel({ to: 'wand_stein', refund: 'anteilig', secondsLeft: 0, items: [{ item: 'brett', count: 1 }] })], neu: 'wand_stein', reparatur: null }).status).toBe(
      '2 Teile » Steinwand – kostet 2× Steinwand. Zurück: 1× Holzwand, 1× Brett.',
    );
    expect(werkzeugText(de, { tool: 'aufwerten', ziele: [ziel({ to: 'wand_palisade', reason: 'notUpgradable' })], neu: 'wand_palisade', reparatur: null })).toMatchObject({ warnung: true, label: 'Nicht aufwertbar' });
    expect(werkzeugText(de, { tool: 'aufwerten', ziele: [], neu: 'wand_stein', reparatur: null }).status).toBe('Aufwerten zu Steinwand: zeig auf ein Bauteil derselben Art.');
    expect(werkzeugText(de, { tool: 'aufwerten', ziele: [], neu: null, reparatur: null })).toMatchObject({ status: 'Aufwerten: wähle in der Bautafel das neue Bauteil.', warnung: true });
  });

  it('Reparieren: was es kostet, „Nichts zu reparieren“, ohne Hammer, ohne Material, zu große Fläche', () => {
    const rep = (o: Partial<NonNullable<WerkzeugBefund['reparatur']>>): WerkzeugBefund => ({ tool: 'reparieren', ziele: [], neu: null, reparatur: { damaged: 2, mendable: 2, cost: [{ item: 'brett', count: 2 }], reason: null, ...o } });
    expect(werkzeugText(de, rep({}))).toEqual({ status: '2 beschädigte Teile reparieren – kostet 2× Brett.', warnung: false, label: '2× Brett' });
    expect(werkzeugText(en, rep({ damaged: 3 })).status).toBe('2 of 3 damaged pieces can be repaired – costs 2× Plank; materials for the rest are missing.');
    expect(werkzeugText(de, rep({ damaged: 0, mendable: 0, cost: [], reason: 'nothingToRepair' }))).toEqual({ status: 'Nichts zu reparieren – hier ist alles heil.', warnung: false, label: 'Nichts zu reparieren' });
    expect(werkzeugText(de, rep({ reason: 'noHammer' }))).toMatchObject({ status: 'Nimm einen Hammer in die Hand, um zu reparieren.', warnung: true });
    expect(werkzeugText(de, rep({ mendable: 0, cost: [], reason: 'noMaterial' })).warnung).toBe(true);
    expect(werkzeugText(de, rep({ reason: 'areaTooLarge' })).status).toBe(de.t('ui.build.reject.areaTooLarge'));
  });
});

describe('Befund aus dem Geist', () => {
  it('kopiert die Ziele (der Geist legt seine Ziele wieder in den Pool) und die Reparatur', () => {
    const g = new BuildGhost();
    g.judgedTool = 'abbauen';
    const t: ToolTarget = { art: 'bauteil', piece: 'wand_holz', ebene: 'struktur', tx: 1, ty: 2, w: 1, h: 1, rot: 0, mirror: false, id: 0, blueprint: false, refund: 'anteilig', secondsLeft: 0, items: [{ item: 'brett', count: 1 }], reason: null, to: null };
    g.targets.push(t);
    g.targetCount = 1;
    const b = werkzeugBefund(g, null);
    t.items.length = 0;
    expect(b?.ziele[0]?.items).toEqual([{ item: 'brett', count: 1 }]);
    g.judgedTool = 'setzen';
    expect(werkzeugBefund(g, null)).toBeNull();
  });
});
