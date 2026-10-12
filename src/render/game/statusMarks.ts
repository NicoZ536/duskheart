/**
 * How a creature's conditions show on it (M6-80, ADR-0173; MASTERPROMPT §4.6 Lesbarkeit, §11.3 "sichtbare Wirkung", §19.3 "Zustände
 * über Waffen und Munition (… Frost-Verlangsamung, … Betäubung)"; docs/ART.md §8): the presentation reads the conditions of
 * `CreatureState.conditions` – the same list the simulation acts on – and shows them for exactly the ticks they act.
 *
 * - **Held** (a condition's `aktionstempo` 0 – Betäubt; the simulation holds the creature like a stagger, ADR-0151): the
 *   creature takes the stagger pose – its hit clip, played on from the stunning hit and held on its last frame (sagged) –
 *   and sways a pixel to each side (`STUN.swayPx`, `swayHz`).
 * - **Stars** (`sichtbar: 'sterne'`): three stars (`kampf_zustand`, clips `stern` in front, `stern_fern` behind) circle
 *   above the head of that pose on a flat ellipse (3/4 view), the ones behind smaller and dimmer.
 * - **Frost** (`sichtbar: 'zeitlupe'`, Verlangsamt): the body turns ice blue – its palette row `frost` (M7-71,
 *   creatures.ts `FROST_ROW`); a body with a row of its own (a brood's biome variant) takes the icy tint (`FROST`, `eis.1`)
 *   instead, unless the dark takes it (a foe in the dark shows only its eyes, §12.2).
 * - **Slowed clocks**: every condition's `aktionstempo` below 1 slows the creature's loops (idle, flutter, hold), its
 *   `tempo` the walk – each condition runs them `1 − factor` behind presentation time for as long as it lasts, so they
 *   rejoin it exactly when it ends (no jump then; the jump into the slow falls on the hit that laid it, under the hit
 *   clip). The wind-up needs nothing here: the simulation already stretches it (ADR-0151).
 * - **Dazzle** (`sichtbar: 'blendung'`, Geblendet): two slanted sparks (`kampf_zustand`, clip `blendung`) flicker at the
 *   head, unlike the upright glint of a telegraph.
 *
 * The marks are emissive like the glint and the ground marker (ART §8: fight signs read at night). Everything here is a
 * pure function of the simulation's state and the presentation time, so a frozen frame always shows the same picture;
 * no floating-point value crosses a call (registers in a `Float64Array`, §30, ADR-0142, ADR-0167).
 */
import { CONDITIONS, type ConditionVisual } from '../../content/conditions';
import { clipFrameIn, type AnimationClip } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';

/** The sprite of the marks and its clips (assets-src/sprites/kampf/zustaende.ts). */
export const STATUS_SPRITE = 'kampf_zustand';
export const STATUS_CLIPS = { star: 'stern', farStar: 'stern_fern', dazzle: 'blendung' } as const;

/** Mark bits of a condition: the stagger pose, the stars, the frost tint, the dazzle sparks. */
export const MARK_HELD = 1;
export const MARK_STARS = 2;
export const MARK_FROST = 4;
export const MARK_DAZZLE = 8;

/** The visual hooks (`ConditionDef.sichtbar`) that put a mark on a creature. */
const MARK_OF_VISUAL: Partial<Record<ConditionVisual, number>> = { sterne: MARK_STARS, zeitlupe: MARK_FROST, blendung: MARK_DAZZLE };

/**
 * The stun (presentation values): `stars` circle `turnHz` times a second on an ellipse whose half width is `radiusShare` of
 * the creature's cell width (at least `minRadiusPx`, at most `maxRadiusPx`: three 5-px stars never overlap) and whose half
 * height is `tilt` of it (the 3/4 view), its lowest point `liftPx` above the head's highest pixel (the stars' centres; a
 * star reaches 2 px below its centre); the stars glow with `glow` of `emissiveBoost` (×(1 + 3·glow)). The pose sways
 * `swayPx` to each side `swayHz` times a second.
 */
export const STUN = { stars: 3, turnHz: 0.9, radiusShare: 0.28, minRadiusPx: 5, maxRadiusPx: 12, tilt: 0.4, liftPx: 3, glow: 0.3, swayPx: 1, swayHz: 1.2 } as const;
/**
 * The icy tint of a slowed creature that keeps a palette row of its own (a brood's biome variant; every other body takes the
 * row `frost`, M7-71): `eis.1` (#7ea3c9) at `strength` of the overlay (the pallor of a shivering player is the same colour at
 * 0,24–0,38).
 */
