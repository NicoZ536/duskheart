/**
 * M7-31 Musizieren und Kescher (MASTERPROMPT §11.4 "Musizieren", §12.3 "Musizieren (Flöte, Laute) −2/s im Umkreis", §14
 * "Netz (Insekten, Glühwürmchen …)"; docs/SPIEL.md §24):
 *
 * - `instrument.play {from}` plays the instrument's next song (`lied_<n>`, in turn), a named song only if the instrument
 *   knows it; refusals (no instrument, unknown song, swimming); the music calms fear by 2/s more; the player stands still;
 * - a step, another action, the instrument leaving its slot and `instrument.stop` end it (`instrumentStopped`
 *   with the reason); the music probe of the audio hears the song and falls silent itself;
 * - the hand's use (item use handler) plays and stops;
 * - the net: three fireflies per swarm and night (the swarm stays), crickets from the grass at night, wear per swing.
 */
import { describe, expect, it } from 'vitest';
import { MusicProbeReader } from '../../../src/audio/music/probe';
import { createMusicProbe } from '../../../src/audio/music/types';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { catchesCricket, cricketChance, nextSong, swarmGives } from '../../../src/game/instruments/formulas';
import { InstrumentsSystem } from '../../../src/game/instruments/system';
import type { ItemUseContext } from '../../../src/game/tools/itemUses';
import type { SlotRef } from '../../../src/game/items/slots';
import { kreaturWelt } from './kreatur-testwelt';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { meadow } from './spieler-testwelt';

const TICK = BALANCE.time.tickHz;
const HOTBAR: SlotRef = { bereich: 'schnellleiste', index: 0 };

interface MusikWelt extends LifeWorld {
  readonly instruments: InstrumentsSystem;
  /** The events of the last `act`. */
  last: Map<string, unknown[]>;
  act(...commands: Parameters<LifeWorld['run']>[1] & object): Map<string, unknown[]>;
}

/** A life test world with the instruments (as src/game/setup.ts wires them), the player on (10, 10) with flute and lute. */
function welt(): MusikWelt {
  const w = lifeWorld(meadow(24, 24));
  const instruments = w.sim.addSystem(new InstrumentsSystem({ player: w.player, inventory: w.inventory, collision: w.collision, night: () => w.env.night }));
  w.player.addMotionHold(instruments.holdsPlayer);
  w.life.fear.addSurroundings(instruments.fearSurroundings());
  w.spawn(10, 10);
  w.run(1, [{ type: 'inventory.give', item: 'floete', count: 1 }]);
  const mw = Object.assign(w, {
    instruments,
    last: new Map<string, unknown[]>(),
    act(...commands: Parameters<LifeWorld['run']>[1] & object) {
      mw.last = w.run(1, commands);
      return mw.last;
    },
  });
  // The flute into the first hotbar slot.
  mw.act({ type: 'inventory.move', from: { bereich: 'inventar', index: 0 }, to: HOTBAR });
  return mw;
}

function rejected(events: Map<string, unknown[]>): string[] {
  return ((events.get('commandRejected') ?? []) as Array<{ reason: string }>).map((r) => r.reason);
}

