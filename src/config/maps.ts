// Last touched by agent: 2026-05-04T23:15:00Z
// Purpose: Map definitions with lat/lon bounds, coastlines, and metadata

export type MapType = "open-ocean" | "nyc-harbor";

export interface MapBounds {
  centerLat: number;
  centerLon: number;
  widthNm: number; // nautical miles
  heightNm: number;
}

export interface CoastlinePolygon {
  points: Array<{ lat: number; lon: number }>;
  isLand: boolean; // true = land (no-sail), false = water feature
}

export interface MapDefinition {
  id: MapType;
  label: string;
  description: string;
  bounds: MapBounds;
  coastlines: CoastlinePolygon[];
  playerSpawnLat: number;
  playerSpawnLon: number;
  enemySpawnLat: number;
  enemySpawnLon: number;
}

// Constants: 1 nautical mile ≈ 6,080 feet
const NM_TO_FT = 6080;

/**
 * NYC Harbor Map
 * Center: ~40.7°N, 74.0°W (lower New York Bay)
 * Playable area: 3 nm × 3 nm
 * Includes simplified outlines of Manhattan, Brooklyn, Staten Island, Jersey shore
 */
export const MAP_NYC_HARBOR: MapDefinition = {
  id: "nyc-harbor",
  label: "New York Harbor",
  description: "3×3nm harbor. Channels, islands, strategic shallows.",
  bounds: {
    centerLat: 40.7,
    centerLon: -74.0,
    widthNm: 3,
    heightNm: 3,
  },
  coastlines: [
    // Manhattan west side (simplified)
    {
      points: [
        { lat: 40.86, lon: -74.025 }, // north tip (Inwood)
        { lat: 40.84, lon: -74.029 },
        { lat: 40.82, lon: -74.031 },
        { lat: 40.80, lon: -74.032 },
        { lat: 40.78, lon: -74.032 },
        { lat: 40.76, lon: -74.032 },
        { lat: 40.74, lon: -74.032 },
        { lat: 40.72, lon: -74.031 },
        { lat: 40.70, lon: -74.031 },
        { lat: 40.69, lon: -74.030 }, // Battery (south tip)
      ],
      isLand: true,
    },
    // Manhattan east side
    {
      points: [
        { lat: 40.86, lon: -73.968 },
        { lat: 40.84, lon: -73.967 },
        { lat: 40.82, lon: -73.967 },
        { lat: 40.80, lon: -73.968 },
        { lat: 40.78, lon: -73.968 },
        { lat: 40.76, lon: -73.969 },
        { lat: 40.74, lon: -73.970 },
        { lat: 40.72, lon: -73.970 },
        { lat: 40.70, lon: -73.969 },
        { lat: 40.69, lon: -73.965 },
      ],
      isLand: true,
    },
    // Brooklyn (simplified)
    {
      points: [
        { lat: 40.72, lon: -73.945 },
        { lat: 40.70, lon: -73.940 },
        { lat: 40.68, lon: -73.942 },
        { lat: 40.66, lon: -73.950 },
        { lat: 40.65, lon: -73.960 },
        { lat: 40.66, lon: -73.975 },
        { lat: 40.68, lon: -73.985 },
        { lat: 40.70, lon: -73.980 },
      ],
      isLand: true,
    },
    // Staten Island (simplified)
    {
      points: [
        { lat: 40.68, lon: -74.090 },
        { lat: 40.66, lon: -74.070 },
        { lat: 40.64, lon: -74.050 },
        { lat: 40.63, lon: -74.080 },
        { lat: 40.64, lon: -74.110 },
      ],
      isLand: true,
    },
    // Governors Island
    {
      points: [
        { lat: 40.685, lon: -74.018 },
        { lat: 40.680, lon: -74.015 },
        { lat: 40.680, lon: -74.008 },
        { lat: 40.685, lon: -74.010 },
      ],
      isLand: true,
    },
    // Liberty Island
    {
      points: [
        { lat: 40.690, lon: -74.045 },
        { lat: 40.688, lon: -74.043 },
        { lat: 40.688, lon: -74.047 },
        { lat: 40.690, lon: -74.048 },
      ],
      isLand: true,
    },
  ],
  playerSpawnLat: 40.74,
  playerSpawnLon: -74.00,
  enemySpawnLat: 40.66,
  enemySpawnLon: -73.95,
};

/**
 * Open Ocean Map
 * No coastlines, unlimited play area
 */
export const MAP_OPEN_OCEAN: MapDefinition = {
  id: "open-ocean",
  label: "Open Ocean",
  description: "Infinite horizon. No land obstacles.",
  bounds: {
    centerLat: 0,
    centerLon: 0,
    widthNm: 100,
    heightNm: 100,
  },
  coastlines: [],
  playerSpawnLat: 0,
  playerSpawnLon: -0.05,
  enemySpawnLat: 0,
  enemySpawnLon: 0.05,
};

export const ALL_MAPS: MapDefinition[] = [MAP_NYC_HARBOR, MAP_OPEN_OCEAN];

export function getMap(mapType: MapType): MapDefinition {
  return ALL_MAPS.find((m) => m.id === mapType) || MAP_OPEN_OCEAN;
}
