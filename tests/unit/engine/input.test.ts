import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_INFO, HOTBAR_ACTIONS, actionsInCategory, isAction, sharedContexts, ACTION_CATEGORIES } from '../../../src/engine/input/actions';
import {
  BindingSet,
  DEFAULT_BINDINGS,
  PAD,
  bindingLabel,
  bindingSchema,
  bindingsEqual,
  createDefaultBindings,
  key,
  mouse,
  padAxis,
  padButton,
  sanitizeSerializedBindings,
  unboundActions,
  wheel,
} from '../../../src/engine/input/bindings';
import { createKeyFilter, attachDomInput, isEditableTarget, type DomEventSource } from '../../../src/engine/input/dom';
import { pollGamepads, vibrate, vibrateActive, type GamepadGetter } from '../../../src/engine/input/gamepad';
import { ActionReader, detectGamepadFamily } from '../../../src/engine/input/reader';
import {
  InputState,
  applyAxialDeadzone,
  applyRadialDeadzone,
  WHEEL_DELTA_LINE,
  type GamepadLike,
} from '../../../src/engine/input/state';

function fakePad(overrides: Partial<{ id: string; index: number; axes: number[]; pressed: number[]; values: Record<number, number> }> = {}): GamepadLike {
  const pressed = new Set(overrides.pressed ?? []);
  const values = overrides.values ?? {};
  return {
    id: overrides.id ?? 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
    index: overrides.index ?? 0,
    connected: true,
    mapping: 'standard',
    axes: overrides.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.has(i), value: values[i] ?? (pressed.has(i) ? 1 : 0) })),
  };
}

function setup(): { state: InputState; bindings: BindingSet; reader: ActionReader } {
  const state = new InputState();
  const bindings = new BindingSet();
  const reader = new ActionReader(state, bindings);
  return { state, bindings, reader };
}

describe('actions', () => {
  it('has metadata, category and at least one context for every action', () => {
    for (const a of ACTIONS) {
      expect(ACTION_INFO[a].contexts.length).toBeGreaterThan(0);
      expect(ACTION_CATEGORIES).toContain(ACTION_INFO[a].category);
    }
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length);
    expect(HOTBAR_ACTIONS).toHaveLength(10);
    expect(actionsInCategory('hotbar')).toContain('hotbarNext');
    expect(isAction('interact')).toBe(true);
    expect(isAction('fly')).toBe(false);
  });

  it('models F as light in play and mirror in build', () => {
    expect(sharedContexts('toggleLight', 'mirror')).toEqual([]);
    expect(sharedContexts('interact', 'moveUp')).toEqual(['play', 'build']);
  });
});

