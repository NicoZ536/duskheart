/**
 * M7-93 Einen älteren Speicherslot gezielt laden (MASTERPROMPT §28 „die letzten 3 Autosaves rotierend“; docs/SPIEL.md §25
 * „Speicherslots“): die Weltauswahl zeigt die Slots einer Welt (`main`, `auto-1 … auto-3`) mit ihrer Zeit, neuester zuerst,
 * und lädt genau den gewählten.
 *
 * - `readChosenSave` liest genau diesen Slot – keinen anderen statt seiner: ein beschädigter ist ein Fehler, den das Menü zeigt;
 *   `stored` nennt alle Slots der Welt, damit die Rotation einer so geladenen Sitzung den ältesten überschreibt, nicht den
 *   neuesten;
 * - der Startauftrag trägt den Slot (`slot`), die Boot-Art reicht ihn weiter – auch `?laden=<id>&stand=<slot>` der Debug-Seite;
 *   ein unbekannter Slot gilt nicht;
 * - das Modell der Slotwahl: Name je Slot („Spielstand“, „Autosave 2“), der neueste markiert, nur Slots einer Welt.
 */
import { describe, expect, it } from 'vitest';
import { resolveSimConfig, type Simulation } from '../../../src/game/sim';
import type { SaveParticipant } from '../../../src/game/participant';
import { Autosaver } from '../../../src/save/autosave';
import { MemorySaveStore } from '../../../src/save/memoryStore';
import { SaveService } from '../../../src/save/saveService';
import { nextAutosaveSlot } from '../../../src/save/slots';
import { SaveError } from '../../../src/save/registry';
import { listSlotStamps, readChosenSave, readNewestIntactSave } from '../../../src/save/world';
import { sharedStore } from '../../../src/save/writer';
import { createI18n } from '../../../src/i18n';
import { bootArt, readStartRequest, startRequestSchema } from '../../../src/ui/menu/start';
import { standSlot, standZeile, waehlbareStaende } from '../../../src/ui/screens/weltauswahl/modell';
import { fixtureManager, settle } from '../world/streamFixture';

const WORLD = 'welt-slotwahl';
const CONFIG = resolveSimConfig({ seed: 11, worldSize: 'small' });
const T0 = 1_760_000_000_000;

/** A simulation as the autosaver sees it: one counter participant, the fixture chunk store, a clock. */
function fakeSim(): { sim: Simulation; counter: { value: number }; setTick(t: number): void } {
  const { manager } = fixtureManager();
  settle(manager, 0, 10, 10);
  const counter = { value: 0 };
  const participant: SaveParticipant = {
    id: 'zaehler',
    version: 1,
    serialize: () => ({ value: counter.value }),
    deserialize: (d) => {
      counter.value = (d as { value: number }).value;
    },
  };
  let tick = 0;
  const sim = {
    participants: () => [participant],
    world: { materialized: true, chunks: manager },
    config: CONFIG,
    get tick() {
      return tick;
    },
    clock: { day: 1 },
  } as unknown as Simulation;
  return { sim, counter, setTick: (t) => (tick = t) };
}

/** The counter a slot's snapshot holds. */
function counterOf(snapshot: unknown): number {
  return (snapshot as { participants: { zaehler: { data: { value: number } } } }).participants.zaehler.data.value;
}

/** `main` (counter 1), then three autosaves (2, 3, 4): auto-1 is the oldest autosave, auto-3 the newest slot. */
async function fourSaves(): Promise<MemorySaveStore> {
  const f = fakeSim();
  const store = new MemorySaveStore();
  let now = T0;
  const autosaver = new Autosaver({ sim: f.sim, service: new SaveService({ access: sharedStore(store) }), target: { worldId: WORLD, name: 'Slotwahl' }, now: () => now, gameVersion: 'test', intervalMinutes: () => 3 });
  for (let i = 1; i <= 4; i++) {
    f.counter.value = i;
    f.setTick(i * 100);
    now += 1000;
    await autosaver.save(i === 1 ? 'main' : 'auto');
  }
  return store;
}

