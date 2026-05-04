// Last touched by agent: 2026-05-04T00:00:00Z
// Purpose: Enemy AI with finite-state steering and wind-aware tacking behavior.
import { CANNON_RANGE_FT, SHIP_BALANCE } from "../config/balance";
import { isHeadingInNoGoZone, tackHeadings } from "./ocean";
import type { GameState, ShipState } from "./types";

const TACK_DURATION_SEC = 11;
const EDGE_THRESHOLD_FT = 860;
const ALLY_AVOID_RADIUS_FT = 190;
const ALLY_BLOCK_RADIUS_FT = 130;

function normalizeAngle(rad: number): number {
  let value = rad;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function signedAngleToTarget(ship: ShipState, target: ShipState): number {
  const angleToTarget = Math.atan2(target.yFt - ship.yFt, target.xFt - ship.xFt);
  return normalizeAngle(angleToTarget - ship.headingRad);
}

function steerTowardHeading(ship: ShipState, targetHeading: number): void {
  const rel = normalizeAngle(targetHeading - ship.headingRad);
  if (Math.abs(rel) < 0.12) {
    ship.rudder = 0;
  } else {
    ship.rudder = rel > 0 ? 0.8 : -0.8;
  }
}

function readyCannons(ship: ShipState): { port: number; starboard: number } {
  return {
    port: ship.reloadPort.filter((timer) => timer <= 0).length,
    starboard: ship.reloadStarboard.filter((timer) => timer <= 0).length,
  };
}

function broadsideHeading(angleToTarget: number, side: "port" | "starboard"): number {
  return side === "port" ? angleToTarget - Math.PI / 2 : angleToTarget + Math.PI / 2;
}

function computeAllyAvoidance(
  ship: ShipState,
  ships: ShipState[],
): { rudderBias: number; throttleScale: number } {
  let avoidX = 0;
  let avoidY = 0;
  let throttleScale = 1;

  for (const ally of ships) {
    if (ally.id === ship.id || ally.team !== ship.team || ally.sunk) continue;

    const dx = ally.xFt - ship.xFt;
    const dy = ally.yFt - ship.yFt;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-3) continue;

    if (dist < ALLY_AVOID_RADIUS_FT) {
      const weight = (ALLY_AVOID_RADIUS_FT - dist) / ALLY_AVOID_RADIUS_FT;
      avoidX += (-dx / dist) * weight;
      avoidY += (-dy / dist) * weight;
    }

    if (dist < ALLY_BLOCK_RADIUS_FT) {
      const angleToAlly = Math.atan2(dy, dx);
      const rel = normalizeAngle(angleToAlly - ship.headingRad);
      if (Math.abs(rel) < 0.55) {
        throttleScale = Math.min(throttleScale, 0.56);
      }
    }
  }

  if (Math.abs(avoidX) < 1e-5 && Math.abs(avoidY) < 1e-5) {
    return { rudderBias: 0, throttleScale };
  }

  const avoidHeading = Math.atan2(avoidY, avoidX);
  const relAvoid = normalizeAngle(avoidHeading - ship.headingRad);
  const rudderBias = Math.max(-0.65, Math.min(0.65, relAvoid * 0.55));
  return { rudderBias, throttleScale };
}

function getRolePlan(ship: ShipState, player: ShipState): {
  targetX: number;
  targetY: number;
  preferredRange: number;
  throttleNear: number;
  throttleFar: number;
} {
  const role = ship.aiRole ?? "interceptor";

  if (role === "flanker") {
    const flankSide = ship.tackSide === "port" ? 1 : -1;
    const offset = CANNON_RANGE_FT * 0.32;
    const targetX = player.xFt + -Math.sin(player.headingRad) * flankSide * offset;
    const targetY = player.yFt + Math.cos(player.headingRad) * flankSide * offset;
    return {
      targetX,
      targetY,
      preferredRange: CANNON_RANGE_FT * 0.72,
      throttleNear: 0.58,
      throttleFar: 0.95,
    };
  }

  if (role === "brawler") {
    return {
      targetX: player.xFt,
      targetY: player.yFt,
      preferredRange: CANNON_RANGE_FT * 0.48,
      throttleNear: 0.7,
      throttleFar: 1,
    };
  }

  if (role === "cautious") {
    const keepDistance = CANNON_RANGE_FT * 0.96;
    const retreatX = player.xFt - Math.cos(player.headingRad) * keepDistance;
    const retreatY = player.yFt - Math.sin(player.headingRad) * keepDistance;
    return {
      targetX: retreatX,
      targetY: retreatY,
      preferredRange: keepDistance,
      throttleNear: 0.42,
      throttleFar: 0.74,
    };
  }

  // interceptor
  return {
    targetX: player.xFt,
    targetY: player.yFt,
    preferredRange: CANNON_RANGE_FT * 0.66,
    throttleNear: 0.62,
    throttleFar: 0.92,
  };
}

