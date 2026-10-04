/**
 * Figures with equipment layers (MASTERPROMPT §4.5 "Ausrüstung als Layer (Kopf, Körper, Beine,
 * Waffe, Nebenhand) mit Hand-Sockeln pro Frame", "Tragen"). Body clips are named `<action>_<direction>`.
 * Socket layers (helmet, weapon, off-hand, a carried load) put their anchor on the body's socket point
 * of the current frame; overlay layers (body armour, legs) share the body's frame index. The draw order
 * depends on the direction (weapon behind the body when facing away; a load held over the head in front
 * of everything). A figure is mirrored only when the body and every attached item are symmetric;
 * otherwise its left clips must exist.
 *
 * Socket items stand on the figure's ground (M6-Gate, the shadow of a helmet): the sun's silhouette pass and the G-buffer
 * read a sprite's anchor line as the ground it stands on and its height base as the height of that line. A socket item is
 * therefore emitted at the figure's feet (`d.y` = the feet, `heightBase` = the figure's) with a copy of its frame whose
 * anchor is moved down by the socket's height (`groundedFrame`): the same pixels on screen and the same heights, but its
 * shadow falls from the feet like the body's – anchored on the socket, a helmet cast its shadow a socket's height north of
 * the figure, detached. A weapon turned about its grip (`FigureState.handAngle` ≠ 0) keeps the grip as its anchor: the
 * renderer turns a sprite about its anchor. An item may carry clips drawn turned by 45° (`TURNED_CLIP_SUFFIX`): aimed
 * beyond half a step from the facing, the weapon shows them and turns only by the rest.
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

/** Figure slots; `fuesse` (boots over the trousers, M6-12) comes last so the bits of the older slots stay. */
export const EQUIPMENT_SLOTS = ['kopf', 'koerper', 'beine', 'waffe', 'nebenhand', 'last', 'fuesse'] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

/** Socket of each slot; `null` = overlay layer drawn with the body's frame index. */
export const SLOT_SOCKET: Readonly<Record<EquipmentSlot, string | null>> = {
  kopf: 'kopf',
  koerper: null,
  beine: null,
  fuesse: null,
  waffe: 'hand',
  nebenhand: 'nebenhand',
  last: 'last',
};

/** Bit of `slot` in `FigureState.hidden`. */
export function slotBit(slot: EquipmentSlot): number {
  return 1 << EQUIPMENT_SLOTS.indexOf(slot);
}

/** Bit of the main hand in `FigureState.hidden`. */
const HAND_BIT = slotBit('waffe');

/** The slots held in the hands: main hand, off hand and a carried load. */
export const HAND_SLOTS_MASK = slotBit('waffe') | slotBit('nebenhand') | slotBit('last');

/** One step of an item drawn turned (`TURNED_CLIP_SUFFIX`): 45° [rad] – the diagonals between the four facings. */
export const TURN_STEP = Math.PI / 4;

/**
 * Suffixes of an item's clips drawn turned by one `TURN_STEP` (M6-Gate, the bow aimed diagonally):
 * `<aktion>_<richtung>_rechtsrum` clockwise on screen, `_linksrum` counter-clockwise – position for position the clip
 * `<aktion>_<richtung>`. Where its frame differs from that clip's, the item is drawn there already turned by the step (a
 * drawn bow at 45°, drawn by hand instead of turned pixel by pixel), and a hand angle beyond half a step uses it and turns
 * it only by the rest; where both clips show the same frame, the frame turns by the whole angle as before.
 */
export const TURNED_CLIP_SUFFIX = { cw: '_rechtsrum', ccw: '_linksrum' } as const;

export type FigurePart = EquipmentSlot | 'body';

/**
 * Back to front per direction. Facing the viewer both hands are in front; facing away both are
 * behind; in profile the near hand is in front (right hand facing right, left hand facing left). Boots
 * (`fuesse`) are drawn over the trousers, the body layer (tunic, cuirass) over both.
 */
