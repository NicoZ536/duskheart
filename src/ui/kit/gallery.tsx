/**
 * Kit gallery for the screenshot scenarios (MASTERPROMPT §31.5, M1-20/M1-21):
 * - `schrift`: the pixel font in the DOM (CSS font) and in WebGL (baked glyph atlas, `TextBatch`)
 *   side by side at 4×, 2× and 1×, with „Größe Übermäßig Ärger“ and ÄÖÜäöüß, plain, with shadow
 *   and with outline, plus the bake statistics (glyphs, ambiguous samples, missing characters);
 * - `ui-kit`: every kit element (frames, slots, buttons in all states, bars, pixel scrollbar) at
 *   1×, 2×, 3× and 4×.
 *
 * The gallery covers the page with its own layer (outside the overlay that screenshot mode hides)
 * and reports `ready` once the font is loaded, the atlas is baked, the WebGL text is drawn and every
 * UI graphic is decoded.
 */
import type { ComponentChildren } from 'preact';
import { render } from 'preact';
import { UI_GRAFIKEN } from '../../generated/ui';
import { UI_HEX } from '../../generated/palette';
import type { I18n } from '../../i18n';
import { watchContextLoss } from '../../render/gl/context';
import { GpuResourceRegistry } from '../../render/gl/resources';
import { createCanvasRasterizer, GlyphAtlas, lineHeightOf, rgbaFromHex, TextBatch, type TextEffect } from '../../render/text';
import { loadUiFont, UI_FONT } from '../font';
import { MAX_UI_SCALE, MIN_UI_SCALE, UI_SCALE_VAR } from '../theme';
import { uiPx } from './geometry';
import { ScrollArea } from './ScrollArea';
import { Bar, Button, Frame, Slot } from './widgets';

export const GALLERY_KINDS = ['schrift', 'ui-kit'] as const;
export type GalleryKind = (typeof GALLERY_KINDS)[number];

export interface GalleryHandle {
  /** Font loaded, atlas baked, WebGL text drawn, UI graphics decoded. */
  readonly ready: boolean;
  /** Why preparing failed (also logged as a console error, which fails `npm run shot`); `null` otherwise. */
  readonly error: string | null;
  dispose(): void;
}

/**
 * Font specimen: the acceptance line of M1-20, the umlauts, both alphabets, digits and punctuation.
 * Identical in every UI language (it tests glyphs, it is not UI text).
 */
