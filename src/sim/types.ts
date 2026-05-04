import type { ShipClass } from "../config/balance";

export type Team = "player" | "enemy";
export type Broadside = "port" | "starboard";
export type EnemyRole = "interceptor" | "flanker" | "brawler" | "cautious";

export type ShipState = {
  id: number;
  shipClass: ShipClass;
  team: Team;
  xFt: number;
  yFt: number;
  headingRad: number;
  speedFtPerSec: number;
  throttle: number;
  sailTrim: number;
  sailTrimCooldown: number;
  rudder: number;
  rudderAngleDeg: number;
  rudderTapCooldown: number;
  yawRateRad: number;
  hullHp: number;
  sailsHp: number;
  crew: number;
  rudderHp: number;
  maxHullHp: number;
  maxSailsHp: number;
  maxCrew: number;
  maxRudderHp: number;
  lengthFt: number;
  beamFt: number;
  reloadPort: number[];
  reloadStarboard: number[];
  gunPortDestroyed: boolean[];
  gunStarboardDestroyed: boolean[];
  sunk: boolean;
  tackSide: "port" | "starboard";
  tackTimer: number;
  ramCooldownSec: number;
  aiRole: EnemyRole | null;
  aiDebugState: string;
};

export type ProjectileState = {
  id: number;
  ownerShipId: number;
  team: Team;
  xFt: number;
  yFt: number;
  vxFtPerSec: number;
  vyFtPerSec: number;
  lifeSec: number;
  maxLifeSec: number;
  damageHull: number;
  damageSails: number;
  damageCrew: number;
};

export type OceanState = {
  windDirRad: number;
  initialWindDirRad: number;
  windSpeedKnots: number;
  windStrength: number;
  timeSec: number;
  nextShiftSec: number;
};

export type InputState = {
  trimUp: boolean;
  trimDown: boolean;
  rudderLeft: boolean;
  rudderRight: boolean;
  firePort: boolean;
  fireStarboard: boolean;
};

export type FiringEvent = {
  xFt: number;
  yFt: number;
  angleRad: number;
  shipId: number;
};

export type ImpactEvent = {
  xFt: number;
  yFt: number;
};

export type DamageEvent = {
  xFt: number;
  yFt: number;
  amount: number;
  targetTeam: Team;
  kind: "cannon" | "ram" | "rudder";
  attackerShipId?: number;
  targetShipId?: number;
};

export type GameState = {
  tick: number;
  nextProjectileId: number;
  ships: ShipState[];
  projectiles: ProjectileState[];
  ocean: OceanState;
  winner: Team | "draw" | null;
  firingEvents: FiringEvent[];
  impactEvents: ImpactEvent[];
  damageEvents: DamageEvent[];
};
