// Last touched by agent: 2026-05-04T23:15:00Z
// Purpose: Lat/lon ↔ ft conversion for map-based coordinate system

const NM_TO_FT = 6080;
const FT_TO_DEGREES_LAT = 1 / (NM_TO_FT * 60); // 1° lat = 60 nm
const FT_TO_DEGREES_LON_AT_EQUATOR = 1 / (NM_TO_FT * 60 * Math.cos(0));

/**
 * Convert lat/lon to local ft-space relative to a map center
 * Assumes small area (< 10nm) so we ignore Earth curvature
 */
export function latLonToFt(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number
): { xFt: number; yFt: number } {
  const dLatDeg = lat - centerLat;
  const dLonDeg = lon - centerLon;

  // 1° latitude = 60 nm = 364,800 ft (constant everywhere)
  const yFt = dLatDeg * NM_TO_FT * 60;

  // 1° longitude = 60 nm * cos(latitude), but for small areas just use center latitude
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const xFt = dLonDeg * NM_TO_FT * 60 * cosLat;

  return { xFt, yFt };
}

/**
 * Convert local ft-space back to lat/lon
 */
export function ftToLatLon(
  xFt: number,
  yFt: number,
  centerLat: number,
  centerLon: number
): { lat: number; lon: number } {
  const dLatDeg = yFt / (NM_TO_FT * 60);
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const dLonDeg = xFt / (NM_TO_FT * 60 * cosLat);

  return {
    lat: centerLat + dLatDeg,
    lon: centerLon + dLonDeg,
  };
}

/**
 * Point-in-polygon test (ray casting algorithm)
 */
export function pointInPolygon(
  xFt: number,
  yFt: number,
  polygon: Array<{ xFt: number; yFt: number }>
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].xFt;
    const yi = polygon[i].yFt;
    const xj = polygon[j].xFt;
    const yj = polygon[j].yFt;

    const intersect = yi > yFt !== yj > yFt && xFt < ((xj - xi) * (yFt - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
