/**
 * View model of the death screen (MASTERPROMPT §11.6, §26 "Todesbildschirm"; M3-26). It listens to the
 * simulation's `playerDied` / `playerRespawned` events through the session (read only) and sends
 * `death.respawn` when the player chooses where to wake – the screen never touches the simulation.
 *
 * The texts come from the event's facts: the cause (a damage cause of the vitals, a condition, a
 * hallucination), the grave (how many stacks wait there), the penalty of the difficulty (§29) and the
 * places the player can respawn at. "Erschüttert" is described from its content data (duration, max.
 * health), so the screen always tells what the condition really does.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { BALANCE } from '../../../content/balance';
import type { DeathPenalty } from '../../../content/balance/death';
import { CONTENT } from '../../../content/index';
import type { RespawnSpot } from '../../../game/death/events';
import type { GameSession } from '../../../game/session';
import type { SimEventMap } from '../../../game/sim';
import type { I18n, Lang } from '../../../i18n';

/** What the death screen shows. */
export interface DeathView {
  /** Damage cause, condition id, `trugbild`, `debug` or `unbekannt`. */
  readonly cause: string;
  /** Grave of this death, or `null`. */
  readonly grave: number | null;
  /** Stacks in the grave. */
  readonly graveItems: number;
  readonly penalty: DeathPenalty;
  /** Where the player can wake (empty: the world is lost). */
  readonly spots: readonly RespawnSpot[];
}

/** The part of the session the death screen uses: events in, commands out. */
export type DeathScreenSession = Pick<GameSession, 'onEvent' | 'command'>;

/** The death screen's state for the UI. */
export interface DeathScreenModel {
  /** What to show, or `null` while the player lives. */
  readonly view: ReadonlySignal<DeathView | null>;
  /** Wake at `at` (sends `death.respawn`; the screen closes when the simulation reports the respawn). */
  respawn(at: RespawnSpot): void;
  dispose(): void;
}

/** The view of a `playerDied` event. */
export function deathViewOf(e: SimEventMap['playerDied']): DeathView {
  return { cause: e.cause, grave: e.grave, graveItems: e.graveItems, penalty: e.penalty, spots: e.spots };
}

/** Creates the model; it shows the next death the session reports. */
export function createDeathScreenModel(session: DeathScreenSession): DeathScreenModel {
  const view = signal<DeathView | null>(null);
  const stops = [
    session.onEvent('playerDied', (e) => {
      view.value = deathViewOf(e);
    }),
    session.onEvent('playerRespawned', () => {
      view.value = null;
    }),
  ];
  return {
    view,
    respawn: (at) => {
      session.command({ type: 'death.respawn', at });
    },
    dispose: () => {
      for (const stop of stops) stop();
    },
  };
}

/** Causes with a text of their own (`ui.death.cause.<cause>`); conditions use their name. */
const NAMED_CAUSES = ['hunger', 'durst', 'ertrinken', 'kaelte', 'hitze', 'sturz', 'trugbild', 'debug', 'unbekannt'] as const;

/** The cause as the death screen says it. */
export function causeText(i18n: I18n, lang: Lang, cause: string): string {
  if ((NAMED_CAUSES as readonly string[]).includes(cause)) return i18n.t(`ui.death.cause.${cause}`);
  const condition = CONTENT.collection('conditions').find(cause);
  if (condition !== undefined) return i18n.t('ui.death.cause.zustand', { zustand: condition.name[lang] });
  return i18n.t('ui.death.cause.unbekannt');
}

/** Percent of a fraction, rounded to whole points. */
const PERCENT = 100;
const SECONDS_PER_MINUTE = 60;

/** The lines that tell what the death cost (grave, equipment, Erschüttert, skills). */
export function penaltyLines(i18n: I18n, view: DeathView): string[] {
  const lines: string[] = [];
  const p = view.penalty;
  if (p.permadeath) return [i18n.t('ui.death.permadeath')];
  if (p.grave === 'nichts') lines.push(i18n.t('ui.death.keepBags'));
  else if (view.grave === null) lines.push(i18n.t('ui.death.emptyBags'));
  else lines.push(`${i18n.t('ui.death.grave', { count: view.graveItems })} ${i18n.t('ui.death.graveMarker')}`);
  if (p.grave === 'inventar') lines.push(i18n.t('ui.death.equipmentStays'));
  const shaken = CONTENT.collection('conditions').get(BALANCE.death.respawnCondition);
  const minutes = shaken.dauer.art === 'zeit' ? Math.round(shaken.dauer.sekunden / SECONDS_PER_MINUTE) : 0;
  const lost = Math.round((1 - (shaken.wirkung.maxLeben ?? 1)) * PERCENT);
  lines.push(i18n.t('ui.death.shaken', { minuten: minutes, prozent: lost }));
  if (p.skillLoss > 0) lines.push(i18n.t('ui.death.skillLoss', { prozent: Math.round(p.skillLoss * PERCENT) }));
  return lines;
}
