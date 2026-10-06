/**
 * Screenshot layer of the fishing plate (M7-24, scenario `angeln-hud`, src/debug/feldScenarios.ts; MASTERPROMPT §31.5): the
 * screenshot mode hides the page's overlay, so the scenario lays the plate over the game view in a layer of its own (like the
 * boss bar's, src/ui/hud/boss/szenario.tsx), with the HUD root's colour tokens (`hudTokens`) and the kit's box model
 * (`dh-kit`), as src/ui/hud/Hud.tsx sets them. It reads the page's simulation directly (read only, through the field sampler)
 * and redraws once per animation frame; without menu input the interact key shows as `E`.
 */
import { render } from 'preact';
import { createI18n, FALLBACK_LANG, isLang } from '../../../i18n';
import { FeldSampler } from '../../../game/samples/feld';
import type { FishingSample } from '../../../game/fishing/types';
import type { Simulation } from '../../../game/sim';
import { uiPx } from '../../kit/geometry';
import '../../kit/index';
import { hudTokens } from '../farben';
import { hudSchrift } from '../minimap/schrift';
import { HudAngeln, type HudAngelnQuelle } from './AngelHud';

/** Frames drawn after the font is there before the layer counts as ready. */
const MAL_FRAMES = 4;

export interface AngelHudSzenario {
  /** The font baked, the plate drawn. */
  readonly bereit: boolean;
  dispose(): void;
}

/** Lays the fishing plate over the page; `sim` gives the page's simulation (null while it loads). */
export function mountAngelHudSzenario(doc: Document, sim: () => Simulation | null): AngelHudSzenario {
  const win = doc.defaultView;
  if (win === null) throw new Error('Angel-HUD-Szenario: Dokument ohne Fenster');
  const wirt = doc.body.appendChild(doc.createElement('div'));
  wirt.className = 'dh-hud-szenario';
  wirt.dataset['hudSzenario'] = 'angeln';
  Object.assign(wirt.style, { position: 'fixed', inset: '0', zIndex: '10', overflow: 'hidden', pointerEvents: 'none' });
  const lang = doc.documentElement.lang;
  const i18n = createI18n(isLang(lang) ? lang : FALLBACK_LANG);
  i18n.onMissing((key, l) => console.error(`i18n: Schlüssel „${key}“ fehlt (${l})`));
  const sampler = new FeldSampler();
  const hoerer = new Set<() => void>();
  let laeuft = true;
  const takt = (): void => {
    if (!laeuft) return;
    for (const h of hoerer) h();
    win.requestAnimationFrame(takt);
  };
  win.requestAnimationFrame(takt);
  const quelle: HudAngelnQuelle = {
    feld: {
      sampleFishing: (out: FishingSample): FishingSample => {
        const s = sim();
        if (s === null) {
          out.phase = 'aus';
          return out;
        }
        return sampler.fishingLine(s, out);
      },
    },
    input: null,
    onFrame(listener) {
      hoerer.add(listener);
      return () => {
        hoerer.delete(listener);
      };
    },
  };
  const zustand = { bereit: false };
  render(
    <div class="dh-kit dh-kit-skala" style={{ ...hudTokens(), position: 'absolute', inset: 0, padding: uiPx(0) }}>
      <HudAngeln i18n={i18n} bridge={quelle} />
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
