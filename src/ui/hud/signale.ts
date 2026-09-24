/**
 * HUD signals of the UI bridge (M3-27; src/ui/bridge.ts `state.hud`): fear with its stage (§12.3, the
 * eye from 20), the active conditions with their timers (§11.3), the interaction hint (§26 "[E]
 * Aufheben: Feuerstein ×3") and the carried light with its burn time (§12.2, the off-hand timer).
 * `publish` runs inside the bridge's frame batch with the session's `HudSample`; a signal only changes
 * when what the HUD shows changes – the condition list when an icon, a stack or a shown second changes
 * (once per second while a timer runs), the hint when its words change (not while only the progress of
 * an action advances), the light when its slot, state or shown second changes. Nothing is allocated per
 * frame otherwise.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import type { FearStage } from '../../content/balance/fear';
import { interactionHint, type InteractionHint } from '../../game/interaction/hint';
import { copyFocus, createInteractionFocus, type InteractionFocus } from '../../game/interaction/system';
import type { SlotRef } from '../../game/items/slots';
import type { HudSample } from '../../game/session';

/** One active condition as the HUD shows it. */
export interface ConditionView {
  readonly id: string;
  readonly stacks: number;
  /** Whole seconds left (rounded up); −1 for a condition without an end of its own. */
  readonly seconds: number;
}

/** The carried light as its slot shows it (§12.2). */
export interface LightView {
  /** Bag slot of the light: the off-hand, or a hotbar slot when it is carried on the belt. */
  readonly slot: SlotRef;
  readonly lit: boolean;
  /** Carried on the belt (less light). */
  readonly belt: boolean;
  /** Whole seconds of burn time left at the current speed (rounded up). */
  readonly seconds: number;
  /** Remaining share of a fresh torch (0–1, in whole percent). */
  readonly share: number;
  /** It rains on the torch (it burns faster). */
  readonly rain: boolean;
}

/** Condition without an end of its own (`ConditionView.seconds`). */
export const NO_TIMER = -1;

/** What the HUD reads besides the survival values; updated once per rendered frame. */
export interface HudStateView {
  /** Fear 0–100 in whole points. */
  readonly fear: ReadonlySignal<number>;
  readonly fearStage: ReadonlySignal<FearStage>;
  /** Active conditions in content order (the order of docs/SPIEL.md §6). */
  readonly conditions: ReadonlySignal<readonly ConditionView[]>;
  /** The interaction hint of the target in focus (i18n keys and content names), or `null`. */
  readonly interaction: ReadonlySignal<InteractionHint | null>;
  /** The carried light, or `null` while none is carried. */
  readonly light: ReadonlySignal<LightView | null>;
}

/** The writable side, owned by the bridge. */
export interface HudSignals {
  readonly view: HudStateView;
  /** Publishes `sample`; with `present` false (no player) the conditions, the hint and the light clear, fear keeps its value. */
  publish(sample: HudSample, present: boolean): void;
}

const NO_CONDITIONS: readonly ConditionView[] = Object.freeze([]);

/** Steps of the light's share (whole percent). */
const ANTEIL_STUFEN = 100;

/** Whole seconds shown for `remaining` [s] (−1 stays −1). */
export function shownSeconds(remaining: number): number {
  return remaining < 0 ? NO_TIMER : Math.ceil(remaining);
}

/** Whether the fields the hint's words depend on differ between two foci. */
export function hintChanged(a: Readonly<InteractionFocus>, b: Readonly<InteractionFocus>): boolean {
  return (
    a.kind !== b.kind ||
    a.subject !== b.subject ||
    a.count !== b.count ||
    a.action !== b.action ||
    a.block !== b.block ||
    a.needs !== b.needs ||
    a.tooWeak !== b.tooWeak ||
    a.dig !== b.dig ||
    a.working !== b.working
  );
}

export function createHudSignals(): HudSignals {
  const fear = signal(0);
  const fearStage = signal<FearStage>('ruhig');
  const conditions = signal<readonly ConditionView[]>(NO_CONDITIONS);
  const interaction = signal<InteractionHint | null>(null);
  const light = signal<LightView | null>(null);
  // The focus the published hint describes (compared field by field every frame).
  const described = createInteractionFocus();

  const conditionsChanged = (sample: HudSample): boolean => {
    const shown = conditions.peek();
    if (shown.length !== sample.conditionCount) return true;
    for (let i = 0; i < shown.length; i++) {
      const a = shown[i];
      const b = sample.conditions[i];
      if (a === undefined || b === undefined) return true;
      if (a.id !== b.id || a.stacks !== b.stacks || a.seconds !== shownSeconds(b.remainingSeconds)) return true;
    }
    return false;
  };

  const publishLight = (sample: HudSample): void => {
    const l = sample.light;
    const shown = light.peek();
    if (l.slot === null) {
      if (shown !== null) light.value = null;
      return;
    }
    const seconds = Math.ceil(l.restSeconds);
    const share = Math.floor(l.share * ANTEIL_STUFEN) / ANTEIL_STUFEN;
    const rain = l.rate > 1;
    if (
      shown !== null &&
      shown.slot.bereich === l.slot.bereich &&
      shown.slot.index === l.slot.index &&
      shown.lit === l.lit &&
      shown.belt === l.belt &&
      shown.seconds === seconds &&
      shown.share === share &&
      shown.rain === rain
    ) {
      return;
    }
    light.value = { slot: { bereich: l.slot.bereich, index: l.slot.index }, lit: l.lit, belt: l.belt, seconds, share, rain };
  };

  return {
    view: { fear, fearStage, conditions, interaction, light },
    publish(sample, present) {
      if (!present) {
        if (conditions.peek().length > 0) conditions.value = NO_CONDITIONS;
        if (interaction.peek() !== null) interaction.value = null;
        if (light.peek() !== null) light.value = null;
        described.kind = 'none';
        return;
      }
      fear.value = Math.round(sample.fear);
      fearStage.value = sample.fearStage;
      if (conditionsChanged(sample)) {
        const list: ConditionView[] = [];
        for (let i = 0; i < sample.conditionCount; i++) {
          const c = sample.conditions[i];
          if (c !== undefined) list.push({ id: c.id, stacks: c.stacks, seconds: shownSeconds(c.remainingSeconds) });
        }
        conditions.value = list.length === 0 ? NO_CONDITIONS : Object.freeze(list);
      }
      if (hintChanged(sample.focus, described)) {
        copyFocus(sample.focus, described);
        interaction.value = interactionHint(described);
      }
      publishLight(sample);
    },
  };
}
