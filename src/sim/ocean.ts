// Last touched by agent: 2026-05-04T19:43:00Z
// Purpose: Ocean state, wind polar diagram, and tacking geometry helpers.
import type { OceanState, ShipState } from "./types";

// NO_GO_ZONE_DEG: degrees from dead-upwind within which a ship has no sail power.
// windDirRad is the direction the wind blows TO (downwind).
// rel = heading - windDirRad → 0 = running downwind, 180 = head to wind.
export const NO_GO_ZONE_DEG = 148;

function normalizeRel(rel: number): number {
  let v = rel;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
}

function normalizeRad(angle: number): number {
  let v = angle;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
}

function windStrengthFromKnots(knots: number): number {
  return Math.max(0, Math.min(1, (knots - 5) / 5));
}

export function updateOcean(ocean: OceanState, dt: number, rngValue: number): void {
  ocean.timeSec += dt;
  ocean.windStrength = windStrengthFromKnots(ocean.windSpeedKnots);

  if (ocean.timeSec < ocean.nextShiftSec) return;

  const shiftSign = rngValue < 0.5 ? -1 : 1;
  const absDeg = 5 + rngValue * 5;
  const shiftRad = absDeg * (Math.PI / 180);

  ocean.windDirRad = normalizeRad(ocean.initialWindDirRad + shiftSign * shiftRad);
  ocean.nextShiftSec += 60;
}

/**
 * Polar diagram for square-rigged ships (1650-1875).
 * rel=0 running downwind → 0.90; broad reach ~45° → 1.05 peak;
 * beam reach 90° → 0.85; close-hauled 130° → 0.35; no-go >148° → 0.06.
 */
export function windSpeedMultiplier(ship: ShipState, ocean: OceanState): number {
  const deg = Math.abs(normalizeRel(ship.headingRad - ocean.windDirRad)) * (180 / Math.PI);

  let pct: number;
  if (deg > NO_GO_ZONE_DEG) {
    pct = 0.06;
  } else if (deg > 128) {
    // close hauled: 0.06 → 0.38
    pct = 0.06 + ((NO_GO_ZONE_DEG - deg) / (NO_GO_ZONE_DEG - 128)) * 0.32;
  } else if (deg > 90) {
    // close reach → beam: 0.38 → 0.85
    pct = 0.38 + ((128 - deg) / 38) * 0.47;
  } else if (deg > 40) {
    // beam → broad reach (sweet spot): 0.85 → 1.05
    pct = 0.85 + ((90 - deg) / 50) * 0.20;
  } else {
    // broad reach → running: 1.05 → 0.90
    pct = 1.05 - ((40 - deg) / 40) * 0.15;
  }

  const windStrength = windStrengthFromKnots(ocean.windSpeedKnots);
  return pct * (0.45 + windStrength * 0.55);
}

/** Returns true when the given heading is inside the no-go zone (nearly no sail power). */
export function isHeadingInNoGoZone(headingRad: number, ocean: OceanState): boolean {
  return Math.abs(normalizeRel(headingRad - ocean.windDirRad)) * (180 / Math.PI) > NO_GO_ZONE_DEG;
}

/**
 * Closest close-hauled headings on each tack (just outside the no-go zone).
 * Port tack: wind on port (left) side. Starboard tack: wind on right side.
 */
export function tackHeadings(ocean: OceanState): { port: number; starboard: number } {
  const CLOSE_HAULED_REL = (NO_GO_ZONE_DEG - 15) * (Math.PI / 180);
  return {
    port: ocean.windDirRad + CLOSE_HAULED_REL,
    starboard: ocean.windDirRad - CLOSE_HAULED_REL,
  };
}
