/**
 * Figures with equipment layers (MASTERPROMPT §4.5 "Ausrüstung als Layer (Kopf, Körper, Beine,
 * Waffe, Nebenhand) mit Hand-Sockeln pro Frame", "Tragen"). Body clips are named `<action>_<direction>`.
 * Socket layers (helmet, weapon, off-hand, a carried load) put their anchor on the body's socket point
 * of the current frame; overlay layers (body armour, legs) share the body's frame index. The draw order
 * depends on the direction (weapon behind the body when facing away; a load held over the head in front
 * of everything). A figure is mirrored only when the body and every attached item are symmetric;
 * otherwise its left clips must exist.
 *
 * Items in the hands animate in one of two ways (M3-07): an item with clips of the body's action
 * (`<aktion>_<richtung>`, e.g. `tool_right`, `tool_licht_right` for the swing of an axe) plays them on the
 * body clip's time – frame position for frame position, so the axe head follows the arm; otherwise it
 * shows its hold clip (`down`, `up`, `right`, `left`) on its own time (a torch flame flickers on while the
 * body walks). `FigureState.hidden` hides slots for a frame (the hands during a roll, a swim, sleep and
 * death).
 */
import type { SpriteDesc, SpriteFrameRef, SpriteList } from '../batch/spriteList';
import type { SpriteLayer } from '../batch/spriteLayout';
import { spriteFrame, type AtlasSprite } from '../assets/atlas';
import { clipFrameAt, clipPositionAt, DIRECTIONS, resolveDirection, validateDirectional, type AnimationClip, type ClipKind, type Direction, type DirectionalClips, type ResolvedClip } from './animation';

export const EQUIPMENT_SLOTS = ['kopf', 'koerper', 'beine', 'waffe', 'nebenhand', 'last'] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

/** Socket of each slot; `null` = overlay layer drawn with the body's frame index. */
export const SLOT_SOCKET: Readonly<Record<EquipmentSlot, string | null>> = {
  kopf: 'kopf',
  koerper: null,
  beine: null,
  waffe: 'hand',
  nebenhand: 'nebenhand',
  last: 'last',
};

/** Bit of `slot` in `FigureState.hidden`. */
export function slotBit(slot: EquipmentSlot): number {
  return 1 << EQUIPMENT_SLOTS.indexOf(slot);
}

/** The slots held in the hands: main hand, off hand and a carried load. */
export const HAND_SLOTS_MASK = slotBit('waffe') | slotBit('nebenhand') | slotBit('last');

export type FigurePart = EquipmentSlot | 'body';

/**
 * Back to front per direction. Facing the viewer both hands are in front; facing away both are
 * behind; in profile the near hand is in front (right hand facing right, left hand facing left).
 */
export const FIGURE_LAYER_ORDER: Readonly<Record<Direction, readonly FigurePart[]>> = {
  down: ['body', 'beine', 'koerper', 'kopf', 'nebenhand', 'waffe', 'last'],
  up: ['waffe', 'nebenhand', 'body', 'beine', 'koerper', 'kopf', 'last'],
  right: ['nebenhand', 'body', 'beine', 'koerper', 'kopf', 'waffe', 'last'],
  left: ['waffe', 'body', 'beine', 'koerper', 'kopf', 'nebenhand', 'last'],
};

export interface FigureLayerDef {
  readonly slot: EquipmentSlot;
  /** Item sprite: clips named by direction (`down`, `up`, `right`, optional `left`). */
  readonly sprite: AtlasSprite;
  readonly paletteRow?: number;
}

export interface FigureState {
  /** Anchor (feet) in world px, interpolated. */
  x: number;
  y: number;
  direction: Direction;
  /** Body action, e.g. `idle` or `walk` (clips `<action>_<direction>`). */
  action: string;
  /** Seconds since the action started. */
  time: number;
  /** Seconds for item animations (torch flames run independently of the body). */
  itemTime: number;
  paletteRow: number;
  layer: SpriteLayer;
  heightBase: number;
  outline: boolean;
  flash: boolean;
  /** Slots not drawn this frame (bits of `slotBit`, e.g. `HAND_SLOTS_MASK` while rolling). */
  hidden: number;
  /** Overlay colour of the whole figure (0xRRGGBB) and its strength 0…1 (0 = none; a freezing player's cold pallor). */
  tint: number;
  tintStrength: number;
}

