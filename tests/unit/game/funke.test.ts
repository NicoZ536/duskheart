/**
 * Funke und die Hinweiszeile (MASTERPROMPT §8 „höchstens 2 Zeilen pro Einwurf, nie aufdringlich, abschaltbar“; docs/SPIEL.md §23
 * „Funke“; M7-44): Frequenzbegrenzung (Mindestabstand, Priorität 3 vorher), einmalige Kommentare, Abklingen wiederkehrender,
 * Warteschlange höchstens 4, abschaltbar per `guide.configure`, Dialoge Zeile für Zeile; der Inhalt: ≥ 40 Kommentare, jeder in
 * zwei Zeilen der Funke-Box (Validator-Regel `funke`), jedes umgesetzte Weltereignis angekündigt.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { GuideHintDef } from '../../../src/content/guide/schema';
import { CONTENT } from '../../../src/content/index';
import { GuideSystem } from '../../../src/game/guide/system';
import { createGuideSample } from '../../../src/game/guide/types';
import { checkFunke, FUNKE_MIN_COMMENTS, pixelFontMeasure, wrappedLines } from '../../../tools/validator/funke';
import { ContentRegistry } from '../../../src/content/registry';
import { guideHintSchema } from '../../../src/content/guide/schema';
import { dialogSchema } from '../../../src/content/quests/schema';
import { chronikWelt, steps } from './chronik-testwelt';

const T = { de: 'x', en: 'x' };
const HZ = BALANCE.time.tickHz;
const G = BALANCE.guide;

function hint(id: string, kanal: 'funke' | 'hinweis', ereignis: string, prioritaet: 1 | 2 | 3, einmalig = true, abklingSekunden?: number): GuideHintDef {
  return { id, kanal, text: T, ausloeser: { art: 'ereignis', ereignis }, prioritaet, einmalig, ...(abklingSekunden === undefined ? {} : { abklingSekunden }) };
}

/** The guide's spoken lines of `out`: `kanal:hint[:zeile]`. */
function spoken(out: Array<[string, Record<string, unknown>]>): string[] {
  return out.filter(([t]) => t === 'guideHint').map(([, p]) => `${String(p.kanal)}:${String(p.hint)}${(p.zeile as number) >= 0 ? `:${String(p.zeile)}` : ''}`);
}

