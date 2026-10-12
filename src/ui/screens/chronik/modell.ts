/**
 * The chronicle's model (MASTERPROMPT §23.3 "Chronik (J): Aufgaben, Bestiarium, Herbarium & Fischbuch, Wissen (Erbauer-Tafeln,
 * Visionen), Rezeptbuch, Statistiken, Erfolge"; docs/SPIEL.md §23, §30 "`chronik` (7 Reiter) – sampleChronicle, sampleQuests,
 * sampleStats, sampleAchievements, sampleCrafting, Bestiarium"; M7-41): one pure function per tab turns the session's samples
 * into the rows the screen shows, in the current language – content names, filled diary texts, progress and times. The screen
 * (ChronikScreen.tsx) samples through `quelle.ts` when it opens and when its tab changes.
 */
import { BALANCE } from '../../../content/balance';
import type { ChronicleValueKind } from '../../../content/chronik/schema';
import { CONTENT } from '../../../content/index';
import { achievementIconId } from '../../../content/quests/schema';
import { isGroupIngredient } from '../../../content/recipes/schema';
import type { ChronicleEntry } from '../../../game/chronicle/types';
import { placeName } from '../../../game/places/names';
import type { AchievementsSample, BestiarySample, ChronicleSample, QuestSample, SkillsSample, StatsSample } from '../../../game/samples/chronik';
import type { Lang } from '../../../i18n';

/** The seven tabs in their order (MASTERPROMPT §23.3). */
export const CHRONIK_REITER = ['aufgaben', 'bestiarium', 'herbarium', 'wissen', 'rezepte', 'statistik', 'erfolge'] as const;
export type ChronikReiter = (typeof CHRONIK_REITER)[number];

/** The tab `schritt` steps away from `reiter` (wrapping; Q/E). */
export function naechsterReiter(reiter: ChronikReiter, schritt: 1 | -1): ChronikReiter {
  const i = CHRONIK_REITER.indexOf(reiter);
  return CHRONIK_REITER[(i + schritt + CHRONIK_REITER.length) % CHRONIK_REITER.length] as ChronikReiter;
}

/** Diary entries the quest tab shows (the youngest). */
export const TAGEBUCH_ZEILEN = 40;

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

type Named = { readonly name?: { readonly de: string; readonly en: string }; readonly titel?: { readonly de: string; readonly en: string } };

/** The collection a placeholder kind names (`zahl` names none). */
const KIND_COLLECTION: Readonly<Record<Exclude<ChronicleValueKind, 'zahl' | 'rezept'>, string>> = {
  item: 'items',
  kreatur: 'creatures',
  ort: 'locationTypes',
  boss: 'bosses',
  ereignis: 'worldEvents',
  erfolg: 'achievements',
  aufgabe: 'quests',
  fertigkeit: 'skills',
  biom: 'biomes',
};

/** The name of content record `id` of `collection` in `lang`, or the id itself. */
export function inhaltsName(collection: string, id: string, lang: Lang): string {
  if (!CONTENT.hasCollection(collection)) return id;
  const rec = CONTENT.collections().find((c) => c.name === collection)?.find(id) as Named | undefined;
  return rec?.name?.[lang] ?? rec?.titel?.[lang] ?? id;
}

/** The name of an item in `lang`. */
export function itemName(id: string, lang: Lang): string {
  return inhaltsName('items', id, lang);
}

/**
 * A value of a diary entry as the text shows it: a content name for a named kind, else the value. A place is named by the
 * entry's `variante` when its type names that variant (a natural wonder, M7-122; `placeName`).
 */
function wertText(kind: ChronicleValueKind | undefined, value: string | number, lang: Lang, werte: ChronicleEntry['values']): string {
  if (typeof value === 'number' || kind === undefined || kind === 'zahl') return String(value);
  if (kind === 'rezept') {
    const r = CONTENT.collection('recipes').find(value);
    return r === undefined ? value : (r.name?.[lang] ?? itemName(r.ergebnis.item, lang));
  }
  if (kind === 'ort') {
    const variante = werte.variante;
    return placeName(value, typeof variante === 'string' ? variante : '')?.[lang] ?? value;
  }
  return inhaltsName(KIND_COLLECTION[kind], value, lang);
}

