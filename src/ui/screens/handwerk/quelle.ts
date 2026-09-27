/**
 * Crafting as signals for the recipe screens and the HUD's recipe tracker (M4-07, M4-08, M4-32): one source per
 * bridge, shared by every view that shows recipes. It takes the session's crafting sample
 * (`UiBridge.werkstatt.sampleCrafting`, src/game/samples/werkstatt.ts) once per rendered frame – but only while
 * some view needs it (`bedarf`: the items to count and the stations to look for, released on unmount) – and
 * publishes four read-only signals that change only when their content changed:
 *
 * - `stand`: whether a player exists, the visible recipes, the chest switch, the Handwerk level;
 * - `angeheftet`: the recipes pinned to the HUD's tracker – the simulation's list (`craft.pin`, saved with the game);
 *   `anheften` sends the command, the list follows with the next sample;
 * - `warteschlange`: the queue with the progress of its first piece and why it waits;
 * - `vorrat`: what is at hand of the asked items (bags; bags and chests in reach), the best station of each asked kind
 *   within reach and – when a need asks – whether open water is within reach (`umgebung: 'wasser'`) – asked every
 *   `VORRAT_TAKT`-th frame (≈ 10 Hz at 60 fps; the chest lookup of every item allocates, and the stock of a chest
 *   changes at the pace of hands, not of frames) and on every new need.
 *
 * The source of the page's bridge is the pin target of src/ui/hud/tracker/anheften.ts (the station screens pin
 * through it).
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import type { CraftRejectReason } from '../../../game/crafting/events';
import { createCraftingSample, type CraftingSample, type StationAtHandSample } from '../../../game/samples/werkstatt';
import type { UiBridge, UiCraftingActions, UiWerkstatt } from '../../bridge';
import { bindeAnheften } from '../../hud/tracker/anheften';
import type { Vorrat } from './modell';

/** Visible recipes, chest switch and Handwerk level. */
export interface HandwerkStand {
  readonly vorhanden: boolean;
  readonly sichtbar: ReadonlySet<string>;
  readonly kisten: boolean;
  readonly handwerkStufe: number;
}

/** One order of the queue. */
export interface Auftrag {
  readonly rezept: string;
  readonly anzahl: number;
  /** Progress of the piece being worked on [0–1]. */
  readonly fortschritt: number;
  readonly station: string | null;
}

/** The queue and why its first order waits. */
export interface Warteschlange {
  readonly auftraege: readonly Auftrag[];
  readonly blockiert: CraftRejectReason | null;
}

/** What is at hand of the asked items and stations. */
export interface VorratStand extends Vorrat {
  /** The best station at hand for recipes of `station` (asked kinds only), or `null`. */
  stationAnHand(station: string): StationAtHandSample | null;
  /** Whether open fresh water is within reach of the player (false unless a need asks for it). */
  readonly amWasser: boolean;
}

export interface WerkstattQuelle {
  readonly stand: ReadonlySignal<HandwerkStand>;
  /** The recipes pinned to the HUD's tracker, oldest first (the simulation's list). */
  readonly angeheftet: ReadonlySignal<readonly string[]>;
  readonly warteschlange: ReadonlySignal<Warteschlange>;
  readonly vorrat: ReadonlySignal<VorratStand>;
  /** Pins (`an`) or unpins recipe `id` (`craft.pin`; `angeheftet` follows with the next sample). */
  anheften(id: string, an: boolean): void;
  /**
   * A view needs `items` counted, `stationen` looked for and – `wasser` – the water in reach checked; sampling runs
   * while at least one need is registered. Returns the function that releases it.
   */
  bedarf(items: readonly string[], stationen: readonly string[], wasser?: boolean): () => void;
}

/** Frames between two samples of the stock at hand (the queue and the recipes are sampled every frame). */
export const VORRAT_TAKT = 6;

const LEER_STAND: HandwerkStand = { vorhanden: false, sichtbar: new Set(), kisten: true, handwerkStufe: 1 };
const LEERE_SCHLANGE: Warteschlange = { auftraege: [], blockiert: null };
const KEINE_NADELN: readonly string[] = [];

function vorratAus(imBeutel: ReadonlyMap<string, number>, verfuegbar: ReadonlyMap<string, number>, stationen: ReadonlyMap<string, StationAtHandSample | null>, amWasser: boolean): VorratStand {
  return {
    verfuegbar: (item) => verfuegbar.get(item) ?? 0,
    imBeutel: (item) => imBeutel.get(item) ?? 0,
    stationAnHand: (station) => stationen.get(station) ?? null,
    amWasser,
  };
}

const LEERER_VORRAT = vorratAus(new Map(), new Map(), new Map(), false);

function mapsGleich<V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>, gleich: (x: V, y: V) => boolean): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (!b.has(k)) return false;
    if (!gleich(v, b.get(k) as V)) return false;
  }
  return true;
}

const stationGleich = (x: StationAtHandSample | null, y: StationAtHandSample | null): boolean =>
  x === y || (x !== null && y !== null && x.station === y.station && x.qualitaet === y.qualitaet && x.tempo === y.tempo);

