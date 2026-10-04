/**
 * The paper doll of the inventory screen (MASTERPROMPT §26 "Inventar/Ausrüstung/Werte", §4.5 "Ausrüstung als Layer (Kopf,
 * Körper, Beine …) mit Hand-Sockeln pro Frame"; M6-42): the figure as the game view draws it, from the same atlas and
 * the same rules as the rig (`src/render/anim/figure.ts`, `src/render/game/playerFigure.ts`) – pure, so the rules are unit
 * tested (tests/unit/ui/inventar-puppe.test.ts) and `itemIcons.ts` only paints the placements.
 *
 * - **Layers** (`dollLayers`): the worn pieces on their figure layers (head, body, legs, feet; `itemFigureLayer`), the
 *   shipwrecked's own clothes (`START_CLOTHING`: tunic, trousers) only on a layer no worn piece covers – a cuirass is not
 *   drawn over the linen tunic, whose sleeves would show at its edges –, in the rig's draw order facing the viewer
 *   (`FIGURE_LAYER_ORDER.down`: legs, boots, body, head).
 * - **Placement** (`dollPlacements`): the body shows the first frame of its clip (`idle_down`); an overlay layer (tunic,
 *   cuirass, trousers, boots) shares the body's frame index and cell; a socket layer – the helmet – puts its anchor on the
 *   body's socket point of that frame (`SLOT_SOCKET.kopf`) and shows its frame of the same clip (else its hold clip
 *   `down`): a helmet is its own small sprite, not a 32 × 32 overlay, so it sits on the head only through the socket.
 *   Layers the atlas lacks, overlays of another cell size and socket layers of a body without the socket are left out.
 */
import { itemFigureLayer, itemLayerSpriteId } from '../../../content/items/index';
import type { ItemDef } from '../../../content/schema/item';
import { FIGURE_LAYER_ORDER, SLOT_SOCKET } from '../../../render/anim/figure';
import { START_CLOTHING } from '../../../render/game/playerFigure';

/** Figure layers a worn piece can cover on the doll. */
export const DOLL_LAYERS = ['kopf', 'koerper', 'beine', 'fuesse'] as const;
/** One doll layer. */
export type DollLayer = (typeof DOLL_LAYERS)[number];

/** Direction and clip of the doll: the figure faces the viewer at rest. */
export const DOLL_DIRECTION = 'down';
export const DOLL_CLIP = `idle_${DOLL_DIRECTION}`;

/** A layer of the doll: its figure layer and sprite (`ausruestung_<item>`). */
export interface DollLayerSprite {
  readonly slot: DollLayer;
  readonly sprite: string;
}

/** What the placement reads of an atlas sprite (the generated manifest's shape). */
export interface DollSprite {
  readonly size: readonly [number, number];
  readonly anchor: readonly [number, number];
  readonly sockets: Readonly<Record<string, readonly (readonly [number, number])[]>>;
  readonly frames: { readonly length: number };
  readonly clips: Readonly<Record<string, { readonly frames: readonly number[] }>>;
}

/** One sprite frame placed on the doll: the top-left corner of its cell in the body cell's coordinates [px]. */
export interface DollPlacement {
  readonly sprite: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
}

/** Equipment slots drawn on the doll and their figure layer (as the game's pose reader, `playerFigure.ts` `WORN_LAYERS`). */
export const DOLL_SLOTS = [
  ['kopf', 'kopf'],
  ['brust', 'koerper'],
  ['beine', 'beine'],
  ['fuesse', 'fuesse'],
] as const;
/** An equipment slot drawn on the doll. */
export type DollSlot = (typeof DOLL_SLOTS)[number][0];

/**
 * The pieces worn on each doll layer (item ids): the piece in the slot of that layer, when it is drawn on that layer (a cloak
 * on the back is not drawn, like in the game view). `worn` gives the item in an equipment slot.
 */
export function wornDollPieces(worn: (slot: DollSlot) => Pick<ItemDef, 'id' | 'kategorie' | 'ausruestung'> | undefined): Partial<Record<DollLayer, string>> {
  const out: Partial<Record<DollLayer, string>> = {};
  for (const [slot, layer] of DOLL_SLOTS) {
    const def = worn(slot);
    if (def !== undefined && itemFigureLayer(def) === layer) out[layer] = def.id;
  }
  return out;
}

/** The doll's layers in draw order (back to front): worn pieces, the own clothes where nothing is worn (see module comment). */
export function dollLayers(pieces: Partial<Record<DollLayer, string>>): DollLayerSprite[] {
  const out: DollLayerSprite[] = [];
  for (const part of FIGURE_LAYER_ORDER[DOLL_DIRECTION]) {
    if (!(DOLL_LAYERS as readonly string[]).includes(part)) continue;
    const slot = part as DollLayer;
    const item = pieces[slot];
    if (item !== undefined) out.push({ slot, sprite: itemLayerSpriteId(item) });
    else for (const own of START_CLOTHING) if (own.slot === slot) out.push({ slot, sprite: own.sprite });
  }
  return out;
}

/** The frame an item sprite shows for the body clip `clip`: its own clip of that action, else its hold clip, else frame 0. */
function itemFrame(sprite: DollSprite, clip: string): number {
  return sprite.clips[clip]?.frames[0] ?? sprite.clips[DOLL_DIRECTION]?.frames[0] ?? 0;
}

/**
 * The placements of body `body` and `layers` (bottom first) at the first frame of `clip`, read through `find` (the atlas);
 * empty without the body or its clip.
 */
export function dollPlacements(find: (id: string) => DollSprite | undefined, body: string, layers: readonly DollLayerSprite[], clip: string = DOLL_CLIP): DollPlacement[] {
  const b = find(body);
  const bodyFrame = b?.clips[clip]?.frames[0];
  if (b === undefined || bodyFrame === undefined) return [];
  const out: DollPlacement[] = [{ sprite: body, frame: bodyFrame, x: 0, y: 0 }];
  for (const layer of layers) {
    const s = find(layer.sprite);
    if (s === undefined) continue;
    const socket = SLOT_SOCKET[layer.slot];
    if (socket === null) {
      if (s.size[0] === b.size[0] && s.size[1] === b.size[1] && s.frames.length === b.frames.length) out.push({ sprite: layer.sprite, frame: bodyFrame, x: 0, y: 0 });
      continue;
    }
    const point = b.sockets[socket]?.[bodyFrame];
    if (point === undefined) continue;
    out.push({ sprite: layer.sprite, frame: itemFrame(s, clip), x: point[0] - s.anchor[0], y: point[1] - s.anchor[1] });
  }
  return out;
}