// ---------------------------------------------------------------------------------------------
// Aufgaben (+ Tagebuch)
// ---------------------------------------------------------------------------------------------

/** A quest as the tab shows it. */
export interface AufgabenKarte {
  readonly quest: string;
  readonly art: 'haupt' | 'neben' | 'einstieg';
  readonly titel: string;
  readonly beschreibung: string;
  readonly erledigt: boolean;
  /** An onboarding quest while the onboarding is off. */
  readonly pausiert: boolean;
  readonly tracked: boolean;
  /** The current step (null once finished). */
  readonly schritt: { readonly titel: string; readonly hinweis: string; readonly nr: number; readonly von: number; readonly hat: number; readonly braucht: number } | null;
  /** The steps done so far (titles). */
  readonly erledigteSchritte: readonly string[];
}

/** One diary line. */
export interface TagebuchZeile {
  readonly nr: number;
  readonly tag: number;
  readonly text: string;
  readonly art: string;
}

export interface AufgabenAnsicht {
  readonly laufend: readonly AufgabenKarte[];
  readonly erledigt: readonly AufgabenKarte[];
  readonly einstieg: boolean;
  readonly verfolgt: number;
  readonly tagebuch: readonly TagebuchZeile[];
}

/** The text of diary entry `e` in `lang` (its rule's text with the named values), or null for an unknown rule. */
export function tagebuchText(e: ChronicleEntry, lang: Lang): string | null {
  const rule = CONTENT.collection('chronicleRules').find(e.rule);
  if (rule === undefined) return null;
  return rule.text[lang].replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const v = e.values[key];
    return v === undefined ? '' : wertText(rule.platzhalter?.[key], v, lang, e.values);
  });
}

/** The quest tab of `quests` and the diary of `chronicle` in `lang`. */
export function aufgabenAnsicht(quests: Readonly<QuestSample>, chronicle: Readonly<ChronicleSample>, lang: Lang): AufgabenAnsicht {
  const laufend: AufgabenKarte[] = [];
  const erledigt: AufgabenKarte[] = [];
  let verfolgt = 0;
  for (let i = 0; i < quests.count; i++) {
    const r = quests.rows[i];
    const def = r === undefined ? undefined : CONTENT.collection('quests').find(r.quest);
    if (r === undefined || def === undefined) continue;
    const step = r.erledigt ? undefined : def.schritte[r.schritt];
    const karte: AufgabenKarte = {
      quest: r.quest,
      art: def.art,
      titel: def.titel[lang],
      beschreibung: def.beschreibung[lang],
      erledigt: r.erledigt,
      pausiert: !r.erledigt && !r.aktiv,
      tracked: r.tracked,
      schritt:
        step === undefined
          ? null
          : { titel: step.titel[lang], hinweis: step.hinweis[lang], nr: r.schritt + 1, von: r.schritte, hat: Math.floor(r.count), braucht: r.need > 1 ? Math.ceil(r.need) : 0 },
      erledigteSchritte: def.schritte.slice(0, r.erledigt ? def.schritte.length : r.schritt).map((s) => s.titel[lang]),
    };
    if (r.tracked) verfolgt++;
    (r.erledigt ? erledigt : laufend).push(karte);
  }
  const rang = (k: AufgabenKarte): number => (k.art === 'haupt' ? 0 : k.art === 'einstieg' ? 1 : 2);
  laufend.sort((a, b) => rang(a) - rang(b));
  const tagebuch: TagebuchZeile[] = [];
  for (let i = chronicle.entries.length - 1; i >= 0 && tagebuch.length < TAGEBUCH_ZEILEN; i--) {
    const e = chronicle.entries[i] as ChronicleEntry;
    const text = tagebuchText(e, lang);
    const rule = CONTENT.collection('chronicleRules').find(e.rule);
    if (text !== null && rule !== undefined) tagebuch.push({ nr: e.nr, tag: e.day, text, art: rule.art });
  }
  return { laufend, erledigt, einstieg: quests.onboarding, verfolgt, tagebuch };
}