export const FROST = { r: 0x7e, g: 0xa3, b: 0xc9, strength: 0.5 } as const;
/**
 * The dazzle (presentation values): `sparks` sparks `spreadShare` of the orbit's half width to each side of the head's
 * centre, `liftPx` above its highest pixel, each flickering on its own phase; they glow with `glow`.
 */
export const DAZZLE = { sparks: 2, spreadShare: 0.75, liftPx: 1, glow: 0.4 } as const;
/** The stars in front sort just before the creature, the ones behind just after it (y-sort offset [px]). */
export const MARK_DEPTH = 0.02;

const TWO_PI = 2 * Math.PI;
const TURN_RAD_PER_SECOND = TWO_PI * STUN.turnHz;
const STAR_STEP = TWO_PI / STUN.stars;
const SWAY_RAD_PER_SECOND = TWO_PI * STUN.swayHz;
/** Phase offset of the sway and the orbit per creature serial [rad]: a stunned pack does not sway in unison. */
const SERIAL_PHASE = 1.7;

/** The look of the content's conditions on a creature, by condition: mark bits and how far each slows the clocks. */
export interface StatusConditionSource {
  readonly id: string;
  readonly sichtbar: ConditionVisual;
  readonly wirkung: { readonly tempo?: number | undefined; readonly aktionstempo?: number | undefined };
}

/**
 * Per condition of the content: its mark bits, and `1 − aktionstempo` / `1 − tempo` – how much of its remaining time the
 * loops / the walk run ahead (see `conditionMarksInto`). Built once; looked up by id without allocation.
 */
export class CreatureConditionTable {
  private readonly ids = new Map<string, number>();
  readonly marks: Int32Array;
  readonly actionLead: Float64Array;
  readonly paceLead: Float64Array;

  constructor(defs: readonly StatusConditionSource[] = CONDITIONS) {
    this.marks = new Int32Array(defs.length);
    this.actionLead = new Float64Array(defs.length);
    this.paceLead = new Float64Array(defs.length);
    defs.forEach((d, i) => {
      this.ids.set(d.id, i);
      const action = d.wirkung.aktionstempo ?? 1;
      const pace = d.wirkung.tempo ?? 1;
      this.marks[i] = (action <= 0 ? MARK_HELD : 0) | (MARK_OF_VISUAL[d.sichtbar] ?? 0);
      // A held creature shows its pose, not its loops: its clocks need no lead (they rejoin when the stun ends).
      this.actionLead[i] = action <= 0 ? 0 : 1 - action;
      this.paceLead[i] = action <= 0 ? 0 : 1 - pace;
    });
  }

  /** Row of condition `id`, −1 for an id the content lacks. */
  indexOf(id: string): number {
    const i = this.ids.get(id);
    return i === undefined ? -1 : i;
  }
}

/** Registers of `conditionMarksInto`: its inputs (the frame's moment, the last completed tick) and its results. */
export const COND_NOW = 0;
export const COND_LAST_TICK = 1;
export const COND_ACTION_LEAD = 2;
export const COND_PACE_LEAD = 3;
export const COND_REGISTERS = 4;

/** A condition as the creature carries it (`CreatureState.conditions`). */
export interface StatusCondition {
  readonly id: string;
  readonly untilTick: number;
}

/**
 * The marks of the conditions `list` of a creature at the frame's moment `r[COND_NOW]` [ticks, fractional], the state after
 * the last completed tick `r[COND_LAST_TICK]`: a condition acts in every tick up to and including its `untilTick` (the
 * simulation ends it in the creature's first tick after it), so it shows while `lastTick ≤ untilTick` – one the simulation
 * has not swept yet shows no more. Returns the mark bits; writes into `r[COND_ACTION_LEAD]` and `r[COND_PACE_LEAD]` how far
 * [ticks] the loops and the walk run ahead of presentation time: each condition `1 − factor` of the ticks it has left
 * (`untilTick + 1 − now`) – they run at `factor` and meet presentation time when it ends.
 */
