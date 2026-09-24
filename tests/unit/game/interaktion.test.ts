/**
 * M3-10 Interaktion (MASTERPROMPT §11.4 "Interagieren (E)", "Aufheben: … sonst E; volle Taschen → klarer
 * Hinweis", §4.6 "Interagierbares unter Cursor oder in Reichweite", §26 "[E] Aufheben: Feuerstein ×3"):
 * the focus is the workable target in reach (the aimed tile first, targets in front half a tile closer,
 * blocked ones last); holding E works it – a drop is picked up at once, plants by hand, trees, rocks and
 * ground with the tool in the hand – and refuses with a reason when it cannot; the hint describes the
 * focus in both languages. The input acts in the tick after the frame.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { createI18n } from '../../../src/i18n/index';
import { parseGameCommand } from '../../../src/game/commands';
import { newStack } from '../../../src/game/items/stack';
import { actionProgress, distanceToRect, facingToward, hitDue, REACH_PX, targetScore } from '../../../src/game/interaction/formulas';
import { hintText, interactionHint } from '../../../src/game/interaction/hint';
import { InteractionInput } from '../../../src/game/interaction/input';
import { createPlayerModifiers } from '../../../src/game/survival/modifiers';
import { TILE_PX } from '../../../src/world/model/coords';
import { centre, field, gatherCatalog, gatherWorld, type GatherWorld } from './interaktion-testwelt';

const TICK_HZ = BALANCE.time.tickHz;
const catalog = gatherCatalog();
const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });

function hintOf(w: GatherWorld, lang: 'de' | 'en'): string {
  const hint = interactionHint(w.interaction.focus);
  if (hint === null) return '';
  const i18n = lang === 'de' ? de : en;
  return hintText(hint, lang, (key, params) => i18n.t(key, params));
}

describe('Formeln', () => {
  it('reach, distance to a footprint, score, facing, hit rhythm and ring progress', () => {
    expect(REACH_PX).toBe(1.5 * TILE_PX);
    expect(distanceToRect(5, 5, 0, 0, 10, 10)).toBe(0);
    expect(distanceToRect(13, 14, 0, 0, 10, 10)).toBe(5);
    // In front counts half a tile closer; behind or beside not; blocked targets come last.
    expect(targetScore(16, 0, 1, 0, 16)).toBe(16 - 0.5 * TILE_PX);
    expect(targetScore(16, 0, 1, 0, -16)).toBe(16);
    expect(targetScore(16, 0, 1, 16, 0)).toBe(16);
    expect(targetScore(8, 0, 1, 0, 8, 100)).toBe(8 - 8 + 100);
    expect(facingToward(10, 2, 'up')).toBe('right');
    expect(facingToward(-1, -9, 'down')).toBe('up');
    expect(facingToward(0, 0, 'left')).toBe('left');
    const hits = [...Array(100).keys()].map((t) => t + 1).filter((t) => hitDue(t, 20, 30));
    expect(hits).toEqual([20, 50, 80]);
    expect(actionProgress(true, 15, 30, 0, 0)).toBe(0.5);
    expect(actionProgress(false, 99, 30, 2, 5)).toBe(0.4);
    expect(actionProgress(false, 0, 30, 0, 0)).toBe(0);
  });

  it('commands: interact with an optional tile, aim with an optional point', () => {
    expect(parseGameCommand({ type: 'player.interact', on: true })).toEqual({ type: 'player.interact', on: true });
    expect(parseGameCommand({ type: 'player.interact', on: true, tx: 3, ty: 4 })).toMatchObject({ tx: 3, ty: 4 });
    expect(() => parseGameCommand({ type: 'player.interact', on: true, tx: 3 })).toThrow(TypeError);
    expect(parseGameCommand({ type: 'player.aim' })).toEqual({ type: 'player.aim' });
    expect(() => parseGameCommand({ type: 'player.aim', x: 1 })).toThrow(TypeError);
  });

  it('the input sends the press and the release of E only when they change', () => {
    const input = new InteractionInput();
    let down = false;
    let tapped = false;
    const reader = { isDown: () => down, wasPressed: () => tapped };
    expect(input.command(reader)).toBeNull();
    down = true;
    expect(input.command(reader)).toEqual({ type: 'player.interact', on: true });
    expect(input.command(reader)).toBeNull();
    down = false;
    expect(input.command(reader)).toEqual({ type: 'player.interact', on: false });
    down = true;
    input.command(reader);
    input.resync();
    expect(input.command(reader)).toEqual({ type: 'player.interact', on: true });
    // A tap within one frame: press now, release in the next frame.
    down = false;
    input.command(reader);
    tapped = true;
    expect(input.command(reader)).toEqual({ type: 'player.interact', on: true });
    tapped = false;
    expect(input.command(reader)).toEqual({ type: 'player.interact', on: false });
  });

  it('a tap pressed and released within one tick still picks up a drop', () => {
    const w = gatherWorld(field(12, 12));
    w.place(5, 5);
    const c = centre(5, 5);
    w.drops.spawn(w.sim, newStack(catalog.get('probe_speer'), 1), 0, c.x + 10, c.y, c.x + 10, c.y);
    w.run(TICK_HZ);
    const ev = w.run(1, [
      { type: 'player.interact', on: true },
      { type: 'player.interact', on: false },
    ]);
    expect(ev.get('dropPickedUp')).toEqual([expect.objectContaining({ item: 'probe_speer' })]);
  });
});

describe('Fokus', () => {
  it('is the nearest workable target in reach, nothing beyond it', () => {
    const w = gatherWorld(field(12, 12, ['', '', '', '....F...F']));
    // Two tiles below the plant: 2,5 tiles from the feet to its edge.
    w.place(4, 6);
    w.run(1);
    expect(w.interaction.focus.kind).toBe('none');
    // One tile further up the plant's edge is exactly 1,5 tiles away: in reach.
    w.place(4, 5);
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ kind: 'object', subject: 'pflanze_fasergras', tx: w.tile(4, 3).tx, ty: w.tile(4, 3).ty });
  });

  it('prefers what the player looks at, and above all the aimed tile', () => {
    const w = gatherWorld(field(12, 12, ['', '', '', '.....F', '....F.F']));
    w.place(5, 4);
    w.body().facing = 'right';
    w.run(1);
    expect(w.interaction.focus.tx).toBe(w.tile(6, 4).tx);
    w.body().facing = 'left';
    w.run(1);
    expect(w.interaction.focus.tx).toBe(w.tile(4, 4).tx);
    const aim = centre(5, 3);
    w.run(1, [{ type: 'player.aim', x: aim.x, y: aim.y }]);
    expect(w.interaction.focus).toMatchObject({ tx: w.tile(5, 3).tx, ty: w.tile(5, 3).ty });
    w.run(1, [{ type: 'player.aim' }]);
    expect(w.interaction.focus.tx).toBe(w.tile(4, 4).tx);
  });

  it('puts targets that cannot be worked now behind the workable ones', () => {
    // A tree right in front (needs an axe), fibre grass beside.
    const w = gatherWorld(field(12, 12, ['', '', '', '....T', '.....F']));
    w.place(4, 4);
    w.body().facing = 'up';
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ subject: 'pflanze_fasergras', block: null });
    w.hold('probe_steinaxt');
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ subject: 'baum_birke', action: 'faellen', block: null });
  });
});

describe('Hinweis', () => {
  it('"[E] Aufheben: Feuerstein ×3" in German and English', () => {
    const w = gatherWorld(field(12, 12));
    w.place(5, 5);
    for (let k = 0; k < 40; k++) w.inventory.give(w.sim, 'stein', 100);
    const c = centre(5, 5);
    w.drops.spawn(w.sim, newStack(catalog.get('feuerstein'), 3), 0, c.x + 14, c.y, c.x + 14, c.y);
    w.run(TICK_HZ);
    expect(interactionHint(w.interaction.focus)).toMatchObject({ input: 'interact', verb: 'ui.interaction.action.aufheben', count: 3, reason: 'ui.interaction.block.bagsFull' });
    expect(hintOf(w, 'de')).toBe('Aufheben: Feuerstein ×3 – Taschen voll – wirf etwas weg oder trage einen Rucksack');
    w.run(1, [{ type: 'inventory.discard', from: { bereich: 'inventar', index: 0 } }]);
    // The magnet would take it now; the hint names it until it flies.
    expect(hintOf(w, 'de')).toBe('Aufheben: Feuerstein ×3');
    expect(hintOf(w, 'en')).toBe('Pick up: Flint ×3');
  });

  it('names the missing tool, a too weak tool, the dug result and the stump', () => {
    const w = gatherWorld(field(12, 12, ['', '', '', '....E']));
    w.place(4, 4);
    w.body().facing = 'up';
    w.run(1);
    expect(hintOf(w, 'de')).toBe('Fällen: Eiche – braucht eine Axt');
    expect(hintOf(w, 'en')).toBe('Fell: Oak – needs an axe');
    const rock = gatherWorld(field(12, 12, ['', '', '', '....X']));
    rock.place(4, 4);
    rock.body().facing = 'up';
    rock.hold('probe_spitzhacke');
    rock.run(1);
    expect(hintOf(rock, 'de')).toBe('Abbauen: Eiskristall – zu hart – braucht ein stärkeres Werkzeug');
    const dig = gatherWorld(field(12, 12));
    dig.place(4, 4);
    dig.body().facing = 'up';
    dig.hold('probe_schaufel');
    dig.run(1);
    expect(hintOf(dig, 'de')).toBe('Graben: Pfad');
    expect(hintOf(dig, 'en')).toBe('Dig: Path');
    w.hold('probe_steinaxt');
    w.runUntil(() => !w.interaction.working, 300, [{ type: 'player.interact', on: true }]);
    w.run(1, [{ type: 'player.interact', on: false }]);
    expect(hintOf(w, 'de')).toBe('Roden: Baumstumpf');
  });
});

describe('Aktion', () => {
  it('acts in the tick of the command: E pressed → the action starts in that very tick', () => {
    const w = gatherWorld(field(12, 12, ['', '', '', '....F']));
    w.place(4, 4);
    const tick = w.sim.tick;
    const ev = w.run(1, [{ type: 'player.interact', on: true }]);
    expect(ev.get('actionStarted')).toEqual([expect.objectContaining({ tick, target: 'pflanze_fasergras', action: 'pfluecken', byHand: true })]);
    expect(w.interaction.focus).toMatchObject({ working: true });
  });

  it('a press on nothing is refused once, however long E stays down', () => {
    const w = gatherWorld(field(12, 12));
    w.place(5, 5);
    const ev = w.run(TICK_HZ, [{ type: 'player.interact', on: true }]);
    expect(ev.get('commandRejected')).toEqual([expect.objectContaining({ type: 'player.interact', reason: 'nothingToInteract' })]);
  });

  it('turns the player to the target and counts a tool action as exertion', () => {
    const w = gatherWorld(field(12, 12, ['', '', '', '', '...R']));
    w.place(4, 4);
    w.body().facing = 'right';
    w.hold('probe_spitzhacke');
    w.run(1, [{ type: 'player.interact', on: true }]);
    expect(w.body().facing).toBe('left');
    const m = createPlayerModifiers();
    w.interaction.exertionSource(w.sim, w.sim.player, m);
    expect(m.exertion).toBe(true);
    w.run(1, [{ type: 'player.interact', on: false }]);
    const idle = createPlayerModifiers();
    w.interaction.exertionSource(w.sim, w.sim.player, idle);
    expect(idle.exertion).toBe(false);
  });

  it('stops when the player leaves the reach, and on release', () => {
    const w = gatherWorld(field(14, 12, ['', '', '', '....R']));
    w.place(4, 4);
    w.hold('probe_spitzhacke');
    w.run(5, [{ type: 'player.interact', on: true }]);
    expect(w.interaction.working).toBe(true);
    const far = centre(9, 9);
    const ev = w.run(1, [{ type: 'player.teleport', x: far.x, y: far.y, layer: 0 }]);
    expect(ev.get('actionStopped')).toEqual([expect.objectContaining({ reason: 'outOfReach', action: 'abbauen' })]);
    w.place(4, 4);
    w.run(1);
    expect(w.interaction.working).toBe(true);
    const released = w.run(1, [{ type: 'player.interact', on: false }]);
    expect(released.get('actionStopped')).toEqual([expect.objectContaining({ reason: 'released' })]);
  });

  it('a tool that breaks stops the action; the broken tool blocks until repaired', () => {
    const w = gatherWorld(field(12, 12, ['', '', '', '....E']));
    w.place(4, 4);
    w.body().facing = 'up';
    w.hold('probe_zerbrechlich');
    const ev = w.runUntil(() => !w.interaction.working, 300, [{ type: 'player.interact', on: true }]);
    expect(ev.get('itemBroken')).toEqual([expect.objectContaining({ item: 'probe_zerbrechlich' })]);
    expect(ev.get('actionStopped')).toEqual([expect.objectContaining({ reason: 'toolBroken' })]);
    expect((ev.get('harvestHit') ?? []).length).toBe(2);
    w.run(1, [{ type: 'player.interact', on: false }]);
    w.run(1);
    expect(w.interaction.focus.block).toBe('toolBroken');
    const refused = w.run(2, [{ type: 'player.interact', on: true }]);
    expect(refused.get('commandRejected')).toEqual([expect.objectContaining({ reason: 'toolBroken' })]);
  });

  it('works a given tile (touch, debug) instead of the focus', () => {
    const w = gatherWorld(field(12, 12, ['', '', '', '...F.F']));
    w.place(4, 4);
    w.body().facing = 'up';
    const t = w.tile(5, 3);
    const ev = w.runUntil(() => w.objectAt(5, 3) === '', TICK_HZ * 2, [{ type: 'player.interact', on: true, tx: t.tx, ty: t.ty }]);
    w.run(1, [{ type: 'player.interact', on: false }]);
    expect((ev.get('harvested') as { tx: number }[]).map((h) => h.tx)).toEqual([t.tx]);
    expect(w.objectAt(3, 3)).toBe('pflanze_fasergras');
  });

  it('without a player the command is refused', () => {
    const w = gatherWorld(field(8, 8));
    const ev = w.run(1, [{ type: 'player.interact', on: true }]);
    expect(ev.get('commandRejected')).toEqual([expect.objectContaining({ reason: 'noPlayer' })]);
  });
});