export const SCHRIFTPROBE: readonly string[] = ['Größe Übermäßig Ärger', 'ÄÖÜäöüß', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789 .,:;!?()–„“×'];
/** Scales of the font comparison (largest first). */
const SCHRIFT_SKALEN = [4, 2, 1] as const;
/** Width of a specimen block [design px] (the widest line is 158 px). */
const PROBE_BREITE = 172;
/** Lines of a block: the specimen plus the first line again with shadow and with outline. */
const PROBE_ZEILEN: ReadonlyArray<{ readonly text: string; readonly effect: TextEffect }> = [
  ...SCHRIFTPROBE.map((text) => ({ text, effect: 'none' as const })),
  { text: SCHRIFTPROBE[0] ?? '', effect: 'shadow' },
  { text: SCHRIFTPROBE[0] ?? '', effect: 'outline' },
];
/** UI scale of the gallery's own frames and labels (the probes set theirs). */
const GALERIE_SKALA = 2;
/** Margin around the gallery [design px]. */
const GALERIE_RAND = 6;
/** Frames to wait after the last asset before the picture counts as painted. */
const PAINT_FRAMES = 2;

const LINE = lineHeightOf(UI_FONT);
const TEXT_RGBA = rgbaFromHex(UI_HEX.text);
const SCHATTEN_RGBA = rgbaFromHex(UI_HEX.dunkel);

/** CSS text-shadow that matches the WebGL effect (drop shadow 1 px down, or 8-neighbour outline). */
function cssEffect(effect: TextEffect): string | undefined {
  const c = 'var(--dh-dunkel)';
  const p = uiPx(1);
  const m = `calc(-1px * var(${UI_SCALE_VAR}))`;
  if (effect === 'shadow') return `0 ${p} 0 ${c}`;
  if (effect === 'outline') {
    const offsets = [`${m} ${m}`, `0 ${m}`, `${p} ${m}`, `${m} 0`, `${p} 0`, `${m} ${p}`, `0 ${p}`, `${p} ${p}`];
    return offsets.map((o) => `${o} 0 ${c}`).join(', ');
  }
  return undefined;
}

function scaleStyle(scale: number): Record<string, string> {
  return { [UI_SCALE_VAR]: String(scale) };
}

function Stack({ gap, children, row }: { readonly gap: number; readonly row?: boolean; readonly children?: ComponentChildren }) {
  return <div style={{ display: 'flex', flexDirection: row === true ? 'row' : 'column', alignItems: 'flex-start', gap: uiPx(gap) }}>{children}</div>;
}

// ---------------------------------------------------------------------------------------------
// schrift
// ---------------------------------------------------------------------------------------------

function DomProbe({ scale }: { readonly scale: number }) {
  return (
    <div class="dh-kit-skala" style={{ ...scaleStyle(scale), width: uiPx(PROBE_BREITE), background: 'var(--dh-rahmen)' }} data-testid={`schrift-dom-${scale}`}>
      {PROBE_ZEILEN.map((z, i) => (
        <div key={i} style={{ height: uiPx(LINE), whiteSpace: 'pre', textShadow: cssEffect(z.effect) }}>
          {z.text}
        </div>
      ))}
    </div>
  );
}

function GlProbe({ scale }: { readonly scale: number }) {
  return (
    <canvas
      class="dh-galerie__gl"
      data-scale={scale}
      data-testid={`schrift-gl-${scale}`}
      width={PROBE_BREITE}
      height={PROBE_ZEILEN.length * LINE}
      style={{ width: `${PROBE_BREITE * scale}px`, height: `${PROBE_ZEILEN.length * LINE * scale}px`, imageRendering: 'pixelated', display: 'block' }}
    />
  );
}

function SchriftGalerie({ i18n, stat }: { readonly i18n: I18n; readonly stat: string }) {
  return (
    <Stack gap={4}>
      <Stack gap={4} row>
        <Frame art="holz" class="dh-kit-text--schatten">
          {i18n.t('debug.galerie.schrift.titel', { font: UI_FONT.family, px: UI_FONT.pixelsPerEm })}
        </Frame>
        <Frame art="pergament" data-testid="schrift-stat">
          {stat}
        </Frame>
      </Stack>
      <Stack gap={4} row>
        {(['dom', 'webgl'] as const).map((seite) => (
          <Frame art="holz" key={seite}>
            <Stack gap={2}>
              <div class="dh-kit-text--schatten">{i18n.t(seite === 'dom' ? 'debug.galerie.schrift.dom' : 'debug.galerie.schrift.webgl')}</div>
              {SCHRIFT_SKALEN.map((s) => (
                <Stack gap={1} key={s}>
                  <div class="dh-kit-text--schatten">{i18n.t('debug.galerie.skala', { scale: s })}</div>
                  {seite === 'dom' ? <DomProbe scale={s} /> : <GlProbe scale={s} />}
                </Stack>
              ))}
            </Stack>
          </Frame>
        ))}
      </Stack>
    </Stack>
  );
}

/** Byte shifts of a packed 0xRRGGBBAA colour and the largest channel value. */
const SHIFT_R = 24;
const SHIFT_G = 16;
const SHIFT_B = 8;
const BYTE_MAX = 255;

/** Channel of a packed colour as 0…1 (clear colour). */
function channel(rgba: number, shift: number): number {
  return ((rgba >>> shift) & BYTE_MAX) / BYTE_MAX;
}

/** Draws the specimen into one gallery canvas with a `TextBatch` (own WebGL2 context, 1 px = 1 design px). */
function drawGlProbe(canvas: HTMLCanvasElement, atlas: GlyphAtlas): () => void {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
  if (gl === null) throw new Error('WebGL2 fehlt für die Schriftprobe');
  const resources = new GpuResourceRegistry();
  const batch = new TextBatch(gl, resources, atlas);
  const bg = rgbaFromHex(UI_HEX.rahmen);
  const draw = (): void => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(channel(bg, SHIFT_R), channel(bg, SHIFT_G), channel(bg, SHIFT_B), 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    batch.begin(canvas.width, canvas.height);
    PROBE_ZEILEN.forEach((z, i) => batch.text(z.text, 0, i * LINE, { color: TEXT_RGBA, effect: z.effect, effectColor: SCHATTEN_RGBA }));
    batch.end();
  };
  draw();
  return watchContextLoss(
    canvas,
    () => resources.loseAll(),
    () => {
      resources.restoreAll();
      draw();
    },
  );
}

// ---------------------------------------------------------------------------------------------
// ui-kit
// ---------------------------------------------------------------------------------------------

/** Width of one kit column's content [design px]. */
const KIT_BREITE = 124;
const BAR_BREITE = 100;
/** Visible lines of the scroll demo (the rest is scrolled to). */
const SCROLL_ZEILEN = 3;
const SCROLL_HOEHE = SCROLL_ZEILEN * LINE;
const CHRONIK_TAGE = 9;
const BEISPIEL_LEBEN = 87;
const BEISPIEL_AUSDAUER = 40;
const BEISPIEL_MAX = 100;
const BEISPIEL_STAPEL = 12;

function KitSpalte({ i18n, scale }: { readonly i18n: I18n; readonly scale: number }) {
  const leben = i18n.t('ui.kit.leben');
  const ausdauer = i18n.t('ui.kit.ausdauer');
  return (
    <div class="dh-kit-skala" style={scaleStyle(scale)} data-testid={`ui-kit-${scale}`}>
      <Frame art="holz">
        <div style={{ width: uiPx(KIT_BREITE) }}>
          <Stack gap={4}>
            <div class="dh-kit-text--schatten">{i18n.t('debug.galerie.skala', { scale })}</div>
            <Stack gap={2} row>
              <Slot label={i18n.t('debug.galerie.kit.slotLeer')} />
              <Slot label={i18n.t('debug.galerie.kit.slotHover')} zustand="hover" />
              <Slot label={i18n.t('debug.galerie.kit.slotAktiv')} aktiv anzahl={BEISPIEL_STAPEL} />
            </Stack>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: uiPx(2) }}>
              <Button>{i18n.t('debug.galerie.kit.normal')}</Button>
              <Button zustand="hover">{i18n.t('debug.galerie.kit.hover')}</Button>
              <Button zustand="gedrueckt">{i18n.t('debug.galerie.kit.gedrueckt')}</Button>
              <Button disabled>{i18n.t('debug.galerie.kit.gesperrt')}</Button>
            </div>
            <Frame art="eisen">
              <Stack gap={2}>
                <Bar art="leben" value={BEISPIEL_LEBEN} max={BEISPIEL_MAX} width={BAR_BREITE} label={i18n.t('ui.kit.leiste.wert', { label: leben, value: BEISPIEL_LEBEN, max: BEISPIEL_MAX })} />
                <Bar art="ausdauer" value={BEISPIEL_AUSDAUER} max={BEISPIEL_MAX} width={BAR_BREITE} label={i18n.t('ui.kit.leiste.wert', { label: ausdauer, value: BEISPIEL_AUSDAUER, max: BEISPIEL_MAX })} />
              </Stack>
            </Frame>
            <Frame art="pergament" style={{ width: '100%' }}>
              <ScrollArea height={SCROLL_HOEHE} labelHoch={i18n.t('ui.kit.scroll.hoch')} labelRunter={i18n.t('ui.kit.scroll.runter')}>
                {Array.from({ length: CHRONIK_TAGE }, (_, i) => (
                  <div key={i}>{i18n.t('debug.galerie.kit.chronik', { day: i + 1 })}</div>
                ))}
              </ScrollArea>
            </Frame>
          </Stack>
        </div>
      </Frame>
    </div>
  );
}

