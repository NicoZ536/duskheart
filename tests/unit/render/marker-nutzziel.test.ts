/**
 * M5-65: the interaction marker over a use target – a camp fire, a torch on its stake, a station, a chest – stands on
 * the top of what is drawn there, flames included, plus the gap (`MARKER_GAP_PX`). Before, it sat 10 px + gap over the
 * middle of the tile (`FLAT_TARGET_TOP_PX`): in `nacht-fackel` "[E] Brennstoff nachlegen" lay on the flame. The use
 * targets are drawn after the gathering view (graves, build grid, stations, placed lights outline the focused one), so
 * `GatheringView.liftUseMarker` reads the frame's outlined sprites back (`outlinedSince`) and sets the marker on the
 * highest opaque row of their frames (`FrameTops`: per clip, from the albedo's coverage – the marker does not bob with
 * the flames, and a closed door's stays as low as the door), centred over their anchors. A use target without a sprite
 * keeps the marker over its tile.
 *
 * Measured in the real game (`bauSpiel`) with the real atlas (manifest and albedo) and the real renderers of those
 * targets.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { lightKind } from '../../../src/content/lights';
import { stationSpriteId } from '../../../src/content/stations';
import { InputState } from '../../../src/engine/input/state';
import type { GameCommand } from '../../../src/game/commands';
import type { StationSystem } from '../../../src/game/stations/system';
import type { AtlasData, AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { BuildingView, createBuildingFrame } from '../../../src/render/game/building';
import { createLightFrame, LightBridge } from '../../../src/render/game/lights';
import { FrameTops, frameKey, GatheringView, MARKER_GAP_PX, outlinedSince, RecordViews, type GatheringFrame, type GatheringSession, type OutlinedSprites } from '../../../src/render/game/objects';
import { createStationFrame, StationView } from '../../../src/render/game/stations';
import { RenderScene } from '../../../src/render/scene';
import type { WorldObjectLayer } from '../../../src/render/world/objects';
import { WorldRenderTables } from '../../../src/render/world/tables';
import type { WorldUiEntry } from '../../../src/render/worldUi/worldUi';
import { TILE_PX } from '../../../src/world/model/coords';
import { decodePng } from '../../../tools/lib/png';
import { BAU_SPIEL_TIMEOUT_MS, bauSpiel, type BauSpiel } from '../game/bau-spielwelt';

let manifest: AtlasManifest;
let atlas: AtlasData;
let tables: WorldRenderTables;

let albedo: Uint8Array;

beforeAll(() => {
  const mod = generatedAtlasModule();
  const path = join(process.cwd(), 'public/generated/atlas-albedo.png');
  if (mod === null || !existsSync(path)) throw new Error('Spielatlas fehlt – npm run assets');
  manifest = manifestFromGenerated(mod);
  albedo = decodePng(readFileSync(path)).rgba;
  atlas = { manifest, albedo: { kind: 'pixels', pixels: albedo }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
  tables = new WorldRenderTables(manifest);
});

/** The highest row with coverage of frame `index` of sprite `id` in its cell, read from the albedo here. */
function opaqueTop(id: string, index: number): number {
  const f = manifest.sprites[id]?.frames[index];
  if (f === undefined) throw new Error(`Sprite ${id} hat keinen Frame ${index}`);
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if ((albedo[((f.y + y) * manifest.width + f.x + x) * 4 + 3] ?? 0) > 0) return y;
  return f.h;
}

/**
 * The opaque top row [world px] of sprite `id` in clip `clip` (the tallest of its frames: every flame of the fire) drawn
 * with its anchor at y.
 */
function spriteTop(id: string, clip: string, y: number): number {
  const s = manifest.sprites[id];
  const frames = s?.clips[clip]?.frames;
  const f = s?.frames[0];
  if (s === undefined || f === undefined || frames === undefined) throw new Error(`Sprite ${id} ohne Clip ${clip}`);
  return Math.floor(y + 0.5) - f.ay + Math.min(...frames.map((i) => opaqueTop(id, i)));
}

/** What the use-target renderers of the game view draw this frame (the renderers themselves, in the game view's order). */
type Renderers = (scene: RenderScene, g: BauSpiel, focusTx: number, focusTy: number) => void;

function wide<T extends { left: number; top: number; right: number; bottom: number }>(f: T): T {
  f.left = -1e6;
  f.top = -1e6;
  f.right = 1e6;
  f.bottom = 1e6;
  return f;
}

const lightsOnly: Renderers = (scene, g, tx, ty) => {
  const lf = wide(createLightFrame());
  lf.focusTx = tx;
  lf.focusTy = ty;
  new LightBridge().fill(scene, atlas, g.sim, lf);
};

