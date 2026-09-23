/** Content data may contain plain numbers (units and reasons live next to the data). */
export function rainTemperatureOffset(heavy: boolean): number {
  return heavy ? -5 : -3;
}
