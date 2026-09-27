/**
 * M4-22/M4-23 (MASTERPROMPT §16.6): the build mode's tools – drag shapes (walls and fences as line or outline,
 * floors, roofs and jetties filled), undo within 10 s of what the simulation confirmed (`BauVerlauf`), and the
 * controller (`BauSteuerung`): choosing, rotate R / mirror F only where they apply, pipette, placing one piece or a
 * drag as one undo step, the refused click that still asks the simulation for its reason, stations from a bag slot,
 * the gamepad cursor and the selection by keys switching the input context; blueprint mode (M4-24: G plans without
 * material through `build.blueprint`, undo takes the plans back, stations are not planned); the tools (Review M4 #1:
 * 1–4 and LB choose them, dismantling sends `build.remove` with the target's layer, `station.remove` or `light.take`
 * and waits for a second click above `BESTAETIGEN_AB` pieces, upgrading sends `build.upgrade`, repairing takes the
 * hammer into the hand and sends `build.repair`), stations mirrored with F, and the undo window as a balance value.
 */
import { describe, expect, it } from 'vitest';
import type { Action, InputContext } from '../../../src/engine/input/actions';
import { emptyBags, type BagsState } from '../../../src/game/inventory/bags';
import { BALANCE } from '../../../src/content/balance';
import { BuildGhost, dragAnchors, dragShapeOf, MAX_PLAN, rotatableKind, type BuildTool, type ToolTarget } from '../../../src/render/game/ghost';
import { planHinweis, teileZeilen } from '../../../src/ui/screens/bau/BauModus';
import { createI18n } from '../../../src/i18n';
import type { BauEintrag } from '../../../src/ui/screens/bau/katalog';
import { BauSteuerung, BESTAETIGEN_AB, MELDUNG_MS, type BauBefehle, type BauEingabe } from '../../../src/ui/screens/bau/steuerung';
import { BauVerlauf, UNDO_SECONDS, UNDO_TICKS } from '../../../src/ui/screens/bau/werkzeuge';

function paare(out: readonly number[]): Array<[number, number]> {
  const r: Array<[number, number]> = [];
  for (let i = 0; i < out.length; i += 2) r.push([out[i] as number, out[i + 1] as number]);
  return r;
}

describe('Ziehen (M4-23: Wände als Umriss, Böden gefüllt)', () => {
  it('Wände und Zäune ziehen Linien, Böden, Dächer und Stege Flächen, alles andere setzt einzeln; drehbar sind Treppe und Tor', () => {
    expect(dragShapeOf('wand')).toBe('linie');
    expect(dragShapeOf('zaun')).toBe('linie');
    expect(dragShapeOf('boden')).toBe('flaeche');
    expect(dragShapeOf('dach')).toBe('flaeche');
    expect(dragShapeOf('steg')).toBe('flaeche');
    expect(dragShapeOf('tuer')).toBe('einzeln');
    expect(dragShapeOf('moebel')).toBe('einzeln');
    expect(dragShapeOf(null)).toBe('einzeln');
    expect(rotatableKind('treppe')).toBe(true);
    expect(rotatableKind('tor')).toBe(true);
    expect(rotatableKind('wand')).toBe(false);
    expect(rotatableKind(null)).toBe(false);
  });

  it('einzeln: nur das Tile unter dem Cursor', () => {
    const out: number[] = [9, 9];
    expect(dragAnchors('einzeln', 1, 1, 4, 5, out)).toBe(1);
    expect(paare(out)).toEqual([[4, 5]]);
  });

  it('Linie auf einer Zeile oder Spalte: vom Start zum Cursor, auch rückwärts', () => {
    const out: number[] = [];
    expect(dragAnchors('linie', 3, 7, 6, 7, out)).toBe(4);
    expect(paare(out)).toEqual([
      [3, 7],
      [4, 7],
      [5, 7],
      [6, 7],
    ]);
    expect(dragAnchors('linie', 5, 9, 5, 7, out)).toBe(3);
    expect(paare(out)).toEqual([
      [5, 9],
      [5, 8],
      [5, 7],
    ]);
  });

  it('Rechteck mit Wänden: nur der Umriss, jedes Randtile genau einmal, lückenlos im Umlauf, der Start zuerst', () => {
    const out: number[] = [];
    const n = dragAnchors('linie', 10, 10, 14, 13, out);
    expect(n).toBe(2 * (4 + 3));
    const p = paare(out);
    expect(p[0]).toEqual([10, 10]);
    expect(new Set(p.map(([x, y]) => `${x},${y}`)).size).toBe(n);
    for (const [x, y] of p) expect(x === 10 || x === 14 || y === 10 || y === 13).toBe(true);
    for (let i = 1; i < p.length; i++) {
      const [ax, ay] = p[i - 1] as [number, number];
      const [bx, by] = p[i] as [number, number];
      expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1);
    }
    // Dragged up and to the left: the same outline from the other corner.
    const back = dragAnchors('linie', 14, 13, 10, 10, out);
    expect(back).toBe(n);
    expect(paare(out)[0]).toEqual([14, 13]);
  });

  it('Rechteck mit Böden: gefüllt, Zeile für Zeile vom Start aus', () => {
    const out: number[] = [];
    expect(dragAnchors('flaeche', 2, 2, 0, 3, out)).toBe(6);
    expect(paare(out)).toEqual([
      [2, 2],
      [1, 2],
      [0, 2],
      [2, 3],
      [1, 3],
      [0, 3],
    ]);
  });

  it('höchstens MAX_PLAN Anker (ein Quadrat der Baureichweite) bzw. das übergebene Maximum', () => {
    const out: number[] = [];
    expect(dragAnchors('flaeche', 0, 0, 40, 40, out)).toBe(MAX_PLAN);
    expect(MAX_PLAN).toBe(17 * 17);
    expect(dragAnchors('linie', 0, 0, 40, 40, out, 10)).toBe(10);
    expect(dragAnchors('linie', 0, 0, 0, 40, out, 5)).toBe(5);
  });
});

