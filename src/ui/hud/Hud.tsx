/**
 * The HUD of the running game (MASTERPROMPT §26 "HUD (Modi: Voll / Kontextuell / Minimal)"; M3-27): upper
 * left the survival values, thermometer, fear eye and conditions (`Werte.tsx`), bottom centre off-hand,
 * hotbar and belt (`Schnellleiste.tsx`) with the interaction hint above (`Hinweis.tsx`), upper right the
 * minimap with day disc and the compass bar, bottom left the notifications (M3-28/M3-29,
 * `minimap/Weltanzeigen.tsx`). The right-hand tracker of §26 (quests, pinned recipe) has no data yet –
 * the pinned recipe comes with crafting (M4-08) – so nothing is drawn there.
 *
 * - Shown while the player exists; hidden under open screens (inventory, pause menu) and while the player
 *   lies dead, except the notifications; not built in screenshot scenarios that do not ask for it (`SZENARIO_SEITE`). The mode, text size and reduced motion come from the settings (`game.hudMode`,
 *   `accessibility.textScale`, `accessibility.reducedMotion`); screenshot scenarios can set a mode
 *   (`hudVorgabe`), which also keeps the HUD visible in screenshot mode.
 * - Once per rendered frame (the bridge's `onFrame`) `HudSteuerung` updates the fade steps and the HUD
 *   notes the input device for the key glyphs. Reads bridge signals, writes only commands (hotbar click).
 */
import { signal, useSignal } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { defaultSettings, type Settings, type SettingsStore } from '../../engine/settings';
import type { I18n, Lang } from '../../i18n';
import type { UiBridge } from '../bridge';
import { activeGameScreens } from '../focus/GameScreens';
import { ensureAtlasImages } from '../screens/inventar/itemIcons';
import { hudTokens } from './farben';
import { HudHinweis } from './Hinweis';
import { geraetepixelAm, textFaktor } from './meldungen/textgroesse';
import { HudWeltanzeigen, type HudWeltdienste } from './minimap/Weltanzeigen';
import { hinweisSichtbar, type HudMode } from './modus';
import { HudSchnellleiste, type HudGeraet } from './Schnellleiste';
import { HudSteuerung } from './steuerung';
import { createTooltipSlot, HudTooltip } from './Tooltip';
import { HudWerte } from './Werte';
import './hud.css';

/** A mode set by a screenshot scenario; the HUD then also shows in screenshot mode. */
export interface HudVorgabe {
  readonly modus: HudMode;
}

/** The scenario's mode (`null` in the game). */
export const hudVorgabe = signal<HudVorgabe | null>(null);

/**
 * Whether the page's HUD shows the interaction hint now: the HUD is visible (the UI layer is not hidden for a
 * screenshot – `uiSichtbar` –, or a scenario asks for the HUD, `hudVorgabe`) and its mode shows the hint (Voll,
 * Kontextuell). The world marker over the target then shows only the key cap: the text is not drawn twice.
 */
export function hudZeigtHinweis(uiSichtbar: boolean, einstellung: HudMode): boolean {
  const vorgabe = hudVorgabe.peek();
  return (uiSichtbar || vorgabe !== null) && hinweisSichtbar(vorgabe?.modus ?? einstellung);
}

/**
 * Whether the page runs a screenshot scenario (`?scenario=`). Scenarios run in screenshot mode, which hides
 * the page's HUD (§31.6); unless a scenario asks for the HUD (`hudVorgabe`), it is not built at all – the
 * scenarios of single HUD parts (minimap, notifications) then have the only such part in the document.
 */
const SZENARIO_SEITE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('scenario');

/** The mounted HUD's bridge and world displays (scenarios wait on its signals, clear its notifications), or `null`. */
let aktiv: { readonly bridge: UiBridge; readonly welt: HudWeltdienste | null } | null = null;

export function aktiveHudBruecke(): UiBridge | null {
  return aktiv?.bridge ?? null;
}

export function aktiveHudWelt(): HudWeltdienste | null {
  return aktiv?.welt ?? null;
}

