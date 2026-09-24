/** The render debug scenes by id (scenarios, E2E, bench). */
import type { AtlasData } from '../assets/atlas';
import { AnimLayersScene } from './animLayers';
import { GameAtlasScene } from './gameAtlas';
import { GBufferShowcaseScene } from './gbufferShowcase';
import { GruenhainScene } from './gruenhain';
import { PaletteRowsScene } from './paletteRows';
import { WorldUiScene } from './weltUi';
import { PaletteSwapScene } from './paletteSwap';
import type { SceneSource } from './sceneSource';
import { Sprites5000Scene } from './sprites5000';
import { TestSceneSource } from './testszene';
import { YSortScene } from './ySort';
import { LightProbeScene, normalmapLightScene, postBaseScene } from '../light/lightScenes';
import { TilemapProbeScene, TilemapScene } from '../tilemap/tilemapScene';
import type { RenderSceneId } from './ids';
import { GameWorldScene, type GameWorldBinding } from '../world/gameScene';
import { sharedInThreadWorldHost, type WorldHost } from '../world/worldHost';
import { WorldScene } from '../world/worldScene';

export { isRenderSceneId, RENDER_SCENE_IDS, type RenderSceneId } from './ids';

/** What scenes may need from the runtime. */
export interface SceneDeps {
  /** The game atlas of `npm run assets` once loaded (null before, or when there is none). */
  gameAtlas(): AtlasData | null;
  /** UI texts in the current language (world UI labels); returns the stored string, no allocation. */
  t(key: string): string;
  /**
   * The generated world of the world scenes (one per page, created on first use; the page's host
   * generates in the world worker). Absent: a shared host that generates in this thread.
   */
  worldHost?(): WorldHost;
  /**
   * The session and the host streaming its world for the game view (`spiel`); absent or null until
   * the page attached them (the view then shows the background only).
   */
  gameWorld?(): GameWorldBinding | null;
}

export function createSceneSource(id: RenderSceneId, deps: SceneDeps): SceneSource {
  switch (id) {
    case 'gruenhain':
      return new GruenhainScene(() => deps.gameAtlas());
    case 'welt-ui':
      return new WorldUiScene(() => deps.gameAtlas(), (key) => deps.t(key));
    case 'palette':
      return new PaletteRowsScene(() => deps.gameAtlas(), (key) => deps.t(key));
    case 'testszene':
      return new TestSceneSource();
    case 'palette-swap':
      return new PaletteSwapScene();
    case 'ysort':
      return new YSortScene();
    case 'anim-layers':
      return new AnimLayersScene();
    case 'gbuffer':
      return new GBufferShowcaseScene();
    case 'sprites-5000':
      return new Sprites5000Scene();
    case 'spielatlas':
      return new GameAtlasScene(() => deps.gameAtlas());
    case 'tilemap':
      return new TilemapScene(() => deps.gameAtlas());
    case 'tilemap-probe':
      return new TilemapProbeScene(() => deps.gameAtlas());
    case 'normalmap-licht':
      return normalmapLightScene(() => deps.gameAtlas());
    case 'post-grundlage':
      return postBaseScene(() => deps.gameAtlas());
    case 'licht-probe':
      return new LightProbeScene();
    case 'spiel':
      return new GameWorldScene(() => deps.gameAtlas(), () => deps.gameWorld?.() ?? null, deps.t);
    case 'gruenhain-tag':
    case 'frostkamm-tag':
    case 'glutsand-tag':
    case 'ebene-1-roh':
      return new WorldScene(id, () => deps.gameAtlas(), deps.worldHost?.() ?? sharedInThreadWorldHost());
  }
}
