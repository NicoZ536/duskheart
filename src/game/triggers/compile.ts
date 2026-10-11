/**
 * Compiled triggers (docs/SPIEL.md §17 "Auslöser-Sprache"; strand G, M7-42 … M7-47): the content's `Trigger` trees become
 * node trees the observers evaluate without allocating – every event leaf with its index into the armed trigger's counters
 * (depth first, the order `forEachTrigger` visits), its payload filter split into field and value arrays and the count it
 * needs. A trigger object is compiled once (the content is frozen, the cache keys on its identity).
 *
 * Payload filters compare equal; the string `@spieler` (`PLAYER_TOKEN`) as a value means "the player's entity" – the killer of
 * a creature (`creatureDied.by`) is counted for the player's kills only.
 */
import type { Trigger, TriggerFilter } from '../../content/schema/trigger';

/** Filter value meaning the player's entity (`creatureDied.by`, `combatantDefeated.by`). */
export const PLAYER_TOKEN = '@spieler';

/** Node kinds of a compiled trigger (`Trigger['art']` as small integers for the evaluator's switch). */
export const NODE = {
  ereignis: 0,
  statistik: 1,
  besitz: 2,
  zustand: 3,
  uhr: 4,
  lichtstufe: 5,
  raum: 6,
  freischaltung: 7,
  aufgabe: 8,
  ort: 9,
  alle: 10,
  eines: 11,
  nicht: 12,
} as const;

/** An event leaf: which event, which payload fields must equal which values, how many times. */
export interface EventLeaf {
  /** Index into the armed trigger's counters. */
  readonly index: number;
  readonly type: string;
  readonly fields: readonly string[];
  readonly values: readonly (string | number | boolean)[];
  readonly need: number;
}

/** A node of a compiled trigger. Only the fields of its kind are meaningful. */
export interface TriggerNode {
  readonly kind: number;
  readonly leaf: EventLeaf | null;
  /** Ids: statistic, item, condition, unlock, quest, place type. */
  readonly id: string;
  /** Statistic key, quest step, room type (`''` none). */
  readonly sub: string;
  /** Threshold: `mindestens` / `anzahl`; `uhr`: the day (0 any). */
  readonly a: number;
  /** `uhr`: before hour (25: none); `lichtstufe`: at most (Infinity: none); `raum`: 1 indoors, 0 outdoors, −1 any. */
  readonly b: number;
  /** `uhr`: from hour (−1: none); `lichtstufe`: at least (−Infinity: none); `aufgabe`: 1 erledigt, 0 aktiv. */
  readonly c: number;
  readonly children: readonly TriggerNode[];
}

/** A compiled trigger. */
export interface CompiledTrigger {
  readonly trigger: Trigger;
  readonly root: TriggerNode;
  /** Every event leaf, depth first. */
  readonly leaves: readonly EventLeaf[];
  /** The distinct event types of the leaves. */
  readonly types: readonly string[];
  /** Whether a part of it reads state (checked on the world tick). */
  readonly stateful: boolean;
}

/** Hour after the last one of a day (`uhr` without `vorStunde`). */
const NO_BEFORE_HOUR = 25;

const cache = new WeakMap<Trigger, CompiledTrigger>();

function node(kind: number, rest: Partial<Omit<TriggerNode, 'kind'>> = {}): TriggerNode {
  return { kind, leaf: rest.leaf ?? null, id: rest.id ?? '', sub: rest.sub ?? '', a: rest.a ?? 0, b: rest.b ?? 0, c: rest.c ?? 0, children: rest.children ?? [] };
}

function splitFilter(wo: TriggerFilter | undefined): { fields: string[]; values: (string | number | boolean)[] } {
  const fields: string[] = [];
  const values: (string | number | boolean)[] = [];
  if (wo !== undefined) {
    for (const key of Object.keys(wo).sort()) {
      fields.push(key);
      values.push(wo[key] as string | number | boolean);
    }
  }
  return { fields, values };
}

/** Compiles `trigger` (cached per trigger object). */
export function compileTrigger(trigger: Trigger): CompiledTrigger {
  const known = cache.get(trigger);
  if (known !== undefined) return known;
  const leaves: EventLeaf[] = [];
  let stateful = false;
  const build = (t: Trigger): TriggerNode => {
    switch (t.art) {
      case 'ereignis': {
        const { fields, values } = splitFilter(t.wo);
        const leaf: EventLeaf = { index: leaves.length, type: t.ereignis, fields, values, need: t.anzahl ?? 1 };
        leaves.push(leaf);
        return node(NODE.ereignis, { leaf });
      }
      case 'statistik':
        stateful = true;
        return node(NODE.statistik, { id: t.statistik, sub: t.schluessel ?? '', a: t.mindestens });
      case 'besitz':
        stateful = true;
        return node(NODE.besitz, { id: t.item, a: t.anzahl });
      case 'zustand':
        stateful = true;
        return node(NODE.zustand, { id: t.zustand });
      case 'uhr':
        stateful = true;
        return node(NODE.uhr, { a: t.tag ?? 0, b: t.vorStunde ?? NO_BEFORE_HOUR, c: t.abStunde ?? -1 });
      case 'lichtstufe':
        stateful = true;
        return node(NODE.lichtstufe, { b: t.hoechstens ?? Number.POSITIVE_INFINITY, c: t.mindestens ?? Number.NEGATIVE_INFINITY });
      case 'raum':
        stateful = true;
        return node(NODE.raum, { sub: t.raumtyp ?? '', b: t.innen === undefined ? -1 : t.innen ? 1 : 0 });
      case 'freischaltung':
        stateful = true;
        return node(NODE.freischaltung, { id: t.freischaltung });
      case 'aufgabe':
        stateful = true;
        return node(NODE.aufgabe, { id: t.aufgabe, sub: t.schritt ?? '', c: t.status === 'erledigt' ? 1 : 0 });
      case 'ort':
        stateful = true;
        return node(NODE.ort, { id: t.ortstyp, a: t.anzahl ?? 1 });
      case 'alle':
        return node(NODE.alle, { children: t.von.map(build) });
      case 'eines':
        return node(NODE.eines, { children: t.von.map(build) });
      case 'nicht':
        // "Not yet happened" holds from the moment of arming: checked on the world tick like a state.
        stateful = true;
        return node(NODE.nicht, { children: [build(t.von)] });
    }
  };
  const root = build(trigger);
  const compiled: CompiledTrigger = { trigger, root, leaves, types: [...new Set(leaves.map((l) => l.type))], stateful };
  cache.set(trigger, compiled);
  return compiled;
}
