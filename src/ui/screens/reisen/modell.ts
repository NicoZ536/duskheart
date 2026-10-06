/**
 * The travel screen's model (MASTERPROMPT §25 "Schnellreise … Lumen-Kosten nach Distanz"; docs/SPIEL.md §22 "Schnellreise", §30
 * "`reisen` – E am Reisepunkt – sampleTravel"; M7-37): the point the player stands at and every destination with its name and
 * its price against the Lumen shards in the bags; what blocks travel now (a fight, a boss, cargo) as one line.
 * Pure – the screen (ReisenScreen.tsx) feeds it the session's sample and the bags' count.
 */
import { CONTENT } from '../../../content/index';
import { BALANCE } from '../../../content/balance';
import type { TravelPoint, TravelSample } from '../../../game/travel/types';
import type { I18n } from '../../../i18n';

/** One destination of the list. */
export interface ReiseZiel {
  readonly id: string;
  readonly art: TravelPoint['kind'];
  readonly name: string;
  readonly kosten: number;
  /** Enough Lumen in the bags. */
  readonly bezahlbar: boolean;
}

/** What the screen shows. */
export interface ReiseAnsicht {
  readonly von: string;
  /** The waystone the player stands at (it can be named), or null. */
  readonly wegstein: number | null;
  readonly ziele: readonly ReiseZiel[];
  readonly lumen: number;
  /** Why no trip can start now (a line of text), or null. */
  readonly gesperrt: string | null;
}

/** The number of a point id `<kind>:<n>`. */
function nummer(id: string): number {
  return Number(id.slice(id.indexOf(':') + 1));
}

/** The name of travel point `p` in the language of `i18n`: the beacon's biome, a hearth, a waystone's own name or its number. */
export function punktName(i18n: I18n, p: Pick<TravelPoint, 'id' | 'kind' | 'name'>): string {
  const n = nummer(p.id);
  if (p.kind === 'leuchtfeuer') {
    const beacon = CONTENT.collection('beacons').values().find((b) => b.nummer === n);
    const biom = beacon === undefined ? '' : (CONTENT.collection('biomes').find(beacon.biom)?.name[i18n.lang] ?? beacon.biom);
    return i18n.t('ui.reisen.punkt.leuchtfeuer', { biom });
  }
  if (p.kind === 'herdfeuer') return i18n.t('ui.reisen.punkt.herdfeuer', { n });
  return p.name.length > 0 ? p.name : i18n.t('ui.reisen.punkt.wegstein', { n });
}

/** The screen's view of `sample` with `lumen` shards in the bags. */
export function reiseAnsicht(i18n: I18n, sample: Readonly<TravelSample>, lumen: number): ReiseAnsicht {
  const from = sample.points.length === 0 && sample.from === '' ? null : sample.from;
  const kind = from === null ? null : (from.slice(0, from.indexOf(':')) as TravelPoint['kind']);
  const fromPoint: Pick<TravelPoint, 'id' | 'kind' | 'name'> | null = from === null || kind === null ? null : { id: from, kind, name: sample.fromName };
  const ziele: ReiseZiel[] = sample.points.map((p, i) => {
    const kosten = sample.costs[i] ?? BALANCE.travel.minCost;
    return { id: p.id, art: p.kind, name: punktName(i18n, p), kosten, bezahlbar: lumen >= kosten };
  });
  return {
    von: fromPoint === null ? '' : punktName(i18n, fromPoint),
    wegstein: kind === 'wegstein' && from !== null ? nummer(from) : null,
    ziele,
    lumen,
    gesperrt: sample.blocked === null ? null : i18n.t(`ui.reisen.reject.${sample.blocked}`),
  };
}
