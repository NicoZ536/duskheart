/**
 * Shader sources, programs and hot reload (MASTERPROMPT §6.3 "Hot-Reload im Dev-Modus, Fehler-Overlay").
 *
 * - `ShaderSourceStore` holds every `.glsl/.vert/.frag` by file name. Vite's HMR (`shaderLib.ts`)
 *   replaces sources, `__dh.call('shaderEdit', …)` overrides single files at runtime.
 * - `ShaderProgram` is a registry resource: it rebuilds itself after a context restore and whenever
 *   one of its files (including `#include`s) changes. A failed rebuild keeps the last good program
 *   running and reports the `ShaderError`; a later successful build clears the report.
 */
import { compileProgram, ShaderError } from './program';
import type { GpuResource, GpuResourceRegistry } from './resources';

export type ShaderChangeListener = (changedFiles: ReadonlySet<string>) => void;

export class ShaderSourceStore {
  private readonly base = new Map<string, string>();
  private readonly overrides = new Map<string, string>();
  private readonly listeners = new Set<ShaderChangeListener>();

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [k, v] of Object.entries(initial)) this.base.set(k, v);
  }

  /** Current source of `file` (runtime override first). */
  get(file: string): string | undefined {
    return this.overrides.get(file) ?? this.base.get(file);
  }

  /** The unmodified source (without runtime override). */
  original(file: string): string | undefined {
    return this.base.get(file);
  }

  has(file: string): boolean {
    return this.base.has(file) || this.overrides.has(file);
  }

  files(): string[] {
    return [...new Set([...this.base.keys(), ...this.overrides.keys()])].sort();
  }

  isOverridden(file: string): boolean {
    return this.overrides.has(file);
  }

  /** Replaces all base sources (hot reload); notifies about every added, changed or removed file. */
  replaceAll(next: Readonly<Record<string, string>>): void {
    const changed = new Set<string>();
    for (const [k, v] of Object.entries(next)) {
      if (this.base.get(k) !== v) changed.add(k);
      this.base.set(k, v);
    }
    for (const k of [...this.base.keys()]) {
      if (!(k in next)) {
        this.base.delete(k);
        changed.add(k);
      }
    }
    this.notify(changed);
  }

  /** Sets one base source (hot reload of a single file). */
  set(file: string, source: string): void {
    if (this.base.get(file) === source) return;
    this.base.set(file, source);
    this.notify(new Set([file]));
  }

  /** Runtime override (debug `shaderEdit`); `null` restores the original. */
  override(file: string, source: string | null): void {
    if (source === null) {
      if (!this.overrides.delete(file)) return;
    } else {
      if (!this.base.has(file) && !this.overrides.has(file)) throw new Error(`Shader ${file} existiert nicht (verfügbar: ${this.files().join(', ')})`);
      this.overrides.set(file, source);
    }
    this.notify(new Set([file]));
  }

  onChange(listener: ShaderChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(changed: ReadonlySet<string>): void {
    if (changed.size === 0) return;
    for (const l of [...this.listeners]) l(changed);
  }
}

/** Receives the build state of each program: an error, or `null` once it builds again. */
export interface ShaderErrorReporter {
  report(program: string, error: ShaderError | null, hasFallback: boolean): void;
}

export interface ProgramDesc {
  readonly name: string;
  readonly vertex: string;
  readonly fragment: string;
  /** Extra `#define`s of this program (in addition to the library-wide ones). */
  readonly defines?: Readonly<Record<string, string>>;
}