function KitGalerie({ i18n }: { readonly i18n: I18n }) {
  const scales = Array.from({ length: MAX_UI_SCALE - MIN_UI_SCALE + 1 }, (_, i) => MIN_UI_SCALE + i);
  return (
    <Stack gap={3}>
      <Frame art="holz" class="dh-kit-text--schatten">
        {i18n.t('debug.galerie.kit.titel')}
      </Frame>
      <Stack gap={4} row>
        {scales.map((s) => (
          <KitSpalte key={s} i18n={i18n} scale={s} />
        ))}
      </Stack>
    </Stack>
  );
}

// ---------------------------------------------------------------------------------------------
// mounting
// ---------------------------------------------------------------------------------------------

function nextFrame(win: Window): Promise<void> {
  return new Promise((resolve) => win.requestAnimationFrame(() => resolve()));
}

/** Decodes every UI graphic, so border images are painted in the first screenshot. */
async function decodeUiGraphics(doc: Document): Promise<void> {
  await Promise.all(
    Object.values(UI_GRAFIKEN).map((g) => {
      const img = new Image();
      img.src = new URL(g.datei, doc.baseURI).href;
      return img.decode();
    }),
  );
}

/** Mounts the gallery `kind` over the page. */
export function mountGallery(kind: GalleryKind, doc: Document, i18n: I18n): GalleryHandle {
  const host = doc.body.appendChild(doc.createElement('div'));
  host.className = 'dh-kit dh-kit-skala dh-galerie';
  host.dataset['galerie'] = kind;
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '10', overflow: 'hidden', background: 'var(--dh-dunkel)', padding: uiPx(GALERIE_RAND) });
  host.style.setProperty(UI_SCALE_VAR, String(GALERIE_SKALA));
  const state = { ready: false, error: null as string | null };
  const stops: Array<() => void> = [];
  const show = (stat: string): void => {
    render(kind === 'schrift' ? <SchriftGalerie i18n={i18n} stat={stat} /> : <KitGalerie i18n={i18n} />, host);
  };
  show('');
  const win = doc.defaultView;
  const prepare = async (): Promise<void> => {
    await Promise.all([loadUiFont(doc.fonts), decodeUiGraphics(doc)]);
    if (kind === 'schrift') {
      const atlas = new GlyphAtlas(UI_FONT, createCanvasRasterizer(UI_FONT), { preload: UI_FONT.charset });
      for (const c of host.querySelectorAll<HTMLCanvasElement>('canvas.dh-galerie__gl')) stops.push(drawGlProbe(c, atlas));
      const s = atlas.stats;
      show(i18n.t('debug.galerie.schrift.stat', { glyphs: s.glyphs, ambiguous: s.ambiguousSamples, clipped: s.clipped.length, missing: s.missing.length, size: `${atlas.width}×${atlas.height}` }));
    }
    if (win !== null) for (let i = 0; i < PAINT_FRAMES; i++) await nextFrame(win);
    state.ready = true;
    host.dataset['bereit'] = '1';
  };
  prepare().catch((err: unknown) => {
    state.error = err instanceof Error ? err.message : String(err);
    console.error(`Galerie ${kind}: ${state.error}`);
  });
  return {
    get ready() {
      return state.ready;
    },
    get error() {
      return state.error;
    },
    dispose() {
      for (const stop of stops) stop();
      render(null, host);
      host.remove();
    },
  };
}
