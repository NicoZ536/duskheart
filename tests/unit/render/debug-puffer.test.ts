/**
 * M5-27: der Render-Debugger ist komplett – jeder in §6.3 verlangte Puffer (Albedo, Normalen, Höhe, Emissiv, SDF,
 * Sonnenschatten, Licht, GI, Nässe, Nebel, Gameplay-Lichtkarte) ist als Ansicht registriert und schaltbar, jede Ansicht
 * der Stränge hat eine Beschriftung in DE und EN, und der GI-Platz zeigt bis M13 einen leeren, beschrifteten Puffer
 * statt eines Platzhalters.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { createI18n } from '../../../src/i18n';
import { DEBUG_VIEW_NAMES, debugViewLabelKey, debugViewLegendKey, isKnownDebugView, REQUIRED_DEBUG_VIEWS } from '../../../src/render/debug/catalog';
import { GI_DEBUG_VIEW } from '../../../src/render/debug/giSlot';
import { LIGHTMAP_PASS_ORDER, LightmapDebugPass } from '../../../src/render/debug/lightmapPass';
import { DEBUG_VIEW_OFF } from '../../../src/render/debugView';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { createFakeGl } from './fakeGl';

/** A renderer with every strand, and the light map views the game view adds when it is shown. */
function renderer(): { r: Renderer; errors: unknown[]; fake: ReturnType<typeof createFakeGl> } {
  const fake = createFakeGl();
  const errors: unknown[] = [];
  const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: (e: unknown) => errors.push(e) }, paletteHex: PALETTE_HEX });
  r.passes.add(new LightmapDebugPass(() => r.lighting.lighting), LIGHTMAP_PASS_ORDER);
  return { r, errors, fake };
}

function scene(): RenderScene {
  const s = new RenderScene();
  s.beginFrame(1);
  return s;
}

describe('Render-Debugger komplett (M5-27)', () => {
  it('jeder Puffer aus §6.3 ist registriert, in der Reihenfolge von §6.3 benannt', () => {
    expect(REQUIRED_DEBUG_VIEWS).toEqual(['albedo', 'normal', 'height', 'emissive', 'sdf', 'sun', 'light', 'gi', 'wet', 'fog', 'lightmap']);
    const { r } = renderer();
    const names = r.debugViews.names();
    for (const v of REQUIRED_DEBUG_VIEWS) expect(names, v).toContain(v);
    expect(names.at(-1)).toBe(DEBUG_VIEW_OFF);
  });

  it('jede registrierte Ansicht steht im Katalog und hat Name und Legende in DE und EN', () => {
    const { r } = renderer();
    const registered = r.debugViews.names().filter((n) => n !== DEBUG_VIEW_OFF);
    expect([...registered].sort()).toEqual([...DEBUG_VIEW_NAMES].sort());
    for (const lang of ['de', 'en'] as const) {
      const i18n = createI18n(lang, { strict: true });
      for (const v of DEBUG_VIEW_NAMES) {
        expect(i18n.t(debugViewLabelKey(v)).length, `${lang} ${v}`).toBeGreaterThan(0);
        expect(i18n.t(debugViewLegendKey(v)).length, `${lang} ${v}`).toBeGreaterThan(10);
      }
      expect(i18n.t('debug.puffer.titel', { puffer: 'X' })).toContain('X');
    }
    expect(isKnownDebugView('gibtsnicht')).toBe(false);
  });

  it('jeder Puffer lässt sich schalten und zeichnet ein Bild; „off“ zeigt wieder das Endbild; Unbekanntes wird abgelehnt', () => {
    const { r, errors, fake } = renderer();
    for (const v of DEBUG_VIEW_NAMES) {
      r.setDebugView(v);
      expect(r.debugView).toBe(v);
      const view = r.debugViews.get(v);
      expect(view, v).toBeDefined();
      r.render(scene(), 960, 540, 'sharp');
      // The debugger's program drew the buffer (its view renders into the debug target).
      expect(view?.source(), v).not.toBeNull();
    }
    r.setDebugView(DEBUG_VIEW_OFF);
    r.render(scene(), 960, 540, 'sharp');
    expect(r.debugView).toBe(DEBUG_VIEW_OFF);
    expect(() => r.setDebugView('gibtsnicht')).toThrow(/unbekannter Puffer/);
    expect(errors).toEqual([]);
    expect(fake.count('drawArrays')).toBeGreaterThan(0);
  });

  it('GI (Platz für M13): ein leerer, beschrifteter Puffer statt eines Platzhalterbildes', () => {
    const { r } = renderer();
    const gi = r.debugViews.get(GI_DEBUG_VIEW);
    expect(gi?.mode).toBe('rgb');
    const tex = gi?.source();
    expect(tex?.width).toBe(1);
    expect(tex?.height).toBe(1);
    // The debugger's shader repeats the edge texel of smaller buffers instead of reading outside them.
    expect((SHADERS['debug_view.frag'] ?? '').replace(/\s+/g, ' ')).toContain('texelFetch(uSource, min(p, textureSize(uSource, 0) - 1), 0)');
    // The caption states the fact – GI is not active, the buffer empty – and promises nothing (MASTERPROMPT §2.1, review M5
    // Minor 13).
    const de = createI18n('de', { strict: true }).t(debugViewLegendKey('gi'));
    const en = createI18n('en', { strict: true }).t(debugViewLegendKey('gi'));
    expect(de).toMatch(/nicht aktiv/);
    expect(de).toMatch(/leer/);
    expect(en).toMatch(/not active/);
    expect(en).toMatch(/empty/);
    for (const text of [de, en]) expect(text).not.toMatch(/M13|kommt|noch nicht|comes|not yet|soon/i);
  });

  it('der GI-Puffer übersteht einen Kontextverlust wie jede Ressource', () => {
    const { r, fake } = renderer();
    const before = r.debugViews.get(GI_DEBUG_VIEW)?.source();
    fake.lose();
    r.contextLost();
    fake.restore();
    r.contextRestored();
    r.setDebugView(GI_DEBUG_VIEW);
    r.render(scene(), 960, 540, 'sharp');
    expect(r.debugViews.get(GI_DEBUG_VIEW)?.source()).toBe(before);
    expect(before?.handle).not.toBeNull();
  });
});