const everything: Renderers = (scene, g, tx, ty) => {
  const bf = wide(createBuildingFrame());
  bf.focusTx = tx;
  bf.focusTy = ty;
  new BuildingView().draw(scene, atlas, g.sim, bf);
  const sf = wide(createStationFrame());
  sf.focusTx = tx;
  sf.focusTy = ty;
  new StationView().draw(scene, atlas, g.sim, sf);
  lightsOnly(scene, g, tx, ty);
};

/** One game-view frame of the gathering view around the player: marker, then the use targets, then the lift. */
function frame(g: BauSpiel, draw: Renderers | null): { marker: WorldUiEntry; focus: { kind: string; subject: string; tx: number; ty: number; x: number; y: number } } {
  const view = new GatheringView((k) => k);
  const session = {
    sim: g.sim,
    onEvent: () => () => undefined,
    command: () => undefined,
    input: new InputState(),
    reader: { promptBinding: () => undefined },
  } as unknown as GatheringSession;
  const objects = { setHighlight: () => undefined } as unknown as WorldObjectLayer;
  const home = g.at(5, 4);
  const gf: GatheringFrame = { layer: 0, cameraX: (home.tx + 0.5) * TILE_PX, cameraY: (home.ty + 0.5) * TILE_PX, viewW: 480, viewH: 270, lang: 'de', hudHint: false, figure: null };
  const scene = new RenderScene();
  scene.beginFrame(0);
  expect(view.prepare(session, gf, objects)).toBe(true);
  view.draw(scene, atlas, tables, session, gf, 0, 0);
  const f = view.lastFocus;
  if (draw !== null) draw(scene, g, f.tx, f.ty);
  view.liftUseMarker(scene, atlas);
  let marker: WorldUiEntry | undefined;
  for (let i = 0; i < scene.worldUi.count; i++) {
    const e = scene.worldUi.entry(i);
    if (e?.kind === 'marker') marker = e;
  }
  if (marker === undefined) throw new Error(`kein Marker (Fokus ${f.kind} ${f.subject})`);
  return { marker, focus: { kind: f.kind, subject: f.subject, tx: f.tx, ty: f.ty, x: f.x, y: f.y } };
}

/** A lit camp fire on site tile (x, y), fuelled with logs from the bags. */
function campFire(g: BauSpiel, x: number, y: number): { tx: number; ty: number } {
  const t = g.at(x, y);
  g.give('lagerfeuer', 1);
  g.give('holz', 6);
  g.run([{ type: 'light.place', from: g.slotOf('lagerfeuer'), tx: t.tx, ty: t.ty } as GameCommand]);
  g.run([{ type: 'light.fuel', light: 1, from: g.slotOf('holz'), count: 6 } as GameCommand]);
  g.run([{ type: 'light.ignite', tx: t.tx, ty: t.ty } as GameCommand], 2);
  return t;
}

