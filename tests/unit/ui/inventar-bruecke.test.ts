/**
 * M3-30/M3-31: what the menus read from and send through the UI bridge (src/ui/bridge.ts) – the
 * player's bags and the worn equipment's stats (sampled once per frame, published only on a change),
 * the player's vitals rounded to 0.1, the menu input of the session, the frame hook the screens poll
 * in, and the bag commands of the inventory screen (validated like every game command).
 */
import { effect } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import { parseGameCommand } from '../../../src/game/commands';
import { aggregateEquipmentStats } from '../../../src/game/equipment/formulas';
import { emptyBags } from '../../../src/game/inventory/bags';
import { BOOT_SESSION_SEED, createPlayerSample, GameSession, type BagsSample, type PlayerSample, type SessionStatus } from '../../../src/game/session';
import { createUiBridge, type UiBridgeSession } from '../../../src/ui/bridge';

/** A session that exposes what the menus need, driven by the test. */
function fakeSession() {
  const commands: unknown[] = [];
  let bagsRevision = 0;
  let bagsState = emptyBags();
  let player: Partial<PlayerSample> | null = null;
  const session: UiBridgeSession = {
    sampleStatus: (out: SessionStatus) => out,
    onEvent: () => () => undefined,
    command: (raw: unknown) => {
      commands.push(raw);
      return parseGameCommand(raw);
    },
    sampleBags: (out: BagsSample) => {
      out.state = bagsState;
      out.revision = bagsRevision;
      out.stats = aggregateEquipmentStats([]);
      return out;
    },
    samplePlayer: (out: PlayerSample) => {
      if (player === null) return false;
      Object.assign(out, player);
      return true;
    },
  };
  return {
    session,
    commands,
    change() {
      bagsState = { ...bagsState, auswahl: (bagsState.auswahl + 1) % 10 };
      bagsRevision++;
    },
    setPlayer(p: Partial<PlayerSample> | null) {
      player = p === null ? null : { ...createPlayerSample(), ...p };
    },
  };
}

describe('Brücke: Taschen, Werte, Eingabe der Menüs', () => {
  it('veröffentlicht die Taschen nur bei neuer Revision (unveränderter Zustand = kein Neuzeichnen)', () => {
    const f = fakeSession();
    const bridge = createUiBridge(f.session);
    const first = bridge.state.bags.value;
    expect(first).not.toBeNull();
    let notified = -1;
    const stop = effect(() => {
      void bridge.state.bags.value;
      notified++;
    });
    bridge.frame();
    bridge.frame();
    expect(notified).toBe(0);
    f.change();
    bridge.frame();
    expect(notified).toBe(1);
    expect(bridge.state.bags.value?.auswahl).toBe(1);
    expect(bridge.state.equipmentStats.value?.ruestungsgewicht).toBeNull();
    stop();
  });

  it('Lebenswerte auf 0,1 gerundet; ohne Spieler present = false', () => {
    const f = fakeSession();
    const bridge = createUiBridge(f.session);
    expect(bridge.state.player.present.value).toBe(false);
    f.setPlayer({ health: 87.44, maxHealth: 100, stamina: 12.36, coreC: 36.951, feltC: 8.26, bandLowC: 18, bandHighC: 26, temperatureStage: 'frierend' });
    bridge.frame();
    const v = bridge.state.player;
    expect(v.present.value).toBe(true);
    expect(v.health.value).toBe(87.4);
    expect(v.stamina.value).toBe(12.4);
    expect(v.coreC.value).toBe(37);
    expect(v.feltC.value).toBe(8.3);
    expect(v.temperatureStage.value).toBe('frierend');
    f.setPlayer(null);
    bridge.frame();
    expect(v.present.value).toBe(false);
    expect(v.health.value).toBe(87.4);
  });

  it('Sitzungen ohne Taschen und Eingabe (Tests, alte Seiten): Signale bleiben null, input null', () => {
    const bridge = createUiBridge({ sampleStatus: (o: SessionStatus) => o, onEvent: () => () => undefined, command: (raw: unknown) => parseGameCommand(raw) });
    expect(bridge.state.bags.value).toBeNull();
    expect(bridge.state.equipmentStats.value).toBeNull();
    expect(bridge.input).toBeNull();
  });

  it('Frame-Hook läuft nach dem Veröffentlichen; Abmelden wirkt', () => {
    const f = fakeSession();
    const bridge = createUiBridge(f.session);
    const seen: number[] = [];
    const stop = bridge.onFrame(() => seen.push(bridge.state.bags.value?.auswahl ?? -1));
    f.change();
    bridge.frame();
    stop();
    f.change();
    bridge.frame();
    expect(seen).toEqual([1]);
  });

  it('Taschen-Commands: nur gültige Game-Commands, optionale Felder fehlen statt undefined', () => {
    const f = fakeSession();
    const inv = createUiBridge(f.session).actions.inventory;
    const a = { bereich: 'inventar', index: 2 } as const;
    const b = { bereich: 'schnellleiste', index: 0 } as const;
    inv.move(a, b);
    inv.move(a, b, 5);
    inv.split(a);
    inv.split(a, b);
    inv.collect(a);
    inv.sort();
    inv.quickMove(a);
    inv.discard(a);
    inv.discard(a, 3);
    expect(f.commands).toEqual([
      { type: 'inventory.move', from: a, to: b },
      { type: 'inventory.move', from: a, to: b, count: 5 },
      { type: 'inventory.split', from: a },
      { type: 'inventory.split', from: a, to: b },
      { type: 'inventory.collect', at: a },
      { type: 'inventory.sort' },
      { type: 'inventory.quickMove', from: a },
      { type: 'inventory.discard', from: a },
      { type: 'inventory.discard', from: a, count: 3 },
    ]);
    for (const c of f.commands) expect(Object.values(c as object)).not.toContain(undefined);
  });
});

describe('Brücke an der echten Sitzung', () => {
  it('liest Taschen und Ausrüstungswerte der Simulation; ein Command ändert sie im nächsten Tick', () => {
    const session = new GameSession({ config: { seed: BOOT_SESSION_SEED } });
    const bridge = createUiBridge(session);
    expect(bridge.input).toBe(session.reader);
    const before = bridge.state.bags.value;
    expect(before?.inventar).toHaveLength(30);
    expect(before?.schnellleiste).toHaveLength(10);
    expect(before?.ausruestung).toHaveLength(8);
    expect(bridge.state.equipmentStats.value?.werte.isolation).toBe(0);
    session.command({ type: 'player.selectHotbar', index: 3 });
    bridge.frame();
    expect(bridge.state.bags.value).toBe(before);
    session.step();
    bridge.frame();
    expect(bridge.state.bags.value?.auswahl).toBe(3);
    expect(bridge.state.player.present.value).toBe(false);
  });
});