describe('Musizieren', () => {
  it('spielt die Lieder des Instruments der Reihe nach; ein genanntes nur, wenn es das Instrument kennt', () => {
    expect(nextSong(['lied_1', 'lied_2'], 0)).toBe('lied_1');
    expect(nextSong(['lied_1', 'lied_2'], 3)).toBe('lied_2');
    const w = welt();
    w.act({ type: 'instrument.play', from: HOTBAR });
    expect(w.last.get('instrumentPlayed')).toEqual([expect.objectContaining({ instrument: 'floete', lied: 'lied_1', layer: 0 })]);
    expect(w.instruments.playing()).toMatchObject({ instrument: 'floete', lied: 'lied_1', from: HOTBAR });
    // Playing again: the running song stops, the next one begins.
    w.act({ type: 'instrument.play', from: HOTBAR });
    expect(w.last.get('instrumentStopped')).toEqual([expect.objectContaining({ lied: 'lied_1', grund: 'gestoppt' })]);
    expect(w.instruments.playing()?.lied).toBe('lied_2');
    w.act({ type: 'instrument.play', from: HOTBAR, lied: 'lied_3' });
    expect(rejected(w.last)).toEqual(['unknownSong']);
    w.act({ type: 'instrument.stop' });
    expect(w.instruments.isPlaying()).toBe(false);
    w.act({ type: 'instrument.stop' });
    expect(rejected(w.last)).toEqual(['notPlaying']);
    w.act({ type: 'instrument.play', from: { bereich: 'inventar', index: 5 } });
    expect(rejected(w.last)).toEqual(['notAnInstrument']);
    // The lute knows the hearth song.
    w.act({ type: 'inventory.give', item: 'laute', count: 1 });
    w.act({ type: 'instrument.play', from: { bereich: 'inventar', index: 0 }, lied: 'lied_3' });
    expect(w.instruments.playing()).toMatchObject({ instrument: 'laute', lied: 'lied_3' });
    // Every song of an instrument is in the content, on the instrument it names.
    for (const item of ['floete', 'laute']) {
      for (const lied of CONTENT.collection('items').get(item).instrument?.lieder ?? []) expect(CONTENT.collection('songs').get(lied).instrument).toBe(item);
    }
  });

  it('Musik beruhigt: −2 Furcht je Sekunde mehr; der Spieler steht still', () => {
    const quiet = welt();
    quiet.env.light = 0.2;
    quiet.act({ type: 'fear.set', value: 50 });
    const q0 = quiet.life.fear.state.value;
    quiet.run(TICK);
    const withoutMusic = q0 - quiet.life.fear.state.value;
    const w = welt();
    w.env.light = 0.2;
    w.act({ type: 'instrument.play', from: HOTBAR });
    w.act({ type: 'fear.set', value: 50 });
    const v0 = w.life.fear.state.value;
    w.run(TICK);
    expect(v0 - w.life.fear.state.value - withoutMusic).toBeCloseTo(BALANCE.fear.decay.musicPerSecond, 6);
    expect(BALANCE.fear.decay.musicPerSecond).toBe(2);
    expect(w.instruments.calmsAt(w.sim, w.pos().x + (BALANCE.instruments.radiusTiles - 0.5) * 16, w.pos().y)).toBe(true);
    expect(w.instruments.calmsAt(w.sim, w.pos().x + (BALANCE.instruments.radiusTiles + 0.5) * 16, w.pos().y)).toBe(false);
    // The motion hold: the player does not walk while playing (the step ends the music, see below), and no music stands still.
    expect(w.instruments.holdsPlayer(w.sim)).toBe(true);
  });

  it('ein Schritt, eine Handlung und ein leerer Slot beenden das Spiel mit ihrem Grund; die Musik-Sonde hört das Lied', () => {
    const reasons: string[] = [];
    const stop = (ev: Map<string, unknown[]>): void => {
      for (const e of (ev.get('instrumentStopped') ?? []) as Array<{ grund: string }>) reasons.push(e.grund);
    };
    let w = welt();
    w.act({ type: 'instrument.play', from: HOTBAR });
    stop(w.act({ type: 'player.move', dx: 1, dy: 0 }));
    w = welt();
    w.act({ type: 'instrument.play', from: HOTBAR });
    w.act({ type: 'inventory.give', item: 'apfel', count: 1 });
    stop(w.act({ type: 'action.eat', from: { bereich: 'inventar', index: 0 } }));
    w = welt();
    w.act({ type: 'instrument.play', from: HOTBAR });
    stop(w.act({ type: 'inventory.move', from: HOTBAR, to: { bereich: 'inventar', index: 3 } }));
    expect(reasons).toEqual(['bewegung', 'handlung', 'weg']);
    // The probe of the music: the player's song, the music itself silent; after the stop the world's music again.
    w.act({ type: 'inventory.move', from: { bereich: 'inventar', index: 3 }, to: HOTBAR });
    w.act({ type: 'instrument.play', from: HOTBAR });
    const reader = new MusicProbeReader();
    const probe = createMusicProbe();
    reader.read(w.sim, probe);
    expect([probe.mood, probe.song]).toEqual(['stille', 'lied_2']);
    w.act({ type: 'instrument.stop' });
    reader.read(w.sim, probe);
    expect([probe.mood, probe.song]).toEqual(['erkundung', '']);
  });

  it('die Hand: Benutzen spielt, nochmal Benutzen hört auf', () => {
    const w = welt();
    const [instrument] = w.instruments.itemUses();
    const def = CONTENT.collection('items').get('floete');
    expect(instrument?.handles(def)).toBe(true);
    expect(instrument?.handles(CONTENT.collection('items').get('stein'))).toBe(false);
    const ctx = (): ItemUseContext => ({ slot: HOTBAR, stack: { item: 'floete', count: 1 }, def, target: null, tick: w.sim.tick, named: false, primary: true });
    expect(instrument?.use(w.sim, ctx())).toBe('used');
    expect(w.instruments.isPlaying()).toBe(true);
    w.run(2);
    expect(instrument?.use(w.sim, ctx())).toBe('used');
    expect(w.instruments.isPlaying()).toBe(false);
  });
});

