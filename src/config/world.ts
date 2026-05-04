export const WORLD_SIZE_FT = 2000;
export const HALF_WORLD_FT = WORLD_SIZE_FT / 2;
export const VIEW_SIZE_PX = 1000;
export const FEET_TO_PX = VIEW_SIZE_PX / WORLD_SIZE_FT;

export const SIM_TICK_SECONDS = 1 / 60;
export const MAX_PROJECTILE_LIFE_SECONDS = 6;

export function worldToScreenX(xFt: number): number {
  return (xFt + HALF_WORLD_FT) * FEET_TO_PX;
}

export function worldToScreenY(yFt: number): number {
  return (HALF_WORLD_FT - yFt) * FEET_TO_PX;
}
