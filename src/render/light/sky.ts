/**
 * The light strand's part of the render scene (`RenderScene.sky`, docs/RENDER.md §4): the directional light of
 * sun or moon with its shadow vector, the sky light it is split from, cloud cover and drift, the wind the canopy
 * flecks sway with, the occluders the terrain and the build grid contribute to the occluder mask, and the build grid's
 * blocks that cast the sun's shadow of a house.
 *
 * A scene that leaves it alone gets the M1 behaviour: the flat ambient of `scene.env`, no sun shadows (the
 * occluder pass still shadows point lights and darkens the ambient at the feet of occluders). The game view fills
 * it every frame from calendar and weather (`world/skyScene.ts`).
 */
import { OccluderList } from './occluders';
import { SunCasterList } from './sunCasters';

/** Directional light (sun by day, moon by night). */
export interface DirectionalLight {
  /**
   * Share of the ambient light (`scene.env`) that arrives as this directed light on a flat, unshadowed pixel
   * (0 = none: all ambient is sky light). The sky part and this part add up to the ambient exactly.
   */
  share: number;
  /** Tint of the directed part and of the sky part (multipliers of the ambient colour; the parts sum to it). */
  dirR: number;
  dirG: number;
  dirB: number;
  skyR: number;
  skyG: number;
  skyB: number;
  /** Unit direction towards the light in the screen space of the normal maps (+x right, +y up, +z viewer). */
  lx: number;
  ly: number;
  lz: number;
  /** Relief strength of its normal mapping (1 + relief · (n·l − l_z)). */
  relief: number;
  /** Shadow vector: where shadows fall on the ground (unit, +x east, +y south) and their length per unit height. */
  shadowX: number;
  shadowY: number;
  shadowLength: number;
}

/** Cloud shadows (M5-03). */
export interface CloudShadows {
  /** Cloud cover 0…1 (0: no cloud shadow at all). */
  cover: number;
  /** Offset of the cloud field at this frame [world px] (drift with the wind). */
  offsetX: number;
  offsetY: number;
}

export class SkyState {
  readonly directional: DirectionalLight = {
    share: 0,
    dirR: 1,
    dirG: 1,
    dirB: 1,
    skyR: 1,
    skyG: 1,
    skyB: 1,
    lx: 0,
    ly: 0.7071,
    lz: 0.7071,
    relief: 0,
    shadowX: 0,
    shadowY: -1,
    shadowLength: 0,
  };
  readonly clouds: CloudShadows = { cover: 0, offsetX: 0, offsetY: 0 };
  /** Wind for the canopy flecks: direction and strength (the vector's length, 0…1). */
  windX = 0;
  windY = 0;
  /** Terrain and build-grid occluders of the frame (the sprites' own are collected by the occluder pass). */
  readonly occluders = new OccluderList();
  /** Sun and moon casters of the build grid: walls, doors, windows (their panes), roofs (`sunCasters.ts`). */
  readonly sunCasters = new SunCasterList();

  /** Whether a directed light shines (sun shadows are drawn). */
  get hasDirectional(): boolean {
    return this.directional.share > 0;
  }

  /**
   * Starts a frame: no directed light (share 0 – every reader asks `hasDirectional` first, the rest of the record keeps
   * the last values, so a scene that did not change its sun need not write it again), no clouds, no wind, no
   * occluders – the scene sets what it has.
   */
  beginFrame(): void {
    this.directional.share = 0;
    this.clouds.cover = 0;
    this.windX = 0;
    this.windY = 0;
    this.occluders.clear();
    this.sunCasters.clear();
  }
}
