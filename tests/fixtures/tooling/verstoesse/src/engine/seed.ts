/** Engine core: the frame clock may be read here, but randomness must come from the seeded Rng. */
export function frameClock(): number {
  return performance.now();
}

export function randomSeed(): number {
  return Math.random();
}
