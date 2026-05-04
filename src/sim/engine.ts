import { SHIP_BALANCE } from "../config/balance";
import { SIM_TICK_SECONDS } from "../config/world";
import { getMap, type MapType } from "../config/maps";
import { latLonToFt } from "./coordinates";
import { runEnemyAi } from "./ai";
import { tickReloads, tryFireBroadside } from "./cannon";
import { resolveShipCollisions } from "./collision";
import { updateOcean } from "./ocean";
import { updateProjectiles } from "./projectile";
import { createRng, type Rng } from "./rng";
import { createShip, getShipBalance, updateShipKinematics } from "./ship";
import type { EnemyRole, GameState, InputState } from "./types";

function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function assignEnemyRoles(game: GameState, rng: Rng): void {
  const enemies = game.ships.filter((ship) => ship.team === "enemy");
  if (enemies.length === 0) return;

  const aggressivePool: EnemyRole[] = ["interceptor", "flanker", "brawler"];

  // In the common 2v1 setup, guarantee one cautious ship to reduce all-in pressure.
  if (enemies.length === 2) {
    const order = [...enemies];
    shuffleInPlace(order, rng);
    order[0].aiRole = "cautious";
    order[1].aiRole = aggressivePool[Math.floor(rng.next() * aggressivePool.length)];
    return;
  }

  const pool: EnemyRole[] = ["cautious", "interceptor", "flanker", "brawler"];
  for (const enemy of enemies) {
    enemy.aiRole = pool[Math.floor(rng.next() * pool.length)];
  }
}

export function createInitialGame(mapType: MapType = "open-ocean", seed = 42): { game: GameState; rng: Rng } {
  const rng = createRng(seed);
  const map = getMap(mapType);
  const initialWindDirRad = rng.next() * Math.PI * 2 - Math.PI;
  const initialWindSpeedKnots = 5 + rng.next() * 5;

  // Convert map lat/lon spawn points to ft-space
  const playerPos = latLonToFt(map.playerSpawnLat, map.playerSpawnLon, map.bounds.centerLat, map.bounds.centerLon);
  const enemyPos = latLonToFt(map.enemySpawnLat, map.enemySpawnLon, map.bounds.centerLat, map.bounds.centerLon);
  const spawnEnemyOne =
    mapType === "open-ocean"
      ? { xFt: playerPos.xFt + 1200, yFt: playerPos.yFt + 350, headingRad: Math.PI }
      : { xFt: enemyPos.xFt + 300, yFt: enemyPos.yFt + 100, headingRad: Math.PI };
  const spawnEnemyTwo =
    mapType === "open-ocean"
      ? { xFt: playerPos.xFt + 1650, yFt: playerPos.yFt - 420, headingRad: Math.PI * 0.85 }
      : { xFt: enemyPos.xFt + 200, yFt: enemyPos.yFt - 150, headingRad: Math.PI * 0.85 };

  const game: GameState = {
    tick: 0,
    nextProjectileId: 1,
    ships: [
      createShip(1, "sloop", "player", playerPos.xFt, playerPos.yFt, 0),
      createShip(2, "brigantine", "enemy", spawnEnemyOne.xFt, spawnEnemyOne.yFt, spawnEnemyOne.headingRad),
      createShip(3, "schooner", "enemy", spawnEnemyTwo.xFt, spawnEnemyTwo.yFt, spawnEnemyTwo.headingRad),
    ],
    projectiles: [],
    ocean: {
      windDirRad: initialWindDirRad,
      initialWindDirRad,
      windSpeedKnots: initialWindSpeedKnots,
      windStrength: Math.max(0, Math.min(1, (initialWindSpeedKnots - 5) / 5)),
      timeSec: 0,
      nextShiftSec: 60,
    },
    winner: null,
    firingEvents: [],
    impactEvents: [],
    damageEvents: [],
    mapType,
    mapCenterLat: map.bounds.centerLat,
    mapCenterLon: map.bounds.centerLon,
  };

  assignEnemyRoles(game, rng);

  return { game, rng };
}

function applyPlayerInput(game: GameState, input: InputState, dt: number): void {
  const player = game.ships.find((ship) => ship.team === "player" && !ship.sunk);
  if (!player) return;

  // Tick down the trim cooldown each frame
  player.sailTrimCooldown = Math.max(0, player.sailTrimCooldown - dt);

  // Sail Trim: stepped ±10% per keypress, 0.5 s between steps
  if (input.trimUp && player.sailTrimCooldown === 0) {
    player.sailTrim = Math.min(100, player.sailTrim + 10);
    player.sailTrimCooldown = 0.5;
  }
  if (input.trimDown && player.sailTrimCooldown === 0) {
    player.sailTrim = Math.max(0, player.sailTrim - 10);
    player.sailTrimCooldown = 0.5;
  }

  // Drive throttle from sail trim so kinematics stay consistent for both player and AI
  player.throttle = player.sailTrim / 100;

  // Rudder: stepped ±5° per tap, 0.2 s between steps, persists until changed
  player.rudderTapCooldown = Math.max(0, player.rudderTapCooldown - dt);
  if (input.rudderLeft && !input.rudderRight && player.rudderTapCooldown === 0) {
    player.rudderAngleDeg = Math.max(-35, player.rudderAngleDeg - 5);  // A → Port (negative)
    player.rudderTapCooldown = 0.2;
  }
  if (input.rudderRight && !input.rudderLeft && player.rudderTapCooldown === 0) {
    player.rudderAngleDeg = Math.min(35, player.rudderAngleDeg + 5);   // D → Starboard (positive)
    player.rudderTapCooldown = 0.2;
  }
  player.rudder = player.rudderAngleDeg / 35;
}

