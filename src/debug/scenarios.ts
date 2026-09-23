/**
 * Screenshot-/Bench-Szenarien (MASTERPROMPT §31.5): deterministisch (fester Seed, eingefrorene Zeit, festes Wetter).
 * Jedes Szenario stellt den Zustand her und meldet, ab wann das Bild stabil ist.
 */
export interface ScenarioContext {
  /** Freeze presentation time at `seconds` (the frame is then fully deterministic). */
  freezeAt(seconds: number): void;
}

export interface Scenario {
  readonly name: string;
  readonly description: string;
  /** Frames to render after setup before the image counts as stable. */
  readonly settleFrames: number;
  setup(ctx: ScenarioContext): void;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'testszene',
    description: 'M0-Testszene: Palettenrampen unter wanderndem Warmlicht mit Licht-Bänderung und Bayer-Dither',
    settleFrames: 3,
    setup(ctx) {
      ctx.freezeAt(1.7);
    },
  },
];

export function findScenario(name: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.name === name);
}