const TEIL = { tick: 0, ebene: 'struktur' as const, blueprint: false };

describe('Rückgängig innerhalb von 10 s (M4-23, BauVerlauf)', () => {
  it('ein Zug ist ein Schritt: zurück kommt, was die Simulation gesetzt hat, das Neueste zuerst', () => {
    const v = new BauVerlauf();
    v.beginne();
    v.erwarte('wand_holz', 1, 1);
    v.erwarte('wand_holz', 2, 1);
    v.erwarte('wand_holz', 3, 1);
    v.teilGesetzt({ ...TEIL, part: 'wand_holz', tx: 1, ty: 1, tick: 100 });
    v.teilGesetzt({ ...TEIL, part: 'wand_holz', tx: 2, ty: 1, tick: 100 });
    // (3, 1) was refused: never taken back.
    expect(v.kann(100)).toBe(true);
    expect(v.rueckgaengig(160)).toEqual([
      { type: 'build.remove', tx: 2, ty: 1, ebene: 'struktur' },
      { type: 'build.remove', tx: 1, ty: 1, ebene: 'struktur' },
    ]);
    expect(v.rueckgaengig(160)).toBeNull();
    expect(v.kann(160)).toBe(false);
  });

  it('nach mehr als 10 s Spielzeit ist der Schritt (und jeder ältere) vorbei', () => {
    expect(UNDO_TICKS).toBe(UNDO_SECONDS * 60);
    const v = new BauVerlauf();
    v.beginne();
    v.erwarte('boden_holz', 5, 5);
    v.teilGesetzt({ ...TEIL, ebene: 'boden', part: 'boden_holz', tx: 5, ty: 5, tick: 1000 });
    v.beginne();
    v.erwarte('boden_holz', 6, 5);
    v.teilGesetzt({ ...TEIL, ebene: 'boden', part: 'boden_holz', tx: 6, ty: 5, tick: 1200 });
    expect(v.kann(1200 + UNDO_TICKS)).toBe(true);
    expect(v.kann(1200 + UNDO_TICKS + 1)).toBe(false);
    expect(v.rueckgaengig(1200 + UNDO_TICKS + 1)).toBeNull();
    // Both steps are gone, not only the newest.
    expect(v.rueckgaengig(1200)).toBeNull();
  });

  it('der Schritt dieses Frames wartet noch auf die Simulation: Strg+Z nimmt den davor', () => {
    const v = new BauVerlauf();
    v.beginne();
    v.erwarte('wand_holz', 1, 1);
    v.teilGesetzt({ ...TEIL, part: 'wand_holz', tx: 1, ty: 1, tick: 10 });
    v.beginne();
    v.erwarte('wand_holz', 2, 1);
    expect(v.rueckgaengig(20)).toEqual([{ type: 'build.remove', tx: 1, ty: 1, ebene: 'struktur' }]);
    // The pending step still takes its piece when it arrives.
    v.teilGesetzt({ ...TEIL, part: 'wand_holz', tx: 2, ty: 1, tick: 21 });
    expect(v.rueckgaengig(22)).toEqual([{ type: 'build.remove', tx: 2, ty: 1, ebene: 'struktur' }]);
  });

  it('Blaupausen, fremde Teile und inzwischen Entferntes nimmt Rückgängig nicht', () => {
    const v = new BauVerlauf();
    v.beginne();
    v.erwarte('wand_holz', 1, 1);
    v.erwarte('wand_holz', 2, 1);
    v.teilGesetzt({ ...TEIL, part: 'wand_holz', tx: 1, ty: 1, tick: 5, blueprint: true });
    v.teilGesetzt({ ...TEIL, part: 'wand_stein', tx: 9, ty: 9, tick: 5 });
    v.teilGesetzt({ ...TEIL, part: 'wand_holz', tx: 2, ty: 1, tick: 5 });
    v.teilEntfernt({ part: 'wand_holz', tx: 2, ty: 1, ebene: 'struktur' });
    expect(v.rueckgaengig(6)).toBeNull();
  });

  it('Blaupausen des Schritts, der sie geplant hat, nimmt Rückgängig zurück; eine fertiggestellte gehört keinem Schritt mehr', () => {
    const v = new BauVerlauf();
    v.beginne();
    v.erwarte('wand_holz', 1, 1, true);
    v.erwarte('wand_holz', 2, 1, true);
    v.erwarte('wand_holz', 3, 1, true);
    // A part (not a plan) on the same anchor does not belong to the planning step.
    v.teilGesetzt({ ...TEIL, part: 'wand_holz', tx: 3, ty: 1, tick: 5 });
    v.teilGesetzt({ ...TEIL, part: 'wand_holz', tx: 1, ty: 1, tick: 5, blueprint: true });
    v.teilGesetzt({ ...TEIL, part: 'wand_holz', tx: 2, ty: 1, tick: 5, blueprint: true });
    v.teilGesetzt({ ...TEIL, part: 'wand_holz', tx: 3, ty: 1, tick: 5, blueprint: true });
    // (2, 1) was finished with the hammer: a built wall now, undo leaves it standing.
    v.blaupauseFertig({ part: 'wand_holz', tx: 2, ty: 1, ebene: 'struktur' });
    expect(v.kann(5 + UNDO_TICKS)).toBe(true);
    expect(v.rueckgaengig(5 + UNDO_TICKS)).toEqual([
      { type: 'build.remove', tx: 3, ty: 1, ebene: 'struktur', plan: true },
      { type: 'build.remove', tx: 1, ty: 1, ebene: 'struktur', plan: true },
    ]);
    expect(v.rueckgaengig(5 + UNDO_TICKS)).toBeNull();
    // Plans are undone within 10 s like parts, not later.
    v.beginne();
    v.erwarte('boden_holz', 4, 4, true);
    v.teilGesetzt({ ...TEIL, ebene: 'boden', part: 'boden_holz', tx: 4, ty: 4, tick: 100, blueprint: true });
    expect(v.rueckgaengig(100 + UNDO_TICKS + 1)).toBeNull();
  });

  it('Stationen: zurück über station.remove mit ihrer Nummer', () => {
    const v = new BauVerlauf();
    v.beginne();
    v.erwarte('werkbank', 4, 4);
    v.stationGesetzt({ id: 17, station: 'werkbank', tx: 4, ty: 4, tick: 50 });
    expect(v.rueckgaengig(60)).toEqual([{ type: 'station.remove', station: 17 }]);
    v.beginne();
    v.erwarte('werkbank', 4, 4);
    v.stationGesetzt({ id: 18, station: 'werkbank', tx: 4, ty: 4, tick: 70 });
    v.stationEntfernt({ id: 18 });
    expect(v.rueckgaengig(71)).toBeNull();
  });
});