export function conditionMarksInto(list: readonly StatusCondition[], table: CreatureConditionTable, r: Float64Array): number {
  const now = r[COND_NOW] as number;
  const last = r[COND_LAST_TICK] as number;
  let marks = 0;
  let action = 0;
  let pace = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i] as StatusCondition;
    const until = c.untilTick;
    if (last > until) continue;
    const k = table.indexOf(c.id);
    if (k < 0) continue;
    marks |= table.marks[k] as number;
    const left = until + 1 - now;
    if (left > 0) {
      action += (table.actionLead[k] as number) * left;
      pace += (table.paceLead[k] as number) * left;
    }
  }
  r[COND_ACTION_LEAD] = action;
  r[COND_PACE_LEAD] = pace;
  return marks;
}

/**
 * Registers of `starInto` and `swayInto`: the presentation clock [s], the creature's serial, the ellipse's half width and
 * height [px], and the results – a star's offset from the orbit's centre [whole px], whether it is in front, the sway [px].
 */
export const MARK_TIME = 0;
export const MARK_SERIAL = 1;
export const MARK_RX = 2;
export const MARK_RY = 3;
export const MARK_X = 4;
export const MARK_Y = 5;
export const MARK_FRONT = 6;
export const MARK_SWAY = 7;
export const MARK_REGISTERS = 8;

/** Star `i` of `STUN.stars` at `r[MARK_TIME]`: its offset into `r[MARK_X]`, `r[MARK_Y]`, in front (1) or behind (0) into `r[MARK_FRONT]`. */
export function starInto(r: Float64Array, i: number): void {
  const a = (r[MARK_TIME] as number) * TURN_RAD_PER_SECOND + (r[MARK_SERIAL] as number) * SERIAL_PHASE + i * STAR_STEP;
  const s = Math.sin(a);
  r[MARK_X] = Math.round(Math.cos(a) * (r[MARK_RX] as number));
  r[MARK_Y] = Math.round(s * (r[MARK_RY] as number));
  // y grows downwards: the lower half of the ellipse is the near side.
  r[MARK_FRONT] = s >= 0 ? 1 : 0;
}

/** The sway of the stagger pose at `r[MARK_TIME]` into `r[MARK_SWAY]` [whole px, −swayPx … swayPx]. */
export function swayInto(r: Float64Array): void {
  r[MARK_SWAY] = Math.round(Math.sin((r[MARK_TIME] as number) * SWAY_RAD_PER_SECOND + (r[MARK_SERIAL] as number) * SERIAL_PHASE) * STUN.swayPx);
}

/** Half width of the stars' orbit [whole px] for a creature cell `cellWidth` px wide. */
export function orbitRadius(cellWidth: number): number {
  const r = Math.round(cellWidth * STUN.radiusShare);
  return r < STUN.minRadiusPx ? STUN.minRadiusPx : r > STUN.maxRadiusPx ? STUN.maxRadiusPx : r;
}

/** Height of the stars' orbit [whole px, at least 1] for half width `rx`. */
export function orbitHeight(rx: number): number {
  const h = Math.round(rx * STUN.tilt);
  return h < 1 ? 1 : h;
}

/**
 * The stun's stars over the player's head (M7-69; `sichtbar: 'sterne'`, Betäubt; the creatures' stars of ADR-0173): the
 * player figure's crown is its body's socket `last` (the top of the bare head); some hairstyles rise above it
 * (`hairHeadroom`: the Irokese 4 px, Dutt and Stacheln 3, Locken and Wuschel 2; helmets and caps sit on the crown, and the
 * hair under them too), and the lowest star's lowest pixel stays `clearPx` above that – as a creature's stars stand above
 * the highest pixel of its pose.
 * The orbit's half width is the creatures' for the figure's 32-px cell (`orbitRadius(cellPx)`: 9 px, a little wider than the
 * 12-px head), its height their tilt of it. The stars are the creatures' with a dark rim (`PLAYER_STARS_SPRITE`): the player
 * often stands on bright sand, where the pale yellow stars faded into the ground (`zustand-betaeubt`).
 * `tests/unit/render/spieler-sterne.test.ts` holds every hairstyle and every headgear in every body shape to it.
 */
