/** GLSL source library: every `.glsl`/`.vert`/`.frag` in src/render/shaders, keyed by file name (for #include). */
const modules = import.meta.glob('./shaders/**/*.{glsl,vert,frag}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const SHADERS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(modules).map(([path, src]) => [path.replace(/^\.\/shaders\//, ''), src]),
);

export function shader(name: string): string {
  const src = SHADERS[name];
  if (src === undefined) throw new Error(`Shader ${name} fehlt`);
  return src;
}
