import type { GameState, ShipState } from "./types";

type LocalPoint = {
  x: number;
  y: number;
};

function toShipLocal(pointX: number, pointY: number, ship: ShipState): LocalPoint {
  const dx = pointX - ship.xFt;
  const dy = pointY - ship.yFt;
  const c = Math.cos(ship.headingRad);
  const s = Math.sin(ship.headingRad);
  return {
    x: dx * c + dy * s,
    y: -dx * s + dy * c,
  };
}

export function getShipLocalPoint(pointX: number, pointY: number, ship: ShipState): LocalPoint {
  return toShipLocal(pointX, pointY, ship);
}

export function pointInShipObb(pointX: number, pointY: number, ship: ShipState): boolean {
  const p = toShipLocal(pointX, pointY, ship);
  return Math.abs(p.x) <= ship.lengthFt * 0.5 && Math.abs(p.y) <= ship.beamFt * 0.5;
}

export function distanceSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

type Vec2 = {
  x: number;
  y: number;
};

type Projection = {
  min: number;
  max: number;
};

type SatHit = {
  overlap: number;
  axis: Vec2;
};

function normalize(x: number, y: number): Vec2 {
  const len = Math.hypot(x, y);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: x / len, y: y / len };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function addScaled(point: Vec2, axis: Vec2, scale: number): Vec2 {
  return { x: point.x + axis.x * scale, y: point.y + axis.y * scale };
}

function shipAxes(ship: ShipState): { forward: Vec2; side: Vec2 } {
  const c = Math.cos(ship.headingRad);
  const s = Math.sin(ship.headingRad);
  return {
    forward: { x: c, y: s },
    side: { x: -s, y: c },
  };
}

function shipCorners(ship: ShipState): Vec2[] {
  const halfL = ship.lengthFt * 0.5;
  const halfB = ship.beamFt * 0.5;
  const center = { x: ship.xFt, y: ship.yFt };
  const axes = shipAxes(ship);

  const fPlus = addScaled(center, axes.forward, halfL);
  const fMinus = addScaled(center, axes.forward, -halfL);

  return [
    addScaled(fPlus, axes.side, halfB),
    addScaled(fPlus, axes.side, -halfB),
    addScaled(fMinus, axes.side, -halfB),
    addScaled(fMinus, axes.side, halfB),
  ];
}

