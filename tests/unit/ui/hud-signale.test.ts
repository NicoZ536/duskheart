/**
 * M3-27: the HUD signals of the UI bridge (src/ui/hud/signale.ts, src/ui/bridge.ts `state.hud`, the
 * session's `sampleHud`) – fear in whole points with its stage, conditions with whole seconds (a new list
 * only when an icon, a stack or a shown second changes), the interaction hint recomputed only when its
 * words change, the carried light with its slot and burn time (new only when a shown second, the share or
 * its state changes), everything cleared without a player; the vitals the thermometer reads; the hotbar
 * click command. Against a fake session and the real one (conditions, fear, hint and the torch in the
 * off-hand from the simulation).
 */
import { effect } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import { parseGameCommand } from '../../../src/game/commands';
import { createInteractionFocus } from '../../../src/game/interaction/system';
import { equipmentSlotIndex } from '../../../src/game/items/slots';
import { torchBurnTicks } from '../../../src/game/light/formulas';
import { createHudSample, createPlayerSample, GameSession, type HudSample, type PlayerSample, type SessionStatus } from '../../../src/game/session';
import { createUiBridge, type UiBridgeSession } from '../../../src/ui/bridge';
import { createHudSignals, hintChanged, NO_TIMER, shownSeconds } from '../../../src/ui/hud/signale';

function probe(): HudSample {
  const s = createHudSample();
  s.fear = 45.4;
  s.fearStage = 'fluestern';
  s.conditions.push({ id: 'blutung', stacks: 2, remainingSeconds: 12.2 }, { id: 'hungrig', stacks: 1, remainingSeconds: NO_TIMER });
  s.conditionCount = 2;
  return s;
}

describe('HUD-Signale', () => {
  it('Sekunden aufgerundet, ohne Ende −1', () => {
    expect(shownSeconds(12.01)).toBe(13);
    expect(shownSeconds(12)).toBe(12);
    expect(shownSeconds(NO_TIMER)).toBe(NO_TIMER);
  });

  it('Furcht ganzzahlig, Zustände mit ganzen Sekunden; neue Liste nur bei sichtbarer Änderung', () => {
    const hud = createHudSignals();
    const s = probe();
    hud.publish(s, true);
    expect(hud.view.fear.value).toBe(45);
    expect(hud.view.fearStage.value).toBe('fluestern');
    const first = hud.view.conditions.value;
    expect(first).toEqual([
      { id: 'blutung', stacks: 2, seconds: 13 },
      { id: 'hungrig', stacks: 1, seconds: NO_TIMER },
    ]);
    // A tick later the timer shows the same second: the list stays the same object.
    (s.conditions[0] as { remainingSeconds: number }).remainingSeconds = 12.1;
    hud.publish(s, true);
    expect(hud.view.conditions.value).toBe(first);
    (s.conditions[0] as { remainingSeconds: number }).remainingSeconds = 11.9;
    hud.publish(s, true);
    expect(hud.view.conditions.value).not.toBe(first);
    expect(hud.view.conditions.value[0]?.seconds).toBe(12);
    // Records beyond the count are ignored (reused records of the sample).
    s.conditionCount = 1;
    hud.publish(s, true);
    expect(hud.view.conditions.value).toHaveLength(1);
  });

  it('Hinweis nur bei geänderten Worten neu (Fortschritt allein ändert nichts), ohne Spieler leer', () => {
    const hud = createHudSignals();
    const s = probe();
    s.focus.kind = 'drop';
    s.focus.subject = 'feuerstein';
    s.focus.count = 3;
    s.focus.action = 'aufheben';
    hud.publish(s, true);
    const hint = hud.view.interaction.value;
    expect(hint).toMatchObject({ verb: 'ui.interaction.action.aufheben', count: 3, reason: null });
    let changes = 0;
    const stop = effect(() => {
      void hud.view.interaction.value;
      changes++;
    });
    s.focus.progress = 0.5;
    hud.publish(s, true);
    expect(hud.view.interaction.value).toBe(hint);
    s.focus.count = 4;
    hud.publish(s, true);
    expect(hud.view.interaction.value?.count).toBe(4);
    hud.publish(s, false);
    expect(hud.view.interaction.value).toBeNull();
    expect(hud.view.conditions.value).toHaveLength(0);
    stop();
    expect(changes).toBe(3);
  });

  it('Licht: Platz, Zustand, ganze Sekunden und Anteil; neu nur bei sichtbarer Änderung; ohne Licht oder Spieler null', () => {
    const hud = createHudSignals();
    const s = probe();
    hud.publish(s, true);
    expect(hud.view.light.value).toBeNull();
    const nebenhand = { bereich: 'ausruestung', index: equipmentSlotIndex('nebenhand') } as const;
    Object.assign(s.light, { slot: nebenhand, lit: true, belt: false, restSeconds: 192.4, share: 0.8017, rate: 1 });
    hud.publish(s, true);
    const first = hud.view.light.value;
    expect(first).toEqual({ slot: nebenhand, lit: true, belt: false, seconds: 193, share: 0.8, rain: false });
    // The copy is the view's own: the sample's slot record may change under it.
    expect(first?.slot).not.toBe(s.light.slot);
    s.light.restSeconds = 192.1;
    hud.publish(s, true);
    expect(hud.view.light.value).toBe(first);
    s.light.restSeconds = 191.9;
    s.light.rate = 2;
    hud.publish(s, true);
    expect(hud.view.light.value).toMatchObject({ seconds: 192, rain: true });
    s.light.lit = false;
    hud.publish(s, true);
    expect(hud.view.light.value?.lit).toBe(false);
    s.light.slot = null;
    hud.publish(s, true);
    expect(hud.view.light.value).toBeNull();
    s.light.slot = nebenhand;
    hud.publish(s, true);
    expect(hud.view.light.value).not.toBeNull();
    hud.publish(s, false);
    expect(hud.view.light.value).toBeNull();
  });

  it('hintChanged vergleicht genau die Felder, von denen die Worte abhängen', () => {
    const a = createInteractionFocus();
    const b = createInteractionFocus();
    expect(hintChanged(a, b)).toBe(false);
    b.progress = 0.7;
    b.hitsDone = 2;
    expect(hintChanged(a, b)).toBe(false);
    for (const [k, v] of [['kind', 'object'], ['subject', 'eiche'], ['count', 2], ['action', 'faellen'], ['block', 'needsTool'], ['needs', 'axt'], ['tooWeak', true], ['dig', 'grube'], ['working', true]] as const) {
      const c = { ...createInteractionFocus(), [k]: v };
      expect(hintChanged(a, c), k).toBe(true);
    }
  });
});

