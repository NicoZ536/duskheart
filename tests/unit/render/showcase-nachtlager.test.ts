/**
 * M5-57: the night camp of the screenshot scenarios (src/render/game/lightsSzenario.ts `campCommands`, used by
 * `lichtbaender-*`, `qualitaet-*`, `hoch-gruenhain-nacht`, `nacht-fackel`, `bloom`, …) – the camp fire no longer covers
 * the figure:
 *
 * - on every tile it is tried on, the fire's sprite box (the atlas' opaque bounds of `lagerfeuer`, placed as the
 *   renderer places a camp fire) and the figure's (`spieler_basis` with the torch in the off hand on every frame of its
 *   socket) do not intersect – the old neighbour tiles did;
 * - each try's stand lies within the interaction's reach of its tile (fuel and light), and out of reach of every tile
 *   tried before it (the one fire is fuelled once);
 * - played on the real game: the fire burns with the camp's logs on the first free tile, fuelled once, the player back
 *   on the middle of their tile – also when the first tiles are taken.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { itemLayerSpriteId } from '../../../src/content/items/index';
import { lightKind } from '../../../src/content/lights';
import { tileInReach } from '../../../src/game/light/formulas';
import type { LightSystem } from '../../../src/game/light/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import { CAMP_FIRE_SPOTS, campCommands } from '../../../src/render/game/lightsSzenario';
import { PLAYER_BODY_SPRITE } from '../../../src/render/game/playerFigure';
import { TILE_PX } from '../../../src/world/model/coords';
import type { GameCommand } from '../../../src/game/commands';
import { BAU_SPIEL_TIMEOUT_MS, bauSpiel, eventsOf } from '../game/bau-spielwelt';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The opaque box [world px] of sprite `id` drawn with its anchor on (x, y). */
function spriteBox(id: string, x: number, y: number): Box {
  const s = MANIFEST.sprites[id];
  const f = s?.frames[0];
  if (s === undefined || f === undefined || s.bounds === undefined) throw new Error(`Sprite ${id} fehlt oder hat keine Grenzen`);
  return { x0: x - f.ax + s.bounds.x, y0: y - f.ay + s.bounds.y, x1: x - f.ax + s.bounds.x + s.bounds.w, y1: y - f.ay + s.bounds.y + s.bounds.h };
}

/** The figure's box on (x, y): the body and the torch held in the off hand on every frame of its socket. */
function figureBox(x: number, y: number): Box {
  const body = MANIFEST.sprites[PLAYER_BODY_SPRITE];
  const bf = body?.frames[0];
  if (body === undefined || bf === undefined) throw new Error('Spielerfigur fehlt');
  const out = spriteBox(PLAYER_BODY_SPRITE, x, y);
  const track = body.sockets['nebenhand'] ?? [];
  expect(track.length).toBeGreaterThan(0);
  for (const p of track) {
    if (p === null) continue;
    const torch = spriteBox(itemLayerSpriteId('fackel'), x - bf.ax + p[0], y - bf.ay + p[1]);
    out.x0 = Math.min(out.x0, torch.x0);
    out.y0 = Math.min(out.y0, torch.y0);
    out.x1 = Math.max(out.x1, torch.x1);
    out.y1 = Math.max(out.y1, torch.y1);
  }
  return out;
}

/** The camp fire's box on tile (tx, ty) (the renderer draws placed lights on the middle of their tile). */
function fireBox(tx: number, ty: number): Box {
  const id = lightKind('lagerfeuer').sprites.boden;
  if (id === undefined) throw new Error('Lagerfeuer ohne Sprite');
  return spriteBox(id, (tx + 0.5) * TILE_PX, (ty + 0.5) * TILE_PX);
}

