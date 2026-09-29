/**
 * The occluders the atmosphere and post passes read at world points (M5-44): the occluder mask of the flood frame and,
 * beyond it, the occluder ring (M5 review M2) – CPU mirror of `occluderAt`, `roofedAt` and `groundPointAt` of
 * `shaders/sdf_ring.glsl` and of the structural channel the fog reads (`fogStructure` in fog_density.frag), on the light
 * strand's CPU fields (`OccluderField`, `OccluderRing`). It is what the fog's rooms (`FogRooms`) and the corruption's
 * ground points (`CorruptionGround`) are tested against: the tall pixels at the bottom of the view – crowns, walls – stand
 * on ground below the flood frame, whose level only the ring knows.
 *
 * Mask layout (sdf.glsl): r = decor top, g = structural (1 a wall, closed door or gate; `OPENING_MARK` an opening of a
 * wall; `ROOF_MARK` a roof), b = terrain top, a = ground height.
 */
import type { OccluderField, OccluderRing } from '../light/lightMath';
import { OPENING_MARK, ROOF_MARK } from '../light/params';
import type { FogRooms } from '../passes/atmospherePass';
import type { CorruptionGround } from './corruption';

/** Components of a mask texel (sdf.glsl). */
const STRUCTURAL = 1;
const GROUND = 3;
const CHANNELS = 4;
/** Thresholds of the structural channel: a wall at or above it (`step(0.5, g)` of `sdfOccluder`), an opening between the
 * band threshold and it (`sdfOpening`; a band is either), a roof above half its mark (`sdfRoofed`). */
const WALL_THRESHOLD = 0.5;
const BAND_THRESHOLD = 0.5 * (ROOF_MARK + OPENING_MARK);
const ROOF_THRESHOLD = 0.5 * ROOF_MARK;

export class FrameOccluders implements FogRooms, CorruptionGround {
  /**
   * @param field the flood frame's mask
   * @param ring the occluder ring beyond it (null: the frame's mask only – what the passes knew before M5-44)
   */
  constructor(
    readonly field: OccluderField,
    readonly ring: OccluderRing | null,
  ) {}

  /** Component `c` of the mask at world point (x, y): the field inside its frame, the ring beyond it, 0 beyond both. */
  private channel(x: number, y: number, c: number): number {
    const f = this.field;
    const [i, j] = f.texel(x, y);
    if (f.inside(i, j)) return f.mask[(j * f.width + i) * CHANNELS + c] ?? 0;
    const r = this.ring;
    if (r === null) return 0;
    const [ri, rj] = r.texel(x, y);
    return r.inside(ri, rj) ? (r.mask[(rj * r.width + ri) * CHANNELS + c] ?? 0) : 0;
  }

  /** The structural channel at world point (x, y) (`fogStructure`). */
  structure(x: number, y: number): number {
    return this.channel(x, y, STRUCTURAL);
  }

  wall(x: number, y: number): boolean {
    return this.structure(x, y) >= WALL_THRESHOLD;
  }

  opening(x: number, y: number): boolean {
    const g = this.structure(x, y);
    return g > BAND_THRESHOLD && g < WALL_THRESHOLD;
  }

  roofed(x: number, y: number): boolean {
    return this.structure(x, y) > ROOF_THRESHOLD;
  }

  /** Height of the ground at world point (x, y) [px] (`occluderAt(…).w`). */
  groundHeight(x: number, y: number): number {
    return this.channel(x, y, GROUND);
  }

  /** Ground point of a pixel drawn at world (x, y) with G-buffer height `z` (`groundPointAt`). */
  groundPoint(x: number, y: number, z: number): [number, number] {
    let gy = y + Math.max(0, z - this.groundHeight(x, y));
    gy = y + Math.max(0, z - this.groundHeight(x, gy));
    return [x, y + Math.max(0, z - this.groundHeight(x, gy))];
  }
}
