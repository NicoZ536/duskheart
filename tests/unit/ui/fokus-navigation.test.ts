/**
 * M3-31: focus navigation of the UI screens (src/ui/focus/nav.ts, manager.ts) – spatial neighbour
 * choice, scopes (dialogs trap the focus, closing returns to the element below), confirm/back, the
 * screen's own first chance at an action, and the visible focus frame only while keys are in use.
 */
import { describe, expect, it } from 'vitest';
import { FOCUS_VISIBLE_ATTR, FocusManager, type FocusElement, type FocusRoot } from '../../../src/ui/focus/manager';
import { navScore, pickInDirection, type NavRect } from '../../../src/ui/focus/nav';

/** A slot grid: `cols` × `rows` cells of 20 px with 1 px gap (the inventory's geometry). */
function grid(cols: number, rows: number, x0 = 0, y0 = 0): NavRect[] {
  const out: NavRect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ left: x0 + c * 21, top: y0 + r * 21, width: 20, height: 20 });
  return out;
}

describe('Fokus: räumliche Nachbarwahl', () => {
  const cells = grid(10, 3);

  it('geht in allen vier Richtungen zum direkten Nachbarn im Raster', () => {
    const at = 12; // row 1, column 2
    expect(pickInDirection(cells[at] as NavRect, cells, 'right', at)).toBe(13);
    expect(pickInDirection(cells[at] as NavRect, cells, 'left', at)).toBe(11);
    expect(pickInDirection(cells[at] as NavRect, cells, 'up', at)).toBe(2);
    expect(pickInDirection(cells[at] as NavRect, cells, 'down', at)).toBe(22);
  });

  it('bleibt am Rand stehen (kein Umlauf) und liefert −1', () => {
    expect(pickInDirection(cells[9] as NavRect, cells, 'right', 9)).toBe(-1);
    expect(pickInDirection(cells[0] as NavRect, cells, 'up', 0)).toBe(-1);
    expect(pickInDirection(cells[20] as NavRect, cells, 'down', 20)).toBe(-1);
  });

  it('zieht ein Element derselben Zeile einem näheren der Nachbarzeile vor', () => {
    const from: NavRect = { left: 0, top: 0, width: 20, height: 20 };
    const farSameRow: NavRect = { left: 120, top: 2, width: 20, height: 20 };
    const nearOtherRow: NavRect = { left: 25, top: 30, width: 20, height: 20 };
    expect(pickInDirection(from, [nearOtherRow, farSameRow], 'right')).toBe(1);
  });

  it('erreicht die Nachbartafel über die Lücke (Ausrüstung → Inventar) und wählt die bündige Zeile', () => {
    const equipment = grid(1, 4);
    const inventory = grid(10, 3, 120, 0);
    const all = [...equipment, ...inventory];
    expect(pickInDirection(equipment[1] as NavRect, all, 'right', 1)).toBe(4 + 10);
  });

  it('wertet Kandidaten hinter der Startmitte oder mit großer Überlappung nicht', () => {
    const from: NavRect = { left: 0, top: 0, width: 20, height: 20 };
    expect(navScore(from, { left: -5, top: 0, width: 20, height: 20 }, 'right')).toBeNull();
    expect(navScore(from, { left: 5, top: 0, width: 20, height: 20 }, 'right')).toBeNull();
    expect(navScore(from, { left: 21, top: 0, width: 20, height: 20 }, 'right')).toBe(1);
    expect(pickInDirection(from, [{ left: 30, top: 0, width: 0, height: 0 }], 'right')).toBe(-1);
  });
});

