/**
 * Showcase of the GPU particle system (M5-11, M5-12; scenes `partikel`, `partikel-20000`, `partikel-gewitter`): the Grünhain clearing at
 * nightfall (`scenes/gruenhain.ts`) with every kind of emitted particle of the content in its own light –
 * - a camp fire on the meadow throwing sparks, embers and smoke, its hot air shimmering, lighting the smoke from below;
 * - the two standing torches sparking and smoking thinly;
 * - a storm of lumen motes rising in slow spirals over the road (the beacon ignition's particle storm, §6.2);
 * - fireflies blinking over the grass.
 * `partikel-20000` adds three more lumen storms over the clearing: at least 20 000 particles alive at once (§30 budget,
 * bench `partikel-20000`). `partikel-gewitter` is the clearing in a thunderstorm at night: heavy rain slanting in the wind, lit
 * only where the fires and torches reach, and the lightning's flash. Deterministic for a presentation time (the
 * particle system's start-over for frozen time).
 */
import { BALANCE } from '../../content/balance';
import { clipFrameAt } from '../anim/animation';
import type { AtlasData } from '../assets/atlas';
import { FIRE, LUMEN } from '../light/lightColors';
import type { Renderer } from '../renderer';
import type { RenderScene } from '../scene';
import { GruenhainScene } from '../scenes/gruenhain';
import type { SceneSource } from '../scenes/sceneSource';
import { particleEmitter } from './tables';
import { lightningFlash, windVelocity } from './weather';
import { LIGHTNING } from '../../content/particles';

/** A lumen storm: ground centre [world px] and strength. */
type Storm = readonly [number, number, number];

/** The camp fire on the meadow: ground point [world px], its light, its column of hot air. */
const CAMP_FIRE = { x: -118, y: 104, radius: 104, intensity: 2.3, flicker: 0.3, seed: 7.7 } as const;
const CAMP_FIRE_SHIMMER = { z: 6, width: 14, height: 30, strength: 1.5 } as const;
/** The standing torches of the clearing (as `scenes/gruenhain.ts` places them). */
const TORCHES: readonly (readonly [number, number])[] = [
  [-44, 52],
  [132, 50],
];
/** The lumen storm of the showcase, and the three more of the stress scene. */
const STORM: Storm = [96, 118, 0.12];
const STRESS_STORMS: readonly Storm[] = [
  [96, 118, 1],
  [-150, 118, 0.85],
  [150, 30, 0.85],
  [-60, -40, 0.85],
];
/** The cool glow at the foot of a lumen storm: height, radius, strength, flicker (ground and rocks around it turn teal). */
const STORM_LIGHT = { height: 14, radius: 84, intensity: 1.5, flicker: 0.12, seed: 3.1 } as const;
/** Fireflies over the meadow: centre of their patch. */
const FIREFLIES: readonly [number, number] = [0, 24];
/** Sprite of the camp fire and its clip. */
const CAMP_FIRE_SPRITE = 'lagerfeuer';
const CAMP_FIRE_CLIP = 'brennt';
/** Stable numbers of the sources (their random sequences). */
const ID = { fire: 101, torch: 201, storm: 301, fireflies: 401 } as const;
/**
 * The thunderstorm of `partikel-gewitter`: heavy rain, a strong wind towards the east (direction 2 of the eight wind
 * directions), full storm strength, a fixed lightning sequence.
 */
const THUNDERSTORM = { amount: 1, windDirection: 2, wind: 0.85, storm: 1, seed: 0x51a1 } as const;
/** Search of the frozen moment: from this time [s], in steps of this length [s]. */
const FLASH_SEARCH = { from: 8, to: 80, step: 1 / 240 } as const;

/** Middle of the first flash of the first lightning strike of the thunderstorm after `FLASH_SEARCH.from` [s] (its screenshot moment). */
function firstFlashTime(): number {
  let before = lightningFlash(FLASH_SEARCH.from, THUNDERSTORM.seed, THUNDERSTORM.storm, false);
  for (let t = FLASH_SEARCH.from + FLASH_SEARCH.step; t < FLASH_SEARCH.to; t += FLASH_SEARCH.step) {
    const now = lightningFlash(t, THUNDERSTORM.seed, THUNDERSTORM.storm, false);
    if (before === 0 && now > 0) return t + LIGHTNING.blitz / 2;
    before = now;
  }
  throw new Error('Partikel-Schaubild: kein Blitz im Suchfenster');
}

/** Presentation time of the scenario `partikel-gewitter`: in the first flash of a strike. */
export const THUNDERSTORM_FLASH_TIME = firstFlashTime();

export class ParticleShowcaseScene implements SceneSource {
  private readonly clearing: GruenhainScene;
  private readonly storms: readonly Storm[];
  private presets: { sparks: number; smoke: number; embers: number; torchSparks: number; torchSmoke: number; storm: number; fireflies: number } | null = null;

