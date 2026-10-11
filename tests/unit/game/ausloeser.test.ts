/**
 * Die Auslöser-Sprache zur Laufzeit (docs/SPIEL.md §17, ADR-0207; M7-42 … M7-47): Ereignis-Blätter zählen ab dem Scharfschalten
 * und halten, sobald `anzahl` erreicht ist; Zustands-Blätter lesen die Welt; `alle`/`eines`/`nicht`; der Filter `@spieler`; das
 * Brett zählt nur bei seinen Ereignistypen und prüft zustandsartige Auslöser im Welt-Tick. Dazu die Validator-Regel
 * `ausloeser` mit Fixtures.
 */
import { describe, expect, it } from 'vitest';
import { ContentRegistry } from '../../../src/content/registry';
import { statSchema, statSourceSchema } from '../../../src/content/stats/schema';
import { guideHintSchema } from '../../../src/content/guide/schema';
import { questSchema } from '../../../src/content/quests/schema';
import type { Trigger } from '../../../src/content/schema/trigger';
import { Armed, countEvent, holds, TriggerBoard, triggerEvaluator } from '../../../src/game/triggers/evaluator';
import { PLAYER_TOKEN } from '../../../src/game/triggers/compile';
import type { TriggerWorld } from '../../../src/game/triggers/types';
import { checkTriggers } from '../../../tools/validator/ausloeser';
import { z } from 'zod';

/** A world whose state the test sets. */
function world(): TriggerWorld & { s: Record<string, number>; items: Record<string, number>; cond: Set<string>; d: number; h: number; light: number; inside: boolean; room: string | null; unl: Set<string>; quest: Record<string, 'offen' | 'aktiv' | 'erledigt'>; places: Record<string, number> } {
  return {
    s: {},
    items: {},
    cond: new Set(),
    d: 1,
    h: 8,
    light: 1,
    inside: false,
    room: null,
    unl: new Set(),
    quest: {},
    places: {},
    statValue(stat, key) {
      return this.s[key === undefined ? stat : `${stat}.${key}`] ?? 0;
    },
    carried(item) {
      return this.items[item] ?? 0;
    },
    conditionActive(id) {
      return this.cond.has(id);
    },
    day() {
      return this.d;
    },
    hour() {
      return this.h;
    },
    playerLightLevel() {
      return this.light;
    },
    playerIndoors() {
      return this.inside;
    },
    playerRoomType() {
      return this.room;
    },
    unlocked(id) {
      return this.unl.has(id);
    },
    questStatus(quest, step) {
      return this.quest[step === undefined ? quest : `${quest}/${step}`] ?? 'offen';
    },
    placesDiscovered(type) {
      return this.places[type] ?? 0;
    },
  };
}