export function defaultFigureState(): FigureState {
  return { x: 0, y: 0, direction: 'down', action: 'idle', time: 0, itemTime: 0, paletteRow: 0, layer: 'objects', heightBase: 0, outline: false, flash: false, hidden: 0, tint: 0, tintStrength: 0 };
}

/** Offset of a socket point from the frame's anchor (x negated when mirrored). */
export function socketOffset(frame: SpriteFrameRef, point: readonly [number, number], mirror: boolean, out: { x: number; y: number }): { x: number; y: number } {
  const dx = point[0] - frame.ax;
  out.x = mirror ? -dx : dx;
  out.y = point[1] - frame.ay;
  return out;
}

interface RigLayer {
  readonly def: FigureLayerDef;
  readonly socket: string | null;
  readonly bit: number;
  /** Hold clips by direction (socket layers). */
  readonly clips: DirectionalClips;
  /** Clips of body actions the item plays on the body's time (`<aktion>_<richtung>`), by action. */
  readonly actionClips: ReadonlyMap<string, DirectionalClips>;
}

/** Clips `<action>_<direction>` of an item for every body action it has in all directions (mirrored sides for symmetric items). */
function itemActionClips(sprite: AtlasSprite, actions: readonly string[]): Map<string, DirectionalClips> {
  const out = new Map<string, DirectionalClips>();
  for (const action of actions) {
    const clips: Partial<Record<Direction, AnimationClip>> = {};
    let any = false;
    for (const d of DIRECTIONS) {
      const c = sprite.clips[`${action}_${d}`];
      if (c) {
        clips[d] = c;
        any = true;
      }
    }
    if (!any) continue;
    const set: DirectionalClips = { name: `${sprite.id}.${action}`, symmetric: sprite.symmetric, clips };
    validateDirectional(set, 'effect');
    out.set(action, set);
  }
  return out;
}

/** Directional clips of an item sprite (clips named after the directions). */
function itemClips(sprite: AtlasSprite): DirectionalClips {
  const clips: Partial<Record<Direction, AnimationClip>> = {};
  for (const d of DIRECTIONS) {
    const c = sprite.clips[d];
    if (c) clips[d] = c;
  }
  return { name: sprite.id, symmetric: sprite.symmetric, clips };
}

/** A body with its equipment; validated once, emitted every frame without allocation. */
export class FigureRig {
  readonly symmetric: boolean;
  private readonly actions = new Map<string, DirectionalClips>();
  private readonly layers = new Map<EquipmentSlot, RigLayer>();
  private readonly resolved: ResolvedClip = { clip: null, mirror: false };
  private readonly itemResolved: ResolvedClip = { clip: null, mirror: false };
  private readonly offset = { x: 0, y: 0 };
  /**
   * Per source direction the parts this rig carries, back to front (`null` = the body): built once,
   * so `emit` touches only what is drawn (one push per part, no lookups of empty slots).
   */
  private readonly drawOrder: Readonly<Record<Direction, readonly (RigLayer | null)[]>>;

  constructor(
    readonly body: AtlasSprite,
    actionNames: readonly string[],
    layers: readonly FigureLayerDef[],
    kind: ClipKind = 'figure',
  ) {
    // Mirroring swaps the hands: only a loadout with the same thing (or nothing) in both hands and
    // only symmetric sprites may be mirrored.
    const inHand = (slot: EquipmentSlot): string | null => layers.find((l) => l.slot === slot)?.sprite.id ?? null;
    this.symmetric = body.symmetric && layers.every((l) => l.sprite.symmetric) && inHand('waffe') === inHand('nebenhand');
    for (const action of actionNames) {
      const clips: Partial<Record<Direction, AnimationClip>> = {};
      for (const d of DIRECTIONS) {
        const c = body.clips[`${action}_${d}`];
        if (c) clips[d] = c;
      }
      const set: DirectionalClips = { name: `${body.id}.${action}`, symmetric: this.symmetric, clips };
      validateDirectional(set, kind);
      this.actions.set(action, set);
    }
    for (const def of layers) {
      if (this.layers.has(def.slot)) throw new Error(`Figur ${body.id}: Slot ${def.slot} doppelt belegt`);
      const socket = SLOT_SOCKET[def.slot];
      if (socket !== null && !body.sockets[socket]) throw new Error(`Figur ${body.id}: Sockel ${socket} fehlt für ${def.slot}`);
      const clips = itemClips(def.sprite);
      if (socket !== null) validateDirectional(clips, 'effect');
      else if (def.sprite.frames.length !== body.frames.length) throw new Error(`Figur ${body.id}: ${def.slot} braucht ${body.frames.length} Frames wie der Körper`);
      const actionClips = socket === null ? new Map<string, DirectionalClips>() : itemActionClips(def.sprite, actionNames);
      this.layers.set(def.slot, { def, socket, bit: slotBit(def.slot), clips, actionClips });
    }
    this.drawOrder = { down: this.partsFor('down'), up: this.partsFor('up'), right: this.partsFor('right'), left: this.partsFor('left') };
  }

