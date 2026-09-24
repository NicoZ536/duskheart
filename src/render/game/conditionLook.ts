/**
 * Visible effects of the player's conditions (MASTERPROMPT §11.3 "Jeder Zustand: … sichtbare Wirkung",
 * §11.1 "Müde (… Lidschlag-Effekt)", §11.2 "Frierend … Zittern", "Unterkühlt … Frostrand"; M3-20): which
 * effect hooks the active conditions switch on (`ConditionLook`, from each condition's `sichtbar` in
 * src/content/conditions.ts) and how they move over presentation time. Every function here is a pure
 * function of time, so a frozen frame (screenshots) always shows the same picture.
 *
 * - Shivering (`zittern`, stronger with `frostrand`): the figure jitters one pixel sideways, turns pale
 *   blue and shows shiver marks beside the body (`figureFx.ts`).
 * - Limping (`hinken`, Knochenbruch): the step on the bad leg is slow and sinks the body a pixel, the
 *   good leg hurries through its step.
 * - Swaying (`schwanken`, Beschwipst): a slow pixel sway.
 * - Burning (`flammen`), soaked (`tropfen`), bleeding (`blutstropfen`), sweat (`schweiss`), cold breath
 *   (`zittern`/`frostrand`): particles at the figure (`figureFx.ts`).
 * - Blinking (`lidschlag`, Müde/Erschöpft): the eyelids close over the picture for a moment, more often
 *   and heavier when exhausted (post pass, `RenderScene.post.lid`).
 * - Frost at the edge (`frostrand`, Unterkühlt/Erfrierend): icy rim of the picture (`RenderScene.post.frost`).
 * - Complexion (`giftschimmer`, `uebelkeit`, `fieberglanz`, `blaesse`): the figure takes on a sickly green,
 *   a feverish flush or a grey pallor (`COMPLEXION`); poison and fever pulse. The cold pallor of shivering
 *   wins over them.
 *
 * `LOOK_HOOKS` says for every visual hook of the condition content which effect shows it – or, for the
 * hooks without a picture of their own, what carries them (HUD symbol, sound, the mechanics the figure
 * already shows); tests/unit/render/zustand-darstellung.test.ts keeps it complete.
 */
import { CONDITIONS, type ConditionVisual } from '../../content/conditions';

/** How every visual hook of the condition content is shown: the look's effect, or what carries a hook without a picture of its own. */
export const LOOK_HOOKS: Readonly<Record<ConditionVisual, { readonly effect: string } | { readonly carriedBy: string }>> = {
  zittern: { effect: 'Zittern (1 px), Kältebleiche, Zitterstriche, Atemwölkchen' },
  frostrand: { effect: 'starkes Zittern, Kältebleiche, Atemwölkchen, Frostrand des Bildes' },
  schweiss: { effect: 'Schweißtropfen von der Stirn' },
  hinken: { effect: 'Hinken: langsamer Schritt auf dem kranken Bein, 1 px Einsinken' },
  flammen: { effect: 'emissive Flammenzungen am Körper' },
  tropfen: { effect: 'fallende Tropfen mit Spritzern an den Füßen' },
  blutstropfen: { effect: 'Blutstropfen vom Rumpf' },
  lidschlag: { effect: 'Lidschlag über dem Bild, erschöpft häufiger und mit hängenden Lidern' },
  schwanken: { effect: 'langsames Schwanken zur Seite' },
  giftschimmer: { effect: 'pulsierender giftgrüner Teint' },
  uebelkeit: { effect: 'fahlgrüner Teint' },
  fieberglanz: { effect: 'pulsierende Fieberröte' },
  blaesse: { effect: 'graue Blässe' },
  flimmern: { carriedBy: 'Symbol und Keuchen; die Hitze selbst zeigt das Thermometer, Hitzeflimmern ist ein Bildeffekt des Wetters (M7)' },
  zeitlupe: { carriedBy: 'die Figur geht sichtbar langsamer (ihr Laufzyklus folgt dem Tempo der Simulation)' },
  sterne: { carriedBy: 'Symbol und Klang; Betäubung entsteht erst durch Kampftreffer (M5)' },
  blendung: { carriedBy: 'Symbol und Klang; Blendung entsteht erst durch Blitze und Kampf (M5)' },
  wohlig: { carriedBy: 'Symbol und Klang (positiver Zustand ohne Körperbild)' },
  frische: { carriedBy: 'Symbol und Klang (positiver Zustand ohne Körperbild)' },
  waermeglanz: { carriedBy: 'Symbol; die Wärme zeigt das Licht des Feuers, an dem der Zustand entsteht' },
  lichtaura: { carriedBy: 'Symbol; das Licht selbst zeigt die Lichtinsel, in der der Zustand entsteht' },
  morgenglanz: { carriedBy: 'Symbol und Klang; der Morgen zeigt sich im Tageslicht' },
  nachtsicht: { carriedBy: 'Symbol und Klang (Trank ab M8)' },
  magenknurren: { carriedBy: 'Symbol, Sättigungsleiste und Magenknurren' },
  keuchen: { carriedBy: 'Symbol, Durstleiste und Keuchen' },
  atemblasen: { carriedBy: 'Symbol, Ertrinken-Klang und die Schwimmfigur im tiefen Wasser' },
};