describe('Auslöser auswerten', () => {
  it('Ereignis-Blätter zählen gefilterte Ereignisse ab dem Scharfschalten und halten ab `anzahl`', () => {
    const a = new Armed({ art: 'ereignis', ereignis: 'craftCompleted', wo: { item: 'steinaxt' }, anzahl: 2 }, 'x');
    const w = world();
    expect(holds(a, w)).toBe(false);
    expect(countEvent(a, 'craftCompleted', { item: 'faserseil' }, 0)).toBe(false);
    expect(countEvent(a, 'craftCompleted', { item: 'steinaxt' }, 0)).toBe(true);
    expect(holds(a, w)).toBe(false);
    countEvent(a, 'craftCompleted', { item: 'steinaxt' }, 0);
    expect(holds(a, w)).toBe(true);
    // The counter stops at its need; another type never counts.
    expect(countEvent(a, 'craftCompleted', { item: 'steinaxt' }, 0)).toBe(false);
    expect(a.counts).toEqual([2]);
    expect(countEvent(a, 'itemsAdded', { item: 'steinaxt' }, 0)).toBe(false);
    // Saved counters come back clamped to their need.
    expect(new Armed(a.trigger, 'x', [7]).counts).toEqual([2]);
    expect(new Armed(a.trigger, 'x', [-3]).counts).toEqual([0]);
  });

  it('`@spieler` filtert auf die Entität des Spielers', () => {
    const a = new Armed({ art: 'ereignis', ereignis: 'creatureDied', wo: { by: PLAYER_TOKEN } }, 'kills');
    expect(countEvent(a, 'creatureDied', { by: 9, creature: 'wolf' }, 4)).toBe(false);
    expect(countEvent(a, 'creatureDied', { by: 4, creature: 'wolf' }, 4)).toBe(true);
    expect(a.count).toBe(1);
  });

  it('jede zustandsartige Art liest die Welt; alle/eines/nicht verknüpfen', () => {
    const w = world();
    const t = (trigger: Trigger): boolean => holds(new Armed(trigger, 't'), w);
    w.s['hergestellt.steinaxt'] = 1;
    w.s.kills = 3;
    expect(t({ art: 'statistik', statistik: 'hergestellt', schluessel: 'steinaxt', mindestens: 1 })).toBe(true);
    expect(t({ art: 'statistik', statistik: 'kills', mindestens: 4 })).toBe(false);
    w.items.stein = 2;
    expect(t({ art: 'besitz', item: 'stein', anzahl: 2 })).toBe(true);
    expect(t({ art: 'besitz', item: 'stein', anzahl: 3 })).toBe(false);
    w.cond.add('hungrig');
    expect(t({ art: 'zustand', zustand: 'hungrig' })).toBe(true);
    w.d = 1;
    w.h = 18.5;
    expect(t({ art: 'uhr', tag: 1, vorStunde: 19 })).toBe(true);
    expect(t({ art: 'uhr', tag: 2 })).toBe(false);
    expect(t({ art: 'uhr', abStunde: 19 })).toBe(false);
    w.light = 0.1;
    expect(t({ art: 'lichtstufe', hoechstens: 0.15 })).toBe(true);
    expect(t({ art: 'lichtstufe', mindestens: 0.2 })).toBe(false);
    w.inside = true;
    w.room = 'werkstatt';
    expect(t({ art: 'raum', innen: true })).toBe(true);
    expect(t({ art: 'raum', innen: false })).toBe(false);
    expect(t({ art: 'raum', raumtyp: 'werkstatt' })).toBe(true);
    expect(t({ art: 'raum', raumtyp: 'kueche' })).toBe(false);
    w.unl.add('lf1_wegsteine');
    expect(t({ art: 'freischaltung', freischaltung: 'lf1_wegsteine' })).toBe(true);
    w.quest['einstieg/lagerfeuer'] = 'erledigt';
    w.quest.einstieg = 'aktiv';
    expect(t({ art: 'aufgabe', aufgabe: 'einstieg', schritt: 'lagerfeuer', status: 'erledigt' })).toBe(true);
    expect(t({ art: 'aufgabe', aufgabe: 'einstieg', status: 'erledigt' })).toBe(false);
    w.places.schrein = 1;
    expect(t({ art: 'ort', ortstyp: 'schrein' })).toBe(true);
    expect(t({ art: 'ort', ortstyp: 'schrein', anzahl: 2 })).toBe(false);
    expect(t({ art: 'alle', von: [{ art: 'zustand', zustand: 'hungrig' }, { art: 'besitz', item: 'stein', anzahl: 9 }] })).toBe(false);
    expect(t({ art: 'eines', von: [{ art: 'zustand', zustand: 'hungrig' }, { art: 'besitz', item: 'stein', anzahl: 9 }] })).toBe(true);
    expect(t({ art: 'nicht', von: { art: 'zustand', zustand: 'durstig' } })).toBe(true);
  });

  it('eine Verknüpfung zählt jedes Ereignis-Blatt für sich (Tiefe zuerst)', () => {
    const a = new Armed(
      {
        art: 'alle',
        von: [
          { art: 'ereignis', ereignis: 'treeFelled' },
          { art: 'eines', von: [{ art: 'ereignis', ereignis: 'tileDug' }, { art: 'ereignis', ereignis: 'treeFelled', anzahl: 3 }] },
        ],
      },
      'kombi',
    );
    const w = world();
    countEvent(a, 'treeFelled', {}, 0);
    expect(a.counts).toEqual([1, 0, 1]);
    expect(holds(a, w)).toBe(false);
    countEvent(a, 'tileDug', {}, 0);
    expect(a.counts).toEqual([1, 1, 1]);
    expect(holds(a, w)).toBe(true);
    // An event under `nicht` holds until it happened.
    const n = new Armed({ art: 'nicht', von: { art: 'ereignis', ereignis: 'playerDied' } }, 'n');
    expect(holds(n, w)).toBe(true);
    countEvent(n, 'playerDied', {}, 0);
    expect(holds(n, w)).toBe(false);
    expect(n.compiled.stateful).toBe(true);
  });

  it('das Brett: nur wartende Typen zählen, Zustände im Welt-Tick, Auslösen einmal; der Vertrags-Auswerter', () => {
    const board = new TriggerBoard();
    const w = world();
    const ev = new Armed({ art: 'ereignis', ereignis: 'treeFelled' }, 'ev');
    const st = new Armed({ art: 'besitz', item: 'holz', anzahl: 5 }, 'st');
    board.arm(ev);
    board.arm(st);
    board.arm(ev);
    expect(board.armed).toHaveLength(2);
    expect(board.listens('treeFelled')).toBe(true);
    expect(board.listens('tileDug')).toBe(false);
    const ready: string[] = [];
    w.items.holz = 5;
    expect(board.settle(w, false, (a) => ready.push(a.owner))).toBe(0);
    board.dispatch('treeFelled', {}, 0);
    expect(board.settle(w, false, (a) => ready.push(a.owner))).toBe(1);
    expect(board.settle(w, true, (a) => ready.push(a.owner))).toBe(1);
    expect(ready).toEqual(['ev', 'st']);
    // Done triggers never fire again; disarmed ones are gone from the index.
    expect(board.settle(w, true, (a) => ready.push(a.owner))).toBe(0);
    board.disarm(ev);
    expect(board.listens('treeFelled')).toBe(false);
    board.clear();
    expect(board.armed).toHaveLength(0);
    const evaluator = triggerEvaluator(() => 3);
    const kill = new Armed({ art: 'ereignis', ereignis: 'creatureDied', wo: { by: PLAYER_TOKEN } }, 'k');
    expect(evaluator.onEvent(kill, 'creatureDied', { entity: 1, creature: 'reh', by: 3, carcass: 0, loot: true, facing: 0, variant: -1, layer: 0, x: 0, y: 0, tick: 0 })).toBe(true);
    expect(evaluator.check(kill, w)).toBe(true);
  });
});