/** A fake element: rect, attributes, focus and click counters. */
class FakeElement implements FocusElement {
  readonly attrs = new Map<string, string>();
  clicks = 0;
  focusCalls = 0;
  constructor(
    readonly name: string,
    public rect: NavRect,
  ) {}
  getBoundingClientRect(): NavRect {
    return this.rect;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  focus(): void {
    this.focusCalls++;
  }
  click(): void {
    this.clicks++;
  }
}

class FakeRoot implements FocusRoot {
  constructor(readonly items: FakeElement[]) {}
  querySelectorAll(): ArrayLike<FocusElement> {
    return this.items;
  }
  contains(node: FocusElement | null): boolean {
    return node !== null && this.items.includes(node as FakeElement);
  }
}

function row(prefix: string, n: number, top = 0): FakeElement[] {
  return Array.from({ length: n }, (_, i) => new FakeElement(`${prefix}${i}`, { left: i * 30, top, width: 28, height: 14 }));
}

describe('Fokus: Manager mit Bereichen', () => {
  it('fokussiert beim ersten Richtungsdruck das Startelement und zeigt den Rahmen nur bei Tasten', () => {
    const items = row('k', 3);
    const focus = new FocusManager();
    focus.push({ root: new FakeRoot(items) });
    expect(focus.focused.value).toBeNull();
    expect(focus.handle('right')).toBe(true);
    expect(focus.focused.value).toBe(items[0]);
    expect(items[0]?.hasAttribute(FOCUS_VISIBLE_ATTR)).toBe(true);
    focus.handle('right');
    expect(focus.focused.value).toBe(items[1]);
    expect(items[0]?.hasAttribute(FOCUS_VISIBLE_ATTR)).toBe(false);
    expect(items[1]?.hasAttribute(FOCUS_VISIBLE_ATTR)).toBe(true);
    focus.pointerUsed();
    expect(focus.keys.value).toBe(false);
    expect(items[1]?.hasAttribute(FOCUS_VISIBLE_ATTR)).toBe(false);
    expect(focus.focused.value).toBe(items[1]);
  });

  it('Bestätigen klickt das fokussierte Element, Zurück ruft onBack; gesperrte Elemente werden übersprungen', () => {
    const items = row('k', 3);
    items[1]?.setAttribute('disabled', '');
    let back = 0;
    const focus = new FocusManager();
    focus.push({ root: new FakeRoot(items), onBack: () => back++ });
    focus.handle('right');
    focus.handle('right');
    expect(focus.focused.value).toBe(items[2]);
    focus.handle('confirm');
    expect(items[2]?.clicks).toBe(1);
    expect(focus.handle('back')).toBe(true);
    expect(back).toBe(1);
  });

  it('der Bildschirm bekommt jede Aktion zuerst (mit Schnellleisten-Index), bevor der Standard greift', () => {
    const items = row('s', 2);
    const seen: string[] = [];
    const focus = new FocusManager();
    focus.push({
      root: new FakeRoot(items),
      onAction: (action, focused, index) => {
        seen.push(`${action}:${(focused as FakeElement | null)?.name ?? '-'}:${index}`);
        return action === 'confirm';
      },
    });
    focus.handle('right');
    focus.handle('confirm');
    focus.handle('hotbar', 4);
    expect(seen).toEqual(['right:-:0', 'confirm:s0:0', 'hotbar:s0:4']);
    expect(items[0]?.clicks).toBe(0);
    expect(focus.handle('next')).toBe(false);
  });

  it('ein Dialog fängt den Fokus; beim Schließen kehrt er zum Element darunter zurück', () => {
    const screen = row('s', 3);
    const dialog = row('d', 2, 100);
    const focus = new FocusManager();
    focus.push({ root: new FakeRoot(screen) });
    focus.handle('right');
    focus.handle('right');
    expect(focus.focused.value).toBe(screen[1]);
    const pop = focus.push({ root: new FakeRoot(dialog), initial: () => dialog[1] ?? null });
    expect(focus.focused.value).toBe(dialog[1]);
    focus.handle('left');
    expect(focus.focused.value).toBe(dialog[0]);
    focus.handle('right');
    focus.handle('right');
    expect(focus.focused.value).toBe(dialog[1]);
    pop();
    expect(focus.depth).toBe(1);
    expect(focus.focused.value).toBe(screen[1]);
    pop();
    expect(focus.depth).toBe(1);
  });

  it('Maus über einem Element macht es zum fokussierten (Tasten setzen dort fort), fremde Elemente zählen nicht', () => {
    const items = row('k', 3);
    const outside = new FakeElement('x', { left: 500, top: 0, width: 10, height: 10 });
    const focus = new FocusManager();
    focus.push({ root: new FakeRoot(items) });
    focus.hover(items[2] ?? null);
    expect(focus.focused.value).toBe(items[2]);
    expect(focus.keys.value).toBe(false);
    focus.hover(outside);
    expect(focus.focused.value).toBe(items[2]);
    focus.handle('left');
    expect(focus.focused.value).toBe(items[1]);
    expect(items[1]?.hasAttribute(FOCUS_VISIBLE_ATTR)).toBe(true);
  });

  it('keysUsed: ein per Taste geöffneter Bildschirm startet fokussiert', () => {
    const items = row('k', 2);
    const focus = new FocusManager();
    focus.keysUsed();
    focus.push({ root: new FakeRoot(items), initial: () => items[1] ?? null });
    expect(focus.focused.value).toBe(items[1]);
    expect(items[1]?.hasAttribute(FOCUS_VISIBLE_ATTR)).toBe(true);
    expect(items[1]?.focusCalls).toBe(1);
  });
});
