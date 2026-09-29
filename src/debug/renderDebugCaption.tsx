/**
 * Caption of the render debugger (MASTERPROMPT §6.3 "Render-Debugger", §31.6; M5-27): while a buffer is shown instead
 * of the final image (`__dh.call('renderDebug', name)`), a small panel at the bottom left names it and says how to read
 * its colours (`debug.puffer.<view>`, `.legende`). It lies outside the UI root, so screenshots of a buffer carry it –
 * the GI buffer, empty because the renderer computes no indirect light, says so here.
 */
import type { Signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { DEBUG_VIEW_OFF } from '../render/debugView';
import { debugViewLabelKey, debugViewLegendKey, isKnownDebugView } from '../render/debug/catalog';
import type { Translate } from './console';
import { injectDebugStyles } from './styles';

export interface RenderDebugCaptionProps {
  /** The debugger's current buffer (`off`: no caption). */
  readonly view: Signal<string>;
  readonly t: Translate;
}

export function RenderDebugCaption({ view, t }: RenderDebugCaptionProps) {
  useEffect(() => {
    if (typeof document !== 'undefined') injectDebugStyles(document);
  }, []);
  const name = view.value;
  if (name === DEBUG_VIEW_OFF) return null;
  const known = isKnownDebugView(name);
  return (
    <div class="dh-debug-caption" role="status" data-testid="render-debug-puffer" data-puffer={name}>
      <div class="dh-debug-title">{t('debug.puffer.titel', { puffer: known ? t(debugViewLabelKey(name)) : name })}</div>
      {known ? <div class="dh-debug-legend">{t(debugViewLegendKey(name))}</div> : null}
    </div>
  );
}
