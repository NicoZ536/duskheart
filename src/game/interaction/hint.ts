/**
 * The interaction hint (MASTERPROMPT §26 "Mitte unten Interaktionshinweis („[E] Aufheben: Feuerstein
 * ×3")", "Fehlermeldungen sagen, was fehlt und wie man es löst"; M3-10): what the focus of the
 * interaction system means in words, as i18n keys and content names – the HUD (M3-27) and the world
 * marker over the target put them together in the player's language.
 *
 * Keys (src/i18n/de.json, en.json): `ui.interaction.hint` "{verb}: {subject}", `ui.interaction.hintCount`
 * "{verb}: {subject} ×{count}", `ui.interaction.hintBlocked` "{hint} – {reason}", verbs
 * `ui.interaction.action.<action>`, reasons `ui.interaction.block.<reason>` (with `{tool}` from
 * `ui.interaction.tool.<kind>`), `ui.interaction.tooHard`, subjects of tile work
 * `ui.interaction.dig.<result>`, the stump `ui.interaction.stump`.
 *
 * Use targets (src/game/interaction/uses.ts) take verb, name and reason from their content texts
 * (src/content/uses.ts; lights by their light kind's name, the stump by `ui.interaction.stump`, full bags
 * by `ui.interaction.block.bagsFull`).
 */
import { CONTENT } from '../../content/index';
import { LIGHT_KINDS } from '../../content/lights';
import type { LocalizedText } from '../../content/schema/common';
import { USE_BLOCKS, USE_SUBJECTS, USE_VERBS, type UseAction, type UseBlock, type UseSubjectId } from '../../content/uses';
import type { InteractionFocus } from './system';
import { STUMP_SUBJECT } from './uses';

/** A hint ready for translation. */
export interface InteractionHint {
  /** Input action whose key the hint shows (§26 "E Interagieren"). */
  readonly input: 'interact';
  /** i18n key of the verb (`ui.interaction.action.<action>`), or the content verb of a use target. */
  readonly verb: string | LocalizedText;
  /** Name of the target: content text, or an i18n key for tile work and stumps. */
  readonly subject: { readonly text: LocalizedText } | { readonly key: string };
  /** Items of a drop (shown as "×n" above 1). */
  readonly count: number;
  /** i18n key of the reason it cannot be done now, the content text of a use target's reason, or null. */
  readonly reason: string | LocalizedText | null;
  /** i18n key of the tool the reason names (`{tool}`), or null. */
  readonly tool: string | null;
  /** The tool is too weak ("Zu hart", `ui.interaction.tooHard`). */
  readonly tooHard: boolean;
  /** The action runs; its progress for the ring [0–1]. */
  readonly working: boolean;
  readonly progress: number;
}

/** The hint of `focus`, or null when nothing is in focus. */
export function interactionHint(focus: Readonly<InteractionFocus>): InteractionHint | null {
  if (focus.kind === 'none') return null;
  if (focus.kind === 'use') {
    const block = focus.block;
    return {
      input: 'interact',
      verb: USE_VERBS[focus.action as UseAction],
      subject: useSubject(focus.subject),
      count: 1,
      reason: block === null ? null : block === 'bagsFull' ? 'ui.interaction.block.bagsFull' : USE_BLOCKS[block as UseBlock],
      tool: null,
      tooHard: false,
      working: false,
      progress: 0,
    };
  }
  return {
    input: 'interact',
    verb: `ui.interaction.action.${focus.action}`,
    subject: subjectOf(focus),
    count: focus.kind === 'drop' ? focus.count : 1,
    reason: focus.block === null ? null : `ui.interaction.block.${focus.block}`,
    tool: focus.block === 'needsTool' && focus.needs !== null ? `ui.interaction.tool.${focus.needs}` : null,
    tooHard: focus.tooWeak,
    working: focus.working,
    progress: focus.progress,
  };
}

/** Name of a use target: the stump, a thing of `USE_SUBJECTS`, or a light kind. */
function useSubject(id: string): InteractionHint['subject'] {
  if (id === STUMP_SUBJECT) return { key: 'ui.interaction.stump' };
  if (Object.hasOwn(USE_SUBJECTS, id)) return { text: USE_SUBJECTS[id as UseSubjectId] };
  const light = LIGHT_KINDS.find((k) => k.id === id);
  if (light === undefined) throw new Error(`interactionHint: unknown use subject "${id}"`);
  return { text: light.name };
}

function subjectOf(focus: Readonly<InteractionFocus>): InteractionHint['subject'] {
  if (focus.kind === 'drop') return { text: CONTENT.collection('items').get(focus.subject).name };
  if (focus.kind === 'tile') return focus.dig === null || focus.dig === 'stollen' ? { text: CONTENT.collection('terrain').get(focus.subject).name } : { key: `ui.interaction.dig.${focus.dig}` };
  if (focus.action === 'roden') return { key: 'ui.interaction.stump' };
  return { text: CONTENT.collection('worldObjects').get(focus.subject).name };
}

/** Translates `key` with `params` (the i18n `t` of the presentation). */
export type HintTranslate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** The hint as one line in `lang` ("Aufheben: Feuerstein ×3", "Fällen: Eiche – braucht eine Axt"). */
export function hintText(hint: InteractionHint, lang: 'de' | 'en', t: HintTranslate): string {
  const subject = 'text' in hint.subject ? hint.subject.text[lang] : t(hint.subject.key);
  const verb = typeof hint.verb === 'string' ? t(hint.verb) : hint.verb[lang];
  const line = hint.count > 1 ? t('ui.interaction.hintCount', { verb, subject, count: hint.count }) : t('ui.interaction.hint', { verb, subject });
  if (hint.reason !== null) {
    const reason = typeof hint.reason === 'string' ? t(hint.reason, hint.tool === null ? undefined : { tool: t(hint.tool) }) : hint.reason[lang];
    return t('ui.interaction.hintBlocked', { hint: line, reason });
  }
  if (hint.tooHard) return t('ui.interaction.hintBlocked', { hint: line, reason: t('ui.interaction.tooHard') });
  return line;
}
