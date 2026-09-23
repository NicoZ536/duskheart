/**
 * Scene `welt-ui` (M1-23): the world-near UI over a Grünhain clearing at nightfall – the player
 * with name, life and stamina bar and a rising healing number, a settler with name and life bar,
 * damage numbers (hit and critical) over a boulder being mined, the interaction marker with key
 * cap over the outlined torch, and dropped axes labelled in their rarity colour (§4.5). Everything
 * is drawn after light and post, so it keeps its colours on the dark ground and in the light pool.
 * Texts come from the i18n files (DE/EN); numbers are formatted once, not per frame.
 */
import { clipFrameAt } from '../anim/animation';
import type { AtlasData, AtlasSprite } from '../assets/atlas';
import type { RenderScene } from '../scene';
import { KitScene, meadowWithRoad } from '../tilemap/kitScene';
import type { SceneKit } from '../tilemap/sceneKit';
import type { LabelTone } from '../worldUi/worldUi';
import { FIRE, LUMEN, placeSprite, pushLight, type LightSpec, type Rgb } from './kitTools';

/** World tile row of the road's north edge. */
const ROAD_ROW = 4;
const CAMERA: readonly [number, number] = [0, 0];
const AMBIENT: Rgb = [0.45, 0.52, 1];
const AMBIENT_INTENSITY = 0.4;

/** Anchors of the player and the settler (world px). */
const PLAYER = { x: -40, y: 44 } as const;
const SETTLER = { x: 64, y: 30 } as const;
/** Values shown in the bars. */
const PLAYER_LIFE = 34;
const PLAYER_LIFE_MAX = 50;
const PLAYER_STAMINA = 72;
const PLAYER_STAMINA_MAX = 100;
const SETTLER_LIFE = 40;
const SETTLER_LIFE_MAX = 40;
/** Inner width of the bars over a figure (px) and their offsets above the figure's foot. */
const FIGURE_BAR_WIDTH = 20;
const NAME_ABOVE_FOOT = 36;
const LIFE_ABOVE_FOOT = 33;
const STAMINA_ABOVE_FOOT = 29;
/** Where the healing number starts: above the name. */
const HEAL_ABOVE_FOOT = 46;
/**
 * Healing number over the player, damage numbers over the boulder: text, kind, x offset and phase
 * (s) – at the scenario's frozen time (0.5 s) they are 0.3 s, 0.1 s and 0.45 s old: rising, fully opaque.
 */
const HEAL = { text: '+5', dx: 12, phase: 1 } as const;
const HITS: readonly { readonly text: string; readonly kind: 'treffer' | 'kritisch'; readonly dx: number; readonly phase: number }[] = [
  { text: '4', kind: 'treffer', dx: -10, phase: 0.8 },
  { text: '11', kind: 'kritisch', dx: 8, phase: 1.15 },
];
/** Seconds between two hits of the same number (the numbers repeat while time runs). */
const HIT_PERIOD = 1.2;
const BOULDER = { x: -6, y: 104 } as const;
const HIT_ABOVE_FOOT = 26;
/** The torch with the interaction marker (key `E` = default binding of "interact", §26). */
const TORCH = { x: 104, y: 66 } as const;
const INTERACT_KEY = 'E';
const MARKER_ABOVE_FOOT = 20;
const TORCH_LIGHT: LightSpec = { height: 9, radius: 120, color: FIRE, intensity: 1.4, flicker: 0.25, seed: 3.3 };
/** A second torch beside the player, so both figures stand in warm light. */
const CAMP_LIGHT: LightSpec = { height: 9, radius: 110, color: FIRE, intensity: 1.2, flicker: 0.3, seed: 7.1 };
const CAMP = { x: -70, y: 58 } as const;
/** The glow of the lumenite axe (emissive blade) lights its surroundings. */
const LUMEN_LIGHT: LightSpec = { height: 8, radius: 64, color: LUMEN, intensity: 0.9, flicker: 0.04, seed: 4.2 };
/** Dropped items: sprite id, anchor, label key, rarity, own light (glowing items). */
const ITEMS: readonly { readonly sprite: string; readonly x: number; readonly y: number; readonly label: string; readonly tone: LabelTone; readonly light?: LightSpec }[] = [
  { sprite: 'axt_stein', x: -170, y: 40, label: 'render.weltUi.axtStein', tone: 'gewoehnlich' },
  { sprite: 'axt_eisen', x: -128, y: 114, label: 'render.weltUi.axtEisen', tone: 'ungewoehnlich' },
  { sprite: 'axt_stahl', x: 176, y: 118, label: 'render.weltUi.axtStahl', tone: 'selten' },
  { sprite: 'axt_lumenit', x: -176, y: -34, label: 'render.weltUi.axtLumenit', tone: 'episch', light: LUMEN_LIGHT },
  { sprite: 'axt_sonnenstahl', x: 170, y: -20, label: 'render.weltUi.axtSonnenstahl', tone: 'legendaer' },
];
const ITEM_LABEL_ABOVE_FOOT = 18;
const TREES: readonly (readonly [number, number])[] = [
  [-226, 8],
  [-96, -62],
  [226, 30],
  [94, -70],
];
const OUTLINED = { outline: true } as const;

