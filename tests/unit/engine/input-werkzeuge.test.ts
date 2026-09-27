/**
 * The build mode's tool actions (src/engine/input/actions.ts, bindings.ts; MASTERPROMPT §16.6, §26 "Alles
 * umbelegbar", "Controller: vollständige Navigation"; Review M4 #1): Setzen, Abbauen, Aufwerten, Reparieren on the
 * digit keys 1–4 and the next tool on the pad's LB – only in the build context: while playing the same digits choose
 * the hotbar slot and LB turns the hotbar back, nothing conflicts; they are rebindable and have a name in both languages.
 */
import { describe, expect, it } from 'vitest';
import { CommandQueue } from '../../../src/engine/commands';
import { ACTION_INFO, actionLabelKey, actionsInCategory, type Action } from '../../../src/engine/input/actions';
import { BindingSet, DEFAULT_BINDINGS, key, PAD, padButton } from '../../../src/engine/input/bindings';
import { ActionReader } from '../../../src/engine/input/reader';
import { InputState } from '../../../src/engine/input/state';
import type { GameCommand } from '../../../src/game/commands';
import { InputCommandTranslator } from '../../../src/game/input';
import { createI18n } from '../../../src/i18n';

const WERKZEUGE: ReadonlyArray<readonly [Action, string]> = [
  ['toolPlace', 'Digit1'],
  ['toolDismantle', 'Digit2'],
  ['toolUpgrade', 'Digit3'],
  ['toolRepair', 'Digit4'],
];

function kette() {
  const state = new InputState();
  const reader = new ActionReader(state, new BindingSet());
  const translator = new InputCommandTranslator();
  const queue = new CommandQueue<GameCommand>();
  const frame = (): { commands: GameCommand[]; pressed: (a: Action) => boolean } => {
    reader.update();
    translator.translate(reader, queue, 'player');
    const beobachtet: Action[] = [...WERKZEUGE.map(([a]) => a), 'toolNext', 'hotbar1', 'hotbar4', 'hotbarPrev'];
    const seen = new Set<Action>(beobachtet.filter((a) => reader.wasPressed(a)));
    state.endFrame();
    const commands: GameCommand[] = [];
    queue.drainForTick(0, (cmd) => commands.push(cmd));
    return { commands, pressed: (a) => seen.has(a) };
  };
  return { state, reader, frame };
}

/** A standard-mapping pad with the buttons `down` held. */
function pad(...down: number[]) {
  return { id: 'pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 })) };
}

describe('Werkzeuge des Baumodus in der Belegung', () => {
  it('1–4 und LB, nur im Baukontext, in der Kategorie Bauen; keine Überschneidung in der Standardbelegung', () => {
    for (const [a, code] of WERKZEUGE) {
      expect(DEFAULT_BINDINGS[a], a).toEqual([key(code)]);
      expect(ACTION_INFO[a].contexts, a).toEqual(['build']);
      expect(ACTION_INFO[a].category, a).toBe('building');
    }
    expect(DEFAULT_BINDINGS.toolNext).toEqual([padButton(PAD.LB)]);
    expect(ACTION_INFO.toolNext.contexts).toEqual(['build']);
    expect(actionsInCategory('building')).toEqual(expect.arrayContaining(['toolPlace', 'toolDismantle', 'toolUpgrade', 'toolRepair', 'toolNext']));
    expect(new BindingSet().allConflicts()).toEqual([]);
    // Plain Z and Y stay free in the build context (Ctrl+Z is undo; a plain key would fire with the chord too).
    const set = new BindingSet();
    for (const [a] of WERKZEUGE) expect(set.findConflicts(a, key('KeyZ'))).toEqual([]);
  });

  it('im Baumodus wählen 1–4 das Werkzeug und keine Hand; beim Spielen wählen sie den Platz der Schnellleiste', () => {
    const { state, reader, frame } = kette();
    reader.setContext('build');
    for (const [a, code] of WERKZEUGE) {
      state.keyDown(code);
      const f = frame();
      expect(f.pressed(a), a).toBe(true);
      expect(f.commands.some((c) => c.type === 'player.selectHotbar'), a).toBe(false);
      state.keyUp(code);
      frame();
    }
    reader.setContext('play');
    state.keyDown('Digit4');
    const f = frame();
    expect(f.pressed('toolRepair')).toBe(false);
    expect(f.pressed('hotbar4')).toBe(true);
    expect(f.commands).toContainEqual({ type: 'player.selectHotbar', index: 3 });
  });

  it('LB schaltet im Baumodus das Werkzeug weiter, beim Spielen blättert es die Schnellleiste zurück', () => {
    const { state, reader, frame } = kette();
    reader.setContext('build');
    state.applyGamepad(pad(PAD.LB));
    let f = frame();
    expect(f.pressed('toolNext')).toBe(true);
    expect(f.pressed('hotbarPrev')).toBe(false);
    expect(f.commands.some((c) => c.type === 'player.scrollHotbar')).toBe(false);
    state.applyGamepad(pad());
    frame();
    reader.setContext('play');
    state.applyGamepad(pad(PAD.LB));
    f = frame();
    expect(f.pressed('toolNext')).toBe(false);
    expect(f.pressed('hotbarPrev')).toBe(true);
  });

  it('umbelegbar wie jede Aktion; jede hat einen Namen auf Deutsch und Englisch', () => {
    const set = new BindingSet();
    // X is free in the build context: the dismantle tool takes it without a conflict.
    expect(set.rebind('toolDismantle', key('KeyX'), { replace: key('Digit2') }).ok).toBe(true);
    expect(set.get('toolDismantle')).toEqual([key('KeyX')]);
    expect(BindingSet.deserialize(set.serialize()).get('toolDismantle')).toEqual([key('KeyX')]);
    // The mirror key is taken in the build context: refused.
    expect(set.rebind('toolRepair', key('KeyF')).conflicts.map((c) => c.other)).toContain('mirror');
    const de = createI18n('de', { strict: true });
    const en = createI18n('en', { strict: true });
    for (const a of [...WERKZEUGE.map(([x]) => x), 'toolNext'] as Action[]) {
      expect(de.t(actionLabelKey(a)).length, a).toBeGreaterThan(0);
      expect(en.t(actionLabelKey(a)).length, a).toBeGreaterThan(0);
    }
  });
});
