/**
 * Undo of the build mode (MASTERPROMPT §16.6 "Rückgängig innerhalb von 10 s (Strg+Z)"; M4-23): what the player
 * placed with one click or one drag is one step; Ctrl+Z (pad B) takes back the newest step whose newest piece
 * stands for at most `BALANCE.building.undoSeconds` (10 s) of game time, piece by piece through the simulation's own dismantling (`build.remove`,
 * `station.remove`) – within the first 30 s it gives every piece back whole (§16.6 "100 % zurück in den ersten
 * 30 s"), so undoing costs nothing.
 *
 * A step only holds what the simulation confirmed (`partPlaced`, `stationPlaced` after the commands the step sent):
 * a refused anchor is never taken back, and a piece that left the grid in another way (dismantled by hand, burnt,
 * collapsed: `partRemoved`, `stationRemoved`) leaves the step – undo never dismantles what came later on its tile.
 * Blueprints (M4-24) are steps of their own: a step that planned (`build.blueprint`) takes back its blueprints the
 * same way (`build.remove`, nothing to give back), a step that placed parts never a blueprint, and a blueprint
 * finished with the hammer (`blueprintCompleted`) leaves its step – it is a built part now.
 * Pure (ticks in, commands out), unit-tested in tests/unit/ui/bau-werkzeuge.test.ts.
 */
import { BALANCE } from '../../../content/balance';
import type { BuildLayer } from '../../../content/buildParts';

/** How long a step can be undone [s] (§16.6; the balance value `BALANCE.building.undoSeconds`). */
export const UNDO_SECONDS = BALANCE.building.undoSeconds;
/** The same in simulation ticks. */
export const UNDO_TICKS = UNDO_SECONDS * BALANCE.time.tickHz;
/** Most steps kept (older ones are past their 10 s anyway). */
const MAX_STEPS = 32;

/** A command that takes a piece back (`plan`: a blueprint – nothing comes back into the bags). */
export type Rueckbau = { readonly type: 'build.remove'; readonly tx: number; readonly ty: number; readonly ebene: BuildLayer; readonly plan?: true } | { readonly type: 'station.remove'; readonly station: number };

/** A confirmed piece of a step. */
type Stueck = { readonly art: 'teil'; readonly part: string; readonly tx: number; readonly ty: number; readonly ebene: BuildLayer; readonly plan: boolean; readonly tick: number } | { readonly art: 'station'; readonly station: number; readonly id: string; readonly tick: number };

interface Schritt {
  /** Anchors sent and not yet confirmed: `piece@tx,ty`. */
  readonly erwartet: Set<string>;
  readonly stuecke: Stueck[];
}

/** Key of an anchor a step sent: `piece@tx,ty`, a blueprint `plan:piece@tx,ty`. */
function schluessel(piece: string, tx: number, ty: number, plan: boolean): string {
  return `${plan ? 'plan:' : ''}${piece}@${tx},${ty}`;
}

/** The undo steps of one build mode session (see module comment). */
export class BauVerlauf {
  private readonly schritte: Schritt[] = [];

  /** Starts a step (one click or one drag); pieces sent for it follow with `erwarte`. */
  beginne(): void {
    this.schritte.push({ erwartet: new Set(), stuecke: [] });
    if (this.schritte.length > MAX_STEPS) this.schritte.shift();
  }

  /** The current step sent `piece` with its anchor on (tx, ty) – as a blueprint with `plan`. */
  erwarte(piece: string, tx: number, ty: number, plan = false): void {
    this.schritte[this.schritte.length - 1]?.erwartet.add(schluessel(piece, tx, ty, plan));
  }

  /** The simulation placed a part or a blueprint (`partPlaced`): it joins the newest step that sent it as such. */
  teilGesetzt(e: { readonly part: string; readonly tx: number; readonly ty: number; readonly ebene: BuildLayer; readonly tick: number; readonly blueprint: boolean }): void {
    const s = this.schrittFuer(schluessel(e.part, e.tx, e.ty, e.blueprint));
    s?.stuecke.push({ art: 'teil', part: e.part, tx: e.tx, ty: e.ty, ebene: e.ebene, plan: e.blueprint, tick: e.tick });
  }