  /** The parts of FIGURE_LAYER_ORDER[dir] this rig carries (`null` = the body). */
  private partsFor(dir: Direction): (RigLayer | null)[] {
    const parts: (RigLayer | null)[] = [];
    for (const part of FIGURE_LAYER_ORDER[dir]) {
      if (part === 'body') parts.push(null);
      else {
        const layer = this.layers.get(part);
        if (layer) parts.push(layer);
      }
    }
    return parts;
  }

  /** The body clip shown for `action` towards `direction` (its own or the mirrored side), or null for an unknown action. */
  bodyClip(action: string, direction: Direction): AnimationClip | null {
    const set = this.actions.get(action);
    return set === undefined ? null : resolveDirection(set, direction, this.resolved).clip;
  }

  /** Pushes the figure's sprites (body and layers) in draw order. */
  emit(list: SpriteList, d: SpriteDesc, s: FigureState): void {
    const set = this.actions.get(s.action);
    if (!set) throw new Error(`Figur ${this.body.id}: Aktion ${s.action} fehlt`);
    const r = resolveDirection(set, s.direction, this.resolved);
    const clip = r.clip;
    if (clip === null) return;
    const mirror = r.mirror;
    // A mirrored figure is the mirror image of its source side, including the layer order.
    const sourceDir: Direction = mirror ? (s.direction === 'left' ? 'right' : 'left') : s.direction;
    const bodyIndex = clipFrameAt(clip, s.time);
    const bodyFrame = spriteFrame(this.body, bodyIndex);
    const order = this.drawOrder[sourceDir];
    for (let i = 0; i < order.length; i++) {
      const layer = order[i];
      if (layer === undefined || (layer !== null && (s.hidden & layer.bit) !== 0)) continue;
      d.reset();
      d.x = s.x;
      d.y = s.y;
      d.depth = s.y;
      d.layer = s.layer;
      d.outline = s.outline;
      d.flash = s.flash;
      d.heightBase = s.heightBase;
      d.paletteRow = s.paletteRow;
      if (s.tintStrength > 0) {
        d.tintR = (s.tint >> 16) & 0xff;
        d.tintG = (s.tint >> 8) & 0xff;
        d.tintB = s.tint & 0xff;
        d.tintStrength = s.tintStrength;
      }
      if (layer === null) {
        d.frame = bodyFrame;
        d.mirror = mirror;
        list.push(d);
        continue;
      }
      if (layer.def.paletteRow !== undefined) d.paletteRow = layer.def.paletteRow;
      if (layer.socket === null) {
        d.frame = spriteFrame(layer.def.sprite, bodyIndex);
        d.mirror = mirror;
        list.push(d);
        continue;
      }
      const point = this.body.sockets[layer.socket]?.[bodyIndex];
      if (!point) continue;
      socketOffset(bodyFrame, point, mirror, this.offset);
      // The item's clip of the body action runs on the body's frame positions; otherwise its hold clip on its own time.
      const acted = layer.actionClips.get(s.action);
      const ir = resolveDirection(acted ?? layer.clips, sourceDir, this.itemResolved);
      const itemClip = ir.clip;
      if (itemClip === null) continue;
      const itemIndex = acted === undefined ? clipFrameAt(itemClip, s.itemTime) : (itemClip.frames[Math.min(clipPositionAt(clip, s.time), itemClip.frames.length - 1)] ?? 0);
      d.frame = spriteFrame(layer.def.sprite, itemIndex);
      d.mirror = mirror !== ir.mirror;
      d.x = s.x + this.offset.x;
      d.y = s.y + this.offset.y;
      d.heightBase = s.heightBase - this.offset.y;
      list.push(d);
    }
  }
}
