/**
 * Upper left of the HUD (MASTERPROMPT §26 "oben links Leben, Ausdauer, Sättigung, Durst, Thermometer mit
 * Trend, Furcht-Auge (ab 20); Zustandssymbole mit Timer"; M3-27):
 *
 * - a dark plate with the four bars of the UI kit (fill per value, whole pixels), each with its symbol;
 * - a plate with the thermometer: glass sprite over the dark channel and the liquid of the core temperature
 *   in the colour of its stage, the trend arrow beside it at the height of the liquid;
 * - the fear eye on its own plate from fear 20, one frame per stage;
 * - the active conditions in content order: icon `zustand_<id>` (critical ones pulse unless motion is
 *   reduced), stacks, timer.
 * Every display fades by the steps of `HudSteuerung` (contextual and minimal modes) and opens a tooltip
 * on hover; the accessible names say the values in words.
 */
import type { ReadonlySignal } from '@preact/signals';
import type { ConditionDef } from '../../content/conditions';
import { conditionIconId } from '../../content/conditions';
import { contentConditionCatalog, type ConditionCatalog } from '../../game/conditions/catalog';
import type { I18n } from '../../i18n';
import type { UiBridge } from '../bridge';
import { Bar } from '../kit';
import { uiPx } from '../kit/geometry';
import { HudBild } from './Bild';
import { fuellVar } from './farben';
import { furchtSichtbar, HUD_LEISTEN, zustandSichtbar, type HudLeiste, type HudMode } from './modus';
import type { HudSteuerung } from './steuerung';
import { fuellHoehe, pfeilOben, THERMO, TREND_B, TREND_H, trendFrame, trendStufe } from './thermometer';
import { furchtLabel, furchtTooltip, leistenLabel, leistenTooltip, thermoLabel, thermoTooltip, zustandsLabel, zustandsTooltip, zustandsZeit, type ThermoWerte } from './texte';
import { useHudTooltip, type HudTooltipSlot } from './Tooltip';

/** Maximum of satiety and thirst (§11.1 "0–100"). */
const MAX_WERT = 100;
/** Width of a bar including its frame [design px]. */
export const LEISTE_BREITE = 64;
/** Symbol of each bar (assets-src/sprites/ui/hud.ts, 9×8). */
const LEISTEN_SYMBOL: Readonly<Record<HudLeiste, string>> = {
  leben: 'ui_hud_leben',
  ausdauer: 'ui_hud_ausdauer',
  saettigung: 'ui_hud_saettigung',
  durst: 'ui_hud_durst',
};
const SYMBOL_B = 9;
const SYMBOL_H = 8;
/** The fear eye (15×9, one frame per stage from `unruhig`). */
const AUGE_SPRITE = 'ui_hud_furcht';
const AUGE_B = 15;
const AUGE_H = 9;
const FURCHT_FRAME = { ruhig: 0, unruhig: 0, fluestern: 1, trugbilder: 2, bedrohlich: 3, nachtmahr: 4 } as const;
/** Trend arrow (7×8). */
const TREND_SPRITE = 'ui_hud_trend';
/** Condition icons [design px] (docs/ART.md §3). */
const ZUSTAND_PX = 16;

export interface HudWerteProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly steuerung: HudSteuerung;
  readonly modus: HudMode;
  readonly tooltip: HudTooltipSlot;
  readonly bewegungReduziert: boolean;
  readonly zustaende?: ConditionCatalog;
}

function stufeAttr(s: number): string {
  return String(s);
}

function Leiste({ i18n, bridge, art, stufe, tooltip }: { i18n: I18n; bridge: UiBridge; art: HudLeiste; stufe: ReadonlySignal<number>; tooltip: HudTooltipSlot }) {
  const p = bridge.state.player;
  const [wert, max] = art === 'leben' ? [p.health, p.maxHealth] : art === 'ausdauer' ? [p.stamina, p.maxStamina] : art === 'saettigung' ? [p.satiety, null] : [p.thirst, null];
  const s = stufe.value;
  const handler = useHudTooltip(tooltip, () => leistenTooltip(i18n, art, wert.value, max?.value ?? MAX_WERT));
  if (s === 0) return null;
  const v = wert.value;
  const m = max?.value ?? MAX_WERT;
  return (
    <div class="dh-hud-wert" data-stufe={stufeAttr(s)} data-testid={`hud-wert-${art}`} data-wert={Math.floor(v)} {...handler}>
      <HudBild id={LEISTEN_SYMBOL[art]} breite={SYMBOL_B} hoehe={SYMBOL_H} />
      <Bar art={art} value={v} max={m} width={LEISTE_BREITE} label={leistenLabel(i18n, art, v, m)} />
    </div>
  );
}