// ---------------------------------------------------------------------------------------------
// Bestiarium
// ---------------------------------------------------------------------------------------------

/**
 * Side of a creature's portrait frame in the bestiary [design px] (M7-108): four lines of the page (11 px each: the page
 * scrolls by whole lines), room for the largest standing pose (the root warden's 41 × 43 covered pixels) at 1 : 1.
 */
export const PORTRAET_PX = 44;

export interface BestiariumZeile {
  readonly kreatur: string;
  readonly bekannt: boolean;
  /** Name (unknown: null – the screen shows "???"). */
  readonly name: string | null;
  readonly beschreibung: string | null;
  /** The lore (sighted), the tip (defeated `killsForResistances` times), the defeats. */
  readonly text: string | null;
  readonly hinweis: string | null;
  readonly besiegt: number;
  readonly beute: boolean;
}

/** Every creature, the known ones first (content order within). */
export function bestiariumAnsicht(sample: Readonly<BestiarySample>, lang: Lang): BestiariumZeile[] {
  const rows = sample.rows.map((r) => {
    const c = CONTENT.collection('creatures').find(r.creature);
    const bekannt = r.gesichtet || r.kills > 0;
    return {
      kreatur: r.creature,
      bekannt,
      name: bekannt && c !== undefined ? c.name[lang] : null,
      beschreibung: bekannt && c !== undefined ? c.beschreibung[lang] : null,
      text: r.gesichtet && c !== undefined ? c.bestiarium.text[lang] : null,
      hinweis: r.resistenzen && c !== undefined ? c.bestiarium.hinweis[lang] : null,
      besiegt: r.kills,
      beute: r.beute,
    };
  });
  return [...rows.filter((r) => r.bekannt), ...rows.filter((r) => !r.bekannt)];
}

// ---------------------------------------------------------------------------------------------
// Herbarium & Fischbuch
// ---------------------------------------------------------------------------------------------

export interface FundZeile {
  readonly id: string;
  readonly name: string | null;
  readonly anzahl: number;
}

export interface HerbariumAnsicht {
  readonly pflanzen: readonly FundZeile[];
  readonly fische: readonly FundZeile[];
  readonly pflanzenBekannt: number;
  readonly fischeBekannt: number;
}

/** Statistic `stat`'s value per key. */
function keyMap(sample: Readonly<StatsSample>, stat: string): Map<string, number> {
  return new Map(sample.rows.find((r) => r.stat === stat)?.keys ?? []);
}

/** The plants the player gathered (bushes, herbs, mushrooms, flowers: statistic `gesammelt` by object) and the fish he caught – found ones first. */
export function herbariumAnsicht(sample: Readonly<StatsSample>, lang: Lang): HerbariumAnsicht {
  const gesammelt = keyMap(sample, 'gesammelt');
  const gefangen = keyMap(sample, 'gefangen');
  const pflanzen = CONTENT.collection('worldObjects')
    .values()
    .filter((o) => (o.kind === 'pflanze' || o.kind === 'busch') && o.tool === 'hand')
    .map((o) => {
      const n = gesammelt.get(o.id) ?? 0;
      return { id: o.id, name: n > 0 ? o.name[lang] : null, anzahl: n };
    });
  const fische = CONTENT.collection('fish')
    .values()
    .map((f) => {
      const n = gefangen.get(f.id) ?? 0;
      return { id: f.id, name: n > 0 ? itemName(f.id, lang) : null, anzahl: n };
    });
  // Found ones first (content order within), like the bestiary: the page opens on what the player knows.
  const zuerst = (l: FundZeile[]): FundZeile[] => [...l.filter((z) => z.anzahl > 0), ...l.filter((z) => z.anzahl === 0)];
  return { pflanzen: zuerst(pflanzen), fische: zuerst(fische), pflanzenBekannt: pflanzen.filter((p) => p.anzahl > 0).length, fischeBekannt: fische.filter((f) => f.anzahl > 0).length };
}

