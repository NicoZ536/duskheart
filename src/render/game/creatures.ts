/**
 * Creatures, carcasses and traps in the game view (M6-13 … M6-32; MASTERPROMPT §4.5 "Idle, Bewegung, Angriff mit
 * Ausholphase, Treffer, Tod", §6.2 "2-Frame-Trefferblitz", §19.4 Telegraphs, docs/ART.md §15, docs/SPIEL.md §11):
 *
 * - Every creature of the creature system on the drawn layer is its sprite `kreatur_<id>` (assets-src/lib/creature.ts)
 *   with the clip `<aktion>_<richtung>` of what it does: `idle` standing (resting, grazing, sleeping), `move` walking or
 *   running, `flug` while a ground bird flutters (else `move`), `attack_<name>` while it winds up and recovers, `hit`
 *   after a hit, `death` as it falls. `left` mirrors `right` (the sprites are built symmetric). Its facing (radians)
 *   picks the direction, the dominant axis wins.
 * - A flier that also walks (the gull: `move` is its flight, `gehen` its walk, `landen` its landing, docs/ART.md §15.3) is
 *   in the air while it flees, flutters, runs faster than halfway between its walk and its run, or is over water (it
 *   never stands on the sea); else it walks (`gehen`) or stands (`idle`), and the first moments on the ground after a
 *   flight play `landen` once (the view remembers when it last saw each such bird in the air).
 * - The attack clip is timed to the simulation: the wind-up positions stretch over the wind-up ticks (difficulty and
 *   run-up included), so the clip's `schlag` event lands on the tick the blow lands; the recovery plays at the clip's rate.
 * - Positions are interpolated with the frame's alpha (the movement of the last tick, `vx`/`vy`); sprites y-sort at
 *   their feet and stand on the height level of their tile (16 px per level in the G-buffer, like drops and stations).
 * - A hit flashes white for two frames at 60 Hz (the frame of the hit and the next); shadow brood burning in glaring
 *   light glows warm; fading shadow brood (sunrise, the Nachtmahr's pursuit over) dissolves over `fadeSeconds`.
 * - A camouflaged creature (the Dornling, profile `tarnung`) shows its clip `tarnung` while it hides and `erwachen` while it
 *   reveals itself (backwards while it hides again); its ambush is an attack clip that starts from the bush.
 * - Eyes of night hunters (`augen`) are emissive pixels of the sprite; in the dark they glow brighter (`emissiveBoost`).
 * - In the dark only the eyes of a foe show (M6-05 with §12.2 "Gegner im Dunkeln sind nur als Augen erkennbar", §19.4):
 *   the presentation reads the gameplay light map at the creature (`GameplayLightMap.levelInto`); below the stage
 *   "Dunkel" (0,15) the body of a foe (`gegner`, `schattenbrut`, `elite`) sinks into black over `DARK` (one with glowing
 *   eyes wholly – only the emissive eyes stay; one without them to a faint silhouette), so the torch's circle and the moon
 *   decide what is seen. Peaceful animals (`friedlich`) are no foes: the scene's own light darkens them like the ground
 *   they stand on – they vanish into the night with it (docs/ART.md §15.4), never darker than it.
 * - Shadow brood of a Finstermond night (`finster`, ADR-0135: stronger) is marked by its glow: eyes, glow sack and maw
 *   throb between `FINSTER_GLOW.low` and `high` of `emissiveBoost` – in the dark, where only the glow shows, too.
 * - Hitstop (M6-05): while the simulation holds a creature still (`hitstopFromTick`/`hitstopTicks`), its clocks stand
 *   too – the attack clip (the simulation stretches the wind-up by the same ticks), the hit clip and its loops; the white
 *   flash keeps its two frames.
 * - Conditions (M6-80, ADR-0173, `statusMarks.ts`, read from `CreatureState.conditions` for exactly the ticks they act): a stunned
 *   creature (a condition's `aktionstempo` 0, which the simulation holds like a stagger) takes the stagger pose – its hit
 *   clip on from the stunning hit, then held on its sagged last frame, swaying a pixel – with three stars circling above
 *   the head of that pose; a slowed one (frost's `zeitlupe`) is tinted icy and its loops and walk run at its factors; a
 *   blinded one (`blendung`) has two sparks flickering at its head.
 * - Variants draw with their palette row (`varianten[].palette`).
 * - Shadow brood is ink smoke (M6-25, src/render/batch/materialize.ts): it forms out of the smoke from the ground up after it
 *   appears, dissolves into it when it fades, and its death decays into the smoke's glowing violet sparks; a Kriecher
 *   holding the player shows its clip `festhalten`.
 * - In water (§6.1 pass 7 "Eintauchmaske für Figuren"; docs/RENDER.md "Wasser"): a swimmer or an amphibian on a water
 *   tile lies in it up to `IMMERSION.creatureSwimShare` of its drawing (the jellyfish to the rim of its bell), a land
 *   creature in shallow water wades ankle-deep (`IMMERSION.wadeDepthPx`) – what lies below the line is seen through the
 *   water and mirrors no more; fliers are in the air. The view collects them while it draws and hands them to the
 *   water's immersion mask after the player's (`immerse`), nearest to the view's centre first.
 * - A creature that dies without a carcass (shadow brood, bodies nothing is carved from) plays its death clip where it
 *   fell and dissolves (`creatureDied` events, a fixed ring of slots). A carcass plays the death clip from the tick it
 *   was left and then lies on its last frame until it is carved or rots (the last seconds dissolving); the one the
 *   interaction offers (E, use target on its tile) carries the outline (§4.6).
 * - A trap is its item's icon on its tile; a caught creature sits in it.
 *
 * Reads the simulation's state only; allocates nothing per frame (§30, ADR-0142, ADR-0167): looks are resolved once per
 * atlas and creature, clip lengths are numbers of the look, held records are class instances with NaN fields, and no
 * floating-point value crosses a call that is not inlined (the light comes back in a typed array).
 */
import { ATTACK_STRIKE_EVENT, CREATURE_HIDDEN_ACTION, CREATURE_REVEAL_ACTION, attackClipAction, creatureSpriteId, type CreatureAttack } from '../../content/creatures/schema';
import { BALANCE } from '../../content/balance';
import { NULL_ENTITY } from '../../engine/ecs';
import type { CreatureCatalog } from '../../game/creatures/catalog';
import type { CreatureEventMap } from '../../game/creatures/events';
import type { Carcass, CreatureState } from '../../game/creatures/state';
import { CREATURES_SYSTEM_ID, CreatureSystem } from '../../game/creatures/system';
import { TRAPS_SYSTEM_ID, TrapSystem } from '../../game/creatures/traps';
import type { LightSystem } from '../../game/light/system';
import type { GameSession } from '../../game/session';
import type { Simulation } from '../../game/sim';
import type { GameplayLightMap } from '../../world/lightmap/lightmap';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { TILE_PX, type Layer } from '../../world/model/coords';
import { DIRECTIONS, clipDuration, clipFrameIn, type AnimationClip } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import { formingFade } from '../batch/materialize';
import { holdingPlayer } from '../../game/creatures/formulas';
import type { RenderScene } from '../scene';
import { TILE_SHIFT } from '../tilemap/chunk';
import { SURFACE_PARAMS } from '../surface/params';
import { IMMERSION, MAX_IMMERSIONS } from '../water/params';
import type { WaterState } from '../water/state';
import { iconSprite } from './drops';
import { lightSystemOf } from './lights';
import {
  COND_ACTION_LEAD,
  COND_LAST_TICK,
  COND_NOW,
  COND_PACE_LEAD,
  COND_REGISTERS,
  CreatureConditionTable,
  DAZZLE,
  FROST,
  HEAD_CENTRE,
  HEAD_TOP,
  MARK_DAZZLE,
  MARK_DEPTH,
  MARK_FROST,
  MARK_FRONT,
  MARK_HELD,
  MARK_REGISTERS,
  MARK_RX,
  MARK_RY,
  MARK_SERIAL,
  MARK_STARS,
  MARK_SWAY,
  MARK_TIME,
  MARK_X,
  MARK_Y,
  LIGHT_CORE,
  LIGHT_X0,
  LIGHT_X1,
  LIGHT_Y,
  SCAN_GLOWING,
  SCAN_LIGHT,
  SCAN_LIGHT_FIELDS,
  SCAN_LIGHTS,
  SCAN_SIZE,
  SCAN_TOP,
  STATUS_CLIPS,
  STATUS_SPRITE,
  STUN,
  conditionMarksInto,
  frameHeadInto,
  frameScanInto,
  orbitHeight,
  orbitRadius,
  starInto,
  swayInto,
} from './statusMarks';

/** Direction indices in `DIRECTIONS` order (down, left, up, right). */
const DIR_DOWN = 0;
const DIR_LEFT = 1;
const DIR_UP = 2;
const DIR_RIGHT = 3;
/** Clip actions every creature sprite has (docs/ART.md §15; `CREATURE_BASE_ACTIONS`) and the flutter of ground birds. */
const ACTION_IDLE = 'idle';
const ACTION_MOVE = 'move';
const ACTION_HIT = 'hit';
const ACTION_DEATH = 'death';
const ACTION_FLIGHT = 'flug';
/** The Kriecher's hold (docs/ART.md §15.3 `festhalten`, a loop). */
const ACTION_HOLD = 'festhalten';
/** The gull's walk on the ground and its landing (docs/ART.md §15.3 `gehen` 4@8, `landen` 4@10): a flier that also walks. */
const ACTION_WALK = 'gehen';
const ACTION_LAND = 'landen';
/** Movement below this per tick counts as standing [px] (the walk clip needs a step). */
const STILL_PX = 0.05;
/** Loop phase offset per creature serial [s]: a herd does not breathe or step in unison. */
const PHASE_STEP = 0.37;
/** Hit flash [ticks]: the frame of the hit and the next at 60 Hz (§6.2 "2-Frame-Trefferblitz"). */
const FLASH_TICKS = 2;
/** A fluttering ground bird rises this far above its ground point [px] (its shadow stays with its feet). */
const FLIGHT_LIFT_PX = 6;
/**
 * A flier that walks takes to the air above this share of the way from its walking to its running pace per tick (a
 * gull roams at its walking pace and flies when it hurries).
 */
const AIR_PACE_SHARE = 0.5;
/** The locomotion of creatures in the air (content `fortbewegung`). */
const FLIER = 'flieger';
/** The AI state in which a flier that walks is always in the air (it flees on its wings). */
const FLEEING = 'fliehen';
/**
 * Burning shadow brood (glaring light, §12.4): a warm overlay for this long after each burn tick [ticks] – the burn
 * repeats once a second, the glow lasts half of it – in the colour of embers at a third of its strength.
 */
