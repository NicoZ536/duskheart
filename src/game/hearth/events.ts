/**
 * Events of the hearth fire (aggregated into `SimEventMap`) – the feedback of MASTERPROMPT §2.7 for §16.5: the renderer
 * switches the clips of `obj_herdfeuer` (`aus`, `brennt`, `glut`) and sets the ember cores into their sockets, the
 * HUD shows the base's protection, the audio plays the hearth's sounds and its crackle while it burns
 * (src/audio/baseSounds.ts, src/audio/loopSources.ts).
 *
 * - `hearthBuilt` / `hearthRemoved`: a hearth came onto the build grid / left it (`spilled`: stacks of fuel and cores
 *   that fell out of a destroyed hearth).
 * - `hearthOpened`: the hearth screen opens.
 * - `hearthFueled` / `hearthFuelTaken`: fuel went into the store / came back out.
 * - `hearthIgnited`: it burns – the base is protected (§16.5 "Solange es brennt: keine Schattenbrut-Spawns im
 *   Radius …"). `hearthOut`: it went out – the fuel ran out (`brennstoff`) or it was put out (`geloescht`); the
 *   protection is gone (§16.5 "Erlischt es, entfällt der Schutz").
 * - `hearthCoreSet` / `hearthCoreTaken`: an ember core went into its niche / came out; `radiusTiles` is the radius
 *   of the base afterwards.
 * Refused commands raise `commandRejected` with a `HearthRejectReason` (texts `ui.hearth.reject.<reason>`).
 */

/**
 * Why a hearth command had no effect:
 * - `noPlayer`; `dead`, `asleep` – the player cannot act (§11.5, §11.6);
 * - `unknownHearth` – no hearth of that id; `outOfReach` – farther than the reach from the hearth;
 * - `invalidSlot`, `slotEmpty` – no such slot / nothing in it;
 * - `notFuel` – the hearth burns logs and charcoal only (§16.5); `storeFull` – the store holds 40 pieces;
 *   `bagsFull` – no room in the bags;
 * - `noFuel` – nothing to light (no fuel in the store); `burning` – it burns already; `notBurning` – it is out;
 * - `notACore` – that is no ember core; `coreSet` – its niche holds a core already; `noCore` – the niche is empty.
 */
export const HEARTH_REJECT_REASONS = ['noPlayer', 'dead', 'asleep', 'unknownHearth', 'outOfReach', 'invalidSlot', 'slotEmpty', 'notFuel', 'storeFull', 'bagsFull', 'noFuel', 'burning', 'notBurning', 'notACore', 'coreSet', 'noCore'] as const;
/** One reason a hearth command was refused. */
export type HearthRejectReason = (typeof HEARTH_REJECT_REASONS)[number];

/** Why a hearth went out. */
export type HearthOutReason = 'brennstoff' | 'geloescht';

interface HearthBase {
  readonly hearth: number;
  readonly layer: number;
  /** Centre of the hearth [world px]. */
  readonly x: number;
  readonly y: number;
  readonly tick: number;
}

export interface HearthEventMap {
  hearthBuilt: HearthBase & { readonly tx: number; readonly ty: number; readonly radiusTiles: number };
  hearthRemoved: HearthBase & { readonly spilled: number };
  hearthOpened: HearthBase;
  hearthFueled: HearthBase & { readonly item: string; readonly count: number; readonly stored: number };
  hearthFuelTaken: HearthBase & { readonly item: string; readonly count: number; readonly stored: number };
  hearthIgnited: HearthBase & { readonly radiusTiles: number };
  hearthOut: HearthBase & { readonly reason: HearthOutReason };
  hearthCoreSet: HearthBase & { readonly index: number; readonly core: string; readonly radiusTiles: number };
  hearthCoreTaken: HearthBase & { readonly index: number; readonly core: string; readonly radiusTiles: number };
}

/** Event names of `HearthEventMap`. */
export const HEARTH_EVENT_TYPES = ['hearthBuilt', 'hearthRemoved', 'hearthOpened', 'hearthFueled', 'hearthFuelTaken', 'hearthIgnited', 'hearthOut', 'hearthCoreSet', 'hearthCoreTaken'] as const satisfies ReadonlyArray<keyof HearthEventMap>;
