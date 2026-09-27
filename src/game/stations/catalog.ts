/**
 * Station lookup for the simulation (MASTERPROMPT §15.1 "Stationsstufen erhöhen Qualität, Tempo und verfügbare
 * Rezepte", §15.2; src/content/stations.ts). Crafting, processing and repair resolve station ids through a
 * `StationCatalog` instead of the content registry, so tests can run them on fixture stations validated with
 * the real station schema. Stage values (tempo, quality points) and fuel rules come from
 * `BALANCE.stations`.
 */
import { BALANCE } from '../../content/balance';
import type { StationFuelBalance, StationStageBalance } from '../../content/balance/stations';
import { CONTENT } from '../../content/index';
import type { StationDef } from '../../content/stations';

/** Unknown station id or an inconsistent catalog. */
export class StationCatalogError extends Error {
  override readonly name = 'StationCatalogError';
}

/** Stage values of a station without an entry of its own (fixture stations): as given, no quality points. */
const PLAIN_STAGE: StationStageBalance = { tempo: 1, qualitaet: 0 };

/** Station definitions by id, with their stage values. */
export class StationCatalog {
  private readonly byId = new Map<string, StationDef>();
  /** Stations in definition order. */
  readonly list: readonly StationDef[];

  constructor(
    defs: readonly StationDef[],
    private readonly stages: Readonly<Record<string, StationStageBalance>> = BALANCE.stations.stages,
    private readonly fuels: Readonly<Record<string, StationFuelBalance>> = BALANCE.stations.fuel,
  ) {
    for (const d of defs) {
      if (this.byId.has(d.id)) throw new StationCatalogError(`Station catalog: duplicate station "${d.id}"`);
      if (d.verarbeitung?.brennstoff === true && fuels[d.id] === undefined) throw new StationCatalogError(`Station catalog: "${d.id}" burns fuel but has no fuel rules`);
      this.byId.set(d.id, d);
    }
    this.list = Object.freeze([...defs]);
  }

  /** The station `id`; throws `StationCatalogError` if it does not exist. */
  get(id: string): StationDef {
    const d = this.byId.get(id);
    if (d === undefined) throw new StationCatalogError(`Unknown station "${id}" (${this.list.length} stations)`);
    return d;
  }

  /** The station `id`, or `undefined`. */
  find(id: string): StationDef | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /**
   * Whether a station `actual` can make the recipes of station `required`: the same line at the same or a
   * higher stage (§15.1 "Stationsstufen erhöhen … verfügbare Rezepte": Werkbank II makes what Werkbank I makes).
   */
  satisfies(required: string, actual: string): boolean {
    const r = this.byId.get(required);
    const a = this.byId.get(actual);
    return r !== undefined && a !== undefined && r.linie === a.linie && a.stufe >= r.stufe;
  }

  /** Tempo and quality points of station `id`. */
  stage(id: string): StationStageBalance {
    return this.stages[id] ?? PLAIN_STAGE;
  }

  /** Fuel rules of station `id`, or `null` for a station without a fuel slot. */
  fuel(id: string): StationFuelBalance | null {
    return this.get(id).verarbeitung?.brennstoff === true ? (this.fuels[id] as StationFuelBalance) : null;
  }

  /**
   * The skill whose bonus speeds work at station `id` (§23.2 "je Stufe +0,5 % Wirkung im Bereich"): the skill that owns
   * the station's experience source `erfahrung` (src/content/skills.ts: `metall_geschmiedet` and `barren_geschmolzen`
   * are Schmieden), or `null` for a station without one.
   */
  skill(id: string): string | null {
    const source = this.get(id).erfahrung;
    return source === undefined ? null : (skillOfSource(source) ?? null);
  }

  /** The station of `line` at `stage`, or `undefined`. */
  atStage(line: string, stage: number): StationDef | undefined {
    return this.list.find((d) => d.linie === line && d.stufe === stage);
  }
}

/** Skill of each experience source of the game's skills (src/content/skills.ts), built on first use. */
let sourceSkills: ReadonlyMap<string, string> | null = null;

/** The skill that owns experience source `source`, or `undefined`. */
function skillOfSource(source: string): string | undefined {
  if (sourceSkills === null) {
    const m = new Map<string, string>();
    for (const skill of CONTENT.collection('skills').values()) for (const q of skill.quellen) m.set(q.id, skill.id);
    sourceSkills = m;
  }
  return sourceSkills.get(source);
}

let contentCatalog: StationCatalog | null = null;

/** The catalog of the game's stations (src/content/stations.ts), built on first use. */
export function contentStationCatalog(): StationCatalog {
  contentCatalog ??= new StationCatalog(CONTENT.collection('stations').values());
  return contentCatalog;
}
