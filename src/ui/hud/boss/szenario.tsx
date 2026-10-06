/**
 * Screenshot layer of the boss bar and title card (M7-32, scenario `boss-titelkarte`, src/debug/bossScenarios.ts; MASTERPROMPT
 * §31.5): the screenshot mode hides the page's overlay, so the scenario lays the boss HUD over the game view in a layer of its
 * own (like the HUD scenarios of the minimap, src/ui/hud/minimap/szenario.tsx). It reads the page's simulation directly
 * (read only, through the boss sampler: the sample, the tick) and redraws once per animation frame.
 */
import { render } from 'preact';
import { createI18n, FALLBACK_LANG, isLang } from '../../../i18n';
import { LeuchtfeuerSampler } from '../../../game/samples/leuchtfeuer';
import type { BossSample } from '../../../game/bosses/types';
import type { Simulation } from '../../../game/sim';
import { uiPx } from '../../kit/geometry';
import '../../kit/index';
import { hudSchrift } from '../minimap/schrift';
import { HudBoss, type HudBossQuelle } from './BossBalken';

/** Frames drawn after the font is there before the layer counts as ready. */
const MAL_FRAMES = 4;

export interface BossHudSzenario {
  /** The font baked, the bar drawn. */
  readonly bereit: boolean;
  dispose(): void;
}

/** Lays the boss bar and title card over the page; `sim` gives the page's simulation (null while it loads). */
export function mountBossHudSzenario(doc: Document, sim: () => Simulation | null): BossHudSzenario {
  const win = doc.defaultView;
  if (win === null) throw new Error('Boss-HUD-Szenario: Dokument ohne Fenster');
  const wirt = doc.body.appendChild(doc.createElement('div'));
  wirt.className = 'dh-hud-szenario';
  wirt.dataset['hudSzenario'] = 'boss';
  Object.assign(wirt.style, { position: 'fixed', inset: '0', zIndex: '10', overflow: 'hidden', pointerEvents: 'none' });
  const lang = doc.documentElement.lang;
  const i18n = createI18n(isLang(lang) ? lang : FALLBACK_LANG);
  i18n.onMissing((key, l) => console.error(`i18n: Schlüssel „${key}“ fehlt (${l})`));
  const sampler = new LeuchtfeuerSampler();
  const hoerer = new Set<() => void>();
  let laeuft = true;
  const takt = (): void => {
    if (!laeuft) return;
    for (const h of hoerer) h();
    win.requestAnimationFrame(takt);
  };
  win.requestAnimationFrame(takt);
  const quelle: HudBossQuelle = {
    leuchtfeuer: {
      sampleBoss: (out: BossSample): BossSample => {
        const s = sim();
        if (s === null) {
          out.active = false;
          return out;
        }
        return sampler.boss(s, out);
      },
    },
    state: { tick: { peek: () => sim()?.tick ?? 0 } },
    onFrame(listener) {
      hoerer.add(listener);
      return () => {
        hoerer.delete(listener);
      };
    },
  };
  const zustand = { bereit: false };
  render(
    <div class="dh-kit-skala" style={{ position: 'absolute', inset: 0, padding: uiPx(0) }}>
      <HudBoss i18n={i18n} bridge={quelle} />
    </div>,
    wirt,
  );
  void hudSchrift(doc).then(async () => {
    for (let i = 0; i < MAL_FRAMES; i++) await new Promise<void>((resolve) => win.requestAnimationFrame(() => resolve()));
    zustand.bereit = true;
    wirt.dataset['bereit'] = '1';
  });
  return {
    get bereit() {
      return zustand.bereit;
    },
    dispose() {
      laeuft = false;
      render(null, wirt);
      wirt.remove();
    },
  };
}
