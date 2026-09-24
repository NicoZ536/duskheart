/**
 * Chunk streaming and active zone (docs/WORLD.md §5, M2-22/M2-27): streaming configuration, chunk
 * diffs, the chunk worker API, the chunk manager, the catch-up registry and the active zone.
 */
export * from './activeZone';
export * from './catchUp';
export * from './chunkManager';
export * from './config';
export * from './diff';
export * from './worker';
