/**
 * The hint line of the build mode (MASTERPROMPT §26 "automatische Tastensymbole", §16.6; M4-38): the gestures of the
 * tool in use, each with the action whose glyph stands before it and a priority. The tools themselves and leaving the
 * build mode stand in the tool bar (`Werkzeugleiste.tsx`), so the line only says what the hands do now:
 *
 * - `setzen`: place or drag, the blueprint toggle (lit while on), turn or mirror where the piece allows it, pipette,
 *   undo, the selection by keys;
 * - `abbauen`: dismantle or drag an area, cancel (a drag, a dismantling that waits: confirm or cancel);
 * - `aufwerten`: upgrade (a line or area for pieces that drag), pipette (take the new piece from the world);
 * - `reparieren`: drag the area, cancel;
 * - the selection by keys open: take, category, back.
 *
 * The line stays one row. Its room is the bottom column left of the build panel and, where the panel ends above the
 * line, the width under the panel as well (M5-37: at 1920 × 1080 the German line with the pipette is wider than the
 * column – the line runs on under the panel instead of dropping hints, `hinweisRaum`). Where even that does not fit (a
 * narrow window, a tall panel, a long key name after rebinding) the screen hides the hints of the lowest priority
 * first (`HINWEIS_PRIORITAET`, larger = hidden sooner); the order on screen stays.
 * Pure; unit-tested in tests/unit/ui/bau-hinweise.test.ts.
 */
import type { Action } from '../../../engine/input/actions';
import type { BuildTool } from '../../../render/game/ghost';
import type { BauEintrag } from './katalog';

/** One hint: the action (its glyph), the i18n key of its text, how important it is, whether it is lit. */
export interface BauHinweis {
  readonly action: Action;
  readonly key: string;
  /** Hidden first when the line is too narrow: the larger, the sooner. */
  readonly prioritaet: number;
  /** Lit (the blueprint toggle while on). */
  readonly an: boolean;
}

/**
 * Priorities of the hints (larger = hidden sooner): what the primary button does comes first, then what changes the
 * piece (turn, mirror, the blueprint toggle), cancel and confirm, undo, the selection by keys, the pipette last.
 */
export const HINWEIS_PRIORITAET = { primaer: 0, form: 1, plan: 2, abbrechen: 2, rueckgaengig: 3, auswahl: 4, pipette: 5 } as const;

/** What the hint line depends on. */
export interface HinweisLage {
  /** The selection by keys is open. */
  readonly katalog: boolean;
  readonly werkzeug: BuildTool;
  /** The chosen piece. */
  readonly gewaehlt: BauEintrag | undefined;
  /** The last device is a gamepad (turning on its own button instead of the secondary one). */
  readonly pad: boolean;
  /** Blueprint mode is on. */
  readonly blaupause: boolean;
  /** A dismantling waits for its confirmation. */
  readonly wartet: boolean;
}

function h(action: Action, key: string, prioritaet: number, an = false): BauHinweis {
  return { action, key, prioritaet, an };
}

