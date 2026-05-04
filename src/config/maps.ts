// Last touched by agent: 2026-05-04T23:55:00Z
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
 * NYC Harbor Map (Modern Upper Bay slice)
 * Center: ~40.699°N, 74.010°W
 * Playable area: ~5 statute miles (W-E) × ~3 statute miles (N-S)
 * Includes modern coastline silhouettes around Battery, Brooklyn waterfront,
 * Jersey City / Liberty State Park, and key islands.
 */
export const MAP_NYC_HARBOR: MapDefinition = {
  id: "nyc-harbor",
  label: "New York Harbor",
  description: "Modern Upper Bay: ~5mi wide × ~3mi tall.",
  bounds: {
    centerLat: 40.699,
    centerLon: -74.010,
    // 1 statute mile = 0.868976 nautical miles
    widthNm: 4.345,
    heightNm: 2.607,
  },
  coastlines: [
    // Jersey City / Liberty State Park shoreline
    {
      points: [
        { lat: 40.732, lon: -74.078 },
        { lat: 40.721, lon: -74.070 },
        { lat: 40.709, lon: -74.055 },
        { lat: 40.699, lon: -74.045 },
        { lat: 40.689, lon: -74.040 },
        { lat: 40.676, lon: -74.042 },
        { lat: 40.668, lon: -74.054 },
        { lat: 40.667, lon: -74.070 },
        { lat: 40.677, lon: -74.082 },
        { lat: 40.696, lon: -74.086 },
        { lat: 40.717, lon: -74.084 },
      ],
      isLand: true,
    },
    // Lower Manhattan + Battery
    {
      points: [
        { lat: 40.724, lon: -74.018 },
        { lat: 40.718, lon: -74.016 },
        { lat: 40.711, lon: -74.014 },
        { lat: 40.705, lon: -74.012 },
        { lat: 40.700, lon: -74.009 },
        { lat: 40.700, lon: -74.002 },
        { lat: 40.704, lon: -73.998 },
        { lat: 40.711, lon: -73.996 },
        { lat: 40.719, lon: -73.998 },
        { lat: 40.724, lon: -74.004 },
        { lat: 40.725, lon: -74.012 },
      ],
      isLand: true,
    },
    // Battery Park fort (Castle Clinton-era footprint)
    {
      points: [
        { lat: 40.7044, lon: -74.0188 },
        { lat: 40.7048, lon: -74.0180 },
        { lat: 40.7049, lon: -74.0171 },
        { lat: 40.7046, lon: -74.0163 },
        { lat: 40.7040, lon: -74.0158 },
        { lat: 40.7033, lon: -74.0159 },
        { lat: 40.7028, lon: -74.0165 },
        { lat: 40.7026, lon: -74.0173 },
        { lat: 40.7028, lon: -74.0181 },
        { lat: 40.7034, lon: -74.0187 },
      ],
      isLand: true,
    },
    // Brooklyn waterfront (Brooklyn Heights to Red Hook)
    {
      points: [
        { lat: 40.716, lon: -74.005 },
        { lat: 40.710, lon: -73.995 },
        { lat: 40.704, lon: -73.986 },
        { lat: 40.698, lon: -73.978 },
        { lat: 40.691, lon: -73.973 },
        { lat: 40.683, lon: -73.969 },
        { lat: 40.675, lon: -73.968 },
        { lat: 40.670, lon: -73.975 },
        { lat: 40.671, lon: -73.987 },
        { lat: 40.676, lon: -73.997 },
        { lat: 40.684, lon: -74.005 },
        { lat: 40.694, lon: -74.010 },
        { lat: 40.705, lon: -74.011 },
      ],
      isLand: true,
    },
    // Governors Island
    {
      points: [
        { lat: 40.694, lon: -74.020 },
        { lat: 40.688, lon: -74.013 },
        { lat: 40.687, lon: -74.000 },
        { lat: 40.692, lon: -73.994 },
        { lat: 40.700, lon: -73.998 },
        { lat: 40.701, lon: -74.010 },
      ],
      isLand: true,
    },
    // Ellis Island
    {
      points: [
        { lat: 40.701, lon: -74.046 },
        { lat: 40.698, lon: -74.043 },
        { lat: 40.698, lon: -74.038 },
        { lat: 40.702, lon: -74.036 },
        { lat: 40.705, lon: -74.040 },
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
  playerSpawnLat: 40.712,
  playerSpawnLon: -74.020,
  enemySpawnLat: 40.684,
  enemySpawnLon: -73.965,
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