export const PLAYER_STUN = { clearPx: 1, cellPx: 32 } as const;
/** The player's stars: the creatures' with a rim of `feuer.0` (assets-src/sprites/kampf/spieler_sterne.ts); the creatures' serve while the atlas lacks it. */
export const PLAYER_STARS_SPRITE = 'spieler_sterne';
/**
 * Suffix of a hairstyle's preview on the figure (`frisur_<id>_ansicht`, assets-src/sprites/frisuren: the standing figure with
 * that hair, as the character creation shows it): its opaque bounds say how far the hair rises above the bare crown.
 */
export const HAIR_PREVIEW_SUFFIX = '_ansicht';
/** Registers of `HeadStars.draw`: the head's centre and crown on screen [world px], the ground's height and the feet's y [px], the clock [s], a serial, the headroom over the crown [px]. */
export const STARS_X = 0;
export const STARS_CROWN = 1;
export const STARS_GROUND = 2;
export const STARS_FEET = 3;
export const STARS_TIME = 4;
export const STARS_SERIAL = 5;
export const STARS_HEADROOM = 6;
export const STARS_REGISTERS = 7;
const PLAYER_ORBIT_RX = orbitRadius(PLAYER_STUN.cellPx);
const PLAYER_ORBIT_RY = orbitHeight(PLAYER_ORBIT_RX);
/** Phase of the twinkle per star [s] (as on creatures): they do not blink in step. */
const STAR_TWINKLE_STEP = 0.11;

/** Headroom per hair sprite, per manifest (read once per hairstyle). */
const HEADROOMS = new WeakMap<AtlasManifest, Map<string, number>>();

/**
 * How far the hair `hair` (the hair layer's sprite id, `null`: the body's own hair) rises above the crown of `body` [whole px,
 * ≥ 0]: the top of its preview (`<hair>_ansicht`) above the feet less the crown's height (the body's socket `last` in its first
 * frame); 0 without a preview (the side parting, the hair under a helmet). Read from the manifest once per hairstyle.
 */
export function hairHeadroom(manifest: AtlasManifest, body: AtlasSprite, hair: string | null): number {
  if (hair === null) return 0;
  let known = HEADROOMS.get(manifest);
  if (known === undefined) {
    known = new Map();
    HEADROOMS.set(manifest, known);
  }
  const cached = known.get(hair);
  if (cached !== undefined) return cached;
  const preview = manifest.sprites[hair + HAIR_PREVIEW_SUFFIX];
  const frame = preview?.frames[0];
  const crown = body.sockets['last']?.[0];
  const bodyFrame = body.frames[0];
  let rise = 0;
  const bounds = preview?.bounds;
  if (bounds !== undefined && frame !== undefined && crown !== undefined && crown !== null && bodyFrame !== undefined) {
    const above = frame.ay - bounds.y - (bodyFrame.ay - crown[1]);
    rise = above > 0 ? above : 0;
  }
  known.set(hair, rise);
  return rise;
}

/**
 * Three stars circling over a figure's head (M7-69): the creatures' stars (clips `stern` in front and `stern_fern` behind of
 * `PLAYER_STARS_SPRITE`, else of `kampf_zustand`) on the creatures' orbit (`starInto`, `STUN`), glowing like theirs, the
 * lowest star's lowest pixel `PLAYER_STUN.clearPx` above the headroom over the crown (`STARS_HEADROOM`). Where comes in registers
 * (`STARS_*`), so no floating-point value crosses a call (§30, ADR-0274); the sprite is looked up once per manifest.
 */
export class HeadStars {
  private manifest: AtlasManifest | null = null;
  private sprite: AtlasSprite | null = null;
  private star: AnimationClip | null = null;
  private farStar: AnimationClip | null = null;
  /** How far the orbit's centre lies above the headroom over the crown [px]: clearance, the star's reach below its anchor, the half height. */
  private up = 0;
  private readonly mark = new Float64Array(MARK_REGISTERS);
  private readonly clock = new Float64Array(1);

  private bind(manifest: AtlasManifest): void {
    this.manifest = manifest;
    const sprite = manifest.sprites[PLAYER_STARS_SPRITE] ?? manifest.sprites[STATUS_SPRITE];
    this.sprite = sprite ?? null;
    this.star = sprite?.clips[STATUS_CLIPS.star] ?? null;
    this.farStar = sprite?.clips[STATUS_CLIPS.farStar] ?? null;
    const first = sprite?.frames[this.star?.frames[0] ?? 0];
    const below = first === undefined ? 0 : first.h - 1 - first.ay;
    this.up = PLAYER_STUN.clearPx + below + PLAYER_ORBIT_RY;
  }