describe('bindings', () => {
  it('default bindings contain every action with at least one binding', () => {
    for (const a of ACTIONS) expect(DEFAULT_BINDINGS[a].length, a).toBeGreaterThan(0);
    expect(unboundActions(new BindingSet())).toEqual([]);
  });

  it('defaults follow §26 (WASD, Space roll, Shift sprint, Tab/I inventory, 1–0 hotbar …)', () => {
    const d = DEFAULT_BINDINGS;
    expect(d.moveUp).toContainEqual(key('KeyW'));
    expect(d.roll).toContainEqual(key('Space'));
    expect(d.sprint).toContainEqual(key('ShiftLeft'));
    expect(d.sneak).toContainEqual(key('ControlLeft'));
    expect(d.inventory).toEqual(expect.arrayContaining([key('Tab'), key('KeyI')]));
    expect(d.hotbar1).toEqual([key('Digit1')]);
    expect(d.hotbar10).toEqual([key('Digit0')]);
    expect(d.attack).toContainEqual(mouse(0));
    expect(d.block).toContainEqual(mouse(2));
    expect(d.pipette).toContainEqual(mouse(1));
    expect(d.hotbarNext).toContainEqual(wheel(1));
    expect(d.debugConsole).toEqual(expect.arrayContaining([key('Backquote'), key('IntlBackslash')]));
    expect(d.debugOverlay).toEqual([key('F3')]);
    expect(d.screenshotMode).toEqual([key('F10')]);
    // Gamepad standard mapping
    expect(d.attack).toContainEqual(padButton(PAD.RT));
    expect(d.block).toContainEqual(padButton(PAD.LT));
    expect(d.interact).toContainEqual(padButton(PAD.A));
    expect(d.uiConfirm).toContainEqual(padButton(PAD.A));
    expect(d.roll).toContainEqual(padButton(PAD.B));
    expect(d.uiBack).toContainEqual(padButton(PAD.B));
    expect(d.pause).toContainEqual(padButton(PAD.START));
    expect(d.map).toContainEqual(padButton(PAD.SELECT));
    expect(d.moveLeft).toContainEqual(padAxis(0, -1));
    expect(d.aimDown).toContainEqual(padAxis(3, 1));
  });

  it('default table has no conflicts in overlapping contexts', () => {
    expect(new BindingSet().allConflicts()).toEqual([]);
  });

  it('binds undo to the key labelled Z on the given layout', () => {
    const qwertz = new Map([
      ['KeyY', 'z'],
      ['KeyZ', 'y'],
    ]);
    expect(createDefaultBindings({ layout: qwertz }).undo).toContainEqual(key('KeyY', { ctrl: true }));
    expect(createDefaultBindings({ layout: qwertz }).undo).not.toContainEqual(key('KeyZ', { ctrl: true }));
    expect(DEFAULT_BINDINGS.undo).toEqual(expect.arrayContaining([key('KeyZ', { ctrl: true }), key('KeyY', { ctrl: true })]));
  });

  it('detects conflicts only in shared contexts', () => {
    const set = new BindingSet();
    // KeyF is toggleLight (play) and mirror (build): binding it to interact (play+build) conflicts with both.
    const conflicts = set.findConflicts('interact', key('KeyF'));
    expect(conflicts.map((c) => c.other).sort()).toEqual(['mirror', 'toggleLight']);
    // Space is roll (play) and uiConfirm (ui); rotate is build-only → no conflict.
    expect(set.findConflicts('rotate', key('Space'))).toEqual([]);
    // Chord and plain key are different bindings.
    expect(set.findConflicts('rotate', key('KeyZ'))).toEqual([]);
  });

  it('rebinding: reject, unbindOther and swap policies', () => {
    const set = new BindingSet();
    const rejected = set.rebind('belt', key('KeyE'), { replace: key('KeyQ') });
    expect(rejected.ok).toBe(false);
    expect(rejected.conflicts[0]?.other).toBe('interact');
    expect(set.get('belt')).toContainEqual(key('KeyQ'));

    const swapped = set.rebind('belt', key('KeyE'), { replace: key('KeyQ'), policy: 'swap' });
    expect(swapped.ok).toBe(true);
    expect(set.get('belt')).toContainEqual(key('KeyE'));
    expect(set.get('belt')).not.toContainEqual(key('KeyQ'));
    expect(set.get('interact')).toContainEqual(key('KeyQ'));
    expect(set.get('interact')).not.toContainEqual(key('KeyE'));

    const stolen = set.rebind('roll', key('KeyG'));
    expect(stolen.ok).toBe(true);
    const r = set.rebind('crafting', key('KeyG'), { policy: 'unbindOther' });
    expect(r.ok).toBe(true);
    expect(set.get('roll')).not.toContainEqual(key('KeyG'));
    expect(set.get('crafting')).toContainEqual(key('KeyG'));
    expect(set.allConflicts()).toEqual([]);
  });

  it('unbind, reset, isDefault and revision tracking', () => {
    const set = new BindingSet();
    const rev = set.revision;
    expect(set.unbind('roll', key('Space'))).toBe(true);
    expect(set.unbind('roll', key('Space'))).toBe(false);
    expect(set.revision).toBeGreaterThan(rev);
    expect(set.isDefault('roll')).toBe(false);
    set.reset('roll');
    expect(set.isDefault('roll')).toBe(true);
    set.set('map', [key('KeyN'), key('KeyN')]);
    expect(set.get('map')).toEqual([key('KeyN')]);
    set.reset();
    expect(set.isDefault('map')).toBe(true);
    expect(set.actionsFor(key('KeyE')).sort()).toEqual(['interact', 'uiTabNext']);
    expect(set.primary('interact', 'gamepad')).toEqual(padButton(PAD.A));
    expect(set.keyboardCodes().has('KeyW')).toBe(true);
  });

  it('serialization roundtrip stores only overrides and validates input', () => {
    const set = new BindingSet();
    set.rebind('roll', key('KeyV'), { replace: key('Space') });
    set.set('settlers', []);
    const data = set.serialize();
    expect(Object.keys(data).sort()).toEqual(['roll', 'settlers']);
    const json = JSON.parse(JSON.stringify(data)) as unknown;
    const restored = BindingSet.deserialize(json);
    expect(restored.snapshot()).toEqual(set.snapshot());
    expect(restored.serialize()).toEqual(data);

    const dirty = {
      roll: [{ kind: 'key', code: 'KeyV' }, { kind: 'laser', code: 1 }, { kind: 'mouse', button: -1 }],
      notAnAction: [{ kind: 'key', code: 'KeyA' }],
      map: 'KeyM',
    };
    const clean = sanitizeSerializedBindings(dirty);
    expect(clean).toEqual({ roll: [key('KeyV')] });
    expect(BindingSet.deserialize(null).serialize()).toEqual({});
    expect(bindingSchema.safeParse({ kind: 'padAxis', index: 1, dir: 2 }).success).toBe(false);
  });

  it('produces label parts for prompts per device family', () => {
    expect(bindingLabel(key('KeyE'))).toEqual([{ text: 'E' }]);
    expect(bindingLabel(key('KeyY', { ctrl: true }), 'generic', new Map([['KeyY', 'z']]))).toEqual([{ i18n: 'input.key.ctrl' }, { text: 'Z' }]);
    expect(bindingLabel(key('Space'))).toEqual([{ i18n: 'input.key.Space' }]);
    expect(bindingLabel(mouse(2))).toEqual([{ i18n: 'input.mouse.right' }]);
    expect(bindingLabel(wheel(-1))).toEqual([{ i18n: 'input.wheel.up' }]);
    expect(bindingLabel(padButton(PAD.A), 'xbox')).toEqual([{ text: 'A' }]);
    expect(bindingLabel(padButton(PAD.A), 'playstation')).toEqual([{ i18n: 'input.pad.ps.cross' }]);
    expect(bindingLabel(padButton(PAD.A), 'generic')).toEqual([{ i18n: 'input.pad.generic.faceDown' }]);
    expect(bindingLabel(padButton(PAD.DPAD_UP), 'xbox')).toEqual([{ i18n: 'input.pad.dpadUp' }]);
    expect(bindingLabel(padAxis(1, -1))).toEqual([{ i18n: 'input.pad.leftStickUp' }]);
    expect(bindingsEqual(key('KeyA', {}), { kind: 'key', code: 'KeyA', ctrl: false })).toBe(true);
  });
});

