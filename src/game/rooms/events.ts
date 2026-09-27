/**
 * Events of the rooms (aggregated into `SimEventMap`; MASTERPROMPT §16.4, §2.7):
 * - `playerRoomChanged`: the player entered another region – a room (`room` = its id, 0 outdoors), whether it is
 *   an interior, its type and comfort. The build mode names the room, the HUD the type, the renderer fades the roof
 *   of an interior (M4-27), the audio switches to the room's hall (M7-01).
 */

export interface RoomEventMap {
  playerRoomChanged: { readonly layer: number; readonly room: number; readonly interior: boolean; readonly type: string | null; readonly comfort: number; readonly tick: number };
}

/** Event names of `RoomEventMap`. */
export const ROOM_EVENT_TYPES = ['playerRoomChanged'] as const satisfies ReadonlyArray<keyof RoomEventMap>;