describe('M5-65: der Marker eines Nutzziels steht über dessen Sprite samt Flamme', { timeout: BAU_SPIEL_TIMEOUT_MS }, () => {
  it('brennendes Lagerfeuer: Unterkante des Markers = Flammenspitze − Abstand (vorher 13 px über der Kachelmitte, auf der Flamme)', () => {
    const g = bauSpiel();
    const t = campFire(g, 5, 5);
    const { marker, focus } = frame(g, lightsOnly);
    expect(focus).toMatchObject({ kind: 'use', subject: 'lagerfeuer', tx: t.tx, ty: t.ty });
    const sprite = lightKind('lagerfeuer').sprites.boden as string;
    const top = spriteTop(sprite, 'brennt', (t.ty + 0.5) * TILE_PX);
    // The flames reach far above the stone ring: the old place (tile middle − 10 − gap) lay 13 px deep in them.
    expect(top).toBeLessThan((t.ty + 0.5) * TILE_PX - 10 - MARKER_GAP_PX - MARKER_GAP_PX);
    expect(marker.y).toBeLessThanOrEqual(top - MARKER_GAP_PX);
    // On the flame's top, not floating off: exactly the gap above it, centred over the fire.
    expect(marker.y).toBe(top - MARKER_GAP_PX);
    expect(marker.x).toBe((t.tx + 0.5) * TILE_PX);
  });

  it('Fackel auf dem Pfahl: über ihrer Flamme', () => {
    const g = bauSpiel();
    const t = g.at(5, 5);
    g.give('fackel', 1);
    g.run([{ type: 'light.place', from: g.slotOf('fackel'), tx: t.tx, ty: t.ty } as GameCommand], 2);
    const { marker, focus } = frame(g, everything);
    expect(focus).toMatchObject({ kind: 'use', subject: 'fackel', tx: t.tx, ty: t.ty });
    const top = spriteTop(lightKind('fackel').sprites.stand as string, 'idle', (t.ty + 0.5) * TILE_PX);
    expect(marker.y).toBe(top - MARKER_GAP_PX);
    expect(marker.x).toBe((t.tx + 0.5) * TILE_PX);
  });

  it('Werkbank (zwei Kacheln breit): über ihrer Oberkante, mittig über der Station statt über der Fokuskachel', () => {
    const g = bauSpiel();
    const t = g.at(5, 5);
    g.give('werkbank', 1);
    g.run([{ type: 'station.place', from: g.slotOf('werkbank'), tx: t.tx, ty: t.ty } as GameCommand], 2);
    const st = g.sys<StationSystem>('stations').placed[0];
    if (st === undefined) throw new Error('Werkbank nicht gesetzt');
    const size = g.sys<StationSystem>('stations').footprintOf(st);
    expect(size.b).toBe(2);
    const { marker, focus } = frame(g, everything);
    expect(focus.kind).toBe('use');
    const anchorX = (st.tx + size.b / 2) * TILE_PX;
    const id = stationSpriteId(st.station);
    // A station without clips stands in its first frame.
    const top = Object.keys(manifest.sprites[id]?.clips ?? {}).length === 0 ? (st.ty + size.t) * TILE_PX - 1 - (manifest.sprites[id]?.frames[0]?.ay ?? 0) + opaqueTop(id, 0) : spriteTop(id, 'aus', (st.ty + size.t) * TILE_PX - 1);
    expect(marker.y).toBe(top - MARKER_GAP_PX);
    expect(marker.x).toBe(anchorX);
  });

  it('Holzkiste (Bauteil des Rasters): über ihrem Deckel', () => {
    const g = bauSpiel();
    expect(g.build('kiste_holz', 5, 5)).toEqual([]);
    g.run([], 2);
    const t = g.at(5, 5);
    const { marker, focus } = frame(g, everything);
    expect(focus).toMatchObject({ kind: 'use', tx: t.tx, ty: t.ty });
    const top = spriteTop('obj_kiste_holz', 'zu', (t.ty + 1) * TILE_PX - 1);
    expect(marker.y).toBe(top - MARKER_GAP_PX);
    expect(marker.x).toBe((t.tx + 0.5) * TILE_PX);
  });

  it('Steinkamin (zwei Kacheln breit, Licht auf einer): über dem Schornstein, mittig über dem Kamin statt über der Lichtkachel', () => {
    const g = bauSpiel();
    expect(g.build('kamin_stein', 4, 5)).toEqual([]);
    g.run([], 2);
    const t = g.at(4, 5);
    const { marker, focus } = frame(g, everything);
    expect(focus).toMatchObject({ kind: 'use', subject: 'kamin_stein' });
    // The light and its use target sit on one tile of the two; the sprite stands on the middle of the front edge.
    const anchorX = (t.tx + 1) * TILE_PX;
    expect(focus.x).not.toBe(anchorX);
    expect(marker.x).toBe(anchorX);
    expect(marker.y).toBe(spriteTop('obj_kamin_stein', 'aus', (t.ty + 1) * TILE_PX - 1) - MARKER_GAP_PX);
  });

  it('ohne gezeichnetes Nutzziel (nichts umrandet) bleibt der Marker über der Kachel', () => {
    const g = bauSpiel();
    const t = campFire(g, 5, 5);
    const { marker } = frame(g, null);
    expect(marker.y).toBe((t.ty + 0.5) * TILE_PX - 10 - MARKER_GAP_PX);
    expect(marker.x).toBe((t.tx + 0.5) * TILE_PX);
  });
});