  /** Pushes the stars for the head in `r` (`STARS_*`); returns how many were drawn (0 without the sprite). */
  draw(scene: RenderScene, manifest: AtlasManifest, r: Float64Array): number {
    if (this.manifest !== manifest) this.bind(manifest);
    const sprite = this.sprite;
    const star = this.star;
    const farStar = this.farStar;
    if (sprite === null || star === null || farStar === null) return 0;
    const mr = this.mark;
    const time = r[STARS_TIME] as number;
    mr[MARK_TIME] = time;
    mr[MARK_SERIAL] = r[STARS_SERIAL] as number;
    mr[MARK_RX] = PLAYER_ORBIT_RX;
    mr[MARK_RY] = PLAYER_ORBIT_RY;
    const cx = r[STARS_X] as number;
    const cy = (r[STARS_CROWN] as number) - (r[STARS_HEADROOM] as number) - this.up;
    const feet = r[STARS_FEET] as number;
    const height = (r[STARS_GROUND] as number) + feet - cy;
    const frames = sprite.frames;
    for (let i = 0; i < STUN.stars; i++) {
      starInto(mr, i);
      const front = (mr[MARK_FRONT] as number) === 1;
      this.clock[0] = time + i * STAR_TWINKLE_STEP;
      const d = scene.sprite.reset();
      d.frame = (frames[clipFrameIn(front ? star : farStar, this.clock, 0)] ?? frames[0]) as SpriteFrameRef;
      d.x = cx + (mr[MARK_X] as number);
      d.y = cy + (mr[MARK_Y] as number);
      d.depth = front ? feet + MARK_DEPTH : feet - MARK_DEPTH;
      d.heightBase = height;
      d.emissiveBoost = STUN.glow;
      scene.sprites.push(d);
    }
    return STUN.stars;
  }
}

/** Bytes per RGBA pixel of the albedo and the offset of its coverage. */
const RGBA = 4;
const ALPHA = 3;
/** Rows below the highest opaque one whose span gives the head's centre (ears and crown, not the whole body). */
const HEAD_ROWS = 3;
/** Slots of `frameHeadInto`'s result: the highest opaque row and the centre column of the head [cell px]. */
export const HEAD_TOP = 0;
export const HEAD_CENTRE = 1;

/** The coverage of frame `f` of an atlas image (RGBA bytes, `f.w` × `f.h`), or null where it cannot be read (no canvas). */
function readFrame(atlas: AtlasData, f: SpriteFrameRef): Uint8Array | Uint8ClampedArray | null {
  const img = atlas.albedo;
  const width = atlas.manifest.width;
  if (img.kind === 'pixels') {
    const src = img.pixels;
    if (!(src instanceof Uint8Array)) return null;
    const out = new Uint8Array(f.w * f.h * RGBA);
    for (let y = 0; y < f.h; y++) out.set(src.subarray(((f.y + y) * width + f.x) * RGBA, ((f.y + y) * width + f.x + f.w) * RGBA), y * f.w * RGBA);
    return out;
  }
  const ctx =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(f.w, f.h).getContext('2d', { willReadFrequently: true })
      : typeof document === 'undefined'
        ? null
        : Object.assign(document.createElement('canvas'), { width: f.w, height: f.h }).getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  ctx.drawImage(img.image as CanvasImageSource, -f.x, -f.y);
  return ctx.getImageData(0, 0, f.w, f.h).data;
}

/** Offset of the emissive flag (G) of an albedo pixel. */
const EMISSIVE = 1;
/**
 * Slots of a frame scan (`frameScanInto`): its highest opaque row [cell px, −1 empty or unreadable], how many of its opaque
 * pixels glow (emissive: eyes, a glow sack, a firefly's light), how many lights it has (runs of glowing pixels in a row, at
 * most `SCAN_MAX_LIGHTS`), then per light `SCAN_LIGHT_FIELDS` values from `SCAN_LIGHT`: its first and last column, its row
 * and its core – the middle of the run (of an even run the left one of the two: a firefly's light is drawn root first, its
 * pale core `feuer.5*` before the greenish tip `gras.5*`, assets-src/sprites/kreaturen/gluehwuermchen.ts). From
 * `SCAN_COLUMNS` on, one slot per column of the frame (`scanSize(w)` slots in all): the column's highest opaque row [cell px,
 * −1 none] – the outline of the pose an arrow stuck in the body rides (projectiles.ts, `CreaturePoses`).
 */
