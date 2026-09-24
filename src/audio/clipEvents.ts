/**
 * Frame events of the player's body clips → sounds (MASTERPROMPT §2.7, §4.5 "Frame-Events"; M3-06, M3-33).
 * The clips of `spieler_basis` (assets-src/sprites/figuren/_spieler_aktionen.ts) mark body moments on their
 * frames: `schritt`, `abrollen`, `zug`, `absprung`, `landung`, `treffer`, `getroffen`, `aufprall`, `biss`,
 * `schluck`. The figure renderer reports them as the frames are entered (`PlayerFigure.onClipEvent`), the
 * runtime plays what this table says.
 *
 * One rule keeps every moment to one sound: what the simulation reports is voiced by its event
 * (`EVENT_SFX`): steps and swim strokes carry the ground and the noise creatures hear, the roll, jump,
 * landing, the hit of a tool and the player's pain are outcomes. The clip voices only the body's own
 * moments no event marks: the body hitting the ground in the death clip, and the later bites and gulps of
 * a meal or a drink – the start of eating or drinking (`activityStarted`) already plays one clip loop's
 * worth of chewing or gulping, so a clip sound can wait for its loop (`fromCycle`).
 *
 * `CLIP_EVENTS_VOICED_BY_SIM` names the event that voices every other clip event; every clip event of the
 * body is in exactly one of the two tables (tests/unit/audio/clipEvents.test.ts).
 */
import { ACTION_SFX } from '../game/actions/events';
import { SURVIVAL_SFX } from '../game/survival/events';
import type { SfxCue } from './sfxPlayer';

/** How a clip event sounds: preset, and the first loop of the clip in which it sounds (0 = every loop). */
export interface ClipEventSound {
  readonly id: string;
  readonly fromCycle: number;
}

/** Clip events with a sound of their own. */
export const CLIP_EVENT_SFX: Readonly<Record<string, ClipEventSound>> = {
  // The dead body hits the ground (death clip, frame 4) – the same thud as a hard fall.
  aufprall: { id: SURVIVAL_SFX.damage.sturz, fromCycle: 0 },
  // Chewing on through a long meal: `activityStarted` chews for the first loop.
  biss: { id: ACTION_SFX.eat, fromCycle: 1 },
  // A gulp on every later loop of drinking: `activityStarted` gulps for the first loop, `waterDrunk` swallows at the end.
  schluck: { id: ACTION_SFX.swallow, fromCycle: 1 },
};

/** Clip events the simulation already voices, with the event that does. */
export const CLIP_EVENTS_VOICED_BY_SIM: Readonly<Record<string, string>> = {
  schritt: 'playerStep: Untergrund, Wasser und Geräuschpegel (den auch Kreaturen hören) kennt nur die Simulation',
  zug: 'playerStep im tiefen Wasser: Schwimmzug',
  abrollen: 'playerRolled: der Rollklang beim Beginn der Rolle',
  absprung: 'playerStateChanged → jump: der Sprungklang',
  landung: 'playerLanded: Landung, Knochenbruch oder Platschen',
  treffer: 'harvestHit: der Treffer des Werkzeugs mit dem Material des Ziels (Schlagframe und Sim-Treffer fallen zusammen)',
  getroffen: 'playerDamaged / playerAfflicted: der Schmerz je Schadensursache',
};

/**
 * The one-shot of clip event `event` in loop `cycle` of its clip, or null (voiced by the simulation, an
 * unknown event, or a loop the action's start already voices). The player's body sounds at the listener,
 * like the player's own event sounds.
 */
export function clipEventCue(event: string, cycle: number): SfxCue | null {
  const sound = CLIP_EVENT_SFX[event];
  if (sound === undefined || cycle < sound.fromCycle) return null;
  return { id: sound.id };
}
