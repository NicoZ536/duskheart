/**
 * Figures with equipment layers (MASTERPROMPT §4.5 "Ausrüstung als Layer (Kopf, Körper, Beine,
 * Waffe, Nebenhand) mit Hand-Sockeln pro Frame"). Body clips are named `<action>_<direction>`.
 * Socket layers (helmet, weapon, off-hand) put their anchor on the body's socket point of the current
 * frame; overlay layers (body armour, legs) share the body's frame index. The draw order depends on
 * the direction (weapon behind the body when facing away). A figure is mirrored only when the body
 * and every attached item are symmetric; otherwise its left clips must exist.
 */
import type { SpriteDesc, SpriteFrameRef, SpriteList } from '../batch/spriteList';
import type { SpriteLayer } from '../batch/spriteLayout';
import { spriteFrame, type AtlasSprite } from '../assets/atlas';
import { clipFrameAt, DIRECTIONS, resolveDirection, validateDirectional, type AnimationClip, type ClipKind, type Direction, type DirectionalClips, type ResolvedClip } from './animation';

export const EQUIPMENT_SLOTS = ['kopf', 'koerper', 'beine', 'waffe', 'nebenhand'] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

/** Socket of each slot; `null` = overlay layer drawn with the body's frame index. */
export const SLOT_SOCKET: Readonly<Record<EquipmentSlot, string | null>> = {
  kopf: 'kopf',
  koerper: null,
  beine: null,
  waffe: 'hand',
  nebenhand: 'nebenhand',
};

export type FigurePart = EquipmentSlot | 'body';

/**
 * Back to front per direction. Facing the viewer both hands are in front; facing away both are
 * behind; in profile the near hand is in front (right hand facing right, left hand facing left).
 */
export const FIGURE_LAYER_ORDER: Readonly<Record<Direction, readonly FigurePart[]>> = {
  down: ['body', 'beine', 'koerper', 'kopf', 'nebenhand', 'waffe'],
  up: ['waffe', 'nebenhand', 'body', 'beine', 'koerper', 'kopf'],
  right: ['nebenhand', 'body', 'beine', 'koerper', 'kopf', 'waffe'],
  left: ['waffe', 'body', 'beine', 'koerper', 'kopf', 'nebenhand'],
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
}

export function defaultFigureState(): FigureState {
  return { x: 0, y: 0, direction: 'down', action: 'idle', time: 0, itemTime: 0, paletteRow: 0, layer: 'objects', heightBase: 0, outline: false, flash: false };
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
  readonly clips: DirectionalClips;
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
      this.layers.set(def.slot, { def, socket, clips });
    }
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
    const order = FIGURE_LAYER_ORDER[sourceDir];
    for (let i = 0; i < order.length; i++) {
      const part = order[i];
      d.reset();
      d.x = s.x;
      d.y = s.y;
      d.depth = s.y;
      d.layer = s.layer;
      d.outline = s.outline;
      d.flash = s.flash;
      d.heightBase = s.heightBase;
      d.paletteRow = s.paletteRow;
      if (part === 'body') {
        d.frame = bodyFrame;
        d.mirror = mirror;
        list.push(d);
        continue;
      }
      const layer = part === undefined ? undefined : this.layers.get(part);
      if (!layer) continue;
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
      const ir = resolveDirection(layer.clips, sourceDir, this.itemResolved);
      if (ir.clip === null) continue;
      d.frame = spriteFrame(layer.def.sprite, clipFrameAt(ir.clip, s.itemTime));
      d.mirror = mirror !== ir.mirror;
      d.x = s.x + this.offset.x;
      d.y = s.y + this.offset.y;
      d.heightBase = s.heightBase - this.offset.y;
      list.push(d);
    }
  }
}
