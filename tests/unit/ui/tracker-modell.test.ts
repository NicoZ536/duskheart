/**
 * M4-08: the recipe tracker of the HUD – pinning (src/ui/hud/tracker/anheften.ts: the page's pins are the game's,
 * `craft.pin`; at most three, the oldest goes – the rule itself is the crafting system's, tests/unit/game/
 * crafting-anheften.test.ts) and its content (src/ui/hud/tracker/modell.ts): per pinned recipe the ingredients with
 * what is at hand, the solution hint of a missing one, the station it needs and whether one is within reach, the water
 * a recipe made by it needs, "all at hand".
 */
import { signal } from '@preact/signals';
import { afterEach, describe, expect, it } from 'vitest';
import { GAME_COMMAND_TYPES } from '../../../src/game/commands';
import { BOOT_SESSION_SEED, GameSession } from '../../../src/game/session';
import { createI18n } from '../../../src/i18n';
import { createUiBridge } from '../../../src/ui/bridge';
import { angeheftet, anheften, bindeAnheften, istAngeheftet, loesen, MAX_ANGEHEFTET, umschalten, type AnheftZiel } from '../../../src/ui/hud/tracker/anheften';
import { trackerBloecke } from '../../../src/ui/hud/tracker/modell';
import { contentRezeptKontext } from '../../../src/ui/screens/handwerk/modell';
import { werkstattQuelle, type VorratStand } from '../../../src/ui/screens/handwerk/quelle';

const ctx = contentRezeptKontext();
const de = createI18n('de', { strict: true });

function vorrat(items: Record<string, number>, stationen: Record<string, string> = {}, amWasser = false): VorratStand {
  return {
    imBeutel: (i) => items[i] ?? 0,
    verfuegbar: (i) => items[i] ?? 0,
    stationAnHand: (s) => (stationen[s] === undefined ? null : { station: stationen[s], qualitaet: 0, tempo: 1 }),
    amWasser,
  };
}

/** A pin target that records the commands; its list is set by the test (the next sample). */
function fakeZiel(): AnheftZiel & { readonly liste: ReturnType<typeof signal<readonly string[]>>; readonly befehle: Array<[string, boolean]> } {
  const liste = signal<readonly string[]>([]);
  const befehle: Array<[string, boolean]> = [];
  return { liste, befehle, angeheftet: liste, anheften: (id, an) => befehle.push([id, an]) };
}

let unbind: (() => void) | null = null;
afterEach(() => {
  unbind?.();
  unbind = null;
});

describe('Anheften', () => {
  it('liest die Nadeln des Ziels und schickt jede Änderung als Befehl; ohne Ziel ist nichts angeheftet', () => {
    expect(angeheftet.value).toEqual([]);
    anheften('rezept_faserseil');
    expect(angeheftet.value).toEqual([]);
    const z = fakeZiel();
    unbind = bindeAnheften(z);
    anheften('rezept_faserseil');
    expect(z.befehle).toEqual([['rezept_faserseil', true]]);
    // The list follows with the sample, not with the click.
    expect(angeheftet.value).toEqual([]);
    z.liste.value = ['rezept_faserseil'];
    expect(angeheftet.value).toEqual(['rezept_faserseil']);
    expect(istAngeheftet('rezept_faserseil')).toBe(true);
    expect(umschalten('rezept_faserseil')).toBe(false);
    expect(umschalten('rezept_steinaxt')).toBe(true);
    loesen('rezept_steinaxt');
    expect(z.befehle).toEqual([
      ['rezept_faserseil', true],
      ['rezept_faserseil', false],
      ['rezept_steinaxt', true],
      ['rezept_steinaxt', false],
    ]);
    unbind();
    unbind = null;
    expect(angeheftet.value).toEqual([]);
  });

  it('im Spiel: Anheften ist der Befehl craft.pin, die Nadeln kommen aus der Abtastung – höchstens drei, das älteste weicht', () => {
    expect(GAME_COMMAND_TYPES).toContain('craft.pin');
    const s = new GameSession({ config: { seed: BOOT_SESSION_SEED } });
    s.command({ type: 'player.spawn' });
    for (const [item, count] of [['fasern', 9], ['zweig', 4], ['stein', 4], ['faserseil', 1], ['harz', 1], ['holz', 4]] as const) s.command({ type: 'inventory.give', item, count });
    s.step();
    const bridge = createUiBridge(s);
    const q = werkstattQuelle(bridge);
    if (q === null) throw new Error('the session offers crafting samples');
    // The source of the bridge in use is the page's pin target; the test unbinds it again (no module state is left).
    unbind = bindeAnheften(q);
    const stop = q.bedarf([], []);
    const frame = (): void => {
      s.step();
      bridge.frame();
    };
    for (const id of ['rezept_faserseil', 'rezept_steinaxt', 'rezept_fackel']) {
      anheften(id);
      frame();
    }
    expect(angeheftet.value).toEqual(['rezept_faserseil', 'rezept_steinaxt', 'rezept_fackel']);
    expect(q.angeheftet.value).toEqual(angeheftet.value);
    expect(umschalten('rezept_lagerfeuer')).toBe(true);
    frame();
    expect(angeheftet.value).toHaveLength(MAX_ANGEHEFTET);
    expect(angeheftet.value).toEqual(['rezept_steinaxt', 'rezept_fackel', 'rezept_lagerfeuer']);
    loesen('rezept_fackel');
    frame();
    expect(angeheftet.value).toEqual(['rezept_steinaxt', 'rezept_lagerfeuer']);
    stop();
  });
});