const BURN_GLOW = { ticks: BALANCE.time.tickHz / 2, r: 255, g: 150, b: 70, strength: 0.35 } as const;
/**
 * Eyes of night hunters in the dark: below this ambient intensity the emissive pixels glow brighter, up to `boost`
 * (of `emissiveBoost`'s 0…1, ×4 at 1) in full darkness.
 */
const EYE_GLOW = { below: 0.5, boost: 0.6 } as const;
/** The same as module constants (read without a property lookup in the frame, §30). */
const EYE_GLOW_BELOW = EYE_GLOW.below;
const EYE_GLOW_BOOST = EYE_GLOW.boost;
/**
 * A glowing body without eyes (the fireflies, M6-20) glows up to `boost` in full darkness – as bright as the drifting
 * fireflies of the world surface at their brightest (`emissiveBoost` 1, src/render/surface/fireflies.ts), so the creature
 * and the ambience are one light.
 */
const BODY_GLOW = { boost: 1 } as const;
const BODY_GLOW_BOOST = BODY_GLOW.boost;
/**
 * The mark of a Finstermond brood (ADR-0135 "eine sichtbare Kennzeichnung folgt in der Darstellung", ADR-0168): its glow
 * throbs between `low` and `high` of `emissiveBoost` (×(1 + 3 · boost)) `hz` times a second, each body in its own phase –
 * above the brightest an ordinary brood's eyes reach in full darkness (`EYE_GLOW.boost`), so it reads in any light and,
 * where only the glow shows, in the dark.
 */
export const FINSTER_GLOW = { low: 0.7, high: 1, hz: 1.25 } as const;
const FINSTER_LOW = FINSTER_GLOW.low;
const FINSTER_SPAN = FINSTER_GLOW.high - FINSTER_GLOW.low;
const FINSTER_RAD_PER_SECOND = 2 * Math.PI * FINSTER_GLOW.hz;
/**
 * A creature in the dark (§12.2): below `below` (the light stage "Dunkel", `BALANCE.light.map.stages.darkBelow`) the body
 * of a foe darkens towards black, fully at `full` – but only while the frame it is drawn with shows something that glows
 * (its eyes, a glow sack): then only that is seen. A foe whose drawn frame shows no glow – seen from behind, or without
 * eyes – is not tinted: the scene's light darkens it as much as the ground it stands on, never darker (a black hole in
 * the night otherwise; like a peaceful animal, ADR-0168).
 */
const DARK = { below: BALANCE.light.map.stages.darkBelow, full: 0.05 } as const;
const DARK_BELOW = DARK.below;
/**
 * The lights of a glowing body (the fireflies, M6-20, ADR-0104) take the look of the drifting fireflies of the world surface
 * (sprite `sprite`, src/render/surface/fireflies.ts): on each light of the drawn frame the bright cross `bright` – a pale core
 * `feuer.5*` in a cross of `gras.5*`, its halo the bloom of five glowing pixels – centred on the light's core. Of two lights
 * side by side (cores at most `pairDx` columns and `pairDy` rows apart) only the first glows: the other's pixels show the
 * firefly's dark body (`dark`), so two lights never stand like a pair of eyes (the mark of a foe in the dark, §12.2,
 * ADR-0120). They sort `depth` px in front of the body.
 */
const LIGHTS = { sprite: 'gluehwuermchen', bright: 'hell', dark: 'dunkel', pairDx: 8, pairDy: 2, depth: 0.01, glow: 1, fullBelow: SURFACE_PARAMS.fireflies.daylightBelow } as const;
/**
 * The lights glow like the drifting fireflies' bright frame (`emissiveBoost` `LIGHTS.glow`, fireflies.ts) – their halo is
 * the same bloom – once the ambient falls below `LIGHTS.fullBelow` (where those come out); from `EYE_GLOW.below` down to it
 * they fade in (no jump at dusk).
 */
const LIGHTS_GLOW = LIGHTS.glow;
const LIGHTS_FULL_BELOW = LIGHTS.fullBelow;
/** The cross's centre pixel lies this far left of and above its anchor (sprite `gluehwuermchen`: 3 × 3, anchor (1, 2)) [px]. */
const LIGHT_CENTRE_X = 0;
const LIGHT_CENTRE_Y = -1;
/** Lights of a frame drawn at once (the scan's limit). */
const MAX_FRAME_LIGHTS = 8;
/**
 * A flier whose sprite casts no sun silhouette (the swarms drawn flat – wasps, fireflies) hovers over a soft contact shadow
 * like a thing in the air (`sprite`, the shadow of drops and of shots in flight, drops.ts / projectiles.ts): the `large`
 * oval under a cell wider than `smallCellPx`, the `small` one under a small swarm, dithered by `fade` – as faint as under an
 * arrow in flight (projectiles.ts `SHADOW_FADE.flat`: a swarm hovers about as high, its sprite ≈ 9 px over its feet) –, so
 * it ties the swarm to the ground it hovers over instead of looking pasted on it (§4.6).
 */
const FLIER_SHADOW = { sprite: 'drop_schatten', large: 0, small: 1, smallCellPx: 16, fade: 0.65 } as const;
/**
 * Palette row of a Finstermond brood (assets-src/paletteRows.ts, M7-66): its mark in a still picture beside the throbbing
 * glow (`FINSTER_GLOW`) – a brighter violet rim and glow, red-hot eyes; over its biome's variant row (the Finstermond is the
 * stronger news).
 */
export const FINSTER_ROW = 'brut_finster';
/** Bodies whose drawn pose the arrows stuck in them follow (`CreaturePoses`), at once (power of two: slots by serial). */
const POSE_SLOTS = 256;
const POSE_MASK = POSE_SLOTS - 1;
/** Ticks a shadow brood forms out of the smoke (`formingFade` is 0 from then on, like the simulation's `formSeconds`). */
const FORM_TICKS = Math.max(1, Math.round(BALANCE.creatures.shadowBrood.formSeconds * BALANCE.time.tickHz));
/** Fade of shadow brood [ticks] (the simulation removes it after the same span, `shadowBrood.fadeSeconds`). */
const FADE_TICKS = Math.max(1, Math.round(BALANCE.creatures.shadowBrood.fadeSeconds * BALANCE.time.tickHz));
/** A body without a carcass dissolves over this long after its death clip [s]. */
const DISSOLVE_SECONDS = 0.6;
/** A carcass dissolves over its last seconds before it rots away [s]. */
const ROT_FADE_SECONDS = 2;
/** Deaths without a carcass shown at once (a ring: the oldest gives way). */
const DYING_SLOTS = 32;
/** Margin around the pushed rectangle in which creatures still draw [px]: the largest creature cell (64 px). */
const MARGIN_PX = 64;
/** The caught creature sits this far behind its trap's icon in the y-sort [px]. */
const CATCH_DEPTH_BIAS = -0.1;
/** Fliers that walk remembered at once by when they were last seen in the air (power of two: slots by serial). */
const AIR_SLOTS = 256;
const AIR_MASK = AIR_SLOTS - 1;
/** Slots of `moment`: the frame's moment and a landing's ticks since touch-down. */
const MOMENT_NOW = 0;
const MOMENT_LANDING = 1;
/** Creatures in water collected per frame for the immersion mask (more than the mask holds: the nearest win). */
const WET_SLOTS = 32;
/** How a creature lies in water: not at all, swimming (`creatureSwimShare` of its drawing), wading (ankle-deep). */
const WET_NONE = 0;
const WET_SWIM = 1;
const WET_WADE = 2;
/** Distance² of a creature in water already handed to the mask (above every real one: the view is a few hundred px). */
const WET_TAKEN = 0x7fffffff;
/** Depth classes of `CreatureFrame.waterAt`. */
const WATER_SHALLOW = 1;
/** Slots of `markAt`: the head's centre [world px, the sway included], the marks' height above the ground [px], the feet's y. */
const AT_X = 0;
const AT_Y = 1;
const AT_HEIGHT = 2;
const AT_FEET = 3;
/** Slot of `markAt` with a mark's clip time [s] (`clipFrameIn`). */
const AT_CLIP = 4;
const MARK_AT_REGISTERS = 5;
/** Slots of `lightAt`: the body's drawn anchor [world px], its depth, its height base [px], the lights' glow. */
const LIGHT_AT_X = 0;
const LIGHT_AT_Y = 1;
const LIGHT_AT_DEPTH = 2;
const LIGHT_AT_BASE = 3;
const LIGHT_AT_GLOW = 4;
const LIGHT_AT_REGISTERS = 5;
/** Phase of the twinkle per star and of the flicker per spark [s]: they do not blink in step. */
const TWINKLE_STEP = 0.11;
const FLICKER_STEP = 0.05;
/** The second dazzle spark sits this much higher than the first [px]: the pair is not a level line. */
const DAZZLE_RISE = 2;
/** Conditions' glow as module constants (read without a property lookup in the frame, §30). */
const STAR_GLOW = STUN.glow;
const DAZZLE_GLOW = DAZZLE.glow;
const STAR_COUNT = STUN.stars;
const DAZZLE_SPARKS = DAZZLE.sparks;
const STUN_LIFT = STUN.liftPx;
const DAZZLE_LIFT = DAZZLE.liftPx;

/** The condition marks of `manifest` (`kampf_zustand` with its three clips), null where the atlas lacks them. */
function statusLookOf(manifest: AtlasManifest): StatusLook | null {
  const sprite = manifest.sprites[STATUS_SPRITE];
  const star = sprite?.clips[STATUS_CLIPS.star];
  const farStar = sprite?.clips[STATUS_CLIPS.farStar];
  const dazzle = sprite?.clips[STATUS_CLIPS.dazzle];
  if (sprite === undefined || star === undefined || farStar === undefined || dazzle === undefined) return null;
  return { sprite, star, farStar, dazzle };
}

/** What the creature view needs of the game view's frame. */
export interface CreatureFrame {
  layer: Layer;
  /** Pushed rectangle [world px]. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Presentation time [s] (the loops of idle and walk). */
  time: number;
  /** Interpolation of the frame between the last two ticks (`GameSession.renderAlpha`). */
  alpha: number;
  /** Ambient intensity at the camera, 0…1 (night hunters' eyes glow below `EYE_GLOW.below`). */
  ambient: number;
  /** Tile of the interaction's use target on `layer` (−1 none): the carcass or trap on it carries the outline. */
  focusTx: number;
  focusTy: number;
  /** Height level of a tile (16 px per level in the G-buffer). */
  levelAt(tx: number, ty: number): number;
  /** Open water on a tile of `layer`: 0 none (land, frozen, not loaded), 1 shallow, 2 deep. */
  waterAt(tx: number, ty: number): number;
}

