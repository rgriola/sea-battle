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
    hullHp: 800,
    sailsHp: 400,
    crew: 100,
    massTons: 100,
    maxSpeedFtPerSec: 22,
    accelFtPerSec2: 4.2,
    turnRateDegPerSec: 28,
    cannonCountPerSide: 3,
    reloadSeconds: 18,
    lengthFt: 90 * LENGTH_SCALE,
    beamFt: 24 * BEAM_SCALE,
  },
  schooner: {
    hullHp: 1000,
    sailsHp: 500,
    crew: 120,
    massTons: 150,
    maxSpeedFtPerSec: 20,
    accelFtPerSec2: 3.8,
    turnRateDegPerSec: 23,
    cannonCountPerSide: 3,
    reloadSeconds: 20,
    lengthFt: 110 * LENGTH_SCALE,
    beamFt: 28 * BEAM_SCALE,
  },
  brigantine: {
    hullHp: 1400,
    sailsHp: 700,
    crew: 150,
    massTons: 250,
    maxSpeedFtPerSec: 18,
    accelFtPerSec2: 3.2,
    turnRateDegPerSec: 18,
    cannonCountPerSide: 3,
    reloadSeconds: 24,
    lengthFt: REFERENCE_LENGTH_FT,
    beamFt: REFERENCE_BEAM_FT,
  },
  galleon: {
    hullHp: 2200,
    sailsHp: 1100,
    crew: 220,
    massTons: 500,
    maxSpeedFtPerSec: 14,
    accelFtPerSec2: 2.3,
    turnRateDegPerSec: 12,
    cannonCountPerSide: 3,
    reloadSeconds: 30,
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