describe('InputState', () => {
  it('tracks key edges across frames and ignores auto-repeat', () => {
    const s = new InputState();
    s.keyDown('KeyW');
    expect(s.keysPressed.has('KeyW')).toBe(true);
    s.endFrame();
    s.keyDown('KeyW', true);
    expect(s.keysPressed.has('KeyW')).toBe(false);
    expect(s.keysDown.has('KeyW')).toBe(true);
    s.keyUp('KeyW');
    expect(s.keysReleased.has('KeyW')).toBe(true);
    s.endFrame();
    expect(s.keysReleased.size).toBe(0);
  });

  it('accumulates wheel notches across pixel and line modes', () => {
    const s = new InputState();
    s.wheel(40);
    s.wheel(40);
    expect(s.wheelDown).toBe(0);
    s.wheel(40);
    expect(s.wheelDown).toBe(1);
    s.endFrame();
    s.wheel(-6, WHEEL_DELTA_LINE);
    expect(s.wheelUp).toBe(2);
  });

  it('releaseAll produces release edges (window blur)', () => {
    const s = new InputState();
    s.keyDown('KeyA');
    s.mouseButtonDown(0);
    s.setTouchButton('interact', true);
    s.endFrame();
    s.releaseAll();
    expect(s.keysReleased.has('KeyA')).toBe(true);
    expect(s.mouseReleased.has(0)).toBe(true);
    expect(s.touchButtonsReleased.has('interact')).toBe(true);
    expect(s.keysDown.size + s.mouseDown.size + s.touchButtonsDown.size).toBe(0);
  });

  it('maps mouse position to internal pixels via the renderer mapper', () => {
    const s = new InputState();
    s.mouseMove(300, 150);
    expect(s.mouse.x).toBe(300);
    s.setMouseMapper((x, y, out) => {
      out.x = x / 4;
      out.y = y / 4;
    });
    expect(s.mouse.x).toBe(75);
    expect(s.mouse.y).toBe(37.5);
    s.mouseMove(400, 200);
    expect(s.mouse.x).toBe(100);
    expect(s.mouse.dx).toBe(400); // accumulated over the frame: 0→300→400
    s.endFrame();
    expect(s.mouse.dx).toBe(0);
  });
});