/** A fresh frame record. */
export function createCreatureFrame(): CreatureFrame {
  return { layer: 0, left: 0, top: 0, right: 0, bottom: 0, time: 0, alpha: 1, ambient: 1, focusTx: -1, focusTy: -1, levelAt: () => 0, waterAt: () => 0 };
}

/** What the creature view drew in the last frame. */
export interface CreatureViewStats {
  creatures: number;
  carcasses: number;
  traps: number;
  /** Deaths without a carcass still playing. */
  dying: number;
  /** Creatures whose sprite the atlas lacks (drawn as nothing). */
  missing: number;
  /** Creatures drawn darkened by the dark around them (only their eyes show, §12.2). */
  inDark: number;
  /** Creatures handed to the water's immersion mask (swimming or wading). */
  immersed: number;
  /** Shadow brood of a Finstermond night drawn with its throbbing glow. */
  finster: number;
  /** Creatures drawn stunned (stagger pose), slowed with the frost tint, and blinded (M6-80). */
  stunned: number;
  frosted: number;
  dazzled: number;
  /** Sprites of the condition marks (stars, sparks). */
  marks: number;
}

/** One action's clips per direction (`DIRECTIONS` order) and whether each is the mirrored opposite side. */
interface ActionClips {
  readonly clips: readonly (AnimationClip | null)[];
  readonly mirror: readonly boolean[];
  /** Duration of the clip per direction [s] (0 without one): read as a number of the look, no call per frame. */
  readonly seconds: Float64Array;
  /** It has a clip in some direction. */
  readonly any: boolean;
  /** Clip time [s] of the strike event of an attack clip (0 for other actions). */
  readonly strikeSeconds: number;
}

/** A creature's sprite and clips, resolved once per atlas. */
interface CreatureLook {
  readonly sprite: AtlasSprite;
  readonly idle: ActionClips;
  readonly move: ActionClips;
  readonly hit: ActionClips;
  readonly death: ActionClips;
  readonly flight: ActionClips;
  /** Per attack index of the creature, and the attacks themselves (the Kriecher's hold). */
  readonly attacks: readonly ActionClips[];
  readonly attackDefs: readonly CreatureAttack[];
  /** Camouflage: hidden, revealing (the profile's `tarnung`; no clips without it) and the reveal's length [ticks of the simulation]. */
  readonly hidden: ActionClips;
  readonly reveal: ActionClips;
  readonly revealTicks: number;
  /** Night hunter with glowing eyes. */
  readonly eyes: boolean;
  /** A glowing body without eyes (the fireflies, M6-20): its emissive pixels glow brighter in the dark like eyes. */
  readonly glow: boolean;
  /** Shadow brood: ink smoke (M6-25) – it forms, fades and dies in the smoke. */
  readonly shadow: boolean;
  /** A peaceful animal (`familie: 'friedlich'`): no foe, the dark does not tint it (§12.2 is about foes). */
  readonly peaceful: boolean;
  /** A grab's hold (the Kriecher's `festhalten`, M6-26). */
  readonly hold: ActionClips;
  /** A flier that also walks (the gull): its walk, its landing and the landing's length [ticks]. */
  readonly walk: ActionClips;
  readonly land: ActionClips;
  readonly landTicks: number;
  /** Its pace per tick above which it is in the air, squared [px²]. */
  readonly airPaceSq: number;
  /** How it lies in water: swimmers and amphibians swim, land creatures wade, fliers fly over it. */
  readonly wet: number;
  /** Share of its drawing under the surface while it swims (its kind's `wasserlinie`, else `IMMERSION.creatureSwimShare`). */
  readonly swimShare: number;
  /** Frame of its contact shadow (`FLIER_SHADOW`: a flier without a sun silhouette), −1 none. */
  readonly shadowFrame: number;
  /** Per frame of its sprite what the view needs of it (`frameScanInto`), read the first time it is asked (null before). */
  readonly scans: (Int32Array | null)[];
  /** Palette row per variant index. */
  readonly variantRows: readonly number[];
  /** Where the marks of its conditions sit (M6-80): read the first time a creature of its kind carries one. */
  readonly heads: LookHeads;
  /** Half width and height of the stars' orbit [px]. */
  readonly orbitRx: number;
  readonly orbitRy: number;
}

/**
 * Per direction the head of the stagger pose (`pose*`: the hit clip's last frame) and of the idle pose (`idle*`: the highest
 * of its frames) – its highest pixel [px above the feet] and the centre of its top rows [px from the anchor, mirrored like
 * the clip]. Read from the atlas's albedo the first time a mark needs it (`posed`, `idled`): a creature that never carries
 * a condition costs no read (M6-80).
 */
class LookHeads {
  posed = false;
  idled = false;
  readonly poseTop = new Int32Array(DIRECTIONS.length);
  readonly poseX = new Int32Array(DIRECTIONS.length);
  readonly idleTop = new Int32Array(DIRECTIONS.length);
  readonly idleX = new Int32Array(DIRECTIONS.length);
}

/** The look of a glowing body's lights (`LIGHTS`): the drifting firefly's sprite, its bright cross and its dark body. */
interface LightsLook {
  readonly bright: SpriteFrameRef;
  readonly dark: SpriteFrameRef;
}

/** The lights' look of `manifest` (`LIGHTS`), null where the atlas lacks the sprite or its clips. */
function lightsLookOf(manifest: AtlasManifest): LightsLook | null {
  const sprite = manifest.sprites[LIGHTS.sprite];
  const bright = sprite?.frames[sprite.clips[LIGHTS.bright]?.frames[0] ?? -1];
  const dark = sprite?.frames[sprite.clips[LIGHTS.dark]?.frames[0] ?? -1];
  if (bright === undefined || dark === undefined) return null;
  return { bright, dark };
}

/** The condition marks of an atlas (`kampf_zustand`): the sprite and its clips, null without them. */
interface StatusLook {
  readonly sprite: AtlasSprite;
  readonly star: AnimationClip;
  readonly farStar: AnimationClip;
  readonly dazzle: AnimationClip;
}

/** The systems of the simulation the view draws, and the poses it writes for the arrows in bodies. */
interface CreatureViewSystems {
  readonly sim: Simulation;
  readonly creatures: CreatureSystem | null;
  readonly traps: TrapSystem | null;
  readonly light: LightSystem | null;
  readonly poses: CreaturePoses | null;
}

/** A death without a carcass being shown. */
interface DyingSlot {
  active: boolean;
  creature: string;
  layer: Layer;
  x: number;
  y: number;
  facing: number;
  variant: number;
  tick: number;
}

/** A held point [world px]: a class instance whose fields start as doubles (NaN), so writing a position boxes nothing (ADR-0140). */
class HeldPoint {
  x = Number.NaN;
  y = Number.NaN;
}

/**
 * How the creature view drew a body in its last frame, for the arrows stuck in it (projectiles.ts, ADR-0124): the drawn
 * frame's top over the top of its standing pose in the same direction (`sink`: 1 standing, below 1 sagged – the stagger
 * pose of a stun, a flinch), its top above the feet [px] and how far it was drawn off its position (`shiftX`: the stun's
 * sway, `shiftY`: a flutter's lift) – the arrows ride the pose with it. Slots by serial; only the bodies an arrow sits in are
 * asked for (`want`), so a frame without arrows reads no frame of the atlas. One per creature system (`creaturePosesOf`):
 * the creature view writes it, the arrows' view reads it in the same frame (the creatures draw first).
 */
export class CreaturePoses {
  /** Frames the creature view drew (each `draw` of a frame with bodies counts one up). */
  frame = 0;
  /** The serial an arrow sits in, per slot (−1 none). */
  readonly wanted = new Int32Array(POSE_SLOTS).fill(-1);
  /** The serial the slot's pose belongs to and the frame it was drawn in (−1 none). */
  readonly serial = new Int32Array(POSE_SLOTS).fill(-1);
  readonly drawn = new Int32Array(POSE_SLOTS).fill(-1);
  readonly sink = new Float64Array(POSE_SLOTS).fill(1);
  readonly top = new Float64Array(POSE_SLOTS);
  readonly shiftX = new Float64Array(POSE_SLOTS);
  readonly shiftY = new Float64Array(POSE_SLOTS);

  /** An arrow sits in the body with `serial`: its pose is drawn from the next creature frame on. */
  want(serial: number): void {
    this.wanted[serial & POSE_MASK] = serial;
  }

  /** The slot holding the pose of `serial` drawn in the creature view's last frame, or −1. */
  slotOf(serial: number): number {
    const slot = serial & POSE_MASK;
    return this.serial[slot] === serial && this.drawn[slot] === this.frame ? slot : -1;
  }
}

/** The poses of the bodies of each creature system (`CreaturePoses`), by the system. */
const POSES = new WeakMap<object, CreaturePoses>();

/** The drawn poses of the bodies of creature system `system` (created on first use). */
export function creaturePosesOf(system: object): CreaturePoses {
  const known = POSES.get(system);
  if (known !== undefined) return known;
  const made = new CreaturePoses();
  POSES.set(system, made);
  return made;
}

/** Slots of the view's registers: values of the frame's loops handed to helpers without a call argument (§30). */
const REG_FACING = 0;
const REG_TIME = 1;
const REG_LEVEL = 2;
const REG_OUT = 3;
const REGISTERS = 4;
/** Scratch registers of the exported single-value forms. */
const SCRATCH = new Float64Array(REGISTERS);

/** Direction index of the facing in `r[i]` [rad, 0 = east, y down]: the dominant axis wins. */
function directionIn(r: Float64Array, i: number): number {
  const facing = r[i] as number;
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  if ((c < 0 ? -c : c) >= (s < 0 ? -s : s)) return c >= 0 ? DIR_RIGHT : DIR_LEFT;
  return s > 0 ? DIR_DOWN : DIR_UP;
}

/** Direction index of a facing [rad, 0 = east, y down]: the dominant axis wins. */
export function directionOfFacing(facing: number): number {
  SCRATCH[REG_FACING] = facing;
  return directionIn(SCRATCH, REG_FACING);
}

