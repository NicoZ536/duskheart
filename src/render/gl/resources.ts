/**
 * GPU resource registry (MASTERPROMPT §6.3 "`webglcontextlost` sauber behandeln: alle Ressourcen neu
 * aufbauen"). Every texture, buffer, render target, vertex array and program is created through the
 * registry; after `webglcontextrestored` `restoreAll()` recreates them in dependency order from the
 * data they retained (texture pixels, static buffer contents, shader sources).
 */

export type GpuResourceKind = 'texture' | 'buffer' | 'program' | 'framebuffer' | 'vertexArray';

/** Dependency order for rebuilding: render targets own textures, vertex arrays point at buffers. */
export const RESTORE_ORDER: readonly GpuResourceKind[] = ['texture', 'buffer', 'program', 'framebuffer', 'vertexArray'];

export interface GpuResource {
  readonly kind: GpuResourceKind;
  readonly label: string;
  /** (Re)create the GL objects from retained data; called on registration and after a context restore. */
  create(): void;
  /** Delete the GL objects (context alive). */
  release(): void;
  /** Drop GL handles without GL calls (context lost: the objects are already gone). */
  forget(): void;
  /** Approximate GPU memory in bytes (statistics). */
  bytes(): number;
}

export class GpuResourceRegistry {
  private readonly items: GpuResource[] = [];
  private restores = 0;

  /** Registers and creates a resource. */
  add<T extends GpuResource>(resource: T): T {
    this.items.push(resource);
    resource.create();
    return resource;
  }

  /** Releases and unregisters a resource. */
  remove(resource: GpuResource): void {
    const i = this.items.indexOf(resource);
    if (i < 0) return;
    this.items.splice(i, 1);
    resource.release();
  }

  has(resource: GpuResource): boolean {
    return this.items.includes(resource);
  }

  /** Context lost: every handle is invalid. */
  loseAll(): void {
    for (const r of this.items) r.forget();
  }

  /** Context restored: recreate everything in `RESTORE_ORDER`, keeping registration order within a kind. */
  restoreAll(): void {
    for (const kind of RESTORE_ORDER) {
      for (const r of this.items) if (r.kind === kind) r.create();
    }
    this.restores++;
  }

  releaseAll(): void {
    for (let i = this.items.length - 1; i >= 0; i--) this.items[i]?.release();
    this.items.length = 0;
  }

  get count(): number {
    return this.items.length;
  }

  /** How often the registry was rebuilt after a context loss. */
  get restoreCount(): number {
    return this.restores;
  }

  countByKind(): Record<GpuResourceKind, number> {
    const out: Record<GpuResourceKind, number> = { texture: 0, buffer: 0, program: 0, framebuffer: 0, vertexArray: 0 };
    for (const r of this.items) out[r.kind]++;
    return out;
  }

  totalBytes(): number {
    let sum = 0;
    for (const r of this.items) sum += r.bytes();
    return sum;
  }

  labels(): string[] {
    return this.items.map((r) => `${r.kind}:${r.label}`);
  }
}