  private readonly wind = { x: 0, y: 0 };

  constructor(
    readonly id: 'partikel' | 'partikel-20000' | 'partikel-gewitter',
    gameAtlas: () => AtlasData | null,
  ) {
    this.clearing = new GruenhainScene(gameAtlas);
    this.storms = id === 'partikel' ? [STORM] : id === 'partikel-20000' ? STRESS_STORMS : [];
    windVelocity(THUNDERSTORM.windDirection, THUNDERSTORM.wind, this.wind);
  }

  activate(renderer: Renderer): void {
    this.clearing.activate(renderer);
  }

  deactivate(renderer: Renderer): void {
    this.clearing.deactivate(renderer);
  }

  ready(): boolean {
    return this.clearing.ready();
  }

  fill(scene: RenderScene, time: number): void {
    this.clearing.fill(scene, time);
    const p = (this.presets ??= {
      sparks: particleEmitter('lagerfeuer_funken'),
      smoke: particleEmitter('lagerfeuer_rauch'),
      embers: particleEmitter('lagerfeuer_glut'),
      torchSparks: particleEmitter('fackel_funken'),
      torchSmoke: particleEmitter('fackel_rauch'),
      storm: particleEmitter('lumen_sturm'),
      fireflies: particleEmitter('gluehwuermchen_wiese'),
    });
    const e = scene.particles.emitters;
    const flame = BALANCE.light.campfire.flameHeightPx;
    e.push(p.sparks, CAMP_FIRE.x, CAMP_FIRE.y, flame, 1, ID.fire);
    e.push(p.smoke, CAMP_FIRE.x, CAMP_FIRE.y, flame, 1, ID.fire + 1);
    e.push(p.embers, CAMP_FIRE.x, CAMP_FIRE.y, 0, 1, ID.fire + 2);
    scene.particles.distortion.push(CAMP_FIRE.x, CAMP_FIRE.y, CAMP_FIRE_SHIMMER.z + flame, CAMP_FIRE_SHIMMER.width, CAMP_FIRE_SHIMMER.height, CAMP_FIRE_SHIMMER.strength);
    const torchFlame = BALANCE.light.torch.flameHeightPx.stand;
    for (let i = 0; i < TORCHES.length; i++) {
      const t = TORCHES[i] as readonly [number, number];
      e.push(p.torchSparks, t[0], t[1], torchFlame, 1, ID.torch + i * 2);
      e.push(p.torchSmoke, t[0], t[1], torchFlame, 1, ID.torch + i * 2 + 1);
    }
    for (let i = 0; i < this.storms.length; i++) {
      const s = this.storms[i] as Storm;
      e.push(p.storm, s[0], s[1], 0, s[2], ID.storm + i);
      const l = scene.light.reset();
      l.x = s[0];
      l.y = s[1];
      l.height = STORM_LIGHT.height;
      l.radius = STORM_LIGHT.radius;
      l.r = LUMEN[0];
      l.g = LUMEN[1];
      l.b = LUMEN[2];
      l.intensity = STORM_LIGHT.intensity;
      l.flicker = STORM_LIGHT.flicker;
      l.seed = STORM_LIGHT.seed + i;
      scene.lights.push(l);
    }
    if (this.id === 'partikel-gewitter') {
      const w = scene.particles.weather;
      w.set('regen', THUNDERSTORM.amount);
      w.windX = this.wind.x;
      w.windY = this.wind.y;
      w.storm = THUNDERSTORM.storm;
      w.stormSeed = THUNDERSTORM.seed;
    } else e.push(p.fireflies, FIREFLIES[0], FIREFLIES[1], 0, 1, ID.fireflies);
    this.placeCampFire(scene, time);
  }

  /** The camp fire's sprite and light (the sprite only with the game atlas). */
  private placeCampFire(scene: RenderScene, time: number): void {
    const sprite = scene.atlas?.manifest.sprites[CAMP_FIRE_SPRITE];
    const clip = sprite?.clips[CAMP_FIRE_CLIP];
    if (sprite !== undefined && clip !== undefined) {
      const d = scene.sprite.reset();
      const frame = sprite.frames[clipFrameAt(clip, time)] ?? sprite.frames[0];
      if (frame !== undefined) {
        d.frame = frame;
        d.x = CAMP_FIRE.x;
        d.y = CAMP_FIRE.y;
        scene.sprites.push(d);
      }
    }
    const l = scene.light.reset();
    l.x = CAMP_FIRE.x;
    l.y = CAMP_FIRE.y;
    l.height = BALANCE.light.campfire.flameHeightPx;
    l.radius = CAMP_FIRE.radius;
    l.r = FIRE[0];
    l.g = FIRE[1];
    l.b = FIRE[2];
    l.intensity = CAMP_FIRE.intensity;
    l.flicker = CAMP_FIRE.flicker;
    l.seed = CAMP_FIRE.seed;
    scene.lights.push(l);
  }
}
