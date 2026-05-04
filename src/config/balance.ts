// Last touched by agent: 2026-05-04T19:35:00Z
export type ShipClass = "sloop" | "schooner" | "brigantine" | "galleon";

export type ShipBalance = {
  hullHp: number;
  sailsHp: number;
  crew: number;
  massTons: number;
  maxSpeedFtPerSec: number;
  accelFtPerSec2: number;
  turnRateDegPerSec: number;
  cannonCountPerSide: number;
  reloadSeconds: number;
  lengthFt: number;
  beamFt: number;
};

// Reference hull from the user-provided dimensions.
const REFERENCE_LENGTH_FT = 114 + 7 / 12; // 114 ft 7 in
const REFERENCE_BEAM_FT = 32 + 3 / 12; // 32 ft 3 in

// Prior prototype proportions used brigantine as 130 x 32.
const LENGTH_SCALE = REFERENCE_LENGTH_FT / 130;
const BEAM_SCALE = REFERENCE_BEAM_FT / 32;

export const SHIP_BALANCE: Record<ShipClass, ShipBalance> = {
  sloop: {
    hullHp: 760,
    sailsHp: 420,
    crew: 90,
    massTons: 90,
    maxSpeedFtPerSec: 24,
    accelFtPerSec2: 4.8,
    turnRateDegPerSec: 31,
    cannonCountPerSide: 2,
    reloadSeconds: 15,
    lengthFt: 82 * LENGTH_SCALE,
    beamFt: 22 * BEAM_SCALE,
  },
  schooner: {
    hullHp: 980,
    sailsHp: 560,
    crew: 120,
    massTons: 140,
    maxSpeedFtPerSec: 21,
    accelFtPerSec2: 4.1,
    turnRateDegPerSec: 25,
    cannonCountPerSide: 3,
    reloadSeconds: 18,
    lengthFt: 102 * LENGTH_SCALE,
    beamFt: 27 * BEAM_SCALE,
  },
  brigantine: {
    hullHp: 1400,
    sailsHp: 700,
    crew: 165,
    massTons: 240,
    maxSpeedFtPerSec: 18.5,
    accelFtPerSec2: 3.3,
    turnRateDegPerSec: 19,
    cannonCountPerSide: 4,
    reloadSeconds: 23,
    lengthFt: REFERENCE_LENGTH_FT,
    beamFt: REFERENCE_BEAM_FT,
  },
  galleon: {
    hullHp: 2550,
    sailsHp: 1200,
    crew: 260,
    massTons: 560,
    maxSpeedFtPerSec: 13.2,
    accelFtPerSec2: 2.05,
    turnRateDegPerSec: 10,
    cannonCountPerSide: 5,
    reloadSeconds: 29,
    lengthFt: 170 * LENGTH_SCALE,
    beamFt: 42 * BEAM_SCALE,
  },
};

export const CANNON_DAMAGE_HULL = 34;
export const CANNON_DAMAGE_SAIL = 12;
export const CANNON_DAMAGE_CREW = 6;
export const CANNON_SPEED_FT_PER_SEC = 265;
export const CANNON_RANGE_FT = 820;
export const CANNON_SPREAD_DEG = 2.5;
