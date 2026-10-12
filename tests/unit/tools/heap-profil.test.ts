/**
 * M7-126: the hot spots of the frame-path bench name their file. The SSR loader's modules are functions, so a frame of the
 * sampling heap profile carries a script id but no url; `heapProfileOf` takes the urls by script id (the bench reads them
 * from the debugger's script list once) and `pathAllocation` names the frame `function file:line`.
 */
import { describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';

const SIZE = 4096;

/** A profile of one allocating leaf below the driver `framePathFrames`: the leaf's frame without a url, with a script id. */
function profile(leafUrl: string): unknown {
  return {
    head: {
      id: 1,
      callFrame: { functionName: '(root)', url: '', scriptId: '0', lineNumber: 0, columnNumber: 0 },
      children: [
        {
          id: 2,
          callFrame: { functionName: 'framePathFrames', url: 'file:///home/x/tools/bench/framePath.ts', scriptId: '7', lineNumber: 85, columnNumber: 0 },
          children: [{ id: 3, callFrame: { functionName: 'sampleFocus', url: leafUrl, scriptId: '42', lineNumber: 322, columnNumber: 0 }, children: [] }],
        },
      ],
    },
    samples: [{ size: SIZE, nodeId: 3 }],
  };
}

const inPath = (f: { functionName: string }): boolean => f.functionName === 'framePathFrames';

describe('Heap-Profil: Dateinamen der Frames aus der Skriptliste (M7-126)', () => {
  it('names a frame without url by its script id, as the frame-path log prints it', () => {
    const scripts = { '42': '/home/x/src/game/session.ts', '7': '/home/x/tools/bench/framePath.ts' };
    const alloc = pathAllocation(heapProfileOf(profile(''), scripts), inPath);
    expect(alloc.inPath).toBe(SIZE);
    expect(alloc.top).toEqual([{ frame: 'sampleFocus src/game/session.ts:323', bytes: SIZE }]);
  });

  it('keeps the url the profile hands over, and names no file without one', () => {
    const own = pathAllocation(heapProfileOf(profile('file:///elsewhere/src/render/post/grading.ts'), { '42': '/home/x/src/game/session.ts' }), inPath);
    expect(own.top[0]?.frame).toBe('sampleFocus src/render/post/grading.ts:323');
    const bare = pathAllocation(heapProfileOf(profile('')), inPath);
    expect(bare.top[0]?.frame).toBe('sampleFocus:323');
  });
});
