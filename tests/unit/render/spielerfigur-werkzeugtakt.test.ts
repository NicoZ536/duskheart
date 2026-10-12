/**
 * Der Werkzeugschwung der Spielerfigur läuft auf den Arbeitsticks der Simulation (M7-68, ADR-0171; Bitte von S an R): Sammeln
 * und Werkzeugschwung zählen seit M7-68 Arbeitsticks (`InteractionSystem.workTicks`) – bei Verlangsamt (0,85) fällt jeder
 * Treffer später als im vollen Takt. Der Einmal-Clip `tool` (0,5 s, Trefferbild nach ⅓ s) beginnt mit jedem Schwung neu und
 * liest dieselbe Uhr: sein Trefferbild (Clip-Ereignis `treffer`) fällt auf jeden Treffer der Simulation (`harvestHit`), bei
 * vollem Tempo wie verlangsamt, und zwischen zwei Treffern zeigt es keinen weiteren.
 *
 * Echte Sitzung (Welt 20261012, klein): Steinaxt in der Hand, der nächste stehende Baum, E an ihm gehalten; je Tick ein Bild
 * (`PlayerFigure.place`, Darstellungszeit im Takt der Ticks).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { createObjectHit, GATHERING_SYSTEM_ID, GatheringSystem } from '../../../src/game/gathering/system';
import { createPlayerSample, GameSession } from '../../../src/game/session';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { PlayerFigure } from '../../../src/render/game/playerFigure';
import { RenderScene } from '../../../src/render/scene';
import { TILE_PX } from '../../../src/world/model/coords';

const ATLAS: AtlasData = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  const pixels = new Uint8Array(4);
  return { manifest: manifestFromGenerated(mod), albedo: { kind: 'pixels', pixels }, normal: { kind: 'pixels', pixels } };
})();
const TICK_S = 1 / BALANCE.time.tickHz;
/** How far around the spawn a tree is searched [tiles]. */
const SEARCH = 24;
/** Ticks the axe works the tree at most. */
const MAX_TICKS = 600;
/** Hits compared (the tree may fall earlier: then all of its hits). */
const MIN_HITS = 3;

/** A session with the player beside the nearest standing tree, the stone axe in the hand; the tree's anchor tile. */
function besideTree(): { session: GameSession; tx: number; ty: number } {
  const session = new GameSession({ config: { seed: 20261012, worldSize: 'small', dayLengthMinutes: 12 } });
  session.command({ type: 'player.spawn' });
  session.step();
  session.command({ type: 'debug.god', on: true });
  session.command({ type: 'inventory.give', item: 'steinaxt', count: 1 });
  session.command({ type: 'player.selectHotbar', index: 0 });
  session.step();
  const sim = session.sim;
  const gathering = sim.system(GATHERING_SYSTEM_ID);
  if (!(gathering instanceof GatheringSystem)) throw new Error('kein Sammel-System');
  const p = createPlayerSample();
  if (!session.samplePlayer(p)) throw new Error('kein Spieler');
  const cx = Math.floor(p.x / TILE_PX);
  const cy = Math.floor(p.y / TILE_PX);
  const hit = createObjectHit();
  let best: { tx: number; ty: number; d: number } | null = null;
  for (let ty = cy - SEARCH; ty <= cy + SEARCH; ty++) {
    for (let tx = cx - SEARCH; tx <= cx + SEARCH; tx++) {
      if (!gathering.objectAt(0, tx, ty, hit) || hit.rule === null || hit.tx !== tx || hit.ty !== ty) continue;
      if (hit.rule.def.kind !== 'baum' || hit.rule.def.tool !== 'axt' || hit.rule.standing === null) continue;
      const d = (tx - cx) ** 2 + (ty - cy) ** 2;
      if (best === null || d < best.d) best = { tx, ty, d };
    }
  }
  if (best === null) throw new Error(`Welt 20261012: kein Baum im Umkreis von ${SEARCH} Kacheln`);
  const x = (best.tx + 0.5) * TILE_PX;
  session.command({ type: 'player.teleport', x, y: (best.ty + 1.5) * TILE_PX, layer: 0 });
  session.step();
  session.command({ type: 'player.aim', x, y: (best.ty + 0.5) * TILE_PX });
  session.step();
  return { session, tx: best.tx, ty: best.ty };
}

/** Works the tree with E held, one frame per tick; the ticks (from the press) of the simulation's hits and of the clip's hit frames. */
function swing(condition: string | null): { hits: number[]; frames: number[] } {
  const { session, tx, ty } = besideTree();
  if (condition !== null) {
    session.command({ type: 'conditions.apply', id: condition, seconds: 120 });
    session.step();
  }
  const figure = new PlayerFigure();
  const scene = new RenderScene();
  const hits: number[] = [];
  const frames: number[] = [];
  let t = 0;
  const off = session.onEvent('harvestHit', () => hits.push(t));
  figure.onClipEvent((name) => {
    if (name === 'treffer') frames.push(t);
  });
  let time = 10;
  session.command({ type: 'player.interact', on: true, tx, ty });
  for (t = 0; t < MAX_TICKS && hits.length < MIN_HITS; t++) {
    session.step();
    scene.beginFrame(t);
    figure.place(scene, ATLAS, session, time, 200.5, 300.25);
    time += TICK_S;
  }
  off();
  figure.dispose();
  return { hits, frames };
}

describe('Werkzeugschwung auf den Arbeitsticks (M7-68)', () => {
  it('volles Tempo: das Trefferbild des Clips fällt auf jeden Treffer der Simulation', () => {
    const { hits, frames } = swing(null);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(frames).toEqual(hits);
  });

  it('verlangsamt (0,85): die Treffer fallen später, das Trefferbild folgt ihnen – kein Bild im Takt der Weltuhr', () => {
    const full = swing(null);
    const slow = swing('verlangsamt');
    expect(slow.hits.length).toBeGreaterThanOrEqual(2);
    // The simulation's rhythm is slower …
    expect((slow.hits[1] as number) - (slow.hits[0] as number)).toBeGreaterThan((full.hits[1] as number) - (full.hits[0] as number));
    // … and the clip's hit frame meets every hit, none in between.
    expect(slow.frames).toEqual(slow.hits);
  });
});
