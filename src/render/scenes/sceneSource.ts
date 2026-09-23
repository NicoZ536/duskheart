/**
 * Scene sources: fill a `RenderScene` for a presentation time. The render debug scenes of M1
 * (screenshots §31.5, E2E, bench) implement this; the game world will be one more source later.
 */
import type { Renderer } from '../renderer';
import type { RenderScene } from '../scene';

export interface SceneSource {
  readonly id: string;
  /** Called when the source becomes active (e.g. to add a pass); undone in `deactivate`. */
  activate?(renderer: Renderer): void;
  deactivate?(renderer: Renderer): void;
  /** False while the source still waits for data (e.g. the asynchronously loaded game atlas); absent = always ready. */
  ready?(): boolean;
  /** Fills `scene` (already emptied by `beginFrame`) for presentation time `time` in seconds. */
  fill(scene: RenderScene, time: number): void;
}
