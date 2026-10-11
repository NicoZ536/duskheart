/**
 * The audio clock of one frame (M7; ADR-0140/0167 "keine Allokation im Frame-Pfad"): `AudioContext.currentTime` read once per
 * frame into a held record that the frame's parts read. A number handed to a function that is not inlined is boxed at the
 * call (16 B each, every frame); a number field of a held object is updated in place. Event-driven calls (a stinger asked
 * for, a lightning heard) take plain numbers.
 */
import { DOUBLE_FIELD } from '../engine/heldRecords';

export interface AudioClock {
  /** Audio time of this frame [s]. */
  now: number;
}

/** The held clock: a class of its own whose time starts as a fractional number, so a store updates it in place (src/engine/heldRecords.ts). */
class HeldAudioClock implements AudioClock {
  now = DOUBLE_FIELD;

  constructor() {
    this.now = 0;
  }
}

/** A clock at 0. */
export function createAudioClock(): AudioClock {
  return new HeldAudioClock();
}
