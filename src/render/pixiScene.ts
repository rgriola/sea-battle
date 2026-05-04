// Last touched by agent: 2026-05-04T21:05:00Z
// Purpose: Pixi scene — ship rendering, effects, and camera zoom/centering controls.
import { Application, Color, Graphics, Text } from "pixi.js";
import { FEET_TO_PX, HALF_WORLD_FT, VIEW_SIZE_PX, WORLD_SIZE_FT } from "../config/world";
import { SHIP_BALANCE } from "../config/balance";
import { createControls } from "../input/controls";
import { getPlayerHud } from "../sim/engine";
import {
  createSimulationAdapterForMode,
  type SimulationAuthority,
  type SimulationEvent,
  type SimulationFrameEvent,
} from "../sim/runtime";
import type { GunInfo } from "../sim/engine";
import { cannonOffset, localToWorld } from "../sim/cannon";
import type { DamageEvent, FiringEvent, GameState, ImpactEvent, OceanState, ShipState } from "../sim/types";

type CameraState = {
  xFt: number;
  yFt: number;
  targetXFt: number;
  targetYFt: number;
  zoom: number;
  viewWidthPx: number;
  viewHeightPx: number;
};

type ScreenPoint = {
  x: number;
  y: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  maxAge: number;
  startRadius: number;
  endRadius: number;
  startAlpha: number;
  color: number;
};

type DamageLabel = {
  text: Text;
  xFt: number;
  yFt: number;
  vyFt: number;
  age: number;
  maxAge: number;
};

function getLatestFrameEvent(events: SimulationEvent[]): SimulationFrameEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type === "frame") return event;
  }
  return null;
}

function updateAiDebugLabels(
  game: GameState,
  camera: CameraState,
  labels: Map<number, Text>,
  layer: Graphics,
): void {
  const activeIds = new Set<number>();

  for (const ship of game.ships) {
    if (ship.team !== "enemy" || ship.sunk) continue;
    activeIds.add(ship.id);

    let label = labels.get(ship.id);
    if (!label) {
      label = new Text("", {
        fill: "#dbeef4",
        fontSize: 11,
        fontWeight: "600",
      });
      label.alpha = 0.88;
      labels.set(ship.id, label);
      layer.addChild(label);
    }

    label.text = ship.aiDebugState;
    const pos = toScreen(camera, ship.xFt, ship.yFt);
    label.x = pos.x - 44;
    label.y = pos.y - ship.beamFt * FEET_TO_PX * camera.zoom * 1.9;
  }

  for (const [shipId, label] of labels) {
    if (activeIds.has(shipId)) continue;
    label.destroy();
    labels.delete(shipId);
  }
}

const COMPASS_R = 46;
const MINIMAP_X = 18;
const MINIMAP_Y = 18;
const MINIMAP_SIZE = 160;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function windStrengthFromKnots(knots: number): number {
  return clamp((knots - 5) / 5, 0, 1);
}

