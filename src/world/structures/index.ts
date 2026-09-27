/**
 * Structure layers of the world (MASTERPROMPT §16.1; M4-11): packed cells per build layer, the store beside the
 * terrain chunks, the build part catalog, save form and read access (collision overlay, anchors, neighbour
 * masks). The building system (src/game/building) writes them, rooms, statics, collision and the renderer read
 * them.
 */
export * from './cells';
export * from './catalog';
export * from './query';
export * from './snapshot';
export * from './store';
