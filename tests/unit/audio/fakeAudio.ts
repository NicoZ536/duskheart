/**
 * A recording stand-in for the Web Audio API in Node: nodes remember their connections, params their
 * automation calls, sources their start/stop times. Enough of `AudioContextLike` for the mixer, the SFX
 * player and the runtime.
 */
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  StereoPannerNodeLike,
} from '../../../src/audio/webAudio';

export class FakeParam implements AudioParamLike {
  readonly calls: Array<{ kind: string; value: number; time: number }> = [];
  constructor(public value: number) {}
  setValueAtTime(value: number, time: number): this {
    this.calls.push({ kind: 'set', value, time });
    this.value = value;
    return this;
  }
  setTargetAtTime(value: number, time: number): this {
    this.calls.push({ kind: 'target', value, time });
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.calls.push({ kind: 'ramp', value, time });
    this.value = value;
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.calls.push({ kind: 'cancel', value: this.value, time });
    return this;
  }
}

export class FakeNode implements AudioNodeLike {
  readonly outputs: AudioNodeLike[] = [];
  disconnected = false;
  constructor(readonly kind: string) {}
  connect(destination: AudioNodeLike): AudioNodeLike {
    this.outputs.push(destination);
    return destination;
  }
  disconnect(): void {
    this.disconnected = true;
    this.outputs.length = 0;
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam(1);
  constructor() {
    super('gain');
  }
}

export class FakePanner extends FakeNode implements StereoPannerNodeLike {
  readonly pan = new FakeParam(0);
  constructor() {
    super('panner');
  }
}

export class FakeFilter extends FakeNode implements BiquadFilterNodeLike {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  constructor() {
    super('filter');
  }
}

export class FakeCompressor extends FakeNode implements DynamicsCompressorNodeLike {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
  constructor() {
    super('compressor');
  }
}

export class FakeBuffer implements AudioBufferLike {
  data: Float32Array | null = null;
  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  get duration(): number {
    return this.length / this.sampleRate;
  }
  copyToChannel(source: Float32Array<ArrayBuffer>, channel: number): void {
    if (channel !== 0) throw new Error('mono only');
    this.data = source.slice();
  }
}

export class FakeSource extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  onended: ((ev: Event) => unknown) | null = null;
  startedAt: number | null = null;
  offset = 0;
  stoppedAt: number | null = null;
  constructor() {
    super('source');
  }
  start(when = 0, offset = 0): void {
    this.startedAt = when;
    this.offset = offset;
  }
  stop(when = 0): void {
    this.stoppedAt = when;
  }
  /** Ends the source as the browser would. */
  end(): void {
    this.onended?.(new Event('ended'));
  }
}

export class FakeContext implements AudioContextLike {
  currentTime = 0;
  readonly sampleRate = 48000;
  state: AudioContextState = 'running';
  readonly destination = new FakeNode('destination');
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly panners: FakePanner[] = [];
  readonly filters: FakeFilter[] = [];
  readonly compressors: FakeCompressor[] = [];
  readonly buffers: FakeBuffer[] = [];
  resumes = 0;
  suspends = 0;
  createGain(): FakeGain {
    const n = new FakeGain();
    this.gains.push(n);
    return n;
  }
  createStereoPanner(): FakePanner {
    const n = new FakePanner();
    this.panners.push(n);
    return n;
  }
  createBiquadFilter(): FakeFilter {
    const n = new FakeFilter();
    this.filters.push(n);
    return n;
  }
  createDynamicsCompressor(): FakeCompressor {
    const n = new FakeCompressor();
    this.compressors.push(n);
    return n;
  }
  createBufferSource(): FakeSource {
    const n = new FakeSource();
    this.sources.push(n);
    return n;
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    if (channels !== 1) throw new Error('mono only');
    const b = new FakeBuffer(length, sampleRate);
    this.buffers.push(b);
    return b;
  }
  resume(): Promise<void> {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspends++;
    this.state = 'suspended';
    return Promise.resolve();
  }
}

/** The chain of nodes from `node` following the first output each, ending at a node without outputs. */
export function chainOf(node: FakeNode): string[] {
  const out: string[] = [node.kind];
  let cur: AudioNodeLike | undefined = node.outputs[0];
  while (cur instanceof FakeNode) {
    out.push(cur.kind);
    cur = cur.outputs[0];
  }
  return out;
}
