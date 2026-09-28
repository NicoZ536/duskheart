/**
 * The build mode (MASTERPROMPT §16.6 "Baumodus (B) mit Kategorienleiste … und Suche. Geister-Vorschau grün/rot
 * mit Grund …, Drehen (R), Spiegeln (F), Ziehen …, Pipette (Mittelklick), Rückgängig innerhalb von 10 s (Strg+Z)",
 * "Aufwerten an Ort und Stelle (Holz → Stein), Flächenreparatur, Abbauen (100 % zurück in den ersten 30 s, danach
 * 60 %)", "Overlays"; §26 "Bau-Menü"; M4-22 … M4-26, M4-38). A screen of the screen stack whose input context is
 * `build`: the world stays in front and playable (walking, placing), the HUD's values and minimap stay, its hotbar
 * and recipe tracker give way to the build panel and the tool bar. B (D-pad down) or Esc leave it.
 *
 * - **Build panel** (right, below the minimap, in the place of the recipe tracker – clear of the world around the
 *   player): the category bar (only categories with pieces, `katalog.ts`) with the search field in the room its last
 *   row leaves, the category's or the search's pieces as slots with their icon and the pieces in the bags (none:
 *   dimmed), and the chosen piece's name, stock and costs (recipe ingredients and station), rotation and mirror.
 *   The pieces show two rows, one when the panel would otherwise reach below the window (a long name and long
 *   costs in a window of 270 design px). Pixel tooltips (`BauTipp`) name what a tab, a switch, a piece or a tool
 *   is – a piece with its "Herkunft" and "Verwendet in".
 * - **Tool bar** (bottom, in the place of the hotbar; `Werkzeugleiste.tsx`): Setzen, Abbauen, Aufwerten, Reparieren
 *   with their keys (1–4, pad LB) and "Beenden" (B). The ghost judges the tool's targets, the status line says what
 *   comes back or what it costs (`werkzeugStatus.ts`), a short text stands over the cursor.
 * - **Blueprint mode** (M4-24, placing): the switch "Blaupause" next to the panel's title, G (pad RB) and its hint
 *   glyph; the ghost then plans in the plan blue, clicks and drags send `build.blueprint`, undo takes the plans back.
 *   Outside it a part missing in the bags names the toggle – in the status line with its glyph ("Kein Material – [G]
 *   plant es als Blaupause.") and above the ghost's reason.
 * - **Blueprints in view** (above the status line, M4-24): what they still need ("Blaupausen brauchen noch: 4×
 *   Holzwand …") or that everything is at hand (`Blaupausen.tsx`).
 * - **Status line** (bottom, next to the panel): what the ghost found under the cursor – "4 von 6 setzbar" or the
 *   reason in the warning colour ("Keine Stütze in Reichweite …", §26 "Fehlermeldungen sagen, was fehlt und wie man
 *   es löst"), in blueprint mode "Alle 4 als Blaupause planbar." with the plan's blue edge, with a tool its verdict –,
 *   the refusal of the last command, a dismantling that waits for its confirmation ("12 Teile abbauen? [LMB]
 *   bestätigen, [RMB] abbrechen."), and the short messages of turning, mirroring, pipette, undo, the tools and the
 *   blueprint switch.
 * - **Hint line** (below the tool bar): the gestures of the tool in use with their glyphs (M4-38: mouse sprites for
 *   LMB/RMB, the key cap sprite for keys, the gamepad's buttons; `hinweise.ts`); one row – what does not fit is left
 *   out, the least important first.
 * - **Overlays** (M4-26): Räume, Temperatur, Licht, Behaglichkeit, Stützen as switches at the left below the HUD's
 *   values, the legend of the one shown below them.
 * - **Selection by keys and controller:** Tab/I (D-pad up) gives the panel the focus (input context `ui`): arrows
 *   walk tabs, slots, search, switches and tools, Q/E (LB/RB) change the category, Enter (A) takes a piece or a tool
 *   and returns to placing, Esc (B) returns without.
 *
 * Reads bridge signals and the ghost's verdicts, writes only commands (`bridge.actions.build`, the hand's hotbar slot).
 */