function project(corners: Vec2[], axis: Vec2): Projection {
  let min = dot(corners[0], axis);
  let max = min;
  for (let i = 1; i < corners.length; i += 1) {
    const v = dot(corners[i], axis);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

function satObbVsObb(a: ShipState, b: ShipState): SatHit | null {
  const aAxes = shipAxes(a);
  const bAxes = shipAxes(b);
  const axes = [aAxes.forward, aAxes.side, bAxes.forward, bAxes.side];
  const aCorners = shipCorners(a);
  const bCorners = shipCorners(b);

  let minOverlap = Number.POSITIVE_INFINITY;
  let minAxis: Vec2 = { x: 1, y: 0 };

  for (const rawAxis of axes) {
    const axis = normalize(rawAxis.x, rawAxis.y);
    const pa = project(aCorners, axis);
    const pb = project(bCorners, axis);
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap <= 0) return null;

    if (overlap < minOverlap) {
      minOverlap = overlap;
      minAxis = axis;
    }
  }

  const centerDelta = { x: b.xFt - a.xFt, y: b.yFt - a.yFt };
  if (dot(centerDelta, minAxis) < 0) {
    minAxis = { x: -minAxis.x, y: -minAxis.y };
  }

  return { overlap: minOverlap, axis: minAxis };
}

function shipVelocity(ship: ShipState): Vec2 {
  return {
    x: Math.cos(ship.headingRad) * ship.speedFtPerSec,
    y: Math.sin(ship.headingRad) * ship.speedFtPerSec,
  };
}

function applyNoReverseDisplacement(ship: ShipState, dx: number, dy: number): void {
  const forward = { x: Math.cos(ship.headingRad), y: Math.sin(ship.headingRad) };
  const side = { x: -forward.y, y: forward.x };

  // Prevent stern-first sliding from collision separation.
  const forwardComp = Math.max(0, dx * forward.x + dy * forward.y);
  const sideComp = dx * side.x + dy * side.y;

  ship.xFt += forward.x * forwardComp + side.x * sideComp;
  ship.yFt += forward.y * forwardComp + side.y * sideComp;
}

function applyRammingDamage(game: GameState, a: ShipState, b: ShipState, overlap: number, normal: Vec2): void {
  const va = shipVelocity(a);
  const vb = shipVelocity(b);
  const relativeAlongNormal = dot({ x: vb.x - va.x, y: vb.y - va.y }, normal);
  const closingSpeed = Math.max(0, relativeAlongNormal);

  const base = closingSpeed * 2.6 + overlap * 0.35;
  const damageA = Math.max(8, Math.round(base));
  const damageB = Math.max(8, Math.round(base));

  a.hullHp = Math.max(0, a.hullHp - damageA);
  b.hullHp = Math.max(0, b.hullHp - damageB);
  a.rudderHp = Math.max(0, a.rudderHp - Math.max(3, Math.floor(damageA * 0.18)));
  b.rudderHp = Math.max(0, b.rudderHp - Math.max(3, Math.floor(damageB * 0.18)));

  a.crew = Math.max(1, a.crew - Math.max(1, Math.floor(damageA * 0.08)));
  b.crew = Math.max(1, b.crew - Math.max(1, Math.floor(damageB * 0.08)));

  game.damageEvents.push({ xFt: a.xFt, yFt: a.yFt, amount: damageA, targetTeam: a.team, kind: "ram" });
  game.damageEvents.push({ xFt: b.xFt, yFt: b.yFt, amount: damageB, targetTeam: b.team, kind: "ram" });
  game.damageEvents.push({ xFt: a.xFt, yFt: a.yFt, amount: Math.max(3, Math.floor(damageA * 0.18)), targetTeam: a.team, kind: "rudder" });
  game.damageEvents.push({ xFt: b.xFt, yFt: b.yFt, amount: Math.max(3, Math.floor(damageB * 0.18)), targetTeam: b.team, kind: "rudder" });
  game.impactEvents.push({ xFt: (a.xFt + b.xFt) * 0.5, yFt: (a.yFt + b.yFt) * 0.5 });

  a.ramCooldownSec = 0.75;
  b.ramCooldownSec = 0.75;

  if (a.hullHp <= 0) {
    a.sunk = true;
    a.speedFtPerSec = 0;
    a.throttle = 0;
    a.rudder = 0;
  }
  if (b.hullHp <= 0) {
    b.sunk = true;
    b.speedFtPerSec = 0;
    b.throttle = 0;
    b.rudder = 0;
  }
}

export function resolveShipCollisions(game: GameState): void {
  const ships = game.ships;

  for (let i = 0; i < ships.length; i += 1) {
    const a = ships[i];
    if (a.sunk) continue;

    for (let j = i + 1; j < ships.length; j += 1) {
      const b = ships[j];
      if (b.sunk) continue;

      const broadRadius = Math.max(a.lengthFt, a.beamFt) + Math.max(b.lengthFt, b.beamFt);
      if (distanceSq(a.xFt, a.yFt, b.xFt, b.yFt) > broadRadius * broadRadius * 0.3) {
        continue;
      }

      const hit = satObbVsObb(a, b);
      if (!hit) continue;

      const push = hit.overlap * 0.5 + 0.35;
      applyNoReverseDisplacement(a, -hit.axis.x * push, -hit.axis.y * push);
      applyNoReverseDisplacement(b, hit.axis.x * push, hit.axis.y * push);

      a.speedFtPerSec *= 0.62;
      b.speedFtPerSec *= 0.62;

      if (a.ramCooldownSec <= 0 || b.ramCooldownSec <= 0) {
        applyRammingDamage(game, a, b, hit.overlap, hit.axis);
      }
    }
  }
}
