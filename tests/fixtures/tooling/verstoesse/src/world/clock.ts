/** Wall-clock and high-resolution time in the world simulation. */
export function wallClockMs(): number {
  return Date.now();
}

export function today(): Date {
  return new Date();
}

export function frameStamp(): number {
  return performance.now();
}