import { useSignal } from '@preact/signals';
import { Fragment, type RefObject } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import type { Action } from '../../../engine/input/actions';
import type { SimEventMap } from '../../../game/sim';
import type { I18n } from '../../../i18n';
import { BUILD_OVERLAYS } from '../../../render/game/overlays';
import type { BuildGhost, BuildTool } from '../../../render/game/ghost';
import type { UiBridge } from '../../bridge';
import type { FocusElement, FocusManager, NavAction } from '../../focus/manager';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { hudTokens } from '../../hud/farben';
import { HinweisGlyph } from '../../hud/bau/Glyphe';
import { hinweisGlyphe, type HinweisGlyphe } from '../../hud/bau/glyphen';
import { ScrollArea, Slot, uiPx } from '../../kit';
import { UI_SCALE_VAR } from '../../theme';
import { tooltipTokens } from '../../tooltip';
import { ensureAtlasImages, itemIconUrl } from '../inventar/itemIcons';
import { BauLegende } from './Legende';
import { BLAUPAUSE_FARBE, BlaupausenZeile } from './Blaupausen';
import { BauTipp } from './BauTipp';
import { bauHinweise, hinweisRaum, hinweisUeberstand, verborgeneHinweise } from './hinweise';
import { bauKosten, eintraegeDer, sucheEintraege, vorrat, type BauEintrag, type BauKategorie } from './katalog';
import { BauSteuerung, type BauBefehle } from './steuerung';
import { itemName, werkzeugBefund, werkzeugText, type WerkzeugBefund } from './werkzeugStatus';
import { Werkzeugleiste } from './Werkzeugleiste';
import './bau.css';

/** Id of the build mode in the screen stack (src/ui/focus/GameScreens.tsx). */
export const BAU_SCREEN = 'bau';
/** Slots per row of the piece grid and rows shown before it scrolls (fewer when the window is too low). */
export const TEILE_SPALTEN = 6;
const TEILE_ZEILEN = 2;
/** Size of a slot [design px] (kit graphic `slot`) and the gap. */
const SLOT_PX = 20;
const SLOT_ABSTAND = 1;
/** Room the panel keeps to the window's bottom edge [design px] (bau.css: the bottom row stands 2 px above it). */
const RAND_UNTEN = 2;
/** Gap between two hints of the hint line [design px] (bau.css `.dh-bau__hinweise` column-gap). */
const HINWEIS_ABSTAND = 5;
/**
 * Width under the build panel [design px]: its column (bau.css `.dh-bau__unten` right 146 px) up to the window's right
 * margin (2 px); and the gap the hint line keeps below the panel when it runs on under it (M5-37).
 */
const UNTER_TAFEL = 144;
const HINWEIS_LUFT = 2;
/** CSS variable of the part of the hint line that runs under the panel (bau.css). */
const HINWEIS_UEBER_VAR = '--dh-bau-hinweis-ueber';

/** Height of a piece grid of `zeilen` rows [design px]: the rows and the gaps between them. */
function teileHoehe(zeilen: number): number {
  return zeilen * SLOT_PX + (zeilen - 1) * SLOT_ABSTAND;
}

/**
 * Rows of the piece grid for a panel whose bottom edge lies at `unten` with `zeilen` rows, in a window whose bottom
 * edge lies at `fenster` [both in the same px, `scale` px per design px]: one row less while it reaches below the
 * window, one more while that still fits (never below one, never above `TEILE_ZEILEN`; no oscillation).
 */
export function teileZeilen(zeilen: number, unten: number, fenster: number, scale: number): number {
  const grenze = fenster - RAND_UNTEN * scale;
  if (unten > grenze && zeilen > 1) return zeilen - 1;
  if (zeilen < TEILE_ZEILEN && unten + (SLOT_PX + SLOT_ABSTAND) * scale <= grenze) return zeilen + 1;
  return zeilen;
}

/** Where the glyphs of keys stand in a translated status text (private-use characters, never in a translation). */
const GLYPHE_PLATZ = '';
const GLYPHE_PLATZ_2 = '';
const GLYPHEN_TRENNER = /([])/;

/** The controllers of the page's build ghosts (one per session: choice and undo steps outlive the screen). */
const steuerungen = new WeakMap<BuildGhost, BauSteuerung>();

/** The mounted build mode (debug scenarios choose pieces and read the ghost), or `null`. */
let aktiv: AktiverBauModus | null = null;

/** The open build mode: the shared ghost, its controller and the bridge it reads. */
export interface AktiverBauModus {
  readonly ghost: BuildGhost;
  readonly steuerung: BauSteuerung;
  readonly bridge: UiBridge;
}

/** The build mode of the page while it is open, or `null`. */
export function aktiverBauModus(): AktiverBauModus | null {
  return aktiv;
}

/** The build mode's controller of `ghost` (created on first use). */
export function bauSteuerung(ghost: BuildGhost, befehle: BauBefehle): BauSteuerung {
  let s = steuerungen.get(ghost);
  if (s === undefined) {
    s = new BauSteuerung(ghost, befehle);
    steuerungen.set(ghost, s);
  }
  return s;
}

/** The commands the build mode sends through `bridge`: the build actions and the hand's hotbar slot. */
export function bauBefehle(bridge: UiBridge): BauBefehle {
  const b = bridge.actions.build;
  return {
    place: b.place,
    blueprint: b.blueprint,
    remove: b.remove,
    placeStation: b.placeStation,
    removeStation: b.removeStation,
    upgrade: b.upgrade,
    repair: b.repair,
    takeLight: b.takeLight,
    selectHotbar: (index) => bridge.actions.inventory.select(index),
  };
}