// ---------------------------------------------------------------------------------------------
// Wissen
// ---------------------------------------------------------------------------------------------

export interface WissenEintrag {
  readonly id: string;
  readonly titel: string;
  readonly text: string;
  readonly quelle: string;
}

/** The unlocked knowledge, newest first. */
export function wissenAnsicht(sample: Readonly<ChronicleSample>, lang: Lang): WissenEintrag[] {
  const out: WissenEintrag[] = [];
  for (let i = sample.knowledge.length - 1; i >= 0; i--) {
    const k = sample.knowledge[i];
    const def = k === undefined ? undefined : CONTENT.collection('knowledge').find(k.id);
    if (def !== undefined) out.push({ id: def.id, titel: def.titel[lang], text: def.text[lang], quelle: def.quelle });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rezeptbuch
// ---------------------------------------------------------------------------------------------

export interface RezeptZeile {
  readonly id: string;
  readonly name: string;
  readonly anzahl: number;
  readonly zutaten: string;
}

export interface RezeptGruppe {
  /** The station (null: in the hand). */
  readonly station: string | null;
  readonly name: string;
  readonly rezepte: readonly RezeptZeile[];
}

/** The known recipes `sichtbar`, grouped by station (in the hand first), each with its ingredients. */
export function rezeptAnsicht(sichtbar: ReadonlySet<string>, lang: Lang, handName: string): RezeptGruppe[] {
  const groups = new Map<string | null, RezeptZeile[]>();
  for (const r of CONTENT.collection('recipes').values()) {
    if (!sichtbar.has(r.id)) continue;
    const zutaten = r.zutaten.map((z) => `${z.anzahl}× ${isGroupIngredient(z) ? inhaltsName('ingredientGroups', z.gruppe, lang) : itemName(z.item, lang)}`).join(', ');
    let list = groups.get(r.station);
    if (list === undefined) {
      list = [];
      groups.set(r.station, list);
    }
    list.push({ id: r.id, name: r.name?.[lang] ?? itemName(r.ergebnis.item, lang), anzahl: r.ergebnis.anzahl, zutaten });
  }
  const out: RezeptGruppe[] = [];
  const hand = groups.get(null);
  if (hand !== undefined) out.push({ station: null, name: handName, rezepte: hand });
  for (const s of CONTENT.collection('stations').values()) {
    const list = groups.get(s.id);
    if (list !== undefined) out.push({ station: s.id, name: itemName(s.id, lang), rezepte: list });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Statistiken (+ Fertigkeiten)
// ---------------------------------------------------------------------------------------------

export interface StatistikZeile {
  readonly stat: string;
  readonly name: string;
  /** The value as shown (whole pieces, tiles; play time as hours, minutes and seconds). */
  readonly wert: string;
}

export interface MeilensteinZeile {
  readonly id: string;
  readonly name: string;
  /** Play time when reached ("1:24:05"), or null. */
  readonly zeit: string | null;
}

export interface FertigkeitZeile {
  readonly id: string;
  readonly name: string;
  readonly stufe: number;
  /** Share of the way to the next level [0–1]. */
  readonly anteil: number;
  readonly perks: readonly string[];
  /** Open perk levels. */
  readonly offen: readonly number[];
}

export interface StatistikAnsicht {
  readonly werte: readonly StatistikZeile[];
  readonly meilensteine: readonly MeilensteinZeile[];
  readonly fertigkeiten: readonly FertigkeitZeile[];
}

/** Ticks as hours, minutes and seconds of play ("3:07:12"; the first milestones fall within the first minutes). */
export function spielzeit(ticks: number): string {
  const sekunden = Math.floor(ticks / BALANCE.time.tickHz);
  const minuten = Math.floor(sekunden / 60);
  return `${Math.floor(minuten / 60)}:${String(minuten % 60).padStart(2, '0')}:${String(sekunden % 60).padStart(2, '0')}`;
}

/** The statistics, the milestones and the skills in `lang`. */
export function statistikAnsicht(stats: Readonly<StatsSample>, skills: Readonly<SkillsSample>, lang: Lang): StatistikAnsicht {
  const werte = stats.rows.map((r) => {
    const def = CONTENT.collection('stats').find(r.stat);
    const wert = def?.einheit === 'ticks' ? spielzeit(r.total) : String(Math.floor(r.total));
    return { stat: r.stat, name: def?.name[lang] ?? r.stat, wert };
  });
  const meilensteine = stats.milestones.map((m) => {
    const def = CONTENT.collection('milestones').find(m.id);
    return { id: m.id, name: def?.name[lang] ?? m.id, zeit: m.spielzeit < 0 ? null : spielzeit(m.spielzeit) };
  });
  const perks = CONTENT.collection('perks').values();
  const fertigkeiten = skills.rows.map((s) => {
    const def = CONTENT.collection('skills').find(s.id);
    const gewaehlt = s.perks
      .filter((p) => p.choice !== null)
      .map((p) => perks.find((x) => x.fertigkeit === s.id && x.stufe === p.level && x.wahl === p.choice)?.name[lang])
      .filter((n): n is string => n !== undefined);
    return {
      id: s.id,
      name: def?.name[lang] ?? s.id,
      stufe: s.level,
      anteil: s.xpNext > 0 ? Math.min(1, s.xp / s.xpNext) : 1,
      perks: gewaehlt,
      offen: s.perks.filter((p) => p.choice === null && perks.some((x) => x.fertigkeit === s.id && x.stufe === p.level)).map((p) => p.level),
    };
  });
  return { werte, meilensteine, fertigkeiten };
}

// ---------------------------------------------------------------------------------------------
// Erfolge
// ---------------------------------------------------------------------------------------------

/** The symbol of an achievement not yet reached: the sealed medal (assets-src/sprites/icons/erfolge.ts). */
export const ERFOLG_GESPERRT = 'erfolg_gesperrt';

export interface ErfolgZeile {
  readonly id: string;
  readonly icon: string;
  readonly name: string;
  /** Hidden achievements show "???" until unlocked. */
  readonly beschreibung: string | null;
  readonly erreicht: boolean;
  readonly zeit: string | null;
  readonly hat: number;
  readonly braucht: number;
}

export interface ErfolgeAnsicht {
  readonly zeilen: readonly ErfolgZeile[];
  readonly erreicht: number;
}

/** Every achievement: the unlocked ones first (in content order), each with its symbol, text and progress. */
export function erfolgeAnsicht(sample: Readonly<AchievementsSample>, lang: Lang): ErfolgeAnsicht {
  const zeilen = sample.rows.map((r) => {
    const def = CONTENT.collection('achievements').find(r.id);
    const geheim = def?.geheim === true && !r.unlocked;
    return {
      id: r.id,
      icon: r.unlocked ? achievementIconId(r.id) : ERFOLG_GESPERRT,
      name: geheim ? '???' : (def?.name[lang] ?? r.id),
      beschreibung: geheim ? null : (def?.beschreibung[lang] ?? null),
      erreicht: r.unlocked,
      zeit: r.unlocked ? spielzeit(r.spielzeit) : null,
      hat: Math.floor(r.count),
      braucht: r.need > 1 ? Math.ceil(r.need) : 0,
    };
  });
  return { zeilen: [...zeilen.filter((z) => z.erreicht), ...zeilen.filter((z) => !z.erreicht)], erreicht: zeilen.filter((z) => z.erreicht).length };
}