/** The source over the crafting samples of `werkstatt`, driven by `onFrame`; pins go out through `befehle`. */
export function createWerkstattQuelle(werkstatt: UiWerkstatt, onFrame: (listener: () => void) => () => void, befehle: Pick<UiCraftingActions, 'pin'>): WerkstattQuelle {
  const stand = signal<HandwerkStand>(LEER_STAND);
  const angeheftet = signal<readonly string[]>(KEINE_NADELN);
  const warteschlange = signal<Warteschlange>(LEERE_SCHLANGE);
  const vorrat = signal<VorratStand>(LEERER_VORRAT);
  const sample: CraftingSample = createCraftingSample();
  const beduerfnisse = new Set<{ readonly items: readonly string[]; readonly stationen: readonly string[]; readonly wasser: boolean }>();
  let stop: (() => void) | null = null;
  let sichtbarStand = -1;
  let angeheftetStand = -1;
  let fragen: { items: readonly string[]; stationen: readonly string[]; wasser: boolean } = { items: [], stationen: [], wasser: false };
  let takt = 0;
  const KEINE: readonly string[] = [];
  let letzteBeutel = new Map<string, number>();
  let letzteVerfuegbar = new Map<string, number>();
  let letzteStationen = new Map<string, StationAtHandSample | null>();
  let letztesWasser = false;

  const neuFragen = (): void => {
    const items = new Set<string>();
    const stationen = new Set<string>();
    let wasser = false;
    for (const b of beduerfnisse) {
      for (const i of b.items) items.add(i);
      for (const s of b.stationen) stationen.add(s);
      wasser ||= b.wasser;
    }
    fragen = { items: [...items], stationen: [...stationen], wasser };
    takt = 0;
    // Answers of items nobody asks for any more are dropped (the maps stay small).
    for (const k of [...sample.imBeutel.keys()]) if (!items.has(k)) sample.imBeutel.delete(k);
    for (const k of [...sample.verfuegbar.keys()]) if (!items.has(k)) sample.verfuegbar.delete(k);
    for (const k of [...sample.stationen.keys()]) if (!stationen.has(k)) sample.stationen.delete(k);
  };

  const frame = (): void => {
    // The stock only every few frames; in between the sample leaves its maps as they were.
    const vorratJetzt = takt === 0;
    takt = (takt + 1) % VORRAT_TAKT;
    sample.frageItems = vorratJetzt ? fragen.items : KEINE;
    sample.frageStationen = vorratJetzt ? fragen.stationen : KEINE;
    sample.frageWasser = vorratJetzt && fragen.wasser;
    werkstatt.sampleCrafting(sample);
    const s = stand.peek();
    if (s.vorhanden !== sample.vorhanden || sichtbarStand !== sample.sichtbarStand || s.kisten !== sample.kisten || s.handwerkStufe !== sample.handwerkStufe) {
      sichtbarStand = sample.sichtbarStand;
      stand.value = { vorhanden: sample.vorhanden, sichtbar: new Set(sample.sichtbar), kisten: sample.kisten, handwerkStufe: sample.handwerkStufe };
    }
    if (angeheftetStand !== sample.angeheftetStand) {
      angeheftetStand = sample.angeheftetStand;
      angeheftet.value = [...sample.angeheftet];
    }
    const w = warteschlange.peek();
    let gleich = w.blockiert === sample.blockiert && w.auftraege.length === sample.auftragAnzahl;
    for (let i = 0; gleich && i < sample.auftragAnzahl; i++) {
      const a = w.auftraege[i];
      const b = sample.auftraege[i];
      gleich = a !== undefined && b !== undefined && a.rezept === b.rezept && a.anzahl === b.anzahl && a.fortschritt === b.fortschritt && a.station === b.station;
    }
    if (!gleich) {
      warteschlange.value = {
        auftraege: sample.auftraege.slice(0, sample.auftragAnzahl).map((a) => ({ rezept: a.rezept, anzahl: a.anzahl, fortschritt: a.fortschritt, station: a.station })),
        blockiert: sample.blockiert,
      };
    }
    const zahl = (x: number, y: number): boolean => x === y;
    // Water counts only while a need asks for it (the sample keeps its last answer otherwise).
    const wasser = fragen.wasser && sample.amWasser;
    if (!mapsGleich(sample.imBeutel, letzteBeutel, zahl) || !mapsGleich(sample.verfuegbar, letzteVerfuegbar, zahl) || !mapsGleich(sample.stationen, letzteStationen, stationGleich) || wasser !== letztesWasser) {
      letzteBeutel = new Map(sample.imBeutel);
      letzteVerfuegbar = new Map(sample.verfuegbar);
      letzteStationen = new Map([...sample.stationen].map(([k, v]) => [k, v === null ? null : { ...v }]));
      letztesWasser = wasser;
      vorrat.value = vorratAus(letzteBeutel, letzteVerfuegbar, letzteStationen, letztesWasser);
    }
  };

  return {
    stand,
    angeheftet,
    warteschlange,
    vorrat,
    anheften(id, an) {
      befehle.pin(id, an);
    },
    bedarf(items, stationen, wasser = false) {
      const b = { items, stationen, wasser };
      beduerfnisse.add(b);
      neuFragen();
      if (stop === null) stop = onFrame(frame);
      frame();
      return () => {
        if (!beduerfnisse.delete(b)) return;
        neuFragen();
        if (beduerfnisse.size === 0 && stop !== null) {
          stop();
          stop = null;
        }
      };
    },
  };
}

const quellen = new WeakMap<UiBridge, WerkstattQuelle>();

/**
 * The shared source of `bridge`, or `null` when its session offers no crafting samples. The source of the bridge in
 * use is the page's pin target (src/ui/hud/tracker/anheften.ts).
 */
export function werkstattQuelle(bridge: UiBridge): WerkstattQuelle | null {
  const w = bridge.werkstatt;
  if (w === null) return null;
  let q = quellen.get(bridge);
  if (q === undefined) {
    q = createWerkstattQuelle(w, (listener) => bridge.onFrame(listener), bridge.actions.crafting);
    quellen.set(bridge, q);
  }
  bindeAnheften(q);
  return q;
}
