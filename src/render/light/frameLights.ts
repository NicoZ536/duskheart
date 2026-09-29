/**
 * The lights the light pass drew in a frame, per WebGL context (M5 review Minor 4): culled to the view, capped at the
 * quality level's `maxLights` (the nearest win), their flicker applied – the packed records of `LightBatch`
 * (`LIGHT_INSTANCE_FLOATS` each, `LIGHT_OFFSET`). Later passes that show the lights again – the puddles' mirror images –
 * read exactly these, so a light the picture does not light is not mirrored either. Keyed by the context like
 * `surfaceFrameOf`, so the passes meet without further wiring; nothing here outlives the context's passes.
 */
import { OCCLUDER_FLOATS, OCCLUDER_OFFSET, type OccluderList } from './occluders';
import { OCCLUDER_CLASS, POINT_SHADOW } from './params';

export class FrameLights {
  /** Frame index the records belong to (−1: none yet). */
  frame = -1;
  /** Records valid in `data`. */
  count = 0;
  /** The light batch's packed records (its own array: read within the frame, never kept). */
  data: Float32Array = new Float32Array(0);

  /** Whether the records are frame `index`'s. */
  of(index: number): boolean {
    return this.frame === index;
  }
}

const lists = new WeakMap<WebGL2RenderingContext, FrameLights>();

/** The frame lights of context `gl` (created on first use). */
export function frameLightsOf(gl: WebGL2RenderingContext): FrameLights {
  let l = lists.get(gl);
  if (l === undefined) {
    l = new FrameLights();
    lists.set(gl, l);
  }
  return l;
}

/**
 * Whether a wall, a closed door or gate, solid rock or terrain above the light's ground `base` (the scene's footprints,
 * `scene.sky.occluders`) crosses the line straight south from a light's footprint (x, y0) to (x, y1) – the way from a
 * light to its mirror image in a puddle south of it (a level water surface mirrors a light at height h at (x, y + h)).
 * An interior light's image in a puddle outside its house lies beyond its south wall.
 */
export function blockedSouthward(occluders: OccluderList, x: number, y0: number, y1: number, base: number): boolean {
  const r = occluders.records;
  const n = occluders.count;
  for (let k = 0; k < n; k++) {
    const o = k * OCCLUDER_FLOATS;
    const cls = r[o + OCCLUDER_OFFSET.cls] as number;
    const blocks = cls === OCCLUDER_CLASS.structural || (cls === OCCLUDER_CLASS.terrain && (r[o + OCCLUDER_OFFSET.top] as number) > base + POINT_SHADOW.heightEpsilonPx);
    if (!blocks) continue;
    const cx = r[o] as number;
    const hx = r[o + 2] as number;
    if (x < cx - hx || x > cx + hx) continue;
    const cy = r[o + 1] as number;
    const hy = r[o + 3] as number;
    if (cy + hy > y0 && cy - hy < y1) return true;
  }
  return false;
}
