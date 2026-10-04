/**
 * Fallen im echten Spiel (M6-30; MASTERPROMPT §2.2 „Alles ist erreichbar und erklärt“, §14 „Fallen (Schlinge,
 * Kastenfalle)“; docs/SPIEL.md §11 „Beute, Jagen, Fallen“; Review-Mangel „traps-unplaceable“): die Spielsitzung mit
 * `createSimulation` und der echten Eingabekette (Maus → `InputCommandTranslator` → Befehle) – keine `trap.place`-Befehle
 * von Hand.
 * - Eine Falle in der Hand zielt wie eine Fackel: die gezielte Kachel in Reichweite, sonst die Kachel vor der Figur. Der
 *   Fokus der Interaktion trägt sie (`hand*`) samt Grund, aus dem `trap.place` dort ablehnen würde; der HUD-Hinweis sagt
 *   „Aufstellen: Kastenfalle“ mit der Primärtaste, solange E nichts anderes im Blick hat.
 * - Die Primärtaste (LMB) stellt sie dort auf (`trapPlaced`), ohne Schlag; auf belegtem Boden lehnt `trap.place` mit
 *   `blocked` ab, und die Vorschau sagt es vorher.
 * - Ein Hase läuft hinein (`trapSprung`), E nimmt die Falle zurück, der Hase bleibt als Kadaver, das Steinmesser zerlegt ihn.
 */
import { describe, expect, it } from 'vitest';
import type { EventArgs } from '../../../src/engine/events';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import type { TrapSystem } from '../../../src/game/creatures/traps';
import { hintText, interactionHint } from '../../../src/game/interaction/hint';
import type { InteractionSystem } from '../../../src/game/interaction/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import type { WorldCollision } from '../../../src/game/player/collision';
import type { PlayerSystem } from '../../../src/game/player/system';
import { GameSession, createHudSample } from '../../../src/game/session';
import { captureSimulation, restoreSimulation } from '../../../src/save/world';
import type { SimEventMap } from '../../../src/game/sim';
import { BLOCK_ALL } from '../../../src/world/collision/tiles';
import { WATER_DEPTH_MASK } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';
import de from '../../../src/i18n/de.json';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { DebugOverlayList } from '../../../src/render/debugOverlay';
import { GHOST_COLORS, GHOST_LOOK } from '../../../src/render/game/ghost';
import { createPlacementFrame, HandPlacementView } from '../../../src/render/game/placement';
import type { RenderScene } from '../../../src/render/scene';
import { LABEL_COLORS, WorldUiList } from '../../../src/render/worldUi/worldUi';

/** The fixture world of the fight's acceptance tests (small, start beach with meadows behind it). */
const CONFIG = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;

type Ev = EventArgs<SimEventMap>;

function t(key: string, params?: Readonly<Record<string, string | number>>): string {
  const text = (de as Record<string, string>)[key];
  if (text === undefined) throw new Error(`missing i18n key ${key}`);
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => String(params?.[k] ?? `{${k}}`));
}