/** Registers of the attack clock (`attackClockInto`): its inputs and its result. */
const CLOCK_WINDING = 0;
const CLOCK_TICKS_IN = 1;
const CLOCK_WINDUP_TICKS = 2;
const CLOCK_STRIKE = 3;
const CLOCK_TICK_HZ = 4;
const CLOCK_SECONDS = 5;
const CLOCK_REGISTERS = 6;

/**
 * The attack clip's time from the registers `r` into `r[CLOCK_SECONDS]` (`attackClipSeconds`): the frame's loop fills
 * them in place, so no floating-point value crosses the call (a boxed tick count and strike time per attacking creature
 * and frame otherwise, §30, ADR-0167).
 */
function attackClockInto(r: Float64Array): void {
  const ticksIn = r[CLOCK_TICKS_IN] as number;
  const t = ticksIn < 0 ? 0 : ticksIn;
  const strike = r[CLOCK_STRIKE] as number;
  if ((r[CLOCK_WINDING] as number) === 1) {
    const windup = r[CLOCK_WINDUP_TICKS] as number;
    const share = t / (windup < 1 ? 1 : windup);
    r[CLOCK_SECONDS] = strike * (share < 1 ? share : 1);
  } else r[CLOCK_SECONDS] = strike + t / (r[CLOCK_TICK_HZ] as number);
}

/** Scratch registers of `attackClipSeconds`. */
const CLOCK_SCRATCH = new Float64Array(CLOCK_REGISTERS);

/**
 * Clip time [s] of an attack clip `ticksIn` ticks into its phase: the wind-up stretches the clip's positions before
 * its strike over `windupTicks`, the recovery plays on from the strike at the clip's rate.
 */
export function attackClipSeconds(phase: CreatureState['attackPhase'], ticksIn: number, windupTicks: number, strikeSeconds: number, tickHz: number): number {
  const r = CLOCK_SCRATCH;
  r[CLOCK_WINDING] = phase === 'ausholen' ? 1 : 0;
  r[CLOCK_TICKS_IN] = ticksIn;
  r[CLOCK_WINDUP_TICKS] = windupTicks;
  r[CLOCK_STRIKE] = strikeSeconds;
  r[CLOCK_TICK_HZ] = tickHz;
  attackClockInto(r);
  return r[CLOCK_SECONDS] as number;
}

/**
 * Ticks of the hitstop from `from` for `n` ticks (frozen are the ticks `from < t ≤ from + n`, like the simulation) that
 * lie within (a, b] – how long a clock running from `a` to `b` stood still.
 */
export function hitstopOverlap(from: number, n: number, a: number, b: number): number {
  if (n <= 0 || from < 0) return 0;
  const lo = a > from ? a : from;
  const end = from + n;
  const hi = b < end ? b : end;
  return hi > lo ? hi - lo : 0;
}

/** `darknessOf(r[REG_LEVEL], glowing)` into `r[REG_OUT]`. */
function darknessIn(r: Float64Array, glowing: boolean): void {
  const level = r[REG_LEVEL] as number;
  if (!glowing || !(level < DARK_BELOW)) {
    r[REG_OUT] = 0;
    return;
  }
  r[REG_OUT] = level <= DARK.full ? 1 : (DARK_BELOW - level) / (DARK_BELOW - DARK.full);
}

/**
 * Share 0–1 of black over a foe standing in light `level` (`DARK`) whose drawn frame shows something that glows
 * (`glowing`: its eyes, a glow sack) – without, none: it is as dark as the ground around it.
 */
export function darknessOf(level: number, glowing: boolean): number {
  SCRATCH[REG_LEVEL] = level;
  darknessIn(SCRATCH, glowing);
  return SCRATCH[REG_OUT] as number;
}

/** `finsterGlow(r[REG_TIME], serial)` into `r[REG_OUT]`. */
function finsterGlowIn(r: Float64Array, serial: number): void {
  r[REG_OUT] = FINSTER_LOW + FINSTER_SPAN * (0.5 + 0.5 * Math.sin((r[REG_TIME] as number) * FINSTER_RAD_PER_SECOND + serial * PHASE_STEP));
}

/** `emissiveBoost` of a Finstermond brood with serial `serial` at presentation time `seconds` (`FINSTER_GLOW`). */
export function finsterGlow(seconds: number, serial: number): number {
  SCRATCH[REG_TIME] = seconds;
  finsterGlowIn(SCRATCH, serial);
  return SCRATCH[REG_OUT] as number;
}

/**
 * How a creature with locomotion `mover` lies on a tile with water depth class `depth` (0 none, 1 shallow, 2 deep):
 * `WET_SWIM`, `WET_WADE` or `WET_NONE` (exported for the tests as numbers 1, 2, 0).
 */
export function wetKind(mover: string, depth: number): number {
  if (depth <= 0) return WET_NONE;
  if (mover === 'schwimmer' || mover === 'amphibie') return WET_SWIM;
  if (mover === 'land') return WET_WADE;
  return WET_NONE;
}

/**
 * The waterline [px above the feet] of a creature whose frame reaches `top` px above its feet, lying in water as `wet`
 * (`WET_SWIM`: `share` of its drawing under the surface – its kind's `wasserlinie`, else `IMMERSION.creatureSwimShare`;
 * `WET_WADE`: ankle-deep).
 */
export function creatureWaterline(wet: number, top: number, share: number = IMMERSION.creatureSwimShare): number {
  return wet === WET_SWIM ? Math.round(top * share) : IMMERSION.wadeDepthPx;
}

/** Clip time [s] of the strike event of `clip` (its position over its rate), or the clip's end without one. */
function strikeSecondsOf(clip: AnimationClip | null): number {
  if (clip === null) return 0;
  const e = clip.events?.find((x) => x.name === ATTACK_STRIKE_EVENT);
  return e === undefined ? clipDuration(clip) : e.frame / clip.fps;
}

/** The clips of `action` of `sprite` per direction: its own, else the mirrored opposite side, else the `down` clip. */
function actionClips(sprite: AtlasSprite, action: string): ActionClips {
  const clips: (AnimationClip | null)[] = [];
  const mirror: boolean[] = [];
  const seconds = new Float64Array(DIRECTIONS.length);
  for (const d of DIRECTIONS) {
    const own = sprite.clips[`${action}_${d}`];
    const opposite = d === 'left' ? 'right' : d === 'right' ? 'left' : null;
    const other = opposite === null ? undefined : sprite.clips[`${action}_${opposite}`];
    if (own !== undefined) {
      clips.push(own);
      mirror.push(false);
    } else if (other !== undefined) {
      clips.push(other);
      mirror.push(true);
    } else {
      clips.push(sprite.clips[`${action}_down`] ?? null);
      mirror.push(false);
    }
    const c = clips[clips.length - 1] ?? null;
    seconds[clips.length - 1] = c === null ? 0 : clipDuration(c);
  }
  let strikeSeconds = 0;
  if (action.startsWith('attack_')) strikeSeconds = strikeSecondsOf(clips[DIR_RIGHT] ?? clips[DIR_DOWN] ?? null);
  return { clips, mirror, seconds, any: clips.some((c) => c !== null), strikeSeconds };
}

export class CreatureSprites {
  private manifest: AtlasManifest | null = null;
  private readonly looks = new Map<string, CreatureLook | null>();
  private systems: CreatureViewSystems | null = null;
  private readonly dying: DyingSlot[] = Array.from({ length: DYING_SLOTS }, () => ({ active: false, creature: '', layer: 0, x: 0, y: 0, facing: 0, variant: -1, tick: 0 }));
  private nextSlot = 0;
  private subscribed: Pick<GameSession, 'onEvent'> | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly at = new HeldPoint();
  /** The point the light is asked at and its answer (`xy[2]`): no floating-point value crosses the call. */
  private readonly lightPoint = new Float64Array(3);
  /** The frame's moment [ticks] and a landing's ticks since touch-down (`airborne`): handed over without a call argument. */
  private readonly moment = new Float64Array(2);
  /** Registers of the attack clock (`attackClockInto`). */
  private readonly clock = new Float64Array(CLOCK_REGISTERS);
  /** Registers of the frame's loops (`REG_*`): facing, clip time, light and a result. */
  private readonly reg = new Float64Array(REGISTERS);
  /** Fliers that walk: the serial in each slot and the moment it was last seen in the air [ticks]. */
  private readonly airSerial = new Int32Array(AIR_SLOTS).fill(-1);
  private readonly airLast = new Float64Array(AIR_SLOTS);
  /**
   * Creatures in water this frame (`immerse`): feet [world px, snapped like the sprite's anchor], distance² to the view's
   * centre [px²], frame reach and waterline [px] – whole numbers only (the hand-over runs once per frame, §30).
   */
  private readonly wetX = new Int32Array(WET_SLOTS);
  private readonly wetY = new Int32Array(WET_SLOTS);
  private readonly wetDistance = new Int32Array(WET_SLOTS);
  private readonly wetHalf = new Int32Array(WET_SLOTS);
  private readonly wetTop = new Int32Array(WET_SLOTS);
  private readonly wetLine = new Int32Array(WET_SLOTS);
  private wetCount = 0;
  /** The carcass lifetime [ticks] for the game hour's ticks it was computed at (`carcassTicks`). */
  private carcassHourTicks = -1;
  private carcassLifeTicks = 0;
  /** The atlas of the last `draw` (the heads of the looks are read from its albedo once) and its condition marks. */
  private atlas: AtlasData | null = null;
  private status: StatusLook | null = null;
  /** The lights of glowing bodies (`LIGHTS`), the fliers' contact shadow (`FLIER_SHADOW`) and the Finstermond row (−1 none). */
  private lights: LightsLook | null = null;
  private flierShadow: AtlasSprite | null = null;
  private finsterRow = -1;
  /** Where a glowing body's lights go (`LIGHT_AT_*`): its drawn anchor, depth, height base and glow – no float crosses the call. */
  private readonly lightAt = new Float64Array(LIGHT_AT_REGISTERS);
  /** Which lights of the frame glow (1) or show the dark body (0), and their core columns and rows. */
  private readonly lightLit = new Int32Array(MAX_FRAME_LIGHTS);
  /** The content's conditions as marks and clock factors (M6-80). */
  private readonly conditionTable = new CreatureConditionTable();
  /** Registers of `conditionMarksInto` and of the marks (`starInto`, `swayInto`). */
  private readonly cond = new Float64Array(COND_REGISTERS);
  private readonly mark = new Float64Array(MARK_REGISTERS);
  /** Where a creature's marks stand: the head's centre on screen [world px], their height above the ground [px], the feet's y. */
  private readonly markAt = new Float64Array(MARK_AT_REGISTERS);
  /** The head of a frame (`frameHeadInto`), read while a look is resolved. */
  private readonly head = new Int32Array(2);
  readonly stats: CreatureViewStats = { creatures: 0, carcasses: 0, traps: 0, dying: 0, missing: 0, inDark: 0, immersed: 0, finster: 0, stunned: 0, frosted: 0, dazzled: 0, marks: 0 };