export class ShaderProgram implements GpuResource {
  readonly kind = 'program';
  readonly label: string;
  private current: WebGLProgram | null = null;
  private deps: ReadonlySet<string>;
  private lastError: ShaderError | null = null;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private builds = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly desc: ProgramDesc,
    private readonly sources: ShaderSourceStore,
    private readonly globalDefines: Readonly<Record<string, string>>,
    private readonly reporter: ShaderErrorReporter,
  ) {
    this.label = desc.name;
    this.deps = new Set([desc.vertex, desc.fragment]);
  }

  /** The program in use (last successful build), `null` if it never built or the context is lost. */
  get handle(): WebGLProgram | null {
    return this.current;
  }

  get error(): ShaderError | null {
    return this.lastError;
  }

  /** Number of successful builds (tests, hot-reload statistics). */
  get buildCount(): number {
    return this.builds;
  }

  /** Files this program was built from (entry files + includes). */
  get files(): ReadonlySet<string> {
    return this.deps;
  }

  create(): void {
    this.build();
  }

  /** Rebuilds from the current sources; keeps the last good program on failure. */
  build(): boolean {
    const gl = this.gl;
    if (gl.isContextLost()) return false;
    try {
      const compiled = compileProgram(gl, {
        name: this.desc.name,
        vertexFile: this.desc.vertex,
        fragmentFile: this.desc.fragment,
        lookup: (f) => this.sources.get(f),
        defines: { ...this.globalDefines, ...this.desc.defines },
      });
      if (this.current !== null) gl.deleteProgram(this.current);
      this.current = compiled.handle;
      this.deps = compiled.files;
      this.uniforms.clear();
      this.builds++;
      if (this.lastError !== null) {
        this.lastError = null;
        this.reporter.report(this.desc.name, null, true);
      }
      return true;
    } catch (e) {
      const err = e instanceof ShaderError ? e : new ShaderError(this.desc.name, e instanceof Error ? e.message : String(e), '');
      this.lastError = err;
      this.reporter.report(this.desc.name, err, this.current !== null);
      return false;
    }
  }

  /** `useProgram`; false when no build ever succeeded (the caller skips its draw). */
  use(): boolean {
    if (this.current === null) return false;
    this.gl.useProgram(this.current);
    return true;
  }

  uniform(name: string): WebGLUniformLocation | null {
    let loc = this.uniforms.get(name);
    if (loc === undefined) {
      loc = this.current === null ? null : this.gl.getUniformLocation(this.current, name);
      this.uniforms.set(name, loc);
    }
    return loc;
  }

  release(): void {
    if (this.current !== null) this.gl.deleteProgram(this.current);
    this.current = null;
    this.uniforms.clear();
  }

  forget(): void {
    this.current = null;
    this.uniforms.clear();
  }

  bytes(): number {
    return 0;
  }
}

/** Creates programs through the registry and rebuilds those affected by a source change. */
export class ShaderLibrary {
  private readonly programs: ShaderProgram[] = [];
  private readonly unsubscribe: () => void;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly registry: GpuResourceRegistry,
    readonly sources: ShaderSourceStore,
    private readonly defines: Readonly<Record<string, string>>,
    private readonly reporter: ShaderErrorReporter,
  ) {
    this.unsubscribe = sources.onChange((changed) => this.rebuild(changed));
  }

  program(desc: ProgramDesc): ShaderProgram {
    const p = new ShaderProgram(this.gl, desc, this.sources, this.defines, this.reporter);
    this.programs.push(p);
    this.registry.add(p);
    return p;
  }

  /**
   * Rebuilds every program that uses one of `changed`, and every failing one (a program whose first
   * build failed only knows its entry files, not the includes that may hold the fix); returns how
   * many were rebuilt.
   */
  rebuild(changed: ReadonlySet<string>): number {
    let n = 0;
    for (const p of this.programs) {
      let hit = p.error !== null;
      for (const f of changed) if (p.files.has(f)) hit = true;
      if (!hit) continue;
      p.build();
      n++;
    }
    return n;
  }

  list(): readonly ShaderProgram[] {
    return this.programs;
  }

  /** Removes a program (a pass that is taken out of the pipeline). */
  release(program: ShaderProgram): void {
    const i = this.programs.indexOf(program);
    if (i < 0) return;
    this.programs.splice(i, 1);
    this.registry.remove(program);
    if (program.error !== null) this.reporter.report(program.label, null, true);
  }

  /** Programs whose last build failed. */
  failing(): ShaderProgram[] {
    return this.programs.filter((p) => p.error !== null);
  }

  dispose(): void {
    this.unsubscribe();
    for (const p of this.programs) this.registry.remove(p);
    this.programs.length = 0;
  }
}
