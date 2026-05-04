// Last touched by agent: 2026-05-04T23:15:00Z
// Purpose: Pixi scene — ship rendering, effects, and camera zoom/centering controls.
import { Application, Color, Graphics, Text } from "pixi.js";
import { FEET_TO_PX, HALF_WORLD_FT, VIEW_SIZE_PX, WORLD_SIZE_FT } from "../config/world";
import { SHIP_BALANCE } from "../config/balance";
import { getMap } from "../config/maps";
import { latLonToFt } from "../sim/coordinates";
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

type SinkingShip = {
  shipId: number;
  team: "player" | "enemy";
  xFt: number;
  yFt: number;
  headingRad: number;
  lengthFt: number;
  beamFt: number;
  age: number;
  maxAge: number;
};

type Crumb = {
  xFt: number;
  yFt: number;
  team: "player" | "enemy";
  bornSec: number;
};

type ShipMatchStats = {
  shipId: number;
  team: "player" | "enemy";
  shipClass: string;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  damageReceived: number;
};

function initMatchStats(game: GameState): Map<number, ShipMatchStats> {
  const map = new Map<number, ShipMatchStats>();
  for (const ship of game.ships) {
    map.set(ship.id, {
      shipId: ship.id,
      team: ship.team,
      shipClass: ship.shipClass,
      shotsFired: 0,
      shotsHit: 0,
      damageDealt: 0,
      damageReceived: 0,
    });
  }
  return map;
}

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