  /** Listens to the deaths of `session`'s simulation (again only when the session changes). */
  follow(session: Pick<GameSession, 'onEvent'>): void {
    // The listener's closure lives in `subscribe`: the check that runs every frame allocates no context (§30).
    if (this.subscribed !== session) this.subscribe(session);
  }

  private subscribe(session: Pick<GameSession, 'onEvent'>): void {
    this.dispose();
    this.subscribed = session;
    this.unsubscribe = session.onEvent('creatureDied', (e) => this.died(e));
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.subscribed = null;
    for (const s of this.dying) s.active = false;
    this.airSerial.fill(-1);
    this.wetCount = 0;
  }

  /** Draws the creatures, carcasses, traps and deaths of `frame.layer`. */
  draw(scene: RenderScene, atlas: AtlasData, sim: Simulation, frame: CreatureFrame): void {
    this.bind(atlas.manifest);
    const st = this.stats;
    st.creatures = 0;
    st.carcasses = 0;
    st.traps = 0;
    st.dying = 0;
    st.missing = 0;
    st.inDark = 0;
    st.immersed = 0;
    st.finster = 0;
    st.stunned = 0;
    st.frosted = 0;
    st.dazzled = 0;
    st.marks = 0;
    this.wetCount = 0;
    this.atlas = atlas;
    const sys = this.systemsOf(sim);
    const creatures = sys.creatures;
    const living = creatures === null ? 0 : creatures.store.size;
    const carcasses = creatures === null ? 0 : creatures.carcasses.size;
    // Nothing alive, dead or dying (traps need no clock): the frame forms no moment and reads none of its floats (§30).
    if (living === 0 && carcasses === 0 && !this.anyDying()) {
      if (sys.traps !== null) this.drawTraps(scene, sys.traps, frame);
      return;
    }
    const tickHz = sim.clock.tickHz;
    // The rendered moment in ticks: the state after the last completed tick, `alpha` of the way to the next.
    const now = sim.tick - 1 + frame.alpha;
    if (creatures !== null) {
      // The poses the arrows in bodies ride on are this frame's from here on (`CreaturePoses`).
      if (sys.poses !== null) sys.poses.frame++;
      // One method for the living and the carcasses: the creatures' loop makes V8 optimise it soon, and a handful of
      // carcasses alone would keep their own loop in the baseline tier, where every number read is a new one (§30).
      this.drawBodies(scene, creatures, sys.light, sys.poses, sim, frame, now, tickHz, living, carcasses, sim.clock.ticksPerGameHour);
    }
    if (sys.traps !== null) this.drawTraps(scene, sys.traps, frame);
    this.drawDying(scene, frame, now, tickHz);
  }

  /**
   * Hands the creatures in water of the last `draw` to the immersion mask of `water` (after the player's: call it once the
   * water scene is filled), the nearest to the view's centre first, as long as the mask has room.
   */
  immerse(water: WaterState): void {
    const n = this.wetCount;
    if (n === 0) return;
    const m = water.immersions;
    const dist = this.wetDistance;
    for (let pushed = 0; pushed < n && m.count < MAX_IMMERSIONS; pushed++) {
      // The nearest not yet pushed (a selection over at most `WET_SLOTS`; a pushed one is marked `WET_TAKEN`).
      let best = -1;
      let bestD = WET_TAKEN;
      for (let i = 0; i < n; i++) {
        const d = dist[i] as number;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) break;
      dist[best] = WET_TAKEN;
      if (m.push(this.wetX[best] as number, this.wetY[best] as number, this.wetHalf[best] as number, this.wetTop[best] as number, this.wetLine[best] as number) >= 0) this.stats.immersed++;
    }
    this.wetCount = 0;
  }

  /** Whether a death without a carcass still plays in a slot. */
  private anyDying(): boolean {
    const slots = this.dying;
    for (let i = 0; i < slots.length; i++) if ((slots[i] as DyingSlot).active) return true;
    return false;
  }

