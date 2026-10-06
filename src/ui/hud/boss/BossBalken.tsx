/**
 * The boss bar and title card of the HUD (MASTERPROMPT §20.2 "Intro-Titelkarte, Bosslebensbalken mit Phasenmarken", §26; docs/SPIEL.md
 * §30; M7-32): top centre while a boss is awake – its name over a wide health bar with a notch where each further phase begins
 * (passed notches dim) and the phase number; for the three seconds after it wakes, a title card across the middle of the screen
 * (the boss's title over the land it guards). Sampled every frame from the session (`sampleBoss`, a held record) and re-rendered
 * only when what it shows changes. Hidden under open screens like the rest of the HUD.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import type { I18n } from '../../../i18n';
import { createBossSample } from '../../../game/samples/leuchtfeuer';
import type { UiBridge } from '../../bridge';
import { uiPx } from '../../kit/geometry';
import { Bar, barInnerWidth } from '../../kit/widgets';
import { bossAnsicht, gleicheAnsicht, type BossAnsicht } from './modell';
import './boss.css';

/** Width of the boss's health bar [design px]: wide like the screen's top third, the boss above everything. */
const BALKEN_PX = 200;
/** Left inset of the bar's fill inside its frame [design px]. */
const RAND_PX = (BALKEN_PX - barInnerWidth(BALKEN_PX)) / 2;

/** Position of a phase mark on the bar [design px from its left edge]. */
function markePx(anteil: number): number {
  return Math.round(RAND_PX + anteil * barInnerWidth(BALKEN_PX));
}

/** What the boss bar reads of the bridge: the boss sample, the simulation's tick, the frame clock (`UiBridge` has all three). */
export interface HudBossQuelle {
  readonly leuchtfeuer: Pick<NonNullable<UiBridge['leuchtfeuer']>, 'sampleBoss'> | null;
  readonly state: { readonly tick: { peek(): number } };
  onFrame(listener: () => void): () => void;
}

export interface HudBossProps {
  readonly i18n: I18n;
  readonly bridge: HudBossQuelle;
}

export function HudBoss({ i18n, bridge }: HudBossProps) {
  const ansicht = useSignal<BossAnsicht | null>(null);
  const sample = useMemo(() => createBossSample(), []);
  useEffect(() => {
    const quelle = bridge.leuchtfeuer;
    if (quelle === null) return undefined;
    const lesen = (): void => {
      quelle.sampleBoss(sample);
      const neu = bossAnsicht(sample, bridge.state.tick.peek(), i18n.lang);
      if (!gleicheAnsicht(neu, ansicht.peek())) ansicht.value = neu;
    };
    lesen();
    return bridge.onFrame(lesen);
  }, [bridge, i18n, sample, ansicht]);
  const a = ansicht.value;
  if (a === null) return null;
  const t = i18n.t;
  return (
    <>
      <section class="dh-hud-boss" data-testid="hud-boss" data-boss={a.boss} data-phase={a.phase} aria-label={t('ui.boss.leben', { name: a.name, leben: a.leben, max: a.max })}>
        <p class="dh-hud-boss__kopf">
          <span class="dh-hud-boss__name">{a.name}</span>
          <span class="dh-hud-boss__phase">{t('ui.boss.phase', { phase: a.phase })}</span>
        </p>
        <div class="dh-hud-boss__balken">
          <Bar art="leben" value={a.leben} max={a.max} width={BALKEN_PX} label={t('ui.boss.leben', { name: a.name, leben: a.leben, max: a.max })} />
          {a.marken.map((m) => (
            <span key={m.anteil} class={`dh-hud-boss__marke${m.erreicht ? ' dh-hud-boss__marke--erreicht' : ''}`} style={{ left: uiPx(markePx(m.anteil)) }} aria-hidden="true" />
          ))}
        </div>
      </section>
      {a.titelkarte === null ? null : (
        <div class="dh-hud-boss-titel" data-testid="hud-boss-titel" role="status">
          <p class="dh-hud-boss-titel__oben">{t('ui.boss.titel.oben', { biom: a.titelkarte.biom })}</p>
          <h1 class="dh-hud-boss-titel__name">{a.titelkarte.titel}</h1>
          <p class="dh-hud-boss-titel__unten">{t('ui.boss.titel.unten')}</p>
        </div>
      )}
    </>
  );
}
