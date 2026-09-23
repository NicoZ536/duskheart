/**
 * WebGL2 stand-in without side effects for measuring the renderer's JavaScript frame path in Node
 * (`framePath.ts`, M1-12 „keine Allokation im Frame-Pfad“). Every method the renderer calls is a
 * no-op – fresh handles for `create*`, success for compile, link and framebuffer checks, `NO_ERROR`
 * for `getError` – and every constant is a distinct number.
 *
 * It is built in two steps: a discovery proxy defines each member on first access while the scenes
 * render once; `freeze()` then returns a plain object with exactly these members. The measured frames
 * run against the plain object – no proxy trap, no call log, no rest parameters – so the stand-in
 * itself allocates nothing per call and every byte measured belongs to the renderer.
 */

/** Members with a fixed answer (everything else: `create*` → a new handle, other methods → undefined). */
const ANSWERS: Readonly<Record<string, (constant: (name: string) => number) => unknown>> = {
  isContextLost: () => false,
  getShaderParameter: () => true,
  getProgramParameter: () => true,
  getShaderInfoLog: () => '',
  getProgramInfoLog: () => '',
  getExtension: () => null,
  getParameter: () => 0,
  checkFramebufferStatus: (c) => c('FRAMEBUFFER_COMPLETE'),
  getError: (c) => c('NO_ERROR'),
  clientWaitSync: (c) => c('ALREADY_SIGNALED'),
};

const CONSTANT_NAME = /^[A-Z0-9_]+$/;

export interface NullGl {
  /** The discovery context (proxy): render every measured scene once with it. */
  readonly discovery: WebGL2RenderingContext;
  /** A plain context with every member discovered so far. */
  freeze(): WebGL2RenderingContext;
}

export function createNullGl(): NullGl {
  const members: Record<string, unknown> = {};
  const constants = new Map<string, number>();
  let nextHandle = 1;
  const constant = (name: string): number => {
    let v = constants.get(name);
    if (v === undefined) {
      v = constants.size + 1;
      constants.set(name, v);
      members[name] = v;
    }
    return v;
  };
  const define = (name: string): unknown => {
    if (name in members) return members[name];
    if (CONSTANT_NAME.test(name)) return constant(name);
    const answer = ANSWERS[name];
    let fn: () => unknown;
    if (answer !== undefined) {
      const value = answer(constant);
      fn = () => value;
    } else if (name.startsWith('create') || name === 'fenceSync') fn = () => ({ handle: nextHandle++ });
    else fn = () => undefined;
    members[name] = fn;
    return fn;
  };
  const discovery = new Proxy(members, { get: (_target, prop) => (typeof prop === 'string' ? define(prop) : undefined) }) as unknown as WebGL2RenderingContext;
  return {
    discovery,
    freeze: () => ({ ...members }) as unknown as WebGL2RenderingContext,
  };
}