export const SCAN_TOP = 0;
export const SCAN_GLOWING = 1;
export const SCAN_LIGHTS = 2;
export const SCAN_LIGHT = 3;
export const SCAN_LIGHT_FIELDS = 4;
export const LIGHT_X0 = 0;
export const LIGHT_X1 = 1;
export const LIGHT_Y = 2;
export const LIGHT_CORE = 3;
export const SCAN_MAX_LIGHTS = 8;
export const SCAN_SIZE = SCAN_LIGHT + SCAN_MAX_LIGHTS * SCAN_LIGHT_FIELDS;
export const SCAN_COLUMNS = SCAN_SIZE;

/** Slots of the scan of a frame `w` px wide, its columns' tops included. */
export function scanSize(w: number): number {
  return SCAN_COLUMNS + w;
}

/**
 * Scans frame `f` of the atlas into `out` (`SCAN_SIZE` slots, see `SCAN_*`; with `scanSize(f.w)` slots its columns' tops
 * too): what the creature view needs of a drawn frame – where its top is, whether something of it glows (a foe in the dark
 * shows only what glows, §12.2), where its lights are (the fireflies, M6-20) and the outline of the pose (the arrows stuck
 * in it ride it, projectiles.ts). Read once per frame and atlas from the albedo; false (and `out[SCAN_TOP]` −1, no glow, no
 * light, no column) where the frame cannot be read.
 */
export function frameScanInto(atlas: AtlasData, f: SpriteFrameRef, out: Int32Array): boolean {
  out[SCAN_TOP] = -1;
  out[SCAN_GLOWING] = 0;
  out[SCAN_LIGHTS] = 0;
  const w = f.w;
  const columns = out.length >= scanSize(w);
  if (columns) out.fill(-1, SCAN_COLUMNS, SCAN_COLUMNS + w);
  const px = readFrame(atlas, f);
  if (px === null) return false;
  let lights = 0;
  let glowing = 0;
  for (let y = 0; y < f.h; y++) {
    let run = -1;
    for (let x = 0; x <= w; x++) {
      const i = (y * w + x) * RGBA;
      const opaque = x < w && (px[i + ALPHA] as number) !== 0;
      if (opaque && out[SCAN_TOP] === -1) out[SCAN_TOP] = y;
      if (opaque && columns && out[SCAN_COLUMNS + x] === -1) out[SCAN_COLUMNS + x] = y;
      const glows = opaque && (px[i + EMISSIVE] as number) !== 0;
      if (glows) {
        glowing++;
        if (run < 0) run = x;
        continue;
      }
      if (run < 0) continue;
      if (lights < SCAN_MAX_LIGHTS) {
        const at = SCAN_LIGHT + lights * SCAN_LIGHT_FIELDS;
        const last = x - 1;
        out[at + LIGHT_X0] = run;
        out[at + LIGHT_X1] = last;
        out[at + LIGHT_Y] = y;
        out[at + LIGHT_CORE] = run + ((last - run) >> 1);
        lights++;
      }
      run = -1;
    }
  }
  out[SCAN_GLOWING] = glowing;
  out[SCAN_LIGHTS] = lights;
  return true;
}

/**
 * The head of frame `f`: its highest opaque row into `out[HEAD_TOP]` and the centre of the opaque span of that row and the
 * `HEAD_ROWS − 1` below it into `out[HEAD_CENTRE]` (cell px). Read once per creature and atlas from the albedo's coverage;
 * false (and `out` untouched) where the frame cannot be read or is empty.
 */
export function frameHeadInto(atlas: AtlasData, f: SpriteFrameRef, out: Int32Array): boolean {
  const px = readFrame(atlas, f);
  if (px === null) return false;
  let top = -1;
  let left = f.w;
  let right = -1;
  for (let y = 0; y < f.h; y++) {
    if (top >= 0 && y >= top + HEAD_ROWS) break;
    for (let x = 0; x < f.w; x++) {
      if ((px[(y * f.w + x) * RGBA + ALPHA] as number) === 0) continue;
      if (top < 0) top = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (top < 0) return false;
  out[HEAD_TOP] = top;
  out[HEAD_CENTRE] = Math.round((left + right) / 2);
  return true;
}