// --- controller ------------------------------------------------------------------------------------------------

function eintrag(id: string, over: Partial<BauEintrag>): BauEintrag {
  return { id, source: 'bauteil', kategorie: 'fundament', kind: 'boden', name: { de: id, en: id }, stufe: 0, b: 1, t: 1, drehbar: false, spiegelbar: false, ziehen: 'einzeln', ...over };
}

const EINTRAEGE: readonly BauEintrag[] = [
  eintrag('boden_holz', { kind: 'boden', ziehen: 'flaeche' }),
  eintrag('treppe_holz', { kind: 'treppe', drehbar: true }),
  eintrag('wand_holz', { kategorie: 'waende', kind: 'wand', ziehen: 'linie' }),
  eintrag('tor_holz', { kategorie: 'tueren', kind: 'tor', drehbar: true }),
  eintrag('stuhl', { kategorie: 'moebel', kind: 'moebel', spiegelbar: true }),
  eintrag('werkbank', { kategorie: 'stationen', kind: null, source: 'station', spiegelbar: true }),
];

/** A scripted input: the actions pressed this frame, the ones held, the device, the context set. */
class Eingabe implements BauEingabe {
  gedrueckt = new Set<Action>();
  gehalten = new Set<Action>();
  lastDevice: BauEingabe['lastDevice'] = 'keyboard';
  kontext: InputContext = 'build';
  wasPressed(a: Action): boolean {
    return this.gedrueckt.has(a);
  }
  wasPressedAnyContext(a: Action): boolean {
    return this.gedrueckt.has(a);
  }
  isDown(a: Action): boolean {
    return this.gehalten.has(a) || this.gedrueckt.has(a);
  }
  setContext(c: InputContext): void {
    this.kontext = c;
  }
  /** Next frame: nothing pressed, `held` held. */
  frei(...held: Action[]): this {
    this.gedrueckt = new Set();
    this.gehalten = new Set(held);
    return this;
  }
  drueck(...a: Action[]): this {
    this.gedrueckt = new Set(a);
    return this;
  }
}

type Befehl = { readonly art: string; readonly args: readonly unknown[] };

function aufbau(): { ghost: BuildGhost; s: BauSteuerung; befehle: Befehl[]; input: Eingabe; uhr: { t: number } } {
  const ghost = new BuildGhost();
  const befehle: Befehl[] = [];
  const b: BauBefehle = {
    place: (...args) => befehle.push({ art: 'place', args }),
    blueprint: (...args) => befehle.push({ art: 'blueprint', args }),
    remove: (...args) => befehle.push({ art: 'remove', args }),
    placeStation: (...args) => befehle.push({ art: 'placeStation', args }),
    removeStation: (...args) => befehle.push({ art: 'removeStation', args }),
    upgrade: (...args) => befehle.push({ art: 'upgrade', args }),
    repair: (...args) => befehle.push({ art: 'repair', args }),
    takeLight: (...args) => befehle.push({ art: 'takeLight', args }),
    selectHotbar: (...args) => befehle.push({ art: 'selectHotbar', args }),
  };
  const uhr = { t: 1000 };
  const s = new BauSteuerung(ghost, b, () => uhr.t, EINTRAEGE);
  return { ghost, s, befehle, input: new Eingabe(), uhr };
}

/** What the game view would have found: `anchors` with their verdicts. */
function plane(g: BuildGhost, anchors: ReadonlyArray<readonly [number, number, string | null]>): void {
  g.plan.length = 0;
  g.verdicts.length = 0;
  for (const [x, y, v] of anchors) {
    g.plan.push(x, y);
    g.verdicts.push(v);
  }
  g.okCount = anchors.filter((a) => a[2] === null).length;
  g.firstReason = anchors.find((a) => a[2] !== null)?.[2] ?? null;
  const first = anchors[anchors.length - 1];
  if (first !== undefined) {
    g.cursorTx = first[0];
    g.cursorTy = first[1];
  }
  g.cursorValid = true;
}

function taschenMit(item: string, bereich: 'inventar' | 'schnellleiste', index: number, count = 1): BagsState {
  const bags = emptyBags();
  const area = [...bags[bereich]];
  area[index] = { item, count };
  return { ...bags, [bereich]: area };
}

