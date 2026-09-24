/**
 * Texts of the use interactions (MASTERPROMPT §11.4 "Interagieren (E)", §26 "Mitte unten
 * Interaktionshinweis", "Fehlermeldungen sagen, was fehlt und wie man es löst"; docs/SPIEL.md §3): E on
 * something that is used rather than harvested – drinking at a river, sitting on a stump, feeding and
 * lighting a camp fire, taking a torch back, recovering a grave, lying down in a bed.
 *
 * The interaction system (src/game/interaction/uses.ts) offers these targets beside drops, objects and
 * tiles; its hint (src/game/interaction/hint.ts) takes verb, name and reason from here. The texts live with
 * the content like the names of world objects (ADR-0005), because the things a player can use come with
 * content: every later kind (chairs, beds, chests, stations, doors) brings its verb along (ADR-0028).
 *
 * - `USE_VERBS`: the verb of each use action ("Trinken: Fluss").
 * - `USE_SUBJECTS`: names of the things that have no content record of their own (water, a grave, a sleeping
 *   place); lights are named by their light kind (src/content/lights.ts), stumps by the stump text.
 * - `USE_BLOCKS`: why it cannot be done now, and how to solve it.
 */
import { z } from 'zod';
import { deepFreeze } from './freeze';
import { localizedTextSchema, type LocalizedText } from './schema/common';

/** What E does on a used thing. */
export const USE_ACTIONS = ['trinken', 'sitzen', 'aufstehen', 'nachlegen', 'entzuenden', 'nehmen', 'bergen', 'schlafen'] as const;
/** One use action. */
export type UseAction = (typeof USE_ACTIONS)[number];

/** Things without a content record of their own. */
export const USE_SUBJECTS_IDS = ['suesswasser', 'quellwasser', 'meerwasser', 'eis', 'grab', 'bett', 'grasbett', 'schlafsack'] as const;
/** One of them. */
export type UseSubjectId = (typeof USE_SUBJECTS_IDS)[number];

/** Why a use target cannot be used now. */
export const USE_BLOCKS_IDS = ['keinBrennstoff', 'feuerVoll', 'salzwasser', 'gefroren', 'nochNichtMuede'] as const;
/** One of them. */
export type UseBlock = (typeof USE_BLOCKS_IDS)[number];

const textsOf = <K extends string>(ids: readonly K[]) => z.object(Object.fromEntries(ids.map((id) => [id, localizedTextSchema])) as Record<K, typeof localizedTextSchema>).strict();

function define<K extends string>(what: string, ids: readonly K[], raw: Record<K, LocalizedText>): Readonly<Record<K, LocalizedText>> {
  const r = textsOf(ids).safeParse(raw);
  if (!r.success) throw new TypeError(`${what} invalid: ${r.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ')}`);
  const texts = r.data as Record<K, LocalizedText>;
  deepFreeze(texts);
  return texts;
}

/** Verb of each use action. */
export const USE_VERBS: Readonly<Record<UseAction, LocalizedText>> = define('USE_VERBS', USE_ACTIONS, {
  trinken: { de: 'Trinken', en: 'Drink' },
  sitzen: { de: 'Hinsetzen', en: 'Sit down' },
  aufstehen: { de: 'Aufstehen', en: 'Stand up' },
  nachlegen: { de: 'Nachlegen', en: 'Add fuel' },
  entzuenden: { de: 'Entzünden', en: 'Light' },
  nehmen: { de: 'Nehmen', en: 'Take' },
  bergen: { de: 'Bergen', en: 'Recover' },
  schlafen: { de: 'Schlafen', en: 'Sleep' },
});

/** Names of used things without a content record. */
export const USE_SUBJECTS: Readonly<Record<UseSubjectId, LocalizedText>> = define('USE_SUBJECTS', USE_SUBJECTS_IDS, {
  suesswasser: { de: 'Süßwasser', en: 'Fresh water' },
  quellwasser: { de: 'Quellwasser', en: 'Spring water' },
  meerwasser: { de: 'Meerwasser', en: 'Seawater' },
  eis: { de: 'Eis', en: 'Ice' },
  grab: { de: 'Dein Grab', en: 'Your grave' },
  bett: { de: 'Bett', en: 'Bed' },
  grasbett: { de: 'Grasbett', en: 'Grass bed' },
  schlafsack: { de: 'Schlafsack', en: 'Sleeping bag' },
});

/** Why a use target cannot be used now – what is missing and how to solve it (§26). */
export const USE_BLOCKS: Readonly<Record<UseBlock, LocalizedText>> = define('USE_BLOCKS', USE_BLOCKS_IDS, {
  keinBrennstoff: { de: 'kein Brennstoff in den Taschen – sammle Holz oder Zweige', en: 'no fuel in your bags – gather wood or twigs' },
  feuerVoll: { de: 'das Feuer ist voll – mehr als sechs Minuten Brennstoff fasst es nicht', en: 'the fire is full – it holds no more than six minutes of fuel' },
  salzwasser: { de: 'zu salzig – trink aus einem Fluss, einem See oder einer Quelle', en: 'too salty – drink from a river, a lake or a spring' },
  gefroren: { de: 'gefroren – schmilz Schnee oder Eis am Feuer', en: 'frozen – melt snow or ice at a fire' },
  nochNichtMuede: { de: 'du bist noch nicht müde – ab 19 Uhr oder erschöpft', en: 'you are not tired yet – from 7 pm or when exhausted' },
});