describe('Kescher', () => {
  it('drei Glühwürmchen je Schwarm und Nacht, der Schwarm bleibt; nachts Grillen aus dem Gras; jeder Schwung nutzt ab', () => {
    expect([0, 1, 2, 3].map(swarmGives)).toEqual([true, true, true, false]);
    expect(cricketChance(true)).toBeGreaterThan(cricketChance(false));
    // The draw: the same swing on the same tile catches the same; over many swings at night about the chance.
    let caught = 0;
    for (let s = 0; s < 2000; s++) if (catchesCricket(7, s, 100, 100, true)) caught++;
    expect(caught / 2000).toBeGreaterThan(cricketChance(true) - 0.05);
    expect(caught / 2000).toBeLessThan(cricketChance(true) + 0.05);
    expect(catchesCricket(7, 12, 100, 100, true)).toBe(catchesCricket(7, 12, 100, 100, true));

    const k = kreaturWelt(meadow(30, 20), { x: 10, y: 10 }, 1, 'inhalt');
    const instruments = k.sim.addSystem(new InstrumentsSystem({ player: k.player, inventory: k.inventory, creatures: k.creatures, collision: k.collision, night: () => true }));
    const swarm = k.creature('gluehwuermchen', 11, 10);
    k.hold('netz');
    const net = instruments.itemUses()[1];
    const def = CONTENT.collection('items').get('netz');
    expect(net?.handles(def)).toBe(true);
    const swing = (): { fang: string | null } => {
      const p = k.where(swarm);
      const stack = k.inventory.selected();
      if (stack === null) throw new Error('no net');
      const out = net?.use(k.sim, { slot: HOTBAR, stack, def, target: { layer: 0, tx: Math.floor(p.x / 16), ty: Math.floor(p.y / 16) }, tick: k.sim.tick, named: false, primary: false });
      expect(out).toBe('used');
      const ev = k.run(1);
      return (ev.get('netSwung') as Array<{ fang: string | null }>)[0] as { fang: string | null };
    };
    const catches = [swing(), swing(), swing(), swing()].map((e) => e.fang);
    expect(catches).toEqual(['gluehwuermchen', 'gluehwuermchen', 'gluehwuermchen', null]);
    expect(k.inventory.count('gluehwuermchen')).toBe(3);
    expect(k.creatures.store.get(swarm)?.health).toBeGreaterThan(0);
    // Four swings wore the net by four uses.
    expect(k.inventory.selected()?.haltbarkeit).toBe((def.haltbarkeit ?? 0) - 4 * BALANCE.instruments.net.wearPerSwing);
    expect(instruments.state.schwaerme).toEqual([expect.objectContaining({ gefangen: 3 })]);
    // Away from the swarm (the aimed tile at the net's reach, opposite the swarm), in the grass at night: crickets now and
    // then (the saved swing counter draws).
    const crickets: (string | null)[] = [];
    const p = k.pos();
    for (let i = 0; i < 12; i++) {
      const stack = k.inventory.selected();
      if (stack === null) break;
      net?.use(k.sim, { slot: HOTBAR, stack, def, target: { layer: 0, tx: Math.floor(p.x / 16) - BALANCE.instruments.net.reachTiles, ty: Math.floor(p.y / 16) }, tick: k.sim.tick, named: false, primary: false });
      crickets.push(((k.run(1).get('netSwung') as Array<{ fang: string | null }>)[0] as { fang: string | null }).fang);
    }
    expect(crickets.filter((c) => c === 'grille').length).toBeGreaterThan(0);
    expect(crickets.every((c) => c === null || c === 'grille')).toBe(true);
    expect(k.inventory.count('grille')).toBe(crickets.filter((c) => c === 'grille').length);
  });
});
