/** Meals (docs/SPIEL.md §21, M7-26 … M7-28; strand E): boredom, salt, comfort, meal and potion effects through the eat hook. */
export { FOOD_POISONING, MEALS_RNG_STREAM, MEALS_SAVE_VERSION, MEALS_SYSTEM_ID, MealsSystem, type DiningHallCheck, type MealsLife, type MealsSystemDeps } from './system';
export { bored, comfortOf, countsForBoredom, decayedBoredom, effectSeconds, fromKitchen, isRawMeat, KITCHEN_DATA_KEY, mealNutrition, RAW_MEAT_GROUP } from './formulas';
export { MEAL_EVENT_TYPES, type MealEventMap } from './events';
export { cookingPlaceFurniture, diningHallCheck, DINING_HALL_TYPE, kitchenFireCheck, kitchenProductMark, kitchenRoomTypeAt, type CookingPlaceStations, type KitchenFires, type KitchenRoom, type KitchenRooms, type RoomTypeAt } from './kitchen';
export type { MealEffect, MealsApi } from './types';
