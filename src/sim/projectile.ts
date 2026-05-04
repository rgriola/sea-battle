import { HALF_WORLD_FT } from "../config/world";
import { distanceSq, getShipLocalPoint, pointInShipObb } from "./collision";
import type { GameState } from "./types";

export function updateProjectiles(game: GameState, dt: number): void {
  const alive = [];

  for (const projectile of game.projectiles) {
    projectile.xFt += projectile.vxFtPerSec * dt;
    projectile.yFt += projectile.vyFtPerSec * dt;
    projectile.lifeSec += dt;

    const inBounds =
      projectile.xFt >= -HALF_WORLD_FT &&
      projectile.xFt <= HALF_WORLD_FT &&
      projectile.yFt >= -HALF_WORLD_FT &&
      projectile.yFt <= HALF_WORLD_FT;

    if (!inBounds || projectile.lifeSec > projectile.maxLifeSec) {
      continue;
    }

    let hit = false;
    for (const ship of game.ships) {
      if (ship.sunk || ship.team === projectile.team || ship.id === projectile.ownerShipId) {
        continue;
      }

      const broadRadius = Math.max(ship.lengthFt, ship.beamFt) * 0.55;
      if (distanceSq(projectile.xFt, projectile.yFt, ship.xFt, ship.yFt) > broadRadius * broadRadius) {
        continue;
      }

      if (!pointInShipObb(projectile.xFt, projectile.yFt, ship)) {
        continue;
      }

      const localHit = getShipLocalPoint(projectile.xFt, projectile.yFt, ship);
      const aftFactor = Math.max(0, (-localHit.x - ship.lengthFt * 0.18) / (ship.lengthFt * 0.32));
      const centerlineFactor = Math.max(0, 1 - Math.abs(localHit.y) / (ship.beamFt * 0.55));
      const rudderDamage = Math.round(14 * aftFactor * centerlineFactor);

      ship.hullHp = Math.max(0, ship.hullHp - projectile.damageHull);
      ship.sailsHp = Math.max(0, ship.sailsHp - projectile.damageSails);
      ship.crew = Math.max(1, ship.crew - projectile.damageCrew);

      // 22% chance to destroy one intact gun on the hit hull side
      if (Math.random() < 0.22) {
        const hitPort = localHit.y > 0;
        const gunArray = hitPort ? ship.gunPortDestroyed : ship.gunStarboardDestroyed;
        const intactIndices = gunArray.map((d, i) => (d ? -1 : i)).filter((i) => i >= 0);
        if (intactIndices.length > 0) {
          const victim = intactIndices[Math.floor(Math.random() * intactIndices.length)];
          gunArray[victim] = true;
        }
      }

      if (rudderDamage > 0) {
        ship.rudderHp = Math.max(0, ship.rudderHp - rudderDamage);
      }

      game.damageEvents.push({
        xFt: ship.xFt,
        yFt: ship.yFt,
        amount: projectile.damageHull,
        targetTeam: ship.team,
        kind: "cannon",
      });
      if (rudderDamage > 0) {
        game.damageEvents.push({
          xFt: ship.xFt,
          yFt: ship.yFt,
          amount: rudderDamage,
          targetTeam: ship.team,
          kind: "rudder",
        });
      }

      if (ship.hullHp <= 0) {
        ship.sunk = true;
        ship.speedFtPerSec = 0;
        ship.throttle = 0;
        ship.rudder = 0;
      }

      game.impactEvents.push({ xFt: projectile.xFt, yFt: projectile.yFt });
      hit = true;
      break;
    }

    if (!hit) alive.push(projectile);
  }

  game.projectiles = alive;
}
