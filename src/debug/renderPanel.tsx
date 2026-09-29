/**
 * Render panel of the F3 overlay (MASTERPROMPT §6.3, §30, §31.6; M5-25 … M5-27, M5-30): the quality level being
 * rendered and where it comes from, the light buffer (full or halved, automatic or fixed), the GI slot, the first-start
 * benchmark while it runs, and the time of every render pass – GPU per timer query where the context has one, CPU
 * always. A software rasteriser (SwiftShader in headless Chromium) has timer queries too, but its "GPU" times are CPU
 * rasterisation: the panel says so; without timer queries (Firefox, Safari) the GPU column reads "n. v.".
 */
import type { Lang } from '../i18n';
import { formatNumber } from '../i18n/format';
import type { Translate } from './console';
import type { RenderPanelInfo } from './qualityDebug';

/** Fraction digits of pass times. */
const MS_DIGITS = 2;

export interface RenderPanelProps {
  readonly info: RenderPanelInfo;
  readonly t: Translate;
  readonly lang: Lang;
}

function ms(lang: Lang, t: Translate, value: number | null): string {
  return value === null ? t('debug.overlay.unavailable') : formatNumber(lang, value, MS_DIGITS, MS_DIGITS);
}

/** Text of the quality row: level (source), marked when single options differ from its preset. */
export function qualityText(info: RenderPanelInfo, t: Translate): string {
  const q = info.quality;
  const params = { stufe: t(`settings.graphics.quality.${q.level}`), quelle: t(`debug.overlay.quelle.${q.source}`) };
  return t(q.preset ? 'debug.overlay.stufe.wert' : 'debug.overlay.stufe.angepasst', params);
}

/** Text of the light buffer row: full or halved, and whether it follows the frame times. */
export function lightBufferText(info: RenderPanelInfo, t: Translate): string {
  const b = info.quality.lightBuffer;
  const mode = b.mode !== 'auto' ? 'fest' : b.adaptive ? 'auto' : 'aus';
  return t('debug.overlay.puffer.wert', { puffer: t(b.halved ? 'debug.overlay.puffer.halb' : 'debug.overlay.puffer.voll'), modus: t(`debug.overlay.puffer.modus.${mode}`) });
}

/**
 * Text of the GI row: off; on (radiance cascades); or off although the level asks for it – the renderer has no GI passes,
 * and the row says so as a fact (no promise, MASTERPROMPT §2.1).
 */
export function giText(info: RenderPanelInfo, t: Translate): string {
  const gi = info.quality.gi;
  return t(!gi.requested ? 'debug.overlay.gi.aus' : gi.available ? 'debug.overlay.gi.an' : 'debug.overlay.gi.inaktiv');
}

/** The note under the pass table: where the GPU column comes from. */
export function gpuNote(info: RenderPanelInfo, t: Translate): string {
  const p = info.passes;
  if (!p.gpuTimers) return t('debug.overlay.passes.ohneTimer');
  return p.softwareRenderer ? t('debug.overlay.passes.software', { renderer: p.renderer }) : t('debug.overlay.passes.gpu');
}

export function RenderPanel({ info, t, lang }: RenderPanelProps) {
  const bench = info.quality.benchmark;
  return (
    <div class="dh-debug-section" data-testid="f3-render">
      <div class="dh-debug-subtitle">{t('debug.overlay.render.title')}</div>
      <div class="dh-debug-row">
        <span class="dh-debug-label">{t('debug.overlay.stufe')}</span>
        <span class="dh-debug-value" data-testid="f3-stufe">
          {qualityText(info, t)}
        </span>
      </div>
      <div class="dh-debug-row">
        <span class="dh-debug-label">{t('debug.overlay.puffer')}</span>
        <span class="dh-debug-value" data-testid="f3-lichtpuffer">
          {lightBufferText(info, t)}
        </span>
      </div>
      <div class="dh-debug-row">
        <span class="dh-debug-label">{t('debug.overlay.gi')}</span>
        <span class="dh-debug-value">{giText(info, t)}</span>
      </div>
      {bench.phase !== 'aus' ? (
        <div class="dh-debug-row">
          <span class="dh-debug-label">{t('debug.overlay.benchmark')}</span>
          <span class="dh-debug-value">{t(`debug.overlay.benchmark.${bench.phase}`, { stufe: t(`settings.graphics.quality.${bench.level ?? bench.result?.level ?? info.quality.level}`) })}</span>
        </div>
      ) : null}
      <div class="dh-debug-subtitle">{t('debug.overlay.passes.title')}</div>
      <div class="dh-debug-passes" data-testid="f3-paesse">
        {info.passes.passes.map((p) => (
          <div class="dh-debug-row" key={p.name} data-pass={p.name}>
            <span class="dh-debug-label">{p.name}</span>
            <span class="dh-debug-value">{t('debug.overlay.passes.wert', { gpu: ms(lang, t, p.gpuMs), cpu: ms(lang, t, p.cpuMs) })}</span>
          </div>
        ))}
        <div class="dh-debug-row dh-debug-sum">
          <span class="dh-debug-label">{t('debug.overlay.passes.summe')}</span>
          <span class="dh-debug-value">{t('debug.overlay.passes.wert', { gpu: ms(lang, t, info.passes.gpuMs), cpu: ms(lang, t, info.passes.cpuMs) })}</span>
        </div>
      </div>
      <div class="dh-debug-note">{gpuNote(info, t)}</div>
    </div>
  );
}