  /**
   * The living creatures of the layer and then its carcasses, in one method: the creatures' loop makes V8 optimise it
   * soon, and a handful of carcasses alone would keep their own loop in the baseline tier, where every number read from a
   * field is a new one (§30, ADR-0167).
   */
  private drawBodies(scene: RenderScene, creatures: CreatureSystem, light: LightSystem | null, poses: CreaturePoses | null, sim: Simulation, frame: CreatureFrame, now: number, tickHz: number, living: number, carcasses: number, ticksPerGameHour: number): void {
    const store = creatures.store;
    const catalog = creatures.catalog;
    const at = this.at;
    const layer = frame.layer;
    // The frame's blend, glows and light map, read for the first creature on the layer (a frame without one reads no
    // float, §30).
    let known = false;
    let alpha = 0;
    let time = 0;
    let eyeGlow = 0;
    let bodyGlow = 0;
    let lightGlow = 0;
    let left = 0;
    let right = 0;
    let top = 0;
    let bottom = 0;
    let centreX = 0;
    let centreY = 0;
    let map: GameplayLightMap | null = null;
    // The last completed tick: a condition acts in every tick up to its `untilTick` (M6-80).
    const lastTick = sim.tick - 1;
    for (let i = 0; i < living; i++) {
      const s = store.valueAt(i);
      if (s.layer !== layer) continue;
      if (!creatures.positionOf(store.entityAt(i), at)) continue;
      if (!known) {
        known = true;
        alpha = frame.alpha;
        time = frame.time;
        left = frame.left - MARGIN_PX;
        right = frame.right + MARGIN_PX;
        top = frame.top - MARGIN_PX;
        bottom = frame.bottom + MARGIN_PX;
        const ambient = frame.ambient;
        if (!(ambient >= EYE_GLOW_BELOW)) {
          const dark = 1 - ambient / EYE_GLOW_BELOW;
          eyeGlow = EYE_GLOW_BOOST * dark;
          bodyGlow = BODY_GLOW_BOOST * dark;
          const rise = (EYE_GLOW_BELOW - ambient) / (EYE_GLOW_BELOW - LIGHTS_FULL_BELOW);
          lightGlow = rise >= 1 ? LIGHTS_GLOW : LIGHTS_GLOW * rise;
        }
        map = light === null ? null : light.mapFor(sim);
        this.moment[MOMENT_NOW] = now;
        centreX = Math.floor((left + right) * 0.5);
        centreY = Math.floor((top + bottom) * 0.5);
      }
      // Interpolated: the last tick's movement, `1 − alpha` of it still ahead.
      const x = at.x - s.vx * (1 - alpha);
      const y = at.y - s.vy * (1 - alpha);
      if (x < left || x > right || y < top || y > bottom) continue;
      const look = this.look(s.creature, catalog);
      if (look === null) {
        this.stats.missing++;
        continue;
      }
      const reg = this.reg;
      reg[REG_FACING] = s.facing;
      const dir = directionIn(reg, REG_FACING);
      // Hitstop: every clock of the body stands for the frozen ticks (the loops keep the pause, the latest hitstop's).
      const hsFrom = s.hitstopFromTick;
      const hsTicks = s.hitstopTicks;
      let clips = look.idle;
      const still = hitstopOverlap(hsFrom, hsTicks, Number.NEGATIVE_INFINITY, now) / tickHz;
      let t = time + s.serial * PHASE_STEP - still;
      // Its conditions (M6-80): marks, and how far its loops (`aktionstempo`) and its walk (`tempo`) run ahead.
      let marks = 0;
      let paceLead = 0;
      if (s.conditions.length > 0) {
        const cr = this.cond;
        cr[COND_NOW] = now;
        cr[COND_LAST_TICK] = lastTick;
        marks = conditionMarksInto(s.conditions, this.conditionTable, cr);
        t += (cr[COND_ACTION_LEAD] as number) / tickHz;
        paceLead = ((cr[COND_PACE_LEAD] as number) - (cr[COND_ACTION_LEAD] as number)) / tickHz;
      }
      const held = (marks & MARK_HELD) !== 0 && s.fadeTick < 0 && look.hit.any;
      const pace = s.vx * s.vx + s.vy * s.vy;
      const moving = pace > STILL_PX * STILL_PX;
      const flying = s.flyUntilTick >= 0 && now <= s.flyUntilTick;
      // Water at its feet (only for those it matters to: the walking flier, and who swims or wades).
      const tx = Math.floor(x) >> TILE_SHIFT;
      const ty = Math.floor(y - 1) >> TILE_SHIFT;
      const water = look.wet !== WET_NONE || look.walk.any ? frame.waterAt(tx, ty) : 0;
      // A flier that walks: in the air while it flutters, flees, hurries or is over water; else on its feet.
      const walker = look.walk.any;
      const airborne = walker && (flying || water > 0 || s.state === FLEEING || pace > look.airPaceSq);
      let landing = -1;
      if (walker && this.airborne(s.serial, airborne, look.landTicks)) landing = this.moment[MOMENT_LANDING] as number;
      const sinceHurt = s.hurtTick < 0 ? Number.POSITIVE_INFINITY : now - s.hurtTick;
      const attack = s.attack >= 0 ? look.attacks[s.attack] : undefined;
      let sway = 0;
      if (held) {
        // Stunned: the stagger pose – the stunning hit's clip on, then its sagged last frame for as long as the stun lasts –
        // swaying a pixel to each side (its clock stands in the hitstop like every other).
        clips = look.hit;
        const since = sinceHurt - hitstopOverlap(hsFrom, hsTicks, s.hurtTick, now);
        const end = look.hit.seconds[dir] as number;
        const seconds = since / tickHz;
        t = since >= 0 && seconds < end ? seconds : end;
        const mr = this.mark;
        mr[MARK_TIME] = time - still;
        mr[MARK_SERIAL] = s.serial;
        swayInto(mr);
        sway = mr[MARK_SWAY] as number;
        this.stats.stunned++;
      } else if (s.fadeTick < 0 && s.attackPhase === 'erholen' && look.hold.any && holdingPlayer(s, look.attackDefs, now)) {
        // Holding the player: the grab's loop.
        clips = look.hold;
      } else if (s.fadeTick < 0 && s.attackPhase !== 'keine' && attack !== undefined && attack.any) {
        clips = attack;
        // The simulation stretches a wind-up by its hitstop ticks: both sides of the ratio leave them out.
        const winding = s.attackPhase === 'ausholen';
        const r = this.clock;
        r[CLOCK_WINDING] = winding ? 1 : 0;
        r[CLOCK_TICKS_IN] = now - s.attackTick - hitstopOverlap(hsFrom, hsTicks, s.attackTick, now);
        r[CLOCK_WINDUP_TICKS] = winding ? s.attackEndTick - s.attackTick - hitstopOverlap(hsFrom, hsTicks, s.attackTick, s.attackEndTick) : 0;
        r[CLOCK_STRIKE] = attack.strikeSeconds;
        r[CLOCK_TICK_HZ] = tickHz;
        attackClockInto(r);
        t = r[CLOCK_SECONDS] as number;
      } else if (s.fadeTick < 0 && sinceHurt >= 0 && sinceHurt * (1 / tickHz) < (look.hit.seconds[dir] as number) + hitstopOverlap(hsFrom, hsTicks, s.hurtTick, now) / tickHz) {
        clips = look.hit;
        t = (sinceHurt - hitstopOverlap(hsFrom, hsTicks, s.hurtTick, now)) / tickHz;
      } else if (look.revealTicks > 0 && s.tarnTick >= 0 && now - s.tarnTick < look.revealTicks && look.reveal.any) {
        // Revealing itself (forwards), or hiding again (the same clip backwards).
        clips = look.reveal;
        const seconds = (now - s.tarnTick) / tickHz;
        if (s.hidden) {
          const back = (look.reveal.seconds[dir] as number) - seconds;
          t = back > 0 ? back : 0;
        } else t = seconds;
      } else if (s.hidden && look.hidden.any) {
        clips = look.hidden;
      } else if (walker) {
        // In the air its flight (`move`), on the ground its walk, the first moments after a flight its landing.
        if (airborne) {
          clips = look.move;
          t += paceLead;
        } else if (landing >= 0 && look.land.any) {
          clips = look.land;
          t = landing / tickHz;
        } else if (moving) {
          clips = look.walk;
          t += paceLead;
        }
      } else if (flying && look.flight.any) {
        clips = look.flight;
      } else if (moving || flying) {
        clips = look.move;
        t += paceLead;
      }
      const clip = clips.clips[dir] ?? look.idle.clips[dir] ?? null;
      if (clip === null) {
        this.stats.missing++;
        continue;
      }
      const lift = flying && !walker && !held ? FLIGHT_LIFT_PX : 0;
      reg[REG_TIME] = t;
      let frameIndex = clipFrameIn(clip, reg, REG_TIME);
      if (look.sprite.frames[frameIndex] === undefined) frameIndex = 0;
      const frameRef = look.sprite.frames[frameIndex] as SpriteFrameRef;
      const mirrored = clips.mirror[dir] === true;
      const d = scene.sprite.reset();
      d.frame = frameRef;
      d.x = x + sway;
      d.y = y - lift;
      d.depth = y;
      d.mirror = mirrored;
      d.heightBase = s.level * WAND_PX_JE_STUFE + lift;
      // A Finstermond brood wears its row (M7-66), over its biome's variant.
      d.paletteRow = s.finster && this.finsterRow > 0 ? this.finsterRow : s.variant >= 0 ? (look.variantRows[s.variant] ?? 0) : 0;
      // The flash follows simulation time like the hit clip: it stands in the hitstop too (ADR-0116 and its addendum).
      d.flash = sinceHurt >= 0 && sinceHurt - hitstopOverlap(hsFrom, hsTicks, s.hurtTick, now) < FLASH_TICKS;
      if (look.eyes) d.emissiveBoost = eyeGlow;
      else if (look.glow) d.emissiveBoost = bodyGlow;
      if (s.finster) {
        // The Finstermond brood's mark: its glow throbs, above the brightest of an ordinary brood.
        reg[REG_TIME] = time;
        finsterGlowIn(reg, s.serial);
        d.emissiveBoost = reg[REG_OUT] as number;
        this.stats.finster++;
      }
      if (s.fadeTick >= 0) {
        const f = (now - s.fadeTick) / FADE_TICKS;
        d.fade = f <= 0 ? 0 : f >= 1 ? 1 : f;
      }
      if (look.shadow) {
        // Ink smoke: formed out of it after it appeared (only asked while it forms), dissolving into it when it fades.
        d.materialize = true;
        if (s.fadeTick < 0 && now - s.bornTick < FORM_TICKS) d.fade = formingFade(now - s.bornTick, tickHz);
      }
      let tinted = false;
      if (s.burnTick >= 0 && now - s.burnTick < BURN_GLOW.ticks) {
        d.tintR = BURN_GLOW.r;
        d.tintG = BURN_GLOW.g;
        d.tintB = BURN_GLOW.b;
        d.tintStrength = BURN_GLOW.strength;
        tinted = true;
      } else if (map !== null && look.eyes && !look.glow && !look.peaceful) {
        // In the dark only a foe's eyes (the emissive pixels) stay: the body's colour sinks into black – while its drawn
        // frame shows them. Seen from behind (no glow in the frame) it is not tinted: as dark as the ground, no black hole.
        // A glowing body (the fireflies) is a light itself and stays as it is: the tint would darken its glow too (albedo ×
        // emission). A foe without eyes shows nothing that glows: the dark of the scene takes it like the ground.
        const p = this.lightPoint;
        p[0] = x;
        p[1] = y;
        map.levelInto(layer, p);
        const level = p[2] as number;
        if (level < DARK_BELOW) {
          const scan = this.scanOf(look, frameIndex);
          // A frame that could not be read (no canvas) counts as the sprite's: glowing where it has glowing pixels.
          const glowing = (scan[SCAN_TOP] as number) < 0 ? look.sprite.emissive : (scan[SCAN_GLOWING] as number) > 0;
          reg[REG_LEVEL] = level;
          darknessIn(reg, glowing);
          if ((reg[REG_OUT] as number) > 0) {
            d.tintStrength = reg[REG_OUT] as number;
            this.stats.inDark++;
            tinted = true;
          }
        }
      }
      if (!tinted && (marks & MARK_FROST) !== 0) {
        // Slowed by frost: an icy tint where the body is seen (in the dark only its eyes are, §12.2).
        d.tintR = FROST.r;
        d.tintG = FROST.g;
        d.tintB = FROST.b;
        d.tintStrength = FROST.strength;
        this.stats.frosted++;
      }
      scene.sprites.push(d);
      this.stats.creatures++;
      if (look.glow && this.lights !== null) {
        // A glowing body's lights in the look of the drifting fireflies (`LIGHTS`).
        const la = this.lightAt;
        la[LIGHT_AT_X] = x + sway;
        la[LIGHT_AT_Y] = y - lift;
        la[LIGHT_AT_DEPTH] = y + LIGHTS.depth;
        la[LIGHT_AT_BASE] = s.level * WAND_PX_JE_STUFE + lift;
        la[LIGHT_AT_GLOW] = lightGlow;
        this.drawLights(scene, look, frameIndex, frameRef, mirrored);
      }
      if (look.shadowFrame >= 0 && lift === 0 && this.flierShadow !== null) {
        // A swarm in the air over its soft contact shadow (`FLIER_SHADOW`).
        const sh = scene.sprite.reset();
        sh.frame = this.flierShadow.frames[look.shadowFrame] as SpriteFrameRef;
        sh.x = x;
        sh.y = y;
        sh.layer = 'ground';
        sh.heightBase = s.level * WAND_PX_JE_STUFE;
        sh.fade = FLIER_SHADOW.fade;
        scene.sprites.push(sh);
      }
      if (poses !== null && (poses.wanted[s.serial & POSE_MASK] as number) === s.serial) {
        // An arrow sits in it: how this pose stands to its standing pose, for the arrow to ride it (`CreaturePoses`).
        const slot = s.serial & POSE_MASK;
        const heads = look.heads;
        if (!heads.idled) {
          this.headsOf(look.sprite, look.idle, false, heads.idleTop, heads.idleX);
          heads.idled = true;
        }
        const scanTop = this.scanOf(look, frameIndex)[SCAN_TOP] as number;
        const standing = heads.idleTop[dir] as number;
        const drawnTop = scanTop < 0 ? standing : frameRef.ay - scanTop;
        poses.serial[slot] = s.serial;
        poses.drawn[slot] = poses.frame;
        poses.sink[slot] = standing > 0 && drawnTop > 0 ? drawnTop / standing : 1;
        poses.top[slot] = drawnTop;
        poses.shiftX[slot] = sway;
        poses.shiftY[slot] = -lift;
      }
      if ((marks & (MARK_STARS | MARK_DAZZLE)) !== 0 && this.status !== null) {
        // The marks over its head (stars of a stun, sparks of a blinding): placed through registers (§30).
        const ma = this.markAt;
        ma[AT_X] = x + sway;
        ma[AT_Y] = y - lift;
        ma[AT_HEIGHT] = s.level * WAND_PX_JE_STUFE + lift;
        ma[AT_FEET] = y;
        const mr = this.mark;
        mr[MARK_TIME] = time - still;
        mr[MARK_SERIAL] = s.serial;
        this.drawMarks(scene, look, dir, marks);
      }
      // In water: swimming to its line, or wading ankle-deep – collected for the immersion mask (`immerse`).
      const wet = look.wet === WET_SWIM ? (water > 0 ? WET_SWIM : WET_NONE) : look.wet === WET_WADE && water === WATER_SHALLOW ? WET_WADE : WET_NONE;
      if (wet !== WET_NONE && lift === 0) this.wetAt(Math.floor(x + 0.5), Math.floor(y + 0.5), frameRef, wet, centreX, centreY, look);
    }
    if (carcasses === 0) return;
    // The carcasses (see `draw`): their death clip from the tick each was left, lying on its last frame, fading as it rots.
    const bodies = creatures.carcasses;
    const lifeTicks = this.carcassTicks(ticksPerGameHour);
    const rotFadeTicks = ROT_FADE_SECONDS * tickHz;
    const cullLeft = frame.left - MARGIN_PX;
    const cullRight = frame.right + MARGIN_PX;
    const cullTop = frame.top - MARGIN_PX;
    const cullBottom = frame.bottom + MARGIN_PX;
    const reg = this.reg;
    for (let i = 0; i < carcasses; i++) {
      const c: Carcass = bodies.valueAt(i);
      if (c.layer !== layer) continue;
      if (c.x < cullLeft || c.x > cullRight || c.y < cullTop || c.y > cullBottom) continue;
      const look = this.look(c.creature, creatures.catalog);
      if (look === null) continue;
      reg[REG_FACING] = c.facing;
      const dir = directionIn(reg, REG_FACING);
      const clip = look.death.clips[dir] ?? null;
      if (clip === null) continue;
      reg[REG_TIME] = (now - (c.untilTick - lifeTicks)) / tickHz;
      const tx = Math.floor(c.x) >> TILE_SHIFT;
      const ty = Math.floor(c.y) >> TILE_SHIFT;
      const d = scene.sprite.reset();
      d.frame = (look.sprite.frames[clipFrameIn(clip, reg, REG_TIME)] ?? look.sprite.frames[0]) as SpriteFrameRef;
      d.x = c.x;
      d.y = c.y;
      d.mirror = look.death.mirror[dir] === true;
      d.heightBase = frame.levelAt(tx, ty) * WAND_PX_JE_STUFE;
      d.outline = tx === frame.focusTx && ty === frame.focusTy;
      const remaining = c.untilTick - now;
      if (remaining < rotFadeTicks) {
        const f = 1 - remaining / rotFadeTicks;
        d.fade = f <= 0 ? 0 : f >= 1 ? 1 : f;
      }
      scene.sprites.push(d);
      this.stats.carcasses++;
    }
  }

