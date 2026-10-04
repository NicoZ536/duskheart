/**
 * Preview of setting a thing up from the hand (M6-30; MASTERPROMPT §2.2 "Alles ist erreichbar und erklärt", §14 "Fallen
 * (Schlinge, Kastenfalle)"; the build mode's ghost, §16.6 "Geister-Vorschau grün/rot mit Grund"): with a trap in the hand
 * the interaction's focus names the tile the primary button would set it up on and the reason `trap.place` would refuse
 * it there (`InteractionFocus.hand*`, src/game/interaction/hand.ts, the trap system's own rules). This view draws it there
 * like a build ghost – the trap's icon (the sprite a set trap stands with, src/render/game/creatures.ts) tinted green or
 * red and half dithered, over an unlit field of the same colour so it reads by night too – and a refusal's short text
 * (`ui.bau.grund.<reason>`: "Blockiert", "Zu weit") over the tile in the red of the world UI. In build mode the primary
 * button is the build mode's: the game view does not draw it then. It only reads the simulation; nothing per frame is
 * allocated (the icon is looked up once per item and atlas).
 */
import { InteractionSystem } from '../../game/interaction/system';
import type { Simulation } from '../../game/sim';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { DebugOverlayList } from '../debugOverlay';
import type { RenderScene } from '../scene';
import { iconSprite } from './drops';
import { GHOST_COLORS, GHOST_LOOK, LABEL_LIFT, edges } from './ghost';

/** What the game view hands the preview per frame (a record it keeps). */
export interface PlacementFrame {
  /** The layer shown. */
  layer: Layer;
  /** The build mode is on (its ghost owns the primary button): no preview. */
  building: boolean;
  /** Level of tile (tx, ty) (the preview stands on its ground like a set trap). */
  levelAt: (tx: number, ty: number) => number;
  /** The short text of a refusal reason (`ui.bau.grund.*`), or null without translations. */
  reasonLabel: (reason: string) => string | null;
}

/** A fresh frame record. */
export function createPlacementFrame(): PlacementFrame {
  return { layer: 0, building: false, levelAt: () => 0, reasonLabel: () => null };
}

/** What the preview drew in the last frame (game view info, E2E). */
export interface PlacementStats {
  /** The item previewed, or `null`. */
  item: string | null;
  tx: number;
  ty: number;
  /** The reason it is refused there, or `null` (green). */
  block: string | null;
  /** Sprites and fields drawn. */
  drawn: number;
}

/** Draws the preview of the thing in the hand on its target tile (see module comment). */
export class HandPlacementView {
  readonly stats: PlacementStats = { item: null, tx: 0, ty: 0, block: null, drawn: 0 };
  private systems: { readonly sim: Simulation; readonly interaction: InteractionSystem | null } | null = null;
  private manifest: AtlasManifest | null = null;
  private readonly icons = new Map<string, AtlasSprite | null>();

  /** Draws the preview of the hand's target, if the focus names one on the frame's layer. */
  draw(scene: RenderScene, atlas: AtlasData, sim: Simulation, f: PlacementFrame, overlay: DebugOverlayList): void {
    const st = this.stats;
    st.item = null;
    st.block = null;
    st.drawn = 0;
    if (f.building) return;
    const interaction = this.interactionOf(sim);
    if (interaction === null) return;
    const focus = interaction.focus;
    const item = focus.hand;
    if (item === null || focus.handLayer !== f.layer) return;
    const tx = focus.handTx;
    const ty = focus.handTy;
    const block = focus.handBlock;
    const ok = block === null;
    const colors = ok ? GHOST_COLORS.ok : GHOST_COLORS.refused;
    st.item = item;
    st.tx = tx;
    st.ty = ty;
    st.block = block;
    const x = (tx + 0.5) * TILE_PX;
    const y = (ty + 0.5) * TILE_PX;
    const icon = this.icon(atlas.manifest, item);
    if (icon !== null) {
      const d = scene.sprite.reset();
      d.frame = icon.frames[0] as SpriteFrameRef;
      d.x = x;
      d.y = y;
      d.heightBase = f.levelAt(tx, ty) * WAND_PX_JE_STUFE;
      d.fade = GHOST_LOOK.fade;
      d.tintR = colors.tint[0];
      d.tintG = colors.tint[1];
      d.tintB = colors.tint[2];
      d.tintStrength = ok ? GHOST_LOOK.ok : GHOST_LOOK.refused;
      scene.sprites.push(d);
      st.drawn++;
    }
    overlay.rect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX, colors.fill);
    edges(overlay, tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX, colors.edge);
    st.drawn++;
    if (block === null) return;
    const label = f.reasonLabel(block);
    if (label !== null) scene.worldUi.label(x, ty * TILE_PX - LABEL_LIFT, label, 'feind');
  }

  /** The icon sprite of `item` in `manifest` (looked up once per item and atlas), or null without one. */
  private icon(manifest: AtlasManifest, item: string): AtlasSprite | null {
    if (manifest !== this.manifest) {
      this.manifest = manifest;
      this.icons.clear();
    }
    let s = this.icons.get(item);
    if (s === undefined) {
      s = manifest.sprites[iconSprite(item)] ?? null;
      this.icons.set(item, s);
    }
    return s;
  }

  private interactionOf(sim: Simulation): InteractionSystem | null {
    if (this.systems?.sim === sim) return this.systems.interaction;
    const i = sim.system('interaction');
    this.systems = { sim, interaction: i instanceof InteractionSystem ? i : null };
    return this.systems.interaction;
  }
}