function evaluateWinner(game: GameState): void {
  const livePlayer = game.ships.some((ship) => ship.team === "player" && !ship.sunk);
  const liveEnemy = game.ships.some((ship) => ship.team === "enemy" && !ship.sunk);

  if (!livePlayer && !liveEnemy) game.winner = "draw";
  else if (!livePlayer) game.winner = "enemy";
  else if (!liveEnemy) game.winner = "player";
}

export function tickGame(game: GameState, rng: Rng, input: InputState, dt = SIM_TICK_SECONDS): void {
  if (game.winner) return;

  game.firingEvents = [];
  game.impactEvents = [];
  game.damageEvents = [];

  applyPlayerInput(game, input, dt);
  const aiActions = runEnemyAi(game, dt);

  for (const ship of game.ships) {
    if (ship.sunk) continue;

    ship.ramCooldownSec = Math.max(0, ship.ramCooldownSec - dt);

    tickReloads(ship, dt);
    updateShipKinematics(ship, game.ocean, dt);

    const reloadSec = getShipBalance(ship).reloadSeconds;

    if (ship.team === "player") {
      if (input.firePort) tryFireBroadside(game, ship, "port", rng, reloadSec);
      if (input.fireStarboard) tryFireBroadside(game, ship, "starboard", rng, reloadSec);
    } else {
      if (aiActions.firePort.has(ship.id)) tryFireBroadside(game, ship, "port", rng, reloadSec);
      if (aiActions.fireStarboard.has(ship.id)) tryFireBroadside(game, ship, "starboard", rng, reloadSec);
    }
  }

  resolveShipCollisions(game);

  updateProjectiles(game, dt);
  updateOcean(game.ocean, dt, rng.next());
  evaluateWinner(game);
  game.tick += 1;
}

export function resetGame(): { game: GameState; rng: Rng } {
  return createInitialGame("open-ocean", 42 + Math.floor(Math.random() * 100000));
}

export type GunInfo = { ready: boolean; destroyed: boolean };

export function getPlayerHud(game: GameState): {
  hull: number;
  sails: number;
  crew: number;
  rudder: number;
  headingDeg: number;
  rudderDeg: number;
  sailTrim: number;
  speed: number;
  enemiesAfloat: number;
  portReady: number;
  starboardReady: number;
  portProgress: number;
  starboardProgress: number;
  portGuns: GunInfo[];
  starboardGuns: GunInfo[];
} {
  const player = game.ships.find((ship) => ship.team === "player");
  if (!player) {
    return {
      hull: 0,
      sails: 0,
      crew: 0,
      rudder: 0,
      headingDeg: 0,
      rudderDeg: 0,
      sailTrim: 0,
      speed: 0,
      enemiesAfloat: 0,
      portReady: 0,
      starboardReady: 0,
      portProgress: 0,
      starboardProgress: 0,
      portGuns: [],
      starboardGuns: [],
    };
  }

  const reloadSeconds = getShipBalance(player).reloadSeconds;
  const portReady = player.reloadPort.filter((t) => t <= 0).length;
  const starboardReady = player.reloadStarboard.filter((t) => t <= 0).length;

  const avgProgress = (timers: number[]): number => {
    if (timers.length === 0) return 0;
    const sum = timers.reduce((acc, timer) => {
      const progress = 1 - timer / reloadSeconds;
      return acc + Math.max(0, Math.min(1, progress));
    }, 0);
    return sum / timers.length;
  };

  return {
    hull: Math.round((player.hullHp / player.maxHullHp) * 100),
    sails: Math.round((player.sailsHp / player.maxSailsHp) * 100),
    crew: Math.round((player.crew / player.maxCrew) * 100),
    rudder: Math.round((player.rudderHp / player.maxRudderHp) * 100),
    // Convert math angle (0 = East) to nautical compass bearing (0 = North, 90 = East)
    headingDeg: Math.round(((90 - (player.headingRad * 180) / Math.PI) % 360 + 360) % 360),
    rudderDeg: player.rudderAngleDeg,
    sailTrim: player.sailTrim,
    speed: Number(player.speedFtPerSec.toFixed(1)),
    enemiesAfloat: game.ships.filter((s) => s.team === "enemy" && !s.sunk).length,
    portReady,
    starboardReady,
    portProgress: avgProgress(player.reloadPort),
    starboardProgress: avgProgress(player.reloadStarboard),
    portGuns: player.reloadPort.map((timer, i) => ({
      ready: timer <= 0 && !player.gunPortDestroyed[i],
      destroyed: player.gunPortDestroyed[i],
    })),
    starboardGuns: player.reloadStarboard.map((timer, i) => ({
      ready: timer <= 0 && !player.gunStarboardDestroyed[i],
      destroyed: player.gunStarboardDestroyed[i],
    })),
  };
}

export function getShipLegend(): string {
  return Object.entries(SHIP_BALANCE)
    .map(([name, data]) => `${name}: ${data.reloadSeconds}s reload, ${data.maxSpeedFtPerSec} ft/s`)
    .join(" | ");
}