describe('Brücke: HUD-Werte', () => {
  function fake(sample: HudSample | null, player: Partial<PlayerSample>) {
    const commands: unknown[] = [];
    const session: UiBridgeSession = {
      sampleStatus: (out: SessionStatus) => out,
      onEvent: () => () => undefined,
      command: (raw: unknown) => {
        commands.push(raw);
        return parseGameCommand(raw);
      },
      samplePlayer: (out: PlayerSample) => {
        Object.assign(out, createPlayerSample(), player);
        return true;
      },
      sampleHud: (out: HudSample) => {
        if (sample === null) return false;
        Object.assign(out, sample);
        return true;
      },
    };
    return { session, commands };
  }

  it('veröffentlicht die Temperaturteile und den Trend (auf 0,001 °C/s) für das Thermometer', () => {
    const f = fake(probe(), { ambientC: 8.34, heatC: 15.06, roomC: 0, coreRateCps: -0.00337 });
    const bridge = createUiBridge(f.session);
    expect(bridge.state.player.ambientC.value).toBe(8.3);
    expect(bridge.state.player.heatC.value).toBe(15.1);
    expect(bridge.state.player.coreRateCps.value).toBe(-0.003);
    expect(bridge.state.hud.fearStage.value).toBe('fluestern');
    expect(bridge.state.hud.conditions.value).toHaveLength(2);
  });

  it('ein Klick auf die Schnellleiste wählt den Platz über player.selectHotbar', () => {
    const f = fake(null, {});
    const bridge = createUiBridge(f.session);
    bridge.actions.inventory.select(7);
    expect(f.commands).toEqual([{ type: 'player.selectHotbar', index: 7 }]);
    expect(bridge.state.hud.conditions.value).toHaveLength(0);
  });

  it('an der echten Sitzung: Zustände, Furcht und Zeit kommen aus der Simulation', { timeout: 60_000 }, () => {
    const session = new GameSession({ config: { seed: 7, worldSize: 'small' } });
    const bridge = createUiBridge(session);
    expect(session.sampleHud(createHudSample())).toBe(false);
    session.command({ type: 'player.spawn' });
    session.step();
    session.command({ type: 'conditions.apply', id: 'blutung' });
    session.command({ type: 'conditions.apply', id: 'blutung' });
    session.command({ type: 'conditions.apply', id: 'ausgeruht' });
    session.command({ type: 'fear.set', value: 62 });
    session.step();
    bridge.frame();
    const liste = bridge.state.hud.conditions.value;
    const blutung = liste.find((c) => c.id === 'blutung');
    expect(blutung?.stacks).toBe(2);
    expect(blutung?.seconds).toBe(30);
    expect(liste.find((c) => c.id === 'ausgeruht')?.seconds).toBe(480);
    expect(bridge.state.hud.fear.value).toBe(62);
    expect(bridge.state.hud.fearStage.value).toBe('trugbilder');
    for (let i = 0; i < 61; i++) session.step();
    bridge.frame();
    expect(bridge.state.hud.conditions.value.find((c) => c.id === 'blutung')?.seconds).toBe(29);
    expect(bridge.state.player.health.value).toBeLessThan(100);

    // A torch in the off-hand: out at first, then lit with the burn time of a fresh torch (§12.2 "4 Spielstunden").
    expect(bridge.state.hud.light.value).toBeNull();
    session.command({ type: 'inventory.give', item: 'fackel', count: 1 });
    session.step();
    bridge.frame();
    const bags = bridge.state.bags.value;
    const from = bags?.schnellleiste.findIndex((st) => st?.item === 'fackel') ?? -1;
    const ref = from >= 0 ? { bereich: 'schnellleiste' as const, index: from } : { bereich: 'inventar' as const, index: bags?.inventar.findIndex((st) => st?.item === 'fackel') ?? -1 };
    session.command({ type: 'inventory.move', from: ref, to: { bereich: 'ausruestung', index: equipmentSlotIndex('nebenhand') } });
    session.step();
    bridge.frame();
    expect(bridge.state.hud.light.value).toMatchObject({ slot: { bereich: 'ausruestung', index: equipmentSlotIndex('nebenhand') }, lit: false, belt: false, share: 1 });
    session.command({ type: 'light.toggle' });
    for (let i = 0; i < 60; i++) session.step();
    bridge.frame();
    const full = torchBurnTicks(session.sim.clock.ticksPerGameHour) / session.sim.clock.tickHz;
    const licht = bridge.state.hud.light.value;
    expect(licht?.lit).toBe(true);
    expect(licht?.seconds).toBeLessThan(Math.ceil(full));
    expect(licht?.seconds).toBeGreaterThanOrEqual(Math.floor(full) - 2);
  });
});