export function runEnemyAi(
  game: GameState,
  dt: number,
): { firePort: Set<number>; fireStarboard: Set<number> } {
  const firePort = new Set<number>();
  const fireStarboard = new Set<number>();
  const player = game.ships.find((ship) => ship.team === "player" && !ship.sunk);
  if (!player) return { firePort, fireStarboard };

  for (const ship of game.ships) {
    if (ship.team !== "enemy" || ship.sunk) continue;

    ship.aiDebugState = `${ship.aiRole ?? "interceptor"}: assess`;

    const rolePlan = getRolePlan(ship, player);
    const dx = rolePlan.targetX - ship.xFt;
    const dy = rolePlan.targetY - ship.yFt;
    const dist = Math.hypot(dx, dy);
    const angleToPlayer = Math.atan2(player.yFt - ship.yFt, player.xFt - ship.xFt);
    const desiredHeading = Math.atan2(dy, dx);
    const ready = readyCannons(ship);
    const preferredBroadside = ready.port >= ready.starboard ? "port" : "starboard";
    const anyBroadsideReady = ready.port > 0 || ready.starboard > 0;

    // ── Edge avoidance overrides everything ──────────────────────────────────
    const nearEdge =
      Math.abs(ship.xFt) > EDGE_THRESHOLD_FT || Math.abs(ship.yFt) > EDGE_THRESHOLD_FT;
    if (nearEdge) {
      const centerAngle = Math.atan2(-ship.yFt, -ship.xFt);
      steerTowardHeading(ship, centerAngle);
      ship.throttle = 1;
      ship.aiDebugState = `${ship.aiRole ?? "interceptor"}: recover edge`;
      // tacking still applies if the center angle is also upwind
    }

    // ── Wind-aware steering / tacking ────────────────────────────────────────
    if (!nearEdge) {
      if (isHeadingInNoGoZone(desiredHeading, game.ocean)) {
        // Target is in the upwind no-go cone — start or continue tacking
        ship.tackTimer -= dt;
        if (ship.tackTimer <= 0) {
          ship.tackSide = ship.tackSide === "port" ? "starboard" : "port";
          ship.tackTimer = TACK_DURATION_SEC;
        }

        const tacks = tackHeadings(game.ocean);
        steerTowardHeading(ship, ship.tackSide === "port" ? tacks.port : tacks.starboard);
        ship.throttle = 0.95;
        ship.aiDebugState = `${ship.aiRole ?? "interceptor"}: tack ${ship.tackSide}`;
      } else {
        // Tactical steering: set up a broadside when loaded, disengage while reloading.
        ship.tackTimer = 0;
        const rel = signedAngleToTarget(ship, player);
        const absRelDeg = Math.abs(rel) * (180 / Math.PI);

        if (anyBroadsideReady) {
          const setupHeading = broadsideHeading(angleToPlayer, preferredBroadside);
          steerTowardHeading(ship, setupHeading);
          ship.throttle = dist > rolePlan.preferredRange ? rolePlan.throttleFar : Math.max(0.46, rolePlan.throttleNear);
          ship.aiDebugState = `${ship.aiRole ?? "interceptor"}: set ${preferredBroadside} broadside`;
        } else {
          const disengageSign = ship.tackSide === "port" ? 1 : -1;
          const disengageHeading = angleToPlayer + disengageSign * 2.15;
          steerTowardHeading(ship, disengageHeading);
          ship.throttle = Math.min(0.88, rolePlan.throttleFar);
          ship.aiDebugState = `${ship.aiRole ?? "interceptor"}: reload disengage`;

          if (absRelDeg < 35 && dist < rolePlan.preferredRange * 0.9) {
            ship.throttle = Math.min(ship.throttle, 0.56);
            ship.aiDebugState = `${ship.aiRole ?? "interceptor"}: avoid bow-in`;
          }
        }
      }
    }

    const avoid = computeAllyAvoidance(ship, game.ships);
    ship.rudder = Math.max(-1, Math.min(1, ship.rudder + avoid.rudderBias));
    ship.throttle = Math.max(0.35, ship.throttle * avoid.throttleScale);
    if (avoid.rudderBias !== 0 || avoid.throttleScale < 1) {
      ship.aiDebugState = `${ship.aiRole ?? "interceptor"}: avoid ally`;
    }

    // ── Fire decisions ────────────────────────────────────────────────────────
    const relToPlayer = signedAngleToTarget(ship, player);
    const role = ship.aiRole ?? "interceptor";
    const fireRange = role === "cautious" ? CANNON_RANGE_FT * 0.88 : CANNON_RANGE_FT;
    const fireArcInner = role === "cautious" ? 0.95 : 0.7;
    const fireArcOuter = role === "cautious" ? 2.15 : 2.4;

    if (ready.port > 0 && relToPlayer > fireArcInner && relToPlayer < fireArcOuter && dist < fireRange) {
      firePort.add(ship.id);
      ship.aiDebugState = `${ship.aiRole ?? "interceptor"}: fire port`;
    }
    if (ready.starboard > 0 && relToPlayer < -fireArcInner && relToPlayer > -fireArcOuter && dist < fireRange) {
      fireStarboard.add(ship.id);
      ship.aiDebugState = `${ship.aiRole ?? "interceptor"}: fire stbd`;
    }

    // ── Crew penalty ─────────────────────────────────────────────────────────
    if (ship.crew / ship.maxCrew < 0.4) {
      ship.throttle = Math.max(0.5, ship.throttle - 0.2);
      ship.aiDebugState = `${ship.aiRole ?? "interceptor"}: crew hurt`;
    }

    if (ship.rudderHp / ship.maxRudderHp < 0.45) {
      ship.throttle = Math.min(ship.throttle, 0.62);
      ship.aiDebugState = `${ship.aiRole ?? "interceptor"}: rudder hurt`;
    }

    const b = SHIP_BALANCE[ship.shipClass];
    if (ship.speedFtPerSec > b.maxSpeedFtPerSec) {
      ship.speedFtPerSec = b.maxSpeedFtPerSec;
    }
  }

  return { firePort, fireStarboard };
}