export interface BauModusProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  readonly ghost: BuildGhost;
  /** Whether the build mode is the top screen (placing input only then). */
  readonly oben: () => boolean;
  readonly close: () => void;
}

/** What the ghost found in the last frame (published when it changes). */
interface Befund {
  /** The piece the ghost judged (the verdicts belong to it, not to a piece chosen since). */
  readonly teil: string | null;
  readonly station: boolean;
  readonly anker: number;
  readonly setzbar: number;
  readonly grund: string | null;
  readonly vorrat: number;
  readonly gueltig: boolean;
  /** The verdicts were judged in blueprint mode. */
  readonly plan: boolean;
  /** The tool the verdicts were judged for, and the count of its judgements (a tool's texts follow it). */
  readonly werkzeug: BuildTool;
  readonly stand: number;
}
const KEIN_BEFUND: Befund = { teil: null, station: false, anker: 0, setzbar: 0, grund: null, vorrat: 0, gueltig: false, plan: false, werkzeug: 'setzen', stand: -1 };

/** Glyph of `action` on the device used last, or `null` when it is unbound there. */
function glypheVon(bridge: UiBridge, i18n: I18n, action: Action): HinweisGlyphe | null {
  const input = bridge.input;
  const b = input?.promptBinding(action);
  if (input === null || b === undefined) return null;
  return hinweisGlyphe(b, input.gamepadFamily, (k, p) => i18n.t(k, p));
}

/** The short name a glyph stands for ("G", "RB", "Strg+Z"). */
function glyphenName(g: HinweisGlyphe): string {
  return g.art === 'kappe' ? g.text : g.name;
}

/** The hint of the blueprint toggle over the ghost ("[G] Blaupause"), or `null` when the toggle is unbound. */
export function planHinweis(i18n: I18n, glyphe: HinweisGlyphe | null): string | null {
  return glyphe === null ? null : i18n.t('ui.bau.geist.planHinweis', { taste: glyphenName(glyphe) });
}

/**
 * The commands whose refusal the build mode shows in its status line (placing, the tools, stations); a torch's refusal
 * (`light.take`, E takes torches outside the build mode too) stays a notification of the HUD.
 */
function bauBefehl(type: string): boolean {
  return type.startsWith('build.') || type === 'station.place' || type === 'station.remove';
}

/** The text key of a refusal of command `type` for `reason` (the repair names the hammer it needs). */
function ablehnungsText(type: string, reason: string): string {
  if (type === 'build.repair' && reason === 'noHammer') return 'ui.bau.reparieren.hammer';
  if (type.startsWith('station.')) return `ui.station.reject.${reason}`;
  if (type === 'light.take') return `ui.light.reject.${reason}`;
  return `ui.build.reject.${reason}`;
}

