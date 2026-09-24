/** Death screen (MASTERPROMPT §11.6, §26): view model, component, a standalone mount for scenarios. */
export { DeathScreen, type DeathScreenProps } from './DeathScreen';
export { DeathScreenHost, type DeathScreenHostProps } from './DeathScreenHost';
export { causeText, createDeathScreenModel, deathViewOf, penaltyLines, type DeathScreenModel, type DeathScreenSession, type DeathView } from './model';
export { mountDeathScreen, type DeathScreenHandle } from './mount';