describe('deadzones', () => {
  it('radial deadzone zeroes small input and rescales the rest', () => {
    expect(applyRadialDeadzone(0.1, 0.1, 0.2)).toEqual({ x: 0, y: 0 });
    const full = applyRadialDeadzone(1, 0, 0.2);
    expect(full.x).toBeCloseTo(1);
    const mid = applyRadialDeadzone(0.6, 0, 0.2);
    expect(mid.x).toBeCloseTo(0.5);
    const diag = applyRadialDeadzone(0.8, 0.8, 0.2);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1);
    expect(diag.x).toBeCloseTo(diag.y);
    expect(applyRadialDeadzone(Number.NaN, 0, 0.2)).toEqual({ x: 0, y: 0 });
  });

  it('axial deadzone keeps the sign', () => {
    expect(applyAxialDeadzone(0.1, 0.2)).toBe(0);
    expect(applyAxialDeadzone(-0.6, 0.2)).toBeCloseTo(-0.5);
  });

  it('configurable deadzone applies to polled sticks', () => {
    const s = new InputState();
    s.setDeadzone(0.5);
    s.applyGamepad(fakePad({ axes: [0.4, 0, 0, 0] }));
    expect(s.pad.axes[0]).toBe(0);
    s.setDeadzone(0.1);
    s.applyGamepad(fakePad({ axes: [0.4, 0, 0, 0] }));
    expect(s.pad.axes[0]).toBeCloseTo(0.3 / 0.9);
    s.setDeadzone(5);
    expect(s.deadzone).toBe(0.9);
  });
});

