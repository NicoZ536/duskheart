/**
 * GLSL source library: every `.glsl`/`.vert`/`.frag` below src/render/shaders, keyed by its path
 * relative to that folder (the name used by `#include` and `ProgramDesc`).
 *
 * Hot reload (dev server): this module accepts its own update. Vite re-evaluates it when a shader
 * file changes; the persistent `shaderSources` store (kept in `import.meta.hot.data`) receives the
 * new sources and every `ShaderLibrary` rebuilds the programs that use a changed file. A broken edit
 * keeps the last good program and shows the shader error overlay.
 */
import { ShaderSourceStore } from './gl/shaders';

const modules = import.meta.glob('./shaders/**/*.{glsl,vert,frag}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const SHADERS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(modules).map(([path, src]) => [path.replace(/^\.\/shaders\//, ''), src]),
);

interface HotData {
  store?: ShaderSourceStore;
}

const hot = import.meta.hot;
const hotData = hot ? (hot.data as HotData) : null;

/** The live shader sources of this page (survives hot updates of this module). */
export const shaderSources: ShaderSourceStore = hotData?.store ?? new ShaderSourceStore(SHADERS);

if (hot && hotData) {
  hotData.store = shaderSources;
  shaderSources.replaceAll(SHADERS);
  hot.accept();
}