function game() {
  const session = new GameSession({ config: CONFIG });
  const sim = session.sim;
  const events: Ev[] = [];
  for (const type of ['trapPlaced', 'trapSprung', 'trapTaken', 'commandRejected', 'attackWindup', 'carcassCarved'] as const) {
    session.onEvent(type, (payload) => events.push([type, payload] as unknown as Ev));
  }
  const player = sim.system('player') as unknown as PlayerSystem;
  const inventory = sim.system('inventory') as unknown as InventorySystem;
  const interaction = sim.system('interaction') as unknown as InteractionSystem;
  const traps = sim.system('traps') as unknown as TrapSystem;
  const creatures = sim.system('creatures') as unknown as CreatureSystem;
  const collision = sim.system('world-collision') as unknown as WorldCollision;
  /** One frame of input, then `ticks` ticks. */
  const frame = (ticks = 1): void => {
    session.beginFrame();
    for (let i = 0; i < ticks; i++) session.step();
  };
  const cmd = (c: unknown, ticks = 1): void => {
    session.command(c);
    for (let i = 0; i < ticks; i++) session.step();
  };
  const pos = (): { x: number; y: number } => {
    const at = { x: 0, y: 0 };
    if (!player.position(sim, at)) throw new Error('no player');
    return at;
  };
  const open = (x: number, y: number): boolean => {
    const chunk = sim.world.chunks.get(0, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
    if (chunk === undefined) return false;
    const i = ((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK);
    return (collision.grid.tileInfo(0, x, y) & BLOCK_ALL) === 0 && ((chunk.water[i] as number) & WATER_DEPTH_MASK) === 0;
  };
  /** Puts the player on the centre of the nearest 7 × 7 patch of open ground. */
  const openGround = (): { tx: number; ty: number } => {
    const p = pos();
    const ptx = Math.floor(p.x / TILE_PX);
    const pty = Math.floor(p.y / TILE_PX);
    for (let r = 0; r < 48; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          let free = true;
          for (let y = -3; y <= 3 && free; y++) for (let x = -3; x <= 3 && free; x++) free = open(ptx + dx + x, pty + dy + y);
          if (!free) continue;
          const tx = ptx + dx;
          const ty = pty + dy;
          cmd({ type: 'player.teleport', x: tx * TILE_PX + TILE_PX / 2, y: ty * TILE_PX + TILE_PX / 2, layer: 0 }, 2);
          return { tx, ty };
        }
      }
    }
    throw new Error('no open ground');
  };
  /** Gives `count` of `item` into hotbar slot `index` and selects it (as the inventory screen would). */
  const hold = (item: string, count: number, index = 0): void => {
    cmd({ type: 'inventory.give', item, count });
    const inHotbar = inventory.state.schnellleiste.findIndex((s) => s?.item === item);
    if (inHotbar >= 0) {
      cmd({ type: 'player.selectHotbar', index: inHotbar });
      return;
    }
    const from = { bereich: 'inventar' as const, index: inventory.state.inventar.findIndex((s) => s?.item === item) };
    cmd({ type: 'inventory.move', from, to: { bereich: 'schnellleiste', index }, count });
    cmd({ type: 'player.selectHotbar', index });
  };
  /** The mouse aims at the centre of tile (tx, ty) (the game view sends `player.aim` from the pointer). */
  const aimAt = (tx: number, ty: number): void => cmd({ type: 'player.aim', x: tx * TILE_PX + TILE_PX / 2, y: ty * TILE_PX + TILE_PX / 2 });
  /** A click of the primary button (LMB): pressed in one frame, released in the next. */
  const click = (): void => {
    session.input.mouseButtonDown(0);
    frame(1);
    session.input.mouseButtonUp(0);
    frame(1);
  };
  const hud = createHudSample();
  const hint = (): string | null => {
    if (!session.sampleHud(hud)) return null;
    const h = interactionHint(hud.focus);
    return h === null ? null : `${h.input}: ${hintText(h, 'de', t)}`;
  };
  const drain = (): Ev[] => events.splice(0, events.length);
  cmd({ type: 'setTime', hour: 10, minute: 0 });
  cmd({ type: 'player.spawn' }, 30);
  return { session, sim, inventory, interaction, traps, creatures, frame, cmd, pos, openGround, hold, aimAt, click, hint, drain };
}

const ATLAS: AtlasData = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  const pixels = new Uint8Array(4);
  return { manifest: manifestFromGenerated(mod), albedo: { kind: 'pixels', pixels }, normal: { kind: 'pixels', pixels } };
})();

/** A scene that records the pushed sprites (copies) and the world UI. */
function recordingScene(): { scene: RenderScene; sprites: SpriteDesc[]; ui: WorldUiList } {
  const sprites: SpriteDesc[] = [];
  const ui = new WorldUiList();
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        sprites.push(Object.assign(new SpriteDesc(), d));
        return sprites.length - 1;
      },
    },
    worldUi: ui,
  } as unknown as RenderScene;
  return { scene, sprites, ui };
}

/** The unlit 16 × 16 fields of an overlay list (their colours). */
function fields(overlay: DebugOverlayList): number[] {
  const out: number[] = [];
  for (let i = 0; i < overlay.count; i++) {
    const e = overlay.entry(i);
    if (e?.kind === 'rect' && e.width === TILE_PX && e.height === TILE_PX) out.push(e.color);
  }
  return out;
}