describe('Bausteuerung (M4-22, M4-23)', () => {
  it('Öffnen wählt das erste Teil, das die Taschen haben; die Kategorie folgt; Schließen räumt den Geist', () => {
    const { ghost, s } = aufbau();
    s.oeffnen(taschenMit('wand_holz', 'inventar', 3, 5));
    expect(ghost.active).toBe(true);
    expect(ghost.piece).toBe('wand_holz');
    expect(s.kategorie.value).toBe('waende');
    expect(s.kategorien).toEqual(['fundament', 'waende', 'tueren', 'moebel', 'stationen']);
    ghost.dragTx = 3;
    ghost.dragTy = 4;
    plane(ghost, [[3, 4, null]]);
    s.schliessen();
    expect(ghost.active).toBe(false);
    expect(ghost.dragging).toBe(false);
    expect(ghost.plan).toEqual([]);
    expect(ghost.cursorValid).toBe(false);
    // Opened again: the last piece stays chosen.
    s.oeffnen(null);
    expect(ghost.piece).toBe('wand_holz');
  });

  it('Kategorien blättern im Kreis und wählen ihr erstes Teil; ein Overlay schaltet an und wieder aus', () => {
    const { ghost, s } = aufbau();
    s.oeffnen(null);
    expect(s.kategorie.value).toBe('fundament');
    s.blaettere(-1);
    expect(s.kategorie.value).toBe('stationen');
    expect(ghost.piece).toBe('werkbank');
    expect(ghost.source).toBe('station');
    s.blaettere(1);
    expect(s.kategorie.value).toBe('fundament');
    expect(ghost.piece).toBe('boden_holz');
    s.schalteOverlay('stuetzen');
    expect(ghost.overlay).toBe('stuetzen');
    s.schalteOverlay('raeume');
    expect(ghost.overlay).toBe('raeume');
    s.schalteOverlay('raeume');
    expect(ghost.overlay).toBeNull();
    expect(s.overlay.value).toBeNull();
  });

  it('R dreht nur Teile mit Richtung, F spiegelt nur spiegelbare; ein Wechsel setzt zurück, was nicht passt', () => {
    const { ghost, s, input, uhr } = aufbau();
    s.oeffnen(null);
    s.waehle('tor_holz');
    s.frame(input.drueck('rotate'), 0, null);
    expect(ghost.rot).toBe(1);
    s.frame(input.drueck('rotate'), 0, null);
    s.frame(input.drueck('rotate'), 0, null);
    s.frame(input.drueck('rotate'), 0, null);
    expect(ghost.rot).toBe(0);
    s.frame(input.drueck('rotate'), 0, null);
    expect(s.drehung.value).toBe(1);
    s.waehle('treppe_holz');
    expect(ghost.rot).toBe(1);
    s.waehle('wand_holz');
    expect(ghost.rot).toBe(0);
    s.frame(input.drueck('rotate'), 0, null);
    expect(ghost.rot).toBe(0);
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.meldung.nichtDrehbar', warnung: true, bis: uhr.t + MELDUNG_MS });
    s.frame(input.drueck('mirror'), 0, null);
    expect(ghost.mirror).toBe(false);
    expect(s.meldung.value?.key).toBe('ui.bau.meldung.nichtSpiegelbar');
    s.waehle('stuhl');
    s.frame(input.drueck('mirror'), 0, null);
    expect(ghost.mirror).toBe(true);
    expect(s.gespiegelt.value).toBe(true);
    s.waehle('boden_holz');
    expect(ghost.mirror).toBe(false);
  });

  it('Pipette (Mittelklick) nimmt das Teil unter dem Cursor, so wie es steht; über nichts meldet sie es', () => {
    const { ghost, s, input } = aufbau();
    s.oeffnen(null);
    ghost.hovered.piece = 'tor_holz';
    ghost.hovered.rot = 1;
    ghost.hovered.mirror = true;
    s.frame(input.drueck('pipette'), 0, null);
    expect(ghost.piece).toBe('tor_holz');
    expect(ghost.rot).toBe(1);
    expect(ghost.mirror).toBe(false);
    expect(s.kategorie.value).toBe('tueren');
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.meldung.pipette', params: { teil: 'tor_holz' }, warnung: false });
    ghost.hovered.piece = null;
    s.frame(input.drueck('pipette'), 0, null);
    expect(ghost.piece).toBe('tor_holz');
    expect(s.meldung.value?.key).toBe('ui.bau.meldung.pipetteLeer');
  });

  it('Klick setzt ein einzelnes Teil mit Drehung; eine abgelehnte Stelle fragt die Simulation trotzdem nach dem Grund', () => {
    const { ghost, s, befehle, input } = aufbau();
    s.oeffnen(null);
    s.waehle('tor_holz');
    s.frame(input.drueck('rotate'), 0, null);
    plane(ghost, [[7, 8, null]]);
    s.frame(input.drueck('attack'), 0, null);
    expect(befehle).toEqual([{ art: 'place', args: ['tor_holz', 7, 8, 1, undefined] }]);
    befehle.length = 0;
    plane(ghost, [[7, 9, 'noSupport']]);
    s.frame(input.drueck('attack'), 0, null);
    expect(befehle).toEqual([{ art: 'place', args: ['tor_holz', 7, 9, 1, undefined] }]);
    // Over no tile: nothing.
    befehle.length = 0;
    ghost.cursorValid = false;
    s.frame(input.drueck('attack'), 0, null);
    expect(befehle).toEqual([]);
  });

  it('Ziehen: Drücken merkt den Start, Loslassen setzt alle setzbaren Anker als einen Schritt; Strg+Z nimmt ihn zurück', () => {
    const { ghost, s, befehle, input } = aufbau();
    s.oeffnen(null);
    s.waehle('wand_holz');
    plane(ghost, [[2, 2, null]]);
    s.frame(input.drueck('attack'), 0, null);
    expect(ghost.dragging).toBe(true);
    expect([ghost.dragTx, ghost.dragTy]).toEqual([2, 2]);
    expect(befehle).toEqual([]);
    plane(ghost, [
      [2, 2, null],
      [3, 2, 'blocked'],
      [4, 2, null],
    ]);
    s.frame(input.frei('attack'), 0, null);
    expect(befehle).toEqual([]);
    s.frame(input.frei(), 0, null);
    expect(ghost.dragging).toBe(false);
    expect(befehle).toEqual([
      { art: 'place', args: ['wand_holz', 2, 2, undefined, undefined] },
      { art: 'place', args: ['wand_holz', 4, 2, undefined, undefined] },
    ]);
    // The simulation confirms both; Ctrl+Z within 10 s dismantles them, newest first.
    s.verlauf.teilGesetzt({ part: 'wand_holz', tx: 2, ty: 2, ebene: 'struktur', tick: 300, blueprint: false });
    s.verlauf.teilGesetzt({ part: 'wand_holz', tx: 4, ty: 2, ebene: 'struktur', tick: 300, blueprint: false });
    befehle.length = 0;
    s.frame(input.drueck('undo'), 300 + UNDO_TICKS, null);
    expect(befehle).toEqual([
      { art: 'remove', args: [4, 2, 'struktur'] },
      { art: 'remove', args: [2, 2, 'struktur'] },
    ]);
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.meldung.rueckgaengig', params: { count: 2 } });
    befehle.length = 0;
    s.frame(input.drueck('undo'), 300 + UNDO_TICKS, null);
    expect(befehle).toEqual([]);
    expect(s.meldung.value?.key).toBe('ui.bau.meldung.nichtsRueckgaengig');
  });

  it('Rechtsklick bricht ein Ziehen ab (sonst dreht er); das Öffnen der Auswahl ebenso und schaltet den Kontext', () => {
    const { ghost, s, befehle, input } = aufbau();
    s.oeffnen(null);
    s.waehle('boden_holz');
    plane(ghost, [[5, 5, null]]);
    s.frame(input.drueck('attack'), 0, null);
    expect(ghost.dragging).toBe(true);
    s.frame(input.frei('attack').drueck('block'), 0, null);
    expect(ghost.dragging).toBe(false);
    s.frame(input.frei(), 0, null);
    expect(befehle).toEqual([]);
    s.waehle('treppe_holz');
    s.frame(input.drueck('block'), 0, null);
    expect(ghost.rot).toBe(1);
    s.waehle('boden_holz');
    s.frame(input.drueck('attack'), 0, null);
    s.setzeKatalog(true, input);
    expect(input.kontext).toBe('ui');
    expect(ghost.dragging).toBe(false);
    expect(s.katalog.value).toBe(true);
    s.setzeKatalog(false, input);
    expect(input.kontext).toBe('build');
  });

  it('Stationen werden aus einem Taschenplatz aufgestellt; ohne sie meldet der Bau-Modus den fehlenden Gegenstand', () => {
    const { ghost, s, befehle, input } = aufbau();
    s.oeffnen(null);
    s.waehle('werkbank');
    plane(ghost, [[3, 3, null]]);
    s.frame(input.drueck('attack'), 0, taschenMit('werkbank', 'schnellleiste', 2));
    expect(befehle).toEqual([{ art: 'placeStation', args: [{ bereich: 'schnellleiste', index: 2 }, 3, 3] }]);
    befehle.length = 0;
    plane(ghost, [[3, 3, 'noMaterial']]);
    s.frame(input.drueck('attack'), 0, emptyBags());
    expect(befehle).toEqual([]);
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.grund.noMaterial', warnung: true });
  });

  it('G schaltet die Blaupause: Ziehen plant alle Anker mit build.blueprint, Strg+Z nimmt die Pläne zurück; der Modus bleibt über das Schließen', () => {
    const { ghost, s, befehle, input, uhr } = aufbau();
    s.oeffnen(null);
    s.waehle('wand_holz');
    expect(s.blaupause.value).toBe(false);
    s.frame(input.drueck('blueprint'), 0, null);
    expect(s.blaupause.value).toBe(true);
    expect(ghost.blueprint).toBe(true);
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.meldung.blaupauseAn', warnung: false, bis: uhr.t + MELDUNG_MS });
    // A drag of four walls without any in the bags: the ghost (judged as plans) finds all four; release plans them.
    plane(ghost, [[2, 2, null]]);
    s.frame(input.drueck('attack'), 0, null);
    plane(ghost, [
      [2, 2, null],
      [3, 2, null],
      [4, 2, 'blocked'],
      [5, 2, null],
    ]);
    s.frame(input.frei(), 0, null);
    expect(befehle).toEqual([
      { art: 'blueprint', args: ['wand_holz', 2, 2, undefined, undefined] },
      { art: 'blueprint', args: ['wand_holz', 3, 2, undefined, undefined] },
      { art: 'blueprint', args: ['wand_holz', 5, 2, undefined, undefined] },
    ]);
    // Confirmed as blueprints; Ctrl+Z takes them back (nothing comes into the bags: its own message).
    for (const tx of [2, 3, 5]) s.verlauf.teilGesetzt({ part: 'wand_holz', tx, ty: 2, ebene: 'struktur', tick: 40, blueprint: true });
    befehle.length = 0;
    s.frame(input.drueck('undo'), 50, null);
    expect(befehle).toEqual([
      { art: 'remove', args: [5, 2, 'struktur'] },
      { art: 'remove', args: [3, 2, 'struktur'] },
      { art: 'remove', args: [2, 2, 'struktur'] },
    ]);
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.meldung.rueckgaengigPlan', params: { count: 3 } });
    // Turned pieces are planned turned; a refused click asks the simulation for the reason as a plan.
    befehle.length = 0;
    s.waehle('tor_holz');
    s.frame(input.drueck('rotate'), 0, null);
    plane(ghost, [[7, 9, 'noSupport']]);
    s.frame(input.drueck('attack'), 0, null);
    expect(befehle).toEqual([{ art: 'blueprint', args: ['tor_holz', 7, 9, 1, undefined] }]);
    // The mode outlives closing and reopening; G again switches it off.
    s.schliessen();
    ghost.blueprint = false;
    s.oeffnen(null);
    expect(ghost.blueprint).toBe(true);
    s.frame(input.drueck('blueprint'), 0, null);
    expect(ghost.blueprint).toBe(false);
    expect(s.meldung.value?.key).toBe('ui.bau.meldung.blaupauseAus');
    s.schalteBlaupause(true);
    s.schalteBlaupause(true);
    expect(s.blaupause.value).toBe(true);
    // The message stays its time, then the frame drops it.
    uhr.t += MELDUNG_MS - 1;
    s.verwerfeMeldung();
    expect(s.meldung.value?.key).toBe('ui.bau.meldung.blaupauseAn');
    uhr.t += 1;
    s.verwerfeMeldung();
    expect(s.meldung.value).toBeNull();
  });

  it('Blaupause und Stationen: eine Station hat keinen Plan – nichts wird gesendet, der Grund steht da', () => {
    const { ghost, s, befehle, input } = aufbau();
    s.oeffnen(null);
    s.schalteBlaupause(true);
    s.waehle('werkbank');
    plane(ghost, [[3, 3, 'notPlannable']]);
    s.frame(input.drueck('attack'), 0, taschenMit('werkbank', 'schnellleiste', 2));
    expect(befehle).toEqual([]);
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.grund.notPlannable', warnung: true });
  });

  it('Gamepad: der rechte Stick schiebt den Cursor tileweise um den Spieler, gehalten wiederholt, begrenzt auf die Baureichweite', () => {
    const { ghost, s, input, uhr } = aufbau();
    s.oeffnen(null);
    input.lastDevice = 'gamepad';
    s.frame(input.drueck('aimRight'), 0, null);
    expect(ghost.pad).toBe(true);
    expect([ghost.padDx, ghost.padDy]).toEqual([1, 2]);
    // Held: nothing before the delay, then one tile per interval.
    uhr.t += 100;
    s.frame(input.frei('aimRight'), 0, null);
    expect(ghost.padDx).toBe(1);
    uhr.t += 300;
    s.frame(input.frei('aimRight'), 0, null);
    expect(ghost.padDx).toBe(2);
    uhr.t += 90;
    s.frame(input.frei('aimRight'), 0, null);
    expect(ghost.padDx).toBe(3);
    for (let i = 0; i < 20; i++) {
      uhr.t += 90;
      s.frame(input.frei('aimRight'), 0, null);
    }
    expect(ghost.padDx).toBe(8);
    for (let i = 0; i < 20; i++) s.frame(input.drueck('aimUp'), 0, null);
    expect(ghost.padDy).toBe(-8);
    input.lastDevice = 'keyboard';
    s.frame(input.frei(), 0, null);
    expect(ghost.pad).toBe(false);
  });
});

