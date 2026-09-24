/**
 * Debug overlay pass (M2-29, MASTERPROMPT §31.6): draws the frame's `DebugOverlayList` – chunk
 * borders, collision tiles, the temperature field – into the final image (`targets.ldr`) after
 * post and outline and before the world UI, with the pixel font's glyph atlas for its labels. One
 * `TextBatch` (one instanced draw call) holds the whole overlay; nothing is drawn while the list is
 * empty (overlays off) or until the font has loaded.
 */
import { snapToPixel } from '../camera';
import type { GlyphAtlas } from '../text/glyphAtlas';
import { TextBatch } from '../text/textBatch';
import { WORLD_UI_COLORS } from '../worldUi/worldUi';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';
import type { TextStyle } from '../text/textBatch';

/** A text style the pass rewrites per label (one object: no allocation per element). */
class LabelStyle implements TextStyle {
  color = 0;
  readonly effect = 'outline' as const;
  readonly effectColor = WORLD_UI_COLORS.outline;
  readonly align = 'left' as const;
}

export class DebugOverlayPass implements RenderPass {
  readonly name = 'debug-overlay';
  enabled = true;
  private setup: PassSetup | null = null;
  private glyphs: GlyphAtlas | null = null;
  private batch: TextBatch | null = null;
  private readonly style = new LabelStyle();
  private drawn = 0;

  /** Overlay elements drawn in the last frame. */
  get drawnLastFrame(): number {
    return this.drawn;
  }

  init(setup: PassSetup): void {
    this.setup = setup;
    this.createBatch();
  }

  /** Provides the glyph atlas of the pixel font (the same as the world UI's). */
  setGlyphs(atlas: GlyphAtlas): void {
    if (this.glyphs === atlas) return;
    this.glyphs = atlas;
    this.batch?.dispose();
    this.batch = null;
    this.createBatch();
  }

  resize(_size: FrameSize): void {
    // Draws into the renderer's LDR target.
  }

  execute(ctx: RenderContext): void {
    this.drawn = 0;
    const list = ctx.scene.debugOverlay;
    const batch = this.batch;
    if (list.count === 0 || batch === null) return;
    const f = ctx.frame;
    ctx.targets.ldr.bind();
    batch.begin(f.width, f.height);
    for (let i = 0; i < list.count; i++) {
      const e = list.entry(i);
      if (e === undefined) continue;
      // World px → target px (the target includes the 1 px border; the camera origin is whole px).
      const x = snapToPixel(e.x) - f.camera.originX;
      const y = snapToPixel(e.y) - f.camera.originY;
      if (e.kind === 'rect') batch.rect(x, y, e.width, e.height, e.color);
      else {
        this.style.color = e.color;
        batch.text(e.text, x, y, this.style);
      }
      this.drawn++;
    }
    ctx.stats.drawCalls += batch.end();
  }

  dispose(_setup: PassSetup): void {
    this.batch?.dispose();
    this.batch = null;
    this.setup = null;
  }

  private createBatch(): void {
    const s = this.setup;
    if (s === null || this.glyphs === null || this.batch !== null) return;
    this.batch = new TextBatch(s.gl, s.resources, this.glyphs, { shaders: s.shaders });
  }
}