function Thermometer({ i18n, bridge, tooltip, stufe }: { i18n: I18n; bridge: UiBridge; tooltip: HudTooltipSlot; stufe: number }) {
  const p = bridge.state.player;
  const werte = (): ThermoWerte => ({
    coreC: p.coreC.value,
    feltC: p.feltC.value,
    bandLowC: p.bandLowC.value,
    bandHighC: p.bandHighC.value,
    ambientC: p.ambientC.value,
    heatC: p.heatC.value,
    roomC: p.roomC.value,
    wetness: p.wetness.value,
    stage: p.temperatureStage.value,
    trend: trendStufe(p.coreRateCps.value),
  });
  const handler = useHudTooltip(tooltip, () => thermoTooltip(i18n, werte()));
  const w = werte();
  const h = fuellHoehe(w.coreC);
  const frame = trendFrame(w.trend);
  const r = THERMO.rinne;
  const k = THERMO.kugel;
  const farbe = `var(${fuellVar(w.stage)})`;
  return (
    <div class="dh-hud-thermo" data-stufe={stufeAttr(stufe)} data-testid="hud-thermometer" data-temperatur-stufe={w.stage} data-trend={w.trend} data-fuellung={h} role="img" aria-label={thermoLabel(i18n, w)} {...handler}>
      <span class="dh-hud-thermo__glas" style={{ width: uiPx(THERMO.breite), height: uiPx(THERMO.hoehe) }}>
        <span class="dh-hud-thermo__rinne" style={{ left: uiPx(r.x), top: uiPx(r.y), width: uiPx(r.breite), height: uiPx(r.hoehe) }} />
        {h > 0 ? <span class="dh-hud-thermo__saeule" style={{ left: uiPx(r.x), top: uiPx(r.y + r.hoehe - h), width: uiPx(r.breite), height: uiPx(h), background: farbe }} /> : null}
        <span class="dh-hud-thermo__saeule" style={{ left: uiPx(k.x), top: uiPx(k.y), width: uiPx(k.breite), height: uiPx(k.hoehe), background: farbe }} />
        <HudBild id={THERMO.sprite} breite={THERMO.breite} hoehe={THERMO.hoehe} class="dh-hud-thermo__bild" />
      </span>
      <span class="dh-hud-thermo__trend" style={{ width: uiPx(TREND_B), height: uiPx(TREND_H), marginTop: uiPx(pfeilOben(w.coreC)) }}>
        {frame !== null ? <HudBild id={TREND_SPRITE} frame={frame} breite={TREND_B} hoehe={TREND_H} /> : null}
      </span>
    </div>
  );
}

function FurchtAuge({ i18n, bridge, tooltip }: { i18n: I18n; bridge: UiBridge; tooltip: HudTooltipSlot }) {
  const hud = bridge.state.hud;
  const stage = hud.fearStage.value;
  const handler = useHudTooltip(tooltip, () => furchtTooltip(i18n, hud.fear.value, hud.fearStage.value));
  if (!furchtSichtbar(stage)) return null;
  return (
    <div class="dh-hud-platte dh-hud-furcht" data-testid="hud-furcht" data-furcht-stufe={stage} role="img" aria-label={furchtLabel(i18n, hud.fear.value, stage)} {...handler}>
      <HudBild id={AUGE_SPRITE} frame={FURCHT_FRAME[stage]} breite={AUGE_B} hoehe={AUGE_H} />
    </div>
  );
}

function Zustand({ i18n, def, stacks, seconds, tooltip, puls }: { i18n: I18n; def: ConditionDef; stacks: number; seconds: number; tooltip: HudTooltipSlot; puls: boolean }) {
  const handler = useHudTooltip(tooltip, () => zustandsTooltip(i18n, def, stacks, seconds));
  const zeit = zustandsZeit(i18n, seconds);
  const icon = conditionIconId(def.id);
  return (
    <li class={`dh-hud-zustand dh-hud-zustand--${def.art}`} data-testid={`hud-zustand-${def.id}`} data-zeit={seconds} aria-label={zustandsLabel(i18n, def, stacks, seconds)} {...handler}>
      <span class="dh-hud-zustand__icon" style={{ width: uiPx(ZUSTAND_PX), height: uiPx(ZUSTAND_PX) }}>
        <HudBild id={icon} breite={ZUSTAND_PX} hoehe={ZUSTAND_PX} />
        {puls ? <HudBild id={icon} frame={1} breite={ZUSTAND_PX} hoehe={ZUSTAND_PX} class="dh-hud-zustand__puls" /> : null}
        {stacks > 1 ? (
          <span class="dh-hud-zustand__stapel" aria-hidden="true">
            {stacks}
          </span>
        ) : null}
      </span>
      <span class="dh-hud-zustand__zeit" aria-hidden="true">
        {zeit}
      </span>
    </li>
  );
}

export function HudWerte({ i18n, bridge, steuerung, modus, tooltip, bewegungReduziert, zustaende = contentConditionCatalog() }: HudWerteProps) {
  const thermoStufe = steuerung.stufe('thermo').value;
  const leisten = HUD_LEISTEN.filter((a) => steuerung.stufe(a).value > 0);
  const liste = bridge.state.hud.conditions.value;
  const sichtbar = liste.filter((c) => {
    const def = zustaende.find(c.id);
    return def !== undefined && zustandSichtbar(modus, def.art);
  });
  return (
    <div class="dh-hud-oben">
      <div class="dh-hud-oben__reihe">
        {leisten.length > 0 ? (
          <div class="dh-hud-platte dh-hud-werte" role="group" aria-label={i18n.t('ui.hud.werte.label')} data-testid="hud-werte">
            {leisten.map((art) => (
              <Leiste key={art} i18n={i18n} bridge={bridge} art={art} stufe={steuerung.stufe(art)} tooltip={tooltip} />
            ))}
          </div>
        ) : null}
        {thermoStufe > 0 ? (
          <div class="dh-hud-platte dh-hud-thermo-platte">
            <Thermometer i18n={i18n} bridge={bridge} tooltip={tooltip} stufe={thermoStufe} />
          </div>
        ) : null}
        <FurchtAuge i18n={i18n} bridge={bridge} tooltip={tooltip} />
      </div>
      {sichtbar.length > 0 ? (
        <ul class="dh-hud-zustaende" aria-label={i18n.t('ui.hud.zustaende.label')} data-testid="hud-zustaende">
          {sichtbar.map((c) => {
            const def = zustaende.get(c.id);
            return <Zustand key={c.id} i18n={i18n} def={def} stacks={c.stacks} seconds={c.seconds} tooltip={tooltip} puls={def.art === 'kritisch' && !bewegungReduziert} />;
          })}
        </ul>
      ) : null}
    </div>
  );
}
