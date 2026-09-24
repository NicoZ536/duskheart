/**
 * Frame logic of the HUD (M3-27): once per rendered frame (the bridge's `onFrame`) it decides which
 * displays show in the current mode (`modus.ts`) and at which fade step (`kontext.ts`), and publishes the
 * steps as signals – components re-render only when a step changes. It reads the bridge's signals without
 * subscribing (`peek`) and allocates nothing per frame.
 */
import { signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { BagsState } from '../../game/inventory/bags';
import type { UiState } from '../bridge';
import { Aenderungswaechter, Einblendung, VOLL } from './kontext';
import { aenderungZeigt, HUD_LEISTEN, leisteImmer, leisteRelevant, thermometerRelevant, type HudLeiste, type HudMode, type ThermoLage } from './modus';
import { trendStufe } from './thermometer';

/** Displays with a fade step. */
export type HudTeil = HudLeiste | 'thermo' | 'schnellleiste';
/** Every display with a fade step. */
export const HUD_TEILE: readonly HudTeil[] = [...HUD_LEISTEN, 'thermo', 'schnellleiste'];

export class HudSteuerung {
  private readonly stufeSignale: Record<HudTeil, Signal<number>>;
  private readonly einblendung: Record<HudTeil, Einblendung>;
  private readonly waechter: Record<HudLeiste, Aenderungswaechter>;
  /** Hotbar, belt and equipment areas and the selection last seen (areas are shared until they change). */
  private letzteLeiste: BagsState['schnellleiste'] | null = null;
  private letzterGuertel: BagsState['guertel'] | null = null;
  private letzteAusruestung: BagsState['ausruestung'] | null = null;
  private letzteAuswahl = -1;
  /** Value and maximum of the bar being judged (fields instead of a tuple: nothing allocated per frame). */
  private wertJetzt = 0;
  private maxJetzt = 0;
  /** Reused reading of the thermometer rule. */
  private readonly thermo: { -readonly [K in keyof ThermoLage]: ThermoLage[K] } = { coreC: 0, feltC: 0, bandLowC: 0, bandHighC: 0, stage: 'normal', trend: 0 };
  /** Current mode and reduced motion (set by the HUD from the settings). */
  modus: HudMode = 'full';
  bewegungReduziert = false;

  constructor() {
    this.stufeSignale = { leben: signal(0), ausdauer: signal(0), saettigung: signal(0), durst: signal(0), thermo: signal(0), schnellleiste: signal(0) };
    this.einblendung = { leben: new Einblendung(), ausdauer: new Einblendung(), saettigung: new Einblendung(), durst: new Einblendung(), thermo: new Einblendung(), schnellleiste: new Einblendung() };
    this.waechter = { leben: new Aenderungswaechter(), ausdauer: new Aenderungswaechter(), saettigung: new Aenderungswaechter(), durst: new Aenderungswaechter() };
  }

  /** Fade step of a display: `VOLL` (3) … 1, 0 = hidden. */
  stufe(teil: HudTeil): ReadonlySignal<number> {
    return this.stufeSignale[teil];
  }

  /** Reads the frame's state and updates the steps (call once per rendered frame). */
  frame(state: UiState): void {
    const p = state.player;
    if (!p.present.peek()) {
      for (let i = 0; i < HUD_TEILE.length; i++) this.stufeSignale[HUD_TEILE[i] as HudTeil].value = 0;
      return;
    }
    const tick = state.tick.peek();
    const modus = this.modus;
    for (let i = 0; i < HUD_LEISTEN.length; i++) {
      const art = HUD_LEISTEN[i] as HudLeiste;
      this.lies(state, art);
      const geaendert = this.waechter[art].melde(this.wertJetzt, tick);
      const relevant = leisteRelevant(modus, art, this.wertJetzt, this.maxJetzt) || (geaendert && aenderungZeigt(modus));
      this.stufeSignale[art].value = modus === 'full' ? VOLL : this.einblendung[art].stufe(tick, relevant, this.bewegungReduziert);
    }
    const t = this.thermo;
    t.coreC = p.coreC.peek();
    t.feltC = p.feltC.peek();
    t.bandLowC = p.bandLowC.peek();
    t.bandHighC = p.bandHighC.peek();
    t.stage = p.temperatureStage.peek();
    t.trend = trendStufe(p.coreRateCps.peek());
    const thermoRelevant = thermometerRelevant(modus, t);
    this.stufeSignale.thermo.value = modus === 'full' ? VOLL : this.einblendung.thermo.stufe(tick, thermoRelevant, this.bewegungReduziert);
    // The hotbar: always, or in Minimal for a moment after its content or the selection changed.
    const taschen = state.bags.peek();
    const auswahl = taschen?.auswahl ?? -1;
    const leiste = taschen?.schnellleiste ?? null;
    const guertel = taschen?.guertel ?? null;
    const ausruestung = taschen?.ausruestung ?? null;
    // Only what the row shows counts: a change in the main inventory does not bring the hotbar back.
    const geaendert = leiste !== this.letzteLeiste || guertel !== this.letzterGuertel || ausruestung !== this.letzteAusruestung || auswahl !== this.letzteAuswahl;
    const ersteMeldung = this.letzteLeiste === null;
    this.letzteLeiste = leiste;
    this.letzterGuertel = guertel;
    this.letzteAusruestung = ausruestung;
    this.letzteAuswahl = auswahl;
    const leisteRelevantJetzt = taschen !== null && (leisteImmer(modus) || (geaendert && !ersteMeldung));
    this.stufeSignale.schnellleiste.value = leisteImmer(modus) && taschen !== null ? VOLL : this.einblendung.schnellleiste.stufe(tick, leisteRelevantJetzt, this.bewegungReduziert);
  }

  private lies(state: UiState, art: HudLeiste): void {
    const p = state.player;
    switch (art) {
      case 'leben':
        this.wertJetzt = p.health.peek();
        this.maxJetzt = p.maxHealth.peek();
        return;
      case 'ausdauer':
        this.wertJetzt = p.stamina.peek();
        this.maxJetzt = p.maxStamina.peek();
        return;
      case 'saettigung':
        this.wertJetzt = p.satiety.peek();
        this.maxJetzt = MAX_WERT;
        return;
      case 'durst':
        this.wertJetzt = p.thirst.peek();
        this.maxJetzt = MAX_WERT;
        return;
    }
  }
}

/** Maximum of satiety and thirst (§11.1 "0–100"). */
const MAX_WERT = 100;