  /** A blueprint was finished with the hammer (`blueprintCompleted`): a built part now, no step takes it back. */
  blaupauseFertig(e: { readonly part: string; readonly tx: number; readonly ty: number; readonly ebene: BuildLayer }): void {
    for (const s of this.schritte) {
      const i = s.stuecke.findIndex((p) => p.art === 'teil' && p.plan && p.part === e.part && p.tx === e.tx && p.ty === e.ty && p.ebene === e.ebene);
      if (i >= 0) s.stuecke.splice(i, 1);
    }
  }

  /** The simulation set up a station (`stationPlaced`). */
  stationGesetzt(e: { readonly id: number; readonly station: string; readonly tx: number; readonly ty: number; readonly tick: number }): void {
    const s = this.schrittFuer(schluessel(e.station, e.tx, e.ty, false));
    s?.stuecke.push({ art: 'station', station: e.id, id: e.station, tick: e.tick });
  }

  /** A part left the grid in any way: no step takes it back any more. */
  teilEntfernt(e: { readonly part: string; readonly tx: number; readonly ty: number; readonly ebene: BuildLayer }): void {
    for (const s of this.schritte) {
      const i = s.stuecke.findIndex((p) => p.art === 'teil' && p.part === e.part && p.tx === e.tx && p.ty === e.ty && p.ebene === e.ebene);
      if (i >= 0) s.stuecke.splice(i, 1);
    }
  }

  /** A station left its place. */
  stationEntfernt(e: { readonly id: number }): void {
    for (const s of this.schritte) {
      const i = s.stuecke.findIndex((p) => p.art === 'station' && p.station === e.id);
      if (i >= 0) s.stuecke.splice(i, 1);
    }
  }

  /**
   * Takes back the newest step placed within `UNDO_TICKS` before `tick`: its commands, newest piece first, or
   * `null` when nothing can be undone (older steps are dropped).
   */
  rueckgaengig(tick: number): Rueckbau[] | null {
    for (let i = this.schritte.length - 1; i >= 0; i--) {
      const s = this.schritte[i] as Schritt;
      if (s.stuecke.length === 0) {
        // Still waiting for the simulation (sent this frame): not placed yet, look further back; empty and done: gone.
        if (s.erwartet.size === 0) this.schritte.splice(i, 1);
        continue;
      }
      if (tick - Math.max(...s.stuecke.map((p) => p.tick)) > UNDO_TICKS) {
        // This step and every older one stand longer than 10 s.
        this.schritte.splice(0, i + 1);
        return null;
      }
      this.schritte.splice(i, 1);
      return [...s.stuecke].reverse().map((p): Rueckbau => (p.art === 'station' ? { type: 'station.remove', station: p.station } : p.plan ? { type: 'build.remove', tx: p.tx, ty: p.ty, ebene: p.ebene, plan: true } : { type: 'build.remove', tx: p.tx, ty: p.ty, ebene: p.ebene }));
    }
    return null;
  }

  /** Whether a step can be undone at `tick`. */
  kann(tick: number): boolean {
    for (let i = this.schritte.length - 1; i >= 0; i--) {
      const s = this.schritte[i] as Schritt;
      if (s.stuecke.length === 0) continue;
      return tick - Math.max(...s.stuecke.map((p) => p.tick)) <= UNDO_TICKS;
    }
    return false;
  }

  /** The newest step expecting `key`, which stops expecting it. */
  private schrittFuer(key: string): Schritt | null {
    for (let i = this.schritte.length - 1; i >= 0; i--) {
      const s = this.schritte[i] as Schritt;
      if (s.erwartet.delete(key)) return s;
    }
    return null;
  }
}