describe('Bautafel: Zeilen der Teile und Hinweis des Blaupausen-Schalters (M4-22, M4-24)', () => {
  it('eine Zeile weniger, solange die Tafel unter das Fenster reicht; eine mehr, sobald sie wieder passt – ohne Pendeln', () => {
    // Scale 4, window 1080 px: the bottom edge may reach 1072 (2 design px room).
    expect(teileZeilen(2, 1060, 1080, 4)).toBe(2);
    expect(teileZeilen(2, 1073, 1080, 4)).toBe(1);
    expect(teileZeilen(1, 1073, 1080, 4)).toBe(1);
    // One row back needs 21 design px (a slot and its gap) of room.
    expect(teileZeilen(1, 1072 - 84, 1080, 4)).toBe(2);
    expect(teileZeilen(1, 1072 - 83, 1080, 4)).toBe(1);
    // After giving up a row the panel is 84 px shorter: from 1100 to 1016 it stays at one row.
    expect(teileZeilen(teileZeilen(2, 1100, 1080, 4), 1016, 1080, 4)).toBe(1);
  });

  it('der Hinweis über dem Geist nennt die Taste des Geräts; ungebunden keiner', () => {
    const de = createI18n('de');
    const en = createI18n('en');
    expect(planHinweis(de, { art: 'kappe', text: 'G' })).toBe('[G] Blaupause');
    expect(planHinweis(en, { art: 'kappe', text: 'RB' })).toBe('[RB] Blueprint');
    expect(planHinweis(de, { art: 'knopf', sprite: 'ui_taste_xbox', frame: 0, name: 'A' })).toBe('[A] Blaupause');
    expect(planHinweis(de, null)).toBeNull();
  });
});