/** The hints of the situation `l`, in screen order. */
export function bauHinweise(l: HinweisLage): BauHinweis[] {
  const P = HINWEIS_PRIORITAET;
  if (l.katalog) return [h('uiConfirm', 'ui.bau.taste.nehmen', P.primaer), h('uiTabNext', 'ui.bau.taste.kategorie', P.form), h('uiBack', 'ui.bau.taste.zurueck', P.primaer)];
  const e = l.gewaehlt;
  switch (l.werkzeug) {
    case 'setzen': {
      const out = [h('attack', e !== undefined && e.ziehen !== 'einzeln' ? 'ui.bau.taste.ziehen' : 'ui.bau.taste.setzen', P.primaer), h('blueprint', 'ui.bau.taste.blaupause', P.plan, l.blaupause)];
      if (e?.drehbar === true) out.push(h(l.pad ? 'rotate' : 'block', 'ui.bau.taste.drehen', P.form));
      if (e?.spiegelbar === true) out.push(h('mirror', 'ui.bau.taste.spiegeln', P.form));
      out.push(h('pipette', 'ui.bau.taste.pipette', P.pipette), h('undo', 'ui.bau.taste.rueckgaengig', P.rueckgaengig), h('inventory', 'ui.bau.taste.auswahl', P.auswahl));
      return out;
    }
    case 'abbauen':
      return l.wartet
        ? [h('attack', 'ui.bau.taste.bestaetigen', P.primaer), h('block', 'ui.bau.taste.abbrechen', P.abbrechen)]
        : [h('attack', 'ui.bau.taste.abbauen', P.primaer), h('block', 'ui.bau.taste.abbrechen', P.abbrechen), h('undo', 'ui.bau.taste.rueckgaengig', P.rueckgaengig), h('inventory', 'ui.bau.taste.auswahl', P.auswahl)];
    case 'aufwerten':
      return [h('attack', e !== undefined && e.ziehen !== 'einzeln' ? 'ui.bau.taste.aufwertenZiehen' : 'ui.bau.taste.aufwerten', P.primaer), h('block', 'ui.bau.taste.abbrechen', P.abbrechen), h('pipette', 'ui.bau.taste.pipette', P.pipette), h('inventory', 'ui.bau.taste.auswahl', P.auswahl)];
    case 'reparieren':
      return [h('attack', 'ui.bau.taste.reparieren', P.primaer), h('block', 'ui.bau.taste.abbrechen', P.abbrechen), h('undo', 'ui.bau.taste.rueckgaengig', P.rueckgaengig)];
  }
}

/**
 * Which hints to hide so that a line of `breite` fits hints of widths `breiten` with `abstand` between them (all in the
 * same unit): the ones of the lowest priority first (the later one first among equals), never the primary one.
 */
export function verborgeneHinweise(hinweise: readonly BauHinweis[], breiten: readonly number[], abstand: number, breite: number): Set<number> {
  const aus = new Set<number>();
  const summe = (): number => {
    let s = 0;
    let n = 0;
    for (let i = 0; i < hinweise.length; i++) {
      if (aus.has(i)) continue;
      s += breiten[i] ?? 0;
      n++;
    }
    return s + Math.max(0, n - 1) * abstand;
  };
  const reihe = hinweise.map((x, i) => ({ i, p: x.prioritaet })).sort((a, b) => b.p - a.p || b.i - a.i);
  for (const { i, p } of reihe) {
    if (summe() <= breite) break;
    if (p === HINWEIS_PRIORITAET.primaer) break;
    aus.add(i);
  }
  return aus;
}

/** Where the hint line stands and what lies around it [all in the same px, top-down]. */
export interface HinweisUmfeld {
  /** Width of the bottom column (from the window's left margin to the build panel's left edge). */
  readonly spalte: number;
  /** Width under the build panel (its column up to the window's right margin). */
  readonly unterTafel: number;
  /** Bottom edge of the build panel and top edge of the hint line. */
  readonly tafelUnten: number;
  readonly zeileOben: number;
  /** Gap the line keeps below the panel. */
  readonly luft: number;
}

/**
 * Room of the hint line (M5-37): the bottom column, plus the width under the build panel when the panel ends at least
 * `luft` above the line – then the line may run on under it; otherwise the column alone.
 */
export function hinweisRaum(u: HinweisUmfeld): number {
  return u.spalte + (u.tafelUnten + u.luft <= u.zeileOben ? u.unterTafel : 0);
}

/**
 * How far the visible hints of widths `breiten` (hidden: `aus`) with `abstand` between them and the line's own frame
 * `rand` reach beyond the bottom column `spalte` – the part of the line that runs under the build panel (0 when the
 * line fits the column).
 */
export function hinweisUeberstand(breiten: readonly number[], aus: ReadonlySet<number>, abstand: number, rand: number, spalte: number): number {
  let summe = rand;
  let n = 0;
  for (let i = 0; i < breiten.length; i++) {
    if (aus.has(i)) continue;
    summe += breiten[i] ?? 0;
    n++;
  }
  summe += Math.max(0, n - 1) * abstand;
  return Math.max(0, summe - spalte);
}
