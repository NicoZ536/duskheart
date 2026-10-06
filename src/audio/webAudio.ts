/**
 * The slice of the Web Audio API the audio kernel uses, as structural interfaces: the browser's
 * `AudioContext` satisfies them (`asAudioContextLike` checks that at compile time), and unit tests in
 * Node drive the mixer and the player with a recording fake of the same shape.
 */

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  cancelScheduledValues(startTime: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  readonly pan: AudioParamLike;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  readonly threshold: AudioParamLike;
  readonly knee: AudioParamLike;
  readonly ratio: AudioParamLike;
  readonly attack: AudioParamLike;
  readonly release: AudioParamLike;
}

export interface AudioBufferLike {
  readonly duration: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  copyToChannel(source: Float32Array<ArrayBuffer>, channelNumber: number, bufferOffset?: number): void;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  readonly playbackRate: AudioParamLike;
  onended: ((ev: Event) => unknown) | null;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

/** Convolution reverb (the procedural halls of src/audio/reverb.ts). */
export interface ConvolverNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  normalize: boolean;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: AudioContextState;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createStereoPanner(): StereoPannerNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createDynamicsCompressor(): DynamicsCompressorNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createConvolver(): ConvolverNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
}

/** The browser's context as the kernel's interface (compile-time check that it fits). */
export function asAudioContextLike(ctx: AudioContext): AudioContextLike {
  return ctx;
}