  /**
   * The marks of the conditions `marks` of a creature drawn with `look` in direction `dir` (M6-80): the stars of a stun
   * circling above the head of its pose, the sparks of a blinding flickering at its head. Where it stands comes in
   * `markAt` (`AT_*`), the presentation clock and its serial in `mark` (`MARK_TIME`, `MARK_SERIAL`): no floating-point
   * value crosses the call (§30).
   */
  private drawMarks(scene: RenderScene, look: CreatureLook, dir: number, marks: number): void {
    const status = this.status;
    if (status === null) return;
    const ma = this.markAt;
    const mr = this.mark;
    const x = ma[AT_X] as number;
    const y = ma[AT_Y] as number;
    const base = ma[AT_HEIGHT] as number;
    const feet = ma[AT_FEET] as number;
    const clock = mr[MARK_TIME] as number;
    const held = (marks & MARK_HELD) !== 0;
    // The head of the pose it shows: the sagged stagger pose while held, else its idle pose (read once per kind).
    const heads = look.heads;
    if (held && !heads.posed) {
      this.headsOf(look.sprite, look.hit.any ? look.hit : look.idle, true, heads.poseTop, heads.poseX);
      heads.posed = true;
    } else if (!held && !heads.idled) {
      this.headsOf(look.sprite, look.idle, false, heads.idleTop, heads.idleX);
      heads.idled = true;
    }
    const head = held ? (heads.poseTop[dir] as number) : (heads.idleTop[dir] as number);
    const cx = x + (held ? (heads.poseX[dir] as number) : (heads.idleX[dir] as number));
    const frames = status.sprite.frames;
    if ((marks & MARK_STARS) !== 0) {
      // The orbit's centre: its lowest point `liftPx` above the head.
      const up = head + look.orbitRy + STUN_LIFT;
      mr[MARK_RX] = look.orbitRx;
      mr[MARK_RY] = look.orbitRy;
      for (let i = 0; i < STAR_COUNT; i++) {
        starInto(mr, i);
        const front = (mr[MARK_FRONT] as number) === 1;
        ma[AT_CLIP] = clock + i * TWINKLE_STEP;
        const d = scene.sprite.reset();
        d.frame = (frames[clipFrameIn(front ? status.star : status.farStar, ma, AT_CLIP)] ?? frames[0]) as SpriteFrameRef;
        d.x = cx + (mr[MARK_X] as number);
        d.y = y - up + (mr[MARK_Y] as number);
        d.depth = front ? feet + MARK_DEPTH : feet - MARK_DEPTH;
        d.heightBase = base + up;
        d.emissiveBoost = STAR_GLOW;
        scene.sprites.push(d);
        this.stats.marks++;
      }
    }
    if ((marks & MARK_DAZZLE) !== 0) {
      const up = head + DAZZLE_LIFT;
      const spread = Math.round(look.orbitRx * DAZZLE.spreadShare);
      for (let i = 0; i < DAZZLE_SPARKS; i++) {
        ma[AT_CLIP] = clock + i * FLICKER_STEP;
        const d = scene.sprite.reset();
        d.frame = (frames[clipFrameIn(status.dazzle, ma, AT_CLIP)] ?? frames[0]) as SpriteFrameRef;
        d.x = cx + ((i & 1) === 0 ? -spread : spread);
        d.y = y - up - ((i & 1) === 0 ? 0 : DAZZLE_RISE);
        d.depth = feet + MARK_DEPTH;
        d.heightBase = base + up;
        d.emissiveBoost = DAZZLE_GLOW;
        scene.sprites.push(d);
        this.stats.marks++;
      }
      this.stats.dazzled++;
    }
  }

  /**
   * Remembers whether the flier that walks with `serial` is in the air at the frame's moment (`moment[MOMENT_NOW]`
   * [ticks]); true while it lands – the ticks since it touched down, within `landTicks`, are in `moment[MOMENT_LANDING]`
   * (no floating-point value crosses the call).
   */
  private airborne(serial: number, inAir: boolean, landTicks: number): boolean {
    const slot = serial & AIR_MASK;
    const m = this.moment;
    if (inAir) {
      this.airSerial[slot] = serial;
      this.airLast[slot] = m[MOMENT_NOW] as number;
      return false;
    }
    if (this.airSerial[slot] !== serial) return false;
    const since = (m[MOMENT_NOW] as number) - (this.airLast[slot] as number);
    if (!(since >= 0 && since < landTicks)) return false;
    m[MOMENT_LANDING] = since;
    return true;
  }

  /** The scan of frame `index` of `look`'s sprite (`frameScanInto`; read from the atlas the first time it is asked). */
  private scanOf(look: CreatureLook, index: number): Int32Array {
    const known = look.scans[index];
    return known !== undefined && known !== null ? known : this.scanFrame(look, index);
  }

  /** Reads and remembers the scan of frame `index` of `look`'s sprite (its own method: the frame's loop allocates nothing). */
  private scanFrame(look: CreatureLook, index: number): Int32Array {
    const out = new Int32Array(SCAN_SIZE);
    const f = look.sprite.frames[index];
    if (this.atlas === null || f === undefined || !frameScanInto(this.atlas, f, out)) out[SCAN_TOP] = -1;
    look.scans[index] = out;
    return out;
  }

  /**
   * The lights of a glowing body drawn with frame `index` (`ref`, mirrored or not) of `look` in the look of the drifting
   * fireflies (`LIGHTS`): the bright cross on the core of each light, the dark body on every pixel of a light beside an
   * earlier one. Where the body was drawn comes in `lightAt` (`LIGHT_AT_*`): no floating-point value crosses the call.
   */
  private drawLights(scene: RenderScene, look: CreatureLook, index: number, ref: SpriteFrameRef, mirrored: boolean): void {
    const lights = this.lights;
    if (lights === null) return;
    const scan = this.scanOf(look, index);
    const n = (scan[SCAN_LIGHTS] as number) < MAX_FRAME_LIGHTS ? (scan[SCAN_LIGHTS] as number) : MAX_FRAME_LIGHTS;
    if (n === 0) return;
    const lit = this.lightLit;
    for (let k = 0; k < n; k++) {
      const at = SCAN_LIGHT + k * SCAN_LIGHT_FIELDS;
      const core = scan[at + LIGHT_CORE] as number;
      const row = scan[at + LIGHT_Y] as number;
      let free = 1;
      for (let j = 0; j < k && free === 1; j++) {
        if ((lit[j] as number) !== 1) continue;
        const other = SCAN_LIGHT + j * SCAN_LIGHT_FIELDS;
        const dx = core - (scan[other + LIGHT_CORE] as number);
        const dy = row - (scan[other + LIGHT_Y] as number);
        if ((dx < 0 ? -dx : dx) <= LIGHTS.pairDx && (dy < 0 ? -dy : dy) <= LIGHTS.pairDy) free = 0;
      }
      lit[k] = free;
    }
    const la = this.lightAt;
    const x = la[LIGHT_AT_X] as number;
    const y = la[LIGHT_AT_Y] as number;
    const depth = la[LIGHT_AT_DEPTH] as number;
    const base = la[LIGHT_AT_BASE] as number;
    const glow = la[LIGHT_AT_GLOW] as number;
    for (let k = 0; k < n; k++) {
      const at = SCAN_LIGHT + k * SCAN_LIGHT_FIELDS;
      const row = scan[at + LIGHT_Y] as number;
      const from = (lit[k] as number) === 1 ? (scan[at + LIGHT_CORE] as number) : (scan[at + LIGHT_X0] as number);
      const to = (lit[k] as number) === 1 ? from : (scan[at + LIGHT_X1] as number);
      for (let col = from; col <= to; col++) {
        // The light sprite's centre pixel on pixel (col, row) of the body's frame: mirrored frames reflect about the anchor.
        const d = scene.sprite.reset();
        d.frame = (lit[k] as number) === 1 ? lights.bright : lights.dark;
        d.x = x + (mirrored ? ref.ax - col - 1 : col - ref.ax) - LIGHT_CENTRE_X;
        d.y = y + (row - ref.ay) - LIGHT_CENTRE_Y;
        d.depth = depth;
        d.heightBase = base + ref.ay - row - 1;
        d.emissiveBoost = (lit[k] as number) === 1 ? glow : 0;
        scene.sprites.push(d);
      }
    }
  }

  /**
   * Collects a creature in water with its feet at pixel (x, y) (snapped like its sprite), drawn with `frame` (`wet`: how it
   * lies in it; its waterline from `look`), for `immerse`; (cx, cy) is the view's centre pixel.
   */
  private wetAt(x: number, y: number, frame: SpriteFrameRef, wet: number, cx: number, cy: number, look: CreatureLook): void {
    const i = this.wetCount;
    if (i >= WET_SLOTS) return;
    this.wetCount = i + 1;
    const top = frame.ay;
    const half = frame.ax > frame.w - frame.ax ? frame.ax : frame.w - frame.ax;
    this.wetX[i] = x;
    this.wetY[i] = y;
    this.wetDistance[i] = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    this.wetHalf[i] = half;
    this.wetTop[i] = top;
    this.wetLine[i] = creatureWaterline(wet, top, look.swimShare);
  }