function getZoomLimits(mapType: string): { min: number; max: number } {
  if (mapType === "nyc-harbor") {
    return { min: 0.1, max: 3.2 };
  }
  return { min: 0.45, max: 3.2 };
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
  // For NYC Harbor, start zoomed out so you can see the harbor
  const initialZoom = game.mapType === "nyc-harbor" ? 0.25 : 1.0;
  return {
    xFt: player?.xFt ?? 0,
    yFt: player?.yFt ?? 0,
    targetXFt: player?.xFt ?? 0,
    targetYFt: player?.yFt ?? 0,
    zoom: initialZoom,
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

function drawCoastlines(
  g: Graphics,
  game: GameState,
  camera: CameraState,
): void {
  if (game.mapType === "open-ocean") return;

  const map = getMap(game.mapType);
  if (!map.coastlines.length) return;

  g.clear();
  for (const polygon of map.coastlines) {
    if (polygon.isLand && polygon.points.length > 0) {
      // Convert lat/lon to ft, then to screen coords
      const ftPoints = polygon.points.map((pt) => latLonToFt(pt.lat, pt.lon, game.mapCenterLat, game.mapCenterLon));
      const screenPoints = ftPoints.map((pt) => toScreen(camera, pt.xFt, pt.yFt));

      if (screenPoints.length > 0) {
        g.beginFill(0x1a4d2e);
        g.moveTo(screenPoints[0].x, screenPoints[0].y);
        for (let i = 1; i < screenPoints.length; i++) {
          g.lineTo(screenPoints[i].x, screenPoints[i].y);
        }
        g.lineTo(screenPoints[0].x, screenPoints[0].y);
        g.endFill();
        // Add a subtle stroke for definition
        g.stroke({ color: 0x0d5a35, width: 1.5 });
      }
    }
  }
}

function drawDirectionMarkers(g: Graphics, game: GameState, camera: CameraState): void {
  g.clear();
  const viewW = camera.viewWidthPx;
  const viewH = camera.viewHeightPx;
  const margin = 46; // px from screen edge where indicators sit
  const safeRadius = Math.min(viewW, viewH) * 0.5 - margin;

  type Target = { xFt: number; yFt: number; color: number };
  const targets: Target[] = [];

  // Enemy ships (red markers)
  for (const ship of game.ships) {
    if (ship.team === "player" || ship.sunk) continue;
    targets.push({ xFt: ship.xFt, yFt: ship.yFt, color: 0xe05540 });
  }

  // City landmarks for NYC Harbor (green markers)
  if (game.mapType === "nyc-harbor") {
    const landmarks = [
      { label: "Manhattan", lat: 40.785, lon: -73.968 },
      { label: "Battery",   lat: 40.700, lon: -74.016 },
      { label: "Brooklyn",  lat: 40.680, lon: -73.945 },
    ];
    for (const lm of landmarks) {
      // Convert to ft relative to map center
      const dlat = lm.lat - game.mapCenterLat;
      const dlon = lm.lon - game.mapCenterLon;
      const cosLat = Math.cos((game.mapCenterLat * Math.PI) / 180);
      const xFt = dlon * 6080 * 60 * cosLat;
      const yFt = dlat * 6080 * 60;
      targets.push({ xFt, yFt, color: 0x44cc88 });
    }
  }

  for (const target of targets) {
    const screen = toScreen(camera, target.xFt, target.yFt);
    const onScreen =
      screen.x >= -margin && screen.x <= viewW + margin &&
      screen.y >= -margin && screen.y <= viewH + margin;
    if (onScreen) continue;

    const angle = Math.atan2(screen.y - viewH * 0.5, screen.x - viewW * 0.5);
    const ex = viewW * 0.5 + Math.cos(angle) * safeRadius;
    const ey = viewH * 0.5 + Math.sin(angle) * safeRadius;

    // Glow ring
    g.circle(ex, ey, 11).fill({ color: target.color, alpha: 0.18 });
    // Solid dot
    g.circle(ex, ey, 7).fill({ color: target.color, alpha: 0.88 });
    // Chevron pointing inward
    const chevLen = 10;
    const cx1 = ex + Math.cos(angle + 2.4) * chevLen;
    const cy1 = ey + Math.sin(angle + 2.4) * chevLen;
    const cx2 = ex + Math.cos(angle - 2.4) * chevLen;
    const cy2 = ey + Math.sin(angle - 2.4) * chevLen;
    const tipX = ex + Math.cos(angle) * 14;
    const tipY = ey + Math.sin(angle) * 14;
    g.moveTo(cx1, cy1);
    g.lineTo(tipX, tipY);
    g.lineTo(cx2, cy2);
    g.stroke({ color: target.color, width: 2, alpha: 0.7 });
  }
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

  let worldHalfFt = 1000;
  if (game.mapType === "nyc-harbor") {
    worldHalfFt = 30000; // ~5nm radius, enough to see entire harbor
  }

  const scale = MINIMAP_SIZE / (worldHalfFt * 2);

  const mapPoint = (xFt: number, yFt: number): ScreenPoint => ({
    x: mapX + (xFt + worldHalfFt) * scale,
    y: mapY + (worldHalfFt - yFt) * scale,
  });

  g.roundRect(mapX, mapY, MINIMAP_SIZE, MINIMAP_SIZE, 10).fill({ color: 0x0d2430, alpha: 0.82 });
  g.roundRect(mapX, mapY, MINIMAP_SIZE, MINIMAP_SIZE, 10).stroke({ color: 0x4a8fa0, width: 1.2, alpha: 0.9 });
  // Draw coastlines on minimap
  if (game.mapType === "nyc-harbor") {
    const map = getMap(game.mapType);
    for (const polygon of map.coastlines) {
      if (polygon.isLand && polygon.points.length > 0) {
        const ftPoints = polygon.points.map((pt) => latLonToFt(pt.lat, pt.lon, game.mapCenterLat, game.mapCenterLon));
        const screenPoints = ftPoints.map((pt) => mapPoint(pt.xFt, pt.yFt));
        if (screenPoints.length > 0) {
          g.beginFill(0x1a4d2e, 0.6);
          g.moveTo(screenPoints[0].x, screenPoints[0].y);
          for (let i = 1; i < screenPoints.length; i++) {
            g.lineTo(screenPoints[i].x, screenPoints[i].y);
          }
          g.lineTo(screenPoints[0].x, screenPoints[0].y);
          g.endFill();
        }
      }
    }
  }


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

function drawSinkingShips(g: Graphics, sinkingShips: Map<number, SinkingShip>, camera: CameraState): void {
  for (const [, sk] of sinkingShips) {
    const t = clamp(sk.age / sk.maxAge, 0, 1);
    const alpha = 1 - t;
    if (alpha < 0.02) continue;

    const sinkFt = t * t * sk.beamFt * 1.4;
    const drawYFt = sk.yFt - sinkFt;
    const c = Math.cos(sk.headingRad);
    const s = Math.sin(sk.headingRad);
    const toWld = (lx: number, ly: number) => ({
      xFt: sk.xFt + lx * c - ly * s,
      yFt: drawYFt + lx * s + ly * c,
    });

    const lh = sk.lengthFt * 0.5;
    const bh = sk.beamFt * 0.5;
    const pts = [
      { x: lh, y: 0 }, { x: lh * 0.56, y: -bh * 0.96 }, { x: lh * 0.05, y: -bh },
      { x: -lh * 0.70, y: -bh * 0.72 }, { x: -lh, y: -bh * 0.25 }, { x: -lh, y: bh * 0.25 },
      { x: -lh * 0.70, y: bh * 0.72 }, { x: lh * 0.05, y: bh }, { x: lh * 0.56, y: bh * 0.96 },
    ];
    const hullPoints: number[] = [];
    for (const p of pts) {
      const w = toWld(p.x, p.y);
      const sc = toScreen(camera, w.xFt, w.yFt);
      hullPoints.push(sc.x, sc.y);
    }
    const hullColor = sk.team === "player" ? "#d8bf7a" : "#b86860";
    g.poly(hullPoints).fill({ color: hullColor, alpha: alpha * 0.9 });

    const center = toScreen(camera, sk.xFt, drawYFt);
    const ringR = 8 + t * sk.lengthFt * FEET_TO_PX * camera.zoom * 0.65;
    g.circle(center.x, center.y, ringR).stroke({ color: 0x8ecde0, width: 1.5, alpha: alpha * 0.5 });
    if (t > 0.12) {
      g.circle(center.x, center.y, ringR * 0.5).stroke({ color: 0xb0dce8, width: 1, alpha: alpha * 0.3 });
    }
  }
}

function drawCrumbs(g: Graphics, crumbs: Crumb[], currentTimeSec: number, camera: CameraState): void {
  g.clear();
  const CRUMB_MAX_AGE = 60;
  for (const crumb of crumbs) {
    const age = currentTimeSec - crumb.bornSec;
    if (age >= CRUMB_MAX_AGE) continue;
    const alpha = (1 - age / CRUMB_MAX_AGE) * 0.52;
    const sc = toScreen(camera, crumb.xFt, crumb.yFt);
    const color = crumb.team === "player" ? 0xf0d27a : 0xd46a62;
    g.circle(sc.x, sc.y, 1.8).fill({ color, alpha });
  }
}

function buildVictorySummary(winner: "player" | "enemy" | "draw", game: GameState, stats: Map<number, ShipMatchStats>): string {
  const title = winner === "player" ? "Victory!" : winner === "enemy" ? "Defeat" : "Draw";
  const titleColor = winner === "player" ? "#6ee780" : winner === "enemy" ? "#ec5a5a" : "#f3bf4f";
  let rows = "";
  for (const ship of game.ships) {
    const st = stats.get(ship.id);
    if (!st) continue;
    const label = ship.team === "player" ? `${ship.shipClass} (You)` : `${ship.shipClass} (Enemy)`;
    const hullPct = Math.round((ship.hullHp / ship.maxHullHp) * 100);
    const hitRate = st.shotsFired > 0 ? Math.round((st.shotsHit / st.shotsFired) * 100) : 0;
    const status = ship.sunk ? `<span style="color:#ec5a5a">Sunk</span>` : `<span style="color:#6ee780">Afloat</span>`;
    rows += `<tr><td>${label}</td><td>${st.shotsFired}</td><td>${st.shotsHit} (${hitRate}%)</td><td>${st.damageDealt}</td><td>Hull ${hullPct}%</td><td>${status}</td></tr>`;
  }
  return `<div class="victory-panel"><div class="victory-title" style="color:${titleColor}">[${title}]</div><div class="victory-subtitle">Battle Summary</div><table class="victory-table"><thead><tr><th>Ship</th><th>Shots</th><th>Hits</th><th>Dmg</th><th>Hull</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table><div class="victory-footer">Press Reset to play again.</div></div>`;
}

function drawShips(
  g: Graphics,
  game: GameState,
  camera: CameraState,
  rudderDisplayByShipId: Map<number, number>,
): void {
  g.clear();
  for (const ship of game.ships) {
    if (ship.sunk) continue;

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
    g.poly(hullPoints).fill(hullColor);

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

    g.poly([rs1.x, rs1.y, rs2.x, rs2.y, rs3.x, rs3.y, rs4.x, rs4.y]).fill("#2f2f2f");

    const hingePort = shipToWorld(ship, rudderHingeX, rudderWidthHalf * 1.03);
    const hingeStar = shipToWorld(ship, rudderHingeX, -rudderWidthHalf * 1.03);
    const hs1 = toScreen(camera, hingePort.xFt, hingePort.yFt);
    const hs2 = toScreen(camera, hingeStar.xFt, hingeStar.yFt);
    g.moveTo(hs1.x, hs1.y);
    g.lineTo(hs2.x, hs2.y);
    g.stroke({ color: "#151515", width: Math.max(1, 1.3 * camera.zoom) });
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
  zoomEl?: HTMLElement;
  mapType?: import("../config/maps").MapType;
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
    mapType: opts?.mapType ?? "open-ocean",
  });
  const particles: Particle[] = [];
  const damageLabels: DamageLabel[] = [];
  const aiDebugLabels = new Map<number, Text>();
  const rudderDisplayByShipId = new Map<number, number>();
  const gunSmokeTimers = new Map<string, number>();
  const sinkingShips = new Map<number, SinkingShip>();
  const prevSunkIds = new Set<number>();
  const crumbs: Crumb[] = [];
  let crumbTimer = 0;
  let matchStats = initMatchStats(sim.getSnapshot());
  let summaryShown = false;
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
      sinkingShips.clear();
      prevSunkIds.clear();
      crumbs.length = 0;
      crumbTimer = 0;
      matchStats = initMatchStats(sim.getSnapshot());
      summaryShown = false;
      followPlayer = true;
      const game = sim.getSnapshot();
      camera.zoom = game.mapType === "nyc-harbor" ? 0.25 : 1.0;
      centerCameraOnPlayer(game, camera);
      hudEl.textContent = "";
      statusEl.textContent = "";
    },
    centerOnPlayer: () => {
      followPlayer = true;
      centerCameraOnPlayer(sim.getSnapshot(), camera);
    },
    zoomIn: () => {
      const limits = getZoomLimits(sim.getSnapshot().mapType);
      camera.zoom = clamp(camera.zoom * 1.15, limits.min, limits.max);
    },
    zoomOut: () => {
      const limits = getZoomLimits(sim.getSnapshot().mapType);
      camera.zoom = clamp(camera.zoom / 1.15, limits.min, limits.max);
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
    const coastlinesGfx = new Graphics();
    const crumbsGfx = new Graphics();
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
    app.stage.addChild(coastlinesGfx);
    app.stage.addChild(crumbsGfx);
    app.stage.addChild(shipsGfx);
    app.stage.addChild(particlesGfx);
    app.stage.addChild(minimapGfx);
    app.stage.addChild(compassGfx);
    const directionMarkersGfx = new Graphics();
    app.stage.addChild(directionMarkersGfx);
    app.stage.addChild(compassWindText);
    app.stage.addChild(compassNorthText);
    app.stage.addChild(labelLayer);
    app.stage.addChild(aiDebugLayer);

    const controls = createControls(window);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0012);
      const limits = getZoomLimits(sim.getSnapshot().mapType);
      camera.zoom = clamp(camera.zoom * factor, limits.min, limits.max);
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
      const consumedEvents = sim.consumeEvents();
      const latestFrame = getLatestFrameEvent(consumedEvents);

      // ── Detect newly sunk ships and start sinking animation ──────────────
      for (const ship of game.ships) {
        if (ship.sunk && !prevSunkIds.has(ship.id)) {
          prevSunkIds.add(ship.id);
          sinkingShips.set(ship.id, {
            shipId: ship.id, team: ship.team,
            xFt: ship.xFt, yFt: ship.yFt, headingRad: ship.headingRad,
            lengthFt: ship.lengthFt, beamFt: ship.beamFt,
            age: 0, maxAge: 4.5,
          });
          const sc = toScreen(camera, ship.xFt, ship.yFt);
          for (let i = 0; i < 10; i += 1) {
            const angle = (Math.PI * 2 * i) / 10;
            const speed = 14 + Math.random() * 22;
            particles.push({ x: sc.x, y: sc.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, maxAge: 1.6 + Math.random() * 0.6, startRadius: 2.5, endRadius: 7, startAlpha: 0.65, color: 0x88ccdd });
          }
        }
      }

      // ── Advance sinking ship ages ─────────────────────────────────────────
      for (const [id, sk] of sinkingShips) {
        sk.age += dtRender;
        if (sk.age >= sk.maxAge) sinkingShips.delete(id);
      }

      // ── Accumulate per-ship match stats ───────────────────────────────────
      for (const ev of consumedEvents) {
        if (ev.type !== "frame") continue;
        for (const fe of ev.firingEvents) {
          const st = matchStats.get(fe.shipId);
          if (st) st.shotsFired += 1;
        }
        for (const de of ev.damageEvents) {
          if (de.kind === "cannon" && de.attackerShipId !== undefined) {
            const atk = matchStats.get(de.attackerShipId);
            if (atk) { atk.shotsHit += 1; atk.damageDealt += de.amount; }
          }
          if (de.targetShipId !== undefined) {
            const tgt = matchStats.get(de.targetShipId);
            if (tgt) tgt.damageReceived += de.amount;
          }
        }
      }

      // ── Breadcrumbs: drop every 2s, expire at 60s ────────────────────────
      crumbTimer += dtRender;
      if (crumbTimer >= 2.0) {
        crumbTimer -= 2.0;
        for (const ship of game.ships) {
          if (!ship.sunk) crumbs.push({ xFt: ship.xFt, yFt: ship.yFt, team: ship.team, bornSec: game.ocean.timeSec });
        }
      }
      // Prune crumbs older than 60s
      let ci = 0;
      while (ci < crumbs.length) {
        if (game.ocean.timeSec - crumbs[ci].bornSec > 60) { crumbs.splice(ci, 1); } else { ci += 1; }
      }

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
      drawCoastlines(coastlinesGfx, game, camera);
      drawCrumbs(crumbsGfx, crumbs, game.ocean.timeSec, camera);
      drawShips(shipsGfx, game, camera, rudderDisplayByShipId);
      drawSinkingShips(shipsGfx, sinkingShips, camera);
      updateAndDrawParticles(particlesGfx, particles, dtRender);
      drawMiniMap(minimapGfx, game, camera, minimapX, MINIMAP_Y);
      drawWindCompass(compassGfx, game.ocean, camera.viewWidthPx);
      drawDirectionMarkers(directionMarkersGfx, game, camera);
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

      if (opts?.zoomEl) opts.zoomEl.textContent = `Zoom: ${camera.zoom.toFixed(2)}\u00d7`;

      const hud = getPlayerHud(game);
      const gunIcon = (g: GunInfo): string => {
        if (g.destroyed) return '<span style="color:#cc3322;font-weight:bold">X</span>';
        if (g.ready) return '<span style="color:#44dd88">■</span>';
        return '<span style="color:#5a8a9a">□</span>';
      };
      const portIcons = hud.portGuns.map(gunIcon).join(" ");
      const stbdIcons = hud.starboardGuns.map(gunIcon).join(" ");
      const rudderLabel = hud.rudderDeg === 0 ? `0\u00b0 (Center)` : hud.rudderDeg > 0 ? `${hud.rudderDeg}\u00b0 Stbd` : `${Math.abs(hud.rudderDeg)}\u00b0 Port`;
      hudEl.innerHTML = [
        `<div class="hud-section"><div class="hud-title">Ship Status</div><div class="hud-row">Hull: ${hud.hull}%</div><div class="hud-row">Sails: ${hud.sails}%</div><div class="hud-row">Rudder: ${hud.rudder}%</div><div class="hud-row">Crew: ${hud.crew}%</div><div class="hud-row">Enemies Afloat: ${hud.enemiesAfloat}</div></div>`,
        `<div class="hud-section"><div class="hud-title">Gun Status</div><div class="hud-row">Port &nbsp; ${portIcons}</div><div class="hud-row">Stbd &nbsp; ${stbdIcons}</div></div>`,
        `<div class="hud-section"><div class="hud-title">Heading / Speed</div><div class="hud-row hud-row-large">Sail Trim: ${hud.sailTrim}%</div><div class="hud-row hud-row-large">Rudder: ${rudderLabel}</div><div class="hud-row">Heading: ${hud.headingDeg}\u00b0</div><div class="hud-row">Speed: ${hud.speed} ft/s</div></div>`,
      ].join("");

      if (game.winner && !summaryShown) {
        summaryShown = true;
        statusEl.innerHTML = buildVictorySummary(game.winner, game, matchStats);
      } else if (!game.winner) {
        statusEl.innerHTML = `<div class="status-hint">[I] Controls</div>`;
      }
    });
  });

  return handle;
}
