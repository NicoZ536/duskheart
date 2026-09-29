/**
 * The GI buffer of the render debugger (MASTERPROMPT §6.3 "Render-Debugger: … GI", M5-27): the slot of the
 * radiance-cascade GI (§6.1 pass 5 "Ultra: 2D-Global-Illumination per Radiance Cascades"; tasks M13-01/M13-02). The
 * renderer has no GI pass and computes no indirect light: the view `gi` shows the GI buffer as it is – empty (black) –
 * and the debugger's caption says why (`debug.render.gi.*`, src/debug/renderDebugCaption.tsx). A GI pass writes its
 * result into this view under the same name.
 *
 * The target is one RGBA8 texel created through the resource registry: WebGL initialises it to zero, and after a
 * context loss it is rebuilt the same way.
 */
import { RenderTarget } from '../gl/framebuffer';
import type { PassSetup } from '../passes/registry';

/** Name of the debugger view. */
export const GI_DEBUG_VIEW = 'gi';

/** Registers the empty GI buffer as the debugger's `gi` view; returns its target. */
export function registerGiSlot(setup: Pick<PassSetup, 'gl' | 'resources' | 'debugViews'>): RenderTarget {
  const target = setup.resources.add(new RenderTarget(setup.gl, { label: 'gi-leer', width: 1, height: 1, attachments: [{ name: 'gi', format: 'RGBA8' }], floatTargets: false }));
  setup.debugViews.register({ name: GI_DEBUG_VIEW, mode: 'rgb', source: () => target.texture(0) });
  return target;
}