describe('Fallen aus der Hand aufstellen (echte Eingabe, M6-30)', () => {
  it(
    'Vorschau und Hinweis auf der gezielten Kachel; LMB stellt die Kastenfalle auf, auf belegtem Boden sagt die Vorschau „blockiert“ und trap.place lehnt ab',
    () => {
      const g = game();
      const home = g.openGround();
      g.hold('kastenfalle', 2);
      g.aimAt(home.tx + 1, home.ty);
      g.frame(1);
      const f = g.interaction.focus;
      expect({ hand: f.hand, tx: f.handTx, ty: f.handTy, block: f.handBlock }).toEqual({ hand: 'kastenfalle', tx: home.tx + 1, ty: home.ty, block: null });
      expect(g.hint()).toBe('attack: Aufstellen: Kastenfalle');
      g.drain();
      g.click();
      const placed = g.drain();
      expect(placed.filter((e) => e[0] === 'attackWindup')).toEqual([]);
      expect(placed.filter((e) => e[0] === 'trapPlaced').map((e) => e[1])).toEqual([expect.objectContaining({ item: 'kastenfalle', tx: home.tx + 1, ty: home.ty })]);
      expect(g.traps.traps).toHaveLength(1);
      expect(g.inventory.count('kastenfalle')).toBe(1);
      // The tile holds a trap now: the preview says so before the click, and the click is refused for that reason.
      g.frame(1);
      expect(g.interaction.focus.handBlock).toBe('blocked');
      g.click();
      expect(g.drain().filter((e) => e[0] === 'commandRejected').map((e) => e[1])).toEqual([expect.objectContaining({ type: 'trap.place', reason: 'blocked' })]);
      // Aimed beyond the reach: the tile ahead of the figure (as with a torch).
      g.aimAt(home.tx + 9, home.ty + 9);
      g.frame(1);
      expect(g.interaction.focus.handBlock).toBe(null);
      const ahead = { tx: g.interaction.focus.handTx, ty: g.interaction.focus.handTy };
      expect(Math.max(Math.abs(ahead.tx - home.tx), Math.abs(ahead.ty - home.ty))).toBe(1);
      g.click();
      expect(g.drain().filter((e) => e[0] === 'trapPlaced').map((e) => e[1])).toEqual([expect.objectContaining({ item: 'kastenfalle', tx: ahead.tx, ty: ahead.ty })]);
      // Nothing to set up in the hand: no preview, no hint.
      g.frame(1);
      expect(g.interaction.focus.hand).toBeNull();
    },
  );

  it(
    'ein Hase läuft in die Falle; E nimmt sie zurück, der Hase bleibt als Kadaver und das Steinmesser zerlegt ihn',
    () => {
      const g = game();
      const home = g.openGround();
      g.hold('kastenfalle', 1);
      g.aimAt(home.tx + 2, home.ty);
      g.click();
      expect(g.traps.traps.map((x) => [x.item, x.tx, x.ty])).toEqual([['kastenfalle', home.tx + 2, home.ty]]);
      // The player steps back out of the hare's sight; a hare two tiles beyond the trap is sent across it.
      g.cmd({ type: 'player.teleport', x: (home.tx - 3) * TILE_PX + TILE_PX / 2, y: (home.ty - 3) * TILE_PX + TILE_PX / 2, layer: 0 }, 2);
      g.cmd({ type: 'player.sneak', on: true });
      g.cmd({ type: 'creature.spawn', creature: 'hase', count: 1, x: (home.tx + 4) * TILE_PX + TILE_PX / 2, y: home.ty * TILE_PX + TILE_PX / 2, layer: 0 });
      const hare = g.creatures.store.entityAt(g.creatures.store.size - 1);
      const s = g.creatures.store.get(hare);
      if (s === undefined) throw new Error('no hare');
      s.state = 'umherstreifen';
      s.stateUntilTick = g.sim.tick + 600;
      s.goalX = (home.tx - 1) * TILE_PX + TILE_PX / 2;
      s.goalY = home.ty * TILE_PX + TILE_PX / 2;
      g.drain();
      let sprung = 0;
      const path: string[] = [];
      for (let i = 0; i < 600 && sprung === 0; i++) {
        g.cmd({ type: 'player.aim', x: (home.tx + 2) * TILE_PX + TILE_PX / 2, y: home.ty * TILE_PX + TILE_PX / 2 }, 1);
        sprung = g.drain().filter((e) => e[0] === 'trapSprung').length;
        const st = g.creatures.store.get(hare);
        if (i % 20 === 0 && st !== undefined) {
          const p = { x: 0, y: 0 };
          g.creatures.positionOf(hare, p);
          path.push(`${i}:${st.state}:${(p.x / TILE_PX).toFixed(1)},${(p.y / TILE_PX).toFixed(1)}`);
        }
      }
      expect(sprung, path.join(' ')).toBe(1);
      expect(g.traps.traps[0]?.caught).toBe('hase');
      // Back beside the trap, aiming at it.
      g.cmd({ type: 'player.sneak', on: false });
      g.cmd({ type: 'player.teleport', x: (home.tx + 1) * TILE_PX + TILE_PX / 2, y: home.ty * TILE_PX + TILE_PX / 2, layer: 0 }, 2);
      g.aimAt(home.tx + 2, home.ty);
      // E on the trap: the hint names it, the press takes it back.
      g.frame(1);
      expect(g.hint()).toBe('interact: Nehmen: Kastenfalle');
      g.session.input.keyDown('KeyE');
      g.frame(2);
      g.session.input.keyUp('KeyE');
      g.frame(1);
      const taken = g.drain();
      expect(taken.filter((e) => e[0] === 'trapTaken').map((e) => e[1])).toEqual([expect.objectContaining({ item: 'kastenfalle', caught: 'hase' })]);
      expect(g.traps.traps).toEqual([]);
      expect(g.inventory.count('kastenfalle')).toBe(1);
      expect(g.creatures.carcassAt(0, home.tx + 2, home.ty)).not.toBe(0);
      // The stone knife in the hand carves it (E on the carcass).
      g.hold('steinmesser', 1, 1);
      g.frame(1);
      expect(g.hint()).toBe('interact: Zerlegen: Hase');
      g.session.input.keyDown('KeyE');
      g.frame(2);
      g.session.input.keyUp('KeyE');
      g.frame(1);
      expect(g.drain().filter((e) => e[0] === 'carcassCarved')).toHaveLength(1);
    },
  );
  it(
    'die Vorschau im Spielbild: das Fallen-Icon grün auf freiem Boden, rot mit „Blockiert“ auf belegtem; im Baumodus und mit leerer Hand keine',
    () => {
      const g = game();
      const home = g.openGround();
      g.hold('schlinge', 2);
      g.aimAt(home.tx + 1, home.ty);
      g.frame(1);
      const view = new HandPlacementView();
      const f = createPlacementFrame();
      f.reasonLabel = (reason) => `grund:${reason}`;
      let r = recordingScene();
      let overlay = new DebugOverlayList();
      view.draw(r.scene, ATLAS, g.sim, f, overlay);
      expect(view.stats).toEqual({ item: 'schlinge', tx: home.tx + 1, ty: home.ty, block: null, drawn: 2 });
      expect(r.sprites).toHaveLength(1);
      const icon = ATLAS.manifest.sprites['icon_schlinge'];
      expect(r.sprites[0]).toMatchObject({ x: (home.tx + 1.5) * TILE_PX, y: (home.ty + 0.5) * TILE_PX, fade: GHOST_LOOK.fade, tintStrength: GHOST_LOOK.ok, tintR: GHOST_COLORS.ok.tint[0], tintG: GHOST_COLORS.ok.tint[1], tintB: GHOST_COLORS.ok.tint[2] });
      expect(r.sprites[0]?.frame).toBe(icon?.frames[0]);
      expect(fields(overlay)).toEqual([GHOST_COLORS.ok.fill]);
      expect(r.ui.count).toBe(0);
      // Set it, then aim at the same tile with the second snare: red, with the reason over the tile.
      g.click();
      g.frame(1);
      r = recordingScene();
      overlay = new DebugOverlayList();
      view.draw(r.scene, ATLAS, g.sim, f, overlay);
      expect(view.stats.block).toBe('blocked');
      expect(r.sprites[0]).toMatchObject({ tintStrength: GHOST_LOOK.refused, tintR: GHOST_COLORS.refused.tint[0] });
      expect(fields(overlay)).toEqual([GHOST_COLORS.refused.fill]);
      expect(r.ui.count).toBe(1);
      expect(r.ui.entry(0)).toMatchObject({ text: 'grund:blocked', x: (home.tx + 1.5) * TILE_PX, color: LABEL_COLORS.feind });
      // Build mode owns the primary button: no preview.
      f.building = true;
      r = recordingScene();
      view.draw(r.scene, ATLAS, g.sim, f, new DebugOverlayList());
      expect(r.sprites).toHaveLength(0);
      expect(view.stats.item).toBeNull();
      f.building = false;
      // Another layer shown, or the hand empty: nothing.
      f.layer = -1;
      view.draw(r.scene, ATLAS, g.sim, f, new DebugOverlayList());
      expect(view.stats.item).toBeNull();
      f.layer = 0;
      g.aimAt(home.tx - 1, home.ty);
      g.click();
      g.frame(1);
      expect(g.inventory.count('schlinge')).toBe(0);
      view.draw(r.scene, ATLAS, g.sim, f, new DebugOverlayList());
      expect(view.stats.item).toBeNull();
    },
  );
  it('deterministisch: zweimal dieselbe Eingabe gibt denselben Stand, und ein Stand mit gesetzter Falle läuft nach dem Laden gleich weiter', () => {
    const run = () => {
      const g = game();
      const home = g.openGround();
      g.hold('kastenfalle', 2);
      g.aimAt(home.tx + 1, home.ty);
      g.click();
      g.aimAt(home.tx, home.ty + 1);
      g.frame(30);
      return g;
    };
    const a = run();
    const b = run();
    expect(a.traps.traps).toHaveLength(1);
    expect(a.interaction.focus).toMatchObject({ hand: 'kastenfalle', handBlock: null });
    expect(captureSimulation(a.sim).hash).toBe(captureSimulation(b.sim).hash);
    // Saved with the trap set and the second one in the hand: the loaded run and the uninterrupted one stay alike.
    const saved = captureSimulation(a.sim);
    const c = restoreSimulation(saved.config, saved.snapshot);
    for (let i = 0; i < 120; i++) {
      a.sim.step();
      c.step();
    }
    expect(captureSimulation(c).hash).toBe(captureSimulation(a.sim).hash);
  });
});