export const FIGURE_LAYER_ORDER: Readonly<Record<Direction, readonly FigurePart[]>> = {
  down: ['body', 'beine', 'fuesse', 'koerper', 'kopf', 'nebenhand', 'waffe', 'last'],
  up: ['waffe', 'nebenhand', 'body', 'beine', 'fuesse', 'koerper', 'kopf', 'last'],
  right: ['nebenhand', 'body', 'beine', 'fuesse', 'koerper', 'kopf', 'waffe', 'last'],
  left: ['waffe', 'body', 'beine', 'fuesse', 'koerper', 'kopf', 'nebenhand', 'last'],
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
  /**
   * Rotation of the item in the main hand (`waffe`) about its grip – the anchor on the hand socket – in radians, clockwise on
   * screen (M6-01: the weapon turns freely towards the aim in the low-res buffer; 0 = as drawn).
   */
  handAngle: number;
}

export function defaultFigureState(): FigureState {
  return { x: 0, y: 0, direction: 'down', action: 'idle', time: 0, itemTime: 0, paletteRow: 0, layer: 'objects', heightBase: 0, outline: false, flash: false, hidden: 0, tint: 0, tintStrength: 0, handAngle: 0 };
}

/**
 * A frame of the atlas with its anchor moved (`groundedFrame`): the same atlas rectangle, the anchor `drop` px lower. One
 * record per rig layer, rewritten for every sprite it emits (the sprite list copies the numbers when it is pushed).
 */
export class GroundedFrame implements SpriteFrameRef {
  x = 0;
  y = 0;
  w = 0;
  h = 0;
  ax = 0;
  ay = 0;
  /** The atlas frame it was copied from (`atlasFrameOf`). */
  source: SpriteFrameRef | null = null;
}

/** The atlas frame behind `frame`: the source of a grounded copy (`groundedFrame`), else `frame` itself. */
export function atlasFrameOf(frame: SpriteFrameRef): SpriteFrameRef {
  return frame instanceof GroundedFrame && frame.source !== null ? frame.source : frame;
}

/**
 * `frame` with its anchor `drop` px further down (into `out`): a socket item drawn from the figure's feet instead of its
 * socket – the anchor line is the ground the sprite stands on, `drop` the socket's height above the feet. Returns `out`.
 */
export function groundedFrame(frame: SpriteFrameRef, drop: number, out: GroundedFrame): GroundedFrame {
  out.x = frame.x;
  out.y = frame.y;
  out.w = frame.w;
  out.h = frame.h;
  out.ax = frame.ax;
  out.ay = frame.ay + drop;
  out.source = frame;
  return out;
}

/**
 * Where the main hand points in the last emitted figure (M6-Gate, the charged blow's glint): the `wirkpunkt` socket of the
 * item in the hand – the middle of a blade, the head of a club or axe, the tip of a spear – turned with the item about its
 * grip and mirrored with it; without an item (or one without that socket) the hand socket itself. `x` and `y` are the point
 * on screen in world px, `z` its height above the figure's feet line (so `y + z` is that line); `drawn` false when the
 * figure showed no hand (hidden, or a body without a hand socket).
 */
export class HandPoint {
  x = 0;
  y = 0;
  z = 0;
  drawn = false;
  /** Whether the point is an item's `wirkpunkt` (false: the bare hand). */
  item = false;
}

/** The `wirkpunkt` socket of item `sprite` in frame `index`, or null. */
function wirkpunkt(sprite: AtlasSprite, index: number): readonly [number, number] | null {
  return sprite.sockets['wirkpunkt']?.[index] ?? null;
}

/**
 * Fills `out` with the `wirkpunkt` of item `sprite` in its frame `index` drawn with its grip (the frame's anchor) at
 * (`gripX`, `gripY`), mirrored when `mirror`, turned by `angle` (clockwise on screen, as the renderer turns it), over the
 * feet line `feetY`; without that socket the grip itself. Returns `out`.
 */
export function handPointOf(sprite: AtlasSprite, index: number, gripX: number, gripY: number, mirror: boolean, angle: number, feetY: number, out: HandPoint): HandPoint {
  const frame = spriteFrame(sprite, index);
  const w = wirkpunkt(sprite, index);
  let rx = 0;
  let ry = 0;
  if (w !== null) {
    // Pixel centre relative to the anchor (anchors are pixel edges); mirrored about the anchor, then turned (sprite_gbuffer.vert).
    rx = w[0] + 0.5 - frame.ax;
    ry = w[1] + 0.5 - frame.ay;
    if (mirror) rx = -rx;
    if (angle !== 0) {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const tx = c * rx - s * ry;
      ry = s * rx + c * ry;
      rx = tx;
    }
  }
  out.x = gripX + rx;
  out.y = gripY + ry;
  out.z = feetY - out.y;
  out.drawn = true;
  out.item = w !== null;
  return out;
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
  /** The layer's frame moved to the figure's feet, rewritten per emitted sprite (socket layers, `groundedFrame`). */
  readonly grounded: GroundedFrame;
  /** Clips of body actions the item plays on the body's time (`<aktion>_<richtung>`), by action. */
  readonly actionClips: ReadonlyMap<string, DirectionalClips>;
  /** The same clips drawn turned by a step clockwise and counter-clockwise (`TURNED_CLIP_SUFFIX`), by action. */
  readonly turnedCw: ReadonlyMap<string, DirectionalClips>;
  readonly turnedCcw: ReadonlyMap<string, DirectionalClips>;
}