describe('Rückgängig: das Zeitfenster ist ein Balancewert (Review M4 #19)', () => {
  it('UNDO_SECONDS liest BALANCE.building.undoSeconds (§16.6 „innerhalb von 10 s“); die Meldung nennt die Sekunden', () => {
    expect(UNDO_SECONDS).toBe(BALANCE.building.undoSeconds);
    expect(BALANCE.building.undoSeconds).toBe(10);
    expect(UNDO_TICKS).toBe(BALANCE.building.undoSeconds * BALANCE.time.tickHz);
    // Well inside the full refund window: undoing never costs anything.
    expect(BALANCE.building.undoSeconds).toBeLessThan(BALANCE.building.refund.fullSeconds);
    const { s, input } = aufbau();
    s.oeffnen(null);
    s.frame(input.drueck('undo'), 0, null);
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.meldung.nichtsRueckgaengig', params: { sekunden: 10 }, warnung: true });
    expect(createI18n('de', { strict: true }).t('ui.bau.meldung.nichtsRueckgaengig', { sekunden: UNDO_SECONDS })).toBe('Nichts mehr rückgängig zu machen – das geht nur 10 s lang.');
  });
});

/** Sets the ghost's tool targets as the game view would have judged them (see `ToolTarget`). */
function ziele(g: BuildGhost, tool: BuildTool, targets: ReadonlyArray<Partial<ToolTarget> & Pick<ToolTarget, 'tx' | 'ty'>>): void {
  g.judgedTool = tool;
  g.targets.length = 0;
  for (const t of targets) g.targets.push({ art: 'bauteil', piece: 'wand_holz', ebene: 'struktur', w: 1, h: 1, rot: 0, mirror: false, id: 0, blueprint: false, refund: 'ganz', secondsLeft: 20, items: [], reason: null, to: null, ...t });
  g.targetCount = targets.length;
  g.cursorValid = true;
}

