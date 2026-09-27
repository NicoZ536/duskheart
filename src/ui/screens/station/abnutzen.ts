/**
 * A scenario step that wears tools the way the game does (MASTERPROMPT §13.1 "Haltbarkeit"; for the screenshot
 * `ui-station-reparatur`): the player chops a tree near the start with the axes in the hotbar – every hit costs the tool
 * in the hand one use (`BALANCE.harvest.toolWearPerHit`) – and walks back.
 *
 * The scenario knows only the session's commands and state (no world access, ADR-0035), so it finds the tree by
 * trying: for each tile in rings around the player's start tile (nearest first) it puts the player two tiles south of
 * it (`player.teleport`) and holds E on it (`player.interact` with the tile) for one step. Something to work starts an
 * action (`actionStarted`); a target taken with one hit (a shell picked by hand, a rock too hard for the axe) ends it in
 * the same step as its hit (`actionStopped`) and the search goes on; a target that stands after its first hit is worked
 * with the tool – the tree. Then each entry of the plan puts its hotbar slot into the hand and works the tree for its
 * number of hits. Deterministic: fixed seed and start, fixed order of tries, single simulation steps.
 */
import { TILE_PX } from '../../../world/model/coords';
import type { SzenarioSchritt, WerkstattSzenarioSitzung } from '../handwerk/szenarioHilfe';

/** Hits with the tool in hotbar slot `hotbar`. */
export interface Hiebe {
  readonly hotbar: number;
  readonly hiebe: number;
}

/** Tiles searched around the start (a ring of this radius is the last). */
const SUCHRADIUS = 20;
/** Tiles tried per rendered frame (each one simulation step). */
const VERSUCHE_JE_FRAME = 48;
/** Steps a hit may take at most (a swing of the slowest tool is shorter) before the plan is given up. */
const SCHRITTE_JE_HIEB = 240;
/** The player stands this many tiles south of the target (in reach, not inside it). */
const ABSTAND = 2;

type Phase = 'suchen' | 'pruefen' | 'hauen' | 'zurueck' | 'fertig';

function zaehler(s: WerkstattSzenarioSitzung, typ: 'actionStarted' | 'actionStopped' | 'harvestHit'): number {
  return s.state().events[typ];
}

/** The tiles of the rings 1 … `radius` around (x, y), nearest ring first, each ring row by row. */
export function ringKacheln(x: number, y: number, radius: number): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([x + dx, y + dy]);
  }
  return out;
}

/** The step (see the module comment); throws when no tree stands within `SUCHRADIUS` tiles of the start. */
export function werkzeugeAbnutzen(plan: readonly Hiebe[]): SzenarioSchritt {
  let phase: Phase = 'suchen';
  let kandidaten: Array<readonly [number, number]> = [];
  let naechster = 0;
  let start: { x: number; y: number } | null = null;
  let ziel: readonly [number, number] | null = null;
  let eintrag = 0;
  let getroffen = 0;
  let schritte = 0;
  let hiebeVorher = 0;
  let stopsVorher = 0;
  const halten = (s: WerkstattSzenarioSitzung, tx: number, ty: number): void => {
    s.command({ type: 'player.interact', on: false });
    s.command({ type: 'player.teleport', x: (tx + 1 / 2) * TILE_PX, y: (ty + ABSTAND + 1 / 2) * TILE_PX, layer: 0 });
    s.command({ type: 'player.interact', on: true, tx, ty });
  };
  return (s) => {
    switch (phase) {
      case 'suchen': {
        if (start === null) {
          const p = s.state().player;
          if (p === null) return false;
          start = { x: p.x, y: p.y };
          kandidaten = ringKacheln(Math.floor(p.x / TILE_PX), Math.floor(p.y / TILE_PX), SUCHRADIUS);
          s.command({ type: 'player.selectHotbar', index: plan[0]?.hotbar ?? 0 });
        }
        for (let n = 0; n < VERSUCHE_JE_FRAME; n++) {
          const k = kandidaten[naechster++];
          if (k === undefined) throw new Error(`Szenario: kein Baum im Umkreis von ${SUCHRADIUS} Kacheln um den Start`);
          const gestartet = zaehler(s, 'actionStarted');
          halten(s, k[0], k[1]);
          s.step();
          if (zaehler(s, 'actionStarted') > gestartet) {
            ziel = k;
            hiebeVorher = zaehler(s, 'harvestHit');
            stopsVorher = zaehler(s, 'actionStopped');
            schritte = 0;
            phase = 'pruefen';
            return false;
          }
        }
        return false;
      }
      case 'pruefen': {
        // Until the first hit: a target that stops with it was taken at once (by hand, too hard) – search on.
        for (let n = 0; n < SCHRITTE_JE_HIEB && zaehler(s, 'harvestHit') === hiebeVorher && zaehler(s, 'actionStopped') === stopsVorher; n++) s.step();
        const gestoppt = zaehler(s, 'actionStopped') > stopsVorher;
        if (gestoppt || zaehler(s, 'harvestHit') === hiebeVorher) {
          phase = 'suchen';
          return false;
        }
        // The first hit of the plan's first entry has landed.
        getroffen = 1;
        phase = 'hauen';
        return false;
      }
      case 'hauen': {
        const e = plan[eintrag];
        if (e === undefined || ziel === null) {
          phase = 'zurueck';
          return false;
        }
        if (getroffen >= e.hiebe) {
          eintrag++;
          getroffen = 0;
          const weiter = plan[eintrag];
          s.command({ type: 'player.interact', on: false });
          if (weiter !== undefined) {
            s.command({ type: 'player.selectHotbar', index: weiter.hotbar });
            s.command({ type: 'player.interact', on: true, tx: ziel[0], ty: ziel[1] });
          }
          s.step();
          return false;
        }
        const vorher = zaehler(s, 'harvestHit');
        for (schritte = 0; schritte < SCHRITTE_JE_HIEB && zaehler(s, 'harvestHit') === vorher; schritte++) s.step();
        if (zaehler(s, 'harvestHit') === vorher) throw new Error('Szenario: der Baum nimmt keinen Hieb mehr an');
        getroffen++;
        return false;
      }
      case 'zurueck':
        s.command({ type: 'player.interact', on: false });
        if (start !== null) s.command({ type: 'player.teleport', x: start.x, y: start.y, layer: 0 });
        s.command({ type: 'player.selectHotbar', index: 0 });
        s.step();
        phase = 'fertig';
        return false;
      case 'fertig':
        return true;
    }
  };
}
