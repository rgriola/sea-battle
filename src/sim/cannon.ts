import {
  CANNON_DAMAGE_CREW,
  CANNON_DAMAGE_HULL,
  CANNON_DAMAGE_SAIL,
  CANNON_RANGE_FT,
  CANNON_SPEED_FT_PER_SEC,
  CANNON_SPREAD_DEG,
} from "../config/balance";
import { MAX_PROJECTILE_LIFE_SECONDS } from "../config/world";
import type { Rng } from "./rng";
import type { Broadside, GameState, ProjectileState, ShipState } from "./types";

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function hasTargetInArc(shooter: ShipState, target: ShipState, side: Broadside): boolean {
  const dx = target.xFt - shooter.xFt;
  const dy = target.yFt - shooter.yFt;
  const distance = Math.hypot(dx, dy);
  if (distance > CANNON_RANGE_FT) return false;

  const angleToTarget = Math.atan2(dy, dx);
  let rel = angleToTarget - shooter.headingRad;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;

  const relDeg = (rel * 180) / Math.PI;
  if (side === "port") return relDeg >= 40 && relDeg <= 140;
  return relDeg <= -40 && relDeg >= -140;
}

export function cannonOffset(index: number, count: number, side: Broadside, ship: ShipState): { x: number; y: number } {
  const step = ship.lengthFt / (count + 1);
  const x = -ship.lengthFt * 0.5 + step * (index + 1);
  const y = side === "port" ? ship.beamFt * 0.52 : -ship.beamFt * 0.52;
  return { x, y };
}

export function localToWorld(localX: number, localY: number, ship: ShipState): { x: number; y: number } {
  const c = Math.cos(ship.headingRad);
  const s = Math.sin(ship.headingRad);
  return {
    x: ship.xFt + localX * c - localY * s,
    y: ship.yFt + localX * s + localY * c,
  };
}

export function tickReloads(ship: ShipState, dt: number): void {
  for (let i = 0; i < ship.reloadPort.length; i += 1) {
    ship.reloadPort[i] = Math.max(0, ship.reloadPort[i] - dt);
    ship.reloadStarboard[i] = Math.max(0, ship.reloadStarboard[i] - dt);
  }
}

export function tryFireBroadside(
  game: GameState,
  shooter: ShipState,
  side: Broadside,
  rng: Rng,
  baseReloadSec: number,
): void {
  const enemies = game.ships.filter((ship) => ship.team !== shooter.team && !ship.sunk);
  if (enemies.length === 0) return;

  const hasArcTarget = enemies.some((target) => hasTargetInArc(shooter, target, side));
  if (!hasArcTarget) return;

  const reload = side === "port" ? shooter.reloadPort : shooter.reloadStarboard;
  const destroyed = side === "port" ? shooter.gunPortDestroyed : shooter.gunStarboardDestroyed;
  const sideAngle = side === "port" ? Math.PI / 2 : -Math.PI / 2;

  for (let i = 0; i < reload.length; i += 1) {
    if (destroyed[i]) continue;
    if (reload[i] > 0) continue;

    const offset = cannonOffset(i, reload.length, side, shooter);
    const muzzle = localToWorld(offset.x, offset.y, shooter);
    const spread = degToRad(rng.range(-CANNON_SPREAD_DEG, CANNON_SPREAD_DEG));
    const shotHeading = shooter.headingRad + sideAngle + spread;

    game.firingEvents.push({ xFt: muzzle.x, yFt: muzzle.y, angleRad: shotHeading, shipId: shooter.id });

    const shot: ProjectileState = {
      id: game.nextProjectileId,
      ownerShipId: shooter.id,
      team: shooter.team,
      xFt: muzzle.x,
      yFt: muzzle.y,
      vxFtPerSec: Math.cos(shotHeading) * CANNON_SPEED_FT_PER_SEC,
      vyFtPerSec: Math.sin(shotHeading) * CANNON_SPEED_FT_PER_SEC,
      lifeSec: 0,
      maxLifeSec: MAX_PROJECTILE_LIFE_SECONDS,
      damageHull: CANNON_DAMAGE_HULL,
      damageSails: CANNON_DAMAGE_SAIL,
      damageCrew: CANNON_DAMAGE_CREW,
    };

    game.nextProjectileId += 1;
    game.projectiles.push(shot);

    const crewPenalty = 1 + (1 - shooter.crew / shooter.maxCrew) * 0.35;
    reload[i] = baseReloadSec * crewPenalty;
  }
}