describe('Inhalt des Trackers', () => {
  it('zeigt je Zutat Vorrat gegen Bedarf und für Fehlendes den Lösungshinweis', () => {
    const [axe] = trackerBloecke(de, ctx, ['rezept_steinaxt'], vorrat({ zweig: 5, stein: 1 }), new Set());
    expect(axe).toMatchObject({ id: 'rezept_steinaxt', name: 'Steinaxt', produkt: 'steinaxt', zutatenDa: false, station: null, wasser: null, bereit: false });
    expect(axe?.zeilen.map((z) => [z.key, z.hat, z.braucht, z.hinweis])).toEqual([
      ['zweig', 5, 2, null],
      ['stein', 1, 2, 'Sammeln in der Welt'],
      ['faserseil', 0, 1, 'herstellbar ohne Station'],
    ]);
  });

  it('nennt die Station, solange keine in Reichweite ist, und meldet „alles da“', () => {
    const fern = trackerBloecke(de, ctx, ['rezept_brett'], vorrat({ holz: 3 }), new Set());
    expect(fern[0]).toMatchObject({ zutatenDa: true, station: { ort: 'am Sägebock', daHand: false }, bereit: false });
    const nah = trackerBloecke(de, ctx, ['rezept_brett'], vorrat({ holz: 3 }, { saegebock: 'saegebock' }), new Set());
    expect(nah[0]?.station).toEqual({ ort: 'am Sägebock', daHand: true });
    expect(nah[0]?.bereit).toBe(true);
  });

  it('ein Rezept am Wasser (Eimer füllen) ist erst mit Wasser in Reichweite bereit', () => {
    const trocken = trackerBloecke(de, ctx, ['rezept_holzeimer_wasser'], vorrat({ holzeimer: 1 }), new Set());
    expect(trocken[0]).toMatchObject({ zutatenDa: true, wasser: { da: false }, bereit: false });
    const nass = trackerBloecke(de, ctx, ['rezept_holzeimer_wasser'], vorrat({ holzeimer: 1 }, {}, true), new Set());
    expect(nass[0]).toMatchObject({ wasser: { da: true }, bereit: true });
    expect(de.t('ui.tracker.wasser')).toBe('Nur am Wasser');
  });

  it('lässt unbekannte Rezepte aus und behält die Reihenfolge der Nadeln', () => {
    const blocks = trackerBloecke(de, ctx, ['rezept_fackel', 'rezept_gibt_es_nicht', 'rezept_faserseil'], vorrat({}), new Set());
    expect(blocks.map((b) => b.id)).toEqual(['rezept_fackel', 'rezept_faserseil']);
  });
});
