/**
 * Events of building (aggregated into `SimEventMap`) – the feedback of MASTERPROMPT §2.7 ("Jede Aktion hat
 * visuelles und akustisches Feedback") for §16.1–§16.6: the renderer draws and removes parts, dust where a roof
 * came down, the audio plays the sound of the part's material at the tile (src/audio/baseSounds.ts), the build mode
 * shows why a command was refused.
 *
 * - `partPlaced`: a part (or a blueprint of it) was set on the build grid; `tx`, `ty` is its anchor.
 * - `partRemoved`: a part left the grid – dismantled (`abgebaut`), carried away by a collapse (`eingestuerzt`,
 *   §16.3), replaced by its upgrade (`aufgewertet`), fallen off its removed wall (`abgefallen`) or destroyed by
 *   damage (`zerstoert`: fire, the Schattenflut, bosses, §16.8); `refund` says
 *   what came back: the whole piece (`ganz`), a share of its materials (`anteilig`) or nothing (`keine`,
 *   blueprints).
 * - `partUpgraded`: a part was replaced in place (§16.6 "Aufwerten").
 * - `blueprintCompleted`: a blueprint was finished with the hammer.
 * - `roofCollapsed`: roof tiles without support came down (§16.3 "Staub, 50 % Material zurück"); `tiles` are the
 *   collapsed tiles as flat pairs `[tx, ty, …]` (dust on each), `x`, `y` their centre [world px].
 * - `doorToggled`: a door, gate or trapdoor opened or closed.
 * - `partDamaged`: a part lost hit points (`hp` left; at 0 it is destroyed and `partRemoved` follows).
 * - `partRepaired`: the hammer mended a damaged part to its full hit points (§16.6 "Flächenreparatur").
 * Refused commands raise `commandRejected` with a `BuildRejectReason` (texts `ui.build.reject.<reason>`).
 */
import type { BuildMaterial } from '../../content/balance/building';
import type { BuildLayer } from '../../content/buildParts';

/**
 * Why a building command had no effect (`commandRejected`; texts `ui.build.reject.<reason>`, the reasons of the
 * ghost preview, §16.6):
 * - `noPlayer`; `dead`, `asleep` – the player cannot act (§11.5, §11.6);
 * - `unknownPart` – no build part of that id; `tooFar` – beyond the build reach of 8 tiles (§16.1 "Zu weit");
 * - `blocked` – the tiles are taken or not buildable: rock, a cliff face, water, lava, a tree, a part of the same
 *   layer, the player standing there, outside the world (§16.6 "Blockiert");
 * - `noSupport` – a roof tile without a wall or pillar within its reach (§16.3 "Keine Stütze in Reichweite");
 * - `noMaterial` – the part item (or, for a repair, its materials) is neither in the bags nor in a chest near the part;
 * - `needsWater` – a jetty stands on piles in water; `needsWall` – wall furniture hangs on a wall north of its
 *   tile; `needsCliff` – a ladder leans against a cliff face, stairs lead up one height level; `notLevel` – the
 *   footprint lies on different height levels;
 * - `nothingHere` – no part on the tile; `notABlueprint` – the part is finished already; `noHammer` – finishing
 *   a blueprint needs a hammer in the hand; `notUpgradable` – the new part is of another kind or size, or the
 *   same; `notADoor` – nothing to open; `carriesLoad` – a jetty with something standing on it; `doorwayBlocked`
 *   – someone stands in the doorway;
 * - rules of other systems (M4-20, M4-21): `notEmpty` – a chest or hearth still holds items; `burning` – a lit
 *   hearth is not taken down; `hearthLimit` – three bases at most (§16.5); `hearthTooClose` – one hearth per base;
 * - area repair (M4-25): `nothingToRepair` – no damaged part in the area; `areaTooLarge` – the rectangle is wider
 *   than the build reach both ways.
 */
export const BUILD_REJECT_REASONS = [
  'noPlayer',
  'dead',
  'asleep',
  'unknownPart',
  'tooFar',
  'blocked',
  'noSupport',
  'noMaterial',
  'needsWater',
  'needsWall',
  'needsCliff',
  'notLevel',
  'nothingHere',
  'notABlueprint',
  'noHammer',
  'notUpgradable',
  'notADoor',
  'carriesLoad',
  'doorwayBlocked',
  'notEmpty',
  'burning',
  'inUse',
  'hearthLimit',
  'hearthTooClose',
  'nothingToRepair',
  'areaTooLarge',
] as const;
/** One reason a building command was refused. */
export type BuildRejectReason = (typeof BUILD_REJECT_REASONS)[number];

/** Why a part left the grid. */
export const PART_REMOVE_REASONS = ['abgebaut', 'eingestuerzt', 'aufgewertet', 'abgefallen', 'zerstoert'] as const;
/** One reason a part left the grid. */
export type PartRemoveReason = (typeof PART_REMOVE_REASONS)[number];

/** What came back of a removed part. */
export const PART_REFUNDS = ['ganz', 'anteilig', 'keine'] as const;
/** One kind of refund. */
export type PartRefund = (typeof PART_REFUNDS)[number];

export interface BuildingEventMap {
  partPlaced: {
    readonly part: string;
    readonly layer: number;
    readonly tx: number;
    readonly ty: number;
    readonly ebene: BuildLayer;
    readonly rot: number;
    readonly mirror: boolean;
    readonly blueprint: boolean;
    readonly material: BuildMaterial;
    readonly tick: number;
  };
  partRemoved: {
    readonly part: string;
    readonly layer: number;
    readonly tx: number;
    readonly ty: number;
    readonly ebene: BuildLayer;
    readonly reason: PartRemoveReason;
    readonly refund: PartRefund;
    readonly material: BuildMaterial;
    readonly tick: number;
  };
  partUpgraded: { readonly from: string; readonly to: string; readonly layer: number; readonly tx: number; readonly ty: number; readonly ebene: BuildLayer; readonly material: BuildMaterial; readonly tick: number };
  blueprintCompleted: { readonly part: string; readonly layer: number; readonly tx: number; readonly ty: number; readonly ebene: BuildLayer; readonly material: BuildMaterial; readonly tick: number };
  roofCollapsed: { readonly layer: number; readonly tiles: readonly number[]; readonly x: number; readonly y: number; readonly tick: number };
  doorToggled: { readonly part: string; readonly layer: number; readonly tx: number; readonly ty: number; readonly open: boolean; readonly tick: number };
  partDamaged: { readonly part: string; readonly layer: number; readonly tx: number; readonly ty: number; readonly ebene: BuildLayer; readonly hp: number; readonly material: BuildMaterial; readonly tick: number };
  partRepaired: { readonly part: string; readonly layer: number; readonly tx: number; readonly ty: number; readonly ebene: BuildLayer; readonly hp: number; readonly material: BuildMaterial; readonly tick: number };
}

/** Event names of `BuildingEventMap`. */
export const BUILDING_EVENT_TYPES = ['partPlaced', 'partRemoved', 'partUpgraded', 'blueprintCompleted', 'roofCollapsed', 'doorToggled', 'partDamaged', 'partRepaired'] as const satisfies ReadonlyArray<keyof BuildingEventMap>;