/** A click (press, release) of the primary button with tool `tool` on the targets set before the release. */
function klick(s: BauSteuerung, input: Eingabe, g: BuildGhost, tool: BuildTool, targets: ReadonlyArray<Partial<ToolTarget> & Pick<ToolTarget, 'tx' | 'ty'>>): void {
  g.cursorValid = true;
  s.frame(input.drueck('attack'), 0, null);
  expect(g.dragging).toBe(true);
  ziele(g, tool, targets);
  s.frame(input.frei(), 0, null);
}

describe('Werkzeuge der Bausteuerung (Review M4 #1: Abbauen, Aufwerten, Reparieren)', () => {
  it('1–4 wählen das Werkzeug, LB schaltet reihum; der Geist erfährt es, ein Zug fällt weg; G kehrt zum Setzen zurück', () => {
    const { ghost, s, input } = aufbau();
    s.oeffnen(null);
    expect(s.werkzeug.value).toBe('setzen');
    s.frame(input.drueck('toolDismantle'), 0, null);
    expect([s.werkzeug.value, ghost.tool]).toEqual(['abbauen', 'abbauen']);
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.meldung.werkzeug', params: { werkzeug: 'abbauen' } });
    s.frame(input.drueck('toolUpgrade'), 0, null);
    expect(ghost.tool).toBe('aufwerten');
    ghost.dragTx = 1;
    ghost.dragTy = 1;
    s.frame(input.drueck('toolRepair'), 0, null);
    expect(ghost.tool).toBe('reparieren');
    expect(ghost.dragging).toBe(false);
    input.lastDevice = 'gamepad';
    const reihe: BuildTool[] = [];
    for (let i = 0; i < 4; i++) {
      s.frame(input.drueck('toolNext'), 0, null);
      reihe.push(s.werkzeug.value);
    }
    expect(reihe).toEqual(['setzen', 'abbauen', 'aufwerten', 'reparieren']);
    // Planning is placing: G (RB) turns blueprint mode on and returns to placing.
    s.frame(input.drueck('blueprint'), 0, null);
    expect([s.werkzeug.value, ghost.tool, s.blaupause.value]).toEqual(['setzen', 'setzen', true]);
    s.frame(input.drueck('toolPlace'), 0, null);
    expect(s.werkzeug.value).toBe('setzen');
  });

  it('ein Teil aus der Bautafel genommen: beim Abbauen und Reparieren zurück zum Setzen, beim Aufwerten bleibt das Werkzeug', () => {
    const { ghost, s, input } = aufbau();
    s.oeffnen(null);
    for (const [action, tool, danach] of [
      ['toolDismantle', 'abbauen', 'setzen'],
      ['toolRepair', 'reparieren', 'setzen'],
      ['toolUpgrade', 'aufwerten', 'aufwerten'],
    ] as const) {
      s.frame(input.drueck(action), 0, null);
      expect(s.werkzeug.value).toBe(tool);
      s.nimm('tor_holz');
      expect([s.auswahl.value, s.werkzeug.value, ghost.tool, ghost.piece]).toEqual(['tor_holz', danach, danach, 'tor_holz']);
      s.nimm('wand_holz');
    }
    // An unknown id changes nothing.
    s.nimm('gibt_es_nicht');
    expect([s.auswahl.value, s.werkzeug.value]).toEqual(['wand_holz', 'aufwerten']);
  });

  it('Abbauen: ein Bauteil mit seiner Ebene, eine Station, eine Fackel; nichts abbaubar – das erste Ziel trotzdem (die Simulation nennt den Grund)', () => {
    const { ghost, s, befehle, input } = aufbau();
    s.oeffnen(null);
    s.waehleWerkzeug('abbauen', null, false);
    klick(s, input, ghost, 'abbauen', [
      { tx: 3, ty: 4, ebene: 'dach' },
      { tx: 3, ty: 4, ebene: 'struktur' },
      { tx: 5, ty: 5, art: 'station', id: 7, piece: 'werkbank', ebene: 'objekt' },
      { tx: 6, ty: 5, art: 'licht', id: 9, piece: 'fackel', ebene: 'objekt' },
      { tx: 9, ty: 9, reason: 'tooFar' },
    ]);
    expect(befehle).toEqual([
      { art: 'remove', args: [3, 4, 'dach'] },
      { art: 'remove', args: [3, 4, 'struktur'] },
      { art: 'removeStation', args: [7] },
      { art: 'takeLight', args: [9] },
    ]);
    expect(ghost.dragging).toBe(false);
    befehle.length = 0;
    klick(s, input, ghost, 'abbauen', [{ tx: 2, ty: 2, art: 'station', id: 4, reason: 'outOfReach' }]);
    expect(befehle).toEqual([{ art: 'removeStation', args: [4] }]);
    befehle.length = 0;
    klick(s, input, ghost, 'abbauen', []);
    expect(befehle).toEqual([]);
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.meldung.nichtsAbzubauen', warnung: true });
  });

  it('die Schwelle der Rückfrage ist ein Balancewert (M4-Gate): BESTAETIGEN_AB = BALANCE.building.dismantleConfirmAbove', () => {
    expect(BESTAETIGEN_AB).toBe(BALANCE.building.dismantleConfirmAbove);
    expect(Number.isInteger(BESTAETIGEN_AB) && BESTAETIGEN_AB > 0).toBe(true);
  });

  it(`Abbauen: mehr als ${BESTAETIGEN_AB} Teile warten auf einen zweiten Klick, die Fläche bleibt markiert; die Zweittaste bricht ab`, () => {
    const { ghost, s, befehle, input } = aufbau();
    s.oeffnen(null);
    s.waehleWerkzeug('abbauen', null, false);
    const viele = Array.from({ length: BESTAETIGEN_AB + 1 }, (_, i) => ({ tx: i, ty: 1 }));
    ghost.cursorTx = 8;
    ghost.cursorTy = 1;
    klick(s, input, ghost, 'abbauen', viele);
    expect(befehle).toEqual([]);
    expect(s.bestaetigung.value?.befehle).toHaveLength(BESTAETIGEN_AB + 1);
    expect([ghost.dragging, ghost.lockTx, ghost.lockTy]).toEqual([true, 8, 1]);
    // Moving on does not act; the secondary button cancels.
    s.frame(input.frei(), 0, null);
    s.frame(input.drueck('block'), 0, null);
    expect(s.bestaetigung.value).toBeNull();
    expect(ghost.dragging).toBe(false);
    expect(Number.isNaN(ghost.lockTx)).toBe(true);
    expect(befehle).toEqual([]);
    // Again, confirmed with a second click: every piece comes down.
    klick(s, input, ghost, 'abbauen', viele);
    s.frame(input.drueck('attack'), 0, null);
    expect(befehle).toHaveLength(BESTAETIGEN_AB + 1);
    expect(s.bestaetigung.value).toBeNull();
    expect(ghost.dragging).toBe(false);
    // Eight at once need no confirmation.
    befehle.length = 0;
    klick(s, input, ghost, 'abbauen', viele.slice(0, BESTAETIGEN_AB));
    expect(befehle).toHaveLength(BESTAETIGEN_AB);
  });

  it('Aufwerten: build.upgrade mit dem gewählten Teil für jedes Ziel ohne Grund; ohne Bauteil wählen, ohne Ziel eine Meldung', () => {
    const { ghost, s, befehle, input } = aufbau();
    s.oeffnen(null);
    s.waehle('wand_holz');
    s.waehleWerkzeug('aufwerten', null, false);
    klick(s, input, ghost, 'aufwerten', [
      { tx: 3, ty: 1, piece: 'wand_palisade', to: 'wand_holz' },
      { tx: 4, ty: 1, piece: 'wand_palisade', to: 'wand_holz' },
      { tx: 5, ty: 1, piece: 'wand_palisade', to: 'wand_holz', reason: 'noMaterial' },
    ]);
    expect(befehle).toEqual([
      { art: 'upgrade', args: [3, 1, 'wand_holz'] },
      { art: 'upgrade', args: [4, 1, 'wand_holz'] },
    ]);
    befehle.length = 0;
    // All refused: the first anyway, for the simulation's reason.
    klick(s, input, ghost, 'aufwerten', [{ tx: 6, ty: 1, piece: 'wand_holz', to: 'wand_holz', reason: 'notUpgradable' }]);
    expect(befehle).toEqual([{ art: 'upgrade', args: [6, 1, 'wand_holz'] }]);
    befehle.length = 0;
    klick(s, input, ghost, 'aufwerten', []);
    expect(befehle).toEqual([]);
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.meldung.nichtsAufzuwerten', params: { teil: 'wand_holz' } });
    // A station is upgraded by its recipe, not in the build mode.
    s.waehle('werkbank');
    klick(s, input, ghost, 'aufwerten', [{ tx: 1, ty: 1 }]);
    expect(befehle).toEqual([]);
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.meldung.aufwertenWaehlen' });
  });

  it('Reparieren: nimmt den Hammer aus der Schnellleiste in die Hand und sendet build.repair für die gezogene Fläche', () => {
    const { ghost, s, befehle, input } = aufbau();
    s.oeffnen(null);
    // No hammer in the hotbar: the message says where it belongs.
    s.waehleWerkzeug('reparieren', taschenMit('stein', 'schnellleiste', 0), true);
    expect(befehle).toEqual([]);
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.meldung.hammerFehlt', warnung: true });
    s.waehleWerkzeug('setzen', null, false);
    // The hammer on slot 3: taken into the hand.
    s.waehleWerkzeug('reparieren', taschenMit('steinhammer', 'schnellleiste', 3), true);
    expect(befehle).toEqual([{ art: 'selectHotbar', args: [3] }]);
    expect(s.meldung.value).toMatchObject({ key: 'ui.bau.meldung.hammerGenommen', params: { teil: 'steinhammer' } });
    befehle.length = 0;
    // Already in the hand: nothing to do.
    const inHand = { ...taschenMit('steinhammer', 'schnellleiste', 3), auswahl: 3 };
    s.waehleWerkzeug('setzen', null, false);
    s.waehleWerkzeug('reparieren', inHand, false);
    expect(befehle).toEqual([]);
    ghost.cursorValid = true;
    s.frame(input.drueck('attack'), 0, null);
    ghost.judgedTool = 'reparieren';
    Object.assign(ghost.repair, { x0: 2, y0: 3, x1: 6, y1: 5 });
    s.frame(input.frei(), 0, null);
    expect(befehle).toEqual([{ art: 'repair', args: [2, 3, 6, 5] }]);
  });

  it('Stationen: F stellt sie gespiegelt auf (station.place mit mirror), sonst ohne', () => {
    const { ghost, s, befehle, input } = aufbau();
    s.oeffnen(null);
    s.waehle('werkbank');
    s.frame(input.drueck('mirror'), 0, null);
    expect(ghost.mirror).toBe(true);
    plane(ghost, [[3, 3, null]]);
    s.frame(input.drueck('attack'), 0, taschenMit('werkbank', 'schnellleiste', 2));
    expect(befehle).toEqual([{ art: 'placeStation', args: [{ bereich: 'schnellleiste', index: 2 }, 3, 3, true] }]);
  });
});
