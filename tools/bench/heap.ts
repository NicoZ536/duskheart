/**
 * Evaluation of sampling heap profiles (CDP/`node:inspector` `HeapProfiler`, objects already collected
 * by a minor or major GC included) for the allocation budget of the render frame path (M1-12
 * „Heap-Profil zeigt keine Allokation im Frame-Pfad“, §30 „Keine Allokationen in Hot-Loops“): a
 * sample belongs to the path when a frame of its call stack is the path's driver function; the
 * hot spots are the innermost frames of those samples. Pure functions; the sampling runs in
 * `render.ts`, the frame path in `framePath.ts`.
 */

export interface HeapCallFrame {
  readonly functionName: string;
  readonly url: string;
  /** 0-based line of the function start. */
  readonly lineNumber: number;
}

/** A call-tree node of a sampling heap profile (`HeapProfiler.SamplingHeapProfileNode`). */
export interface HeapProfileNode {
  readonly id: number;
  readonly callFrame: HeapCallFrame;
  readonly children: readonly HeapProfileNode[];
}

/** One sampled allocation (`HeapProfiler.SamplingHeapProfileSample`). */
export interface HeapProfileSample {
  readonly size: number;
  readonly nodeId: number;
}

export interface HeapProfile {
  readonly head: HeapProfileNode;
  readonly samples: readonly HeapProfileSample[];
}

export interface PathAllocation {
  /** Bytes of all samples. */
  readonly total: number;
  /** Bytes of the samples whose stack passes through the path. */
  readonly inPath: number;
  /** Innermost frames (`function:line`) of the path's samples with the most bytes, for the bench log. */
  readonly top: readonly { readonly frame: string; readonly bytes: number }[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function nodeOf(raw: unknown): HeapProfileNode {
  if (!isRecord(raw) || typeof raw['id'] !== 'number' || !isRecord(raw['callFrame']) || !Array.isArray(raw['children'])) throw new Error('Heap-Profil: Knoten ohne id, callFrame oder children');
  const f = raw['callFrame'];
  const callFrame: HeapCallFrame = {
    functionName: typeof f['functionName'] === 'string' ? f['functionName'] : '',
    url: typeof f['url'] === 'string' ? f['url'] : '',
    lineNumber: typeof f['lineNumber'] === 'number' ? f['lineNumber'] : 0,
  };
  return { id: raw['id'], callFrame, children: raw['children'].map(nodeOf) };
}

/**
 * Checks the result of `HeapProfiler.stopSampling` (the Node typings lag behind the protocol: they
 * declare neither node ids nor `samples`, the individual allocations).
 */
export function heapProfileOf(raw: unknown): HeapProfile {
  if (!isRecord(raw) || !Array.isArray(raw['samples'])) throw new Error('Heap-Profil: keine Stichproben (samples)');
  const samples = raw['samples'].map((s: unknown): HeapProfileSample => {
    if (!isRecord(s) || typeof s['size'] !== 'number' || typeof s['nodeId'] !== 'number') throw new Error('Heap-Profil: Stichprobe ohne size oder nodeId');
    return { size: s['size'], nodeId: s['nodeId'] };
  });
  return { head: nodeOf(raw['head']), samples };
}

/** Hot spots listed per measurement. */
const TOP_FRAMES = 5;

function frameName(f: HeapCallFrame): string {
  const file = f.url.replace(/^.*\/(src|tools)\//, '$1/').replace(/\?.*$/, '');
  return `${f.functionName || '(anonym)'}${file ? ` ${file}` : ''}:${f.lineNumber + 1}`;
}

/** Sums the sampled bytes of `profile` and the share allocated below a frame that `inPath` accepts. */
export function pathAllocation(profile: HeapProfile, inPath: (frame: HeapCallFrame) => boolean): PathAllocation {
  const byId = new Map<number, HeapProfileNode>();
  const parent = new Map<number, HeapProfileNode>();
  const stack: HeapProfileNode[] = [profile.head];
  while (stack.length > 0) {
    const n = stack.pop() as HeapProfileNode;
    byId.set(n.id, n);
    for (const c of n.children) {
      parent.set(c.id, n);
      stack.push(c);
    }
  }
  let total = 0;
  let bytes = 0;
  const hot = new Map<string, number>();
  for (const s of profile.samples) {
    total += s.size;
    const leaf = byId.get(s.nodeId);
    let n = leaf;
    while (n !== undefined && !inPath(n.callFrame)) n = parent.get(n.id);
    if (n === undefined || leaf === undefined) continue;
    bytes += s.size;
    const name = frameName(leaf.callFrame);
    hot.set(name, (hot.get(name) ?? 0) + s.size);
  }
  const top = [...hot.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_FRAMES)
    .map(([frame, b]) => ({ frame, bytes: b }));
  return { total, inPath: bytes, top };
}