function progressBar(value: number, width = 10): string {
  const clamped = clamp(value, 0, 1);
  const filled = Math.round(clamped * width);
  return `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
}

function toScreen(camera: CameraState, xFt: number, yFt: number): ScreenPoint {
  const scale = FEET_TO_PX * camera.zoom;
  return {
    x: (xFt - camera.xFt) * scale + camera.viewWidthPx * 0.5,
    y: (camera.yFt - yFt) * scale + camera.viewHeightPx * 0.5,
  };
}

function createCamera(game: GameState): CameraState {
  const player = game.ships.find((ship) => ship.team === "player");
  return {
    xFt: player?.xFt ?? 0,
    yFt: player?.yFt ?? 0,
    targetXFt: player?.xFt ?? 0,
    targetYFt: player?.yFt ?? 0,
    zoom: 0.82,
    viewWidthPx: VIEW_SIZE_PX,
    viewHeightPx: VIEW_SIZE_PX,
  };
}

function centerCameraOnPlayer(game: GameState, camera: CameraState): void {
  const player = game.ships.find((ship) => ship.team === "player");
  if (!player) return;
  camera.xFt = player.xFt;
  camera.yFt = player.yFt;
  camera.targetXFt = player.xFt;
  camera.targetYFt = player.yFt;
}

// Inline hash-based pseudo-random: returns 0..1 for any integer seed
function waveRng(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function drawOcean(g: Graphics, ocean: OceanState, width: number, height: number, zoom: number): void {
  g.clear();
  g.rect(0, 0, width, height).fill("#184355");

  const waveScale = clamp(Math.pow(zoom, 0.28), 0.78, 1.28);
  const windStrength = windStrengthFromKnots(ocean.windSpeedKnots);

  // Wind direction: crests drift this way
  const windX = Math.cos(ocean.windDirRad);
  const windY = -Math.sin(ocean.windDirRad);
  // Crest direction: perpendicular to wind
  const crestX = -windY;
  const crestY = windX;

  const span = Math.hypot(width, height) * 1.4;
  const cx = width * 0.5;
  const cy = height * 0.5;

  // Bands of crests spaced along wind direction, drifting with wind
  const bandGap = 62 * waveScale;
  const driftSpeed = 12 + windStrength * 11;
  // Fixed cycle distance so wrapping is seamless regardless of screen resize
  const driftCycle = 1400;
  const drift = (ocean.timeSec * driftSpeed) % driftCycle;
  const bandCount = Math.ceil((driftCycle + span) / bandGap) + 2;

  // Crests scattered along each band (perpendicular / crest direction)
  const crestSpacing = 58 * waveScale;
  const crestCount = Math.ceil(span * 1.5 / crestSpacing) + 2;

  for (let i = 0; i < bandCount; i += 1) {
    // Band center offset along wind direction, with drift applied and wrapped
    const windPos = -span * 0.5 + i * bandGap + drift - driftCycle * 0.5;
    const bandCx = cx + windX * windPos;
    const bandCy = cy + windY * windPos;

    for (let j = 0; j < crestCount; j += 1) {
      const seed = i * 4096 + j;
      const r1 = waveRng(seed);
      const r2 = waveRng(seed + 1);
      const r3 = waveRng(seed + 2);
      const r4 = waveRng(seed + 3);

      // Crest center: scattered along crest direction
      const crestPos = -span * 0.75 + j * crestSpacing + (r1 - 0.5) * crestSpacing * 0.7;
      // Small stagger in wind direction so crests don't line up perfectly
      const windStagger = (r2 - 0.5) * 28 * waveScale;

      const wcx = bandCx + crestX * crestPos + windX * windStagger;
      const wcy = bandCy + crestY * crestPos + windY * windStagger;

      // Cull off-screen crests (generous margin)
      if (wcx < -120 || wcx > width + 120 || wcy < -120 || wcy > height + 120) continue;

      // Arc geometry: short curved crest
      const arcLen = (28 + r3 * 58) * waveScale;
      const bow = (r4 - 0.5) * 9 * waveScale; // how much it curves toward wind
      const lineAlpha = 0.22 + r1 * 0.26 + windStrength * 0.10;
      const lineW = (0.7 + r2 * 0.55) * waveScale;

      const STEPS = 7;
      for (let s = 0; s <= STEPS; s += 1) {
        const t = s / STEPS;                         // 0→1
        const along = (t - 0.5) * arcLen;           // -half to +half along crest
        const curve = Math.sin(t * Math.PI) * bow;  // slight forward bow
        const px = wcx + crestX * along + windX * curve;
        const py = wcy + crestY * along + windY * curve;
        if (s === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke({ color: "#2f6a80", width: lineW, alpha: clamp(lineAlpha, 0.08, 0.52) });

      // Whitecaps: lighter highlight on a fraction of crests, probability grows with wind
      const whitecapChance = 0.18 + windStrength * 0.52;
      if (r1 < whitecapChance) {
        const capLen = arcLen * (0.28 + r3 * 0.38);
        const capOffN = (r2 - 0.5) * arcLen * 0.28; // lateral shift within arc
        const capAlpha = 0.38 + windStrength * 0.48;
        const capW = (1.1 + r4 * 0.7) * waveScale;

        for (let s = 0; s <= STEPS; s += 1) {
          const t = s / STEPS;
          const along = (t - 0.5) * capLen + capOffN;
          const curve = Math.sin(t * Math.PI) * bow;
          const px = wcx + crestX * along + windX * curve;
          const py = wcy + crestY * along + windY * curve;
          if (s === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.stroke({ color: "#b8dce8", width: capW, alpha: clamp(capAlpha, 0.18, 0.88) });
      }
    }
  }
}

function drawWindCompass(g: Graphics, ocean: OceanState, viewWidth: number): void {
  const compassX = viewWidth / 2;
  const compassY = 87;
  g.clear();
  g.circle(compassX, compassY, COMPASS_R).fill({ color: 0x0d2430, alpha: 0.82 });
  g.circle(compassX, compassY, COMPASS_R).stroke({ color: 0x4a8fa0, width: 1.5, alpha: 0.9 });

  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    const inner = COMPASS_R - (i % 2 === 0 ? 10 : 6);
    g.moveTo(compassX + Math.cos(a) * inner, compassY + Math.sin(a) * inner);
    g.lineTo(compassX + Math.cos(a) * COMPASS_R, compassY + Math.sin(a) * COMPASS_R);
    g.stroke({ color: 0x6dbcd0, width: i % 2 === 0 ? 1.5 : 0.8, alpha: 0.7 });
  }

  const deadUpwind = ocean.windDirRad + Math.PI;
  const noGoHalf = 32 * (Math.PI / 180);
  const arcR = COMPASS_R - 8;

  g.moveTo(compassX, compassY);
  g.arc(compassX, compassY, arcR, -(deadUpwind + noGoHalf), -(deadUpwind - noGoHalf), true);
  g.closePath();
  g.fill({ color: 0xcc2222, alpha: 0.22 });

  const arrowAngle = -ocean.windDirRad;
  const tipX = compassX + Math.cos(arrowAngle) * (COMPASS_R - 9);
  const tipY = compassY + Math.sin(arrowAngle) * (COMPASS_R - 9);
  const tailX = compassX - Math.cos(arrowAngle) * (COMPASS_R - 18);
  const tailY = compassY - Math.sin(arrowAngle) * (COMPASS_R - 18);

  g.moveTo(tailX, tailY);
  g.lineTo(tipX, tipY);
  g.stroke({ color: 0xffffff, width: 2.5 });

  const perpA = arrowAngle + Math.PI * 0.75;
  const perpB = arrowAngle - Math.PI * 0.75;
  g.poly([tipX, tipY, tipX + Math.cos(perpA) * 7, tipY + Math.sin(perpA) * 7, tipX + Math.cos(perpB) * 7, tipY + Math.sin(perpB) * 7]).fill(0xffffff);

  const strengthArc = windStrengthFromKnots(ocean.windSpeedKnots) * Math.PI * 2;
  g.arc(compassX, compassY, COMPASS_R + 5, -Math.PI / 2, -Math.PI / 2 + strengthArc);
  g.stroke({ color: 0x5fd3e8, width: 3, alpha: 0.85 });
}

function drawMiniMap(g: Graphics, game: GameState, camera: CameraState, mapX: number, mapY: number): void {
  g.clear();

  const worldHalfFt = 1000;
  const scale = MINIMAP_SIZE / (worldHalfFt * 2);

  const mapPoint = (xFt: number, yFt: number): ScreenPoint => ({
    x: mapX + (xFt + worldHalfFt) * scale,
    y: mapY + (worldHalfFt - yFt) * scale,
  });

  g.roundRect(mapX, mapY, MINIMAP_SIZE, MINIMAP_SIZE, 10).fill({ color: 0x0d2430, alpha: 0.82 });
  g.roundRect(mapX, mapY, MINIMAP_SIZE, MINIMAP_SIZE, 10).stroke({ color: 0x4a8fa0, width: 1.2, alpha: 0.9 });

  g.moveTo(mapX + MINIMAP_SIZE * 0.5, mapY + 8);
  g.lineTo(mapX + MINIMAP_SIZE * 0.5, mapY + MINIMAP_SIZE - 8);
  g.stroke({ color: 0x356579, width: 1, alpha: 0.45 });
  g.moveTo(mapX + 8, mapY + MINIMAP_SIZE * 0.5);
  g.lineTo(mapX + MINIMAP_SIZE - 8, mapY + MINIMAP_SIZE * 0.5);
  g.stroke({ color: 0x356579, width: 1, alpha: 0.45 });

  const viewWidthFt = camera.viewWidthPx / (FEET_TO_PX * camera.zoom);
  const viewHeightFt = camera.viewHeightPx / (FEET_TO_PX * camera.zoom);
  const viewTopLeft = mapPoint(camera.xFt - viewWidthFt * 0.5, camera.yFt + viewHeightFt * 0.5);
  g.rect(viewTopLeft.x, viewTopLeft.y, viewWidthFt * scale, viewHeightFt * scale).stroke({
    color: 0xd9f6ff,
    width: 1,
    alpha: 0.7,
  });

  for (const ship of game.ships) {
    const p = mapPoint(ship.xFt, ship.yFt);
    const color = ship.team === "player" ? 0xf0d27a : ship.sunk ? 0x5d5d5d : 0xd46a62;
    const radius = ship.team === "player" ? 4 : 3;
    g.circle(p.x, p.y, radius).fill({ color, alpha: 0.95 });

    const hx = p.x + Math.cos(ship.headingRad) * (radius + 3);
    const hy = p.y - Math.sin(ship.headingRad) * (radius + 3);
    g.moveTo(p.x, p.y);
    g.lineTo(hx, hy);
    g.stroke({ color, width: 1.2, alpha: 0.9 });
  }
}

function shipToWorld(ship: ShipState, lx: number, ly: number): { xFt: number; yFt: number } {
  const c = Math.cos(ship.headingRad);
  const s = Math.sin(ship.headingRad);
  return { xFt: ship.xFt + lx * c - ly * s, yFt: ship.yFt + lx * s + ly * c };
}

function drawWakeForShip(g: Graphics, ship: ShipState, camera: CameraState, speedRatio: number): void {
  if (ship.sunk || speedRatio < 0.08) return;

  const aftX = -ship.lengthFt * 0.46;
  const sideY = ship.beamFt * 0.52;
  const wakeLength = ship.lengthFt * (0.55 + speedRatio * 1.3);
  const wakeSpread = ship.beamFt * (0.14 + speedRatio * 0.26);
  const alpha = 0.15 + speedRatio * 0.35;
  const width = 1 + speedRatio * 2.2;

  const startPort = shipToWorld(ship, aftX, sideY);
  const midPort = shipToWorld(ship, aftX - wakeLength * 0.45, sideY + wakeSpread);
  const endPort = shipToWorld(ship, aftX - wakeLength, sideY + wakeSpread * 1.55);
  const startStar = shipToWorld(ship, aftX, -sideY);
  const midStar = shipToWorld(ship, aftX - wakeLength * 0.45, -(sideY + wakeSpread));
  const endStar = shipToWorld(ship, aftX - wakeLength, -(sideY + wakeSpread * 1.55));

  const stern = shipToWorld(ship, aftX - ship.lengthFt * 0.06, 0);
  const sternTail = shipToWorld(ship, aftX - wakeLength * 1.25, 0);
  const p1 = toScreen(camera, startPort.xFt, startPort.yFt);
  const p2 = toScreen(camera, midPort.xFt, midPort.yFt);
  const p3 = toScreen(camera, endPort.xFt, endPort.yFt);
  const s1 = toScreen(camera, startStar.xFt, startStar.yFt);
  const s2 = toScreen(camera, midStar.xFt, midStar.yFt);
  const s3 = toScreen(camera, endStar.xFt, endStar.yFt);
  const st = toScreen(camera, stern.xFt, stern.yFt);
  const stTail = toScreen(camera, sternTail.xFt, sternTail.yFt);

  g.moveTo(p1.x, p1.y);
  g.lineTo(p2.x, p2.y);
  g.lineTo(p3.x, p3.y);
  g.stroke({ color: 0xbbe6f4, width: Math.max(1, width * camera.zoom), alpha: alpha * 0.9 });

  g.moveTo(s1.x, s1.y);
  g.lineTo(s2.x, s2.y);
  g.lineTo(s3.x, s3.y);
  g.stroke({ color: 0xbbe6f4, width: Math.max(1, width * camera.zoom), alpha: alpha * 0.9 });

  g.moveTo(st.x, st.y);
  g.lineTo(stTail.x, stTail.y);
  g.stroke({ color: 0xd8f2f9, width: Math.max(1, (width * 0.8) * camera.zoom), alpha: alpha * 0.65 });
}

function drawSailsForShip(
  g: Graphics,
  ship: ShipState,
  camera: CameraState,
  ocean: OceanState,
  speedRatio: number,
): void {
  if (ship.sunk) return;

  const relWind = ship.headingRad - ocean.windDirRad;
  const windBias = Math.sin(relWind);
  const billow = (0.08 + speedRatio * 0.24) * (windBias >= 0 ? 1 : -1);
  const mastColor = 0x3a2f24;
  const sailColor = ship.team === "player" ? 0xe6dcc6 : 0xd8cfbc;

  const mastPositions = [-ship.lengthFt * 0.2, ship.lengthFt * 0.02, ship.lengthFt * 0.25];
  const mastHeights = [ship.lengthFt * 0.18, ship.lengthFt * 0.22, ship.lengthFt * 0.16];

  for (let i = 0; i < mastPositions.length; i += 1) {
    const mx = mastPositions[i];
    const mastBase = shipToWorld(ship, mx, 0);
    const mastTop = shipToWorld(ship, mx, 0.0001);
    const baseS = toScreen(camera, mastBase.xFt, mastBase.yFt);
    const topS = toScreen(camera, mastTop.xFt, mastTop.yFt - mastHeights[i]);

    g.moveTo(baseS.x, baseS.y);
    g.lineTo(topS.x, topS.y);
    g.stroke({ color: mastColor, width: Math.max(1.2, 1.6 * camera.zoom), alpha: 0.9 });

    const sailTop = { x: topS.x, y: topS.y + mastHeights[i] * 0.22 };
    const sailBottom = { x: topS.x, y: topS.y + mastHeights[i] * 0.7 };
    const sailLeft = {
      x: topS.x - ship.beamFt * FEET_TO_PX * camera.zoom * (0.62 + billow),
      y: topS.y + mastHeights[i] * 0.47,
    };
    const sailRight = {
      x: topS.x + ship.beamFt * FEET_TO_PX * camera.zoom * (0.62 - billow),
      y: topS.y + mastHeights[i] * 0.47,
    };

    g.poly([
      sailTop.x,
      sailTop.y,
      sailRight.x,
      sailRight.y,
      sailBottom.x,
      sailBottom.y,
      sailLeft.x,
      sailLeft.y,
    ]).fill({ color: sailColor, alpha: 0.72 });
  }
}

function minimapToWorld(canvasX: number, canvasY: number, mapX: number, mapY: number): ScreenPoint | null {
  if (
    canvasX < mapX ||
    canvasX > mapX + MINIMAP_SIZE ||
    canvasY < mapY ||
    canvasY > mapY + MINIMAP_SIZE
  ) {
    return null;
  }

  const normalizedX = (canvasX - mapX) / MINIMAP_SIZE;
  const normalizedY = (canvasY - mapY) / MINIMAP_SIZE;

  return {
    x: normalizedX * WORLD_SIZE_FT - HALF_WORLD_FT,
    y: HALF_WORLD_FT - normalizedY * WORLD_SIZE_FT,
  };
}

function drawShips(
  g: Graphics,
  game: GameState,
  camera: CameraState,
  rudderDisplayByShipId: Map<number, number>,
): void {
  g.clear();
  for (const ship of game.ships) {
    const maxSpeed = SHIP_BALANCE[ship.shipClass].maxSpeedFtPerSec;
    const speedRatio = clamp(ship.speedFtPerSec / Math.max(1, maxSpeed), 0, 1.4);

    drawWakeForShip(g, ship, camera, speedRatio);

    const lengthFtHalf = ship.lengthFt * 0.5;
    const beamFtHalf = ship.beamFt * 0.5;

    const hullShapeLocal: Array<{ x: number; y: number }> = [
      { x: lengthFtHalf, y: 0 },
      { x: lengthFtHalf * 0.56, y: -beamFtHalf * 0.96 },
      { x: lengthFtHalf * 0.05, y: -beamFtHalf },
      { x: -lengthFtHalf * 0.70, y: -beamFtHalf * 0.72 },
      { x: -lengthFtHalf, y: -beamFtHalf * 0.25 },
      { x: -lengthFtHalf, y: beamFtHalf * 0.25 },
      { x: -lengthFtHalf * 0.70, y: beamFtHalf * 0.72 },
      { x: lengthFtHalf * 0.05, y: beamFtHalf },
      { x: lengthFtHalf * 0.56, y: beamFtHalf * 0.96 },
    ];

    const hullPoints: number[] = [];
    for (const p of hullShapeLocal) {
      const w = shipToWorld(ship, p.x, p.y);
      const s = toScreen(camera, w.xFt, w.yFt);
      hullPoints.push(s.x, s.y);
    }

    const hullColor = ship.team === "player" ? "#d8bf7a" : "#b86860";
    g.poly(hullPoints).fill(ship.sunk ? "#4d4d4d" : hullColor);

    drawSailsForShip(g, ship, camera, game.ocean, speedRatio);

    const center = toScreen(camera, ship.xFt, ship.yFt);
    const barWidth = Math.max(28, ship.lengthFt * FEET_TO_PX * camera.zoom * 0.56);
    const barY = center.y - ship.beamFt * FEET_TO_PX * camera.zoom * 1.08;
    const hullRatio = Math.max(0, ship.hullHp / ship.maxHullHp);
    const hpColor = hullRatio > 0.6 ? "#6ee780" : hullRatio > 0.3 ? "#f3bf4f" : "#ec5a5a";

    g.rect(center.x - barWidth * 0.5, barY, barWidth, 5).fill({ color: "#1c1c1c", alpha: 0.9 });
    g.rect(center.x - barWidth * 0.5 + 1, barY + 1, (barWidth - 2) * hullRatio, 3).fill(hpColor);

    const prowStart = shipToWorld(ship, ship.lengthFt * 0.20, 0);
    const prowEnd = shipToWorld(ship, ship.lengthFt * 0.47, 0);
    const prowStartS = toScreen(camera, prowStart.xFt, prowStart.yFt);
    const prowEndS = toScreen(camera, prowEnd.xFt, prowEnd.yFt);
    g.moveTo(prowStartS.x, prowStartS.y);
    g.lineTo(prowEndS.x, prowEndS.y);
    g.stroke({ color: "#1e1e1e", width: Math.max(1.5, camera.zoom * 1.6) });

    const cannonColor = ship.team === "player" ? "#1f3a4a" : "#4a1f1f";
    for (let i = 0; i < 3; i += 1) {
      const along = -ship.lengthFt * 0.24 + i * (ship.lengthFt * 0.24);
      const port = shipToWorld(ship, along, beamFtHalf * 0.87);
      const starboard = shipToWorld(ship, along, -beamFtHalf * 0.87);
      const portS = toScreen(camera, port.xFt, port.yFt);
      const starboardS = toScreen(camera, starboard.xFt, starboard.yFt);
      const cannonRadius = Math.max(2, 2.8 * camera.zoom);
      g.circle(portS.x, portS.y, cannonRadius).fill(cannonColor);
      g.circle(starboardS.x, starboardS.y, cannonRadius).fill(cannonColor);
    }

    const rudderHingeX = -ship.lengthFt * 0.50;
    const rudderLength = ship.lengthFt * 0.09;
    const rudderWidthHalf = ship.beamFt * 0.09;
    const maxRudderAngle = 35 * (Math.PI / 180);
    const visualRudder = rudderDisplayByShipId.get(ship.id) ?? ship.rudder;
    const rudderAngle = ship.sunk ? 0 : visualRudder * maxRudderAngle;

    const rotateLocal = (x: number, y: number): { x: number; y: number } => {
      const dx = x - rudderHingeX;
      const c = Math.cos(rudderAngle);
      const s = Math.sin(rudderAngle);
      return {
        x: rudderHingeX + dx * c - y * s,
        y: dx * s + y * c,
      };
    };

    const r1 = rotateLocal(rudderHingeX, rudderWidthHalf);
    const r2 = rotateLocal(rudderHingeX, -rudderWidthHalf);
    const r3 = rotateLocal(rudderHingeX - rudderLength, -rudderWidthHalf * 0.92);
    const r4 = rotateLocal(rudderHingeX - rudderLength, rudderWidthHalf * 0.92);

    const rw1 = shipToWorld(ship, r1.x, r1.y);
    const rw2 = shipToWorld(ship, r2.x, r2.y);
    const rw3 = shipToWorld(ship, r3.x, r3.y);
    const rw4 = shipToWorld(ship, r4.x, r4.y);

    const rs1 = toScreen(camera, rw1.xFt, rw1.yFt);
    const rs2 = toScreen(camera, rw2.xFt, rw2.yFt);
    const rs3 = toScreen(camera, rw3.xFt, rw3.yFt);
    const rs4 = toScreen(camera, rw4.xFt, rw4.yFt);

    g.poly([rs1.x, rs1.y, rs2.x, rs2.y, rs3.x, rs3.y, rs4.x, rs4.y]).fill(ship.sunk ? "#4c4c4c" : "#2f2f2f");

    const hingePort = shipToWorld(ship, rudderHingeX, rudderWidthHalf * 1.03);
    const hingeStar = shipToWorld(ship, rudderHingeX, -rudderWidthHalf * 1.03);
    const hs1 = toScreen(camera, hingePort.xFt, hingePort.yFt);
    const hs2 = toScreen(camera, hingeStar.xFt, hingeStar.yFt);
    g.moveTo(hs1.x, hs1.y);
    g.lineTo(hs2.x, hs2.y);
    g.stroke({ color: "#151515", width: Math.max(1, 1.3 * camera.zoom) });

    if (ship.sunk) {
      const hw = ship.lengthFt * FEET_TO_PX * camera.zoom * 0.34;
      g.moveTo(center.x - hw, center.y - hw).lineTo(center.x + hw, center.y + hw);
      g.stroke({ color: "#ff4444", width: 2, alpha: 0.8 });
      g.moveTo(center.x + hw, center.y - hw).lineTo(center.x - hw, center.y + hw);
      g.stroke({ color: "#ff4444", width: 2, alpha: 0.8 });
    }
  }

  for (const shot of game.projectiles) {
    const s = toScreen(camera, shot.xFt, shot.yFt);
    g.circle(s.x, s.y, Math.max(1.8, 2.2 * camera.zoom)).fill("#f4e8c6");
  }
}

function spawnFiringParticles(events: FiringEvent[], particles: Particle[], camera: CameraState): void {
  for (const ev of events) {
    const s = toScreen(camera, ev.xFt, ev.yFt);
    particles.push({ x: s.x, y: s.y, vx: 0, vy: 0, age: 0, maxAge: 0.10, startRadius: 4, endRadius: 10, startAlpha: 1, color: 0xffe066 });
    for (let i = 0; i < 5; i += 1) {
      const spread = (Math.random() - 0.5) * 0.9;
      const screenAngle = -ev.angleRad + spread;
      const speed = 18 + Math.random() * 28;
      particles.push({
        x: s.x,
        y: s.y,
        vx: Math.cos(screenAngle) * speed,
        vy: Math.sin(screenAngle) * speed,
        age: 0,
        maxAge: 1.0 + Math.random() * 0.7,
        startRadius: 3 + Math.random() * 3,
        endRadius: 10 + Math.random() * 8,
        startAlpha: 0.75,
        color: 0x9a9a9a,
      });
    }
  }
}

function spawnImpactParticles(events: ImpactEvent[], particles: Particle[], camera: CameraState): void {
  for (const ev of events) {
    const s = toScreen(camera, ev.xFt, ev.yFt);
    particles.push({ x: s.x, y: s.y, vx: 0, vy: 0, age: 0, maxAge: 0.14, startRadius: 5, endRadius: 13, startAlpha: 1, color: 0xff6622 });
    for (let i = 0; i < 6; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 25 + Math.random() * 50;
      particles.push({
        x: s.x,
        y: s.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        maxAge: 0.5 + Math.random() * 0.4,
        startRadius: 1.5 + Math.random() * 2,
        endRadius: 0.5,
        startAlpha: 1,
        color: 0xc47b3a,
      });
    }
    for (let i = 0; i < 3; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 8 + Math.random() * 15;
      particles.push({
        x: s.x,
        y: s.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        maxAge: 0.8 + Math.random() * 0.5,
        startRadius: 4,
        endRadius: 11,
        startAlpha: 0.65,
        color: 0x7a5540,
      });
    }
  }
}

function spawnDestroyedGunSmoke(
  ship: ShipState,
  particles: Particle[],
  camera: CameraState,
  timers: Map<string, number>,
  dt: number,
): void {
  if (ship.sunk) return;
  const sides: Array<{ side: "port" | "starboard"; arr: boolean[] }> = [
    { side: "port", arr: ship.gunPortDestroyed },
    { side: "starboard", arr: ship.gunStarboardDestroyed },
  ];
  const count = ship.gunPortDestroyed.length;
  for (const { side, arr } of sides) {
    for (let i = 0; i < arr.length; i += 1) {
      if (!arr[i]) continue;
      const key = `${ship.id}_${side}_${i}`;
      const prev = timers.get(key) ?? Math.random() * 0.4;
      const next = prev - dt;
      if (next > 0) { timers.set(key, next); continue; }
      timers.set(key, 0.35 + Math.random() * 0.25);
      const off = cannonOffset(i, count, side, ship);
      const wPos = localToWorld(off.x, off.y, ship);
      const s = toScreen(camera, wPos.x, wPos.y);
      for (let n = 0; n < 2; n += 1) {
        particles.push({
          x: s.x + (Math.random() - 0.5) * 4,
          y: s.y + (Math.random() - 0.5) * 4,
          vx: (Math.random() - 0.5) * 5,
          vy: -6 - Math.random() * 8,
          age: 0,
          maxAge: 1.4 + Math.random() * 0.8,
          startRadius: 2 + Math.random() * 2,
          endRadius: 8 + Math.random() * 6,
          startAlpha: 0.55,
          color: 0x5a5a5a,
        });
      }
    }
  }
}

function updateAndDrawParticles(g: Graphics, particles: Particle[], dt: number): void {
  g.clear();
  let i = 0;
  while (i < particles.length) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.maxAge) {
      particles.splice(i, 1);
      continue;
    }
    const t = p.age / p.maxAge;
    const radius = p.startRadius + (p.endRadius - p.startRadius) * t;
    const alpha = p.startAlpha * (1 - t);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.94;
    p.vy *= 0.94;
    g.circle(p.x, p.y, Math.max(0.5, radius)).fill({ color: p.color, alpha });
    i += 1;
  }
}

function spawnDamageLabels(events: DamageEvent[], labels: DamageLabel[], layer: Graphics): void {
  for (const ev of events) {
    const text = new Text(`-${ev.amount}`, {
      fill: ev.kind === "ram" ? "#ff9b6a" : "#ffd97a",
      fontSize: ev.kind === "ram" ? 18 : 15,
      fontWeight: "700",
    });
    labels.push({
      text,
      xFt: ev.xFt,
      yFt: ev.yFt,
      vyFt: ev.kind === "ram" ? 28 : 20,
      age: 0,
      maxAge: ev.kind === "ram" ? 1.15 : 0.9,
    });
    layer.addChild(text);
  }
}

function updateDamageLabels(labels: DamageLabel[], dt: number, camera: CameraState): void {
  let i = 0;
  while (i < labels.length) {
    const label = labels[i];
    label.age += dt;
    if (label.age >= label.maxAge) {
      label.text.destroy();
      labels.splice(i, 1);
      continue;
    }
    label.yFt += label.vyFt * dt;
    const s = toScreen(camera, label.xFt, label.yFt);
    const t = label.age / label.maxAge;
    label.text.x = s.x - 16;
    label.text.y = s.y - 16;
    label.text.alpha = 1 - t;
    i += 1;
  }
}

export type SceneHandle = {
  dispose: () => void;
  reset: () => void;
  centerOnPlayer: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

export type MountPixiSceneOpts = {
  authority?: SimulationAuthority;
  seed?: number;
};

export function mountPixiScene(
  host: HTMLElement,
  hudEl: HTMLElement,
  statusEl: HTMLElement,
  opts?: MountPixiSceneOpts,
): SceneHandle {
  const app = new Application();
  let cancelled = false;
  let sim = createSimulationAdapterForMode(opts?.authority ?? "local-client", {
    seed: opts?.seed ?? 64,
    matchId: "local-sea-battle",
  });
  const particles: Particle[] = [];
  const damageLabels: DamageLabel[] = [];
  const aiDebugLabels = new Map<number, Text>();
  const rudderDisplayByShipId = new Map<number, number>();
  const gunSmokeTimers = new Map<string, number>();
  const camera = createCamera(sim.getSnapshot());
  let followPlayer = true;

  const handle: SceneHandle = {
    dispose: () => {
      cancelled = true;
    },
    reset: () => {
      sim.dispatch({ type: "reset", seed: 42 + Math.floor(Math.random() * 100000) });
      particles.length = 0;
      for (const label of damageLabels) label.text.destroy();
      damageLabels.length = 0;
      for (const label of aiDebugLabels.values()) label.destroy();
      aiDebugLabels.clear();
      rudderDisplayByShipId.clear();
      gunSmokeTimers.clear();
      followPlayer = true;
      camera.zoom = 0.82;
      centerCameraOnPlayer(sim.getSnapshot(), camera);
      hudEl.textContent = "";
      statusEl.textContent = "";
    },
    centerOnPlayer: () => {
      followPlayer = true;
      centerCameraOnPlayer(sim.getSnapshot(), camera);
    },
    zoomIn: () => {
      camera.zoom = clamp(camera.zoom * 1.15, 0.45, 3.2);
    },
    zoomOut: () => {
      camera.zoom = clamp(camera.zoom / 1.15, 0.45, 3.2);
    },
  };

  const initialWidth = Math.max(640, Math.floor(host.clientWidth || VIEW_SIZE_PX));
  const initialHeight = Math.max(460, Math.floor(host.clientHeight || VIEW_SIZE_PX));
  camera.viewWidthPx = initialWidth;
  camera.viewHeightPx = initialHeight;

  void app.init({ width: initialWidth, height: initialHeight, background: new Color("#0f2b39"), antialias: true }).then(() => {
    if (cancelled) return;
    host.appendChild(app.canvas);

    const oceanGfx = new Graphics();
    const shipsGfx = new Graphics();
    const particlesGfx = new Graphics();
    const minimapGfx = new Graphics();
    const compassGfx = new Graphics();
    const compassWindText = new Text("", {
      fill: "#d8f3fb",
      fontSize: 20,
      fontWeight: "700",
      align: "right",
    });
    compassWindText.anchor.set(1, 0.5);
    compassWindText.alpha = 0.92;
    const compassNorthText = new Text("N", {
      fill: "#e8d89a",
      fontSize: 18,
      fontWeight: "700",
      fontFamily: "Georgia, 'Times New Roman', serif",
    });
    compassNorthText.anchor.set(0.5, 1);
    compassNorthText.alpha = 0.95;
    const labelLayer = new Graphics();
    const aiDebugLayer = new Graphics();
    app.stage.addChild(oceanGfx);
    app.stage.addChild(shipsGfx);
    app.stage.addChild(particlesGfx);
    app.stage.addChild(minimapGfx);
    app.stage.addChild(compassGfx);
    app.stage.addChild(compassWindText);
    app.stage.addChild(compassNorthText);
    app.stage.addChild(labelLayer);
    app.stage.addChild(aiDebugLayer);

    const controls = createControls(window);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0012);
      camera.zoom = clamp(camera.zoom * factor, 0.45, 3.2);
    };

    const minimapX = MINIMAP_X;

    const resizeScene = () => {
      const nextWidth = Math.max(640, Math.floor(host.clientWidth || VIEW_SIZE_PX));
      const nextHeight = Math.max(460, Math.floor(host.clientHeight || VIEW_SIZE_PX));
      app.renderer.resize(nextWidth, nextHeight);
      camera.viewWidthPx = nextWidth;
      camera.viewHeightPx = nextHeight;
    };

    const resizeObserver = new ResizeObserver(() => {
      resizeScene();
    });
    resizeObserver.observe(host);

    const onPointerDown = (event: PointerEvent) => {
      const rect = app.canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const canvasX = ((event.clientX - rect.left) / rect.width) * camera.viewWidthPx;
      const canvasY = ((event.clientY - rect.top) / rect.height) * camera.viewHeightPx;
      const worldPoint = minimapToWorld(canvasX, canvasY, minimapX, MINIMAP_Y);
      if (!worldPoint) return;

      followPlayer = false;
      camera.xFt = worldPoint.x;
      camera.yFt = worldPoint.y;
      camera.targetXFt = worldPoint.x;
      camera.targetYFt = worldPoint.y;
    };
    app.canvas.addEventListener("wheel", onWheel, { passive: false });
    app.canvas.addEventListener("pointerdown", onPointerDown);

    const fixedDt = 1 / 60;
    let accumulator = 0;

    app.ticker.add((ticker) => {
      if (cancelled) {
        controls.dispose();
        resizeObserver.disconnect();
        app.canvas.removeEventListener("wheel", onWheel);
        app.canvas.removeEventListener("pointerdown", onPointerDown);
        app.destroy(true, { children: true });
        return;
      }

      const dtRender = Math.min(0.05, ticker.deltaMS / 1000);
      accumulator += dtRender;

      sim.dispatch({ type: "set-input", input: controls.input });
      while (accumulator >= fixedDt) {
        sim.step(fixedDt);
        accumulator -= fixedDt;
      }

      const game = sim.getSnapshot();
      const latestFrame = getLatestFrameEvent(sim.consumeEvents());

      const player = game.ships.find((ship) => ship.team === "player");
      if (followPlayer && player && !player.sunk) {
        camera.targetXFt = player.xFt;
        camera.targetYFt = player.yFt;
      }

      const lerp = clamp(dtRender * 8, 0, 1);
      camera.xFt += (camera.targetXFt - camera.xFt) * lerp;
      camera.yFt += (camera.targetYFt - camera.yFt) * lerp;

      const rudderLerp = clamp(dtRender * 5.5, 0, 1);
      for (const ship of game.ships) {
        const prev = rudderDisplayByShipId.get(ship.id) ?? 0;
        const target = ship.sunk ? 0 : ship.rudder;
        rudderDisplayByShipId.set(ship.id, prev + (target - prev) * rudderLerp);
      }

      const firingEvents = latestFrame?.firingEvents ?? [];
      const impactEvents = latestFrame?.impactEvents ?? [];
      const damageEvents = latestFrame?.damageEvents ?? [];

      spawnFiringParticles(firingEvents, particles, camera);
      spawnImpactParticles(impactEvents, particles, camera);
      spawnDamageLabels(damageEvents, damageLabels, labelLayer);
      for (const ship of game.ships) {
        spawnDestroyedGunSmoke(ship, particles, camera, gunSmokeTimers, dtRender);
      }

      drawOcean(oceanGfx, game.ocean, camera.viewWidthPx, camera.viewHeightPx, camera.zoom);
      drawShips(shipsGfx, game, camera, rudderDisplayByShipId);
      updateAndDrawParticles(particlesGfx, particles, dtRender);
      drawMiniMap(minimapGfx, game, camera, minimapX, MINIMAP_Y);
      drawWindCompass(compassGfx, game.ocean, camera.viewWidthPx);
      const compassX = camera.viewWidthPx / 2;
      const compassY = 87;
      const windDeg = ((game.ocean.windDirRad * 180) / Math.PI + 360) % 360;
      const windKnots = game.ocean.windSpeedKnots.toFixed(1);
      compassWindText.text = `${windKnots} kn\n${windDeg.toFixed(0)}\u00b0`;
      compassWindText.x = compassX - COMPASS_R - 10;
      compassWindText.y = compassY;
      compassNorthText.x = compassX;
      compassNorthText.y = compassY - COMPASS_R - 4;
      updateDamageLabels(damageLabels, dtRender, camera);
      updateAiDebugLabels(game, camera, aiDebugLabels, aiDebugLayer);

      const hud = getPlayerHud(game);
      const gunIcon = (g: GunInfo): string => {
        if (g.destroyed) return '<span style="color:#cc3322;font-weight:bold">X</span>';
        if (g.ready) return '<span style="color:#44dd88">■</span>';
        return '<span style="color:#5a8a9a">□</span>';
      };
      const portIcons = hud.portGuns.map(gunIcon).join(" ");
      const stbdIcons = hud.starboardGuns.map(gunIcon).join(" ");
      hudEl.innerHTML = [
        `<div class="hud-section"><div class="hud-title">Ship Status</div><div class="hud-row">Hull: ${hud.hull}%</div><div class="hud-row">Sails: ${hud.sails}%</div><div class="hud-row">Rudder: ${hud.rudder}%</div><div class="hud-row">Crew: ${hud.crew}%</div><div class="hud-row">Enemies Afloat: ${hud.enemiesAfloat}</div></div>`,
        `<div class="hud-section"><div class="hud-title">Gun Status</div><div class="hud-row">Port &nbsp; ${portIcons}</div><div class="hud-row">Stbd &nbsp; ${stbdIcons}</div></div>`,
        `<div class="hud-section"><div class="hud-title">Heading / Speed</div><div class="hud-row">Heading: ${hud.headingDeg}\u00b0</div><div class="hud-row">Rudder: ${hud.rudderDeg === 0 ? "0\u00b0 (Center)" : hud.rudderDeg > 0 ? hud.rudderDeg + "\u00b0 Starboard" : Math.abs(hud.rudderDeg) + "\u00b0 Port"}</div><div class="hud-row">Speed: ${hud.speed} ft/s</div><div class="hud-row">Sail Trim: ${hud.sailTrim}%</div><div class="hud-row">Zoom: ${camera.zoom.toFixed(2)}x</div></div>`,
      ].join("");

      if (game.winner) {
        const w = game.winner;
        statusEl.innerHTML =
          w === "player"
            ? `<div class="status-line">[Victory]</div><div class="status-line">Enemy fleet destroyed.</div><div class="status-line">Press Reset to play again.</div>`
            : w === "enemy"
              ? `<div class="status-line">[Defeat]</div><div class="status-line">Your ship has sunk.</div><div class="status-line">Press Reset to play again.</div>`
              : `<div class="status-line">[Draw]</div><div class="status-line">Press Reset to play again.</div>`;
      } else {
        statusEl.innerHTML = `<div class="status-hint">[I] Controls</div>`;
      }
    });
  });

  return handle;
}