describe('Validator-Regel ausloeser (tools/validator/ausloeser.ts)', () => {
  const T = { de: 'x', en: 'x' };
  function registry(hints: readonly z.input<typeof guideHintSchema>[], sources: readonly z.input<typeof statSourceSchema>[] = []): ContentRegistry {
    return new ContentRegistry()
      .defineCollection('items', z.object({ id: z.string() }), [{ id: 'stein' }])
      .defineCollection('conditions', z.object({ id: z.string() }), [{ id: 'hungrig' }])
      .defineCollection('stats', statSchema, [
        { id: 'kills', name: T, einheit: 'anzahl', geschluesselt: true },
        { id: 'tode', name: T, einheit: 'anzahl', geschluesselt: false },
      ])
      .defineCollection('statSources', statSourceSchema, sources)
      .defineCollection('quests', questSchema, [{ id: 'einstieg', art: 'einstieg', titel: T, beschreibung: T, schritte: [{ id: 'a', titel: T, hinweis: T, ausloeser: { art: 'besitz', item: 'stein', anzahl: 1 } }] }])
      .defineCollection('guideHints', guideHintSchema, hints);
  }
  const hint = (id: string, ausloeser: Trigger): z.input<typeof guideHintSchema> => ({ id, kanal: 'hinweis', text: T, ausloeser, prioritaet: 1, einmalig: true });

  it('gültige Auslöser ohne Befund; jede kaputte Id und jedes unbekannte Ereignis ein Fehler', () => {
    const events = ['treeFelled', 'creatureDied'];
    expect(checkTriggers(registry([hint('hinweis_a', { art: 'eines', von: [{ art: 'ereignis', ereignis: 'treeFelled' }, { art: 'statistik', statistik: 'kills', schluessel: '*', mindestens: 2 }] })]), events).errors).toEqual([]);
    const bad = checkTriggers(
      registry(
        [
          hint('hinweis_a', { art: 'ereignis', ereignis: 'baumGefaellt' }),
          hint('hinweis_b', { art: 'besitz', item: 'gold', anzahl: 1 }),
          hint('hinweis_c', { art: 'alle', von: [{ art: 'zustand', zustand: 'satt' }, { art: 'statistik', statistik: 'tode', schluessel: 'wolf', mindestens: 1 }] }),
          hint('hinweis_d', { art: 'aufgabe', aufgabe: 'einstieg', schritt: 'zz', status: 'aktiv' }),
          hint('hinweis_e', { art: 'statistik', statistik: 'fehlt', mindestens: 1 }),
        ],
        [{ id: 'q', statistik: 'tode', ereignis: 'gibtsNicht', schluessel: 'creature' }],
      ),
      events,
    );
    expect(bad.errors.join('\n')).toMatch(/Hinweis hinweis_a: Ereignis baumGefaellt/);
    expect(bad.errors.join('\n')).toMatch(/Hinweis hinweis_b: Item gold/);
    expect(bad.errors.join('\n')).toMatch(/Hinweis hinweis_c: Zustand satt/);
    expect(bad.errors.join('\n')).toMatch(/Hinweis hinweis_c: Statistik tode ist nicht geschlüsselt/);
    expect(bad.errors.join('\n')).toMatch(/Hinweis hinweis_d: Aufgabe einstieg hat keinen Schritt zz/);
    expect(bad.errors.join('\n')).toMatch(/Hinweis hinweis_e: Statistik fehlt/);
    expect(bad.errors.join('\n')).toMatch(/Statistik-Quelle q: Ereignis gibtsNicht/);
    expect(bad.errors.join('\n')).toMatch(/Statistik-Quelle q: tode ist nicht geschlüsselt/);
    expect(bad.errors).toHaveLength(8);
  });
});