export interface HudProps {
  readonly i18n: I18n;
  readonly lang: Lang;
  readonly bridge: UiBridge;
  /** Settings of the game (mode, text size, reduced motion); without them: defaults. */
  readonly settings?: SettingsStore;
  /** Minimap, compass bar and notifications of the session (`hudWeltdienste`), if the page created them. */
  readonly welt?: HudWeltdienste | null;
}

/** The settings of `store` as state that follows its changes. */
function useEinstellungen(store: SettingsStore | undefined): Settings {
  const [s, setS] = useState<Settings>(() => store?.get() ?? defaultSettings());
  useEffect(() => store?.subscribe((next) => setS(next)), [store]);
  return s;
}

export function Hud({ i18n, lang, bridge, settings, welt = null }: HudProps) {
  const einst = useEinstellungen(settings);
  const vorgabe = hudVorgabe.value;
  const modus = vorgabe?.modus ?? einst.game.hudMode;
  const reduziert = einst.accessibility.reducedMotion;
  const steuerung = useMemo(() => new HudSteuerung(), []);
  steuerung.modus = modus;
  steuerung.bewegungReduziert = reduziert;
  const tooltip = useMemo(() => createTooltipSlot(), []);
  const geraet = useSignal<HudGeraet>({ gamepad: false, familie: 'generic' });
  const verdeckt = useSignal(false);
  const tokens = useMemo(() => hudTokens(), []);
  const root = useRef<HTMLDivElement>(null);
  const present = bridge.state.player.present.value;

  useEffect(() => ensureAtlasImages(), []);
  useEffect(() => {
    const eintrag = { bridge, welt };
    aktiv = eintrag;
    return () => {
      if (aktiv === eintrag) aktiv = null;
    };
  }, [bridge, welt]);
  useEffect(
    () =>
      bridge.onFrame(() => {
        steuerung.frame(bridge.state);
        const input = bridge.input;
        if (input !== null) {
          const gamepad = input.lastDevice === 'gamepad';
          const familie = input.gamepadFamily;
          const g = geraet.peek();
          if (g.gamepad !== gamepad || g.familie !== familie) geraet.value = { gamepad, familie };
        }
        // Hidden under open screens and while the player lies dead (the death screen explains what happened).
        const offen = (activeGameScreens()?.controller.stack.peek().length ?? 0) > 0 || bridge.state.player.health.peek() <= 0;
        if (offen !== verdeckt.peek()) verdeckt.value = offen;
      }),
    [bridge, steuerung, geraet, verdeckt],
  );
  // Text size in whole screen pixels per font pixel (like the notifications, §29 "Textgröße").
  useLayoutEffect(() => {
    const el = root.current;
    if (el === null) return;
    const setzen = (): void => {
      el.style.setProperty('--dh-hud-text', String(textFaktor(geraetepixelAm(el, window.devicePixelRatio), einst.accessibility.textScale)));
    };
    setzen();
    const obs = new ResizeObserver(setzen);
    obs.observe(el);
    return () => obs.disconnect();
  }, [present, einst.accessibility.textScale]);

  if (!present || (SZENARIO_SEITE && vorgabe === null)) return null;
  return (
    <div
      ref={root}
      class={`dh-kit dh-hud${verdeckt.value ? ' dh-hud--verdeckt' : ''}${vorgabe === null ? '' : ' dh-hud--standbild'}`}
      data-modus={modus}
      data-testid="hud"
      role="region"
      aria-label={i18n.t('ui.hud.label')}
      style={vorgabe === null ? tokens : { ...tokens, visibility: 'visible' }}
    >
      {welt !== null ? (
        <HudWeltanzeigen i18n={i18n} lang={lang} takt={bridge} dienste={welt} kompass={einst.game.compassBar} textgroesse={einst.accessibility.textScale} bewegungReduziert={reduziert} />
      ) : null}
      <HudWerte i18n={i18n} bridge={bridge} steuerung={steuerung} modus={modus} tooltip={tooltip} bewegungReduziert={reduziert || vorgabe !== null} />
      {hinweisSichtbar(modus) ? <HudHinweis i18n={i18n} bridge={bridge} geraet={geraet} /> : null}
      <HudSchnellleiste i18n={i18n} bridge={bridge} stufe={steuerung.stufe('schnellleiste')} geraet={geraet} tooltip={tooltip} />
      <HudTooltip slot={tooltip} />
    </div>
  );
}