describe('M7-93 einen älteren Slot gezielt laden', () => {
  it('der gewählte Slot lädt genau sich selbst – auch ein älterer Autosave; die neueren bleiben, die Rotation kennt sie', async () => {
    const store = await fourSaves();
    // The newest slot is what "Laden" loads.
    expect((await readNewestIntactSave(store, WORLD)).save.slot).toBe('auto-3');
    const stamps = await listSlotStamps(store, WORLD);
    expect(stamps.map((s) => s.slot)).toEqual(['auto-3', 'auto-2', 'auto-1', 'main']);
    // The oldest autosave, chosen: its own state.
    const chosen = await readChosenSave(store, WORLD, 'auto-1');
    expect(chosen.save.slot).toBe('auto-1');
    expect(counterOf(chosen.save.snapshot)).toBe(2);
    expect(chosen.skipped).toEqual([]);
    expect(chosen.stored).toEqual(stamps);
    // The session that loaded it overwrites the oldest slot next (main), not the newest autosave.
    expect(nextAutosaveSlot(chosen.stored ?? [])).toBe('auto-1');
    expect(counterOf((await readChosenSave(store, WORLD, 'main')).save.snapshot)).toBe(1);
  });

  it('ein beschädigter gewählter Slot ist ein Fehler – kein anderer Slot springt ein', async () => {
    const store = await fourSaves();
    const rec = await store.getSlot(WORLD, 'auto-2');
    await store.write((b) => b.putSlot({ ...(rec as NonNullable<typeof rec>), snapshot: { format: 1, participants: { zaehler: { version: 1, data: { value: 99 } } } } }));
    await expect(readChosenSave(store, WORLD, 'auto-2')).rejects.toThrow(SaveError);
    await expect(readChosenSave(store, WORLD, 'auto-2')).rejects.toThrow(/corrupt: hash/);
    await expect(readChosenSave(store, 'gibtsnicht', 'auto-1')).rejects.toThrow(SaveError);
  });

  it('Startauftrag und Boot-Art tragen den Slot; die Debug-Seite liest ihn aus `&stand=`; ein unbekannter gilt nicht', () => {
    const request = startRequestSchema.parse({ kind: 'load', worldId: WORLD, slot: 'auto-2' });
    expect(bootArt('http://localhost/', false, request, () => false)).toEqual({ art: 'laden', worldId: WORLD, debug: false, slot: 'auto-2' });
    // Without a slot: the newest intact one, as before.
    expect(bootArt('http://localhost/', false, { kind: 'load', worldId: WORLD }, () => false)).toEqual({ art: 'laden', worldId: WORLD, debug: false });
    expect(startRequestSchema.safeParse({ kind: 'load', worldId: WORLD, slot: 'auto-9' }).success).toBe(false);
    const stored = new Map<string, string>([['duskhearth.start', JSON.stringify({ kind: 'load', worldId: WORLD, slot: 'auto-7' })]]);
    expect(readStartRequest({ getItem: (k) => stored.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined })).toBeNull();
    expect(bootArt(`http://localhost/?debug=1&laden=${WORLD}&stand=auto-1`, true, null, () => false)).toEqual({ art: 'laden', worldId: WORLD, debug: true, slot: 'auto-1' });
    expect(bootArt(`http://localhost/?debug=1&laden=${WORLD}&stand=irgendwas`, true, null, () => false)).toEqual({ art: 'laden', worldId: WORLD, debug: true });
  });

  it('die Slotwahl: Namen je Slot, der neueste markiert, nur Slots einer Welt', () => {
    const i18n = createI18n('de', { strict: true });
    const staende = [
      { slot: 'auto-3', gespeichert: T0 + 4000 },
      { slot: 'fremd', gespeichert: T0 + 3500 },
      { slot: 'auto-1', gespeichert: T0 + 2000 },
      { slot: 'main', gespeichert: T0 + 1000 },
    ];
    const wahl = waehlbareStaende(staende);
    expect(wahl.map((s) => s.slot)).toEqual(['auto-3', 'auto-1', 'main']);
    expect(standSlot('fremd')).toBeNull();
    expect(standSlot('auto-2')).toBe('auto-2');
    const zeilen = wahl.map((s, i) => standZeile(i18n, s, i === 0));
    expect(zeilen.map((z) => [z.name, z.neuester])).toEqual([
      ['Autosave 3', true],
      ['Autosave 1', false],
      ['Eigener Spielstand', false],
    ]);
    expect(zeilen[0]?.gespeichert).toMatch(/^Gespeichert /);
    i18n.setLanguage('en');
    expect(standZeile(i18n, { slot: 'main', gespeichert: T0 }, false).name).toBe('Manual save');
    expect(i18n.t('ui.welten.slotNeuester', { name: 'Autosave 2' })).toBe('Autosave 2 (newest)');
  });
});