describe('M5-65: Rücklesen der umrandeten Sprites eines Frames', () => {
  function push(scene: RenderScene, id: string, x: number, y: number, outline: boolean, frame = 0): void {
    const s = manifest.sprites[id];
    const f = s?.frames[frame];
    if (f === undefined) throw new Error(`Sprite ${id} fehlt`);
    const d = scene.sprite.reset();
    d.frame = f;
    d.x = x;
    d.y = y;
    d.outline = outline;
    scene.sprites.push(d);
  }

  /** The top of frame `index` of `id` by the rule: the highest opaque row of the frames of every clip it belongs to. */
  function clipTop(id: string, index: number): number {
    const s = manifest.sprites[id];
    if (s === undefined) throw new Error(`Sprite ${id} fehlt`);
    let top = opaqueTop(id, index);
    for (const clip of Object.values(s.clips)) if (clip.frames.includes(index)) for (const f of clip.frames) top = Math.min(top, opaqueTop(id, f));
    return top;
  }

  function tops(): FrameTops {
    const t = new FrameTops();
    t.bind(atlas);
    return t;
  }

  it('Oberkante je Clip aus der Deckung des Albedos: das Feuer über seiner höchsten Flamme, die geschlossene Tür in einer Ost-West-Wand tiefer als die in einer Nord-Süd-Wand', () => {
    const t = tops();
    const fire = manifest.sprites.lagerfeuer;
    const burning = fire?.clips.brennt?.frames ?? [];
    expect(burning.length).toBeGreaterThan(1);
    // Every burning frame reports the tallest flame of the clip: the marker does not bob with the flames.
    const flame = Math.min(...burning.map((i) => opaqueTop('lagerfeuer', i)));
    for (const i of burning) expect(t.top(frameKey(fire?.frames[i] ?? { x: 0, y: 0 })), `brennt ${i}`).toBe(flame);
    expect(new Set(burning.map((i) => opaqueTop('lagerfeuer', i))).size).toBeGreaterThan(1);
    // The cold fire stands lower than the burning one.
    const cold = fire?.clips.aus?.frames[0] ?? 0;
    expect(t.top(frameKey(fire?.frames[cold] ?? { x: 0, y: 0 }))).toBeGreaterThan(flame);
    // A closed door in an east–west wall: lower than the sprite's bounds over all frames (those reach up to the door
    // frame in a north–south wall).
    const door = manifest.sprites.bau_tuer_holz;
    const shut = door?.clips.zu?.frames[0] ?? 0;
    const side = door?.clips.zu_seite?.frames[0] ?? 0;
    const doorTop = t.top(frameKey(door?.frames[shut] ?? { x: 0, y: 0 }));
    expect(doorTop).toBe(clipTop('bau_tuer_holz', shut));
    expect(doorTop).toBeGreaterThan(door?.bounds?.y ?? 0);
    expect(t.top(frameKey(door?.frames[side] ?? { x: 0, y: 0 }))).toBe(door?.bounds?.y);
  });

  it('ohne lesbares Bild (kein Canvas) gelten die Grenzen des Sprites über alle Frames', () => {
    const t = new FrameTops();
    t.bind({ manifest, albedo: { kind: 'image', image: {} as TexImageSource }, normal: atlas.normal });
    const door = manifest.sprites.bau_tuer_holz;
    expect(t.top(frameKey(door?.frames[0] ?? { x: 0, y: 0 }))).toBe(door?.bounds?.y);
    expect(t.top(-1)).toBe(0);
  });

  it('nur umrandete Sprites ab dem Startindex zählen; oberste deckende Reihe, Spanne der Anker', () => {
    const scene = new RenderScene();
    const t = tops();
    const out: OutlinedSprites = { top: 0, left: 0, right: 0 };
    const views = new RecordViews();
    // Before the start: outlined, but another target's (the hovered object is pushed earlier).
    push(scene, 'grab', 100, 50, true);
    const from = scene.sprites.count;
    expect(outlinedSince(scene.sprites.words, scene.sprites.count, from, t, views, out)).toBe(false);
    push(scene, 'obj_werkbank', 200.4, 300.6, false);
    push(scene, 'lagerfeuer', 160.2, 120.49, true, 3);
    push(scene, 'fackel_stand', 176, 124, true);
    expect(outlinedSince(scene.sprites.words, scene.sprites.count, from, t, views, out)).toBe(true);
    const fireTop = 120 - (manifest.sprites.lagerfeuer?.frames[0]?.ay ?? 0) + clipTop('lagerfeuer', 3);
    const torchTop = 124 - (manifest.sprites.fackel_stand?.frames[0]?.ay ?? 0) + clipTop('fackel_stand', 0);
    expect(out.top).toBe(Math.min(fireTop, torchTop));
    expect(out.left).toBe(160);
    expect(out.right).toBe(176);
  });

  it('übersteht das Wachsen der Sprite-Liste (neuer Puffer, neue Sichten)', () => {
    const scene = new RenderScene();
    const t = tops();
    const out: OutlinedSprites = { top: 0, left: 0, right: 0 };
    const views = new RecordViews();
    push(scene, 'grab', 10, 40, true);
    expect(outlinedSince(scene.sprites.words, scene.sprites.count, 0, t, views, out)).toBe(true);
    const before = scene.sprites.words.buffer;
    const d = new SpriteDesc();
    d.frame = manifest.sprites.grab?.frames[0] ?? null;
    const fill = scene.sprites.capacity + 8;
    for (let i = 0; i < fill; i++) scene.sprites.push(d);
    push(scene, 'grab', 30, 20, true);
    expect(scene.sprites.words.buffer).not.toBe(before);
    expect(outlinedSince(scene.sprites.words, scene.sprites.count, scene.sprites.count - 1, t, views, out)).toBe(true);
    expect(out.top).toBe(20 - (manifest.sprites.grab?.frames[0]?.ay ?? 0) + clipTop('grab', 0));
    expect(out.left).toBe(30);
  });
});