describe('Funke (src/game/guide)', () => {
  it('nie aufdringlich: Mindestabstand, Priorität 3 zuerst und früher, einmal je Welt', () => {
    const { sim, feeder, world } = chronikWelt();
    const guide = sim.addSystem(
      new GuideSystem({ world, hints: [hint('funke_a', 'funke', 'treeFelled', 1), hint('funke_b', 'funke', 'tileDug', 2), hint('funke_gefahr', 'funke', 'playerDied', 3)], dialogLines: new Map() }),
    );
    feeder.push(['treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 }]);
    expect(spoken(steps(sim, 1))).toEqual(['funke:funke_a']);
    // A second comment waits for the minimum distance …
    feeder.push(['tileDug', { layer: 0, tx: 0, ty: 0, from: 'erde', to: 'erde', result: 'grube' }]);
    expect(spoken(steps(sim, G.funkeUrgentSeconds * HZ))).toEqual([]);
    expect(guide.waiting('funke')).toBe(1);
    // … a danger may come after the short urgent distance and goes first.
    feeder.push(['playerDied', { entity: 1, x: 0, y: 0, layer: 0, cause: 'kaelte', grave: null, graveItems: 0, penalty: { xp: 0, maxHealth: 0 } } as never]);
    expect(spoken(steps(sim, 1))).toEqual(['funke:funke_gefahr']);
    const out = steps(sim, G.funkeMinSeconds * HZ);
    expect(spoken(out)).toEqual(['funke:funke_b']);
    // One-time: the same moments again say nothing.
    feeder.push(['treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 }]);
    expect(spoken(steps(sim, (G.funkeMinSeconds + 1) * HZ))).toEqual([]);
    expect(guide.wasSaid('funke_a')).toBe(true);
    // What shows, for how long (the HUD's sample).
    const sample = guide.sample(sim.tick, createGuideSample());
    expect(sample.funke).toBeNull();
  });

  it('die Hinweiszeile hat ihren eigenen Abstand; wiederkehrende Hinweise klingen ab; die Warteschlange hält höchstens 4', () => {
    const { sim, feeder, world } = chronikWelt();
    const hints = [hint('hinweis_r', 'hinweis', 'treeFelled', 1, false, 30), ...[1, 2, 3, 4, 5, 6].map((n) => hint(`hinweis_q${n}`, 'hinweis', 'tileDug', n === 6 ? 2 : 1))];
    const guide = sim.addSystem(new GuideSystem({ world, hints, dialogLines: new Map() }));
    feeder.push(['treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 }]);
    expect(spoken(steps(sim, 1))).toEqual(['hinweis:hinweis_r']);
    const s = guide.sample(sim.tick, createGuideSample());
    expect(s.hint).toBe('hinweis_r');
    expect(s.hintUntilTick - sim.tick).toBe(G.hintShowSeconds * HZ - 1);
    feeder.push(['tileDug', { layer: 0, tx: 0, ty: 0, from: 'erde', to: 'erde', result: 'grube' }]);
    steps(sim, 1);
    expect(guide.waiting('hinweis')).toBe(G.queueMax);
    // The repeating hint speaks again only after its cooling.
    feeder.push(['treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 }]);
    const early = spoken(steps(sim, 25 * HZ));
    expect(early).not.toContain('hinweis:hinweis_r');
    expect(early[0]).toBe('hinweis:hinweis_q6');
    steps(sim, 10 * HZ);
    feeder.push(['treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 }]);
    const later = spoken(steps(sim, 200 * HZ));
    expect(later).toContain('hinweis:hinweis_r');
  });

  it('abschaltbar: guide.configure verstummt den Kanal sofort; aus Gesagtes bleibt ungesagt, bis er wieder an ist', () => {
    const { sim, feeder, world } = chronikWelt();
    const guide = sim.addSystem(new GuideSystem({ world, hints: [hint('funke_a', 'funke', 'treeFelled', 2), hint('hinweis_a', 'hinweis', 'treeFelled', 1)], dialogLines: new Map() }));
    sim.step([{ type: 'guide.configure', funke: false, hints: true }]);
    feeder.push(['treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 }]);
    expect(spoken(steps(sim, 1))).toEqual(['hinweis:hinweis_a']);
    expect(guide.wasSaid('funke_a')).toBe(false);
    sim.step([{ type: 'guide.configure', funke: true, hints: false }]);
    expect(guide.sample(sim.tick, createGuideSample()).hint).toBeNull();
    expect(guide.configuration({ funke: false, hints: true, onboarding: false })).toEqual({ funke: true, hints: false, onboarding: true });
    feeder.push(['treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 }]);
    expect(spoken(steps(sim, 1))).toEqual(['funke:funke_a']);
  });

  it('Dialoge: ein neuer Aufgabenschritt mit Dialog – Funke spricht ihn Zeile für Zeile', () => {
    const { sim, feeder, world } = chronikWelt();
    sim.addSystem(new GuideSystem({ world, hints: [], dialogLines: new Map([['funke_d', 3]]), stepDialog: (q) => (q === 'hq' ? 'funke_d' : null) }));
    feeder.push(['questStepCompleted', { quest: 'hq', schritt: 's1' }]);
    const out = spoken(steps(sim, 3 * G.dialogLineSeconds * HZ + 2));
    expect(out).toEqual(['funke:funke_d:0', 'funke:funke_d:1', 'funke:funke_d:2']);
  });

  it('Inhalt: ≥ 40 Kommentare, jeder in zwei Zeilen der Funke-Box; jedes umgesetzte Weltereignis kündigt Funke an', () => {
    const measure = pixelFontMeasure();
    const res = checkFunke(CONTENT, measure);
    expect(res.errors).toEqual([]);
    expect(res.comments).toBeGreaterThanOrEqual(FUNKE_MIN_COMMENTS);
    // Strand G's own comments alone reach the 40 of §23.
    const own = CONTENT.collection('guideHints').values().filter((h) => h.kanal === 'funke' && /^funke_/.test(h.id));
    expect(own.length).toBeGreaterThanOrEqual(FUNKE_MIN_COMMENTS);
    const hints = new Map(CONTENT.collection('guideHints').values().map((h) => [h.id, h]));
    for (const e of CONTENT.collection('worldEvents').values()) {
      if (e.umgesetzt !== true) continue;
      const h = hints.get(e.ankuendigung?.funke ?? '');
      expect(h?.kanal, e.id).toBe('funke');
      expect(h?.ausloeser, e.id).toEqual({ art: 'ereignis', ereignis: 'worldEventAnnounced', wo: { event: e.id } });
      expect(h?.prioritaet, e.id).toBe(3);
    }
  });

  it('Validator-Regel funke: zu lang, zu breites Wort, zu wenige Kommentare – je ein Fehler', () => {
    const w = (text: string): number => text.length * 5;
    expect(wrappedLines('aaa bbb ccc', 35, w)).toBe(2);
    expect(wrappedLines('aaaaaaaaaaaaaaaaaaaa', 35, w)).toBe(Number.POSITIVE_INFINITY);
    const long = 'wort '.repeat(80).trim();
    const reg = new ContentRegistry()
      .defineCollection('guideHints', guideHintSchema, [{ id: 'funke_lang', kanal: 'funke', text: { de: long, en: 'kurz' }, ausloeser: { art: 'ereignis', ereignis: 'treeFelled' }, prioritaet: 1, einmalig: true }])
      .defineCollection('dialogs', dialogSchema, [{ id: 'funke_d', sprecher: 'funke', zeilen: [{ de: 'kurz', en: long }] }]);
    const res = checkFunke(reg, w);
    expect(res.errors.join('\n')).toMatch(/Funke-Kommentar funke_lang: DE braucht/);
    expect(res.errors.join('\n')).toMatch(/Dialog funke_d Zeile 1: EN braucht/);
    expect(res.errors.join('\n')).toMatch(/Funke hat 1 Kommentare, mindestens 40/);
    expect(res.errors).toHaveLength(3);
  });
});