/** Seconds since the last hit of a number repeating every `HIT_PERIOD`. */
function ageOf(time: number, phase: number): number {
  const t = time + phase;
  return t - Math.floor(t / HIT_PERIOD) * HIT_PERIOD;
}

export class WorldUiScene extends KitScene {
  readonly id = 'welt-ui';
  private items: readonly (AtlasSprite | null)[] = [];
  private itemsFor: SceneKit | null = null;

  constructor(
    gameAtlas: () => AtlasData | null,
    private readonly t: (key: string) => string,
  ) {
    super(gameAtlas, { first: -1, last: 0 }, { first: -1, last: 0 });
  }

  protected terrain(kit: SceneKit): (wx: number, wy: number) => number {
    return meadowWithRoad(kit, ROAD_ROW);
  }

  protected environment(scene: RenderScene): void {
    const env = scene.env;
    env.ambientR = AMBIENT[0];
    env.ambientG = AMBIENT[1];
    env.ambientB = AMBIENT[2];
    env.ambientIntensity = AMBIENT_INTENSITY;
    env.wind = 0;
  }

  protected compose(scene: RenderScene, kit: SceneKit, time: number): void {
    const ui = scene.worldUi;
    scene.camera.set(CAMERA[0], CAMERA[1]).unfollow();
    if (this.itemsFor !== kit) {
      this.itemsFor = kit;
      this.items = ITEMS.map((it) => kit.atlas.manifest.sprites[it.sprite] ?? null);
    }
    for (let i = 0; i < TREES.length; i++) {
      const tr = TREES[i];
      if (tr) placeSprite(scene, kit.tree, 0, tr[0], tr[1]);
    }
    // Boulder being mined: damage numbers rise from it.
    placeSprite(scene, kit.rockBig, 0, BOULDER.x, BOULDER.y);
    for (let i = 0; i < HITS.length; i++) {
      const h = HITS[i];
      if (h) ui.damage(BOULDER.x + h.dx, BOULDER.y - HIT_ABOVE_FOOT, h.text, ageOf(time, h.phase), h.kind);
    }
    // Player and settler with name and bars.
    placeSprite(scene, kit.figure, clipFrameAt(kit.idle.right, time), PLAYER.x, PLAYER.y);
    ui.label(PLAYER.x, PLAYER.y - NAME_ABOVE_FOOT, this.t('render.weltUi.spieler'));
    ui.bar(PLAYER.x, PLAYER.y - LIFE_ABOVE_FOOT, FIGURE_BAR_WIDTH, PLAYER_LIFE, PLAYER_LIFE_MAX, 'leben');
    ui.bar(PLAYER.x, PLAYER.y - STAMINA_ABOVE_FOOT, FIGURE_BAR_WIDTH, PLAYER_STAMINA, PLAYER_STAMINA_MAX, 'ausdauer');
    ui.damage(PLAYER.x + HEAL.dx, PLAYER.y - HEAL_ABOVE_FOOT, HEAL.text, ageOf(time, HEAL.phase), 'heilung');
    placeSprite(scene, kit.figure, clipFrameAt(kit.idle.left, time + 1), SETTLER.x, SETTLER.y);
    ui.label(SETTLER.x, SETTLER.y - NAME_ABOVE_FOOT, this.t('render.weltUi.siedlerin'));
    ui.bar(SETTLER.x, SETTLER.y - LIFE_ABOVE_FOOT, FIGURE_BAR_WIDTH, SETTLER_LIFE, SETTLER_LIFE_MAX, 'leben');
    // Interactable torch: accent outline (§4.6) and the marker with key cap and action.
    placeSprite(scene, kit.torch, clipFrameAt(kit.torchClip, time), TORCH.x, TORCH.y, OUTLINED);
    pushLight(scene, TORCH.x, TORCH.y, TORCH_LIGHT);
    placeSprite(scene, kit.torch, clipFrameAt(kit.torchClip, time + CAMP_LIGHT.seed), CAMP.x, CAMP.y);
    pushLight(scene, CAMP.x, CAMP.y, CAMP_LIGHT);
    ui.marker(TORCH.x, TORCH.y - MARKER_ABOVE_FOOT, INTERACT_KEY, this.t('render.weltUi.fackelNehmen'));
    // Dropped axes, labelled in their rarity colour.
    for (let i = 0; i < ITEMS.length; i++) {
      const it = ITEMS[i];
      const sprite = this.items[i];
      if (!it || !sprite) continue;
      placeSprite(scene, sprite, 0, it.x, it.y);
      ui.label(it.x, it.y - ITEM_LABEL_ABOVE_FOOT, this.t(it.label), it.tone);
      if (it.light) pushLight(scene, it.x, it.y, it.light);
    }
  }
}