function meet(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Whether a player on the middle of tile `from` reaches tile `to` (the reach of fuelling and lighting). */
function reaches(from: readonly [number, number], to: readonly [number, number]): boolean {
  return tileInReach((from[0] + 0.5) * TILE_PX, (from[1] + 0.5) * TILE_PX, to[0], to[1], BALANCE.interaction.reachTiles);
}

describe('M5-57: das Lagerfeuer der Nachtlager-Szenarien steht neben der Figur, nicht auf ihr', () => {
  const figure = figureBox(0.5 * TILE_PX, 0.5 * TILE_PX);

  it('auf jeder versuchten Kachel schneiden sich die Sprite-Boxen von Feuer und Figur nicht (auf den Nachbarkacheln taten sie es)', () => {
    for (const { spot } of CAMP_FIRE_SPOTS) expect(meet(fireBox(spot[0], spot[1]), figure), `Feuer auf ${spot.join(',')}`).toBe(false);
    // The old tiles: every neighbour tile of the player overlaps the figure.
    for (const [dx, dy] of [[1, 1], [1, 0], [-1, 1], [0, 1], [-1, 0], [1, -1], [-1, -1], [0, -1]] as const) {
      expect(meet(fireBox(dx, dy), figure), `Nachbar ${dx},${dy}`).toBe(true);
    }
  });

  it('jeder Standplatz erreicht seine Kachel (Nachlegen, Anzünden) und keine vorher versuchte', () => {
    const tried: Array<readonly [number, number]> = [];
    for (const { spot, stand } of CAMP_FIRE_SPOTS) {
      expect(stand).not.toEqual(spot);
      expect(reaches(stand, spot), `Stand ${stand.join(',')} → ${spot.join(',')}`).toBe(true);
      for (const earlier of tried) expect(reaches(stand, earlier), `Stand ${stand.join(',')} → früher ${earlier.join(',')}`).toBe(false);
      tried.push(spot);
    }
    expect(new Set(CAMP_FIRE_SPOTS.map((s) => s.spot.join(','))).size).toBe(CAMP_FIRE_SPOTS.length);
  });

  it('die Befehle: je Versuch hinstellen, setzen, nachlegen, anzünden; danach zurück auf die Kachelmitte, dann Pfahlfackel und Handfackel', () => {
    const cmds = campCommands(10, 20, [[-5, -2]], 0) as Array<{ type: string; x?: number; y?: number; tx?: number; ty?: number }>;
    const types = cmds.map((c) => c.type);
    const first = types.indexOf('player.teleport');
    for (let i = 0; i < CAMP_FIRE_SPOTS.length; i++) {
      expect(types.slice(first + 4 * i, first + 4 * i + 4)).toEqual(['player.teleport', 'light.place', 'light.fuel', 'light.ignite']);
      const s = CAMP_FIRE_SPOTS[i];
      expect(cmds[first + 4 * i + 1]).toMatchObject({ tx: 10 + (s?.spot[0] ?? 0), ty: 20 + (s?.spot[1] ?? 0) });
    }
    const home = cmds[first + 4 * CAMP_FIRE_SPOTS.length];
    expect(home).toEqual({ type: 'player.teleport', x: 10.5 * TILE_PX, y: 20.5 * TILE_PX, layer: 0 });
    expect(types.slice(-2)).toEqual(['light.place', 'light.toggle']);
  });
});

describe('M5-57: das Lager im echten Spiel', { timeout: BAU_SPIEL_TIMEOUT_MS }, () => {
  /** Sets the camp up on the site's middle with the first `taken` fire tiles built over; the fire, fuellings and player. */
  function lager(taken: number) {
    const g = bauSpiel();
    const home = g.at(5, 4);
    g.stand(5, 4);
    const light = g.sys<LightSystem>('light');
    // The first `taken` tiles are taken (as a build part or a station takes them), the bags stay as a fresh session's.
    const blocked = new Set(CAMP_FIRE_SPOTS.slice(0, taken).map((s) => `${home.tx + s.spot[0]},${home.ty + s.spot[1]}`));
    light.addOccupancy((_s, _layer, tx, ty) => blocked.has(`${tx},${ty}`));
    const events = g.run(campCommands(home.tx, home.ty, [[-5, -2]]) as GameCommand[]);
    const fires = light.state.placed.filter((l) => l.fire !== null);
    const p = { x: 0, y: 0 };
    g.sys<PlayerSystem>('player').position(g.sim, p);
    return { home, fires, fueled: eventsOf(events, 'fireFueled'), p };
  }

  it('das Feuer brennt auf dem ersten freien Platz, einmal mit den Scheiten des Lagers genährt; der Spieler steht wieder mittig', () => {
    const { home, fires, fueled, p } = lager(0);
    const s = CAMP_FIRE_SPOTS[0];
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ tx: home.tx + (s?.spot[0] ?? 0), ty: home.ty + (s?.spot[1] ?? 0) });
    expect(fires[0]?.fire?.lit).toBe(true);
    expect(fueled).toHaveLength(1);
    expect(fueled[0]?.count).toBe(6);
    expect(p).toEqual({ x: (home.tx + 0.5) * TILE_PX, y: (home.ty + 0.5) * TILE_PX });
  });

  it('sind die ersten vier Plätze bebaut, brennt es auf dem fünften – wieder einmal genährt', () => {
    const { home, fires, fueled } = lager(4);
    const s = CAMP_FIRE_SPOTS[4];
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ tx: home.tx + (s?.spot[0] ?? 0), ty: home.ty + (s?.spot[1] ?? 0) });
    expect(fires[0]?.fire?.lit).toBe(true);
    expect(fueled).toHaveLength(1);
  });
});