  private drawTraps(scene: RenderScene, traps: TrapSystem, frame: CreatureFrame): void {
    const list = traps.traps;
    const m = this.manifest;
    if (m === null) return;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t === undefined || t.layer !== frame.layer) continue;
      const x = (t.tx + 0.5) * TILE_PX;
      const y = (t.ty + 0.5) * TILE_PX;
      if (x < frame.left - MARGIN_PX || x > frame.right + MARGIN_PX || y < frame.top - MARGIN_PX || y > frame.bottom + MARGIN_PX) continue;
      const icon = m.sprites[iconSprite(t.item)];
      if (icon === undefined) continue;
      const base = frame.levelAt(t.tx, t.ty) * WAND_PX_JE_STUFE;
      const d = scene.sprite.reset();
      d.frame = icon.frames[0] as SpriteFrameRef;
      d.x = x;
      d.y = y;
      d.heightBase = base;
      d.outline = t.tx === frame.focusTx && t.ty === frame.focusTy;
      scene.sprites.push(d);
      this.stats.traps++;
      if (t.caught === null) continue;
      const look = this.look(t.caught, null);
      const clip = look?.idle.clips[DIR_DOWN] ?? null;
      if (look === null || clip === null) continue;
      const reg = this.reg;
      reg[REG_TIME] = frame.time + t.id * PHASE_STEP;
      const c = scene.sprite.reset();
      c.frame = (look.sprite.frames[clipFrameIn(clip, reg, REG_TIME)] ?? look.sprite.frames[0]) as SpriteFrameRef;
      c.x = x;
      c.y = y;
      c.depth = y + CATCH_DEPTH_BIAS;
      c.heightBase = base;
      scene.sprites.push(c);
    }
  }

  private drawDying(scene: RenderScene, frame: CreatureFrame, now: number, tickHz: number): void {
    const slots = this.dying;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i] as DyingSlot;
      if (!s.active) continue;
      const look = this.look(s.creature, null);
      const reg = this.reg;
      reg[REG_FACING] = s.facing;
      const dir = directionIn(reg, REG_FACING);
      const clip = look?.death.clips[dir] ?? null;
      if (look === null || clip === null) {
        s.active = false;
        continue;
      }
      const seconds = (now - s.tick) / tickHz;
      reg[REG_TIME] = seconds;
      const dissolve = (seconds - (look.death.seconds[dir] as number)) / DISSOLVE_SECONDS;
      if (dissolve >= 1) {
        s.active = false;
        continue;
      }
      if (s.layer !== frame.layer) continue;
      const tx = Math.floor(s.x) >> TILE_SHIFT;
      const ty = Math.floor(s.y) >> TILE_SHIFT;
      const d = scene.sprite.reset();
      d.frame = (look.sprite.frames[clipFrameIn(clip, reg, REG_TIME)] ?? look.sprite.frames[0]) as SpriteFrameRef;
      d.x = s.x;
      d.y = s.y;
      d.mirror = look.death.mirror[dir] === true;
      d.heightBase = frame.levelAt(tx, ty) * WAND_PX_JE_STUFE;
      d.paletteRow = s.variant >= 0 ? (look.variantRows[s.variant] ?? 0) : 0;
      d.fade = dissolve > 0 ? dissolve : 0;
      // Shadow brood decays into the smoke's glowing sparks.
      d.materialize = look.shadow;
      scene.sprites.push(d);
      this.stats.dying++;
    }
  }

  /** A death: bodies without a carcass play their death clip in a ring slot (the carcass shows the others). */
  private died(e: CreatureEventMap['creatureDied']): void {
    if (e.carcass !== NULL_ENTITY) return;
    const s = this.dying[this.nextSlot] as DyingSlot;
    this.nextSlot = (this.nextSlot + 1) % DYING_SLOTS;
    s.active = true;
    s.creature = e.creature;
    s.layer = e.layer;
    s.x = e.x;
    s.y = e.y;
    s.facing = e.facing;
    s.variant = e.variant;
    s.tick = e.tick;
  }

  /** Ticks a carcass lies (`carcassGameHours` at `ticksPerGameHour`), computed again only when the hour's ticks change. */
  private carcassTicks(ticksPerGameHour: number): number {
    if (ticksPerGameHour !== this.carcassHourTicks) {
      this.carcassHourTicks = ticksPerGameHour;
      this.carcassLifeTicks = Math.round(BALANCE.creatures.hunting.carcassGameHours * ticksPerGameHour);
    }
    return this.carcassLifeTicks;
  }

  private bind(manifest: AtlasManifest): void {
    if (this.manifest === manifest) return;
    this.manifest = manifest;
    this.looks.clear();
    this.status = statusLookOf(manifest);
    this.lights = lightsLookOf(manifest);
    this.flierShadow = manifest.sprites[FLIER_SHADOW.sprite] ?? null;
    const finster = manifest.paletteRows.findIndex((r) => r.name === FINSTER_ROW);
    this.finsterRow = finster > 0 ? finster : -1;
  }

  private systemsOf(sim: Simulation): CreatureViewSystems {
    const s = this.systems;
    if (s !== null && s.sim === sim) return s;
    return this.findSystems(sim);
  }

  /** The systems of `sim` (once per simulation; the search's closures live here, not in the frame's call). */
  private findSystems(sim: Simulation): CreatureViewSystems {
    const c = sim.systems.find((x) => x.id === CREATURES_SYSTEM_ID);
    const t = sim.systems.find((x) => x.id === TRAPS_SYSTEM_ID);
    const creatures = c instanceof CreatureSystem ? c : null;
    const s = { sim, creatures, traps: t instanceof TrapSystem ? t : null, light: lightSystemOf(sim), poses: creatures === null ? null : creaturePosesOf(creatures) };
    this.systems = s;
    return s;
  }

  /** The look of `creature` (resolved on first use per atlas), or null without its sprite. */
  private look(creature: string, catalog: CreatureCatalog | null): CreatureLook | null {
    const known = this.looks.get(creature);
    return known !== undefined ? known : this.resolve(creature, catalog);
  }

  /**
   * Resolves and remembers the look of `creature`. Its own method: the closures that build the look would give every
   * call of `look` a context to allocate (§30).
   */
  private resolve(creature: string, catalog: CreatureCatalog | null): CreatureLook | null {
    const m = this.manifest;
    const sprite = m?.sprites[creatureSpriteId(creature)];
    const cat = catalog ?? this.systems?.creatures?.catalog ?? null;
    if (m === null || sprite === undefined || cat === null || !cat.has(creature)) {
      this.looks.set(creature, null);
      return null;
    }
    const kind = cat.get(creature);
    const def = kind.def;
    const tarnung = kind.profile.tarnung;
    const walk = actionClips(sprite, ACTION_WALK);
    const land = actionClips(sprite, ACTION_LAND);
    const airPace = kind.walkPx + (kind.runPx - kind.walkPx) * AIR_PACE_SHARE;
    const orbitRx = orbitRadius(sprite.size[0]);
    const look: CreatureLook = {
      sprite,
      idle: actionClips(sprite, ACTION_IDLE),
      move: actionClips(sprite, ACTION_MOVE),
      hit: actionClips(sprite, ACTION_HIT),
      death: actionClips(sprite, ACTION_DEATH),
      flight: actionClips(sprite, ACTION_FLIGHT),
      attacks: def.angriffe.map((a) => actionClips(sprite, attackClipAction(a.name))),
      attackDefs: kind.attacks,
      hidden: actionClips(sprite, CREATURE_HIDDEN_ACTION),
      reveal: actionClips(sprite, CREATURE_REVEAL_ACTION),
      revealTicks: tarnung === undefined ? 0 : Math.max(1, Math.round(tarnung.erwachen * BALANCE.time.tickHz)),
      eyes: def.augen !== null,
      glow: def.augen === null && sprite.emissive,
      shadow: kind.shadow,
      peaceful: def.familie === 'friedlich',
      hold: actionClips(sprite, ACTION_HOLD),
      walk,
      land,
      landTicks: Math.max(1, Math.round((land.seconds[DIR_DOWN] as number) * BALANCE.time.tickHz)),
      airPaceSq: airPace * airPace,
      wet: wetKind(def.fortbewegung, 1),
      swimShare: def.wasserlinie ?? IMMERSION.creatureSwimShare,
      shadowFrame: def.fortbewegung === FLIER && sprite.sunShadow !== true ? (sprite.size[0] > FLIER_SHADOW.smallCellPx ? FLIER_SHADOW.large : FLIER_SHADOW.small) : -1,
      scans: sprite.frames.map(() => null),
      variantRows: (def.varianten ?? []).map((v) => Math.max(0, m.paletteRows.findIndex((r) => r.name === v.palette))),
      heads: new LookHeads(),
      orbitRx,
      orbitRy: orbitHeight(orbitRx),
    };
    this.looks.set(creature, look);
    return look;
  }

  /**
   * The head of the pose `pose` per direction into `top` [px above the feet] and `x` [px from the anchor, mirrored like the
   * clip]: of its last frame (`last`: the held stagger pose) or the highest of its frames (a loop). Read from the atlas's
   * albedo, each frame once (left and right share theirs); where it cannot be read, the top of all the sprite's frames
   * (`bounds`) above the anchor.
   */
  private headsOf(sprite: AtlasSprite, pose: ActionClips, last: boolean, top: Int32Array, x: Int32Array): void {
    const atlas = this.atlas;
    const head = this.head;
    const ay = sprite.frames[0]?.ay ?? 0;
    const fallbackTop = ay - (sprite.bounds?.y ?? 0);
    // Frames already read: frame index → [up, centre] (−1: unreadable).
    const read = new Map<number, readonly [number, number]>();
    for (let dir = 0; dir < DIRECTIONS.length; dir++) {
      const clip = pose.clips[dir] ?? null;
      let best = -1;
      let centre = 0;
      const from = clip === null ? 0 : last ? clip.frames.length - 1 : 0;
      const to = clip === null ? 0 : clip.frames.length;
      for (let i = from; i < to && atlas !== null; i++) {
        const index = (clip as AnimationClip).frames[i] as number;
        let known = read.get(index);
        if (known === undefined) {
          const f = sprite.frames[index];
          known = f !== undefined && frameHeadInto(atlas, f, head) ? [f.ay - (head[HEAD_TOP] as number), (head[HEAD_CENTRE] as number) - f.ax] : [-1, 0];
          read.set(index, known);
        }
        if (known[0] <= best) continue;
        best = known[0];
        centre = known[1];
      }
      top[dir] = best < 0 ? fallbackTop : best;
      // A mirrored clip reflects about the anchor's vertical line (sprite_gbuffer.vert).
      x[dir] = best < 0 ? 0 : pose.mirror[dir] === true ? -centre : centre;
    }
  }
}