/** Complexion tints (0xRRGGBB palette colours) by hook: strength 0–1 and pulse period [s] (0 = steady). */
export const COMPLEXION = {
  giftschimmer: { color: 0x78ad45, strength: 0.26, pulseSeconds: 1.2 }, // gras.4
  uebelkeit: { color: 0x4b8c3c, strength: 0.2, pulseSeconds: 0 }, // gras.3
  fieberglanz: { color: 0xd4471e, strength: 0.2, pulseSeconds: 1.6 }, // feuer.2
  blaesse: { color: 0xa8c9e2, strength: 0.22, pulseSeconds: 0 }, // eis.2
} as const satisfies Partial<Record<ConditionVisual, { color: number; strength: number; pulseSeconds: number }>>;
/** A complexion hook. */
export type ComplexionHook = keyof typeof COMPLEXION;
/** Complexions from strongest to mildest claim (the first active one shows). */
const COMPLEXION_ORDER: readonly ComplexionHook[] = ['giftschimmer', 'fieberglanz', 'uebelkeit', 'blaesse'];
/** Share of the strength a pulsing complexion keeps at its faintest. */
const PULSE_FLOOR = 0.45;

/** What the active conditions show at the figure and on the picture. */
export interface ConditionLook {
  /** 0 none · 1 shivering (Frierend) · 2 hard shivering (Unterkühlt, Erfrierend). */
  shiver: number;
  limp: boolean;
  sway: boolean;
  flames: boolean;
  drips: boolean;
  blood: boolean;
  sweat: boolean;
  /** Cold breath puffs (shivering). */
  breath: boolean;
  /** 0 none · 1 tired (Müde) · 2 exhausted (Erschöpft). */
  lid: number;
  /** Icy rim of the picture, 0–1. */
  frost: number;
  /** Complexion of the figure (poison, nausea, fever, pallor), or null. */
  complexion: ComplexionHook | null;
}

/** A look without any effect. */
export function createConditionLook(): ConditionLook {
  return { shiver: 0, limp: false, sway: false, flames: false, drips: false, blood: false, sweat: false, breath: false, lid: 0, frost: 0, complexion: null };
}

/**
 * Conditions that show their hook stronger than the milder stage with the same hook (Erfrierend after
 * Unterkühlt, Erschöpft after Müde) – level 2.
 */
const STRONGER: ReadonlySet<string> = new Set(['erfrierend', 'erschoepft']);
/** Frost at the edge by level of the `frostrand` hook. */
const FROST_BY_LEVEL = [0, 0.55, 1] as const;

let visuals: ReadonlyMap<string, ConditionVisual> | null = null;

/** The visual hook of each condition (content, built once). */
function visualOf(id: string): ConditionVisual | undefined {
  visuals ??= new Map(CONDITIONS.map((c) => [c.id, c.sichtbar]));
  return visuals.get(id);
}