export function BauModus({ i18n, bridge, focus, ghost, oben, close }: BauModusProps) {
  const t = i18n.t;
  const lang = i18n.lang;
  const befehle = useMemo(() => bauBefehle(bridge), [bridge]);
  const s = useMemo(() => bauSteuerung(ghost, befehle), [ghost, befehle]);
  const tokens = useMemo(() => ({ ...hudTokens(), ...BLAUPAUSE_FARBE, ...tooltipTokens() }), []);
  const bags = bridge.state.bags.value;
  const befund = useSignal<Befund>(KEIN_BEFUND);
  const zeilen = useSignal(TEILE_ZEILEN);
  const geraet = useSignal(bridge.input?.lastDevice ?? 'keyboard');
  const wurzel = useRef<HTMLDivElement>(null);
  const leiste = useRef<HTMLDivElement>(null);
  const hinweisZeile = useRef<HTMLDivElement>(null);
  const openedTick = useMemo(() => bridge.state.tick.peek(), [bridge]);
  const rejection = bridge.state.lastRejection.value;

  useEffect(() => ensureAtlasImages(), []);
  useEffect(() => {
    s.oeffnen(bridge.state.bags.peek());
    const eintrag: AktiverBauModus = { ghost, steuerung: s, bridge };
    aktiv = eintrag;
    return () => {
      s.schliessen();
      if (aktiv === eintrag) aktiv = null;
    };
  }, [s, bridge, ghost]);

  // Placing input once per rendered frame, the ghost's findings, leaving on death.
  useEffect(
    () =>
      bridge.onFrame(() => {
        const input = bridge.input;
        if (bridge.state.player.health.peek() <= 0 || !bridge.state.player.present.peek()) {
          close();
          return;
        }
        // A screen above (the pause menu) handed the context back to `build`: the selection by keys has ended.
        if (input !== null && s.katalog.peek() && input.context !== 'ui') s.setzeKatalog(false, null);
        if (input !== null && oben() && !s.katalog.peek()) s.frame(input, bridge.state.tick.peek(), bridge.state.bags.peek());
        const b = befund.peek();
        const station = ghost.judgedSource === 'station';
        const plan = ghost.judgedBlueprint;
        const stand = ghost.judgedTool === 'setzen' ? -1 : ghost.toolRevision;
        if (b.teil !== ghost.judged || b.station !== station || b.anker !== ghost.plan.length / 2 || b.setzbar !== ghost.okCount || b.grund !== ghost.firstReason || b.vorrat !== ghost.available || b.gueltig !== ghost.cursorValid || b.plan !== plan || b.werkzeug !== ghost.judgedTool || b.stand !== stand) {
          befund.value = { teil: ghost.judged, station, anker: ghost.plan.length / 2, setzbar: ghost.okCount, grund: ghost.firstReason, vorrat: ghost.available, gueltig: ghost.cursorValid, plan, werkzeug: ghost.judgedTool, stand };
        }
        const d = input?.lastDevice ?? 'keyboard';
        if (d !== geraet.peek()) geraet.value = d;
        s.verwerfeMeldung();
      }),
    [bridge, s, ghost, befund, geraet, oben, close],
  );

  // The ghost names the blueprint toggle with its key on the device used (the key follows the device and the language).
  const planGlyphe = glypheVon(bridge, i18n, 'blueprint');
  const planText = planHinweis(i18n, planGlyphe);
  useEffect(() => {
    ghost.planHint = planText;
  }, [ghost, planText]);

  // Undo steps follow what the simulation confirmed; refusals of the tools' commands show in the status line.
  useEffect(() => {
    const offs = [
      bridge.onEvent('partPlaced', (e) => s.verlauf.teilGesetzt(e)),
      bridge.onEvent('blueprintCompleted', (e) => s.verlauf.blaupauseFertig(e)),
      bridge.onEvent('partRemoved', (e) => s.verlauf.teilEntfernt(e)),
      bridge.onEvent('stationPlaced', (e) => s.verlauf.stationGesetzt(e)),
      bridge.onEvent('stationRemoved', (e) => s.verlauf.stationEntfernt(e)),
      bridge.onEvent('commandRejected', (e: SimEventMap['commandRejected']) => {
        if (s.werkzeug.peek() !== 'setzen' && bauBefehl(e.type)) s.melde(ablehnungsText(e.type, e.reason), undefined, true);
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [bridge, s]);

  const kategorie = s.kategorie.value;
  const suche = s.suche.value;
  const auswahl = s.auswahl.value;
  const katalog = s.katalog.value;
  const overlay = s.overlay.value;
  const drehung = s.drehung.value;
  const gespiegelt = s.gespiegelt.value;
  const blaupause = s.blaupause.value;
  const werkzeug = s.werkzeug.value;
  const wartet = s.bestaetigung.value;
  // A message that ran out is dropped by the frame (`verwerfeMeldung`), which renders the status line again.
  const meldung = s.meldung.value;
  const gewaehlt = s.eintrag(auswahl);
  const liste = suche.trim() === '' ? eintraegeDer(s.eintraege, kategorie) : sucheEintraege(s.eintraege, suche);
  const pad = geraet.value === 'gamepad';
  const glyphe = (action: Action): HinweisGlyphe | null => glypheVon(bridge, i18n, action);

  const name = (e: BauEintrag): string => e.name[lang];
  const katName = (k: BauKategorie): string => t(`ui.bau.kategorie.${k}`);

  // --- The tool's verdict: texts of the status line and over the cursor ----------------------------------------
  const b = befund.value;
  const werkzeugBefundJetzt: WerkzeugBefund | null = useMemo(
    () => (b.werkzeug === 'setzen' ? null : werkzeugBefund(ghost, gewaehlt !== undefined && gewaehlt.source === 'bauteil' ? gewaehlt.id : null)),
    // The ghost's targets change with its judgement count (`stand`); the chosen piece names the upgrade.
    [ghost, b.werkzeug, b.stand, gewaehlt?.id],
  );
  const werkzeugTexte = werkzeugBefundJetzt === null ? null : werkzeugText(i18n, werkzeugBefundJetzt);
  const label = werkzeug !== 'setzen' && werkzeugTexte !== null ? werkzeugTexte.label : null;
  useEffect(() => {
    ghost.toolLabel = label;
  }, [ghost, label]);

  // --- Status line --------------------------------------------------------------------------
  const letzteAblehnung = rejection !== null && rejection.tick >= openedTick && bauBefehl(rejection.type) ? rejection : null;
  /** The status: its text (`GLYPHE_PLATZ` … mark where the glyphs stand), warning colour, the plan's blue edge. */
  let status: { text: string; warnung: boolean; plan: boolean; glyphen: ReadonlyArray<HinweisGlyphe | null> } | null = null;
  if (werkzeug === 'abbauen' && wartet !== null) {
    status = { text: t('ui.bau.abbauen.bestaetigen', { count: wartet.befehle.length, ja: GLYPHE_PLATZ, nein: GLYPHE_PLATZ_2 }), warnung: true, plan: false, glyphen: [glyphe('attack'), glyphe('block')] };
  } else if (meldung !== null && performance.now() < meldung.bis) {
    const p = meldung.params;
    const params = p === undefined ? undefined : { ...p, ...(p.teil !== undefined ? { teil: s.eintrag(String(p.teil))?.name[lang] ?? itemName(i18n, String(p.teil)) } : {}), ...(p.werkzeug !== undefined ? { werkzeug: t(`ui.bau.werkzeug.${String(p.werkzeug)}`) } : {}) };
    status = { text: t(meldung.key, params), warnung: meldung.warnung, plan: false, glyphen: [] };
  } else if (werkzeug !== 'setzen') {
    if (werkzeugTexte !== null && b.werkzeug === werkzeug && b.gueltig) status = { text: werkzeugTexte.status, warnung: werkzeugTexte.warnung, plan: false, glyphen: [] };
  } else if (gewaehlt !== undefined && b.teil === gewaehlt.id && b.plan === blaupause && b.werkzeug === 'setzen' && b.gueltig && b.anker > 0) {
    if (b.setzbar === b.anker) {
      const frei = b.plan ? t('ui.bau.status.planFrei') : t('ui.bau.status.frei');
      status = { text: b.anker === 1 ? frei : t(b.plan ? 'ui.bau.status.planAlle' : 'ui.bau.status.alle', { gesamt: b.anker }), warnung: false, plan: b.plan, glyphen: [] };
    } else if (b.grund !== null) {
      // Stations are judged by the station system's rules (their own reasons), a missing item like a part; a part
      // missing in the bags can be planned (the toggle with its glyph), a station cannot.
      let glyphen: Array<HinweisGlyphe | null> = [];
      let grund: string;
      if (b.grund === 'notPlannable') grund = t('ui.bau.status.nichtPlanbar');
      else if (b.grund === 'noMaterial' && !b.station && !b.plan) {
        glyphen = [planGlyphe];
        grund = planGlyphe === null ? t('ui.bau.status.planHinweisSchalter') : t('ui.bau.status.planHinweis', { taste: GLYPHE_PLATZ });
      } else grund = t(b.station && b.grund !== 'noMaterial' ? `ui.station.reject.${b.grund}` : `ui.build.reject.${b.grund}`);
      const teils = b.plan ? 'ui.bau.status.planTeils' : 'ui.bau.status.teils';
      status = { text: b.setzbar > 0 ? t(teils, { setzbar: b.setzbar, gesamt: b.anker, grund }) : grund, warnung: b.setzbar === 0, plan: b.plan && b.setzbar > 0, glyphen };
    }
  } else if (letzteAblehnung !== null) {
    status = { text: t(ablehnungsText(letzteAblehnung.type, letzteAblehnung.reason)), warnung: true, plan: false, glyphen: [] };
  }

  // --- Hint line: the tool's gestures with glyphs -------------------------------------------------------------
  const hinweise = bauHinweise({ katalog, werkzeug, gewaehlt, pad, blaupause, wartet: wartet !== null });

  // --- Costs of the chosen piece --------------------------------------------------------------
  const kosten = gewaehlt === undefined ? null : bauKosten(gewaehlt.id);
  const kostenText =
    kosten === null
      ? null
      : t('ui.bau.kosten', {
          zutaten: kosten.zutaten.map((z) => t('ui.bau.zutat', { anzahl: z.anzahl, name: z.name[lang] })).join(', '),
          ort: kosten.station === null ? t('ui.bau.ort.hand') : (s.eintrag(kosten.station)?.name[lang] ?? kosten.station),
        });
  const stueck = gewaehlt === undefined ? 0 : vorrat(bags, gewaehlt.id);

  // The piece grid gives up a row while the panel would reach below the window (checked when its content changes).
  const passeZeilenAn = useCallback(() => {
    const el = leiste.current;
    if (el === null) return;
    const scale = Number.parseFloat(getComputedStyle(el).getPropertyValue(UI_SCALE_VAR));
    const n = teileZeilen(zeilen.peek(), el.getBoundingClientRect().bottom, window.innerHeight, Number.isFinite(scale) && scale > 0 ? scale : 1);
    if (n !== zeilen.peek()) zeilen.value = n;
  }, [zeilen]);
  useLayoutEffect(passeZeilenAn, [passeZeilenAn, auswahl, drehung, gespiegelt, lang, stueck === 0, suche, kategorie, zeilen.value]);
  // The hint line stays one row: the hints of the lowest priority give way first (`verborgeneHinweise`).
  const hinweisSchluessel = hinweise.map((h) => `${h.action}:${h.key}`).join('|');
  const passeHinweiseAn = useCallback(() => {
    const el = hinweisZeile.current;
    if (el === null) return;
    const kinder = [...el.children] as HTMLElement[];
    for (const k of kinder) k.removeAttribute('data-verborgen');
    const scale = Number.parseFloat(getComputedStyle(el).getPropertyValue(UI_SCALE_VAR));
    const px = Number.isFinite(scale) && scale > 0 ? scale : 1;
    // Room for the hints: the bottom column and, where the panel ends above the line, the width under the panel
    // (M5-37), less the line's own frame and padding.
    const stil = getComputedStyle(el);
    const rand = el.offsetWidth - el.clientWidth + Number.parseFloat(stil.paddingLeft) + Number.parseFloat(stil.paddingRight);
    const spalte = el.parentElement?.clientWidth ?? el.clientWidth;
    const tafel = leiste.current?.getBoundingClientRect();
    const raum = hinweisRaum({ spalte, unterTafel: tafel === undefined ? 0 : UNTER_TAFEL * px, tafelUnten: tafel?.bottom ?? Number.POSITIVE_INFINITY, zeileOben: el.getBoundingClientRect().top, luft: HINWEIS_LUFT * px });
    const breiten = kinder.map((k) => k.getBoundingClientRect().width);
    const aus = verborgeneHinweise(hinweise, breiten, HINWEIS_ABSTAND * px, raum - rand);
    kinder.forEach((k, i) => {
      if (aus.has(i)) k.setAttribute('data-verborgen', '');
    });
    // The part of the line beyond the column runs on under the panel (bau.css `--dh-bau-hinweis-ueber`).
    el.style.setProperty(HINWEIS_UEBER_VAR, `${hinweisUeberstand(breiten, aus, HINWEIS_ABSTAND * px, rand, spalte)}px`);
    // The hints change exactly when their keys do; the panel's height with its rows, the chosen piece and its costs.
  }, [hinweisSchluessel]);
  useLayoutEffect(passeHinweiseAn, [passeHinweiseAn, lang, pad, blaupause, zeilen.value, auswahl, kostenText, katalog]);
  useEffect(() => {
    const resize = (): void => {
      passeZeilenAn();
      passeHinweiseAn();
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [passeZeilenAn, passeHinweiseAn]);

  return (
    <div ref={wurzel} class="dh-kit dh-bau" style={tokens} data-testid="baumodus" data-katalog={katalog ? '' : undefined} data-werkzeug={werkzeug} role="region" aria-label={t('ui.bau.titel')} onContextMenu={(e) => e.preventDefault()}>
      <div class="dh-bau__links">
        <div class="dh-bau__zeile dh-bau__overlays dh-hud-platte" role="group" aria-label={t('ui.bau.overlay.titel')}>
          <span class="dh-bau__overlaytitel">{t('ui.bau.overlay.titel')}</span>
          {BUILD_OVERLAYS.map((o) => (
            <button type="button" key={o} class={`dh-bau__schalter${overlay === o ? ' dh-bau__schalter--an' : ''}`} data-fokus="" data-overlay={o} data-tipp={`overlay:${o}`} data-testid={`bau-overlay-${o}`} aria-pressed={overlay === o} aria-label={t(`ui.bau.overlay.${o}.name`)} onClick={() => s.schalteOverlay(o)}>
              {t(`ui.bau.overlay.${o}.kurz`)}
            </button>
          ))}
        </div>
        {overlay !== null ? <BauLegende i18n={i18n} kind={overlay} /> : null}
      </div>
      <div ref={leiste} class="dh-bau__rahmen">
        <div class="dh-bau__leiste dh-hud-platte" data-testid="bau-leiste">
          <div class="dh-bau__kategorien" role="tablist" aria-label={t('ui.bau.kategorien')}>
            {s.kategorien.map((k) => {
              const erstes = eintraegeDer(s.eintraege, k)[0];
              const icon = erstes === undefined ? null : itemIconUrl(erstes.id);
              const gezeigt = suche.trim() === '' && k === kategorie;
              return (
                <button type="button" key={k} role="tab" class={`dh-bau__tab${gezeigt ? ' dh-bau__tab--aktiv' : ''}`} aria-selected={gezeigt} aria-label={katName(k)} data-fokus="" data-kategorie={k} data-tipp={`kategorie:${k}`} data-testid={`bau-kategorie-${k}`} onClick={() => s.zeigeKategorie(k)}>
                  {icon !== null ? <img src={icon} alt="" draggable={false} /> : <span aria-hidden="true">{katName(k).slice(0, 1)}</span>}
                </button>
              );
            })}
            <SucheFeld i18n={i18n} steuerung={s} treffer={suche.trim() === '' ? null : liste.length} />
          </div>
          <div class="dh-bau__titelzeile">
            <div class="dh-bau__titel" data-testid="bau-titel">
              {suche.trim() === '' ? katName(kategorie) : t('ui.bau.suche.ergebnis')}
            </div>
            <button
              type="button"
              class={`dh-bau__schalter dh-bau__planschalter${blaupause ? ' dh-bau__planschalter--an' : ''}`}
              data-fokus=""
              data-tipp="blaupause"
              data-testid="bau-blaupause"
              aria-pressed={blaupause}
              aria-label={t('ui.bau.blaupause.titel')}
              onClick={() => s.schalteBlaupause()}
            >
              {t('ui.bau.blaupause.schalter')}
            </button>
          </div>
          <ScrollArea height={teileHoehe(zeilen.value)} zeile={SLOT_PX + SLOT_ABSTAND} labelHoch={t('ui.bau.teile.hoch')} labelRunter={t('ui.bau.teile.runter')}>
            <div class="dh-bau__teile" role="listbox" aria-label={t('ui.bau.teile')} style={{ gridTemplateColumns: `repeat(${TEILE_SPALTEN}, ${uiPx(SLOT_PX)})`, columnGap: uiPx(SLOT_ABSTAND), rowGap: uiPx(SLOT_ABSTAND) }} data-testid="bau-teile">
              {liste.length === 0 ? <span class="dh-bau__leer">{t('ui.bau.suche.leer', { text: suche.trim() })}</span> : null}
              {liste.map((e) => {
                const n = vorrat(bags, e.id);
                const icon = itemIconUrl(e.id);
                return (
                  <Slot
                    key={e.id}
                    class={`dh-bau__teil${n === 0 ? ' dh-bau__teil--fehlt' : ''}`}
                    label={t('ui.bau.teil', { name: name(e), anzahl: n })}
                    aktiv={e.id === auswahl}
                    anzahl={n}
                    data-fokus=""
                    data-teil={e.id}
                    data-tipp={`teil:${e.id}`}
                    data-testid={`bau-teil-${e.id}`}
                    onClick={() => {
                      s.nimm(e.id);
                      if (s.katalog.peek()) s.setzeKatalog(false, bridge.input);
                    }}
                  >
                    {icon !== null ? <img class="dh-bau__icon" src={icon} alt="" draggable={false} /> : <span class="dh-bau__initiale">{name(e).slice(0, 1)}</span>}
                  </Slot>
                );
              })}
            </div>
          </ScrollArea>
          <div class="dh-bau__info" data-testid="bau-info">
            {gewaehlt !== undefined ? (
              <>
                {/* Name, rotation or mirror and stock flow in one line and wrap where they must (the stock to the right). */}
                <span class="dh-bau__kopf">
                  <span class="dh-bau__name">{name(gewaehlt)}</span>
                  {drehung !== 0 && gewaehlt.drehbar ? <span class="dh-bau__zustand">{t('ui.bau.gedreht', { grad: drehung * 90 })}</span> : null}
                  {gespiegelt && gewaehlt.spiegelbar ? <span class="dh-bau__zustand">{t('ui.bau.gespiegelt')}</span> : null}
                  <span class={`dh-bau__vorrat${stueck === 0 ? ' dh-bau__vorrat--fehlt' : ''}`} data-testid="bau-vorrat">
                    {stueck === 0 ? t('ui.bau.vorrat.keins') : t('ui.bau.vorrat.stueck', { count: stueck })}
                  </span>
                </span>
                <span class="dh-bau__kosten" data-testid="bau-kosten">{kostenText ?? t('ui.bau.kostenFund')}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <div class="dh-bau__unten">
        <BlaupausenZeile i18n={i18n} bridge={bridge} />
        {status !== null ? (
          <div
            class={`dh-bau__status dh-hud-platte${status.warnung ? ' dh-bau__status--warnung' : status.plan ? ' dh-bau__status--plan' : ''}`}
            role="status"
            data-testid="bau-status"
            data-warnung={status.warnung ? '' : undefined}
            data-plan={status.plan ? '' : undefined}
          >
            {glyphenText(status.text, status.glyphen)}
          </div>
        ) : null}
        <Werkzeugleiste i18n={i18n} werkzeug={werkzeug} glyphe={glyphe} pad={pad} waehle={(tool) => s.waehleWerkzeug(tool, bridge.state.bags.peek())} beenden={close} />
        <div ref={hinweisZeile} class="dh-bau__hinweise dh-hud-platte" data-testid="bau-hinweise" data-werkzeug={werkzeug}>
          {hinweise.map((h) => {
            const g = glyphe(h.action);
            return (
              <span class={`dh-bau__hinweis${h.an ? ' dh-bau__hinweis--an' : ''}`} key={`${h.action}:${h.key}`} data-aktion={h.action} data-an={h.an ? '' : undefined}>
                {g !== null ? <HinweisGlyph glyphe={g} /> : null}
                <span>{t(h.key)}</span>
              </span>
            );
          })}
        </div>
      </div>
      {katalog ? <KatalogFokus focus={focus} leiste={leiste} steuerung={s} bridge={bridge} /> : null}
      <KatalogOeffner bridge={bridge} steuerung={s} oben={oben} />
      <BauTipp i18n={i18n} focus={focus} root={wurzel} eintraege={s.eintraege} />
    </div>
  );
}

/** A status text with the glyphs of its keys where the private-use marks stand. */
function glyphenText(text: string, glyphen: ReadonlyArray<HinweisGlyphe | null>) {
  return text.split(GLYPHEN_TRENNER).map((teil, i) => {
    const g = teil === GLYPHE_PLATZ ? glyphen[0] : teil === GLYPHE_PLATZ_2 ? glyphen[1] : undefined;
    if (g === undefined) return <Fragment key={i}>{teil}</Fragment>;
    return g === null ? null : <HinweisGlyph key={i} glyphe={g} class="dh-bau__status-glyphe" />;
  });
}

/** The search field (a pixel text field; typing does not steer the player, Esc and Enter leave it). */
function SucheFeld({ i18n, steuerung, treffer }: { readonly i18n: I18n; readonly steuerung: BauSteuerung; readonly treffer: number | null }) {
  const t = i18n.t;
  return (
    <label class="dh-bau__suche" data-testid="bau-suchfeld">
      <span class="dh-bau__lupe" aria-hidden="true" />
      <input
        type="text"
        class="dh-bau__eingabe"
        value={steuerung.suche.value}
        placeholder={t('ui.bau.suche.platzhalter')}
        aria-label={t('ui.bau.suche.label')}
        data-fokus=""
        data-testid="bau-suche"
        spellcheck={false}
        autocomplete="off"
        onInput={(e) => steuerung.setzeSuche((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          const el = e.currentTarget as HTMLInputElement;
          if (e.key === 'Escape') {
            if (el.value !== '') steuerung.setzeSuche('');
            el.blur();
            e.preventDefault();
          } else if (e.key === 'Enter') {
            const erster = sucheEintraege(steuerung.eintraege, el.value)[0];
            if (erster !== undefined) steuerung.nimm(erster.id);
            el.blur();
            e.preventDefault();
          }
        }}
      />
      {treffer !== null ? (
        <span class="dh-bau__treffer" data-testid="bau-treffer">
          {t('ui.bau.suche.treffer', { count: treffer })}
        </span>
      ) : null}
    </label>
  );
}

/** Opens the selection by keys (Tab/I, D-pad up) while placing – read after the frame's placing input. */
function KatalogOeffner({ bridge, steuerung, oben }: { readonly bridge: UiBridge; readonly steuerung: BauSteuerung; readonly oben: () => boolean }) {
  useEffect(
    () =>
      bridge.onFrame(() => {
        const input = bridge.input;
        if (input === null || !oben() || steuerung.katalog.peek()) return;
        if (input.wasPressedAnyContext('inventory')) steuerung.setzeKatalog(true, input);
      }),
    [bridge, steuerung, oben],
  );
  return null;
}

/** Focus navigation of the bar while the selection is open (tabs, search, slots, overlay switches, tools). */
function KatalogFokus({ focus, leiste, steuerung, bridge }: { readonly focus: FocusManager; readonly leiste: RefObject<HTMLDivElement>; readonly steuerung: BauSteuerung; readonly bridge: UiBridge }) {
  const root = useRef<HTMLElement | null>(null);
  // The scope is the whole build mode (bar, overlay switches and the tool bar).
  useLayoutEffect(() => {
    root.current = leiste.current?.closest('.dh-bau') ?? null;
  }, [leiste]);
  useFocusScope(focus, root as RefObject<HTMLElement>, {
    initial: () => focusable(leiste, `[data-teil="${steuerung.auswahl.peek() ?? ''}"]`) ?? focusable(leiste, '[data-teil]'),
    onAction(action: NavAction, focused: FocusElement | null): boolean {
      if (action === 'next' || action === 'prev') {
        steuerung.blaettere(action === 'next' ? 1 : -1);
        return true;
      }
      // A tool taken with Enter (A) returns to the world like a piece.
      if (action === 'confirm' && focused instanceof HTMLElement && focused.dataset['werkzeug'] !== undefined) {
        steuerung.waehleWerkzeug(focused.dataset['werkzeug'] as BuildTool, bridge.state.bags.peek());
        steuerung.setzeKatalog(false, bridge.input);
        return true;
      }
      return false;
    },
    onBack: () => steuerung.setzeKatalog(false, bridge.input),
  });
  useEffect(() => {
    focus.keysUsed();
    focus.focusInitial();
  }, [focus]);
  return null;
}