describe('ActionReader', () => {
  it('reports pressed only on the first frame and released on key up', () => {
    const { state, reader } = setup();
    state.keyDown('KeyE');
    reader.update();
    expect(reader.wasPressed('interact')).toBe(true);
    expect(reader.isDown('interact')).toBe(true);
    state.endFrame();
    reader.update();
    expect(reader.wasPressed('interact')).toBe(false);
    expect(reader.isDown('interact')).toBe(true);
    state.endFrame();
    state.keyUp('KeyE');
    reader.update();
    expect(reader.wasReleased('interact')).toBe(true);
    expect(reader.isDown('interact')).toBe(false);
  });

  it('sees a tap that started and ended between two frames', () => {
    const { state, reader } = setup();
    state.keyDown('Space');
    state.keyUp('Space');
    reader.update();
    expect(reader.wasPressed('roll')).toBe(true);
    expect(reader.wasReleased('roll')).toBe(true);
    expect(reader.isDown('roll')).toBe(false);
  });

  it('is not released while another binding still holds the action', () => {
    const { state, reader } = setup();
    state.keyDown('KeyW');
    state.keyDown('ArrowUp');
    reader.update();
    state.endFrame();
    state.keyUp('KeyW');
    reader.update();
    expect(reader.wasReleased('moveUp')).toBe(false);
    expect(reader.isDown('moveUp')).toBe(true);
  });

  it('respects contexts: F = light in play, mirror in build', () => {
    const { state, reader } = setup();
    state.keyDown('KeyF');
    reader.update();
    expect(reader.wasPressed('toggleLight')).toBe(true);
    expect(reader.wasPressed('mirror')).toBe(false);
    state.endFrame();
    state.keyUp('KeyF');
    reader.update();
    state.endFrame();
    reader.setContext('build');
    state.keyDown('KeyF');
    reader.update();
    expect(reader.wasPressed('mirror')).toBe(true);
    expect(reader.wasPressed('toggleLight')).toBe(false);
    expect(reader.wasPressedAnyContext('toggleLight')).toBe(true);
  });

  it('requires chord modifiers (Ctrl+Z undo in build mode)', () => {
    const { state, reader } = setup();
    reader.setContext('build');
    state.keyDown('KeyZ');
    reader.update();
    expect(reader.wasPressed('undo')).toBe(false);
    state.endFrame();
    state.keyUp('KeyZ');
    state.keyDown('ControlLeft');
    state.keyDown('KeyZ');
    reader.update();
    expect(reader.wasPressed('undo')).toBe(true);
  });

  it('normalizes the keyboard move vector and keeps analog stick magnitude', () => {
    const { state, reader } = setup();
    state.keyDown('KeyW');
    state.keyDown('KeyD');
    reader.update();
    const v = reader.moveVector();
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(Math.SQRT1_2);
    expect(v.y).toBeCloseTo(-Math.SQRT1_2);

    const pad = setup();
    pad.state.setDeadzone(0);
    pad.state.applyGamepad(fakePad({ axes: [0.5, 0, 0, 0] }));
    pad.reader.update();
    const p = pad.reader.moveVector();
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBe(0);

    const both = setup();
    both.state.keyDown('KeyD');
    both.state.setTouchStick('move', 0, 1);
    both.reader.update();
    const b = both.reader.moveVector();
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(1);
  });

  it('move vector is zero in UI context', () => {
    const { state, reader } = setup();
    reader.setContext('ui');
    state.keyDown('KeyW');
    reader.update();
    expect(reader.moveVector()).toEqual({ x: 0, y: 0 });
    expect(reader.wasPressed('uiUp')).toBe(true);
  });

  it('hold vs toggle for sprint', () => {
    const { state, reader } = setup();
    state.keyDown('ShiftLeft');
    reader.update();
    expect(reader.isDown('sprint')).toBe(true);
    state.endFrame();
    state.keyUp('ShiftLeft');
    reader.update();
    expect(reader.isDown('sprint')).toBe(false);
    state.endFrame();

    reader.setMode('sprint', 'toggle');
    expect(reader.mode('sprint')).toBe('toggle');
    state.keyDown('ShiftLeft');
    reader.update();
    expect(reader.isDown('sprint')).toBe(true);
    expect(reader.wasPressed('sprint')).toBe(true);
    state.endFrame();
    state.keyUp('ShiftLeft');
    reader.update();
    expect(reader.isDown('sprint')).toBe(true);
    expect(reader.wasReleased('sprint')).toBe(false);
    state.endFrame();
    state.keyDown('ShiftLeft');
    reader.update();
    expect(reader.isDown('sprint')).toBe(false);
    expect(reader.wasReleased('sprint')).toBe(true);
  });

  it('toggle latch is cleared when the context no longer allows the action', () => {
    const state = new InputState();
    const reader = new ActionReader(state, new BindingSet(), { modes: { sneak: 'toggle' } });
    state.keyDown('ControlLeft');
    reader.update();
    expect(reader.isDown('sneak')).toBe(true);
    reader.setContext('ui');
    reader.setContext('play');
    state.endFrame();
    reader.update();
    expect(reader.isDown('sneak')).toBe(false);
  });

  it('gamepad buttons and stick edges', () => {
    const { state, reader } = setup();
    state.applyGamepad(fakePad({ pressed: [PAD.A] }));
    reader.update();
    expect(reader.wasPressed('interact')).toBe(true);
    expect(reader.lastDevice).toBe('gamepad');
    expect(reader.gamepadFamily).toBe('xbox');
    state.endFrame();
    reader.setContext('ui');
    state.applyGamepad(fakePad({ axes: [0, 0.9, 0, 0] }));
    reader.update();
    expect(reader.wasPressed('uiDown')).toBe(true);
    expect(reader.wasReleased('uiConfirm')).toBe(true);
    state.endFrame();
    state.applyGamepad(fakePad({ axes: [0, 0.9, 0, 0] }));
    reader.update();
    expect(reader.wasPressed('uiDown')).toBe(false);
    expect(reader.isDown('uiDown')).toBe(true);
    state.endFrame();
    state.applyGamepad(fakePad({ axes: [0, 0, 0, 0] }));
    reader.update();
    expect(reader.wasReleased('uiDown')).toBe(true);
  });

  it('analog trigger value and wheel press counts', () => {
    const { state, reader } = setup();
    state.applyGamepad(fakePad({ values: { [PAD.RT]: 0.75 } }));
    reader.update();
    expect(reader.isDown('attack')).toBe(true);
    expect(reader.value('attack')).toBeCloseTo(0.75);
    state.endFrame();
    state.wheel(300);
    reader.update();
    expect(reader.pressCount('hotbarNext')).toBe(3);
    expect(reader.isDown('hotbarNext')).toBe(false);
  });

  it('aims at the mouse, the right stick, or along movement', () => {
    const { state, reader } = setup();
    state.mouseMove(110, 50);
    reader.update();
    const a = reader.aimVector(100, 50);
    expect(a.x).toBeCloseTo(1);
    expect(a.y).toBeCloseTo(0);

    state.applyGamepad(fakePad({ axes: [0, 0, 0, -1] }));
    reader.update();
    const b = reader.aimVector(100, 50);
    expect(b.y).toBeCloseTo(-1);

    state.applyGamepad(fakePad({ axes: [-1, 0, 0, 0] }));
    reader.update();
    const c = reader.aimVector(100, 50);
    expect(c.x).toBeCloseTo(-1);

    state.applyGamepad(fakePad());
    reader.update();
    const d = reader.aimVector(100, 50);
    expect(d.x).toBeCloseTo(-1);

    reader.setSensitivity(2, 2);
    state.applyGamepad(fakePad({ axes: [0, 0, 1, 0] }));
    reader.update();
    expect(reader.aimStick().x).toBeCloseTo(2);
  });

  it('touch buttons and touch sticks drive actions', () => {
    const { state, reader } = setup();
    state.setTouchButton('roll', true);
    state.setTouchStick('move', -2, 0);
    reader.update();
    expect(reader.wasPressed('roll')).toBe(true);
    expect(reader.value('moveLeft')).toBeCloseTo(1);
    expect(reader.lastDevice).toBe('touch');
  });

  it('prompt binding follows the last device', () => {
    const { state, reader } = setup();
    expect(reader.promptBinding('interact')).toEqual(key('KeyE'));
    state.applyGamepad(fakePad({ pressed: [PAD.B] }));
    expect(reader.promptBinding('interact')).toEqual(padButton(PAD.A));
    state.mouseMove(50, 50);
    state.mouseMove(60, 60);
    expect(reader.lastDevice).toBe('keyboard');
  });

  it('detects gamepad families from id strings', () => {
    expect(detectGamepadFamily('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(detectGamepadFamily('054c-09cc-Wireless Controller')).toBe('playstation');
    expect(detectGamepadFamily('DualSense Wireless Controller')).toBe('playstation');
    expect(detectGamepadFamily('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(detectGamepadFamily('045e-02fd-Microsoft X-Box One S pad')).toBe('xbox');
    expect(detectGamepadFamily('8BitDo Pro 2 (Vendor: 2dc8 Product: 6006)')).toBe('generic');
  });
});

describe('gamepad polling', () => {
  it('picks a connected pad, hands over on button press, releases on disconnect', () => {
    const s = new InputState();
    const a = fakePad({ index: 0, id: 'pad A' });
    const b = fakePad({ index: 1, id: 'pad B' });
    let list: (GamepadLike | null)[] = [null, a, b];
    const getter: GamepadGetter = () => list;
    expect(pollGamepads(s, getter)?.id).toBe('pad A');
    list = [a, fakePad({ index: 1, id: 'pad B', pressed: [PAD.X] })];
    expect(pollGamepads(s, getter)?.id).toBe('pad B');
    expect(s.pad.buttonsDown.has(PAD.X)).toBe(true);
    s.endFrame();
    list = [];
    expect(pollGamepads(s, getter)).toBeNull();
    expect(s.pad.connected).toBe(false);
    expect(s.pad.buttonsReleased.has(PAD.X)).toBe(true);
    expect(pollGamepads(s, () => {
      throw new Error('blocked');
    })).toBeNull();
  });

  it('keeps the active pad, prefers standard mapping and skips disconnected slots', () => {
    const s = new InputState();
    const raw = { ...fakePad({ index: 0, id: 'raw HID pad' }), mapping: '' };
    const std = fakePad({ index: 1, id: 'standard pad' });
    const gone = { ...fakePad({ index: 2, id: 'unplugged', pressed: [PAD.A] }), connected: false };
    let list: (GamepadLike | null)[] = [raw, null, gone, std];
    const getter: GamepadGetter = () => list;
    // No active pad yet: the first pad with the standard mapping wins; a disconnected pad never takes over.
    expect(pollGamepads(s, getter)?.id).toBe('standard pad');
    // The active pad stays active while it is connected, even if it moves in the list.
    list = [std, raw];
    expect(pollGamepads(s, getter)?.id).toBe('standard pad');
    // Without any standard pad the first connected one is used.
    list = [null, raw];
    expect(pollGamepads(s, getter)?.id).toBe('raw HID pad');
  });

  it('vibration respects the setting and clamps values', () => {
    const calls: Array<{ duration: number; strongMagnitude: number }> = [];
    const pad: GamepadLike = {
      ...fakePad(),
      vibrationActuator: {
        playEffect: (_t, p) => {
          calls.push(p);
          return Promise.resolve('complete');
        },
      },
    };
    expect(vibrate(pad, { durationMs: 100, strong: 2, weak: 0.2 }, false)).toBe(false);
    expect(vibrate(pad, { durationMs: 100_000, strong: 2, weak: 0.2 }, true)).toBe(true);
    expect(calls[0]).toMatchObject({ duration: 5000, strongMagnitude: 1 });
    expect(vibrate(fakePad(), { durationMs: 100, strong: 1, weak: 1 }, true)).toBe(false);
    const s = new InputState();
    s.applyGamepad(pad);
    expect(vibrateActive(s, () => [pad], { durationMs: 50, strong: 0.5, weak: 0.5 }, true)).toBe(true);
  });
});

describe('DOM adapter (fake targets)', () => {
  class FakeTarget implements DomEventSource {
    readonly listeners = new Map<string, Set<(e: Event) => void>>();
    style = { touchAction: 'auto' };
    addEventListener(type: string, l: (e: Event) => void): void {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)?.add(l);
    }
    removeEventListener(type: string, l: (e: Event) => void): void {
      this.listeners.get(type)?.delete(l);
    }
    getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
      return { left: 10, top: 20, width: 400, height: 300 };
    }
    fire(type: string, props: Record<string, unknown>): { prevented: boolean } {
      const ev = { prevented: false, preventDefault(): void {
        this.prevented = true;
      }, target: null, ...props };
      for (const l of this.listeners.get(type) ?? []) l(ev as unknown as Event);
      return ev;
    }
    count(): number {
      let n = 0;
      for (const s of this.listeners.values()) n += s.size;
      return n;
    }
  }

  it('feeds keys, mouse, wheel and touch into the state and detaches cleanly', () => {
    const canvas = new FakeTarget();
    const win = new FakeTarget();
    const s = new InputState();
    const detach = attachDomInput(canvas, s, { windowTarget: win });
    expect(canvas.style.touchAction).toBe('none');

    expect(win.fire('keydown', { code: 'Space', repeat: false, ctrlKey: false, metaKey: false }).prevented).toBe(true);
    expect(s.keysDown.has('Space')).toBe(true);
    // Ctrl+R (reload) keeps its browser default.
    expect(win.fire('keydown', { code: 'KeyR', repeat: false, ctrlKey: true, metaKey: false }).prevented).toBe(false);
    // Typing into a text field does not reach the game.
    win.fire('keydown', { code: 'KeyW', repeat: false, ctrlKey: false, metaKey: false, target: { tagName: 'INPUT' } });
    expect(s.keysDown.has('KeyW')).toBe(false);
    win.fire('keyup', { code: 'Space', ctrlKey: false, metaKey: false });
    expect(s.keysReleased.has('Space')).toBe(true);

    win.fire('mousemove', { clientX: 110, clientY: 70 });
    expect(s.mouse.cssX).toBe(100);
    expect(s.mouse.cssY).toBe(50);
    expect(s.mouse.inside).toBe(true);
    expect(canvas.fire('mousedown', { clientX: 110, clientY: 70, button: 2 }).prevented).toBe(true);
    expect(s.mouseDown.has(2)).toBe(true);
    win.fire('mouseup', { button: 2 });
    expect(s.mouseDown.has(2)).toBe(false);
    expect(canvas.fire('wheel', { deltaY: 100, deltaMode: 0 }).prevented).toBe(true);
    expect(s.wheelDown).toBe(1);
    expect(canvas.fire('contextmenu', {}).prevented).toBe(true);

    canvas.fire('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 60, clientY: 220 });
    canvas.fire('pointermove', { pointerId: 7, pointerType: 'touch', clientX: 60 + 28, clientY: 220 });
    expect(s.touchSticks.move.x).toBeCloseTo(0.5);
    expect(s.lastDevice).toBe('touch');
    canvas.fire('pointerup', { pointerId: 7, pointerType: 'touch' });
    expect(s.touchSticks.move.x).toBe(0);

    win.fire('keydown', { code: 'KeyA', repeat: false, ctrlKey: false, metaKey: false });
    win.fire('blur', {});
    expect(s.keysDown.size).toBe(0);

    detach();
    expect(canvas.count() + win.count()).toBe(0);
    expect(canvas.style.touchAction).toBe('auto');
  });

  it('key filter follows rebinding', () => {
    const set = new BindingSet();
    const filter = createKeyFilter(set);
    expect(filter('KeyP', false)).toBe(false);
    set.rebind('map', key('KeyP'));
    expect(filter('KeyP', false)).toBe(true);
    expect(filter('KeyZ', true)).toBe(true);
    expect(filter('KeyW', true)).toBe(false);
    expect(isEditableTarget({ isContentEditable: true })).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
  });
});