/** Fills `out` from the ids of the active conditions (first `count` entries of `active`). Returns `out`. */
export function sampleConditionLook(active: readonly { readonly id: string }[], count: number, out: ConditionLook): ConditionLook {
  out.shiver = 0;
  out.limp = false;
  out.sway = false;
  out.flames = false;
  out.drips = false;
  out.blood = false;
  out.sweat = false;
  out.breath = false;
  out.lid = 0;
  out.frost = 0;
  out.complexion = null;
  let claim = COMPLEXION_ORDER.length;
  for (let i = 0; i < count && i < active.length; i++) {
    const c = active[i];
    if (c === undefined) continue;
    const level = STRONGER.has(c.id) ? 2 : 1;
    const visual = visualOf(c.id);
    switch (visual) {
      case 'zittern':
        out.shiver = Math.max(out.shiver, 1);
        out.breath = true;
        break;
      case 'frostrand':
        out.shiver = 2;
        out.breath = true;
        out.frost = Math.max(out.frost, FROST_BY_LEVEL[level] ?? 1);
        break;
      case 'hinken':
        out.limp = true;
        break;
      case 'schwanken':
        out.sway = true;
        break;
      case 'flammen':
        out.flames = true;
        break;
      case 'tropfen':
        out.drips = true;
        break;
      case 'blutstropfen':
        out.blood = true;
        break;
      case 'schweiss':
        out.sweat = true;
        break;
      case 'lidschlag':
        out.lid = Math.max(out.lid, level);
        break;
      case 'giftschimmer':
      case 'uebelkeit':
      case 'fieberglanz':
      case 'blaesse': {
        const rank = COMPLEXION_ORDER.indexOf(visual);
        if (rank < claim) {
          claim = rank;
          out.complexion = visual;
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Overlay of the whole figure at `time`: the cold pallor while shivering, else the complexion, else none. */
export function figureTint(look: ConditionLook, time: number, out: { color: number; strength: number }): { color: number; strength: number } {
  const cold = coldTintStrength(look.shiver);
  if (cold > 0) {
    out.color = COLD_TINT.color;
    out.strength = cold;
    return out;
  }
  if (look.complexion === null) {
    out.color = 0;
    out.strength = 0;
    return out;
  }
  const c: { color: number; strength: number; pulseSeconds: number } = COMPLEXION[look.complexion];
  out.color = c.color;
  if (c.pulseSeconds > 0) {
    const phase = (Math.max(0, time) % c.pulseSeconds) / c.pulseSeconds;
    const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
    out.strength = c.strength * (PULSE_FLOOR + (1 - PULSE_FLOOR) * wave);
  } else out.strength = c.strength;
  return out;
}

/** Shivering: jitter rate [steps/s] by level and the offset of each step [px]. */
const SHIVER_HZ = [0, 12, 18] as const;
const SHIVER_STEPS = [0, 1, 0, -1, 1, 0, -1, 0] as const;

/** Sideways jitter of a shivering figure at `time` [px, whole]. */
export function shiverOffset(level: number, time: number): number {
  const hz = SHIVER_HZ[level] ?? 0;
  if (hz === 0) return 0;
  const step = Math.floor(Math.max(0, time) * hz);
  return SHIVER_STEPS[step % SHIVER_STEPS.length] ?? 0;
}

/** Cold pallor of a shivering figure: overlay colour (`eis.1`) and strength by shiver level. */
export const COLD_TINT = { color: 0x7ea3c9, strength: [0, 0.24, 0.38] } as const;

/** Strength of the cold pallor at shiver level `level`. */
export function coldTintStrength(level: number): number {
  return COLD_TINT.strength[level] ?? 0;
}

/** Swaying (Beschwipst): one sway to each side per period [s], amplitude [px]. */
const SWAY = { periodSeconds: 1.8, amplitudePx: 1.4 } as const;

/** Sideways sway of a tipsy figure at `time` [px, whole]. */
export function swayOffset(time: number): number {
  return Math.round(Math.sin((2 * Math.PI * time) / SWAY.periodSeconds) * SWAY.amplitudePx);
}

/**
 * Limp (Knochenbruch): the first half of a walk cycle (the bad leg carries) takes this share of the
 * cycle's time; the figure sinks `dipPx` while it does.
 */
export const LIMP = { badLegShare: 0.65, dipPx: 1 } as const;

/** Phase 0–1 within a walk cycle of `cycle` s at `time`. */
function cyclePhase(time: number, cycle: number): number {
  const u = Math.max(0, time) / cycle;
  return u - Math.floor(u);
}

/** Clip time of a limping walk: the bad leg's half of the cycle is stretched, the good leg's squeezed. */
export function limpTime(time: number, cycle: number): number {
  if (!(cycle > 0)) return time;
  const t = Math.max(0, time);
  const whole = Math.floor(t / cycle) * cycle;
  const phase = cyclePhase(t, cycle);
  const s = LIMP.badLegShare;
  const warped = phase < s ? (phase / s) * 0.5 : 0.5 + ((phase - s) / (1 - s)) * 0.5;
  return whole + warped * cycle;
}

/** How far the limping figure sinks at `time` [px]: on the bad leg. */
export function limpDip(time: number, cycle: number): number {
  return cycle > 0 && cyclePhase(time, cycle) < LIMP.badLegShare ? LIMP.dipPx : 0;
}

/**
 * Blinking (§11.1 "Lidschlag-Effekt"): a blink every `periodSeconds` by level (tired, exhausted), closing
 * over `closeSeconds`, shut for `holdSeconds`, opening over `openSeconds`; an exhausted player's lids also
 * hang (`droop`, share of the picture covered all the time).
 */
export const BLINK = {
  periodSeconds: [0, 5.5, 3.2],
  closeSeconds: 0.12,
  holdSeconds: [0, 0.06, 0.18],
  openSeconds: 0.16,
  droop: [0, 0, 0.1],
} as const;

/** How far the eyelids cover the picture at `time`, 0 (open) … 1 (shut). */
export function lidClosure(level: number, time: number): number {
  const period = BLINK.periodSeconds[level] ?? 0;
  if (!(period > 0)) return 0;
  const hold = BLINK.holdSeconds[level] ?? 0;
  const droop = BLINK.droop[level] ?? 0;
  const blink = BLINK.closeSeconds + hold + BLINK.openSeconds;
  const t = Math.max(0, time) % period;
  const start = period - blink;
  let shut = 0;
  if (t >= start) {
    const u = t - start;
    if (u < BLINK.closeSeconds) shut = u / BLINK.closeSeconds;
    else if (u < BLINK.closeSeconds + hold) shut = 1;
    else shut = 1 - (u - BLINK.closeSeconds - hold) / BLINK.openSeconds;
  }
  return Math.max(droop, Math.min(1, shut));
}