/**
 * Clips `<action>_<direction><suffix>` of an item for every body action it has in all directions (mirrored sides for
 * symmetric items); `suffix` names a turned variant (`TURNED_CLIP_SUFFIX`).
 */
function itemActionClips(sprite: AtlasSprite, actions: readonly string[], suffix = ''): Map<string, DirectionalClips> {
  const out = new Map<string, DirectionalClips>();
  for (const action of actions) {
    const clips: Partial<Record<Direction, AnimationClip>> = {};
    let any = false;
    for (const d of DIRECTIONS) {
      const c = sprite.clips[`${action}_${d}${suffix}`];
      if (c) {
        clips[d] = c;
        any = true;
      }
    }
    if (!any) continue;
    const set: DirectionalClips = { name: `${sprite.id}.${action}${suffix}`, symmetric: sprite.symmetric, clips };
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
  private readonly turnResolved: ResolvedClip = { clip: null, mirror: false };
  private readonly offset = { x: 0, y: 0 };
  /** The body clip, its mirroring, source side and frame of the last `emit` (`begin`; `current` null: nothing drawn). */
  private current: AnimationClip | null = null;
  private mirrored = false;
  private sourceDir: Direction = 'down';
  private bodyIndex = 0;
  private bodyFrame: SpriteFrameRef | null = null;
  /** Where the main hand pointed in the last `emit` (the item's `wirkpunkt`, else the hand socket; `HandPoint`). */
  readonly handPoint = new HandPoint();
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
      const none = new Map<string, DirectionalClips>();
      const actionClips = socket === null ? none : itemActionClips(def.sprite, actionNames);
      const turnedCw = socket === null ? none : itemActionClips(def.sprite, actionNames, TURNED_CLIP_SUFFIX.cw);
      const turnedCcw = socket === null ? none : itemActionClips(def.sprite, actionNames, TURNED_CLIP_SUFFIX.ccw);
      this.layers.set(def.slot, { def, socket, bit: slotBit(def.slot), clips, grounded: new GroundedFrame(), actionClips, turnedCw, turnedCcw });
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
    if (!this.begin(s)) return;
    const order = this.drawOrder[this.sourceDir];
    for (let i = 0; i < order.length; i++) {
      const layer = order[i];
      if (layer === undefined || (layer !== null && (s.hidden & layer.bit) !== 0)) continue;
      this.emitPart(list, d, s, layer);
    }
  }

  /**
   * Pushes the layer of `slot` as the last `emit` of `s` placed it – same body frame, socket, item frame and turn – after
   * everything that emit pushed (`PlayerRig`: the main hand over the back facing away, the shield before the body in a
   * block). Nothing when the rig has no such layer or the last emit drew no body.
   */
  protected emitSlot(list: SpriteList, d: SpriteDesc, s: FigureState, slot: EquipmentSlot): void {
    const layer = this.layers.get(slot);
    if (layer === undefined || this.current === null) return;
    this.emitPart(list, d, s, layer);
  }

  /** Resolves the body clip and frame of `s` for `emitPart` (false: no clip in that direction) and the bare hand's point. */
  private begin(s: FigureState): boolean {
    const set = this.actions.get(s.action);
    if (!set) throw new Error(`Figur ${this.body.id}: Aktion ${s.action} fehlt`);
    const r = resolveDirection(set, s.direction, this.resolved);
    this.current = r.clip;
    if (r.clip === null) return false;
    const mirror = r.mirror;
    this.mirrored = mirror;
    // A mirrored figure is the mirror image of its source side, including the layer order.
    this.sourceDir = mirror ? (s.direction === 'left' ? 'right' : 'left') : s.direction;
    this.bodyIndex = clipFrameAt(r.clip, s.time);
    this.bodyFrame = spriteFrame(this.body, this.bodyIndex);
    this.handAt(this.bodyIndex, this.bodyFrame, mirror, s);
    return true;
  }

  /** Pushes one part of the figure resolved by `begin` (`null` = the body). */
  private emitPart(list: SpriteList, d: SpriteDesc, s: FigureState, layer: RigLayer | null): void {
    const clip = this.current;
    const bodyFrame = this.bodyFrame;
    if (clip === null || bodyFrame === null) return;
    const bodyIndex = this.bodyIndex;
    const mirror = this.mirrored;
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
      return;
    }
    if (layer.def.paletteRow !== undefined) d.paletteRow = layer.def.paletteRow;
    if (layer.socket === null) {
      d.frame = spriteFrame(layer.def.sprite, bodyIndex);
      d.mirror = mirror;
      list.push(d);
      return;
    }
    const point = this.body.sockets[layer.socket]?.[bodyIndex];
    if (!point) return;
    socketOffset(bodyFrame, point, mirror, this.offset);
    // The item's clip of the body action runs on the body's frame positions; otherwise its hold clip on its own time.
    const acted = layer.actionClips.get(s.action);
    const ir = resolveDirection(acted ?? layer.clips, this.sourceDir, this.itemResolved);
    const itemClip = ir.clip;
    if (itemClip === null) return;
    const position = acted === undefined ? -1 : Math.min(clipPositionAt(clip, s.time), itemClip.frames.length - 1);
    let itemIndex = position < 0 ? clipFrameAt(itemClip, s.itemTime) : (itemClip.frames[position] ?? 0);
    const itemMirror = mirror !== ir.mirror;
    let angle = layer.def.slot === 'waffe' ? s.handAngle : 0;
    if (position >= 0 && (angle > TURN_STEP / 2 || angle < -TURN_STEP / 2)) {
      // Drawn turned by a step where the item has such a frame (`TURNED_CLIP_SUFFIX`): the renderer turns only the rest.
      // A mirrored picture turns the other way round than its source.
      const set = ((angle > 0) !== itemMirror ? layer.turnedCw : layer.turnedCcw).get(s.action);
      const turnedClip = set === undefined ? null : resolveDirection(set, this.sourceDir, this.turnResolved).clip;
      const turned = turnedClip === null ? itemIndex : (turnedClip.frames[Math.min(position, turnedClip.frames.length - 1)] ?? itemIndex);
      if (turned !== itemIndex) {
        itemIndex = turned;
        angle -= angle > 0 ? TURN_STEP : -TURN_STEP;
      }
    }
    d.mirror = itemMirror;
    d.x = s.x + this.offset.x;
    if (angle !== 0) {
      // Turned about its grip: the grip stays the anchor (the renderer turns a sprite about it).
      d.frame = spriteFrame(layer.def.sprite, itemIndex);
      d.y = s.y + this.offset.y;
      d.heightBase = s.heightBase - this.offset.y;
      d.rotation = angle;
    } else {
      // On the figure's ground: the same pixels, the anchor line on the feet (its shadow falls from there).
      d.frame = groundedFrame(spriteFrame(layer.def.sprite, itemIndex), -this.offset.y, layer.grounded);
      d.y = s.y;
    }
    if (layer.def.slot === 'waffe') handPointOf(layer.def.sprite, itemIndex, s.x + this.offset.x, s.y + this.offset.y, itemMirror, angle, s.y, this.handPoint);
    list.push(d);
  }

  /** The bare hand's socket as the hand point of body frame `bodyIndex` (the item, if drawn, replaces it in `emitPart`). */
  private handAt(bodyIndex: number, bodyFrame: SpriteFrameRef, mirror: boolean, s: FigureState): void {
    const h = this.handPoint;
    const point = this.body.sockets['hand']?.[bodyIndex] ?? null;
    if (point === null || (s.hidden & HAND_BIT) !== 0) {
      h.drawn = false;
      h.item = false;
      return;
    }
    socketOffset(bodyFrame, point, mirror, this.offset);
    h.x = s.x + this.offset.x + 0.5;
    h.y = s.y + this.offset.y + 0.5;
    h.z = s.y - h.y;
    h.drawn = true;
    h.item = false;
  }
}
