/**
 * Frames in flight on a software rasteriser (src/render/gl/framePacer.ts, M5 integration): a fence behind every drawn
 * frame; the next frame is drawn only while fewer than `maxInFlight` are unfinished; finished frames retire oldest
 * first, a fence that never signals counts as done after `timeoutMs`; a context without fences never holds a frame;
 * a context loss empties the queue; switched off for the render benchmark it deletes its fences. The runtime uses it only
 * on a software rasteriser (the profiler's renderer name).
 */
import { describe, expect, it } from 'vitest';
import { FramePacer, type PacerContext } from '../../../src/render/gl/framePacer';
import { FRAME_PACER } from '../../../src/render/quality/params';
import { PassProfiler } from '../../../src/render/quality/profiler';
import { GpuResourceRegistry } from '../../../src/render/gl/resources';

/** Fences of a fake context: each one signals when the test says so. */
function fakeFences(withFences = true) {
  let next = 0;
  const signalled = new Set<number>();
  const deleted: number[] = [];
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    SYNC_STATUS: 2,
    SIGNALED: 3,
    fenceSync: () => (withFences ? ({ id: next++ } as unknown as WebGLSync) : null),
    getSyncParameter: (sync: WebGLSync) => (signalled.has((sync as unknown as { id: number }).id) ? 3 : 4),
    deleteSync: (sync: WebGLSync) => {
      deleted.push((sync as unknown as { id: number }).id);
    },
  } as unknown as PacerContext;
  return { gl, signal: (id: number) => signalled.add(id), deleted };
}

describe('FramePacer', () => {
  it('lässt höchstens maxInFlight unfertige Frames zu und zieht fertige in Reihenfolge ab', () => {
    const { gl, signal, deleted } = fakeFences();
    const pacer = new FramePacer(gl, 2, 1000);
    expect(pacer.mayDraw(0)).toBe(true);
    pacer.drawn(0); // fence 0
    expect(pacer.mayDraw(10)).toBe(true);
    pacer.drawn(10); // fence 1
    expect(pacer.inFlight).toBe(2);
    // Full: the frame callbacks run on, nothing is drawn.
    expect(pacer.mayDraw(20)).toBe(false);
    expect(pacer.mayDraw(30)).toBe(false);
    expect(pacer.held).toBe(2);
    // The younger frame finishing first frees nothing: frames finish in order.
    signal(1);
    expect(pacer.mayDraw(40)).toBe(false);
    signal(0);
    expect(pacer.mayDraw(50)).toBe(true);
    expect(deleted).toEqual([0, 1]);
    expect(pacer.inFlight).toBe(0);
  });

  it('ein Fence, der nie signalisiert, zählt nach timeoutMs als fertig', () => {
    const { gl } = fakeFences();
    const pacer = new FramePacer(gl, 1, 500);
    pacer.drawn(100);
    expect(pacer.mayDraw(599)).toBe(false);
    expect(pacer.mayDraw(600)).toBe(true);
  });

  it('ohne Fences hält er nie einen Frame; ein Kontextverlust leert die Warteschlange', () => {
    const none = fakeFences(false);
    const open = new FramePacer(none.gl, 1, 1000);
    for (let t = 0; t < 5; t++) {
      expect(open.mayDraw(t)).toBe(true);
      open.drawn(t);
    }
    const { gl } = fakeFences();
    const pacer = new FramePacer(gl, 2, 1000);
    pacer.drawn(0);
    pacer.drawn(1);
    expect(pacer.mayDraw(2)).toBe(false);
    pacer.reset();
    expect(pacer.inFlight).toBe(0);
    expect(pacer.mayDraw(3)).toBe(true);
    expect(() => new FramePacer(gl, 0, 1000)).toThrow(RangeError);
  });

  it('ausgeschaltet (Render-Benchmark) löscht er die offenen Fences und zählt danach neu', () => {
    const { gl, deleted } = fakeFences();
    const pacer = new FramePacer(gl, 2, 1000);
    pacer.drawn(0); // fence 0
    pacer.drawn(1); // fence 1
    expect(pacer.mayDraw(2)).toBe(false);
    pacer.clear();
    expect(deleted).toEqual([0, 1]);
    expect(pacer.inFlight).toBe(0);
    expect(pacer.mayDraw(3)).toBe(true);
    pacer.drawn(3); // fence 2
    expect(pacer.inFlight).toBe(1);
  });

  it('Parameter: zwei Frames in der Warteschlange, Zeitgrenze über einer Shader-Übersetzung', () => {
    expect(FRAME_PACER.maxInFlight).toBe(2);
    expect(FRAME_PACER.timeoutMs).toBeGreaterThanOrEqual(1000);
  });

  it('der Profiler erkennt den Software-Rasterer am Renderer-Namen (nur dort taktet die Laufzeit)', () => {
    const named = (name: string): WebGL2RenderingContext =>
      ({
        RENDERER: 0x1f01,
        getParameter: (p: number) => (p === 0x9246 ? name : 'WebKit WebGL'),
        getExtension: (ext: string) => (ext === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null),
      }) as unknown as WebGL2RenderingContext;
    const soft = new PassProfiler();
    soft.init(named('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), new GpuResourceRegistry());
    expect(soft.softwareRenderer).toBe(true);
    const gpu = new PassProfiler();
    gpu.init(named('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)'), new GpuResourceRegistry());
    expect(gpu.softwareRenderer).toBe(false);
  });
});
