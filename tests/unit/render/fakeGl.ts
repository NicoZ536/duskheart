/**
 * Recording WebGL2 stand-in for unit tests (Node has no GL): constants are distinct numbers,
 * `create*` returns fresh handles, compile/link succeed unless the source contains `FAKE_ERROR`
 * (then the log names that line like ANGLE does), every call is recorded.
 */
export interface GlCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

export interface FakeGl {
  readonly gl: WebGL2RenderingContext;
  readonly calls: GlCall[];
  count(name: string): number;
  lose(): void;
  restore(): void;
}

/** Marker that makes the fake compiler fail on that line. */
export const FAKE_ERROR = 'FAKE_ERROR';

export function createFakeGl(): FakeGl {
  const calls: GlCall[] = [];
  const constants = new Map<string, number>();
  const shaderSource = new Map<object, string>();
  let lost = false;
  let nextHandle = 1;
  const status = { FRAMEBUFFER_COMPLETE: 0x8cd5 };
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    isContextLost: () => lost,
    shaderSource: (sh, src) => {
      shaderSource.set(sh as object, src as string);
    },
    getShaderParameter: (sh) => !(shaderSource.get(sh as object) ?? '').includes(FAKE_ERROR),
    getShaderInfoLog: (sh) => {
      const lines = (shaderSource.get(sh as object) ?? '').split('\n');
      const i = lines.findIndex((l) => l.includes(FAKE_ERROR));
      return i < 0 ? '' : `ERROR: 0:${i + 1}: '${FAKE_ERROR}' : undeclared identifier\n`;
    },
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    checkFramebufferStatus: () => status.FRAMEBUFFER_COMPLETE,
    getUniformLocation: () => ({ id: nextHandle++ }),
    getExtension: () => null,
    getParameter: () => 0,
  };
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in status) return status[prop as keyof typeof status];
      if (/^[A-Z0-9_]+$/.test(prop)) {
        let v = constants.get(prop);
        if (v === undefined) {
          v = constants.size + 1;
          constants.set(prop, v);
        }
        return v;
      }
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        const m = methods[prop];
        if (m) return m(...args);
        if (prop.startsWith('create') || prop === 'fenceSync') return lost ? null : { id: nextHandle++, kind: prop };
        return undefined;
      };
    },
  };
  const gl = new Proxy({}, handler) as unknown as WebGL2RenderingContext;
  return {
    gl,
    calls,
    count: (name) => calls.filter((c) => c.name === name).length,
    lose: () => {
      lost = true;
    },
    restore: () => {
      lost = false;
    },
  };
}
