import { HALF_WORLD_FT } from "../config/world";
import type { ShipBalance, ShipClass } from "../config/balance";
import { SHIP_BALANCE } from "../config/balance";
import type { ShipState, Team } from "./types";
import { windSpeedMultiplier } from "./ocean";
import type { OceanState } from "./types";

export function createShip(id: number, shipClass: ShipClass, team: Team, xFt: number, yFt: number, headingRad: number): ShipState {
  const b = SHIP_BALANCE[shipClass];
  return {
    id,
    shipClass,
    team,
    xFt,
    yFt,
    headingRad,
    speedFtPerSec: 0,
    throttle: 0,
    sailTrim: 0,
    sailTrimCooldown: 0,
    rudder: 0,
    rudderAngleDeg: 0,
    rudderTapCooldown: 0,
    yawRateRad: 0,
    hullHp: b.hullHp,
    sailsHp: b.sailsHp,
    crew: b.crew,
    rudderHp: Math.max(80, Math.round(b.hullHp * 0.14)),
    maxHullHp: b.hullHp,
    maxSailsHp: b.sailsHp,
    maxCrew: b.crew,
    maxRudderHp: Math.max(80, Math.round(b.hullHp * 0.14)),
    lengthFt: b.lengthFt,
    beamFt: b.beamFt,
    reloadPort: new Array(b.cannonCountPerSide).fill(0),
    reloadStarboard: new Array(b.cannonCountPerSide).fill(0),
    gunPortDestroyed: new Array(b.cannonCountPerSide).fill(false),
    gunStarboardDestroyed: new Array(b.cannonCountPerSide).fill(false),
    sunk: false,
    tackSide: "port",
    tackTimer: 0,
    ramCooldownSec: 0,
    aiRole: null,
    aiDebugState: "idle",
  };
}

export function getShipBalance(ship: ShipState): ShipBalance {
  return SHIP_BALANCE[ship.shipClass];
}

export function updateShipKinematics(ship: ShipState, ocean: OceanState, dt: number): void {
  if (ship.sunk) return;

  const b = getShipBalance(ship);
  const massFactor = b.massTons / 100; // 1.0 for sloop baseline
  const sailFactor = Math.max(0.35, ship.sailsHp / ship.maxSailsHp);
  const rudderFactor = Math.max(0.12, ship.rudderHp / ship.maxRudderHp);
  const windFactor = windSpeedMultiplier(ship, ocean);

  // --- Speed: sail thrust vs. drag-based deceleration ---
  const maxSpeed = b.maxSpeedFtPerSec * sailFactor * windFactor;
  const accel = b.accelFtPerSec2 * Math.max(0.2, sailFactor);
  const targetSpeed = Math.max(0, ship.throttle) * maxSpeed;

  if (ship.speedFtPerSec < targetSpeed) {
    // Accelerating: sails provide thrust
    ship.speedFtPerSec = Math.min(targetSpeed, ship.speedFtPerSec + accel * dt);
  } else {
    // Decelerating: hull drag proportional to speed / massFactor
    // Heavier ships coast much longer (galleon ~2-3 min, sloop ~15s)
    const dragDecel = Math.max(
      0.02,
      (accel * 1.15 * ship.speedFtPerSec) / (b.maxSpeedFtPerSec * massFactor),
    );
    ship.speedFtPerSec = Math.max(targetSpeed, ship.speedFtPerSec - dragDecel * dt);
    // Snap to zero at very low speed to avoid infinite coast
    if (ship.speedFtPerSec < 0.05) ship.speedFtPerSec = 0;
  }

  // --- Yaw: angular momentum via first-order lag ---
  // Rudder only steers when water flows over it (speed-gated)
  const turnRateRad = (b.turnRateDegPerSec * Math.PI) / 180;
  const flowFactor = Math.min(1, ship.speedFtPerSec / Math.max(0.01, b.maxSpeedFtPerSec * 0.4));
  const yawRateTarget = -ship.rudder * turnRateRad * flowFactor * rudderFactor;
  // Heavier ships take longer to reach/shed target yaw rate
  const yawTimeConstant = 0.5 * massFactor; // sloop 0.5s, galleon 2.5s
  ship.yawRateRad += (yawRateTarget - ship.yawRateRad) * Math.min(1, dt / yawTimeConstant);
  ship.headingRad += ship.yawRateRad * dt;

  // --- Hull windage: bare hull drifts in wind direction even with sails furled ---
  // Scaled by beam area; ~0.25-0.5 knots at max wind strength
  const windageFtPerSec = 0.013 * ocean.windStrength * b.beamFt;
  ship.xFt += Math.cos(ocean.windDirRad) * windageFtPerSec * dt;
  ship.yFt += Math.sin(ocean.windDirRad) * windageFtPerSec * dt;

  // --- Forward motion ---
  ship.xFt += Math.cos(ship.headingRad) * ship.speedFtPerSec * dt;
  ship.yFt += Math.sin(ship.headingRad) * ship.speedFtPerSec * dt;
}
